const express = require('express');
const db = require('../db');
const { requireAuth, requireEdit } = require('../middleware/auth');

const router = express.Router();

const USAGE_LOOKBACK_DAYS = 90; // same window as the reorder forecast's "actual recent" usage

// Per-product, per-customer usage worksheet: actual usage (from real OUT transactions) merged
// with any manual overrides/predicted-new-customer rows staff have entered, so they can see
// exactly which customers make up a product's demand before adjusting its safety stock.
router.get('/:productId', requireAuth, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.productId);
  if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });

  const lookbackStart = new Date();
  lookbackStart.setHours(0, 0, 0, 0);
  lookbackStart.setDate(lookbackStart.getDate() - USAGE_LOOKBACK_DAYS);
  const lookbackStartStr = lookbackStart.toISOString().slice(0, 10);

  // Trial/sample handouts excluded, same as the reorder forecast — not recurring demand.
  const actualRows = db.prepare(`
    SELECT counterparty AS customer_name, SUM(quantity) AS qty
    FROM stock_transactions
    WHERE type = 'OUT' AND product_id = ? AND transaction_date >= ?
      AND COALESCE(purpose, 'sale') != 'trial'
      AND counterparty IS NOT NULL AND counterparty != ''
    GROUP BY counterparty
  `).all(req.params.productId, lookbackStartStr);

  const estimateRows = db.prepare('SELECT * FROM demand_estimates WHERE product_id = ?').all(req.params.productId);
  const estimateByCustomer = new Map(estimateRows.map((e) => [e.customer_name, e]));
  const assignedToByCustomer = new Map(
    db.prepare('SELECT name, assigned_to FROM customers').all().map((c) => [c.name, c.assigned_to])
  );

  const names = new Set([...actualRows.map((r) => r.customer_name), ...estimateRows.map((e) => e.customer_name)]);

  const rows = [...names].map((customerName) => {
    const actual = actualRows.find((r) => r.customer_name === customerName);
    const actualMonthlyUsage = actual ? (actual.qty / USAGE_LOOKBACK_DAYS) * 30 : 0;
    const est = estimateByCustomer.get(customerName);
    const overrideMonthlyUsage = est ? est.predicted_monthly_usage : null;
    const effectiveMonthlyUsage = overrideMonthlyUsage != null ? overrideMonthlyUsage : actualMonthlyUsage;
    return {
      estimateId: est ? est.id : null,
      customerName,
      assignedTo: assignedToByCustomer.get(customerName) || null,
      actualMonthlyUsage,
      overrideMonthlyUsage,
      effectiveMonthlyUsage,
      note: est ? est.note : null,
    };
  }).sort((a, b) => b.effectiveMonthlyUsage - a.effectiveMonthlyUsage);

  const totalMonthlyUsage = rows.reduce((s, r) => s + r.effectiveMonthlyUsage, 0);

  res.json({
    product: {
      id: product.id, name: product.name, skuCode: product.sku_code, unit: product.unit, reorderLevel: product.reorder_level,
    },
    rows,
    totalMonthlyUsage,
  });
});

// Upsert one customer's predicted/override monthly usage for a product — covers both
// "adjust an existing customer's usage" and "add a new customer with no history yet".
router.put('/:productId/customer', requireAuth, requireEdit, (req, res) => {
  const { customerName, predictedMonthlyUsage, note } = req.body || {};
  const name = (customerName || '').trim();
  if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อลูกค้า' });
  const qty = Number(predictedMonthlyUsage);
  if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ error: 'จำนวนต้องเป็นตัวเลขไม่ติดลบ' });

  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.productId);
  if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });

  const existing = db.prepare('SELECT id FROM demand_estimates WHERE product_id = ? AND customer_name = ?')
    .get(req.params.productId, name);
  if (existing) {
    db.prepare(`
      UPDATE demand_estimates SET predicted_monthly_usage = ?, note = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(qty, note || null, existing.id);
    return res.json({ id: existing.id });
  }
  const info = db.prepare(`
    INSERT INTO demand_estimates (product_id, customer_name, predicted_monthly_usage, note, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.productId, name, qty, note || null, req.session.userId);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// Clears an override (reverting that customer back to their actual computed usage) or removes
// a predicted-new-customer row entirely.
router.delete('/estimate/:id', requireAuth, requireEdit, (req, res) => {
  const existing = db.prepare('SELECT id FROM demand_estimates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  db.prepare('DELETE FROM demand_estimates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
