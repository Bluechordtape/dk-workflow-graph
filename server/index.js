// server/index.js — Express + Socket.io 서버 진입점
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const dataRouter      = require('./routes/data');
const authRouter      = require('./routes/auth');
const templatesRouter = require('./routes/templates');
const backupsRouter   = require('./routes/backups');
const layoutRouter    = require('./routes/layout');
const cron            = require('node-cron');
const pool            = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// ── 미들웨어 ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// index.html은 항상 최신 버전 제공 (캐시 금지)
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../index.html'));
});

// 프론트엔드 정적 파일 제공
app.use(express.static(path.join(__dirname, '..')));

// ── API 라우터 ────────────────────────────────────────────
app.use('/api/auth',      authRouter());
app.use('/api/templates', templatesRouter());
app.use('/api/backups',   backupsRouter());
app.use('/api',           layoutRouter());
app.use('/api',           dataRouter(io));

// SPA 폴백
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../index.html'));
});

// ── Socket.io ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] 연결: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[Socket] 해제: ${socket.id}`);
  });
});

// ── 서버 시작 ─────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});

// ── 자동 백업 (매일 자정) ─────────────────────────────────
cron.schedule('0 0 * * *', async () => {
  try {
    const dataRes = await pool.query('SELECT data FROM workflow_data WHERE id = 1');
    if (dataRes.rows.length === 0) return;

    const name = `자동 백업 ${new Date().toLocaleDateString('ko-KR')}`;
    await pool.query(
      `INSERT INTO backups (name, data, created_by, is_auto) VALUES ($1, $2, 'system', true)`,
      [name, JSON.stringify(dataRes.rows[0].data)]
    );

    // 자동 백업 최근 7개만 유지
    await pool.query(`
      DELETE FROM backups
      WHERE is_auto = true
        AND id NOT IN (
          SELECT id FROM backups WHERE is_auto = true
          ORDER BY created_at DESC LIMIT 7
        )
    `);
    console.log('[Backup] 자동 백업 완료:', name);
  } catch (err) {
    console.error('[Backup] 자동 백업 실패:', err.message);
  }
});
