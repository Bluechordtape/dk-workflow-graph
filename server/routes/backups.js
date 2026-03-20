// server/routes/backups.js
const express = require('express');
const pool = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

module.exports = function () {
  const router = express.Router();

  // GET /api/backups — admin 전용, 최근 30개
  router.get('/', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT id, name, created_by, created_at, is_auto,
               COALESCE(
                 jsonb_array_length(data->'tasks'),
                 (SELECT SUM(jsonb_array_length(s->'tasks'))::int
                  FROM jsonb_array_elements(data->'sheets') AS s)
               ) AS task_count
        FROM backups
        ORDER BY created_at DESC
        LIMIT 30
      `);
      res.json(result.rows);
    } catch (err) {
      console.error('[Backups] GET 오류:', err.message);
      res.status(500).json({ error: '서버 오류' });
    }
  });

  // POST /api/backups — 수동 백업 (admin 전용)
  router.post('/', authenticateToken, requireRole('admin'), async (req, res) => {
    const { name } = req.body;
    try {
      const dataRes = await pool.query('SELECT data FROM workflow_data WHERE id = 1');
      if (dataRes.rows.length === 0)
        return res.status(404).json({ error: '저장된 데이터가 없습니다' });

      const result = await pool.query(`
        INSERT INTO backups (name, data, created_by, is_auto)
        VALUES ($1, $2, $3, false)
        RETURNING id, name, created_by, created_at, is_auto
      `, [name || `수동 백업 ${new Date().toLocaleString('ko-KR')}`, dataRes.rows[0].data, req.user.name]);

      res.json(result.rows[0]);
    } catch (err) {
      console.error('[Backups] POST 오류:', err.message);
      res.status(500).json({ error: '서버 오류' });
    }
  });

  // POST /api/backups/:id/restore — 복구 (admin 전용)
  router.post('/:id/restore', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      const backupRes = await pool.query('SELECT data FROM backups WHERE id = $1', [req.params.id]);
      if (backupRes.rows.length === 0)
        return res.status(404).json({ error: '백업을 찾을 수 없습니다' });

      await pool.query(`
        INSERT INTO workflow_data (id, data, updated_at)
        VALUES (1, $1, NOW())
        ON CONFLICT (id) DO UPDATE
          SET data = EXCLUDED.data, updated_at = NOW()
      `, [JSON.stringify(backupRes.rows[0].data)]);

      res.json({ ok: true, data: backupRes.rows[0].data });
    } catch (err) {
      console.error('[Backups] RESTORE 오류:', err.message);
      res.status(500).json({ error: '서버 오류' });
    }
  });

  // DELETE /api/backups/:id — admin 전용
  router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
      await pool.query('DELETE FROM backups WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error('[Backups] DELETE 오류:', err.message);
      res.status(500).json({ error: '서버 오류' });
    }
  });

  return router;
};
