// Access tiers (beyond admin, which always has full access):
//   viewer  - read-only
//   creator - can add new records, cannot edit existing ones
//   editor  - can add and edit
const CREATE_ROLES = ['admin', 'editor', 'creator'];
const EDIT_ROLES = ['admin', 'editor'];

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'ต้องใช้สิทธิ์ผู้ดูแลระบบ' });
  }
  next();
}

function requireCreate(req, res, next) {
  if (!req.session || !CREATE_ROLES.includes(req.session.role)) {
    return res.status(403).json({ error: 'คุณมีสิทธิ์ดูอย่างเดียว ไม่สามารถเพิ่มข้อมูลได้' });
  }
  next();
}

function requireEdit(req, res, next) {
  if (!req.session || !EDIT_ROLES.includes(req.session.role)) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์แก้ไขข้อมูล' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireCreate, requireEdit };
