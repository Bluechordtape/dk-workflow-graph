// data.js

let _socketId = null;
let _token = null;
let _socket = null;

export function setSocketId(id) { _socketId = id; }
export function setToken(token) { _token = token; }
export function setSocket(s) { _socket = s; }

function authHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (_token) h['Authorization'] = `Bearer ${_token}`;
  if (_socketId) h['x-socket-id'] = _socketId;
  return h;
}

// ── 로드 ─────────────────────────────────────────────────
export async function loadData() {
  try {
    const res = await fetch('/api/data', { headers: authHeaders() });
    if (res.ok) {
      const d = await res.json();
      if (d) return normalize(d);
    }
    if (res.status === 401 || res.status === 403) return null;
  } catch {}
  return null;
}

export function normalize(d) {
  // ── Phase 1: 구버전 flat → sheets 구조 마이그레이션 (sheets도 views도 없는 경우)
  if (!d.sheets && !d.views && (d.tasks || d.projects)) {
    const sheetId = generateId('view');
    d.views = [{
      id: sheetId,
      name: '기본 시트',
      projectIds: (d.projects || []).map(p => p.id),
      sortOrder: 0
    }];
    d.activeViewId = null; // 전체 보기
    // projects/tasks/flows/groups는 이미 루트에 있으므로 그대로 유지
  }

  // ── Phase 2: sheets 구조 → global 구조 마이그레이션
  if (d.sheets) {
    const projectMap = new Map();
    const groupMap   = new Map();
    const tasks      = [];
    const flows      = [];

    for (const sheet of d.sheets) {
      for (const p of (sheet.projects || [])) projectMap.set(p.id, p);
      for (const g of (sheet.groups   || [])) groupMap.set(g.id, g);
      tasks.push(...(sheet.tasks || []));
      flows.push(...(sheet.flows || []));
    }

    d.projects = [...projectMap.values()];
    d.groups   = [...groupMap.values()];
    d.tasks    = tasks;
    d.flows    = flows;

    // 기존 sheets → views 변환 (각 sheet의 프로젝트 ID 목록 보존)
    d.views = d.sheets.map((s, i) => ({
      id:         s.id,
      name:       s.name,
      projectIds: (s.projects || []).map(p => p.id),
      sortOrder:  i
    }));
    d.activeViewId = null; // 마이그레이션 후 전체 보기로 초기화

    delete d.sheets;
    delete d.activeSheetId;
  }

  // ── Phase 3: global 구조 기본값 보장
  if (!d.projects) d.projects = [];
  if (!d.tasks)    d.tasks    = [];
  if (!d.flows)    d.flows    = [];
  if (!d.groups)   d.groups   = [];

  // ── Phase 3b: 그룹 필드 정규화 (x, y, projectId, sortOrder 보장)
  for (const g of d.groups) {
    if (g.x         === undefined) g.x         = 200;
    if (g.y         === undefined) g.y         = 200;
    if (g.projectId === undefined) g.projectId = null;
    if (g.sortOrder === undefined) g.sortOrder = 0;
  }

  // ── Phase 3c: task.groupId 기본값
  for (const t of d.tasks) {
    if (t.groupId === undefined) t.groupId = null;
  }
  if (!d.views)    d.views    = [];

  // activeViewId 유효성 검사 (null = 전체 보기)
  if (d.activeViewId && !d.views.find(v => v.id === d.activeViewId)) {
    d.activeViewId = null;
  }

  // ── Phase 4: 상태값 정규화 (5가지 체계로 통합)
  const STATUS_MAP = {
    todo: 'pending', pre: 'pending', wip: 'doing',
    waiting: 'doing', inactive: 'pending',
    closed: 'done', terminated: 'done', ended: 'done', finish: 'done',
  };
  for (const task of d.tasks) {
    if (STATUS_MAP[task.status]) task.status = STATUS_MAP[task.status];
    // 유효하지 않은 상태는 pending으로
    if (!['pending','doing','delayed','review','done'].includes(task.status)) {
      task.status = 'pending';
    }
  }

  return d;
}

// ── 저장 ─────────────────────────────────────────────────
export function saveData(data) {
  fetch('/api/data', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(data) })
    .then(res => {
      if (!res.ok) { console.error('저장 실패: HTTP', res.status); return; }
      _socket?.emit('data:sync', { timestamp: Date.now() });
    })
    .catch(err => console.error('저장 실패:', err));
}

// ── 팀원 제한 업무 저장 ───────────────────────────────────
export async function updateTaskMember(taskId, updates) {
  const res = await fetch('/api/data/task', {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ taskId, updates })
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '저장 실패'); }
  return res.json();
}

// ── 상태만 변경 (member 전용) ─────────────────────────────
export async function saveTaskStatus(taskId, status, socketId) {
  const headers = authHeaders();
  if (socketId) headers['x-socket-id'] = socketId;
  const res = await fetch('/api/data/task-status', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ taskId, status })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '상태 변경 실패');
  }
  return res.json();
}

// ── 백업 API ─────────────────────────────────────────────
export async function fetchBackups() {
  const res = await fetch('/api/backups', { headers: authHeaders() });
  if (!res.ok) throw new Error('백업 목록 조회 실패');
  return res.json();
}

export async function createBackup(name) {
  const res = await fetch('/api/backups', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name })
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '백업 실패'); }
  return res.json();
}

export async function restoreBackup(id) {
  const res = await fetch(`/api/backups/${id}/restore`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '복구 실패'); }
  return res.json();
}

export async function deleteBackup(id) {
  const res = await fetch(`/api/backups/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error('삭제 실패');
  return res.json();
}

// ── 템플릿 API ────────────────────────────────────────────
export async function fetchTemplates() {
  const res = await fetch('/api/templates', { headers: authHeaders() });
  if (!res.ok) throw new Error('템플릿 조회 실패');
  return res.json();
}

export async function saveTemplate(name, description, templateData) {
  const res = await fetch('/api/templates', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, description, data: templateData })
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '저장 실패'); }
  return res.json();
}

export async function deleteTemplate(id) {
  const res = await fetch(`/api/templates/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error('삭제 실패');
  return res.json();
}

// ── JSON 가져오기 / 내보내기 ──────────────────────────────
export function exportJSON(data) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `dk-workflow-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

export function importJSON(callback) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = async (e) => {
    const text = await e.target.files[0]?.text();
    if (!text) return;
    try { const d = normalize(JSON.parse(text)); saveData(d); callback(d); }
    catch { alert('파일을 읽을 수 없습니다.'); }
  };
  input.click();
}

// ── ID 생성 ───────────────────────────────────────────────
export function generateId(p = 'id') {
  return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── 프로젝트 (루트 data 객체에 직접 작업) ─────────────────
const COLORS = ['#0D9488','#0891B2','#059669','#DC2626','#D97706','#EA580C','#2563EB','#16A34A'];
let ci = 0;

export function addProject(data, name) {
  const p = { id: generateId('p'), name, color: COLORS[ci++ % COLORS.length] };
  data.projects.push(p);
  return p;
}

export function deleteProject(data, projectId) {
  data.projects = data.projects.filter(p => p.id !== projectId);
  const removedTasks = new Set(data.tasks.filter(t => t.projectId === projectId).map(t => t.id));
  const removedGroups = new Set((data.groups || []).filter(g => g.projectId === projectId).map(g => g.id));
  data.tasks  = data.tasks.filter(t => t.projectId !== projectId);
  data.groups = (data.groups || []).filter(g => g.projectId !== projectId);
  data.flows  = (data.flows || []).filter(f =>
    !removedTasks.has(f.from) && !removedTasks.has(f.to) &&
    !removedGroups.has(f.from) && !removedGroups.has(f.to)
  );
  // 뷰의 projectIds에서도 제거
  for (const view of (data.views || [])) {
    view.projectIds = (view.projectIds || []).filter(id => id !== projectId);
  }
}

// ── 업무 ─────────────────────────────────────────────────
export function addTask(data, { name, projectId, groupId = null, assignee = '', x = 100, y = 100 }) {
  const task = {
    id: generateId('t'),
    projectId: projectId || data.projects[0]?.id || '',
    groupId,
    name: name || '새 업무',
    assignee,
    status: 'pending',
    note: '',
    x, y
  };
  data.tasks.push(task);
  return task;
}

export function updateTask(data, taskId, updates) {
  const t = data.tasks.find(t => t.id === taskId);
  if (t) Object.assign(t, updates);
  return t;
}

export function deleteTask(data, taskId) {
  data.tasks = data.tasks.filter(t => t.id !== taskId);
  data.flows = data.flows.filter(f => f.from !== taskId && f.to !== taskId);
}

// ── 그룹/묶음 ────────────────────────────────────────────
export const GROUP_COLORS = ['#6366F1','#0EA5E9','#10B981','#F59E0B','#EF4444','#EC4899','#8B5CF6','#14B8A6'];

// projectId: 소속 프로젝트 (null = 레거시 태그 전용)
// x, y: 캔버스 절대 좌표 (빈 묶음 앵커 / 드래그 후 업데이트)
// sortOrder: 정렬 순서
export function addGroup(data, name, color, projectId = null, x = 200, y = 200) {
  const maxOrder = (data.groups || []).filter(g => g.projectId === projectId)
    .reduce((m, g) => Math.max(m, g.sortOrder || 0), 0);
  const g = { id: generateId('g'), name, color, projectId, x, y, sortOrder: maxOrder + 1 };
  if (!data.groups) data.groups = [];
  data.groups.push(g);
  return g;
}

export function deleteGroup(data, groupId) {
  data.groups = (data.groups || []).filter(g => g.id !== groupId);
  data.tasks.forEach(t => { if (t.groupId === groupId) t.groupId = null; });
  // 묶음과 연결된 flow도 제거
  data.flows = (data.flows || []).filter(f => f.from !== groupId && f.to !== groupId);
}

// ── 연결 ─────────────────────────────────────────────────
export function addFlow(data, fromId, toId) {
  if (fromId === toId) return null;
  if (data.flows.some(f => f.from === fromId && f.to === toId)) return null;
  const flow = { id: generateId('f'), from: fromId, to: toId };
  data.flows.push(flow);
  return flow;
}

export function deleteFlow(data, flowId) {
  data.flows = data.flows.filter(f => f.id !== flowId);
}

// ── 뷰 (사이드바 시트) ────────────────────────────────────
export function addView(data, name, projectIds = []) {
  const maxOrder = (data.views || []).reduce((m, v) => Math.max(m, v.sortOrder || 0), 0);
  const view = { id: generateId('view'), name, projectIds, sortOrder: maxOrder + 1 };
  if (!data.views) data.views = [];
  data.views.push(view);
  data.activeViewId = view.id;
  return view;
}

export function updateView(data, viewId, updates) {
  const view = (data.views || []).find(v => v.id === viewId);
  if (view) Object.assign(view, updates);
  return view;
}

export function deleteView(data, viewId) {
  data.views = (data.views || []).filter(v => v.id !== viewId);
  if (data.activeViewId === viewId) data.activeViewId = null;
}

// ── 사용자 API ────────────────────────────────────────────
export async function fetchUserNames() {
  const res = await fetch('/api/auth/names');
  if (!res.ok) throw new Error('사용자 조회 실패');
  return res.json();
}

export async function fetchUsers() {
  const res = await fetch('/api/auth/users', { headers: authHeaders() });
  if (!res.ok) throw new Error('사용자 조회 실패');
  return res.json();
}

export async function updateUserRole(userId, role) {
  const res = await fetch(`/api/auth/users/${userId}/role`, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ role })
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '변경 실패'); }
  return res.json();
}

export async function createUser(name, email, password, role) {
  const res = await fetch('/api/auth/users', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, email, password, role })
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '추가 실패'); }
  return res.json();
}

export async function deleteUser(userId) {
  const res = await fetch(`/api/auth/users/${userId}`, {
    method: 'DELETE', headers: authHeaders()
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '삭제 실패'); }
  return res.json();
}

export async function fetchPermissions() {
  const res = await fetch('/api/permissions', { headers: authHeaders() });
  if (!res.ok) throw new Error('권한 조회 실패');
  return res.json();
}

export async function savePermissions(perms) {
  const res = await fetch('/api/permissions', {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(perms)
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '저장 실패'); }
  return res.json();
}

export async function resetUserPassword(userId, password) {
  const res = await fetch(`/api/auth/users/${userId}/password`, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ password })
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '변경 실패'); }
  return res.json();
}

// ── 사용자별 레이아웃 ─────────────────────────────────────
export async function fetchLayout() {
  const res = await fetch('/api/layout', { headers: authHeaders() });
  if (!res.ok) return { tasks: {}, groups: {}, projects: {} };
  return res.json();
}

export function saveLayout(layout) {
  fetch('/api/layout', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(layout)
  }).catch(err => console.warn('[레이아웃 저장 실패]', err.message));
}
