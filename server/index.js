// server/index.js — Express + Socket.io 서버 진입점
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const dataRouter        = require('./routes/data');
const authRouter        = require('./routes/auth');
const templatesRouter   = require('./routes/templates');
const backupsRouter     = require('./routes/backups');
const layoutRouter      = require('./routes/layout');
const permissionsRouter = require('./routes/permissions');
const activityRouter    = require('./routes/activity');
const viewportRouter    = require('./routes/viewport');
const cron            = require('node-cron');
const pool            = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// ── user_viewports 테이블 자동 생성 ──────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS user_viewports (
    user_id TEXT PRIMARY KEY,
    offset_x FLOAT DEFAULT 0,
    offset_y FLOAT DEFAULT 0,
    scale FLOAT DEFAULT 1,
    updated_at TIMESTAMP DEFAULT NOW()
  )
`).catch(err => console.error('[DB] user_viewports 테이블 생성 실패:', err.message));

// ── activity_log 테이블 자동 생성 ─────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id SERIAL PRIMARY KEY,
    msg TEXT NOT NULL,
    project_name TEXT,
    user_name TEXT,
    task_id TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )
`).catch(err => console.error('[DB] activity_log 테이블 생성 실패:', err.message));

pool.query('ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS task_id TEXT')
  .catch(err => console.error('[DB] task_id 컬럼 추가 실패:', err.message));

// ── 미들웨어 ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// index.html은 항상 최신 버전 제공 (캐시 금지, 환경변수로 설정값 주입)
const fs = require('fs');
const appTitle     = process.env.APP_TITLE     || 'Loom';
const managerLabel = process.env.MANAGER_LABEL || '과장';
const injectConfig = `<script>window.LOOM_CONFIG = { managerLabel: ${JSON.stringify(managerLabel)} };</script>`;
const serveHtml = () => fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')
  .replace('<title>Loom</title>', `<title>${appTitle}</title>`)
  .replace('</head>', `${injectConfig}\n</head>`);
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(serveHtml());
});

// 프론트엔드 정적 파일 제공
app.use(express.static(path.join(__dirname, '..')));

// ── API 라우터 ────────────────────────────────────────────
app.use('/api/auth',      authRouter());
app.use('/api/templates', templatesRouter());
app.use('/api/backups',   backupsRouter());
app.use('/api',           layoutRouter());
app.use('/api',           permissionsRouter());
app.use('/api',           activityRouter());
app.use('/api',           viewportRouter());
app.use('/api',           dataRouter(io));

// SPA 폴백
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(serveHtml());
});

// ── Socket.io ─────────────────────────────────────────────
const onlineUsers = new Map(); // socketId → { id, name, role }

function getUniqueUsers() {
  const seen = new Set();
  return [...onlineUsers.values()].filter(u => {
    if (seen.has(u.id)) return false;
    seen.add(u.id); return true;
  });
}

io.on('connection', (socket) => {
  console.log(`[Socket] 연결: ${socket.id}`);

  socket.on('user:join', (user) => {
    onlineUsers.set(socket.id, { id: user.id, name: user.name, role: user.role });
    io.emit('users:online', getUniqueUsers());
  });

  socket.on('data:sync', async () => {
    const totalSockets = io.sockets.sockets.size;
    console.log(`[SERVER] data:sync 수신 from ${socket.id} | 연결 소켓 수: ${totalSockets}`);
    try {
      const result = await pool.query('SELECT data FROM workflow_data LIMIT 1');
      console.log(`[SERVER] DB 조회 완료, rows: ${result.rows.length}`);
      if (result.rows.length > 0) {
        console.log(`[SERVER] broadcast emit data:updated → ${totalSockets - 1}명`);
        socket.broadcast.emit('data:updated', result.rows[0].data);
      } else {
        console.warn('[SERVER] data:sync — workflow_data 테이블에 데이터 없음');
      }
    } catch (err) {
      console.error('[SERVER] data:sync 오류:', err.message);
    }
  });

  socket.on('activity:push', async (activity) => {
    try {
      await pool.query(
        'INSERT INTO activity_log (msg, project_name, user_name, task_id) VALUES ($1, $2, $3, $4)',
        [activity.msg, activity.project || '', activity.userName || '', activity.taskId || null]
      );
      await pool.query(
        'DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY created_at DESC LIMIT 100)'
      );
    } catch (err) {
      console.error('[Activity] DB 저장 실패:', err.message);
    }
    io.emit('activity:new', { ...activity, time: new Date().toISOString() });
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] 해제: ${socket.id}`);
    onlineUsers.delete(socket.id);
    io.emit('users:online', getUniqueUsers());
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
