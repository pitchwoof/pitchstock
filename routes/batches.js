const express = require('express');
const db = require('../db');
const { requireAuth, requireCreate, requireEdit } = require('../middleware/auth');

const router = express.Router();

// All batches for a product regardless of remaining quantity (e.g. for claims against a sold-out batch)
router.get('/product/:productId', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM batches
    WHERE product_id = ?
    ORDER BY (expiration_date IS NULL) ASC, expiration_date ASC, received_date ASC
  `).all(req.params.productId);
  if (req.session.role !== 'admin') {
    for (const r of rows) delete r.unit_cost;
  }
  res.json(rows);
});

// Receive stock (inflow) - creates a batch and an IN transaction
router.post('/', requireAuth, requireCreate, (req, res) => {
  const {
    productId, batchNumber, expirationDate, quantity,
    unitCost, supplier, receivedDate, note,
  } = req.body || {};

  if (!productId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'กรุณาระบุสินค้าและจำนวนที่มากกว่า 0' });
  }
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });

  const rDate = receivedDate || new Date().toISOString().slice(0, 10);

  const insertBatch = db.prepare(`
    INSERT INTO batches (product_id, batch_number, expiration_date, quantity_received, quantity_remaining, unit_cost, supplier, received_date, created_by, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTxn = db.prepare(`
    INSERT INTO stock_transactions (type, batch_id, product_id, quantity, transaction_date, counterparty, user_id, note)
    VALUES ('IN', ?, ?, ?, ?, ?, ?, ?)
  `);

  let batchId;
  db.exec('BEGIN');
  try {
    const info = insertBatch.run(
      productId, batchNumber || null, expirationDate || null, quantity, quantity,
      unitCost || null, supplier || null, rDate, req.session.userId, note || null
    );
    batchId = Number(info.lastInsertRowid);
    insertTxn.run(batchId, productId, quantity, rDate, supplier || null, req.session.userId, note || null);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'บันทึกการรับสินค้าเข้าไม่สำเร็จ', detail: err.message });
  }

  res.status(201).json({ batchId });
});

// Correct a receive-stock (IN) record that was entered wrong — edits the batch and its
// original IN transaction together so both stay consistent. Quantity can only be lowered to
// (at least) what has already been consumed from this batch, and only raised freely.
router.patch('/:batchId', requireAuth, requireEdit, (req, res) => {
  const {
    batchNumber, expirationDate, quantity, supplier, receivedDate, note,
  } = req.body || {};
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'ไม่พบล็อตสินค้า' });

  const inTxn = db.prepare("SELECT * FROM stock_transactions WHERE batch_id = ? AND type = 'IN' ORDER BY created_at ASC LIMIT 1").get(batch.id);

  let newReceived = batch.quantity_received;
  let newRemaining = batch.quantity_remaining;
  if (quantity !== undefined) {
    const qty = Number(quantity);
    if (!qty || qty <= 0) return res.status(400).json({ error: 'จำนวนต้องมากกว่า 0' });
    const consumed = batch.quantity_received - batch.quantity_remaining;
    if (qty < consumed) {
      return res.status(400).json({ error: `แก้ไขจำนวนไม่ได้ เพราะมีการเบิก/ใช้จากล็อตนี้ไปแล้ว ${consumed} หน่วย ซึ่งมากกว่าจำนวนใหม่ที่ระบุ` });
    }
    newReceived = qty;
    newRemaining = qty - consumed;
  }

  const newBatchNumber = batchNumber !== undefined ? (batchNumber || null) : batch.batch_number;
  const newExpiration = expirationDate !== undefined ? (expirationDate || null) : batch.expiration_date;
  const newSupplier = supplier !== undefined ? (supplier || null) : batch.supplier;
  const newReceivedDate = receivedDate || batch.received_date;
  const newNote = note !== undefined ? (note || null) : batch.note;

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE batches SET batch_number = ?, expiration_date = ?, quantity_received = ?, quantity_remaining = ?, supplier = ?, received_date = ?, note = ?
      WHERE id = ?
    `).run(newBatchNumber, newExpiration, newReceived, newRemaining, newSupplier, newReceivedDate, newNote, batch.id);
    if (inTxn) {
      db.prepare(`
        UPDATE stock_transactions SET quantity = ?, transaction_date = ?, counterparty = ?, note = ?
        WHERE id = ?
      `).run(newReceived, newReceivedDate, newSupplier, newNote, inTxn.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'แก้ไขรายการรับสินค้าเข้าไม่สำเร็จ', detail: err.message });
  }

  res.json({ ok: true });
});

// Delete a mistaken receive-stock (IN) record entirely — removes the batch and its IN
// transaction together. Blocked if anything else already references this batch (a later
// issue/adjustment, a claim, or a purchase order marked received into it).
router.delete('/:batchId', requireAuth, requireEdit, (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'ไม่พบล็อตสินค้า' });

  db.exec('BEGIN');
  try {
    db.prepare("DELETE FROM stock_transactions WHERE batch_id = ? AND type = 'IN'").run(batch.id);
    db.prepare('DELETE FROM batches WHERE id = ?').run(batch.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (String(err.message).includes('FOREIGN KEY')) {
      return res.status(409).json({
        error: 'ลบไม่ได้ เพราะล็อตนี้มีการเบิกออก/ปรับปรุง/เคลม หรือถูกอ้างอิงจากรายการสั่งซื้ออยู่ในระบบ — แก้ไขจำนวนแทนการลบ',
      });
    }
    return res.status(500).json({ error: 'ลบรายการรับสินค้าเข้าไม่สำเร็จ', detail: err.message });
  }

  res.json({ ok: true });
});

// Manual adjustment (e.g. correction, damage/write-off) - can be positive or negative
router.post('/:batchId/adjust', requireAuth, requireEdit, (req, res) => {
  const { quantityDelta, note, transactionDate } = req.body || {};
  const delta = Number(quantityDelta);
  if (!delta) return res.status(400).json({ error: 'กรุณาระบุจำนวนที่ต้องการปรับ (ต้องไม่เป็นศูนย์)' });

  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'ไม่พบล็อตสินค้า' });

  const newRemaining = batch.quantity_remaining + delta;
  if (newRemaining < 0) return res.status(400).json({ error: 'การปรับปรุงนี้จะทำให้จำนวนคงเหลือติดลบ' });

  const tDate = transactionDate || new Date().toISOString().slice(0, 10);

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE batches SET quantity_remaining = ? WHERE id = ?').run(newRemaining, batch.id);
    db.prepare(`
      INSERT INTO stock_transactions (type, batch_id, product_id, quantity, transaction_date, counterparty, user_id, note)
      VALUES ('ADJUST', ?, ?, ?, ?, NULL, ?, ?)
    `).run(batch.id, batch.product_id, delta, tDate, req.session.userId, note || null);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'ปรับปรุงล็อตไม่สำเร็จ', detail: err.message });
  }

  res.json({ ok: true, newRemaining });
});

// Manually correct a batch's expiration date (e.g. after re-inspecting/re-certifying old stock
// before shipping it out). Keeps a trace of the change in the batch note for accountability.
router.patch('/:batchId/expiration', requireAuth, requireEdit, (req, res) => {
  const { expirationDate, reason } = req.body || {};
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'ไม่พบล็อตสินค้า' });

  const today = new Date().toISOString().slice(0, 10);
  const oldDate = batch.expiration_date || 'ไม่ระบุ';
  const newDate = expirationDate || null;
  const traceLine = `[${today}] แก้ไขวันหมดอายุจาก ${oldDate} เป็น ${newDate || 'ไม่ระบุ'}${reason ? ` — เหตุผล: ${reason}` : ''}`;
  const updatedNote = batch.note ? `${batch.note}\n${traceLine}` : traceLine;

  db.prepare('UPDATE batches SET expiration_date = ?, note = ? WHERE id = ?').run(newDate, updatedNote, batch.id);
  res.json({ ok: true });
});

module.exports = router;
