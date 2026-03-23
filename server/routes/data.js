// server/routes/data.js — /api/data REST 엔드포인트
const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

module.exports = function (io) {
  const router = express.Router();

  // GET /api/data — 인증된 모든 사용자
  router.get('/data', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT data FROM workflow_data WHERE id = 1'
      );
      if (result.rows.length === 0) {
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

  // PUT /api/data — admin, leader, manager 가능
  router.put('/data', authenticateToken, requireRole('admin', 'leader', 'manager'), async (req, res) => {
    try {
      const data = req.body;
      await pool.query(`
        INSERT INTO workflow_data (id, data, updated_at)
        VALUES (1, $1, NOW())
        ON CONFLICT (id) DO UPDATE
          SET data = EXCLUDED.data, updated_at = NOW()
      `, [JSON.stringify(data)]);

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

  // PATCH /api/data/task — 팀원용: 메모+상태만 저장 (자기 담당 업무)
  router.patch('/data/task', authenticateToken, async (req, res) => {
    const { taskId, updates } = req.body;
    if (!taskId || !updates) return res.status(400).json({ error: 'taskId, updates 필요' });

    const canComplete = ['admin', 'leader'].includes(req.user.role);
    if (updates.status === 'done' && !canComplete)
      return res.status(403).json({ error: '완료/종결 처리 권한이 없습니다' });

    try {
      const result = await pool.query('SELECT data FROM workflow_data WHERE id = 1');
      if (result.rows.length === 0) return res.status(404).json({ error: '데이터 없음' });

      const data = result.rows[0].data;
      // 신규 global 구조 우선, 구버전 sheets 구조 fallback
      let task = data.tasks?.find(t => t.id === taskId);
      if (!task && data.sheets) {
        for (const sheet of data.sheets) {
          task = sheet.tasks?.find(t => t.id === taskId);
          if (task) break;
        }
      }
      if (!task) return res.status(404).json({ error: '업무를 찾을 수 없습니다' });

      if (!canComplete && task.assignee !== req.user.name)
        return res.status(403).json({ error: '담당 업무만 수정할 수 있습니다' });

      // member는 note, status, subtasks만 허용
      const allowed = canComplete ? updates : {
        ...(updates.note     !== undefined && { note:     updates.note }),
        ...(updates.status   !== undefined && { status:   updates.status }),
        ...(updates.subtasks !== undefined && { subtasks: updates.subtasks }),
      };
      Object.assign(task, allowed);

      await pool.query(`
        INSERT INTO workflow_data (id, data, updated_at) VALUES (1, $1, NOW())
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
      `, [JSON.stringify(data)]);

      const socketId = req.headers['x-socket-id'];
      if (socketId) io.except(socketId).emit('data:updated', data);
      else          io.emit('data:updated', data);

      res.json({ ok: true, data });
    } catch (err) {
      console.error('[API] PATCH /data/task 오류:', err.message);
      res.status(500).json({ error: '서버 오류' });
    }
  });

  // PATCH /api/data/task-status — 자기 담당 업무 상태 변경
  router.patch('/data/task-status', authenticateToken, async (req, res) => {
    const { taskId, status } = req.body;
    // 팀원이 설정 가능한 상태
    const memberStatuses = ['pending', 'doing', 'delayed', 'review'];
    // admin/leader만 가능한 상태
    const mgmtStatuses = ['done'];
    const allAllowed = [...memberStatuses, ...mgmtStatuses];

    if (!taskId || !status)
      return res.status(400).json({ error: 'taskId, status 필요' });

    const canComplete = ['admin', 'leader'].includes(req.user.role);
    if (!canComplete && mgmtStatuses.includes(status))
      return res.status(403).json({ error: '이 상태는 관리자급만 설정할 수 있습니다' });

    if (!allAllowed.includes(status))
      return res.status(400).json({ error: '올바르지 않은 상태값' });

    try {
      const result = await pool.query(
        'SELECT data FROM workflow_data WHERE id = 1'
      );
      if (result.rows.length === 0)
        return res.status(404).json({ error: '데이터 없음' });

      const data = result.rows[0].data;
      let task = data.tasks?.find(t => t.id === taskId);
      if (!task && data.sheets) {
        for (const sheet of data.sheets) {
          task = sheet.tasks?.find(t => t.id === taskId);
          if (task) break;
        }
      }
      if (!task) return res.status(404).json({ error: '업무를 찾을 수 없습니다' });

      // member는 자기 담당 업무만 변경 가능
      if (!canComplete && task.assignee !== req.user.name)
        return res.status(403).json({ error: '담당 업무만 변경할 수 있습니다' });

      task.status = status;

      await pool.query(`
        INSERT INTO workflow_data (id, data, updated_at)
        VALUES (1, $1, NOW())
        ON CONFLICT (id) DO UPDATE
          SET data = EXCLUDED.data, updated_at = NOW()
      `, [JSON.stringify(data)]);

      const socketId = req.headers['x-socket-id'];
      if (socketId) {
        io.except(socketId).emit('data:updated', data);
      } else {
        io.emit('data:updated', data);
      }
      res.json({ ok: true, data });
    } catch (err) {
      console.error('[API] PATCH /data/task-status 오류:', err.message);
      res.status(500).json({ error: '서버 오류' });
    }
  });

  return router;
};
