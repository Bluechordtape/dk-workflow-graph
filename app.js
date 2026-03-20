// app.js
import {
  loadData, saveData, saveTaskStatus, exportJSON, importJSON,
  setSocketId, setToken,
  addProject, deleteProject,
  addTask, updateTask, deleteTask,
  addFlow, deleteFlow
} from './data.js';
import { Graph } from './graph.js';

let data = null;
let graph = null;
let activeTaskId = null;
let currentUser = null; // { id, email, name, role }

const TOKEN_KEY = 'dk_jwt';

// ── 인증 ─────────────────────────────────────────────────
async function checkAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) { localStorage.removeItem(TOKEN_KEY); return null; }
    setToken(token);
    return await res.json();
  } catch {
    return null;
  }
}

async function login(name, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || '로그인 실패');
  localStorage.setItem(TOKEN_KEY, body.token);
  setToken(body.token);
  return body.user;
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  setToken(null);
  currentUser = null;
  showLoginOverlay();
}

// ── 로그인 UI ─────────────────────────────────────────────
function showLoginOverlay() {
  const overlay  = document.getElementById('login-overlay');
  const errorEl  = document.getElementById('login-error');
  const sel      = document.getElementById('login-name-select');
  const passIn   = document.getElementById('login-password');
  const submitBtn = document.getElementById('login-submit');

  // 초기화
  errorEl.style.display = 'none';
  passIn.value = '';
  overlay.classList.remove('hidden');

  // 드롭다운 초기화 (HTML에 옵션이 이미 있으므로 첫 번째 항목만 선택)
  sel.selectedIndex = 0;

  // 기존 리스너 제거 (재호출 시 중복 방지)
  const newBtn = submitBtn.cloneNode(true);
  submitBtn.replaceWith(newBtn);

  async function doLogin() {
    const name = document.getElementById('login-name-select').value;
    const pass = document.getElementById('login-password').value;
    if (!name) { showLoginError('이름을 선택하세요'); return; }
    if (!pass)  { showLoginError('비밀번호를 입력하세요'); return; }

    newBtn.disabled = true;
    newBtn.textContent = '로그인 중...';
    try {
      currentUser = await login(name, pass);
      overlay.classList.add('hidden');
      await startApp();
    } catch (err) {
      showLoginError(err.message);
      newBtn.disabled = false;
      newBtn.textContent = '로그인';
    }
  }

  newBtn.addEventListener('click', doLogin);
  document.getElementById('login-password').addEventListener('keydown', function h(e) {
    if (e.key === 'Enter') { this.removeEventListener('keydown', h); doLogin(); }
  });

  setTimeout(() => sel.focus(), 50);
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = '';
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

// ── 앱 시작 (로그인 후) ───────────────────────────────────
async function startApp() {
  if (!graph) {
    initSocket();

    graph = new Graph(document.getElementById('graph-container'), {
      onNodeClick: (task) => openPanel(task),
      onNodeCreate: (x, y) => {
        if (!canWrite()) return;
        const task = addTask(data, {
          x, y,
          projectId: document.getElementById('filter-project').value || data.projects[0]?.id,
          assignee: currentUser.name
        });
        saveData(data);
        graph.setData(data);
        openPanel(task);
      },
      onFlowCreate: (fromId, toId) => {
        if (!canWrite()) return;
        addFlow(data, fromId, toId); saveData(data); graph.setData(data);
      },
      onFlowDelete: (flowId) => {
        if (!canWrite()) return;
        deleteFlow(data, flowId); saveData(data); graph.setData(data);
      },
      onStatusChange: async (taskId, st) => {
        if (currentUser.role === 'member') {
          try {
            const result = await saveTaskStatus(taskId, st);
            data = result.data;
            graph.setData(data);
            if (activeTaskId === taskId) document.getElementById('task-status').value = st;
          } catch (err) { alert(err.message); }
        } else {
          updateTask(data, taskId, { status: st });
          saveData(data);
          graph.setData(data);
          if (activeTaskId === taskId) document.getElementById('task-status').value = st;
        }
      },
      onNodeMoved: () => { if (canWrite()) saveData(data); }
    });
  }

  data = await loadData();
  if (!data) { logout(); return; }

  graph.setData(data);
  graph.setUserContext(currentUser);
  buildFilters();
  setupToolbar();
  setupPanel();
  applyRoleUI();
  updateUserBtn();
}

// ── 역할 권한 헬퍼 ────────────────────────────────────────
function canWrite() {
  return currentUser?.role === 'admin' || currentUser?.role === 'manager';
}
function isAdmin() { return currentUser?.role === 'admin'; }

// ── 역할별 UI 제어 ────────────────────────────────────────
function applyRoleUI() {
  const role = currentUser?.role;

  // member/manager: 업무·프로젝트 추가 숨김
  const hideCreate = role === 'member' || role === 'manager';
  document.getElementById('btn-add-task').style.display    = hideCreate ? 'none' : '';
  document.getElementById('btn-add-project').style.display = hideCreate ? 'none' : '';
  document.getElementById('btn-import').style.display      = isAdmin()  ? '' : 'none';
  document.getElementById('btn-export').style.display      = isAdmin()  ? '' : 'none';

  // 패널 저장/삭제 버튼
  document.getElementById('btn-save-task').style.display   = canWrite() ? '' : 'none';
  document.getElementById('btn-delete-task').style.display = isAdmin()  ? '' : 'none';

  // member: 업무명·담당자·상태 수정 불가 (메모만 가능)
  const readOnly = role === 'member';
  ['task-name', 'task-assignee'].forEach(id => {
    document.getElementById(id).readOnly = readOnly;
    document.getElementById(id).style.background = readOnly ? '#F5F5F5' : '';
  });
  document.getElementById('task-project').disabled = readOnly;
  document.getElementById('task-status').disabled  = readOnly;
  document.getElementById('btn-add-subtask').style.display = canWrite() ? '' : 'none';
}

// ── 툴바 유저 버튼 ────────────────────────────────────────
function updateUserBtn() {
  const btn = document.getElementById('btn-switch-user');
  const roleLabel = { admin: '관리자', manager: '매니저', member: '멤버' };
  btn.innerHTML = `
    ${currentUser?.name || '?'}
    <span class="role-badge ${currentUser?.role}">${roleLabel[currentUser?.role] || ''}</span>
  `;
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

  const ps = document.getElementById('task-project');
  const ppv = ps.value;
  ps.innerHTML = '';
  data.projects.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; ps.appendChild(o); });
  ps.value = ppv;

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
    if (!canWrite()) return;
    const name = prompt('새 프로젝트 이름:');
    if (!name) return;
    addProject(data, name);
    saveData(data);
    buildFilters();
  });
  document.getElementById('btn-add-task').addEventListener('click', () => {
    if (!canWrite()) return;
    const task = addTask(data, { x: 120 + Math.random() * 200, y: 120 + Math.random() * 200, assignee: currentUser.name });
    saveData(data);
    graph.setData(data);
    openPanel(task);
  });
  document.getElementById('btn-switch-user').addEventListener('click', () => {
    if (confirm(`${currentUser?.name}님, 로그아웃 하시겠습니까?`)) logout();
  });
}

// ── 사이드 패널 ──────────────────────────────────────────
let panelSetup = false;
function setupPanel() {
  if (panelSetup) return;
  panelSetup = true;
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.getElementById('btn-save-task').addEventListener('click', saveTask);
  document.getElementById('btn-delete-task').addEventListener('click', deleteTaskBtn);
  document.getElementById('btn-add-subtask').addEventListener('click', addSubtask);
}

function openPanel(task) {
  activeTaskId = task.id;
  document.getElementById('side-panel').classList.add('open');
  document.getElementById('task-name').value     = task.name;
  document.getElementById('task-project').value  = task.projectId;
  document.getElementById('task-assignee').value = task.assignee;
  document.getElementById('task-status').value   = task.status;
  document.getElementById('task-note').value     = task.note || '';
  renderSubtasks(task);
}

function closePanel() {
  document.getElementById('side-panel').classList.remove('open');
  activeTaskId = null;
}

function saveTask() {
  if (!activeTaskId || !canWrite()) return;
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
  if (!activeTaskId || !isAdmin()) return;
  const task = data.tasks.find(t => t.id === activeTaskId);
  if (!confirm(`"${task?.name}" 업무를 삭제할까요?`)) return;
  deleteTask(data, activeTaskId);
  saveData(data);
  graph.setData(data);
  buildFilters();
  closePanel();
}

// ── 세부업무 ─────────────────────────────────────────────
function renderSubtasks(task, focusLast = false) {
  const list = document.getElementById('subtask-list');
  list.innerHTML = '';
  (task.subtasks || []).forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'subtask-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = s.status === 'done';
    cb.addEventListener('change', (e) => {
      s.status = e.target.checked ? 'done' : 'pending';
      saveData(data);
      graph.setData(data);
    });

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'sub-name';
    nameInput.value = s.name;
    nameInput.placeholder = '세부업무 이름';
    nameInput.readOnly = !canWrite();
    nameInput.style.background = canWrite() ? '' : '#F5F5F5';
    nameInput.addEventListener('input', (e) => { s.name = e.target.value; });
    nameInput.addEventListener('blur', () => saveData(data));

    const delBtn = document.createElement('button');
    delBtn.className = 'sub-del';
    delBtn.textContent = '×';
    delBtn.style.display = canWrite() ? '' : 'none';
    delBtn.addEventListener('click', () => {
      task.subtasks.splice(i, 1);
      saveData(data);
      graph.setData(data);
      renderSubtasks(task);
    });

    row.appendChild(cb);
    row.appendChild(nameInput);
    row.appendChild(delBtn);
    list.appendChild(row);
  });

  if (focusLast && list.lastChild) {
    const input = list.lastChild.querySelector('.sub-name');
    if (input) { input.focus(); input.select(); }
  }
}

function addSubtask() {
  if (!activeTaskId || !canWrite()) return;
  const task = data.tasks.find(t => t.id === activeTaskId);
  if (!task) return;
  if (!task.subtasks) task.subtasks = [];
  task.subtasks.push({ id: `s_${Date.now()}`, name: '', status: 'pending' });
  renderSubtasks(task, true);
  saveData(data);
  graph.setData(data);
}

// ── 진입점 ───────────────────────────────────────────────
async function init() {
  currentUser = await checkAuth();
  if (!currentUser) {
    showLoginOverlay();
  } else {
    await startApp();
  }
}

init();
