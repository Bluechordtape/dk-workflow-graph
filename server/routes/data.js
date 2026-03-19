// server/routes/data.js — /api/data REST 엔드포인트
const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db');

module.exports = function (io) {
  const router = express.Router();

  // GET /api/data — 전체 데이터 조회
  router.get('/data', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT data FROM workflow_data WHERE id = 1'
      );

      if (result.rows.length === 0) {
        // DB에 데이터가 없으면 sample-data.json 반환
        const samplePath = path.join(__dirname, '../../sample-data.json');
        const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
        if (!sample.flows) sample.flows = [];
        return res.json(sample);
      }

      res.json(result.rows[0].data);
    } catch (err) {
      console.error('[API] GET /data 오류:', err.message);
      res.status(500).json({ error: '데이터 조회 실패' });
    }
  });

  // PUT /api/data — 전체 데이터 저장 + 실시간 브로드캐스트
  router.put('/data', async (req, res) => {
    try {
      const data = req.body;

      await pool.query(`
        INSERT INTO workflow_data (id, data, updated_at)
        VALUES (1, $1, NOW())
        ON CONFLICT (id) DO UPDATE
          SET data = EXCLUDED.data, updated_at = NOW()
      `, [JSON.stringify(data)]);

      // 저장한 클라이언트를 제외한 모든 클라이언트에 브로드캐스트
      const socketId = req.headers['x-socket-id'];
      if (socketId) {
        io.except(socketId).emit('data:updated', data);
      } else {
        io.emit('data:updated', data);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('[API] PUT /data 오류:', err.message);
      res.status(500).json({ error: '데이터 저장 실패' });
    }
  });

  return router;
};
