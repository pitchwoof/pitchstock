const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM suppliers ORDER BY name').all();
  res.json(rows);
});

router.post('/', requireAuth, (req, res) => {
  const name = (req.body || {}).name?.trim();
  if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อซัพพลายเออร์' });

  const existing = db.prepare('SELECT * FROM suppliers WHERE name = ?').get(name);
  if (existing) return res.status(200).json(existing);

  const info = db.prepare('INSERT INTO suppliers (name) VALUES (?)').run(name);
  res.status(201).json({ id: Number(info.lastInsertRowid), name });
});

module.exports = router;
