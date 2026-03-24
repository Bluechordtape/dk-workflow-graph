// server/routes/viewport.js — 사용자별 뷰포트 저장
const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

module.exports = function () {
  const router = express.Router();

  // GET /api/viewport — 현재 사용자의 뷰포트 조회
  router.get('/viewport', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT offset_x, offset_y, scale FROM user_viewports WHERE user_id = $1',
        [req.user.id]
      );
      if (result.rows.length === 0) {
        return res.json({ offsetX: 0, offsetY: 0, scale: 1, isDefault: true });
      }
      const r = result.rows[0];
      res.json({ offsetX: r.offset_x, offsetY: r.offset_y, scale: r.scale });
    } catch (err) {
      console.error('[API] GET /viewport 오류:', err.message);
      res.status(500).json({ error: '뷰포트 조회 실패' });
    }
  });

  // PUT /api/viewport — 현재 사용자의 뷰포트 저장
  router.put('/viewport', authenticateToken, async (req, res) => {
    try {
      const { offsetX, offsetY, scale } = req.body;
      await pool.query(`
        INSERT INTO user_viewports (user_id, offset_x, offset_y, scale, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id) DO UPDATE
          SET offset_x = EXCLUDED.offset_x,
              offset_y = EXCLUDED.offset_y,
              scale    = EXCLUDED.scale,
              updated_at = NOW()
      `, [req.user.id, offsetX, offsetY, scale]);
      res.json({ ok: true });
    } catch (err) {
      console.error('[API] PUT /viewport 오류:', err.message);
      res.status(500).json({ error: '뷰포트 저장 실패' });
    }
  });

  return router;
};
