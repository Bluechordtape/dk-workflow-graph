// server/index.js — Express + Socket.io 서버 진입점
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const dataRouter = require('./routes/data');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// ── 미들웨어 ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// 프론트엔드 정적 파일 제공 (server/ 의 상위 폴더)
app.use(express.static(path.join(__dirname, '..')));

// ── API 라우터 ────────────────────────────────────────────
app.use('/api', dataRouter(io));

// SPA 폴백 (index.html)
app.get('*', (req, res) => {
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
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
