const express = require('express');
const db = require('../db');
const { requireAuth, requireCreate, requireEdit } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUSES = ['pending', 'received', 'cancelled'];

router.get('/', requireAuth, (req, res) => {
  const clauses = [];
  const params = [];
  if (req.query.status) { clauses.push('po.status = ?'); params.push(req.query.status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT po.*, p.name AS product_name, p.sku_code, p.unit,
           u.display_name AS user_name
    FROM purchase_orders po
    JOIN products p ON p.id = po.product_id
    LEFT JOIN users u ON u.id = po.created_by
    ${where}
    ORDER BY (po.status = 'pending') DESC, (po.expected_date IS NULL) ASC, po.expected_date ASC, po.created_at DESC
  `).all(...params);
  res.json(rows);
});

router.get('/:id', requireAuth, (req, res) => {
  const po = db.prepare(`
    SELECT po.*, p.name AS product_name, p.sku_code, p.unit, p.brand
    FROM purchase_orders po
    JOIN products p ON p.id = po.product_id
    WHERE po.id = ?
  `).get(req.params.id);
  if (!po) return res.status(404).json({ error: 'ไม่พบรายการสั่งซื้อ' });
  res.json(po);
});

router.post('/', requireAuth, requireCreate, (req, res) => {
  const {
    productId, supplier, quantity, orderDate, expectedDate, note,
  } = req.body || {};

  if (!productId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'กรุณาระบุสินค้าและจำนวนที่มากกว่า 0' });
  }
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });

  const oDate = orderDate || new Date().toISOString().slice(0, 10);

  const info = db.prepare(`
    INSERT INTO purchase_orders (product_id, supplier, quantity, order_date, expected_date, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(productId, supplier || null, quantity, oDate, expectedDate || null, note || null, req.session.userId);

  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.patch('/:id', requireAuth, requireEdit, (req, res) => {
  const {
    status, expectedDate, note, batchId,
  } = req.body || {};
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'ไม่พบรายการสั่งซื้อ' });

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
  }

  db.prepare(`
    UPDATE purchase_orders
    SET status = ?, expected_date = ?, note = ?, batch_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    status !== undefined ? status : po.status,
    expectedDate !== undefined ? (expectedDate || null) : po.expected_date,
    note !== undefined ? (note || null) : po.note,
    batchId !== undefined ? (batchId || null) : po.batch_id,
    req.params.id
  );
  res.json({ ok: true });
});

module.exports = router;
