// server/routes/auth.js — 로그인, 내 정보
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

module.exports = function () {
  const router = express.Router();

  // POST /api/auth/login
  router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: '이메일과 비밀번호를 입력하세요' });

    try {
      const result = await pool.query(
        'SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]
      );
      if (result.rows.length === 0)
        return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });

      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid)
        return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (err) {
      console.error('[Auth] 로그인 오류:', err.message);
      res.status(500).json({ error: '서버 오류' });
    }
  });

  // GET /api/auth/me
  router.get('/me', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, email, name, role FROM users WHERE id = $1', [req.user.id]
      );
      if (result.rows.length === 0)
        return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: '서버 오류' });
    }
  });

  // POST /api/auth/users — 사용자 추가 (admin 전용)
  router.post('/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: '관리자만 사용자를 추가할 수 있습니다' });

    const { email, password, name, role } = req.body;
    if (!email || !password || !name || !role)
      return res.status(400).json({ error: '모든 필드를 입력하세요' });
    if (!['admin', 'manager', 'member'].includes(role))
      return res.status(400).json({ error: '올바른 역할을 선택하세요' });

    try {
      const hash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, role`,
        [email.toLowerCase().trim(), hash, name, role]
      );
      res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505')
        return res.status(409).json({ error: '이미 사용 중인 이메일입니다' });
      res.status(500).json({ error: '서버 오류' });
    }
  });

  // GET /api/auth/users — 사용자 목록 (admin 전용)
  router.get('/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: '권한이 없습니다' });
    try {
      const result = await pool.query(
        'SELECT id, email, name, role, created_at FROM users ORDER BY created_at'
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: '서버 오류' });
    }
  });

  return router;
};
