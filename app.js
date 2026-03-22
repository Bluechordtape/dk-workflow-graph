// app.js
const VERSION = 'v2.2';


  loadData, saveData, saveTaskStatus, exportJSON, importJSON,
  setSocketId, setToken,
  addProject, deleteProject,
  addTask, updateTask, deleteTask,
  addFlow, deleteFlow,
  updateTaskMember,
  addGroup, deleteGroup, GROUP_COLORS,
  fetchTemplates, saveTemplate, deleteTemplate,
  fetchBackups, createBackup, restoreBackup, deleteBackup,
  addSheet, deleteSheet, copyTaskToSheet, normalize,
  fetchUserNames, fetchUsers, updateUserRole, resetUserPassword, createUser
} from './data.js';
import { Graph } from './graph.js';

let data = null;
let graph = null;
let activeTaskId = null;
let currentUser = null; // { id, email, name, role }
let userNames = [];     // 전체 팀원 이름 목록
let calendarDate = new Date(); // 현재 캘린더 월
let viewMode = 'graph'; // 'graph' | 'calendar'

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
  if (activeTaskId) {
    const t = cs().tasks.find(t => t.id === activeTaskId);
    if (t) openPanel(t); else closePanel();
  }
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.parse(JSON.stringify(data)));
  data = normalize(redoStack.pop());
  saveData(data);
  graph.setData(cs());
  buildFilters();
  renderSheetTabs();
  if (activeTaskId) {
    const t = cs().tasks.find(t => t.id === activeTaskId);
    if (t) openPanel(t); else closePanel();
  }
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
            data = normalize(result.data);
            graph.setData(cs());
            buildFilters();
            if (activeTaskId === taskId) document.getElementById('task-status').value = st;
          } catch (err) { alert(err.message); }
        } else {
          pushUndo();
          updateTask(cs(), taskId, { status: st });
          saveData(data);
          graph.setData(cs());
          buildFilters();
          if (activeTaskId === taskId) document.getElementById('task-status').value = st;
        }
      },
      onNodeMoved: () => { if (canWrite()) saveData(data); }
    });

    // 키보드 단축키 (텍스트 입력 중에는 브라우저 기본 동작 유지)
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

  // 팀원 이름 목록 로드
  try { userNames = await fetchUserNames(); } catch { userNames = []; }

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
  populateAssigneeSelect();
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
  // 관리자급만 완료/종결 설정 가능
  const statusSel = document.getElementById('task-status');
  statusSel.querySelectorAll('option').forEach(opt => {
    if (opt.value === 'done' || opt.value === 'closed') {
      opt.style.display = canWrite() ? '' : 'none';
    }
  });
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

  // 모든 시트의 태스크를 날짜별로 종합
  const tasksByDate = {};
  for (const sheet of data.sheets) {
    for (const task of sheet.tasks) {
      if (!task.dueDate) continue;
      const key = task.dueDate.slice(0, 10); // YYYY-MM-DD
      if (!tasksByDate[key]) tasksByDate[key] = [];
      tasksByDate[key].push({ task, sheet });
    }
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
      entries.forEach(({ task, sheet: taskSheet }) => {
        const project = taskSheet.projects.find(p => p.id === task.projectId);
        const chip = document.createElement('div');
        chip.className = 'cal-task-chip';
        chip.textContent = task.name;
        chip.style.background = (project?.color || '#9E9E9E') + '22';
        chip.style.color = project?.color || '#424242';
        chip.style.borderLeft = `3px solid ${project?.color || '#9E9E9E'}`;
        chip.title = `[${taskSheet.name}] ${task.name} (${task.assignee || '미배정'})`;
        chip.addEventListener('click', () => {
          // 해당 업무의 시트로 전환 후 패널 열기
          if (data.activeSheetId !== taskSheet.id) {
            data.activeSheetId = taskSheet.id;
            saveData(data);
            graph.setData(cs());
            buildFilters();
            renderSheetTabs();
          }
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
  const sheet = cs();
  const hasUnassigned = sheet.tasks.some(t => !t.assignee);
  const asel = document.getElementById('filter-assignee');
  const av = asel.value;
  asel.innerHTML = '<option value="">담당자 전체</option>';
  if (hasUnassigned) {
    const o = document.createElement('option'); o.value = '__unassigned__'; o.textContent = '미배정'; asel.appendChild(o);
  }
  // 등록된 전체 사용자 목록 사용 (패널과 동일)
  userNames.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; asel.appendChild(o); });
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

  const pendingCount = sheet.tasks.filter(t => t.status === 'review' || t.status === 'inactive').length;
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
  const sheet = cs();
  if (!sheet?.tasks) { bar.style.display = 'none'; return; }

  const projectFilter  = document.getElementById('filter-project').value;
  const assigneeFilter = document.getElementById('filter-assignee').value;

  let tasks = sheet.tasks;
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
    ? (sheet.projects.find(p => p.id === projectFilter)?.name || '프로젝트')
    : '전체 프로젝트';

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
      if (viewMode === 'calendar') renderCalendar();
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
    if (!name?.trim()) return;
    pushUndo();
    addProject(cs(), name.trim());
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
  // 관리자급만 완료/종결 설정 가능
  statusEl.querySelectorAll('option').forEach(opt => {
    if (opt.value === 'done' || opt.value === 'closed') opt.style.display = canWrite() ? '' : 'none';
  });
  statusEl.value = task.status || 'pre';

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
  const task = cs().tasks.find(t => t.id === activeTaskId);
  if (!task) return;
  if (!task.subtasks) task.subtasks = [];

  const s = { id: `s_${Date.now()}`, name: '', status: 'pending' };
  task.subtasks.push(s);
  saveData(data);

  // 전체 재렌더링 없이 새 행만 추가 후 포커스
  const list = document.getElementById('subtask-list');
  const row = makeSubtaskRow(task, s);
  list.appendChild(row);
  const input = row.querySelector('.sub-name');
  requestAnimationFrame(() => input.focus());
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
  // 패널이 열려 있으면 그룹 선택 목록 갱신
  if (activeTaskId) {
    const task = cs().tasks.find(t => t.id === activeTaskId);
    if (task) {
      const gs = document.getElementById('task-group');
      const prev = gs.value;
      gs.innerHTML = '<option value="">그룹 없음</option>';
      (cs().groups || []).forEach(g => {
        const o = document.createElement('option');
        o.value = g.id; o.textContent = g.name;
        gs.appendChild(o);
      });
      gs.value = prev;
    }
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
    const roleColor = { admin: '#212121', leader: '#6366F1', manager: '#9E9E9E', member: '#BDBDBD' };
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

      // 권한 저장 (최적화: 전체 재렌더링 없이 해당 아이템만 업데이트)
      item.querySelector('.btn-role-save').addEventListener('click', async (e) => {
        const btn = e.target;
        const role = item.querySelector('.user-role-sel').value;
        btn.disabled = true; btn.textContent = '저장 중...';
        try {
          await updateUserRole(u.id, role);
          u.role = role;
          // 아이템 뱃지 + 아바타 색상만 갱신
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

      // 비밀번호 변경
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
    // 담당자 목록 + 로그인 드롭다운 갱신
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
  // 버전 표시
  const vEl = document.getElementById('toolbar-version');
  const lEl = document.getElementById('login-version');
  if (vEl) vEl.textContent = VERSION;
  if (lEl) lEl.textContent = VERSION;

  document.getElementById('login-submit').addEventListener('click', doLogin);
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  // 10초 안에 응답 없으면 로그인 화면으로 강제 이동
  const loadingGuard = setTimeout(() => {
    document.getElementById('app-loading')?.remove();
    showLoginOverlay();
  }, 10000);

  try {
    await Promise.race([
      loadLoginNames(),
      new Promise(r => setTimeout(r, 8000)) // 8초 타임아웃
    ]);
    currentUser = await Promise.race([
      checkAuth(),
      new Promise(r => setTimeout(r, 8000)) // 8초 타임아웃
    ]);
  } catch {
    currentUser = null;
  } finally {
    clearTimeout(loadingGuard);
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
  document.getElementById('app-loading')?.remove();
  document.getElementById('login-overlay')?.classList.remove('hidden');
});
