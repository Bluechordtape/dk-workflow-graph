// data.js

let _socketId = null;
export function setSocketId(id) { _socketId = id; }

// ── 로드 ─────────────────────────────────────────────────
export async function loadData() {
  try {
    const res = await fetch('/api/data');
    if (res.ok) {
      const d = await res.json();
      if (d && d.tasks) return normalize(d);
    }
  } catch {}
  const res = await fetch('./sample-data.json');
  return normalize(await res.json());
}

function normalize(d) {
  if (!d.projects) d.projects = [];
  if (!d.tasks)    d.tasks    = [];
  if (!d.flows)    d.flows    = [];
  return d;
}

// ── 저장 ─────────────────────────────────────────────────
export function saveData(data) {
  const headers = { 'Content-Type': 'application/json' };
  if (_socketId) headers['x-socket-id'] = _socketId;
  fetch('/api/data', { method: 'PUT', headers, body: JSON.stringify(data) })
    .catch(err => console.error('저장 실패:', err));
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
    try { const d = JSON.parse(text); saveData(d); callback(d); }
    catch { alert('파일을 읽을 수 없습니다.'); }
  };
  input.click();
}

// ── ID 생성 ───────────────────────────────────────────────
export function generateId(p = 'id') {
  return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── 프로젝트 ──────────────────────────────────────────────
const COLORS = ['#7C3AED','#0891B2','#059669','#DC2626','#D97706','#DB2777','#2563EB','#16A34A'];
let ci = 0;

export function addProject(data, name) {
  const p = { id: generateId('p'), name, color: COLORS[ci++ % COLORS.length] };
  data.projects.push(p);
  return p;
}

export function deleteProject(data, projectId) {
  data.projects = data.projects.filter(p => p.id !== projectId);
  const removed = new Set(data.tasks.filter(t => t.projectId === projectId).map(t => t.id));
  data.tasks = data.tasks.filter(t => t.projectId !== projectId);
  data.flows = data.flows.filter(f => !removed.has(f.from) && !removed.has(f.to));
}

// ── 업무 ─────────────────────────────────────────────────
export function addTask(data, { name, projectId, x = 100, y = 100 }) {
  const task = {
    id: generateId('t'),
    projectId: projectId || data.projects[0]?.id || '',
    name: name || '새 업무',
    assignee: '',
    status: 'todo',
    note: '',
    subtasks: [],
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
