const express = require('express');
const db = require('../db');
const { requireAuth, requireCreate } = require('../middleware/auth');

const router = express.Router();

// Preview which batches would be used to fulfil a requested quantity (FEFO order)
router.get('/preview', requireAuth, (req, res) => {
  const productId = req.query.productId;
  const quantity = Number(req.query.quantity);
  if (!productId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'กรุณาระบุสินค้าและจำนวนที่มากกว่า 0' });
  }

  const batches = db.prepare(`
    SELECT * FROM batches
    WHERE product_id = ? AND quantity_remaining > 0
    ORDER BY (expiration_date IS NULL) ASC, expiration_date ASC, received_date ASC
  `).all(productId);

  let remaining = quantity;
  const allocation = [];
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantity_remaining, remaining);
    allocation.push({
      batchId: b.id,
      batchNumber: b.batch_number,
      expirationDate: b.expiration_date,
      available: b.quantity_remaining,
      allocated: take,
    });
    remaining -= take;
  }

  const totalAvailable = batches.reduce((s, b) => s + b.quantity_remaining, 0);
  res.json({
    requested: quantity,
    totalAvailable,
    fulfillable: remaining <= 0,
    shortfall: Math.max(0, remaining),
    allocation,
  });
});

// Record outflow (sale to customer, or a trial/sample handout). Auto-allocates FEFO across
// batches unless batchId is given.
const VALID_PURPOSES = ['sale', 'trial', 'claim', 'gift'];

router.post('/', requireAuth, requireCreate, (req, res) => {
  const { productId, quantity, customer, transactionDate, note, batchId, purpose, unitPrice, requisitionNo } = req.body || {};
  const qty = Number(quantity);
  const txnPurpose = VALID_PURPOSES.includes(purpose) ? purpose : 'sale';
  const price = unitPrice !== undefined && unitPrice !== null && unitPrice !== '' ? Number(unitPrice) : null;
  if (!productId || !qty || qty <= 0) {
    return res.status(400).json({ error: 'กรุณาระบุสินค้าและจำนวนที่มากกว่า 0' });
  }
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });

  const tDate = transactionDate || new Date().toISOString().slice(0, 10);
  const insertTxn = db.prepare(`
    INSERT INTO stock_transactions (type, batch_id, product_id, quantity, transaction_date, counterparty, user_id, note, purpose, unit_price, requisition_no)
    VALUES ('OUT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateBatch = db.prepare('UPDATE batches SET quantity_remaining = ? WHERE id = ?');

  if (batchId) {
    // Manual override: deduct from one specific batch
    const batch = db.prepare('SELECT * FROM batches WHERE id = ? AND product_id = ?').get(batchId, productId);
    if (!batch) return res.status(404).json({ error: 'ไม่พบล็อตนี้สำหรับสินค้าดังกล่าว' });
    if (batch.quantity_remaining < qty) {
      return res.status(400).json({ error: `ล็อตนี้เหลือเพียง ${batch.quantity_remaining} ${product.unit}` });
    }
    db.exec('BEGIN');
    try {
      updateBatch.run(batch.quantity_remaining - qty, batch.id);
      insertTxn.run(batch.id, productId, qty, tDate, customer || null, req.session.userId, note || null, txnPurpose, price, requisitionNo || null);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      return res.status(500).json({ error: 'บันทึกการเบิกออกไม่สำเร็จ', detail: err.message });
    }
    return res.status(201).json({ allocation: [{ batchId: batch.id, allocated: qty }] });
  }

  // FEFO auto-allocation across batches
  const batches = db.prepare(`
    SELECT * FROM batches
    WHERE product_id = ? AND quantity_remaining > 0
    ORDER BY (expiration_date IS NULL) ASC, expiration_date ASC, received_date ASC
  `).all(productId);

  const totalAvailable = batches.reduce((s, b) => s + b.quantity_remaining, 0);
  if (totalAvailable < qty) {
    return res.status(400).json({ error: `สต็อกไม่เพียงพอ: มีเพียง ${totalAvailable} ${product.unit} ในทุกล็อตรวมกัน` });
  }

  let remaining = qty;
  const allocation = [];
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantity_remaining, remaining);
    allocation.push({ batch: b, take });
    remaining -= take;
  }

  db.exec('BEGIN');
  try {
    for (const { batch, take } of allocation) {
      updateBatch.run(batch.quantity_remaining - take, batch.id);
      insertTxn.run(batch.id, productId, take, tDate, customer || null, req.session.userId, note || null, txnPurpose, price, requisitionNo || null);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'บันทึกการเบิกออกไม่สำเร็จ', detail: err.message });
  }

  res.status(201).json({
    allocation: allocation.map((a) => ({ batchId: a.batch.id, batchNumber: a.batch.batch_number, allocated: a.take })),
  });
});

// Convert stock from one product (SKU) into another — e.g. relabelling ink into a different
// number before shipping. Deducts from the source (FEFO, or a specific batch if given) and
// creates a brand-new batch under the destination product.
router.post('/convert', requireAuth, requireCreate, (req, res) => {
  const {
    sourceProductId, sourceBatchId, quantity,
    destProductId, destExpirationDate, destBatchNumber,
    conversionDate, note, customer,
  } = req.body || {};
  const qty = Number(quantity);

  if (!sourceProductId || !destProductId || !qty || qty <= 0) {
    return res.status(400).json({ error: 'กรุณาระบุสินค้าต้นทาง ปลายทาง และจำนวนที่มากกว่า 0' });
  }
  const sameProduct = Number(sourceProductId) === Number(destProductId);
  const sourceProduct = db.prepare('SELECT * FROM products WHERE id = ?').get(sourceProductId);
  const destProduct = db.prepare('SELECT * FROM products WHERE id = ?').get(destProductId);
  if (!sourceProduct) return res.status(404).json({ error: 'ไม่พบสินค้าต้นทาง' });
  if (!destProduct) return res.status(404).json({ error: 'ไม่พบสินค้าปลายทาง' });

  const cDate = conversionDate || new Date().toISOString().slice(0, 10);
  const updateBatch = db.prepare('UPDATE batches SET quantity_remaining = ? WHERE id = ?');
  const insertOutTxn = db.prepare(`
    INSERT INTO stock_transactions (type, batch_id, product_id, quantity, transaction_date, counterparty, user_id, note)
    VALUES ('OUT', ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBatch = db.prepare(`
    INSERT INTO batches (product_id, batch_number, expiration_date, quantity_received, quantity_remaining, received_date, created_by, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertInTxn = db.prepare(`
    INSERT INTO stock_transactions (type, batch_id, product_id, quantity, transaction_date, counterparty, user_id, note)
    VALUES ('IN', ?, ?, ?, ?, ?, ?, ?)
  `);

  let sourceAllocation;
  let inheritedExpiration = destExpirationDate || null;

  if (sourceBatchId) {
    const batch = db.prepare('SELECT * FROM batches WHERE id = ? AND product_id = ?').get(sourceBatchId, sourceProductId);
    if (!batch) return res.status(404).json({ error: 'ไม่พบล็อตนี้สำหรับสินค้าต้นทาง' });
    if (batch.quantity_remaining < qty) {
      return res.status(400).json({ error: `ล็อตนี้เหลือเพียง ${batch.quantity_remaining} ${sourceProduct.unit}` });
    }
    sourceAllocation = [{ batch, take: qty }];
    if (!inheritedExpiration) inheritedExpiration = batch.expiration_date;
  } else {
    const batches = db.prepare(`
      SELECT * FROM batches
      WHERE product_id = ? AND quantity_remaining > 0
      ORDER BY (expiration_date IS NULL) ASC, expiration_date ASC, received_date ASC
    `).all(sourceProductId);
    const totalAvailable = batches.reduce((s, b) => s + b.quantity_remaining, 0);
    if (totalAvailable < qty) {
      return res.status(400).json({ error: `สต็อกต้นทางไม่เพียงพอ: มีเพียง ${totalAvailable} ${sourceProduct.unit}` });
    }
    let remaining = qty;
    sourceAllocation = [];
    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(b.quantity_remaining, remaining);
      sourceAllocation.push({ batch: b, take });
      remaining -= take;
    }
    if (!inheritedExpiration) inheritedExpiration = sourceAllocation[0].batch.expiration_date;
  }

  let newBatchId;
  db.exec('BEGIN');
  try {
    const outCounterparty = sameProduct
      ? (customer ? `${customer} (ย้ายล็อต/แก้ไขวันหมดอายุ)` : 'ย้ายล็อต/แก้ไขวันหมดอายุ')
      : (customer ? `${customer} (แปลงเป็น ${destProduct.name})` : `แปลงเป็น ${destProduct.name}`);
    const inCounterparty = sameProduct
      ? (customer ? `${customer} (ย้ายล็อต/แก้ไขวันหมดอายุ)` : 'ย้ายล็อต/แก้ไขวันหมดอายุ')
      : (customer ? `${customer} (แปลงจาก ${sourceProduct.name})` : `แปลงจาก ${sourceProduct.name}`);
    for (const { batch, take } of sourceAllocation) {
      updateBatch.run(batch.quantity_remaining - take, batch.id);
      insertOutTxn.run(batch.id, sourceProductId, take, cDate, outCounterparty, req.session.userId, note || null);
    }
    const bInfo = insertBatch.run(
      destProductId, destBatchNumber || `CONV-${sourceProduct.sku_code}-${cDate}`, inheritedExpiration,
      qty, qty, cDate, req.session.userId,
      note || (sameProduct
        ? `ย้ายล็อตจาก ${sourceProduct.name} (${sourceProduct.sku_code}) — แก้ไขวันหมดอายุ`
        : `แปลงจาก ${sourceProduct.name} (${sourceProduct.sku_code})`)
    );
    newBatchId = Number(bInfo.lastInsertRowid);
    insertInTxn.run(newBatchId, destProductId, qty, cDate, inCounterparty, req.session.userId, note || null);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'แปลงหมึกไม่สำเร็จ', detail: err.message });
  }

  res.status(201).json({
    sourceAllocation: sourceAllocation.map((a) => ({ batchId: a.batch.id, batchNumber: a.batch.batch_number, taken: a.take })),
    newBatchId,
  });
});

module.exports = router;
