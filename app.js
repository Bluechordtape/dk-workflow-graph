// app.js
import {
  loadData, saveData, exportJSON, importJSON, setSocketId,
  addProject, deleteProject,
  addTask, updateTask, deleteTask,
  addFlow, deleteFlow
} from './data.js';
import { Graph } from './graph.js';

let data = null;
let graph = null;
let activeTaskId = null;
let currentUser = null;

// ── 로그인 ────────────────────────────────────────────
const DEFAULT_USERS = ['창규', '민경', '진희', '정현'];
const USERS_KEY = 'dk_users';
const SESSION_KEY = 'dk_current_user';

function getUsers() {
  try {
    const saved = JSON.parse(localStorage.getItem(USERS_KEY));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  return [...DEFAULT_USERS];
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function initLogin() {
  return new Promise(resolve => {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) { currentUser = saved; resolve(); return; }

    const overlay = document.getElementById('login-overlay');
    const list    = document.getElementById('login-user-list');
    const addBtn  = document.getElementById('login-add-btn');
    const addRow  = document.getElementById('login-add-row');
    const nameIn  = document.getElementById('login-new-name');
    const confirmBtn = document.getElementById('login-confirm-add');

    function renderList() {
      list.innerHTML = '';
      getUsers().forEach(name => {
        const btn = document.createElement('button');
        btn.className = 'login-user-btn';
        btn.textContent = name;
        btn.addEventListener('click', () => selectUser(name));
        list.appendChild(btn);
      });
    }

    function selectUser(name) {
      currentUser = name;
      localStorage.setItem(SESSION_KEY, name);
      overlay.classList.add('hidden');
      updateUserBtn();
      resolve();
    }

    function addUser() {
      const name = nameIn.value.trim();
      if (!name) return;
      const users = getUsers();
      if (!users.includes(name)) { users.push(name); saveUsers(users); }
      selectUser(name);
    }

    addBtn.addEventListener('click', () => {
      addRow.classList.add('visible');
      addBtn.style.display = 'none';
      nameIn.focus();
    });
    confirmBtn.addEventListener('click', addUser);
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') addUser(); });

    renderList();
  });
}

function updateUserBtn() {
  const btn = document.getElementById('btn-switch-user');
  btn.textContent = currentUser ? `👤 ${currentUser}` : '로그인';
}

function showLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  const addRow  = document.getElementById('login-add-row');
  const addBtn  = document.getElementById('login-add-btn');
  const nameIn  = document.getElementById('login-new-name');
  const list    = document.getElementById('login-user-list');

  addRow.classList.remove('visible');
  addBtn.style.display = '';
  nameIn.value = '';
  list.innerHTML = '';
  getUsers().forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'login-user-btn';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      currentUser = name;
      localStorage.setItem(SESSION_KEY, name);
      overlay.classList.add('hidden');
      updateUserBtn();
    });
    list.appendChild(btn);
  });

  const confirmBtn = document.getElementById('login-confirm-add');
  const addBtn2    = document.getElementById('login-add-btn');
  addBtn2.addEventListener('click', () => {
    addRow.classList.add('visible');
    addBtn2.style.display = 'none';
    nameIn.focus();
  }, { once: true });
  confirmBtn.onclick = () => {
    const name = nameIn.value.trim();
    if (!name) return;
    const users = getUsers();
    if (!users.includes(name)) { users.push(name); saveUsers(users); }
    currentUser = name;
    localStorage.setItem(SESSION_KEY, name);
    overlay.classList.add('hidden');
    updateUserBtn();
  };

  overlay.classList.remove('hidden');
}

// ── Socket.io ─────────────────────────────────────────────
function initSocket() {
  if (typeof io === 'undefined') return;
  const socket = io();
  socket.on('connect', () => setSocketId(socket.id));
  socket.on('data:updated', (newData) => {
    data = newData;
    graph.setData(data);
    buildFilters();
  });
}

// ── 초기화 ───────────────────────────────────────────────
async function init() {
  await initLogin();
  initSocket();
  data = await loadData();

  graph = new Graph(document.getElementById('graph-container'), {
    onNodeClick:    (task) => openPanel(task),
    onNodeCreate:   (x, y) => {
      const task = addTask(data, { x, y, projectId: document.getElementById('filter-project').value || data.projects[0]?.id, assignee: currentUser || '' });
      saveData(data);
      graph.setData(data);
      openPanel(task);
    },
    onFlowCreate:   (fromId, toId) => { addFlow(data, fromId, toId); saveData(data); graph.setData(data); },
    onFlowDelete:   (flowId)       => { deleteFlow(data, flowId);    saveData(data); graph.setData(data); },
    onStatusChange: (taskId, st)   => {
      updateTask(data, taskId, { status: st });
      saveData(data);
      graph.setData(data);
      if (activeTaskId === taskId) document.getElementById('task-status').value = st;
    },
    onNodeMoved: () => saveData(data)
  });

  graph.setData(data);
  buildFilters();
  setupToolbar();
  setupPanel();
  updateUserBtn();
  document.getElementById('btn-switch-user').addEventListener('click', showLoginOverlay);
}

// ── 필터 ─────────────────────────────────────────────────
function buildFilters() {
  const assignees = new Set(data.tasks.map(t => t.assignee).filter(Boolean));
  const asel = document.getElementById('filter-assignee');
  const av = asel.value;
  asel.innerHTML = '<option value="">담당자 전체</option>';
  assignees.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; asel.appendChild(o); });
  asel.value = av;

  const psel = document.getElementById('filter-project');
  const pv = psel.value;
  psel.innerHTML = '<option value="">프로젝트 전체</option>';
  data.projects.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; psel.appendChild(o); });
  psel.value = pv;

  // 패널 내 프로젝트 셀렉트
  const ps = document.getElementById('task-project');
  const ppv = ps.value;
  ps.innerHTML = '';
  data.projects.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; ps.appendChild(o); });
  ps.value = ppv;

  // 컨펌 대기 뱃지
  const pending = data.tasks.filter(t => t.status === 'review').length;
  document.getElementById('pending-badge').textContent = pending > 0 ? pending : '';
  document.getElementById('pending-badge').style.display = pending > 0 ? '' : 'none';
}

function applyFilter() {
  graph.setFilter({
    assignee: document.getElementById('filter-assignee').value,
    project:  document.getElementById('filter-project').value,
    status:   document.getElementById('filter-status').value
  });
}

// ── 툴바 ─────────────────────────────────────────────────
function setupToolbar() {
  ['filter-assignee','filter-project','filter-status'].forEach(id =>
    document.getElementById(id).addEventListener('change', applyFilter)
  );

  document.getElementById('btn-reset-view').addEventListener('click', () => graph.resetView());
  document.getElementById('btn-export').addEventListener('click', () => exportJSON(data));
  document.getElementById('btn-import').addEventListener('click', () =>
    importJSON(d => { data = d; graph.setData(data); buildFilters(); closePanel(); })
  );

  document.getElementById('btn-add-project').addEventListener('click', () => {
    const name = prompt('새 프로젝트 이름:');
    if (!name) return;
    addProject(data, name);
    saveData(data);
    buildFilters();
  });

  document.getElementById('btn-add-task').addEventListener('click', () => {
    const task = addTask(data, { x: 120 + Math.random() * 200, y: 120 + Math.random() * 200, assignee: currentUser || '' });
    saveData(data);
    graph.setData(data);
    openPanel(task);
  });
}

// ── 사이드 패널 ──────────────────────────────────────────
function setupPanel() {
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.getElementById('btn-save-task').addEventListener('click', saveTask);
  document.getElementById('btn-delete-task').addEventListener('click', deleteTaskBtn);
  document.getElementById('btn-add-subtask').addEventListener('click', addSubtask);
}

function openPanel(task) {
  activeTaskId = task.id;
  document.getElementById('side-panel').classList.add('open');
  document.getElementById('task-name').value    = task.name;
  document.getElementById('task-project').value = task.projectId;
  document.getElementById('task-assignee').value = task.assignee;
  document.getElementById('task-status').value  = task.status;
  document.getElementById('task-note').value    = task.note || '';
  renderSubtasks(task);
}

function closePanel() {
  document.getElementById('side-panel').classList.remove('open');
  activeTaskId = null;
}

function saveTask() {
  if (!activeTaskId) return;
  updateTask(data, activeTaskId, {
    name:      document.getElementById('task-name').value,
    projectId: document.getElementById('task-project').value,
    assignee:  document.getElementById('task-assignee').value,
    status:    document.getElementById('task-status').value,
    note:      document.getElementById('task-note').value
  });
  saveData(data);
  graph.setData(data);
  buildFilters();
}

function deleteTaskBtn() {
  if (!activeTaskId) return;
  const task = data.tasks.find(t => t.id === activeTaskId);
  if (!confirm(`"${task?.name}" 업무를 삭제할까요?`)) return;
  deleteTask(data, activeTaskId);
  saveData(data);
  graph.setData(data);
  buildFilters();
  closePanel();
}

// ── 세부업무 ─────────────────────────────────────────────
function renderSubtasks(task) {
  const list = document.getElementById('subtask-list');
  list.innerHTML = '';
  (task.subtasks || []).forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'subtask-row';
    row.innerHTML = `
      <input type="checkbox" ${s.status === 'done' ? 'checked' : ''}>
      <input type="text" class="sub-name" value="${s.name}">
      <button class="sub-del">×</button>`;
    row.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
      s.status = e.target.checked ? 'done' : 'pending';
      saveData(data); graph.setData(data);
    });
    row.querySelector('.sub-name').addEventListener('change', (e) => {
      s.name = e.target.value; saveData(data);
    });
    row.querySelector('.sub-del').addEventListener('click', () => {
      task.subtasks.splice(i, 1);
      saveData(data); graph.setData(data);
      renderSubtasks(task);
    });
    list.appendChild(row);
  });
}

function addSubtask() {
  if (!activeTaskId) return;
  const task = data.tasks.find(t => t.id === activeTaskId);
  if (!task) return;
  if (!task.subtasks) task.subtasks = [];
  task.subtasks.push({ id: `s_${Date.now()}`, name: '새 세부업무', status: 'pending' });
  saveData(data); graph.setData(data);
  renderSubtasks(task);
}

init();
