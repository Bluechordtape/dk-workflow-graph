// server/routes/data.js — /api/data REST 엔드포인트
const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

// 팀원(member) done 차단용: 이전 대비 새로 'done'이 된 task가 있으면 true
function collectTasks(d) {
  const arr = [];
  if (d?.tasks) arr.push(...d.tasks);
  if (d?.sheets) for (const s of d.sheets) if (s?.tasks) arr.push(...s.tasks);
  return arr;
}
function introducesDone(prev, next) {
  const prevStatus = new Map();
  if (prev) for (const t of collectTasks(prev)) prevStatus.set(t.id, t.status);
  for (const t of collectTasks(next)) {
    if (t.status === 'done' && prevStatus.get(t.id) !== 'done') return true;
  }
  return false;
}

module.exports = function (io) {
  const router = express.Router();

  // GET /api/data — 인증된 모든 사용자. 현재 rev는 X-Data-Rev 헤더로 전달.
  router.get('/data', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT data, rev FROM workflow_data WHERE id = 1'
      );
      if (result.rows.length === 0) {
        const samplePath = path.join(__dirname, '../../sample-data.json');
        const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
        if (!sample.flows) sample.flows = [];
        res.set('X-Data-Rev', '0');
        return res.json(sample);
      }
      res.set('X-Data-Rev', String(result.rows[0].rev ?? 0));
      res.json(result.rows[0].data);
    } catch (err) {
      console.error('[API] GET /data 오류:', err.message);
      res.status(500).json({ error: '데이터 조회 실패' });
    }
  });

  // PUT /api/data — admin, leader, manager, member 가능
  // 동시성: 클라이언트가 X-Base-Rev 헤더로 기반 rev를 보내면, 현재 rev와 다를 때 409로 거부(데이터 유실 방지).
  //         헤더가 없으면(구버전 호환) 충돌 검사는 건너뛰되 rev는 계속 증가시킨다.
  router.put('/data', authenticateToken, requireRole('admin', 'leader', 'manager', 'member'), async (req, res) => {
    const data = req.body;
    const role = req.user.role;
    const baseRevRaw = req.headers['x-base-rev'];
    const baseRev = baseRevRaw !== undefined ? Number(baseRevRaw) : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT data, rev FROM workflow_data WHERE id = 1 FOR UPDATE');
      const prev   = cur.rows[0]?.data ?? null;
      const curRev = cur.rows[0]?.rev ?? 0;

      // 낙관적 동시성 충돌 검사
      if (baseRev !== null && Number.isFinite(baseRev) && cur.rows.length > 0 && baseRev !== curRev) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: '다른 사용자가 먼저 저장했습니다', currentRev: curRev });
      }

      // 팀원은 완료(done) 처리 불가 — 완료요청(review)까지만
      if (role === 'member' && introducesDone(prev, data)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: '완료(done) 처리는 상급자만 가능합니다' });
      }

      const upd = await client.query(`
        INSERT INTO workflow_data (id, data, rev, updated_at)
        VALUES (1, $1, 1, NOW())
        ON CONFLICT (id) DO UPDATE
          SET data = EXCLUDED.data, rev = workflow_data.rev + 1, updated_at = NOW()
        RETURNING rev
      `, [JSON.stringify(data)]);
      await client.query('COMMIT');

      const newRev = upd.rows[0].rev;
      res.set('X-Data-Rev', String(newRev));
      console.log(`[Sync] PUT /data (rev ${curRev}→${newRev}) → io.emit data:updated`);
      io.emit('data:updated', data, newRev);
      res.json({ ok: true, rev: newRev });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[API] PUT /data 오류:', err.message);
      res.status(500).json({ error: '데이터 저장 실패' });
    } finally {
      client.release();
    }
  });

  // PATCH /api/data/task — 팀원용: 메모+상태만 저장 (자기 담당 업무)
  router.patch('/data/task', authenticateToken, async (req, res) => {
    const { taskId, updates } = req.body;
    console.log(`[PATCH task] user=${req.user.name}(${req.user.role}) taskId=${taskId} updates=`, JSON.stringify(updates));
    if (!taskId || !updates) return res.status(400).json({ error: 'taskId, updates 필요' });

    const canComplete = ['admin', 'leader'].includes(req.user.role);
    if (updates.status === 'done' && !canComplete)
      return res.status(403).json({ error: '완료/종결 처리 권한이 없습니다' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT data, rev FROM workflow_data WHERE id = 1 FOR UPDATE');
      if (result.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: '데이터 없음' }); }

      const data = result.rows[0].data;
      // 신규 global 구조 우선, 구버전 sheets 구조 fallback
      let task = data.tasks?.find(t => t.id === taskId);
      if (!task && data.sheets) {
        for (const sheet of data.sheets) {
          task = sheet.tasks?.find(t => t.id === taskId);
          if (task) break;
        }
      }
      if (!task) { await client.query('ROLLBACK'); return res.status(404).json({ error: '업무를 찾을 수 없습니다' }); }

      console.log(`[PATCH task] task.assignee="${task.assignee}" req.user.name="${req.user.name}"`);
      if (!canComplete && task.assignee && task.assignee !== req.user.name) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: '담당 업무만 수정할 수 있습니다' });
      }

      // member는 note, status, subtasks만 허용
      const allowed = canComplete ? updates : {
        ...(updates.note     !== undefined && { note:     updates.note }),
        ...(updates.status   !== undefined && { status:   updates.status }),
        ...(updates.subtasks !== undefined && { subtasks: updates.subtasks }),
      };
      Object.assign(task, allowed);

      const upd = await client.query(`
        INSERT INTO workflow_data (id, data, rev, updated_at) VALUES (1, $1, 1, NOW())
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, rev = workflow_data.rev + 1, updated_at = NOW()
        RETURNING rev
      `, [JSON.stringify(data)]);
      await client.query('COMMIT');

      const newRev = upd.rows[0].rev;
      res.set('X-Data-Rev', String(newRev));
      console.log('[Sync] PATCH /data/task → io.emit data:updated');
      io.emit('data:updated', data, newRev);
      res.json({ ok: true, data, rev: newRev });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[API] PATCH /data/task 오류:', err.message);
      res.status(500).json({ error: '서버 오류' });
    } finally {
      client.release();
    }
  });

  // PATCH /api/data/task-status — 자기 담당 업무 상태 변경
  router.patch('/data/task-status', authenticateToken, async (req, res) => {
    const { taskId, status, done_color } = req.body;
    const memberStatuses = ['pending', 'doing', 'delayed', 'review'];
    const mgmtStatuses = ['done'];
    const allAllowed = [...memberStatuses, ...mgmtStatuses];

    console.log(`[PATCH task-status] user=${req.user.name}(${req.user.role}) taskId=${taskId} status=${status}`);

    if (!taskId || !status)
      return res.status(400).json({ error: 'taskId, status 필요' });

    const canComplete = ['admin', 'leader'].includes(req.user.role);
    if (!canComplete && mgmtStatuses.includes(status))
      return res.status(403).json({ error: '이 상태는 관리자급만 설정할 수 있습니다' });

    if (!allAllowed.includes(status))
      return res.status(400).json({ error: '올바르지 않은 상태값' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT data, rev FROM workflow_data WHERE id = 1 FOR UPDATE');
      if (result.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: '데이터 없음' }); }

      const data = result.rows[0].data;
      let task = data.tasks?.find(t => t.id === taskId);
      if (!task && data.sheets) {
        for (const sheet of data.sheets) {
          task = sheet.tasks?.find(t => t.id === taskId);
          if (task) break;
        }
      }
      if (!task) {
        await client.query('ROLLBACK');
        console.log(`[PATCH task-status] taskId=${taskId} 없음`);
        return res.status(404).json({ error: '업무를 찾을 수 없습니다' });
      }

      console.log(`[PATCH task-status] task.assignee="${task.assignee}" req.user.name="${req.user.name}" canComplete=${canComplete}`);

      // member는 자기 담당 업무만 변경 가능 (단, assignee가 비어있으면 허용)
      if (!canComplete && task.assignee && task.assignee !== req.user.name) {
        await client.query('ROLLBACK');
        console.log(`[PATCH task-status] 403 — 담당자 불일치`);
        return res.status(403).json({ error: '담당 업무만 변경할 수 있습니다' });
      }

      task.status = status;
      if (status === 'done' && done_color && ['red', 'black'].includes(done_color)) {
        if (!task.done_color) task.done_color = done_color;
      }

      const upd = await client.query(`
        INSERT INTO workflow_data (id, data, rev, updated_at)
        VALUES (1, $1, 1, NOW())
        ON CONFLICT (id) DO UPDATE
          SET data = EXCLUDED.data, rev = workflow_data.rev + 1, updated_at = NOW()
        RETURNING rev
      `, [JSON.stringify(data)]);
      await client.query('COMMIT');

      const newRev = upd.rows[0].rev;
      res.set('X-Data-Rev', String(newRev));
      console.log(`[PATCH task-status] DB 저장 완료 → io.emit data:updated`);
      io.emit('data:updated', data, newRev);
      res.json({ ok: true, data, rev: newRev });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[API] PATCH /data/task-status 오류:', err.message);
      res.status(500).json({ error: '서버 오류' });
    } finally {
      client.release();
    }
  });

  return router;
};
