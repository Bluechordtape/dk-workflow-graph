// app.js
import {
  loadData, saveData, saveTaskStatus, exportJSON, importJSON,
  setSocketId, setToken,
  addProject, deleteProject,
  addTask, updateTask, deleteTask,
  addFlow, deleteFlow,
  updateTaskMember,
  addGroup, deleteGroup, GROUP_COLORS,
  fetchTemplates, saveTemplate, deleteTemplate,
  fetchBackups, createBackup, restoreBackup, deleteBackup,
  addSheet, deleteSheet, copyTaskToSheet, normalize
} from './data.js';
import { Graph } from './graph.js';

let data = null;
let graph = null;
let activeTaskId = null;
let currentUser = null; // { id, email, name, role }

const TOKEN_KEY = 'dk_jwt';

// ── 현재 시트 헬퍼 ────────────────────────────────────────
function cs() {
  return data.sheets.find(s => s.id === data.activeSheetId) || data.sheets[0];
}

// ── 언도/리두 ─────────────────────────────────────────────
let undoStack = [];
let redoStack = [];

function pushUndo() {
  undoStack.push(JSON.parse(JSON.stringify(data)));
  if (undoStack.length > 30) undoStack.shift();
  redoStack = [];
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.parse(JSON.stringify(data)));
  if (redoStack.length > 30) redoStack.shift();
  data = normalize(undoStack.pop());
  saveData(data);
  graph.setData(cs());
  buildFilters();
  renderSheetTabs();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.parse(JSON.stringify(data)));
  data = normalize(redoStack.pop());
  saveData(data);
  graph.setData(cs());
  buildFilters();
  renderSheetTabs();
}

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
let _loginBusy = false;

function showLoginOverlay() {
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-password').value = '';
  document.getElementById('login-name-select').selectedIndex = 0;
  _loginBusy = false;
  setTimeout(() => document.getElementById('login-name-select').focus(), 50);
}

async function doLogin() {
  if (_loginBusy) return;
  const name = document.getElementById('login-name-select').value;
  const pass = document.getElementById('login-password').value;
  if (!name) { showLoginError('이름을 선택하세요'); return; }
  if (!pass)  { showLoginError('비밀번호를 입력하세요'); return; }

  _loginBusy = true;
  const btn = document.getElementById('login-submit');
  btn.disabled = true;
  btn.textContent = '로그인 중...';

  try {
    currentUser = await login(name, pass);
    document.getElementById('login-overlay').classList.add('hidden');
    await startApp();
  } catch (err) {
    showLoginError(err.message);
  } finally {
    _loginBusy = false;
    btn.disabled = false;
    btn.textContent = '로그인';
  }
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
    data = normalize(newData);
    graph.setData(cs());
    buildFilters();
    renderSheetTabs();
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
        pushUndo();
        const task = addTask(cs(), {
          x, y,
          projectId: document.getElementById('filter-project').value || cs().projects[0]?.id,
          assignee: currentUser.name
        });
        saveData(data);
        graph.setData(cs());
        openPanel(task);
      },
      onFlowCreate: (fromId, toId) => {
        if (!canWrite()) return;
        pushUndo();
        addFlow(cs(), fromId, toId); saveData(data); graph.setData(cs());
      },
      onFlowDelete: (flowId) => {
        if (!canWrite()) return;
        pushUndo();
        deleteFlow(cs(), flowId); saveData(data); graph.setData(cs());
      },
      onStatusChange: async (taskId, st) => {
        if (!canWrite()) {
          try {
            const result = await saveTaskStatus(taskId, st);
            data = result.data;
            graph.setData(cs());
            if (activeTaskId === taskId) document.getElementById('task-status').value = st;
          } catch (err) { alert(err.message); }
        } else {
          pushUndo();
          updateTask(cs(), taskId, { status: st });
          saveData(data);
          graph.setData(cs());
          if (activeTaskId === taskId) document.getElementById('task-status').value = st;
        }
      },
      onNodeMoved: () => { if (canWrite()) saveData(data); }
    });

    // 키보드 단축키
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault(); undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault(); redo();
      }
    });
  }

  data = await loadData();
  if (!data) { logout(); return; }

  graph.setData(cs());
  graph.setUserContext(currentUser);
  buildFilters();
  setupToolbar();
  setupPanel();
  applyRoleUI();
  updateUserBtn();
  renderSheetTabs();
}

// ── 역할 권한 헬퍼 ────────────────────────────────────────
function canWrite() {
  return ['admin', 'leader', 'manager'].includes(currentUser?.role);
}
function isAdmin() { return currentUser?.role === 'admin'; }

// ── 역할별 UI 제어 ────────────────────────────────────────
function applyRoleUI() {
  const isMember = currentUser?.role === 'member';

  document.getElementById('btn-add-task').style.display        = canWrite() ? '' : 'none';
  document.getElementById('btn-add-project').style.display     = canWrite() ? '' : 'none';
  document.getElementById('btn-manage-projects').style.display = canWrite() ? '' : 'none';
  document.getElementById('btn-import').style.display          = isAdmin()  ? '' : 'none';
  document.getElementById('btn-export').style.display          = isAdmin()  ? '' : 'none';
  document.getElementById('btn-backup').style.display          = isAdmin()  ? '' : 'none';
  document.getElementById('btn-template-save').style.display   = isAdmin()  ? '' : 'none';
  document.getElementById('btn-template-load').style.display   = '';

  document.getElementById('btn-save-task').style.display   = '';
  document.getElementById('btn-delete-task').style.display = isAdmin() ? '' : 'none';

  ['task-name', 'task-assignee'].forEach(id => {
    document.getElementById(id).readOnly = isMember;
    document.getElementById(id).style.background = isMember ? '#F5F5F5' : '';
  });
  document.getElementById('task-project').disabled  = isMember;
  document.getElementById('task-due-date').readOnly = isMember;
  document.getElementById('task-group').disabled    = isMember;
  document.getElementById('task-status').disabled   = false;
  document.getElementById('btn-add-subtask').style.display   = canWrite() ? '' : 'none';
  document.getElementById('btn-manage-groups').style.display = canWrite() ? '' : 'none';
}

// ── 툴바 유저 버튼 ────────────────────────────────────────
function updateUserBtn() {
  const btn = document.getElementById('btn-switch-user');
  const roleLabel = { admin: '관리자', leader: '팀장', manager: '과장', member: '팀원' };
  btn.innerHTML = `
    ${currentUser?.name || '?'}
    <span class="role-badge ${currentUser?.role}">${roleLabel[currentUser?.role] || ''}</span>
  `;
}

// ── 필터 ─────────────────────────────────────────────────
function buildFilters() {
  const sheet = cs();
  const assignees = new Set(sheet.tasks.map(t => t.assignee).filter(Boolean));
  const asel = document.getElementById('filter-assignee');
  const av = asel.value;
  asel.innerHTML = '<option value="">담당자 전체</option>';
  assignees.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; asel.appendChild(o); });
  asel.value = av;

  const psel = document.getElementById('filter-project');
  const pv = psel.value;
  psel.innerHTML = '<option value="">프로젝트 전체</option>';
  sheet.projects.filter(p => !p.archived).forEach(p => {
    const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; psel.appendChild(o);
  });
  const archived = sheet.projects.filter(p => p.archived);
  if (archived.length) {
    const sep = document.createElement('option'); sep.disabled = true; sep.textContent = '── 보관됨 ──'; psel.appendChild(sep);
    archived.forEach(p => {
      const o = document.createElement('option'); o.value = p.id; o.textContent = `${p.name} (보관됨)`; psel.appendChild(o);
    });
  }
  psel.value = pv;

  const ps = document.getElementById('task-project');
  const ppv = ps.value;
  ps.innerHTML = '';
  sheet.projects.filter(p => !p.archived).forEach(p => {
    const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; ps.appendChild(o);
  });
  ps.value = ppv;

  const pending = sheet.tasks.filter(t => t.status === 'review').length;
  document.getElementById('pending-badge').textContent = pending > 0 ? pending : '';
  document.getElementById('pending-badge').style.display = pending > 0 ? '' : 'none';

  updateOverview();
}

function applyFilter() {
  graph.setFilter({
    assignee: document.getElementById('filter-assignee').value,
    project:  document.getElementById('filter-project').value,
    status:   document.getElementById('filter-status').value
  });
  updateOverview();
}

function updateOverview() {
  const bar = document.getElementById('overview-bar');
  const sheet = cs();
  if (!sheet?.tasks) { bar.style.display = 'none'; return; }

  const projectFilter  = document.getElementById('filter-project').value;
  const assigneeFilter = document.getElementById('filter-assignee').value;

  let tasks = sheet.tasks;
  if (projectFilter)  tasks = tasks.filter(t => t.projectId === projectFilter);
  if (assigneeFilter) tasks = tasks.filter(t => t.assignee  === assigneeFilter);

  if (tasks.length === 0) { bar.style.display = 'none'; return; }

  const total   = tasks.length;
  const done    = tasks.filter(t => t.status === 'done').length;
  const doing   = tasks.filter(t => t.status === 'doing').length;
  const review  = tasks.filter(t => t.status === 'review').length;
  const pending = tasks.filter(t => t.status === 'pending').length;

  const donePct  = Math.round(done  / total * 100);
  const doingPct = Math.round(doing / total * 100);

  const projectName = projectFilter
    ? (sheet.projects.find(p => p.id === projectFilter)?.name || '프로젝트')
    : '전체 프로젝트';

  const metaParts = [];
  if (done)    metaParts.push(`완료 ${done}개`);
  if (doing)   metaParts.push(`진행중 ${doing}개`);
  if (review)  metaParts.push(`완료요청 ${review}개`);
  if (pending) metaParts.push(`대기 ${pending}개`);

  bar.style.display = '';
  bar.innerHTML = `
    <span class="ov-name">${projectName}</span>
    <div class="ov-bar">
      <div class="ov-bar-done" style="width:${donePct}%"></div>
      <div class="ov-bar-doing" style="left:${donePct}%;width:${doingPct}%"></div>
    </div>
    <span class="ov-pct">${donePct}%</span>
    <span class="ov-sep">·</span>
    <span class="ov-meta">전체 ${total}개 중 ${metaParts.join(', ')}</span>
  `;
}

// ── 시트 탭 ──────────────────────────────────────────────
function renderSheetTabs() {
  const container = document.getElementById('sheet-tabs');
  container.innerHTML = '';

  data.sheets.forEach(sheet => {
    const tab = document.createElement('div');
    tab.className = 'sheet-tab' + (sheet.id === data.activeSheetId ? ' active' : '');
    tab.dataset.id = sheet.id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'sheet-tab-name';
    nameSpan.textContent = sheet.name;
    nameSpan.addEventListener('dblclick', () => {
      if (!canWrite()) return;
      const newName = prompt('시트 이름:', sheet.name);
      if (newName?.trim()) {
        pushUndo();
        sheet.name = newName.trim();
        saveData(data);
        renderSheetTabs();
      }
    });
    tab.appendChild(nameSpan);

    if (canWrite() && data.sheets.length > 1) {
      const del = document.createElement('button');
      del.className = 'sheet-tab-del';
      del.textContent = '×';
      del.title = '시트 삭제';
      del.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm(`"${sheet.name}" 시트를 삭제할까요?\n시트 내 모든 업무가 삭제됩니다.`)) return;
        pushUndo();
        deleteSheet(data, sheet.id);
        saveData(data);
        graph.setData(cs());
        buildFilters();
        renderSheetTabs();
        applyRoleUI();
      });
      tab.appendChild(del);
    }

    tab.addEventListener('click', () => {
      if (data.activeSheetId === sheet.id) return;
      data.activeSheetId = sheet.id;
      saveData(data);
      graph.setData(cs());
      buildFilters();
      applyFilter();
      renderSheetTabs();
      applyRoleUI();
    });

    container.appendChild(tab);
  });

  if (canWrite() && data.sheets.length < 10) {
    const addBtn = document.createElement('button');
    addBtn.className = 'sheet-tab-add';
    addBtn.textContent = '+ 시트';
    addBtn.addEventListener('click', () => {
      const name = prompt('새 시트 이름:', `시트 ${data.sheets.length + 1}`);
      if (!name) return;
      pushUndo();
      addSheet(data, name.trim());
      saveData(data);
      graph.setData(cs());
      buildFilters();
      renderSheetTabs();
      applyRoleUI();
    });
    container.appendChild(addBtn);
  }
}

// ── 툴바 ─────────────────────────────────────────────────
let toolbarSetup = false;
function setupToolbar() {
  if (toolbarSetup) return;
  toolbarSetup = true;

  ['filter-assignee','filter-project','filter-status'].forEach(id =>
    document.getElementById(id).addEventListener('change', applyFilter)
  );
  document.getElementById('btn-reset-view').addEventListener('click', () => graph.resetView());
  document.getElementById('btn-export').addEventListener('click', () => exportJSON(data));
  document.getElementById('btn-import').addEventListener('click', () =>
    importJSON(d => { data = d; graph.setData(cs()); buildFilters(); closePanel(); renderSheetTabs(); })
  );
  document.getElementById('btn-add-project').addEventListener('click', () => {
    if (!canWrite()) return;
    const name = prompt('새 프로젝트 이름:');
    if (!name) return;
    pushUndo();
    addProject(cs(), name);
    saveData(data);
    buildFilters();
  });
  document.getElementById('btn-manage-projects').addEventListener('click', openProjectsModal);
  document.getElementById('btn-backup').addEventListener('click', openBackupModal);
  document.getElementById('btn-template-save').addEventListener('click', () => openModal('modal-save-template'));
  document.getElementById('btn-template-load').addEventListener('click', openTemplateLoadModal);
  document.getElementById('btn-add-task').addEventListener('click', () => {
    if (!canWrite()) return;
    pushUndo();
    const task = addTask(cs(), { x: 120 + Math.random() * 200, y: 120 + Math.random() * 200, assignee: currentUser.name });
    saveData(data);
    graph.setData(cs());
    openPanel(task);
  });
  document.getElementById('btn-logout').addEventListener('click', () => {
    if (confirm(`${currentUser?.name}님, 로그아웃 하시겠습니까?`)) logout();
  });
}

// ── 프로젝트 관리 모달 ────────────────────────────────────
function openProjectsModal() {
  renderProjectList();
  openModal('modal-projects');
}

function renderProjectList() {
  const list = document.getElementById('project-list');
  list.innerHTML = '';
  const sheet = cs();
  if (!sheet.projects.length) {
    list.innerHTML = '<div style="color:#9E9E9E;font-size:13px;padding:8px 0">생성된 프로젝트가 없습니다.</div>';
    return;
  }
  sheet.projects.forEach(p => {
    const item = document.createElement('div');
    item.className = 'tmpl-item';
    item.style.cursor = 'default';
    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex:1">
        <span style="width:12px;height:12px;border-radius:3px;background:${p.color};flex-shrink:0"></span>
        <span class="tmpl-item-name" style="${p.archived ? 'color:#9E9E9E;text-decoration:line-through' : ''}">${p.name}</span>
        ${p.archived ? '<span style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;background:#F5F5F5;color:#9E9E9E">보관됨</span>' : ''}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn-archive-p" style="height:26px;padding:0 10px;border-radius:5px;border:1px solid #E0E0E0;background:#FAFAFA;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer">
          ${p.archived ? '복구' : '보관'}
        </button>
        <button class="tmpl-del" title="삭제">×</button>
      </div>
    `;
    item.querySelector('.btn-archive-p').addEventListener('click', () => {
      pushUndo();
      p.archived = !p.archived;
      saveData(data);
      graph.setData(cs());
      buildFilters();
      renderProjectList();
    });
    item.querySelector('.tmpl-del').addEventListener('click', () => {
      if (!confirm(`"${p.name}" 프로젝트를 삭제할까요?\n모든 업무와 연결이 삭제됩니다.`)) return;
      pushUndo();
      deleteProject(cs(), p.id);
      saveData(data);
      graph.setData(cs());
      buildFilters();
      renderProjectList();
    });
    list.appendChild(item);
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
  document.getElementById('btn-copy-task').addEventListener('click', openCopyTaskModal);
}

function openPanel(task) {
  activeTaskId = task.id;
  document.getElementById('side-panel').classList.add('open');
  document.getElementById('task-name').value     = task.name;
  document.getElementById('task-project').value  = task.projectId;
  document.getElementById('task-assignee').value = task.assignee;
  document.getElementById('task-due-date').value = task.dueDate || '';
  document.getElementById('task-note').value     = task.note || '';

  const gs = document.getElementById('task-group');
  gs.innerHTML = '<option value="">그룹 없음</option>';
  (cs().groups || []).forEach(g => {
    const o = document.createElement('option');
    o.value = g.id; o.textContent = g.name;
    gs.appendChild(o);
  });
  gs.value = task.groupId || '';
  updateGroupSwatch(task.groupId);

  const statusEl = document.getElementById('task-status');
  const doneOpt = statusEl.querySelector('option[value="done"]');
  if (doneOpt) doneOpt.style.display = canWrite() ? '' : 'none';
  statusEl.value = task.status;

  document.getElementById('btn-copy-task').style.display =
    canWrite() && data.sheets.length > 1 ? '' : 'none';

  renderSubtasks(task);
}

function updateGroupSwatch(groupId) {
  const g = (cs().groups || []).find(g => g.id === groupId);
  const sw = document.getElementById('task-group-swatch');
  if (g) { sw.style.background = g.color; sw.style.display = ''; }
  else   { sw.style.display = 'none'; }
}

document.getElementById('task-group')?.addEventListener('change', e => {
  updateGroupSwatch(e.target.value);
});

function closePanel() {
  document.getElementById('side-panel').classList.remove('open');
  activeTaskId = null;
}

async function saveTask() {
  if (!activeTaskId) return;
  pushUndo();
  if (canWrite()) {
    updateTask(cs(), activeTaskId, {
      name:      document.getElementById('task-name').value,
      projectId: document.getElementById('task-project').value,
      assignee:  document.getElementById('task-assignee').value,
      status:    document.getElementById('task-status').value,
      dueDate:   document.getElementById('task-due-date').value || null,
      groupId:   document.getElementById('task-group').value || null,
      note:      document.getElementById('task-note').value
    });
    saveData(data);
    graph.setData(cs());
    buildFilters();
  } else {
    try {
      const task = cs().tasks.find(t => t.id === activeTaskId);
      const result = await updateTaskMember(activeTaskId, {
        note:     document.getElementById('task-note').value,
        status:   document.getElementById('task-status').value,
        subtasks: task?.subtasks
      });
      data = result.data;
      graph.setData(cs());
      buildFilters();
    } catch (err) { alert(err.message); return; }
  }
  closePanel();
}

function deleteTaskBtn() {
  if (!activeTaskId || !isAdmin()) return;
  const task = cs().tasks.find(t => t.id === activeTaskId);
  if (!confirm(`"${task?.name}" 업무를 삭제할까요?`)) return;
  pushUndo();
  deleteTask(cs(), activeTaskId);
  saveData(data);
  graph.setData(cs());
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
      if (canWrite()) saveData(data);
      graph.setData(cs());
    });

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'sub-name';
    nameInput.value = s.name;
    nameInput.placeholder = '세부업무 이름';
    nameInput.addEventListener('input', (e) => { s.name = e.target.value; });
    nameInput.addEventListener('blur', () => { if (canWrite()) saveData(data); });

    const delBtn = document.createElement('button');
    delBtn.className = 'sub-del';
    delBtn.textContent = '×';
    delBtn.style.display = canWrite() ? '' : 'none';
    delBtn.addEventListener('click', () => {
      task.subtasks.splice(i, 1);
      saveData(data);
      graph.setData(cs());
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
  const task = cs().tasks.find(t => t.id === activeTaskId);
  if (!task) return;
  if (!task.subtasks) task.subtasks = [];
  task.subtasks.push({ id: `s_${Date.now()}`, name: '', status: 'pending' });
  renderSubtasks(task, true);
  saveData(data);
  graph.setData(cs());
}

// ── 업무 복제 (다른 시트로) ───────────────────────────────
function openCopyTaskModal() {
  if (!activeTaskId) return;
  const sel = document.getElementById('copy-task-sheet');
  sel.innerHTML = '';
  data.sheets.filter(s => s.id !== data.activeSheetId).forEach(s => {
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o);
  });
  openModal('modal-copy-task');
}

document.getElementById('btn-copy-task-confirm').addEventListener('click', () => {
  const targetSheetId = document.getElementById('copy-task-sheet').value;
  if (!targetSheetId || !activeTaskId) return;
  pushUndo();
  copyTaskToSheet(data, activeTaskId, targetSheetId);
  saveData(data);
  closeModal('modal-copy-task');
  alert('복제됐습니다.');
});

// ── 그룹 관리 ────────────────────────────────────────────
let _selectedGroupColor = GROUP_COLORS[0];

function buildGroupColorPalette() {
  const el = document.getElementById('grp-color-palette');
  el.innerHTML = '';
  GROUP_COLORS.forEach(c => {
    const dot = document.createElement('div');
    dot.style.cssText = `width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;border:3px solid transparent;box-sizing:border-box;transition:border-color 0.1s`;
    if (c === _selectedGroupColor) dot.style.borderColor = '#212121';
    dot.addEventListener('click', () => {
      _selectedGroupColor = c;
      el.querySelectorAll('div').forEach(d => d.style.borderColor = 'transparent');
      dot.style.borderColor = '#212121';
    });
    el.appendChild(dot);
  });
}

function renderGroupList() {
  const list = document.getElementById('group-list');
  list.innerHTML = '';
  if (!(cs().groups || []).length) {
    list.innerHTML = '<div style="color:#9E9E9E;font-size:13px;padding:8px 0">생성된 그룹이 없습니다.</div>';
    return;
  }
  (cs().groups || []).forEach(g => {
    const item = document.createElement('div');
    item.className = 'tmpl-item';
    item.style.cursor = 'default';
    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex:1">
        <span style="width:12px;height:12px;border-radius:3px;background:${g.color};flex-shrink:0"></span>
        <span class="tmpl-item-name">${g.name}</span>
      </div>
      <button class="tmpl-del" data-id="${g.id}">×</button>
    `;
    item.querySelector('.tmpl-del').addEventListener('click', () => {
      if (!confirm(`"${g.name}" 그룹을 삭제할까요?`)) return;
      pushUndo();
      deleteGroup(cs(), g.id);
      saveData(data);
      graph.setData(cs());
      buildFilters();
      renderGroupList();
    });
    list.appendChild(item);
  });
}

document.getElementById('btn-manage-groups').addEventListener('click', () => {
  renderGroupList();
  openModal('modal-groups');
});

document.getElementById('btn-open-group-create').addEventListener('click', () => {
  _selectedGroupColor = GROUP_COLORS[0];
  document.getElementById('grp-name').value = '';
  buildGroupColorPalette();
  openModal('modal-group-create');
});

document.getElementById('btn-grp-save').addEventListener('click', () => {
  const name = document.getElementById('grp-name').value.trim();
  if (!name) { alert('그룹 이름을 입력하세요.'); return; }
  pushUndo();
  addGroup(cs(), name, _selectedGroupColor);
  saveData(data);
  graph.setData(cs());
  buildFilters();
  closeModal('modal-group-create');
  renderGroupList();
});

// ── 모달 ─────────────────────────────────────────────────
let _selectedTemplateId = null;

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.addEventListener('click', e => {
  const btn = e.target.closest('.modal-close, .btn-cancel');
  if (btn) { const id = btn.dataset.modal; if (id) closeModal(id); }
});

// ── 템플릿 저장 모달 ──
document.getElementById('btn-tmpl-save-confirm').addEventListener('click', async () => {
  const name = document.getElementById('tmpl-save-name').value.trim();
  const desc = document.getElementById('tmpl-save-desc').value.trim();
  if (!name) { alert('템플릿 이름을 입력하세요.'); return; }

  const sheet = cs();
  const templateData = {
    tasks: sheet.tasks.map(t => ({
      id: t.id, name: t.name, x: t.x, y: t.y,
      status: 'pending', assignee: '', note: '', subtasks: [], dueDate: null
    })),
    flows: sheet.flows.map(f => ({ id: f.id, from: f.from, to: f.to }))
  };

  try {
    await saveTemplate(name, desc, templateData);
    closeModal('modal-save-template');
    document.getElementById('tmpl-save-name').value = '';
    document.getElementById('tmpl-save-desc').value = '';
    alert('템플릿이 저장됐습니다.');
  } catch (err) { alert(err.message); }
});

// ── 템플릿 불러오기 모달 ──
async function openTemplateLoadModal() {
  _selectedTemplateId = null;
  const list = document.getElementById('tmpl-list');
  list.innerHTML = '<div style="color:#9E9E9E;font-size:13px;padding:8px 0">불러오는 중...</div>';
  openModal('modal-load-template');

  try {
    const templates = await fetchTemplates();
    list.innerHTML = '';
    if (templates.length === 0) {
      list.innerHTML = '<div style="color:#9E9E9E;font-size:13px;padding:8px 0">저장된 템플릿이 없습니다.</div>';
      return;
    }
    templates.forEach(t => {
      const item = document.createElement('div');
      item.className = 'tmpl-item';
      item.dataset.id = t.id;
      const date = new Date(t.created_at).toLocaleDateString('ko-KR', { month:'short', day:'numeric' });
      item.innerHTML = `
        <div class="tmpl-item-info">
          <div class="tmpl-item-name">${t.name}</div>
          ${t.description ? `<div class="tmpl-item-desc">${t.description}</div>` : ''}
        </div>
        <div class="tmpl-item-meta">${t.created_by} · ${date}</div>
        ${isAdmin() ? `<button class="tmpl-del" data-id="${t.id}" title="삭제">×</button>` : ''}
      `;
      item.addEventListener('click', e => {
        if (e.target.closest('.tmpl-del')) return;
        list.querySelectorAll('.tmpl-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        _selectedTemplateId = t.id;
        document.getElementById('tmpl-load-project').value = t.name;
        document.getElementById('tmpl-load-project').focus();
      });
      item.querySelector('.tmpl-del')?.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(`"${t.name}" 템플릿을 삭제할까요?`)) return;
        try { await deleteTemplate(t.id); item.remove(); if (_selectedTemplateId === t.id) _selectedTemplateId = null; }
        catch (err) { alert(err.message); }
      });
      list.appendChild(item);
    });
    if (templates.length > 0) list.firstChild.click();
  } catch (err) {
    list.innerHTML = `<div style="color:#C8102E;font-size:13px">${err.message}</div>`;
  }
}

document.getElementById('btn-tmpl-load-confirm').addEventListener('click', async () => {
  if (!_selectedTemplateId) { alert('템플릿을 선택하세요.'); return; }
  const projectName = document.getElementById('tmpl-load-project').value.trim();
  if (!projectName) { alert('프로젝트 이름을 입력하세요.'); return; }

  try {
    const templates = await fetchTemplates();
    const tmpl = templates.find(t => t.id === _selectedTemplateId);
    if (!tmpl) { alert('템플릿을 찾을 수 없습니다.'); return; }

    pushUndo();
    const project = addProject(cs(), projectName);
    const idMap = {};
    for (const t of tmpl.data.tasks) {
      const newTask = addTask(cs(), { name: t.name, projectId: project.id, x: t.x, y: t.y });
      idMap[t.id] = newTask.id;
    }
    for (const f of tmpl.data.flows) {
      if (idMap[f.from] && idMap[f.to]) addFlow(cs(), idMap[f.from], idMap[f.to]);
    }

    saveData(data);
    graph.setData(cs());
    buildFilters();
    document.getElementById('filter-project').value = project.id;
    applyFilter();
    closeModal('modal-load-template');
  } catch (err) { alert(err.message); }
});

// ── 백업 ─────────────────────────────────────────────────
async function openBackupModal() {
  openModal('modal-backup');
  await refreshBackupList();
}

async function refreshBackupList() {
  const list = document.getElementById('backup-list');
  list.innerHTML = '<div style="color:#9E9E9E;font-size:13px;padding:8px 0">불러오는 중...</div>';
  try {
    const backups = await fetchBackups();
    list.innerHTML = '';
    if (backups.length === 0) {
      list.innerHTML = '<div style="color:#9E9E9E;font-size:13px;padding:8px 0">저장된 백업이 없습니다.</div>';
      return;
    }
    backups.forEach(b => {
      const item = document.createElement('div');
      item.className = 'tmpl-item';
      item.style.cursor = 'default';
      const dt = new Date(b.created_at);
      const dateStr = dt.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
                    + ' ' + dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      item.innerHTML = `
        <div class="tmpl-item-info">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="backup-badge ${b.is_auto ? 'auto' : 'manual'}">${b.is_auto ? '자동' : '수동'}</span>
            <span class="tmpl-item-name">${b.name}</span>
          </div>
          <div class="tmpl-item-desc">업무 ${b.task_count}개 · ${b.created_by} · ${dateStr}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn-restore" data-id="${b.id}"
            style="height:26px;padding:0 10px;border-radius:5px;border:1px solid #E0E0E0;
                   background:#FAFAFA;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer">
            복구
          </button>
          <button class="tmpl-del" data-id="${b.id}" title="삭제">×</button>
        </div>
      `;
      item.querySelector('.btn-restore').addEventListener('click', async () => {
        if (!confirm(`"${b.name}" 백업으로 복구하시겠습니까?\n\n현재 데이터가 덮어씌워집니다.`)) return;
        try {
          const result = await restoreBackup(b.id);
          data = normalize(result.data);
          graph.setData(cs());
          buildFilters();
          renderSheetTabs();
          closeModal('modal-backup');
          alert('복구가 완료됐습니다.');
        } catch (err) { alert(err.message); }
      });
      item.querySelector('.tmpl-del').addEventListener('click', async () => {
        if (!confirm(`"${b.name}" 백업을 삭제할까요?`)) return;
        try { await deleteBackup(b.id); await refreshBackupList(); }
        catch (err) { alert(err.message); }
      });
      list.appendChild(item);
    });
  } catch (err) {
    list.innerHTML = `<div style="color:#C8102E;font-size:13px">${err.message}</div>`;
  }
}

document.getElementById('btn-backup-create').addEventListener('click', async () => {
  const name = prompt('백업 이름:', `수동 백업 ${new Date().toLocaleDateString('ko-KR')}`);
  if (name === null) return;
  try {
    await createBackup(name.trim() || undefined);
    await refreshBackupList();
  } catch (err) { alert(err.message); }
});

// ── 진입점 ───────────────────────────────────────────────
window.__doLogin = doLogin;

async function init() {
  document.getElementById('login-submit').addEventListener('click', doLogin);
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  currentUser = await checkAuth();
  if (!currentUser) {
    showLoginOverlay();
  } else {
    await startApp();
  }
}

init().catch(err => {
  console.error('[init 오류]', err);
  document.getElementById('login-overlay')?.classList.remove('hidden');
});
