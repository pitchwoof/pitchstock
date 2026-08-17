const express = require('express');
const db = require('../db');
const { requireAuth, requireEdit } = require('../middleware/auth');

const router = express.Router();

function buildQuery({ productId, type, from, to, purpose }) {
  const clauses = [];
  const params = [];
  if (productId) { clauses.push('t.product_id = ?'); params.push(productId); }
  if (type) { clauses.push('t.type = ?'); params.push(type); }
  if (from) { clauses.push('t.transaction_date >= ?'); params.push(from); }
  if (to) { clauses.push('t.transaction_date <= ?'); params.push(to); }
  if (purpose) { clauses.push("COALESCE(t.purpose, 'sale') = ?"); params.push(purpose); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

router.get('/', requireAuth, (req, res) => {
  const { where, params } = buildQuery(req.query);
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const rows = db.prepare(`
    SELECT t.*, p.name AS product_name, p.sku_code, p.unit, b.batch_number, b.expiration_date, u.display_name AS user_name
    FROM stock_transactions t
    JOIN products p ON p.id = t.product_id
    JOIN batches b ON b.id = t.batch_id
    LEFT JOIN users u ON u.id = t.user_id
    ${where}
    ORDER BY t.transaction_date DESC, t.created_at DESC
    LIMIT ?
  `).all(...params, limit);
  if (req.session.role !== 'admin') {
    for (const r of rows) delete r.unit_price;
  }
  res.json(rows);
});

// Correct an issue-stock (OUT) record that was entered wrong. Quantity changes are re-applied
// against the batch it was drawn from (can't exceed what's currently available in that batch).
const VALID_PURPOSES = ['sale', 'trial', 'claim', 'gift'];

router.patch('/:id', requireAuth, requireEdit, (req, res) => {
  const {
    quantity, transactionDate, counterparty, note, purpose, unitPrice, requisitionNo, batchId,
  } = req.body || {};
  const txn = db.prepare('SELECT * FROM stock_transactions WHERE id = ?').get(req.params.id);
  if (!txn) return res.status(404).json({ error: 'ไม่พบรายการ' });
  if (txn.type !== 'OUT') return res.status(400).json({ error: 'แก้ไขได้เฉพาะรายการเบิกออก' });

  const oldBatch = db.prepare('SELECT * FROM batches WHERE id = ?').get(txn.batch_id);
  const newBatchId = batchId !== undefined && batchId ? Number(batchId) : txn.batch_id;
  const changingBatch = newBatchId !== txn.batch_id;

  let newBatch = oldBatch;
  if (changingBatch) {
    newBatch = db.prepare('SELECT * FROM batches WHERE id = ?').get(newBatchId);
    if (!newBatch) return res.status(404).json({ error: 'ไม่พบล็อตใหม่ที่ระบุ' });
    if (newBatch.product_id !== txn.product_id) {
      return res.status(400).json({ error: 'ล็อตใหม่ต้องเป็นของสินค้าเดียวกัน' });
    }
  }

  let newQty = txn.quantity;
  if (quantity !== undefined) {
    const qty = Number(quantity);
    if (!qty || qty <= 0) return res.status(400).json({ error: 'จำนวนต้องมากกว่า 0' });
    newQty = qty;
  }

  // If moving to a different lot, give the old lot its quantity back in full and draw the new
  // quantity fresh from the new lot. If staying on the same lot, just re-apply the delta.
  const oldBatchNewRemaining = oldBatch.quantity_remaining + txn.quantity;
  const newBatchNewRemaining = changingBatch
    ? newBatch.quantity_remaining - newQty
    : oldBatch.quantity_remaining - (newQty - txn.quantity);
  if (newBatchNewRemaining < 0) {
    return res.status(400).json({ error: `ล็อตที่เลือกเหลือไม่พอสำหรับจำนวนนี้ (คงเหลือปัจจุบัน ${newBatch.quantity_remaining})` });
  }

  const newDate = transactionDate || txn.transaction_date;
  const newCounterparty = counterparty !== undefined ? (counterparty || null) : txn.counterparty;
  const newNote = note !== undefined ? (note || null) : txn.note;
  const newPurpose = purpose !== undefined ? (VALID_PURPOSES.includes(purpose) ? purpose : txn.purpose) : txn.purpose;
  const newUnitPrice = unitPrice !== undefined ? (unitPrice !== null && unitPrice !== '' ? Number(unitPrice) : null) : txn.unit_price;
  const newRequisitionNo = requisitionNo !== undefined ? (requisitionNo || null) : txn.requisition_no;

  db.exec('BEGIN');
  try {
    if (changingBatch) {
      db.prepare('UPDATE batches SET quantity_remaining = ? WHERE id = ?').run(oldBatchNewRemaining, oldBatch.id);
      db.prepare('UPDATE batches SET quantity_remaining = ? WHERE id = ?').run(newBatchNewRemaining, newBatch.id);
    } else if (quantity !== undefined) {
      db.prepare('UPDATE batches SET quantity_remaining = ? WHERE id = ?').run(newBatchNewRemaining, oldBatch.id);
    }
    db.prepare(`
      UPDATE stock_transactions
      SET batch_id = ?, quantity = ?, transaction_date = ?, counterparty = ?, note = ?, purpose = ?, unit_price = ?, requisition_no = ?
      WHERE id = ?
    `).run(newBatchId, newQty, newDate, newCounterparty, newNote, newPurpose, newUnitPrice, newRequisitionNo, txn.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'แก้ไขรายการเบิกออกไม่สำเร็จ', detail: err.message });
  }

  res.json({ ok: true });
});

// Delete a mistaken issue-stock (OUT) record entirely, restoring its quantity back to the
// batch it was drawn from.
router.delete('/:id', requireAuth, requireEdit, (req, res) => {
  const txn = db.prepare('SELECT * FROM stock_transactions WHERE id = ?').get(req.params.id);
  if (!txn) return res.status(404).json({ error: 'ไม่พบรายการ' });
  if (txn.type !== 'OUT') return res.status(400).json({ error: 'ลบได้เฉพาะรายการเบิกออก' });

  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(txn.batch_id);

  db.exec('BEGIN');
  try {
    if (batch) {
      db.prepare('UPDATE batches SET quantity_remaining = ? WHERE id = ?').run(batch.quantity_remaining + txn.quantity, batch.id);
    }
    db.prepare('DELETE FROM stock_transactions WHERE id = ?').run(req.params.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'ลบรายการเบิกออกไม่สำเร็จ', detail: err.message });
  }

  res.json({ ok: true });
});

router.get('/export.csv', requireAuth, (req, res) => {
  const isAdmin = req.session.role === 'admin';
  const { where, params } = buildQuery(req.query);
  const rows = db.prepare(`
    SELECT t.transaction_date, t.type, t.purpose, p.sku_code, p.name AS product_name, b.batch_number, b.expiration_date,
           t.quantity, p.unit, t.counterparty, u.display_name AS user_name, t.note, t.unit_price, t.requisition_no
    FROM stock_transactions t
    JOIN products p ON p.id = t.product_id
    JOIN batches b ON b.id = t.batch_id
    LEFT JOIN users u ON u.id = t.user_id
    ${where}
    ORDER BY t.transaction_date DESC, t.created_at DESC
  `).all(...params);

  const TYPE_LABEL = { IN: 'รับเข้า', OUT: 'เบิกออก', ADJUST: 'ปรับปรุง' };
  const PURPOSE_LABEL = { sale: 'ขาย', trial: 'ทดลอง/ตัวอย่าง', claim: 'เคลม', gift: 'แถมให้ลูกค้า' };
  const header = ['วันที่', 'ประเภท', 'วัตถุประสงค์', 'รหัส SKU', 'สินค้า', 'ล็อต', 'วันหมดอายุ', 'จำนวน', 'หน่วย', 'ลูกค้า/ซัพพลายเออร์', 'ผู้ทำรายการ', 'เลขใบเบิก', 'หมายเหตุ'];
  if (isAdmin) header.push('ราคาขาย/หน่วย', 'มูลค่ารวม');
  const csvEscape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    const row = [
      r.transaction_date, TYPE_LABEL[r.type] || r.type, r.type === 'OUT' ? (PURPOSE_LABEL[r.purpose] || '') : '',
      r.sku_code, r.product_name, r.batch_number, r.expiration_date,
      r.quantity, r.unit, r.counterparty, r.user_name, r.requisition_no, r.note,
    ];
    if (isAdmin) row.push(r.unit_price ?? '', r.unit_price !== null && r.unit_price !== undefined ? r.unit_price * r.quantity : '');
    lines.push(row.map(csvEscape).join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
  res.send(`﻿${lines.join('\n')}`);
});

module.exports = router;
