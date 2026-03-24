// server/routes/permissions.js — 권한 설정 API
const express = require('express');
const pool = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

module.exports = function () {
  const router = express.Router();

  // GET /api/permissions — 로그인 사용자라면 누구나 조회
  router.get('/permissions', authenticateToken, async (req, res) => {
    try {
      const r = await pool.query("SELECT value FROM app_settings WHERE key='permissions'");
      res.json(r.rows[0]?.value || null);
    } catch (err) {
      res.status(500).json({ error: '서버 오류' });
    }
  });

  // PUT /api/permissions — admin만 저장
  router.put('/permissions', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const perms = req.body;
      await pool.query(
        "INSERT INTO app_settings(key,value) VALUES('permissions',$1) ON CONFLICT(key) DO UPDATE SET value=$1",
        [JSON.stringify(perms)]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: '서버 오류' });
    }
  });

  return router;
};
