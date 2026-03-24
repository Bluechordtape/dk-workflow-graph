// server/routes/activity.js
const express = require('express');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

module.exports = function () {
  const router = express.Router();

  // GET /api/activity — 최근 10개
  router.get('/activity', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 10'
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
