// data.js — 데이터 관리 및 localStorage

const STORAGE_KEY = 'dk_workflow_data';

export async function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch {}
  }
  const res = await fetch('./sample-data.json');
  const data = await res.json();
  saveData(data);
  return data;
}

export function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function exportJSON(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dk-workflow-${new Date().toISOString().slice(0,10)}.json`;
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

export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// --- CRUD helpers (mutate in-place, call saveData after) ---

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

// find helpers
export function findTaskContext(data, taskId) {
  for (const project of data.projects) {
    for (const category of project.categories) {
      const task = category.tasks.find(t => t.id === taskId);
      if (task) return { project, category, task };
    }
  }
  return null;
}

const COLORS = ['#7C3AED','#0891B2','#059669','#DC2626','#D97706','#DB2777','#2563EB','#16A34A'];
let colorIdx = 0;
function randomColor() { return COLORS[colorIdx++ % COLORS.length]; }
