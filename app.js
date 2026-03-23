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
  addView, updateView, deleteView, normalize,
  fetchUserNames, fetchUsers, updateUserRole, resetUserPassword, createUser
} from './data.js';
import { Graph } from './graph.js';

const VERSION = 'v2.10';

let data = null;
let graph = null;
let activeTaskId = null;
let currentUser = null; // { id, email, name, role }
let userNames = [];     // 전체 팀원 이름 목록
let calendarDate = new Date();
let viewMode = 'graph'; // 'graph' | 'calendar'

const TOKEN_KEY = 'dk_jwt';

// ── 뷰 필터 헬퍼 ──────────────────────────────────────────
// activeViewId = null → 전체 보기, 특정 id → 해당 프로젝트만
function activeView() {
  if (!data.activeViewId) return null;
  return (data.views || []).find(v => v.id === data.activeViewId) || null;
}

function filteredData() {
  const view = activeView();
  if (!view || !view.projectIds?.length) {
    return { projects: data.projects, tasks: data.tasks, flows: data.flows, groups: data.groups };
  }
  const projects = data.projects.filter(p => view.projectIds.includes(p.id));
  const pSet = new Set(projects.map(p => p.id));
  const tasks = data.tasks.filter(t => pSet.has(t.projectId));
  const tSet = new Set(tasks.map(t => t.id));
  // 뷰에 포함된 프로젝트의 묶음만 표시 (projectId 없는 레거시 태그는 항상 포함)
  const groups = (data.groups || []).filter(g => !g.projectId || pSet.has(g.projectId));
  const gSet = new Set(groups.map(g => g.id));
  // flow: task-task, task-group, group-group 모두 허용
  const flows = (data.flows || []).filter(f =>
    (tSet.has(f.from) || gSet.has(f.from)) && (tSet.has(f.to) || gSet.has(f.to))
  );
  return { projects, tasks, flows, groups };
}

// ── 언도/리두 ─────────────────────────────────────────────
let undoStack = [];
let redoStack = [];

function pushUndo() {
  undoStack.push(JSON.parse(JSON.stringify(data)));
  if (undoStack.length > 30) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = !undoStack.length;
  if (r) r.disabled = !redoStack.length;
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.parse(JSON.stringify(data)));
  if (redoStack.length > 30) redoStack.shift();
  data = normalize(undoStack.pop());
  saveData(data);
  graph.setData(filteredData());
  buildFilters();
  renderSidebar();
  updateUndoRedoButtons();
  if (activeTaskId) {
    const t = data.tasks.find(t => t.id === activeTaskId);
    if (t) openPanel(t); else closePanel();
  }
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.parse(JSON.stringify(data)));
  data = normalize(redoStack.pop());
  saveData(data);
  graph.setData(filteredData());
  buildFilters();
  renderSidebar();
  updateUndoRedoButtons();
  if (activeTaskId) {
    const t = data.tasks.find(t => t.id === activeTaskId);
    if (t) openPanel(t); else closePanel();
  }
}

// ── 연결선 삭제 확인 팝업 ─────────────────────────────────
function showFlowDeletePopup(flowId, svgMidX, svgMidY, stopGlow) {
  // 기존 팝업 제거
  document.getElementById('flow-delete-popup')?.remove();

  const canvas = document.getElementById('graph-container');
  const rect = canvas.getBoundingClientRect();
  const transform = graph.getTransform?.() || { x: 0, y: 0, k: 1 };
  const screenX = rect.left + transform.x + svgMidX * transform.k;
  const screenY = rect.top  + transform.y + svgMidY * transform.k;

  const popup = document.createElement('div');
  popup.id = 'flow-delete-popup';
  popup.className = 'flow-delete-popup';
  popup.innerHTML = `
    <div class="flow-delete-msg">연결을 삭제할까요?</div>
    <div class="flow-delete-btns">
      <button class="flow-delete-cancel">취소</button>
      <button class="flow-delete-confirm">삭제</button>
    </div>`;
  popup.style.left = `${screenX}px`;
  popup.style.top  = `${screenY}px`;
  document.body.appendChild(popup);

  const dismiss = () => { popup.remove(); stopGlow(); };
  popup.querySelector('.flow-delete-cancel').addEventListener('click', dismiss);
  popup.querySelector('.flow-delete-confirm').addEventListener('click', () => {
    dismiss();
    pushUndo();
    deleteFlow(data, flowId);
    saveData(data);
    graph.setData(filteredData());
  });
  // 팝업 바깥 클릭 시 닫기
  setTimeout(() => document.addEventListener('pointerdown', function h(e) {
    if (!popup.contains(e.target)) { dismiss(); document.removeEventListener('pointerdown', h); }
  }), 0);
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
    graph.setData(filteredData());
    buildFilters();
    renderSidebar();
    if (viewMode === 'calendar') renderCalendar();
  });
}

// ── 앱 시작 (로그인 후) ───────────────────────────────────
async function startApp() {
  document.getElementById('login-overlay')?.classList.add('hidden');
  if (!graph) {
    initSocket();

    graph = new Graph(document.getElementById('graph-container'), {
      onNodeClick: (task) => openPanel(task),
      onNodeCreate: (x, y, context = {}) => {
        if (!canWrite()) return;
        pushUndo();
        const fd = filteredData();
        // context.projectId: 클릭한 프로젝트/묶음 영역, context.groupId: 클릭한 묶음
        const projectId = context.projectId
          || document.getElementById('filter-project').value
          || fd.projects[0]?.id;
        const task = addTask(data, {
          x, y,
          projectId,
          groupId:  context.groupId || null,
          assignee: currentUser.name
        });
        // 필터 뷰에서 생성 시, 해당 뷰의 projectIds에 없는 프로젝트라면 추가
        const view = activeView();
        if (view && view.projectIds.length > 0 && task.projectId && !view.projectIds.includes(task.projectId)) {
          view.projectIds.push(task.projectId);
        }
        saveData(data);
        graph.setData(filteredData());
        openPanel(task);
      },
      onFlowCreate: (fromId, toId) => {
        if (!canWrite()) return;
        pushUndo();
        addFlow(data, fromId, toId); saveData(data); graph.setData(filteredData());
      },
      onFlowDelete: (flowId) => {
        if (!canWrite()) return;
        pushUndo();
        deleteFlow(data, flowId); saveData(data); graph.setData(filteredData());
      },
      onFlowHold: (flowId, midX, midY, stopGlow) => {
        if (!canWrite()) { stopGlow(); return; }
        showFlowDeletePopup(flowId, midX, midY, stopGlow);
      },
      onStatusChange: async (taskId, st) => {
        if (!canWrite()) {
          try {
            const result = await saveTaskStatus(taskId, st);
            data = normalize(result.data);
            graph.setData(filteredData());
            buildFilters();
            if (activeTaskId === taskId) document.getElementById('task-status').value = st;
          } catch (err) { alert(err.message); }
        } else {
          pushUndo();
          updateTask(data, taskId, { status: st });
          saveData(data);
          graph.setData(filteredData());
          buildFilters();
          if (activeTaskId === taskId) document.getElementById('task-status').value = st;
        }
      },
      onNodeMoved: () => { if (canWrite()) saveData(data); }
    });

    // 키보드 단축키
    document.addEventListener('keydown', e => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault(); undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault(); redo();
      }
    });
  }

  try { userNames = await fetchUserNames(); } catch { userNames = []; }

  data = await loadData();
  if (!data) { logout(); return; }

  graph.setData(filteredData());
  graph.setUserContext(currentUser);
  buildFilters();
  setupToolbar();
  setupPanel();
  setupViewSidebar();
  applyRoleUI();
  updateUserBtn();
  renderSidebar();
  populateAssigneeSelect();
}

// ── 역할 권한 헬퍼 ────────────────────────────────────────
function canWrite() {
  return ['admin', 'leader', 'manager'].includes(currentUser?.role);
}
function isAdmin() { return currentUser?.role === 'admin'; }
function isPrivileged() { return ['admin', 'leader'].includes(currentUser?.role); }

// ── 역할별 UI 제어 ────────────────────────────────────────
function applyRoleUI() {
  const isMember = currentUser?.role === 'member';

  document.getElementById('btn-add-group').style.display       = canWrite() ? '' : 'none';
  document.getElementById('btn-add-task').style.display        = canWrite() ? '' : 'none';
  document.getElementById('btn-add-project').style.display     = canWrite() ? '' : 'none';
  document.getElementById('btn-manage-projects').style.display = canWrite() ? '' : 'none';
  document.getElementById('btn-manage-users').style.display    = isAdmin()  ? '' : 'none';
  document.getElementById('btn-import').style.display          = isAdmin()  ? '' : 'none';
  document.getElementById('btn-export').style.display          = isAdmin()  ? '' : 'none';
  document.getElementById('btn-backup').style.display          = isAdmin()  ? '' : 'none';
  document.getElementById('btn-template-save').style.display   = isAdmin()  ? '' : 'none';
  document.getElementById('btn-template-load').style.display   = '';

  document.getElementById('btn-save-task').style.display   = '';
  document.getElementById('btn-delete-task').style.display = isAdmin() ? '' : 'none';

  document.getElementById('task-name').readOnly = isMember;
  document.getElementById('task-name').style.background = isMember ? '#F5F5F5' : '';
  document.getElementById('task-assignee').disabled  = isMember;
  document.getElementById('task-assignee').style.background = isMember ? '#F5F5F5' : '';
  document.getElementById('task-project').disabled  = isMember;
  document.getElementById('task-due-date').readOnly = isMember;
  document.getElementById('task-group').disabled    = isMember;
  document.getElementById('task-status').disabled = false;
  const statusSel = document.getElementById('task-status');
  statusSel.querySelectorAll('option').forEach(opt => {
    if (opt.value === 'done' || opt.value === 'closed') {
      opt.style.display = canWrite() ? '' : 'none';
    }
  });
  document.getElementById('btn-add-subtask').style.display   = canWrite() ? '' : 'none';
  document.getElementById('btn-manage-groups').style.display = canWrite() ? '' : 'none';

  // 사이드바 + 새 시트 버튼
  const addViewBtn = document.getElementById('btn-add-view');
  if (addViewBtn) addViewBtn.style.display = isPrivileged() ? '' : 'none';
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

// ── 담당자 셀렉트 ─────────────────────────────────────────
function populateAssigneeSelect() {
  const sel = document.getElementById('task-assignee');
  const cur = sel.value;
  sel.innerHTML = '<option value="">미배정</option>';
  userNames.forEach(name => {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    sel.appendChild(o);
  });
  if (cur) sel.value = cur;
}

// ── 뷰 전환 ──────────────────────────────────────────────
function setViewMode(mode) {
  viewMode = mode;
  const isGraph = mode === 'graph';
  document.getElementById('main').style.display = isGraph ? '' : 'none';
  document.getElementById('calendar-view').style.display = isGraph ? 'none' : '';
  document.getElementById('btn-view-graph').classList.toggle('active', isGraph);
  document.getElementById('btn-view-calendar').classList.toggle('active', !isGraph);
  if (!isGraph) renderCalendar();
}

// ── 캘린더 ───────────────────────────────────────────────
function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  document.getElementById('cal-month-label').textContent =
    `${year}년 ${month + 1}월`;

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  // 헤더
  const days = ['일','월','화','수','목','금','토'];
  const header = document.createElement('div');
  header.className = 'cal-row cal-header';
  days.forEach(d => {
    const cell = document.createElement('div');
    cell.className = 'cal-cell cal-day-label';
    cell.textContent = d;
    header.appendChild(cell);
  });
  grid.appendChild(header);

  // 현재 뷰에서 보이는 프로젝트의 업무만 캘린더에 표시
  const fd = filteredData();
  const pSet = new Set(fd.projects.map(p => p.id));
  const tasksByDate = {};
  for (const task of data.tasks) {
    if (!task.dueDate) continue;
    if (!pSet.has(task.projectId)) continue;
    const key = task.dueDate.slice(0, 10);
    if (!tasksByDate[key]) tasksByDate[key] = [];
    tasksByDate[key].push(task);
  }

  const today = new Date();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();

  let day = 1;
  let nextDay = 1;
  let started = false;

  for (let row = 0; row < 6; row++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'cal-row';

    for (let col = 0; col < 7; col++) {
      const cell = document.createElement('div');
      cell.className = 'cal-cell';

      let cellDay, cellDate, isCurrentMonth;

      if (!started && col < firstDay) {
        cellDay = prevDays - firstDay + col + 1;
        cellDate = new Date(year, month - 1, cellDay);
        isCurrentMonth = false;
      } else if (day > daysInMonth) {
        cellDay = nextDay++;
        cellDate = new Date(year, month + 1, cellDay);
        isCurrentMonth = false;
      } else {
        started = true;
        cellDay = day++;
        cellDate = new Date(year, month, cellDay);
        isCurrentMonth = true;
      }

      if (!isCurrentMonth) cell.classList.add('cal-other-month');
      if (col === 0) cell.classList.add('cal-sunday');
      if (col === 6) cell.classList.add('cal-saturday');

      const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const cellStr  = `${cellDate.getFullYear()}-${String(cellDate.getMonth()+1).padStart(2,'0')}-${String(cellDate.getDate()).padStart(2,'0')}`;
      if (cellStr === todayStr) cell.classList.add('cal-today');

      const dayNum = document.createElement('span');
      dayNum.className = 'cal-day-num';
      dayNum.textContent = cellDay;
      cell.appendChild(dayNum);

      const entries = tasksByDate[cellStr] || [];
      entries.forEach(task => {
        const project = data.projects.find(p => p.id === task.projectId);
        const chip = document.createElement('div');
        chip.className = 'cal-task-chip';
        chip.textContent = task.name;
        chip.style.background = (project?.color || '#9E9E9E') + '22';
        chip.style.color = project?.color || '#424242';
        chip.style.borderLeft = `3px solid ${project?.color || '#9E9E9E'}`;
        chip.title = `${task.name} (${task.assignee || '미배정'})`;
        chip.addEventListener('click', () => {
          setViewMode('graph');
          setTimeout(() => openPanel(task), 100);
        });
        cell.appendChild(chip);
      });

      rowEl.appendChild(cell);
    }

    grid.appendChild(rowEl);
    if (day > daysInMonth && row >= 4) break;
  }
}

// ── 필터 ─────────────────────────────────────────────────
function buildFilters() {
  const fd = filteredData();
  const hasUnassigned = fd.tasks.some(t => !t.assignee);
  const asel = document.getElementById('filter-assignee');
  const av = asel.value;
  asel.innerHTML = '<option value="">담당자 전체</option>';
  if (hasUnassigned) {
    const o = document.createElement('option'); o.value = '__unassigned__'; o.textContent = '미배정'; asel.appendChild(o);
  }
  userNames.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; asel.appendChild(o); });
  asel.value = av;

  const psel = document.getElementById('filter-project');
  const pv = psel.value;
  psel.innerHTML = '<option value="">프로젝트 전체</option>';
  fd.projects.filter(p => !p.archived).forEach(p => {
    const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; psel.appendChild(o);
  });
  const archived = fd.projects.filter(p => p.archived);
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
  fd.projects.filter(p => !p.archived).forEach(p => {
    const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; ps.appendChild(o);
  });
  ps.value = ppv;

  const pendingCount = fd.tasks.filter(t => t.status === 'review' || t.status === 'inactive').length;
  document.getElementById('pending-badge').textContent = pendingCount > 0 ? pendingCount : '';
  document.getElementById('pending-badge').style.display = pendingCount > 0 ? '' : 'none';

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
  const fd = filteredData();
  if (!fd?.tasks) { bar.style.display = 'none'; return; }

  const projectFilter  = document.getElementById('filter-project').value;
  const assigneeFilter = document.getElementById('filter-assignee').value;

  let tasks = fd.tasks;
  if (projectFilter)  tasks = tasks.filter(t => t.projectId === projectFilter);
  if (assigneeFilter) tasks = tasks.filter(t => t.assignee  === assigneeFilter);

  if (tasks.length === 0) { bar.style.display = 'none'; return; }

  const total    = tasks.length;
  const done     = tasks.filter(t => t.status === 'done' || t.status === 'closed').length;
  const doing    = tasks.filter(t => t.status === 'doing').length;
  const review   = tasks.filter(t => t.status === 'review').length;
  const pre      = tasks.filter(t => t.status === 'pre' || t.status === 'pending').length;
  const waiting  = tasks.filter(t => t.status === 'waiting').length;
  const delayed  = tasks.filter(t => t.status === 'delayed').length;
  const inactive = tasks.filter(t => t.status === 'inactive').length;

  const donePct  = Math.round(done  / total * 100);
  const doingPct = Math.round(doing / total * 100);

  const projectName = projectFilter
    ? (fd.projects.find(p => p.id === projectFilter)?.name || '프로젝트')
    : (activeView()?.name || '전체 프로젝트');

  const metaParts = [];
  if (done)     metaParts.push(`완료 ${done}개`);
  if (doing)    metaParts.push(`진행 중 ${doing}개`);
  if (review)   metaParts.push(`완료요청 ${review}개`);
  if (waiting)  metaParts.push(`대기 ${waiting}개`);
  if (delayed)  metaParts.push(`지연 ${delayed}개`);
  if (inactive) metaParts.push(`미진행 ${inactive}개`);
  if (pre)      metaParts.push(`착수전 ${pre}개`);

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

// ── 사이드바 시트 ─────────────────────────────────────────
let _viewDropdown = null;

function closeViewDropdown() {
  if (_viewDropdown) { _viewDropdown.remove(); _viewDropdown = null; }
}

function setActiveView(viewId) {
  data.activeViewId = viewId;
  saveData(data);
  graph.setData(filteredData());
  buildFilters();
  applyFilter();
  renderSidebar();
  if (viewMode === 'calendar') renderCalendar();
}

function makeSidebarItem(view, isAll) {
  const isActive = isAll ? !data.activeViewId : data.activeViewId === view.id;
  const item = document.createElement('div');
  item.className = 'view-item' + (isActive ? ' active' : '');

  const nameSpan = document.createElement('span');
  nameSpan.className = 'view-item-name';
  nameSpan.textContent = view.name;
  item.appendChild(nameSpan);

  if (!isAll && isPrivileged()) {
    const menuBtn = document.createElement('button');
    menuBtn.className = 'view-item-menu';
    menuBtn.textContent = '⋯';
    menuBtn.title = '편집/삭제';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeViewDropdown();

      const rect = menuBtn.getBoundingClientRect();
      const dd = document.createElement('div');
      dd.className = 'view-dropdown';
      dd.style.top  = `${rect.bottom + 4}px`;
      dd.style.left = `${rect.left}px`;

      const editItem = document.createElement('div');
      editItem.className = 'view-dropdown-item';
      editItem.textContent = '편집';
      editItem.addEventListener('click', () => { closeViewDropdown(); openViewModal(view); });

      const delItem = document.createElement('div');
      delItem.className = 'view-dropdown-item danger';
      delItem.textContent = '삭제';
      delItem.addEventListener('click', () => {
        closeViewDropdown();
        if (!confirm(`"${view.name}" 시트를 삭제할까요?`)) return;
        pushUndo();
        deleteView(data, view.id);
        saveData(data);
        graph.setData(filteredData());
        buildFilters();
        renderSidebar();
      });

      dd.appendChild(editItem);
      dd.appendChild(delItem);
      document.body.appendChild(dd);
      _viewDropdown = dd;
    });
    item.appendChild(menuBtn);
  }

  item.addEventListener('click', () => {
    closeViewDropdown();
    setActiveView(isAll ? null : view.id);
  });

  return item;
}

function renderSidebar() {
  const list = document.getElementById('view-list');
  if (!list) return;
  list.innerHTML = '';

  // 전체 보기 (항상 첫 번째)
  list.appendChild(makeSidebarItem({ id: null, name: '전체 보기', projectIds: [] }, true));

  // 사용자 정의 뷰 목록 (sortOrder 순)
  const sorted = [...(data.views || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  sorted.forEach(view => list.appendChild(makeSidebarItem(view, false)));

  // + 새 시트 버튼 표시 제어
  const btn = document.getElementById('btn-add-view');
  if (btn) btn.style.display = isPrivileged() ? '' : 'none';
}

// ── 뷰 시트 생성/편집 모달 ───────────────────────────────
let _editingViewId = null; // null = 신규 생성

function openViewModal(view = null) {
  _editingViewId = view?.id || null;
  document.getElementById('view-modal-title').textContent = view ? '시트 편집' : '새 시트';
  document.getElementById('view-name-input').value = view?.name || '';

  const checksEl = document.getElementById('view-project-checks');
  checksEl.innerHTML = '';
  const currentIds = view?.projectIds || [];

  data.projects.filter(p => !p.archived).forEach(p => {
    const label = document.createElement('label');
    label.className = 'view-check-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = p.id;
    cb.checked = currentIds.includes(p.id);

    const dot = document.createElement('span');
    dot.style.cssText = `width:10px;height:10px;border-radius:2px;background:${p.color};flex-shrink:0`;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name;

    label.appendChild(cb);
    label.appendChild(dot);
    label.appendChild(nameSpan);
    checksEl.appendChild(label);
  });

  openModal('modal-view');
  setTimeout(() => document.getElementById('view-name-input').focus(), 50);
}

function setupViewSidebar() {
  document.getElementById('btn-add-view')?.addEventListener('click', () => openViewModal(null));

  document.getElementById('btn-view-confirm')?.addEventListener('click', () => {
    const name = document.getElementById('view-name-input').value.trim();
    if (!name) { alert('시트 이름을 입력하세요.'); return; }

    const checked = [...document.querySelectorAll('#view-project-checks input[type=checkbox]:checked')];
    const projectIds = checked.map(cb => cb.value);

    pushUndo();
    if (_editingViewId) {
      updateView(data, _editingViewId, { name, projectIds });
    } else {
      addView(data, name, projectIds);
    }
    saveData(data);
    graph.setData(filteredData());
    buildFilters();
    renderSidebar();
    closeModal('modal-view');
  });

  // 드롭다운 닫기 (바깥 클릭)
  document.addEventListener('click', (e) => {
    if (_viewDropdown && !_viewDropdown.contains(e.target)) closeViewDropdown();
  });
}

// ── 툴바 ─────────────────────────────────────────────────
let toolbarSetup = false;
function setupToolbar() {
  if (toolbarSetup) return;
  toolbarSetup = true;

  ['filter-assignee','filter-project','filter-status'].forEach(id =>
    document.getElementById(id).addEventListener('change', applyFilter)
  );
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);
  document.getElementById('btn-reset-view').addEventListener('click', () => graph.resetView());
  document.getElementById('btn-export').addEventListener('click', () => exportJSON(data));
  document.getElementById('btn-import').addEventListener('click', () =>
    importJSON(d => { data = d; graph.setData(filteredData()); buildFilters(); closePanel(); renderSidebar(); })
  );
  document.getElementById('btn-add-project').addEventListener('click', openProjectsModal);
  document.getElementById('btn-manage-projects').addEventListener('click', openProjectsModal);
  document.getElementById('btn-backup').addEventListener('click', openBackupModal);
  document.getElementById('btn-template-save').addEventListener('click', () => openModal('modal-save-template'));
  document.getElementById('btn-template-load').addEventListener('click', openTemplateLoadModal);
  document.getElementById('btn-add-group').addEventListener('click', () => {
    if (!canWrite()) return;
    // 프로젝트 셀렉트 채우기
    const sel = document.getElementById('grp-project');
    sel.innerHTML = '';
    data.projects.filter(p => !p.archived).forEach(p => {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      sel.appendChild(o);
    });
    // 현재 필터 프로젝트 기본 선택
    const fp = document.getElementById('filter-project').value;
    if (fp) sel.value = fp;
    _selectedGroupColor = GROUP_COLORS[0];
    document.getElementById('grp-name').value = '';
    buildGroupColorPalette();
    openModal('modal-group-create');
  });
  document.getElementById('btn-add-task').addEventListener('click', () => {
    if (!canWrite()) return;
    pushUndo();
    const fd = filteredData();
    const task = addTask(data, {
      x: 120 + Math.random() * 200,
      y: 120 + Math.random() * 200,
      projectId: document.getElementById('filter-project').value || fd.projects[0]?.id,
      assignee: currentUser.name
    });
    saveData(data);
    graph.setData(filteredData());
    openPanel(task);
  });
  document.getElementById('btn-logout').addEventListener('click', () => {
    if (confirm(`${currentUser?.name}님, 로그아웃 하시겠습니까?`)) logout();
  });
  document.getElementById('btn-view-graph').addEventListener('click', () => setViewMode('graph'));
  document.getElementById('btn-view-calendar').addEventListener('click', () => setViewMode('calendar'));
  document.getElementById('btn-manage-users').addEventListener('click', openUsersModal);
  document.getElementById('cal-prev').addEventListener('click', () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    renderCalendar();
  });
}

// ── 프로젝트 관리 모달 ────────────────────────────────────
function openProjectsModal() {
  if (!canWrite()) return;
  renderProjectList();
  document.getElementById('new-project-name').value = '';
  openModal('modal-projects');
  setTimeout(() => document.getElementById('new-project-name').focus(), 50);
}

function doAddProject() {
  const input = document.getElementById('new-project-name');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  pushUndo();
  const p = addProject(data, name);
  const view = activeView();
  if (view && view.projectIds.length > 0) view.projectIds.push(p.id);
  saveData(data);
  buildFilters();
  renderSidebar();
  renderProjectList();
  input.value = '';
  input.focus();
}

document.getElementById('btn-add-project-confirm').addEventListener('click', doAddProject);
document.getElementById('new-project-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') doAddProject();
});

function renderProjectList() {
  const list = document.getElementById('project-list');
  list.innerHTML = '';
  if (!data.projects.length) {
    list.innerHTML = '<div style="color:#9E9E9E;font-size:13px;padding:8px 0">생성된 프로젝트가 없습니다.</div>';
    return;
  }
  data.projects.forEach(p => {
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
      graph.setData(filteredData());
      buildFilters();
      renderProjectList();
    });
    item.querySelector('.tmpl-del').addEventListener('click', () => {
      if (!confirm(`"${p.name}" 프로젝트를 삭제할까요?\n모든 업무와 연결이 삭제됩니다.`)) return;
      pushUndo();
      deleteProject(data, p.id);
      saveData(data);
      graph.setData(filteredData());
      buildFilters();
      renderProjectList();
      renderSidebar(); // 뷰의 projectIds에서도 제거됨
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
  gs.innerHTML = '<option value="">묶음 없음</option>';
  // 해당 프로젝트 소속 묶음 우선 표시, 그 다음 projectId 없는 레거시 태그
  const projectGroups = (data.groups || []).filter(g => g.projectId === task.projectId);
  const legacyGroups  = (data.groups || []).filter(g => !g.projectId);
  [...projectGroups, ...legacyGroups].forEach(g => {
    const o = document.createElement('option');
    o.value = g.id; o.textContent = g.name + (g.projectId ? '' : ' (태그)');
    gs.appendChild(o);
  });
  gs.value = task.groupId || '';
  updateGroupSwatch(task.groupId);

  const statusEl = document.getElementById('task-status');
  statusEl.querySelectorAll('option').forEach(opt => {
    if (opt.value === 'done' || opt.value === 'closed') opt.style.display = canWrite() ? '' : 'none';
  });
  statusEl.value = task.status || 'pre';

  // 다른 시트로 복제 버튼 — 시트 개념이 없어졌으므로 숨김
  document.getElementById('btn-copy-task').style.display = 'none';

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
  pushUndo();
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
    graph.setData(filteredData());
    buildFilters();
  } else {
    try {
      const task = data.tasks.find(t => t.id === activeTaskId);
      const result = await updateTaskMember(activeTaskId, {
        note:     document.getElementById('task-note').value,
        status:   document.getElementById('task-status').value,
        subtasks: task?.subtasks
      });
      data = normalize(result.data);
      graph.setData(filteredData());
      buildFilters();
    } catch (err) { alert(err.message); return; }
  }
  closePanel();
}

function deleteTaskBtn() {
  if (!activeTaskId || !isAdmin()) return;
  const task = data.tasks.find(t => t.id === activeTaskId);
  if (!confirm(`"${task?.name}" 업무를 삭제할까요?`)) return;
  pushUndo();
  deleteTask(data, activeTaskId);
  saveData(data);
  graph.setData(filteredData());
  buildFilters();
  closePanel();
}

// ── 세부업무 ─────────────────────────────────────────────
function makeSubtaskRow(task, s) {
  const row = document.createElement('div');
  row.className = 'subtask-row';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = s.status === 'done';
  cb.addEventListener('change', (e) => {
    s.status = e.target.checked ? 'done' : 'pending';
    saveData(data);
  });

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'sub-name';
  nameInput.value = s.name;
  nameInput.placeholder = '세부업무 이름';
  nameInput.addEventListener('input', (e) => { s.name = e.target.value; });
  nameInput.addEventListener('change', (e) => { s.name = e.target.value; saveData(data); });

  const delBtn = document.createElement('button');
  delBtn.className = 'sub-del';
  delBtn.textContent = '×';
  delBtn.style.display = canWrite() ? '' : 'none';
  delBtn.addEventListener('click', () => {
    const idx = task.subtasks.indexOf(s);
    if (idx !== -1) task.subtasks.splice(idx, 1);
    saveData(data);
    row.remove();
  });

  row.appendChild(cb);
  row.appendChild(nameInput);
  row.appendChild(delBtn);
  return row;
}

function renderSubtasks(task) {
  const list = document.getElementById('subtask-list');
  list.innerHTML = '';
  (task.subtasks || []).forEach(s => list.appendChild(makeSubtaskRow(task, s)));
}

function addSubtask() {
  if (!activeTaskId || !canWrite()) return;
  const task = data.tasks.find(t => t.id === activeTaskId);
  if (!task) return;
  if (!task.subtasks) task.subtasks = [];

  const s = { id: `s_${Date.now()}`, name: '', status: 'pending' };
  task.subtasks.push(s);
  // saveData는 사용자가 내용 입력 후 blur 시점에 makeSubtaskRow 내부에서 호출됨
  // 여기서 즉시 저장하면 소켓 브로드캐스트로 data 객체가 교체되어 s 참조가 끊어질 수 있음

  const list = document.getElementById('subtask-list');
  const row = makeSubtaskRow(task, s);
  list.appendChild(row);
  const input = row.querySelector('.sub-name');
  requestAnimationFrame(() => {
    input.focus();
    // 패널이 스크롤 가능하면 새 입력창이 보이도록 스크롤
    input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

// ── 그룹 관리 ────────────────────────────────────────────
let _selectedGroupColor = GROUP_COLORS[0];
let _editingGroupId = null; // null = 신규, string = 편집 중인 그룹 id

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
    list.innerHTML = '<div style="color:#9E9E9E;font-size:13px;padding:8px 0">생성된 묶음이 없습니다.</div>';
    return;
  }
  (data.groups || []).forEach(g => {
    const projectName = g.projectId
      ? (data.projects.find(p => p.id === g.projectId)?.name || '')
      : '태그 전용';
    const item = document.createElement('div');
    item.className = 'tmpl-item';
    item.style.cursor = 'default';
    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
        <span style="width:12px;height:12px;border-radius:3px;background:${g.color};flex-shrink:0"></span>
        <span class="tmpl-item-name">${g.name}</span>
        ${projectName ? `<span style="font-size:10px;color:#9E9E9E;white-space:nowrap">${projectName}</span>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn-grp-edit" style="height:26px;padding:0 10px;border-radius:5px;border:1px solid #E0E0E0;background:#FAFAFA;font-size:11px;font-weight:600;font-family:inherit;cursor:pointer">편집</button>
        <button class="tmpl-del" data-id="${g.id}">×</button>
      </div>
    `;
    item.querySelector('.btn-grp-edit').addEventListener('click', () => openGroupModal(g));
    item.querySelector('.tmpl-del').addEventListener('click', () => {
      if (!confirm(`"${g.name}" 묶음을 삭제할까요?`)) return;
      pushUndo();
      deleteGroup(data, g.id);
      saveData(data);
      graph.setData(filteredData());
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

function openGroupModal(group = null) {
  _editingGroupId = group?.id || null;
  document.getElementById('grp-modal-title').textContent = group ? '묶음 수정' : '묶음 추가';
  document.getElementById('grp-name').value = group?.name || '';
  _selectedGroupColor = group?.color || GROUP_COLORS[0];

  // 프로젝트 셀렉트 채우기
  const sel = document.getElementById('grp-project');
  sel.innerHTML = '<option value="">프로젝트 없음 (태그 전용)</option>';
  data.projects.filter(p => !p.archived).forEach(p => {
    const o = document.createElement('option'); o.value = p.id; o.textContent = p.name;
    sel.appendChild(o);
  });
  if (group) {
    sel.value = group.projectId || '';
  } else {
    const fp = document.getElementById('filter-project').value;
    if (fp) sel.value = fp;
  }

  buildGroupColorPalette();
  openModal('modal-group-create');
  setTimeout(() => document.getElementById('grp-name').focus(), 50);
}

document.getElementById('btn-open-group-create').addEventListener('click', () => openGroupModal(null));

document.getElementById('btn-grp-save').addEventListener('click', () => {
  const name = document.getElementById('grp-name').value.trim();
  if (!name) { alert('묶음 이름을 입력하세요.'); return; }
  const projectId = document.getElementById('grp-project')?.value || null;
  pushUndo();

  if (_editingGroupId) {
    // ── 편집 모드
    const g = (data.groups || []).find(g => g.id === _editingGroupId);
    if (g) {
      g.name      = name;
      g.color     = _selectedGroupColor;
      g.projectId = projectId;
    }
  } else {
    // ── 신규 추가
    let gx = 200, gy = 200;
    if (projectId) {
      const project = data.projects.find(p => p.id === projectId);
      if (project) {
        const existingGroups = (data.groups || []).filter(g => g.projectId === projectId);
        gx = (project.x ?? 200) + 30;
        gy = (project.y ?? 200) + 80 + existingGroups.length * 200;
      }
    }
    addGroup(data, name, _selectedGroupColor, projectId, gx, gy);
  }

  saveData(data);
  graph.setData(filteredData());
  buildFilters();
  closeModal('modal-group-create');
  renderGroupList();
  if (activeTaskId) {
    const task = data.tasks.find(t => t.id === activeTaskId);
    if (task) openPanel(task);
  }
});

// ── 사용자 관리 모달 ──────────────────────────────────────
async function openUsersModal() {
  openModal('modal-users');
  await renderUserList();
}

async function renderUserList() {
  const list = document.getElementById('user-list');
  list.innerHTML = '<div style="color:#9E9E9E;font-size:13px;padding:12px 0">불러오는 중...</div>';
  try {
    const users = await fetchUsers();
    list.innerHTML = '';
    const roleLabel = { admin: '관리자', leader: '팀장', manager: '과장', member: '팀원' };
    const roleColor = { admin: '#212121', leader: '#C8102E', manager: '#9E9E9E', member: '#BDBDBD' };
    const roles = ['admin', 'leader', 'manager', 'member'];

    users.forEach(u => {
      const item = document.createElement('div');
      item.className = 'user-item';
      item.dataset.userId = u.id;
      const pw = u.password_plain || '—';
      item.innerHTML = `
        <div class="user-item-main">
          <div class="user-item-avatar" style="background:${roleColor[u.role]}22;color:${roleColor[u.role]};border:1.5px solid ${roleColor[u.role]}44">
            ${u.name.slice(0,1)}
          </div>
          <div class="user-item-info">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
              <span class="user-item-name">${u.name}</span>
              <span class="role-badge ${u.role}">${roleLabel[u.role]}</span>
            </div>
            <div style="font-size:11px;color:#9E9E9E">${u.email || ''}</div>
          </div>
          <div class="user-item-pw">
            <span style="font-size:10px;color:#BDBDBD;font-weight:500">PW</span>
            <span class="pw-display" style="font-size:12px;font-family:monospace;color:#424242;cursor:pointer;border-bottom:1px dashed #BDBDBD" title="클릭하여 비밀번호 변경">${pw}</span>
          </div>
        </div>
        <div class="user-item-actions">
          <select class="user-role-sel">
            ${roles.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${roleLabel[r]}</option>`).join('')}
          </select>
          <button class="btn-role-save btn-small-action">권한 저장</button>
          <button class="btn-pw-reset btn-small-action">비밀번호 변경</button>
        </div>
      `;

      item.querySelector('.btn-role-save').addEventListener('click', async (e) => {
        const btn = e.target;
        const role = item.querySelector('.user-role-sel').value;
        btn.disabled = true; btn.textContent = '저장 중...';
        try {
          await updateUserRole(u.id, role);
          u.role = role;
          item.querySelector('.role-badge').className = `role-badge ${role}`;
          item.querySelector('.role-badge').textContent = roleLabel[role];
          item.querySelector('.user-item-avatar').style.background = `${roleColor[role]}22`;
          item.querySelector('.user-item-avatar').style.color = roleColor[role];
          item.querySelector('.user-item-avatar').style.border = `1.5px solid ${roleColor[role]}44`;
          btn.textContent = '✓ 저장됨';
          setTimeout(() => { btn.textContent = '권한 저장'; btn.disabled = false; }, 1500);
          if (u.id === currentUser?.id) {
            currentUser.role = role;
            applyRoleUI();
            updateUserBtn();
          }
        } catch (err) { alert(err.message); btn.textContent = '권한 저장'; btn.disabled = false; }
      });

      const pwChange = async () => {
        const pw = prompt(`${u.name}의 새 비밀번호 (4자 이상):`);
        if (!pw) return;
        if (pw.length < 4) { alert('비밀번호는 4자 이상이어야 합니다.'); return; }
        try {
          await resetUserPassword(u.id, pw);
          item.querySelector('.pw-display').textContent = pw;
          u.password_plain = pw;
        } catch (err) { alert(err.message); }
      };
      item.querySelector('.btn-pw-reset').addEventListener('click', pwChange);
      item.querySelector('.pw-display').addEventListener('click', pwChange);

      list.appendChild(item);
    });
  } catch (err) {
    list.innerHTML = `<div style="color:#C8102E;font-size:13px">${err.message}</div>`;
  }
}

document.getElementById('btn-open-add-user').addEventListener('click', () => {
  document.getElementById('new-user-name').value = '';
  document.getElementById('new-user-email').value = '';
  document.getElementById('new-user-password').value = '';
  document.getElementById('new-user-role').value = 'member';
  openModal('modal-add-user');
});

document.getElementById('btn-add-user-confirm').addEventListener('click', async () => {
  const name     = document.getElementById('new-user-name').value.trim();
  const email    = document.getElementById('new-user-email').value.trim();
  const password = document.getElementById('new-user-password').value;
  const role     = document.getElementById('new-user-role').value;
  if (!name)     { alert('이름을 입력하세요.'); return; }
  if (!email)    { alert('이메일을 입력하세요.'); return; }
  if (!password || password.length < 4) { alert('비밀번호는 4자 이상이어야 합니다.'); return; }
  try {
    await createUser(name, email, password, role);
    closeModal('modal-add-user');
    await renderUserList();
    try { userNames = await fetchUserNames(); } catch {}
    populateAssigneeSelect();
    await loadLoginNames();
    alert(`"${name}" 사용자가 추가됐습니다.`);
  } catch (err) { alert(err.message); }
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

  const fd = filteredData();
  const templateData = {
    tasks: fd.tasks.map(t => ({
      id: t.id, name: t.name, x: t.x, y: t.y,
      status: 'pending', assignee: '', note: '', subtasks: [], dueDate: null
    })),
    flows: fd.flows.map(f => ({ id: f.id, from: f.from, to: f.to }))
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
    const project = addProject(data, projectName);
    // 현재 필터 뷰에 있으면 신규 프로젝트를 해당 뷰에 추가
    const view = activeView();
    if (view && view.projectIds.length > 0) view.projectIds.push(project.id);

    const idMap = {};
    for (const t of tmpl.data.tasks) {
      const newTask = addTask(data, { name: t.name, projectId: project.id, x: t.x, y: t.y });
      idMap[t.id] = newTask.id;
    }
    for (const f of tmpl.data.flows) {
      if (idMap[f.from] && idMap[f.to]) addFlow(data, idMap[f.from], idMap[f.to]);
    }

    saveData(data);
    graph.setData(filteredData());
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
          graph.setData(filteredData());
          buildFilters();
          renderSidebar();
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

async function loadLoginNames() {
  try {
    const names = await fetchUserNames();
    const sel = document.getElementById('login-name-select');
    sel.innerHTML = '<option value="">이름을 선택하세요</option>';
    names.forEach(n => {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      sel.appendChild(o);
    });
  } catch {}
}

async function init() {
  const vEl = document.getElementById('toolbar-version');
  const lEl = document.getElementById('login-version');
  if (vEl) vEl.textContent = VERSION;
  if (lEl) lEl.textContent = VERSION;

  document.getElementById('login-submit').addEventListener('click', doLogin);
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  try {
    await Promise.race([
      loadLoginNames(),
      new Promise(r => setTimeout(r, 8000))
    ]);
    currentUser = await Promise.race([
      checkAuth(),
      new Promise(r => setTimeout(r, 8000))
    ]);
  } catch {
    currentUser = null;
  } finally {
    clearTimeout(window.__loadingGuard);
    document.getElementById('app-loading')?.remove();
  }

  if (!currentUser) {
    showLoginOverlay();
  } else {
    await startApp();
  }
}

init().catch(err => {
  console.error('[init 오류]', err);
  clearTimeout(window.__loadingGuard);
  document.getElementById('app-loading')?.remove();
  document.getElementById('login-overlay')?.classList.remove('hidden');
});
