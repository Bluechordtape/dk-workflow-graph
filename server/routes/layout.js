// server/routes/layout.js — 사용자별 노드 위치 저장
const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

module.exports = function () {
  const router = express.Router();

  // GET /api/layout — 현재 사용자의 레이아웃 조회
  router.get('/layout', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT layout FROM user_layouts WHERE user_id = $1',
        [req.user.id]
      );
      res.json(result.rows[0]?.layout || { tasks: {}, groups: {}, projects: {} });
    } catch (err) {
      console.error('[API] GET /layout 오류:', err.message);
      res.status(500).json({ error: '레이아웃 조회 실패' });
    }
  });

  // PUT /api/layout — 현재 사용자의 레이아웃 저장
  router.put('/layout', authenticateToken, async (req, res) => {
    try {
      const layout = req.body;
      await pool.query(`
        INSERT INTO user_layouts (user_id, layout, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id) DO UPDATE
          SET layout = EXCLUDED.layout, updated_at = NOW()
      `, [req.user.id, JSON.stringify(layout)]);
      res.json({ ok: true });
    } catch (err) {
      console.error('[API] PUT /layout 오류:', err.message);
      res.status(500).json({ error: '레이아웃 저장 실패' });
    }
  });

  return router;
};
