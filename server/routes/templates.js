// server/routes/templates.js
const express = require('express');
const pool = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

module.exports = function () {
  const router = express.Router();

  // GET /api/templates — 인증된 모든 사용자
  router.get('/', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, description, data, created_by, created_at FROM templates ORDER BY created_at ASC'
      );
      res.json(result.rows);
    } catch (err) {
      console.error('[Templates] GET 오류:', err.message);
      res.status(500).json({ error: '서버 오류' });
    }
  });

  // POST /api/templates — admin 전용
  router.post('/', authenticateToken, requireRole('admin'), async (req, res) => {
    const { name, description, data } = req.body;
    if (!name || !data) return res.status(400).json({ error: '이름과 데이터가 필요합니다' });
    try {
      const result = await pool.query(
        `INSERT INTO templates (name, description, data, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, description, created_by, created_at`,
        [name.trim(), description || '', JSON.stringify(data), req.user.name]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error('[Templates] POST 오류:', err.message);
      res.status(500).json({ error: '서버 오류' });
    }
  });

  // DELETE /api/templates/:id — admin 전용
  router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      await pool.query('DELETE FROM templates WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error('[Templates] DELETE 오류:', err.message);
      res.status(500).json({ error: '서버 오류' });
    }
  });

  return router;
};
