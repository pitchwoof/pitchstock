/*
 * Import a monthly stock-snapshot Excel file into the product/batch tables.
 *
 * Expected sheet format (as used by "stock uips <date>.xlsx" style files):
 *   Brand | ITEM ... | คงเหลือ (current qty) | <month usage columns...> | จำนวนหมึกหมดอายุ (expired qty)
 *
 * Usage:
 *   node seed/import_stock.js "<path to .xlsx>" [--wipe]
 *
 *   --wipe   Delete all existing products/batches/transactions first (user accounts are kept).
 *            Without --wipe, products are matched by generated SKU code and get an
 *            additional opening-stock batch added on top of whatever they already have.
 */
const path = require('node:path');
const XLSX = require('xlsx');
const db = require('../db');

const filePath = process.argv[2];
const wipe = process.argv.includes('--wipe');

if (!filePath) {
  console.error('Usage: node seed/import_stock.js "<path to .xlsx>" [--wipe]');
  process.exit(1);
}

function parseSnapshotDate(fname) {
  const m = fname.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return new Date().toISOString().slice(0, 10);
  let [, d, mo, y] = m.map(Number);
  if (y < 100) y += 2500; // 2-digit Buddhist Era year, e.g. 69 -> 2569
  const ceYear = y - 543;
  return `${ceYear}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function dayBefore(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function slug(name) {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const BRAND_RENAME = { General: 'UIPS' };
function brandPrefix(brand) {
  return brand === 'UIPS' ? '' : brand.slice(0, 3).toUpperCase();
}

const snapshotDate = parseSnapshotDate(path.basename(filePath));
const expiredAsOf = dayBefore(snapshotDate);

const wb = XLSX.readFile(filePath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

const header = rows[0].map((h) => String(h).trim());
const remainingIdx = header.findIndex((h) => h.includes('คงเหลือ'));
const expiredIdx = header.findIndex((h) => h.includes('หมดอายุ'));
if (remainingIdx === -1) {
  console.error('Could not find a "คงเหลือ" (remaining) column in the header row.');
  process.exit(1);
}
const monthStart = remainingIdx + 1;
const monthEnd = expiredIdx === -1 ? header.length : expiredIdx;

const dataRows = rows.slice(1).filter((r) => String(r[0]).trim() || String(r[1]).trim());

console.log(`Parsed ${dataRows.length} product rows. Snapshot date: ${snapshotDate}`);

if (wipe) {
  db.exec('BEGIN');
  db.exec('DELETE FROM stock_transactions');
  db.exec('DELETE FROM batches');
  db.exec('DELETE FROM products');
  db.exec('COMMIT');
  console.log('Wiped existing products, batches, and transactions (user accounts kept).');
}

const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
const importedBy = adminUser ? adminUser.id : null;

const findProduct = db.prepare('SELECT * FROM products WHERE sku_code = ?');
const insertProduct = db.prepare(`
  INSERT INTO products (sku_code, name, brand, unit, reorder_level, note)
  VALUES (?, ?, ?, 'ตลับ', ?, ?)
`);
const insertBatch = db.prepare(`
  INSERT INTO batches (product_id, batch_number, expiration_date, quantity_received, quantity_remaining, received_date, created_by, note)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertTxn = db.prepare(`
  INSERT INTO stock_transactions (type, batch_id, product_id, quantity, transaction_date, counterparty, user_id, note)
  VALUES ('IN', ?, ?, ?, ?, ?, ?, ?)
`);

let created = 0;
let skippedNoStock = 0;

for (const row of dataRows) {
  const rawBrand = String(row[0]).trim() || 'Other';
  const brand = BRAND_RENAME[rawBrand] || rawBrand;
  const name = String(row[1]).trim();
  if (!name) continue;

  const skuCode = brandPrefix(brand) + slug(name);
  const remaining = Number(row[remainingIdx]) || 0;
  const expired = expiredIdx === -1 ? 0 : Math.min(Number(row[expiredIdx]) || 0, remaining);
  const active = Math.max(0, remaining - expired);

  const monthValues = [];
  for (let i = monthStart; i < monthEnd; i++) {
    const v = row[i];
    if (v !== '' && v !== null && !Number.isNaN(Number(v))) monthValues.push(Number(v));
  }
  const avgMonthlyUsage = monthValues.length
    ? monthValues.reduce((a, b) => a + b, 0) / monthValues.length
    : 0;
  const reorderLevel = Math.round(avgMonthlyUsage);

  let product = findProduct.get(skuCode);
  if (!product) {
    const info = insertProduct.run(
      skuCode, name, brand, reorderLevel,
      `จุดสั่งซื้อถูกตั้งค่าอัตโนมัติจากค่าเฉลี่ยการใช้ประมาณ 1 เดือน (${reorderLevel}) จากประวัติการใช้ที่นำเข้า`
    );
    product = { id: Number(info.lastInsertRowid) };
    created++;
  }

  if (active > 0) {
    const bInfo = insertBatch.run(
      product.id, `OPENING-${snapshotDate}`, null, active, active,
      snapshotDate, importedBy,
      `นำเข้าสต็อกตั้งต้นจาก ${path.basename(filePath)} ยังไม่ทราบวันหมดอายุ — กรุณาอัปเดตเมื่อทราบ`
    );
    insertTxn.run(Number(bInfo.lastInsertRowid), product.id, active, snapshotDate, 'นำเข้าสต็อกตั้งต้น', importedBy, 'นำเข้ายอดคงเหลือตั้งต้น');
  }

  if (expired > 0) {
    const bInfo = insertBatch.run(
      product.id, `EXPIRED-${snapshotDate}`, expiredAsOf, expired, expired,
      snapshotDate, importedBy,
      `แจ้งว่าหมดอายุแล้วขณะนำเข้าข้อมูล (${snapshotDate}) ยังไม่ทราบวันหมดอายุที่แน่นอน`
    );
    insertTxn.run(Number(bInfo.lastInsertRowid), product.id, expired, snapshotDate, 'นำเข้าสต็อกตั้งต้น', importedBy, 'นำเข้ายอดคงเหลือตั้งต้น (หมดอายุแล้ว)');
  }

  if (active === 0 && expired === 0) skippedNoStock++;
}

console.log(`Done. ${created} new products created. ${skippedNoStock} products have zero current stock.`);
