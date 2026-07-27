/*
 * Import customers (+ their usual salesperson) from a monthly "SALE REPORT" workbook,
 * one sheet per month, each row a sold line-item referencing a customer and salesperson.
 *
 * Usage:
 *   node seed/import_customers.js "<path to .xlsx>"
 *
 * For each sheet, finds the header row by locating the "รายชื่อลูกค้า" column, then reads
 * every data row's customer name + salesperson. Obvious spelling/spacing variants of the
 * same company (collected across months) are merged via NAME_ALIASES below. The salesperson
 * assigned to each customer is whichever name appears most often for that customer; "ส่วนกลาง"
 * (head office, not a person) and blank entries are never picked as the assigned salesperson.
 *
 * Some workbooks recovered by Excel declare a bogus huge used-range, which blows up naive
 * full-sheet parsing — sheetRows caps how many rows SheetJS materializes per sheet.
 */
const path = require('node:path');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const db = require('../db');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node seed/import_customers.js "<path to .xlsx>"');
  process.exit(1);
}

const SHEET_ROW_CAP = 800;

// Canonical name -> known misspelled/misformatted variants seen across months.
// Only merges spelling/spacing/typo variants confirmed to be the same company+salesperson;
// distinct branch/plant suffixes (e.g. different factory towns) are deliberately kept separate.
const NAME_ALIASES = {
  'The Medicpharma Co.,Ltd.': ['The Medicpharma co.,Ltd.'],
  'บจก.คอสเมดิวา': ['บจก. คอสเมดิวา'],
  'บจก.แบ็กส์ แอนด์ โกลฟ์': ['บจก. แบ็กส์ แอนดื โกลฟ์', 'บจก.แบ็กส์ แอนด์ โกล์ฟ'],
  'บจก.กระเบื้องกระดาษไทย (โรงงานสระบุรี)': ['บจก.กระเบื้องกระดาษไทย โรงงานสระบุรี'],
  'บจก.ต้ายี่ห์ เคนมอส ออโต้พาร์ท (ประเทศไทย)': ['บจก.ต้ายี่ห์ เคนมอส ออโต้พาร์ท'],
  'บจก.ที.พี.ดรัก แลบบอราทอรี่ส์ (1969)': ['บจก.ที.พี.ดรัก แลบบอราทอรี่ส์'],
  'บจก.ไทยไดมอนด์ อินดัสตรีส์': ['บจก.ไทยไดมอนด์ อินดัสตรี้ส์'],
  'บจก.ไทยเวอลด์ อิมปอร์ตเอ็กซปอร์ต': ['บจก.ไทยเวอลด์ อิมปอร์ตเอ๊กซปอร์ต'],
  'บจก.มอนเด นิสชิน (ประเทศไทย)': ['บจก.มอนเด นิสซิน (ประเทศไทย)'],
  'บจก.มอนเดลิช (ประเทศไทย)': ['บจก.มอนเดลีช (ประเทศไทย)'],
  'บจก.มี้ด จอห์นสัน นิวทริชัน (ประเทศไทย)': ['บจก.มี๊ด จอห์นสัน นิวทริชัน (ประเทศไทย)'],
  'บจก.ไลท์แปรรูปอาหารทะเล': ['บจก.ไล้ท์แปรรูปอาหารทะเล'],
  'บจก.วี เอ็น ที อินเตอร์พริ้นท์': ['บจก.วีเอ็น ที อินเตอร์พริ้นท์', 'บจก.วีเอ็นที อินเตอร์พริ้นท์'],
  'บจก.สยามอุตสาหกรรมยิปซั่ม (สระบุรี)': ['บจก.สยามอุตสาหกรรมยิปซัม (สระบุรี)'],
  'บจก.เอส.ที.ดี.แคลิเปอร์เบรค': ['บจก.เอส.ที.ดี.แคลิเปร์เบรค'],
  'บจก.เอสทีดับบลิว กรุ๊ป': ['บจก.เอสทีดับบลิวกรุ๊ป'],
  'บจก.เอสซีจี รูฟฟิ่ง': ['บจก.เอสซีจี รุฟฟิ่ง'],
  'บมจ.ซีพีเอฟ (ประเทศไทย) โคราช': ['บมจ.ซีพีเอฟ (ประเทศไทย)โคราช'],
  'บมจ.ซีพีเอฟ (ประเทศไทย) บางนา': ['บมจ.ซีพีเอฟ (ประเทศไทย)บางนา'],
  'บมจ.ไทยยูเนี่ยน กรุ๊ป': ['บมจ.ไทยยูเนี่ยน กรีป'],
  'บมจ.เบทาโกร ลพบุรี': ['บจก.เบทาโกร ลพบุรี'],
  'บมจ.เบทาโกร ลำพูน': ['บจก.เบทาโกร ลำพูน'],
  'บมจ.เบทาโกร สงขลา': ['บมจ.เบทาดกร สงขลา'],
};

const SALESPERSON_ALIASES = { 'อริสรา': 'อริศรา' };
const NON_PERSON_SALES_LABELS = new Set(['ส่วนกลาง', '']);

const nameLookup = new Map();
for (const [canonical, variants] of Object.entries(NAME_ALIASES)) {
  nameLookup.set(canonical, canonical);
  for (const v of variants) nameLookup.set(v, canonical);
}
function canonicalCustomerName(raw) {
  return nameLookup.get(raw) || raw;
}
function canonicalSalesperson(raw) {
  return SALESPERSON_ALIASES[raw] || raw;
}

const wb = XLSX.readFile(filePath, { sheetRows: SHEET_ROW_CAP, cellFormula: false, cellHTML: false, cellStyles: false });

const customers = new Map(); // canonical name -> Map(salesperson -> count)

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let headerIdx = -1;
  let custCol = -1;
  let salesCol = -1;
  for (let i = 0; i < rows.length; i++) {
    const idx = rows[i].findIndex((c) => String(c).includes('รายชื่อลูกค้า'));
    if (idx !== -1) {
      headerIdx = i;
      custCol = idx;
      salesCol = rows[i].findIndex((c) => String(c).includes('พนักงานขาย'));
      break;
    }
  }
  if (headerIdx === -1) {
    console.log(`[skip] ${sheetName}: no header row found`);
    continue;
  }

  let dataStart = -1;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    if (String(rows[i][custCol]).trim() !== '') { dataStart = i; break; }
  }
  if (dataStart === -1) {
    console.log(`[skip] ${sheetName}: no data rows found`);
    continue;
  }

  let rowCount = 0;
  for (let i = dataStart; i < rows.length; i++) {
    const rawName = String(rows[i][custCol]).trim();
    if (!rawName) continue;
    const name = canonicalCustomerName(rawName);
    const sales = canonicalSalesperson(salesCol !== -1 ? String(rows[i][salesCol]).trim() : '');
    if (!customers.has(name)) customers.set(name, new Map());
    const spMap = customers.get(name);
    spMap.set(sales, (spMap.get(sales) || 0) + 1);
    rowCount++;
  }
  console.log(`${sheetName}: ${rowCount} data rows`);
}

console.log(`\nParsed ${customers.size} unique customers (after merging known spelling variants).`);

// Create staff accounts for every real salesperson name found (skipping non-person labels).
const salespeopleFound = new Set();
for (const spMap of customers.values()) {
  for (const sp of spMap.keys()) {
    if (!NON_PERSON_SALES_LABELS.has(sp)) salespeopleFound.add(sp);
  }
}

const findUserByName = db.prepare('SELECT id FROM users WHERE display_name = ?');
const findUsername = db.prepare('SELECT id FROM users WHERE username = ?');
const insertUser = db.prepare(`
  INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'staff')
`);

const userIdByName = new Map();
const defaultHash = bcrypt.hashSync('changeme123', 10);
let usersCreated = 0;
for (const name of salespeopleFound) {
  const existing = findUserByName.get(name);
  if (existing) { userIdByName.set(name, existing.id); continue; }

  let username = name.replace(/[^a-zA-Zก-๙]/g, '').toLowerCase() || `staff${Date.now()}`;
  if (findUsername.get(username)) username = `${username}${Math.floor(Math.random() * 1000)}`;
  const info = insertUser.run(username, defaultHash, name);
  userIdByName.set(name, Number(info.lastInsertRowid));
  usersCreated++;
}
console.log(`Created ${usersCreated} new staff accounts (username = Thai name minus spaces, password: changeme123).`);

// Insert customers, picking each one's most frequent real salesperson.
const findCustomer = db.prepare('SELECT id FROM customers WHERE name = ?');
const insertCustomer = db.prepare(`
  INSERT INTO customers (name, assigned_user_id, note) VALUES (?, ?, ?)
`);

let customersCreated = 0;
let customersSkipped = 0;
for (const [name, spMap] of customers.entries()) {
  if (findCustomer.get(name)) { customersSkipped++; continue; }

  let topSales = null;
  let topCount = 0;
  for (const [sp, count] of spMap.entries()) {
    if (NON_PERSON_SALES_LABELS.has(sp)) continue;
    if (count > topCount) { topSales = sp; topCount = count; }
  }
  const assignedUserId = topSales ? userIdByName.get(topSales) : null;
  insertCustomer.run(name, assignedUserId || null, 'นำเข้าจากรายงานยอดขาย');
  customersCreated++;
}

console.log(`\nDone. ${customersCreated} customers created, ${customersSkipped} already existed and were skipped.`);
