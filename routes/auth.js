const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.displayName = user.display_name;
  req.session.role = user.role;
  res.json({ id: user.id, username: user.username, displayName: user.display_name, role: user.role });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.session.userId,
    username: req.session.username,
    displayName: req.session.displayName,
    role: req.session.role,
  });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
});

// Lightweight staff list (id + display name only) for assigning e.g. "salesperson in charge"
// on customer records — open to any staff member, unlike the full account list below.
router.get('/users/basic', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, display_name FROM users WHERE active = 1 ORDER BY display_name').all();
  res.json(users);
});

// --- User management (admin only) ---

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, display_name, role, active, created_at FROM users ORDER BY created_at').all();
  res.json(users);
});

const VALID_ROLES = ['admin', 'editor', 'creator', 'viewer'];

router.post('/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'มีชื่อผู้ใช้นี้อยู่แล้ว' });

  const finalRole = VALID_ROLES.includes(role) ? role : 'creator';
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)
  `).run(username, hash, username, finalRole);
  res.status(201).json({ id: Number(info.lastInsertRowid), username, displayName: username, role: finalRole });
});

router.patch('/users/:id/role', requireAuth, requireAdmin, (req, res) => {
  const { role } = req.body || {};
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ ok: true });
});

router.put('/users/:id/active', requireAuth, requireAdmin, (req, res) => {
  const { active } = req.body || {};
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// Admin sets a brand-new password for an account — the only way to recover access, since
// passwords are stored as one-way bcrypt hashes and can never be read back in plain text.
router.patch('/users/:id/password', requireAuth, requireAdmin, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.session.userId) {
    return res.status(400).json({ error: 'ลบบัญชีของตัวเองไม่ได้' });
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  } catch (err) {
    if (String(err.message).includes('FOREIGN KEY')) {
      return res.status(409).json({ error: 'ลบไม่ได้ เพราะบัญชีนี้มีประวัติการทำรายการอยู่ในระบบ (รับเข้า/เบิกออก/เคลม/ลูกค้าที่ดูแล) — ใช้ "ปิดใช้งาน" แทนเพื่อระงับการเข้าใช้งานโดยไม่ลบประวัติ' });
    }
    return res.status(500).json({ error: 'ลบบัญชีไม่สำเร็จ', detail: err.message });
  }
  res.json({ ok: true });
});

module.exports = router;
