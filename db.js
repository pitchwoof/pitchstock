const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'pitchstock.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  color TEXT,
  unit TEXT NOT NULL DEFAULT 'unit',
  reorder_level REAL NOT NULL DEFAULT 0,
  note TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_number TEXT,
  expiration_date TEXT,
  quantity_received REAL NOT NULL,
  quantity_remaining REAL NOT NULL,
  unit_cost REAL,
  supplier TEXT,
  received_date TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('IN','OUT','ADJUST')),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  transaction_date TEXT NOT NULL,
  counterparty TEXT,
  user_id INTEGER REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('customer_reject', 'supplier_claim')),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER REFERENCES batches(id),
  quantity REAL NOT NULL,
  claim_date TEXT NOT NULL,
  counterparty TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'approved', 'rejected', 'resolved')),
  resolution_note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  contact_person TEXT,
  address TEXT,
  assigned_user_id INTEGER REFERENCES users(id),
  note TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_batches_product ON batches(product_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiration ON batches(expiration_date);
CREATE INDEX IF NOT EXISTS idx_txn_product ON stock_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_txn_batch ON stock_transactions(batch_id);
CREATE INDEX IF NOT EXISTS idx_claims_product ON claims(product_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_customers_assigned ON customers(assigned_user_id);
`);

// Lightweight migrations: add columns that may not exist on a database created before this feature.
const productColumns = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
if (!productColumns.includes('lead_time_days')) {
  db.exec('ALTER TABLE products ADD COLUMN lead_time_days INTEGER NOT NULL DEFAULT 30');
}
if (!productColumns.includes('supplier_id')) {
  db.exec('ALTER TABLE products ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)');
}

const claimColumns = db.prepare("PRAGMA table_info(claims)").all().map((c) => c.name);
if (!claimColumns.includes('redirected_to')) {
  db.exec('ALTER TABLE claims ADD COLUMN redirected_to TEXT');
}
if (!claimColumns.includes('redirected_quantity')) {
  db.exec('ALTER TABLE claims ADD COLUMN redirected_quantity REAL');
}

const txnColumns = db.prepare("PRAGMA table_info(stock_transactions)").all().map((c) => c.name);
if (!txnColumns.includes('purpose')) {
  db.exec("ALTER TABLE stock_transactions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'sale'");
}

module.exports = db;
