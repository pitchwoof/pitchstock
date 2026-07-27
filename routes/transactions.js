const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

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
  res.json(rows);
});

router.get('/export.csv', requireAuth, (req, res) => {
  const { where, params } = buildQuery(req.query);
  const rows = db.prepare(`
    SELECT t.transaction_date, t.type, t.purpose, p.sku_code, p.name AS product_name, b.batch_number, b.expiration_date,
           t.quantity, p.unit, t.counterparty, u.display_name AS user_name, t.note
    FROM stock_transactions t
    JOIN products p ON p.id = t.product_id
    JOIN batches b ON b.id = t.batch_id
    LEFT JOIN users u ON u.id = t.user_id
    ${where}
    ORDER BY t.transaction_date DESC, t.created_at DESC
  `).all(...params);

  const TYPE_LABEL = { IN: 'รับเข้า', OUT: 'เบิกออก', ADJUST: 'ปรับปรุง' };
  const PURPOSE_LABEL = { sale: 'ขาย', trial: 'ทดลอง/ตัวอย่าง' };
  const header = ['วันที่', 'ประเภท', 'วัตถุประสงค์', 'รหัส SKU', 'สินค้า', 'ล็อต', 'วันหมดอายุ', 'จำนวน', 'หน่วย', 'ลูกค้า/ซัพพลายเออร์', 'ผู้ทำรายการ', 'หมายเหตุ'];
  const csvEscape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.transaction_date, TYPE_LABEL[r.type] || r.type, r.type === 'OUT' ? (PURPOSE_LABEL[r.purpose] || '') : '',
      r.sku_code, r.product_name, r.batch_number, r.expiration_date,
      r.quantity, r.unit, r.counterparty, r.user_name, r.note,
    ].map(csvEscape).join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
  res.send(`﻿${lines.join('\n')}`);
});

module.exports = router;
