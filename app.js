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
  fetchBackups, createBackup, restoreBackup, deleteBackup
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
        if (!canWrite()) {
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
  return ['admin', 'leader', 'manager'].includes(currentUser?.role);
}
function isAdmin() { return currentUser?.role === 'admin'; }

// ── 역할별 UI 제어 ────────────────────────────────────────
function applyRoleUI() {
  const role = currentUser?.role;
  const isMember = role === 'member';

  // 툴바 버튼
  document.getElementById('btn-add-task').style.display        = canWrite() ? '' : 'none';
  document.getElementById('btn-add-project').style.display     = canWrite() ? '' : 'none';
  document.getElementById('btn-import').style.display          = isAdmin()  ? '' : 'none';
  document.getElementById('btn-export').style.display          = isAdmin()  ? '' : 'none';
  document.getElementById('btn-backup').style.display          = isAdmin()  ? '' : 'none';
  document.getElementById('btn-template-save').style.display   = isAdmin()  ? '' : 'none';
  document.getElementById('btn-template-load').style.display   = '';

  // 패널 버튼 — 팀원도 저장 가능 (제한적)
  document.getElementById('btn-save-task').style.display   = '';
  document.getElementById('btn-delete-task').style.display = isAdmin() ? '' : 'none';

  // 패널 필드 읽기전용 (팀원)
  ['task-name', 'task-assignee'].forEach(id => {
    document.getElementById(id).readOnly = isMember;
    document.getElementById(id).style.background = isMember ? '#F5F5F5' : '';
  });
  document.getElementById('task-project').disabled  = isMember;
  document.getElementById('task-due-date').readOnly = isMember;
  document.getElementById('task-group').disabled    = isMember;

  // 팀원: 상태 활성화 (openPanel에서 done 옵션 제어)
  document.getElementById('task-status').disabled = false;
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
  if (!data || !data.tasks) { bar.style.display = 'none'; return; }

  const projectFilter  = document.getElementById('filter-project').value;
  const assigneeFilter = document.getElementById('filter-assignee').value;

  let tasks = data.tasks;
  if (projectFilter)  tasks = tasks.filter(t => t.projectId === projectFilter);
  if (assigneeFilter) tasks = tasks.filter(t => t.assignee  === assigneeFilter);

  if (tasks.length === 0) { bar.style.display = 'none'; return; }

  const total   = tasks.length;
  const done    = tasks.filter(t => t.status === 'done').length;
  const doing   = tasks.filter(t => t.status === 'doing'   || t.status === 'wip').length;
  const review  = tasks.filter(t => t.status === 'review').length;
  const pending = tasks.filter(t => t.status === 'pending' || t.status === 'todo').length;

  const donePct  = Math.round(done  / total * 100);
  const doingPct = Math.round(doing / total * 100);

  const projectName = projectFilter
    ? (data.projects.find(p => p.id === projectFilter)?.name || '프로젝트')
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
  document.getElementById('btn-backup').addEventListener('click', openBackupModal);
  document.getElementById('btn-template-save').addEventListener('click', () => openModal('modal-save-template'));
  document.getElementById('btn-template-load').addEventListener('click', openTemplateLoadModal);
  document.getElementById('btn-add-task').addEventListener('click', () => {
    if (!canWrite()) return;
    const task = addTask(data, { x: 120 + Math.random() * 200, y: 120 + Math.random() * 200, assignee: currentUser.name });
    saveData(data);
    graph.setData(data);
    openPanel(task);
  });
  document.getElementById('btn-logout').addEventListener('click', () => {
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
  document.getElementById('task-due-date').value = task.dueDate || '';
  document.getElementById('task-note').value     = task.note || '';

  // 그룹 셀렉트 채우기
  const gs = document.getElementById('task-group');
  gs.innerHTML = '<option value="">그룹 없음</option>';
  (data.groups || []).forEach(g => {
    const o = document.createElement('option');
    o.value = g.id; o.textContent = g.name;
    gs.appendChild(o);
  });
  gs.value = task.groupId || '';
  updateGroupSwatch(task.groupId);

  // 상태 드롭다운 — 팀원은 'done' 옵션 숨김
  const statusEl = document.getElementById('task-status');
  const doneOpt = statusEl.querySelector('option[value="done"]');
  if (doneOpt) doneOpt.style.display = canWrite() ? '' : 'none';
  statusEl.value = task.status;

  renderSubtasks(task);
}

function updateGroupSwatch(groupId) {
  const g = (data.groups || []).find(g => g.id === groupId);
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
  if (canWrite()) {
    updateTask(data, activeTaskId, {
      name:      document.getElementById('task-name').value,
      projectId: document.getElementById('task-project').value,
      assignee:  document.getElementById('task-assignee').value,
      status:    document.getElementById('task-status').value,
      dueDate:   document.getElementById('task-due-date').value || null,
      groupId:   document.getElementById('task-group').value || null,
      note:      document.getElementById('task-note').value
    });
    saveData(data);
    graph.setData(data);
    buildFilters();
  } else {
    // 팀원: 메모 + 상태만 저장 (서버에서 권한 검증)
    try {
      const result = await updateTaskMember(activeTaskId, {
        note:   document.getElementById('task-note').value,
        status: document.getElementById('task-status').value
      });
      data = result.data;
      graph.setData(data);
      buildFilters();
    } catch (err) { alert(err.message); }
  }
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
  if (!(data.groups || []).length) {
    list.innerHTML = '<div style="color:#9E9E9E;font-size:13px;padding:8px 0">생성된 그룹이 없습니다.</div>';
    return;
  }
  (data.groups || []).forEach(g => {
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
      deleteGroup(data, g.id);
      saveData(data);
      graph.setData(data);
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
  addGroup(data, name, _selectedGroupColor);
  saveData(data);
  graph.setData(data);
  buildFilters();
  closeModal('modal-group-create');
  renderGroupList();
});

// ── 템플릿 ──────────────────────────────────────────────
let _selectedTemplateId = null;

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// 모달 닫기 버튼 공통 처리
document.addEventListener('click', e => {
  const btn = e.target.closest('.modal-close, .btn-cancel');
  if (btn) {
    const id = btn.dataset.modal;
    if (id) closeModal(id);
  }
});

// ── 템플릿 저장 모달 ──
document.getElementById('btn-tmpl-save-confirm').addEventListener('click', async () => {
  const name = document.getElementById('tmpl-save-name').value.trim();
  const desc = document.getElementById('tmpl-save-desc').value.trim();
  if (!name) { alert('템플릿 이름을 입력하세요.'); return; }

  const templateData = {
    tasks: data.tasks.map(t => ({
      id: t.id, name: t.name, x: t.x, y: t.y,
      status: 'pending', assignee: '', note: '', subtasks: [], dueDate: null
    })),
    flows: data.flows.map(f => ({ id: f.id, from: f.from, to: f.to }))
  };

  try {
    await saveTemplate(name, desc, templateData);
    closeModal('modal-save-template');
    document.getElementById('tmpl-save-name').value = '';
    document.getElementById('tmpl-save-desc').value = '';
    alert('템플릿이 저장됐습니다.');
  } catch (err) {
    alert(err.message);
  }
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
        try {
          await deleteTemplate(t.id);
          item.remove();
          if (_selectedTemplateId === t.id) _selectedTemplateId = null;
        } catch (err) { alert(err.message); }
      });
      list.appendChild(item);
    });
    // 첫 번째 자동 선택
    if (templates.length > 0) {
      list.firstChild.click();
    }
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

    const project = addProject(data, projectName);
    const idMap = {};
    for (const t of tmpl.data.tasks) {
      const newTask = addTask(data, { name: t.name, projectId: project.id, x: t.x, y: t.y });
      idMap[t.id] = newTask.id;
    }
    for (const f of tmpl.data.flows) {
      if (idMap[f.from] && idMap[f.to]) addFlow(data, idMap[f.from], idMap[f.to]);
    }

    saveData(data);
    graph.setData(data);
    buildFilters();
    // 새 프로젝트로 필터 전환
    document.getElementById('filter-project').value = project.id;
    applyFilter();
    closeModal('modal-load-template');
  } catch (err) {
    alert(err.message);
  }
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
          data = result.data;
          graph.setData(data);
          buildFilters();
          closeModal('modal-backup');
          alert('복구가 완료됐습니다.');
        } catch (err) { alert(err.message); }
      });
      item.querySelector('.tmpl-del').addEventListener('click', async () => {
        if (!confirm(`"${b.name}" 백업을 삭제할까요?`)) return;
        try {
          await deleteBackup(b.id);
          await refreshBackupList();
        } catch (err) { alert(err.message); }
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
window.__doLogin = doLogin; // onclick 폴백용 전역 노출

async function init() {
  // 로그인 이벤트 최초 1회 등록
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
