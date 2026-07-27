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

module.exports = { requireAuth, requireAdmin };
