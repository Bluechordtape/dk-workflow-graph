// app.js — 메인 로직
import { loadData, saveData, exportJSON, importJSON, generateId,
         addProject, deleteProject, addCategory, deleteCategory,
         addTask, deleteTask, updateTask, moveTask, findTaskContext,
         addFlow, deleteFlow, cleanFlows } from './data.js';
import { Graph } from './graph.js';

let data = null;
let graph = null;
let activePanel = null; // { type, project, category, task }
let connectModeActive = false;

async function init() {
  data = await loadData();

  const container = document.getElementById('graph-container');
  graph = new Graph(container, onNodeClick);
  graph.setFlowCallbacks(
    (fromId, toId) => {
      addFlow(data, fromId, toId);
      saveData(data);
      graph.setData(data);
    },
    (flowId) => {
      deleteFlow(data, flowId);
      saveData(data);
      graph.setData(data);
    }
  );
  graph.setData(data);

  buildAssigneeFilter();
  buildProjectFilter();
  setupToolbar();
  setupPanel();
}

// ── Filters ──────────────────────────────────────────────

function buildAssigneeFilter() {
  const assignees = new Set();
  data.projects.forEach(p => p.categories.forEach(c => c.tasks.forEach(t => {
    if (t.assignee) assignees.add(t.assignee);
  })));
  const sel = document.getElementById('filter-assignee');
  sel.innerHTML = '<option value="">담당자 전체</option>';
  assignees.forEach(a => {
    const o = document.createElement('option');
    o.value = a; o.textContent = a;
    sel.appendChild(o);
  });
}

function buildProjectFilter() {
  const sel = document.getElementById('filter-project');
  sel.innerHTML = '<option value="">프로젝트 전체</option>';
  data.projects.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    sel.appendChild(o);
  });
}

function applyFilters() {
  graph.setFilter({
    assignee: document.getElementById('filter-assignee').value,
    project: document.getElementById('filter-project').value,
    status: document.getElementById('filter-status').value
  });
}

// ── Toolbar ───────────────────────────────────────────────

function setupToolbar() {
  document.getElementById('filter-assignee').addEventListener('change', applyFilters);
  document.getElementById('filter-project').addEventListener('change', applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);

  document.getElementById('btn-reset-view').addEventListener('click', () => graph.resetView());
  document.getElementById('btn-relayout').addEventListener('click', () => graph.relayout());

  document.getElementById('btn-connect-mode').addEventListener('click', () => {
    connectModeActive = !connectModeActive;
    document.getElementById('btn-connect-mode').classList.toggle('active', connectModeActive);
    graph.setConnectMode(connectModeActive);
    if (connectModeActive) closePanel();
  });

  document.getElementById('btn-export').addEventListener('click', () => exportJSON(data));
  document.getElementById('btn-import').addEventListener('click', () => {
    importJSON((newData) => {
      data = newData;
      graph.setData(data);
      buildAssigneeFilter();
      buildProjectFilter();
      closePanel();
    });
  });

  document.getElementById('btn-add-project').addEventListener('click', () => {
    const name = prompt('새 프로젝트 이름:');
    if (!name) return;
    addProject(data, name);
    saveData(data);
    graph.setData(data);
    buildProjectFilter();
  });
}

// ── Side Panel ────────────────────────────────────────────

function setupPanel() {
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.getElementById('btn-save-task').addEventListener('click', saveTaskFromPanel);
  document.getElementById('btn-delete-task').addEventListener('click', deleteTaskFromPanel);
  document.getElementById('btn-move-up').addEventListener('click', () => moveTaskFromPanel('up'));
  document.getElementById('btn-move-down').addEventListener('click', () => moveTaskFromPanel('down'));
  document.getElementById('btn-add-task').addEventListener('click', addTaskFromPanel);
  document.getElementById('btn-delete-project').addEventListener('click', deleteProjectFromPanel);
  document.getElementById('btn-add-category').addEventListener('click', addCategoryFromPanel);
  document.getElementById('btn-delete-category').addEventListener('click', deleteCategoryFromPanel);
}

function onNodeClick(info) {
  activePanel = info;
  renderPanel(info);
}

function renderPanel(info) {
  const panel = document.getElementById('side-panel');
  panel.classList.add('open');

  // Hide all sections
  ['panel-task', 'panel-project', 'panel-category'].forEach(id =>
    document.getElementById(id).style.display = 'none'
  );

  if (info.type === 'task') {
    const { task, project, category: _cat } = info;
    const ctx = findTaskContext(data, task.id);
    if (!ctx) return;
    document.getElementById('panel-task').style.display = '';
    document.getElementById('panel-title').textContent = '태스크 편집';
    document.getElementById('task-name-input').value = task.name;
    document.getElementById('task-assignee-input').value = task.assignee;
    document.getElementById('task-status-input').value = task.status;
    document.getElementById('task-due-input').value = task.dueDate || '';
    document.getElementById('task-note-input').value = task.note || '';
    document.getElementById('task-project-label').textContent = `${ctx.project.name} › ${ctx.category.name}`;
  } else if (info.type === 'project') {
    document.getElementById('panel-project').style.display = '';
    document.getElementById('panel-title').textContent = '프로젝트';
    document.getElementById('project-name-display').textContent = info.project.name;
    document.getElementById('project-color-input').value = info.project.color;
    renderCategoryList(info.project);
  } else if (info.type === 'category') {
    document.getElementById('panel-category').style.display = '';
    document.getElementById('panel-title').textContent = '카테고리';
    document.getElementById('cat-name-display').textContent = info.category.name;
    document.getElementById('cat-project-label').textContent = info.project.name;
    renderCategoryTaskList(info.project, info.category);
  }
}

function closePanel() {
  document.getElementById('side-panel').classList.remove('open');
  activePanel = null;
}

function saveTaskFromPanel() {
  if (!activePanel || activePanel.type !== 'task') return;
  const ctx = findTaskContext(data, activePanel.task.id);
  if (!ctx) return;
  updateTask(ctx.category, activePanel.task.id, {
    name: document.getElementById('task-name-input').value,
    assignee: document.getElementById('task-assignee-input').value,
    status: document.getElementById('task-status-input').value,
    dueDate: document.getElementById('task-due-input').value,
    note: document.getElementById('task-note-input').value
  });
  saveData(data);
  graph.setData(data);
  buildAssigneeFilter();
}

function deleteTaskFromPanel() {
  if (!activePanel || activePanel.type !== 'task') return;
  if (!confirm('태스크를 삭제하시겠습니까?')) return;
  const ctx = findTaskContext(data, activePanel.task.id);
  if (!ctx) return;
  deleteTask(ctx.category, activePanel.task.id);
  cleanFlows(data);
  saveData(data);
  graph.setData(data);
  closePanel();
}

function moveTaskFromPanel(dir) {
  if (!activePanel || activePanel.type !== 'task') return;
  const ctx = findTaskContext(data, activePanel.task.id);
  if (!ctx) return;
  moveTask(ctx.category, activePanel.task.id, dir);
  saveData(data);
  graph.setData(data);
}

function addTaskFromPanel() {
  if (!activePanel) return;
  let project, category;
  if (activePanel.type === 'category') {
    project = activePanel.project; category = activePanel.category;
  } else if (activePanel.type === 'task') {
    const ctx = findTaskContext(data, activePanel.task.id);
    if (!ctx) return;
    project = ctx.project; category = ctx.category;
  } else if (activePanel.type === 'project') {
    project = activePanel.project;
    if (project.categories.length === 0) {
      alert('먼저 카테고리를 추가하세요.');
      return;
    }
    category = project.categories[project.categories.length - 1];
  }
  const name = prompt('새 태스크 이름:');
  if (!name) return;
  const task = addTask(category, { name });
  saveData(data);
  graph.setData(data);
  activePanel = { type: 'task', project, task };
  renderPanel(activePanel);
}

function renderCategoryList(project) {
  const list = document.getElementById('category-list');
  list.innerHTML = '';
  project.categories.forEach(cat => {
    const li = document.createElement('div');
    li.className = 'cat-list-item';
    li.textContent = `${cat.name} (태스크 ${cat.tasks.length}개)`;
    li.addEventListener('click', () => {
      activePanel = { type: 'category', project, category: cat };
      renderPanel(activePanel);
    });
    list.appendChild(li);
  });
}

function renderCategoryTaskList(project, category) {
  const list = document.getElementById('cat-task-list');
  list.innerHTML = '';
  category.tasks.forEach(task => {
    const li = document.createElement('div');
    li.className = 'cat-list-item';
    const sc = { done: '#1D9E75', wip: '#EF9F27', todo: '#888780' }[task.status];
    li.innerHTML = `<span style="color:${sc};margin-right:6px">●</span>${task.name} <span style="color:#888;font-size:11px">${task.assignee}</span>`;
    li.addEventListener('click', () => {
      activePanel = { type: 'task', project, task };
      renderPanel(activePanel);
    });
    list.appendChild(li);
  });
}

function deleteProjectFromPanel() {
  if (!activePanel || activePanel.type !== 'project') return;
  if (!confirm(`"${activePanel.project.name}" 프로젝트를 삭제하시겠습니까?`)) return;
  deleteProject(data, activePanel.project.id);
  cleanFlows(data);
  saveData(data);
  graph.setData(data);
  buildProjectFilter();
  closePanel();
}

function addCategoryFromPanel() {
  if (!activePanel || activePanel.type !== 'project') return;
  const name = prompt('새 카테고리 이름:');
  if (!name) return;
  addCategory(activePanel.project, name);
  saveData(data);
  graph.setData(data);
  renderCategoryList(activePanel.project);
}

function deleteCategoryFromPanel() {
  if (!activePanel || activePanel.type !== 'category') return;
  if (!confirm(`"${activePanel.category.name}" 카테고리를 삭제하시겠습니까?`)) return;
  deleteCategory(activePanel.project, activePanel.category.id);
  cleanFlows(data);
  saveData(data);
  graph.setData(data);
  closePanel();
}

init();
