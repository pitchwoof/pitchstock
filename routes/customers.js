const express = require('express');
const db = require('../db');
const { requireAuth, requireCreate, requireEdit } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const includeArchived = req.query.includeArchived === '1';
  const base = 'SELECT * FROM customers c';
  const rows = includeArchived
    ? db.prepare(`${base} ORDER BY c.name`).all()
    : db.prepare(`${base} WHERE c.archived = 0 ORDER BY c.name`).all();
  res.json(rows);
});

router.post('/', requireAuth, requireCreate, (req, res) => {
  const { name, phone, contactPerson, address, assignedTo, note } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อลูกค้า' });

  const info = db.prepare(`
    INSERT INTO customers (name, phone, contact_person, address, assigned_to, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name.trim(), phone || null, contactPerson || null, address || null, assignedTo || null, note || null);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.patch('/:id', requireAuth, requireEdit, (req, res) => {
  const { name, phone, contactPerson, address, assignedTo, note, archived } = req.body || {};
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'ไม่พบลูกค้า' });

  db.prepare(`
    UPDATE customers SET name = ?, phone = ?, contact_person = ?, address = ?, assigned_to = ?, note = ?, archived = ?
    WHERE id = ?
  `).run(
    name !== undefined && name.trim() ? name.trim() : customer.name,
    phone !== undefined ? (phone || null) : customer.phone,
    contactPerson !== undefined ? (contactPerson || null) : customer.contact_person,
    address !== undefined ? (address || null) : customer.address,
    assignedTo !== undefined ? (assignedTo || null) : customer.assigned_to,
    note !== undefined ? (note || null) : customer.note,
    archived !== undefined ? (archived ? 1 : 0) : customer.archived,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireEdit, (req, res) => {
  const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'ไม่พบลูกค้า' });
  db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
