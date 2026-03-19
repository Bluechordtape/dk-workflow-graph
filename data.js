// data.js — 데이터 관리 (REST API + Socket.io 실시간 동기화)

// ── Socket.io 클라이언트 ID (자신의 변경사항 echo 방지) ──
let _socketId = null;
export function setSocketId(id) { _socketId = id; }

// ── API 헬퍼 ─────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (_socketId) headers['x-socket-id'] = _socketId;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── 데이터 로드 ───────────────────────────────────────────
export async function loadData() {
  try {
    const data = await apiFetch('/api/data');
    if (data) {
      if (!data.flows) data.flows = [];
      return data;
    }
  } catch (err) {
    console.warn('[data] 서버 연결 실패, 샘플 데이터 사용:', err.message);
  }

  // 서버 없을 때 fallback: sample-data.json
  const res = await fetch('./sample-data.json');
  const data = await res.json();
  if (!data.flows) data.flows = [];
  return data;
}

// ── 데이터 저장 (fire-and-forget) ────────────────────────
export function saveData(data) {
  apiFetch('/api/data', {
    method: 'PUT',
    body: JSON.stringify(data)
  }).catch(err => console.error('[data] 저장 실패:', err.message));
}

// ── JSON 내보내기 / 불러오기 ──────────────────────────────
export function exportJSON(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dk-workflow-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importJSON(callback) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      saveData(data);
      callback(data);
    } catch {
      alert('JSON 파일을 읽는 중 오류가 발생했습니다.');
    }
  };
  input.click();
}

// ── ID 생성 ───────────────────────────────────────────────
export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── CRUD 헬퍼 (in-place 변경, 이후 saveData 호출) ─────────

export function addProject(data, name, color) {
  const project = {
    id: generateId('p'),
    name,
    color: color || randomColor(),
    categories: []
  };
  data.projects.push(project);
  return project;
}

export function deleteProject(data, projectId) {
  data.projects = data.projects.filter(p => p.id !== projectId);
}

export function addCategory(project, name) {
  const cat = { id: generateId('c'), name, tasks: [] };
  project.categories.push(cat);
  return cat;
}

export function deleteCategory(project, categoryId) {
  project.categories = project.categories.filter(c => c.id !== categoryId);
}

export function addTask(category, taskData) {
  const task = {
    id: generateId('t'),
    name: taskData.name || '새 태스크',
    assignee: taskData.assignee || '',
    status: taskData.status || 'todo',
    note: taskData.note || '',
    dueDate: taskData.dueDate || ''
  };
  category.tasks.push(task);
  return task;
}

export function deleteTask(category, taskId) {
  category.tasks = category.tasks.filter(t => t.id !== taskId);
}

export function updateTask(category, taskId, updates) {
  const task = category.tasks.find(t => t.id === taskId);
  if (task) Object.assign(task, updates);
  return task;
}

export function moveTask(category, taskId, direction) {
  const idx = category.tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return;
  const swap = direction === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= category.tasks.length) return;
  [category.tasks[idx], category.tasks[swap]] = [category.tasks[swap], category.tasks[idx]];
}

// ── Flow 헬퍼 ─────────────────────────────────────────────

export function addFlow(data, fromId, toId) {
  if (!data.flows) data.flows = [];
  if (data.flows.some(f => f.from === fromId && f.to === toId)) return null;
  const flow = { id: generateId('f'), from: fromId, to: toId };
  data.flows.push(flow);
  return flow;
}

export function deleteFlow(data, flowId) {
  if (!data.flows) return;
  data.flows = data.flows.filter(f => f.id !== flowId);
}

export function cleanFlows(data) {
  if (!data.flows) return;
  const taskIds = new Set();
  data.projects.forEach(p => p.categories.forEach(c => c.tasks.forEach(t => taskIds.add(t.id))));
  data.flows = data.flows.filter(f => taskIds.has(f.from) && taskIds.has(f.to));
}

export function findTaskContext(data, taskId) {
  for (const project of data.projects) {
    for (const category of project.categories) {
      const task = category.tasks.find(t => t.id === taskId);
      if (task) return { project, category, task };
    }
  }
  return null;
}

const COLORS = ['#7C3AED', '#0891B2', '#059669', '#DC2626', '#D97706', '#DB2777', '#2563EB', '#16A34A'];
let colorIdx = 0;
function randomColor() { return COLORS[colorIdx++ % COLORS.length]; }
