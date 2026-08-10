const express = require('express');
const db = require('../db');
const {
  requireAuth, requireAdmin, requireCreate, requireEdit,
} = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const includeArchived = req.query.includeArchived === '1';
  const rows = includeArchived
    ? db.prepare('SELECT * FROM products ORDER BY brand, name').all()
    : db.prepare('SELECT * FROM products WHERE archived = 0 ORDER BY brand, name').all();
  res.json(rows);
});

router.post('/', requireAuth, requireCreate, (req, res) => {
  const { skuCode, name, brand, color, unit, reorderLevel, note, leadTimeDays, supplierId } = req.body || {};
  if (!skuCode || !name) return res.status(400).json({ error: 'กรุณากรอกรหัส SKU และชื่อสินค้า' });
  const existing = db.prepare('SELECT id FROM products WHERE sku_code = ?').get(skuCode);
  if (existing) return res.status(409).json({ error: 'มีรหัส SKU นี้อยู่แล้ว' });

  const info = db.prepare(`
    INSERT INTO products (sku_code, name, brand, color, unit, reorder_level, note, lead_time_days, supplier_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(skuCode, name, brand || null, color || null, unit || 'unit', reorderLevel || 0, note || null, leadTimeDays || 30, supplierId || null);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// Lightweight update for forecast inputs (lead time, reorder level) — open to any staff member,
// unlike the admin-only structural edit below, since this is operational info staff learn day to day.
router.patch('/:id/forecast-settings', requireAuth, requireEdit, (req, res) => {
  const { leadTimeDays, reorderLevel } = req.body || {};
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });

  db.prepare('UPDATE products SET lead_time_days = ?, reorder_level = ? WHERE id = ?').run(
    leadTimeDays !== undefined && leadTimeDays !== null ? Number(leadTimeDays) : product.lead_time_days,
    reorderLevel !== undefined && reorderLevel !== null ? Number(reorderLevel) : product.reorder_level,
    req.params.id
  );
  res.json({ ok: true });
});

router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const {
    skuCode, name, brand, color, unit, reorderLevel, note, archived,
  } = req.body || {};
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });

  const trimmedSku = skuCode !== undefined ? skuCode.trim() : null;
  if (trimmedSku && trimmedSku !== product.sku_code) {
    const existing = db.prepare('SELECT id FROM products WHERE sku_code = ? AND id != ?').get(trimmedSku, req.params.id);
    if (existing) return res.status(409).json({ error: 'มีรหัส SKU นี้อยู่แล้ว' });
  }

  db.prepare(`
    UPDATE products SET sku_code = ?, name = ?, brand = ?, color = ?, unit = ?, reorder_level = ?, note = ?, archived = ?
    WHERE id = ?
  `).run(
    trimmedSku || product.sku_code,
    name ?? product.name,
    brand ?? product.brand,
    color ?? product.color,
    unit ?? product.unit,
    reorderLevel ?? product.reorder_level,
    note ?? product.note,
    archived !== undefined ? (archived ? 1 : 0) : product.archived,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });
  try {
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  } catch (err) {
    if (String(err.message).includes('FOREIGN KEY')) {
      return res.status(409).json({
        error: 'ลบไม่ได้ เพราะสินค้านี้มีประวัติการรับเข้า/เบิกออก/เคลม/สั่งซื้ออยู่ในระบบ — ใช้ "เก็บถาวร" แทนเพื่อซ่อนจากรายการโดยไม่ลบประวัติ',
      });
    }
    return res.status(500).json({ error: 'ลบสินค้าไม่สำเร็จ', detail: err.message });
  }
  res.json({ ok: true });
});

module.exports = router;
