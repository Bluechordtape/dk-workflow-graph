// server/middleware/auth.js — JWT 인증 + 역할 검사
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dk-workflow-secret-2024';

function authenticateToken(req, res, next) {
  const auth = req.headers['authorization'];
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: '인증이 필요합니다' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: '토큰이 유효하지 않습니다' });
    req.user = user;
    next();
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: '권한이 없습니다' });
    }
    next();
  };
}

module.exports = { authenticateToken, requireRole, JWT_SECRET };
