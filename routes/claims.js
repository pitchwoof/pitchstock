const express = require('express');
const db = require('../db');
const { requireAuth, requireCreate, requireEdit } = require('../middleware/auth');

const router = express.Router();

const VALID_TYPES = ['customer_reject', 'supplier_claim'];
const VALID_STATUSES = ['pending', 'in_progress', 'approved', 'rejected', 'resolved'];
const VALID_CATEGORIES = ['defective', 'expired', 'wrong_item', 'damaged_packaging', 'quality_issue', 'other'];

router.get('/', requireAuth, (req, res) => {
  const clauses = [];
  const params = [];
  if (req.query.type) { clauses.push('c.type = ?'); params.push(req.query.type); }
  if (req.query.status) { clauses.push('c.status = ?'); params.push(req.query.status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT c.*, p.name AS product_name, p.sku_code, p.unit,
           b.batch_number, b.expiration_date,
           u.display_name AS user_name
    FROM claims c
    JOIN products p ON p.id = c.product_id
    LEFT JOIN batches b ON b.id = c.batch_id
    LEFT JOIN users u ON u.id = c.created_by
    ${where}
    ORDER BY c.claim_date DESC, c.created_at DESC
  `).all(...params);
  res.json(rows);
});

router.get('/:id', requireAuth, (req, res) => {
  const claim = db.prepare(`
    SELECT c.*, p.name AS product_name, p.sku_code, p.unit,
           b.batch_number, b.expiration_date
    FROM claims c
    JOIN products p ON p.id = c.product_id
    LEFT JOIN batches b ON b.id = c.batch_id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!claim) return res.status(404).json({ error: 'ไม่พบรายการเคลม' });
  res.json(claim);
});

router.post('/', requireAuth, requireCreate, (req, res) => {
  const {
    type, productId, batchId, quantity, claimDate, counterparty,
    category, details,
  } = req.body || {};

  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'ประเภทไม่ถูกต้อง' });
  if (!productId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'กรุณาระบุสินค้าและจำนวนที่มากกว่า 0' });
  }
  if (!batchId) return res.status(400).json({ error: 'กรุณาระบุล็อตสินค้า' });
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });

  const batch = db.prepare('SELECT id FROM batches WHERE id = ? AND product_id = ?').get(batchId, productId);
  if (!batch) return res.status(404).json({ error: 'ไม่พบล็อตนี้สำหรับสินค้าดังกล่าว' });

  const cat = VALID_CATEGORIES.includes(category) ? category : 'other';
  const cDate = claimDate || new Date().toISOString().slice(0, 10);

  const info = db.prepare(`
    INSERT INTO claims (type, product_id, batch_id, quantity, claim_date, counterparty, category, details, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(type, productId, batchId || null, quantity, cDate, counterparty || null, cat, details || null, req.session.userId);

  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.patch('/:id', requireAuth, requireEdit, (req, res) => {
  const { status, resolutionNote, redirectedTo, redirectedQuantity } = req.body || {};
  const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(req.params.id);
  if (!claim) return res.status(404).json({ error: 'ไม่พบรายการเคลม' });

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
  }

  db.prepare(`
    UPDATE claims SET status = ?, resolution_note = ?, redirected_to = ?, redirected_quantity = ?, updated_at = datetime('now') WHERE id = ?
  `).run(
    status !== undefined ? status : claim.status,
    resolutionNote !== undefined ? resolutionNote : claim.resolution_note,
    redirectedTo !== undefined ? (redirectedTo || null) : claim.redirected_to,
    redirectedQuantity !== undefined ? (redirectedQuantity || null) : claim.redirected_quantity,
    req.params.id
  );
  res.json({ ok: true });
});

module.exports = router;
