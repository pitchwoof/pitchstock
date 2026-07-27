const bcrypt = require('bcryptjs');
const db = require('../db');

const products = [
  // UIPS brand
  ['IQ800UI', 'UIPS S1800 UI', 'UIPS', 'UI', 'kg', 300],
  ['IQ801', 'UIPS S1801 BK', 'UIPS', 'BK', 'kg', 5],
  ['IQ990', 'UIPS S1990 BK', 'UIPS', 'BK', 'kg', 30],
  ['S1797PLUSUI', 'UIPS S1797 PLUS UI', 'UIPS', 'UI', 'kg', 100],
  ['IQ800PLUSUI', 'UIPS S1800 PLUS UI', 'UIPS', 'UI', 'kg', 80],
  ['HD119UI', 'UIPS W1119 UI', 'UIPS', 'UI', 'kg', 160],
  ['HD157N', 'UIPS S157G', 'UIPS', 'G', 'kg', 5],
  ['HD119BLUK', 'HD 119 N BLUK', 'UIPS', 'BLUK', 'kg', 3],
  ['IQ314WH', 'UIPS S1314S WH', 'UIPS', 'WH', 'kg', 2],
  ['IQ798RD', 'UIPS S1798 RD UI', 'UIPS', 'RD', 'kg', 8],
  ['HD120BLUE', 'HD 120 Blue Ink', 'UIPS', 'Blue', 'kg', 5],
  ['IQ799BL', 'UIPS S799BL', 'UIPS', 'BL', 'kg', 12],
  ['IQ324SYL', 'UIPS I324S YL', 'UIPS', 'YL', 'kg', 2],
  ['IQ314SWH', 'UIPS I314Plus WH', 'UIPS', 'WH', 'kg', 2],
  // Domino brand
  ['APSACEC18BK', 'APS-AC EC 18 BK', 'Domino', 'BK', 'L', 80],
  ['APSACEC29BK', 'APS-AC EC 29 BK', 'Domino', 'BK', 'L', 300],
  ['APSACEC31BK', 'APS-AC EC 31 BK', 'Domino', 'BK', 'L', 18],
  ['APSEXEC01BK', 'APS-EX EC 01 BK', 'Domino', 'BK', 'L', 8],
  ['APSACWC32BK', 'APS-AC WC 32 BK', 'Domino', 'BK', 'L', 20],
  ['APSACWC40BK', 'APS-AC WC 40 BK', 'Domino', 'BK', 'L', 15],
  ['APSACWC42BK', 'APS-AC WC 42 BK', 'Domino', 'BK', 'L', 120],
  ['APSACWC51BK', 'APS-AC WC 51 BK', 'Domino', 'BK', 'L', 60],
  ['APSACWC52BK', 'APS-AC WC 52 BK', 'Domino', 'BK', 'L', 330],
  ['APSACWC52BL', 'APS-AC WC 52 BL', 'Domino', 'BL', 'L', 18],
  ['APSACWC52GR', 'APS-AC WC 52 GR', 'Domino', 'GR', 'L', 8],
  ['PK962BK14L', 'PK962 BK 1.4 L', 'Domino', 'BK', 'L', 6],
  ['PL962BK085L', 'PL962 BK 0.85L', 'Domino', 'BK', 'L', 4],
  ['WL9151', 'WL 915-1', 'Domino', '', 'L', 2],
];

const insertProduct = db.prepare(`
  INSERT OR IGNORE INTO products (sku_code, name, brand, color, unit, reorder_level)
  VALUES (?, ?, ?, ?, ?, ?)
`);

for (const p of products) {
  insertProduct.run(...p);
}
console.log(`Seeded ${products.length} products (skipping any that already exist).`);

const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!existingAdmin) {
  const hash = bcrypt.hashSync('changeme123', 10);
  db.prepare(`
    INSERT INTO users (username, password_hash, display_name, role)
    VALUES (?, ?, ?, 'admin')
  `).run('admin', hash, 'Admin');
  console.log('Created default admin user -> username: admin / password: changeme123 (CHANGE THIS after first login)');
} else {
  console.log('Admin user already exists, skipped.');
}
