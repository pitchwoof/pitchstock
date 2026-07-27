const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const CRITICAL_DAYS = 30;
const WARNING_DAYS = 90;

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function expiryStatus(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  if (days <= CRITICAL_DAYS) return 'critical';
  if (days <= WARNING_DAYS) return 'warning';
  return 'ok';
}

// Full inventory: every active product with its batches (remaining > 0) sorted FEFO
router.get('/', requireAuth, (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE archived = 0 ORDER BY brand, name').all();
  const batchStmt = db.prepare(`
    SELECT * FROM batches
    WHERE product_id = ? AND quantity_remaining > 0
    ORDER BY (expiration_date IS NULL) ASC, expiration_date ASC, received_date ASC
  `);

  const result = products.map((p) => {
    const batches = batchStmt.all(p.id).map((b) => ({
      id: b.id,
      batchNumber: b.batch_number,
      expirationDate: b.expiration_date,
      quantityRemaining: b.quantity_remaining,
      quantityReceived: b.quantity_received,
      supplier: b.supplier,
      receivedDate: b.received_date,
      unitCost: b.unit_cost,
      note: b.note,
      daysUntilExpiry: daysUntil(b.expiration_date),
      status: expiryStatus(b.expiration_date),
    }));
    const totalQty = batches.reduce((sum, b) => sum + b.quantityRemaining, 0);
    const nearestExpiry = batches.length ? batches[0].expirationDate : null;
    const worstStatus = batches.reduce((worst, b) => {
      const order = { expired: 0, critical: 1, warning: 2, none: 3, ok: 4 };
      return order[b.status] < order[worst] ? b.status : worst;
    }, 'ok');

    return {
      id: p.id,
      skuCode: p.sku_code,
      name: p.name,
      brand: p.brand,
      color: p.color,
      unit: p.unit,
      reorderLevel: p.reorder_level,
      note: p.note,
      totalQuantity: totalQty,
      lowStock: totalQty <= p.reorder_level,
      nearestExpiry,
      expiryStatus: batches.length ? worstStatus : 'none',
      batches,
    };
  });

  res.json(result);
});

// Dashboard summary
router.get('/dashboard', requireAuth, (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE archived = 0').all();
  const batchStmt = db.prepare(`
    SELECT * FROM batches WHERE product_id = ? AND quantity_remaining > 0
  `);

  let lowStockCount = 0;
  let expiredCount = 0;
  let expiringSoonCount = 0;
  const alerts = [];

  for (const p of products) {
    const batches = batchStmt.all(p.id);
    const totalQty = batches.reduce((s, b) => s + b.quantity_remaining, 0);
    if (totalQty <= p.reorder_level) {
      lowStockCount++;
      alerts.push({ type: 'low_stock', product: p.name, skuCode: p.sku_code, detail: `เหลือ ${totalQty} ${p.unit} (จุดสั่งซื้อที่ ${p.reorder_level})` });
    }
    for (const b of batches) {
      const status = expiryStatus(b.expiration_date);
      if (status === 'expired') {
        expiredCount++;
        alerts.push({ type: 'expired', product: p.name, skuCode: p.sku_code, detail: `ล็อต ${b.batch_number || b.id} หมดอายุเมื่อ ${b.expiration_date} เหลือ ${b.quantity_remaining} ${p.unit}` });
      } else if (status === 'critical') {
        expiringSoonCount++;
        alerts.push({ type: 'expiring_soon', product: p.name, skuCode: p.sku_code, detail: `ล็อต ${b.batch_number || b.id} จะหมดอายุ ${b.expiration_date} (อีก ${daysUntil(b.expiration_date)} วัน) เหลือ ${b.quantity_remaining} ${p.unit}` });
      }
    }
  }

  const recentTransactions = db.prepare(`
    SELECT t.*, p.name AS product_name, p.sku_code, u.display_name AS user_name
    FROM stock_transactions t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC
    LIMIT 10
  `).all();

  res.json({
    totalSkus: products.length,
    lowStockCount,
    expiredCount,
    expiringSoonCount,
    alerts,
    recentTransactions,
  });
});

// Total outflow quantity per calendar month for the last N months (zero-filled), for the dashboard trend chart
router.get('/outflow-trend', requireAuth, (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 36);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
  const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;

  const productId = req.query.productId ? Number(req.query.productId) : null;
  const rows = productId
    ? db.prepare(`
        SELECT strftime('%Y-%m', transaction_date) AS month, SUM(quantity) AS quantity
        FROM stock_transactions
        WHERE type = 'OUT' AND transaction_date >= ? AND product_id = ?
        GROUP BY month
      `).all(startStr, productId)
    : db.prepare(`
        SELECT strftime('%Y-%m', transaction_date) AS month, SUM(quantity) AS quantity
        FROM stock_transactions
        WHERE type = 'OUT' AND transaction_date >= ?
        GROUP BY month
      `).all(startStr);

  const byMonth = new Map(rows.map((r) => [r.month, r.quantity]));
  const series = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    series.push({ month: key, quantity: byMonth.get(key) || 0 });
  }

  let unit = null;
  if (productId) {
    const product = db.prepare('SELECT unit FROM products WHERE id = ?').get(productId);
    unit = product ? product.unit : null;
  }

  res.json({ months, series, unit });
});

// ---------- Reorder forecast ----------
// Fixed planning assumptions (not per-product — apply the same monthly ordering cadence to everyone):
const REVIEW_PERIOD_DAYS = 30; // how often orders are placed (monthly)
const SAFETY_BUFFER_DAYS = 7;  // extra cushion on top of lead time + review period
const USAGE_LOOKBACK_DAYS = 90; // window for computing "actual recent" usage from real transactions

router.get('/reorder-forecast', requireAuth, (req, res) => {
  // Brand doubles as the supplier for this business (each ink brand is carried by one distributor),
  // so the forecast groups/filters by product.brand rather than a separate supplier link.
  const products = db.prepare(`
    SELECT p.* FROM products p WHERE p.archived = 0
  `).all();

  const batchStmt = db.prepare(`
    SELECT * FROM batches
    WHERE product_id = ? AND quantity_remaining > 0
    ORDER BY (expiration_date IS NULL) ASC, expiration_date ASC, received_date ASC
  `);

  const lookbackStart = new Date();
  lookbackStart.setHours(0, 0, 0, 0);
  lookbackStart.setDate(lookbackStart.getDate() - USAGE_LOOKBACK_DAYS);
  const lookbackStartStr = lookbackStart.toISOString().slice(0, 10);

  // Trial/sample handouts are excluded here — they're not recurring demand and would
  // otherwise inflate the suggested reorder quantity.
  const recentUsageRows = db.prepare(`
    SELECT product_id, SUM(quantity) AS qty
    FROM stock_transactions
    WHERE type = 'OUT' AND transaction_date >= ? AND COALESCE(purpose, 'sale') != 'trial'
    GROUP BY product_id
  `).all(lookbackStartStr);
  const recentUsageByProduct = new Map(recentUsageRows.map((r) => [r.product_id, r.qty]));

  const results = products.map((p) => {
    const recentUsage = recentUsageByProduct.get(p.id) || 0;
    let avgDailyUsage;
    let usageSource;
    if (recentUsage > 0) {
      avgDailyUsage = recentUsage / USAGE_LOOKBACK_DAYS;
      usageSource = 'recent';
    } else {
      avgDailyUsage = p.reorder_level / REVIEW_PERIOD_DAYS;
      usageSource = 'estimated';
    }

    const batches = batchStmt.all(p.id);
    const onHandTotal = batches.reduce((s, b) => s + b.quantity_remaining, 0);

    let usableStock = 0;
    let projectedWaste = 0;
    let daysOfCover = null;

    if (avgDailyUsage <= 0) {
      // No usage signal at all — can't project consumption. Just split by whether it's already expired.
      for (const b of batches) {
        const days = daysUntil(b.expiration_date);
        if (days !== null && days < 0) projectedWaste += b.quantity_remaining;
        else usableStock += b.quantity_remaining;
      }
    } else {
      let cumulativeDaysNeeded = 0;
      for (const b of batches) {
        const expiryDays = daysUntil(b.expiration_date);
        if (expiryDays !== null && expiryDays < 0) {
          projectedWaste += b.quantity_remaining;
          continue;
        }
        const batchDays = b.quantity_remaining / avgDailyUsage;
        const availableWindow = expiryDays === null ? Infinity : expiryDays - cumulativeDaysNeeded;
        if (availableWindow <= 0) {
          projectedWaste += b.quantity_remaining;
        } else if (availableWindow >= batchDays) {
          usableStock += b.quantity_remaining;
          cumulativeDaysNeeded += batchDays;
        } else {
          const consumable = availableWindow * avgDailyUsage;
          usableStock += consumable;
          projectedWaste += b.quantity_remaining - consumable;
          cumulativeDaysNeeded = expiryDays;
        }
      }
      daysOfCover = cumulativeDaysNeeded;
    }

    const leadTimeDays = p.lead_time_days || 30;
    const targetCoverDays = leadTimeDays + REVIEW_PERIOD_DAYS + SAFETY_BUFFER_DAYS;
    const targetStockQty = avgDailyUsage * targetCoverDays;
    const suggestedOrderQty = avgDailyUsage > 0 ? Math.max(0, targetStockQty - usableStock) : 0;

    let status;
    if (avgDailyUsage <= 0) status = 'no_usage_data';
    else if (daysOfCover < leadTimeDays) status = 'urgent';
    else if (suggestedOrderQty > 0) status = 'order_soon';
    else status = 'ok';

    return {
      id: p.id,
      skuCode: p.sku_code,
      name: p.name,
      brand: p.brand,
      unit: p.unit,
      supplierName: p.brand,
      leadTimeDays,
      avgMonthlyUsage: avgDailyUsage * 30,
      usageSource,
      onHandTotal,
      usableStock,
      projectedWaste,
      daysOfCover,
      suggestedOrderQty,
      status,
    };
  });

  const statusOrder = { urgent: 0, order_soon: 1, no_usage_data: 2, ok: 3 };
  results.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name));

  const summary = {
    urgentCount: results.filter((r) => r.status === 'urgent').length,
    orderSoonCount: results.filter((r) => r.status === 'order_soon').length,
    wasteRiskCount: results.filter((r) => r.projectedWaste > 0).length,
  };

  res.json({
    reviewPeriodDays: REVIEW_PERIOD_DAYS,
    safetyBufferDays: SAFETY_BUFFER_DAYS,
    summary,
    products: results,
  });
});

module.exports = router;
