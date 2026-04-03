const fs = require('fs');
let g = fs.readFileSync('graph.js', 'utf8');
let css = fs.readFileSync('style.css', 'utf8');
const ok = [], fail = [];

function rep(label, oldStr, newStr, target = 'g') {
  const src = target === 'g' ? g : css;
  if (src.includes(oldStr)) {
    if (target === 'g') g = g.replace(oldStr, newStr);
    else css = css.replace(oldStr, newStr);
    ok.push(label);
  } else {
    fail.push(label);
  }
}

// ═══════════════════════════════════════════════════════
// 1단계: 데이터 인덱스 Map 구축
// ═══════════════════════════════════════════════════════

// 1-1. 생성자에 Map 선언 추가
rep('constructor maps',
`    this._edgePaths  = new Map(); // flowId    → { path, hitPath }`,
`    this._edgePaths  = new Map(); // flowId    → { path, hitPath }\r\n\r\n    // 데이터 인덱스 (O(1) 조회용)\r\n    this._taskMap        = new Map(); // taskId    → task\r\n    this._groupMap       = new Map(); // groupId   → group\r\n    this._projectMap     = new Map(); // projectId → project\r\n    this._tasksByGroup   = new Map(); // groupId   → [tasks]\r\n    this._groupsByProject= new Map(); // projectId → [groups]\r\n    this._orphansByProject=new Map(); // projectId → [tasks without groupId]`
);

// 1-2. _renderNodes 시작 시 인덱스 빌드
rep('build index maps',
`    this._taskEls.clear();\r\n    this._groupEls.clear();\r\n    this._projectEls.clear();`,
`    this._taskEls.clear();\r\n    this._groupEls.clear();\r\n    this._projectEls.clear();\r\n\r\n    // 인덱스 맵 빌드\r\n    this._taskMap.clear(); this._groupMap.clear(); this._projectMap.clear();\r\n    this._tasksByGroup.clear(); this._groupsByProject.clear(); this._orphansByProject.clear();\r\n    for (const t of (this.data.tasks || [])) {\r\n      this._taskMap.set(t.id, t);\r\n      if (t.groupId) {\r\n        if (!this._tasksByGroup.has(t.groupId)) this._tasksByGroup.set(t.groupId, []);\r\n        this._tasksByGroup.get(t.groupId).push(t);\r\n      } else if (t.projectId) {\r\n        if (!this._orphansByProject.has(t.projectId)) this._orphansByProject.set(t.projectId, []);\r\n        this._orphansByProject.get(t.projectId).push(t);\r\n      }\r\n    }\r\n    for (const gr of (this.data.groups || [])) {\r\n      this._groupMap.set(gr.id, gr);\r\n      if (gr.projectId) {\r\n        if (!this._groupsByProject.has(gr.projectId)) this._groupsByProject.set(gr.projectId, []);\r\n        this._groupsByProject.get(gr.projectId).push(gr);\r\n      }\r\n    }\r\n    for (const p of (this.data.projects || [])) this._projectMap.set(p.id, p);`
);

// 1-3. _groupBBox: filter → Map 조회
rep('_groupBBox use map',
`    const tasks = (this.data.tasks || []).filter(t => t.groupId === group.id);`,
`    const tasks = this._tasksByGroup.get(group.id) || (this.data.tasks || []).filter(t => t.groupId === group.id);`
);

// 1-4. _projectBBox: filter → Map 조회
rep('_projectBBox groups map',
`    const groups = (this.data.groups || []).filter(g => g.projectId === project.id);\r\n    const orphans = (this.data.tasks || []).filter(t => t.projectId === project.id && !t.groupId);`,
`    const groups  = this._groupsByProject.get(project.id)  || (this.data.groups || []).filter(g => g.projectId === project.id);\r\n    const orphans = this._orphansByProject.get(project.id) || (this.data.tasks  || []).filter(t => t.projectId === project.id && !t.groupId);`
);

// 1-5. _renderNodes task 루프: find → Map
rep('_renderNodes project find',
`      const project = (this.data.projects || []).find(p => p.id === task.projectId);`,
`      const project = this._projectMap.get(task.projectId);`
);

// 1-6. _renderEdges: 4개 find → Map
rep('_renderEdges finds',
`      const fromTask  = (this.data.tasks  || []).find(t => t.id === flow.from);\r\n      const toTask    = (this.data.tasks  || []).find(t => t.id === flow.to);\r\n      const fromGroup = (this.data.groups || []).find(g => g.id === flow.from);\r\n      const toGroup   = (this.data.groups || []).find(g => g.id === flow.to);`,
`      const fromTask  = this._taskMap.get(flow.from);\r\n      const toTask    = this._taskMap.get(flow.to);\r\n      const fromGroup = this._groupMap.get(flow.from);\r\n      const toGroup   = this._groupMap.get(flow.to);`
);

// 1-7. _getMovedPositions: find → Map
rep('_getMovedPositions task find',
`      const t = (this.data.tasks || []).find(t => t.id === id);`,
`      const t = this._taskMap.get(id);`
);
rep('_getMovedPositions group find',
`      const g = (this.data.groups || []).find(g => g.id === id);`,
`      const g = this._groupMap.get(id);`
);
rep('_getMovedPositions project find',
`      const p = (this.data.projects || []).find(p => p.id === id);`,
`      const p = this._projectMap.get(id);`
);

// 1-8. RAF group drag: find → Map
rep('RAF group find',
`            const group = (this.data.groups || []).find(g => g.id === id);\r\n            if (group) { group.x = sp.x + dx; group.y = sp.y + dy; }`,
`            const group = this._groupMap.get(id);\r\n            if (group) { group.x = sp.x + dx; group.y = sp.y + dy; }`
);

// 1-9. RAF project drag: find → Map
rep('RAF project find',
`            const project = (this.data.projects || []).find(p => p.id === id);\r\n            if (project) { project.x = sp.x + dx; project.y = sp.y + dy; }`,
`            const project = this._projectMap.get(id);\r\n            if (project) { project.x = sp.x + dx; project.y = sp.y + dy; }`
);

// ═══════════════════════════════════════════════════════
// 2단계: task 단일 드래그 → transform 방식
// ═══════════════════════════════════════════════════════

// 2-1. RAF task 드래그 블록 교체
rep('RAF task transform',
`          if (type === 'task') {\r\n            const task = (this.data.tasks || []).find(t => t.id === id);\r\n            if (task) {\r\n              task.x = sp.x + dx;\r\n              task.y = sp.y + dy;\r\n              const el = this._taskEls.get(id);\r\n              if (el) { el.style.left = \`\${task.x}px\`; el.style.top = \`\${task.y}px\`; }\r\n              if (task.groupId)   this._updateGroupEl(task.groupId);\r\n              if (task.projectId) this._updateProjectEl(task.projectId);\r\n            }\r\n          }`,
`          if (type === 'task') {\r\n            const task = this._taskMap.get(id);\r\n            if (task) {\r\n              task.x = sp.x + dx;\r\n              task.y = sp.y + dy;\r\n              const el = this._taskEls.get(id);\r\n              if (el) el.style.transform = \`translate(\${dx}px,\${dy}px)\`;\r\n            }\r\n          }`
);

// 2-2. mouseup task 클린업 교체 (groupEl/projectEl 1회 업데이트 추가)
rep('mouseup task cleanup',
`        if (type === 'task') {\r\n          const t = this._taskMap?.get(id) || (this.data.tasks || []).find(t => t.id === id);\r\n          fin(this._taskEls.get(id), t?.x, t?.y);\r\n        }`,
`        if (type === 'task') {\r\n          const t = this._taskMap.get(id);\r\n          fin(this._taskEls.get(id), t?.x, t?.y);\r\n          if (t?.groupId)   this._updateGroupEl(t.groupId);\r\n          if (t?.projectId) this._updateProjectEl(t.projectId);\r\n        }`
);

// 2-3. card mousedown: will-change + draggedIds 추가
rep('card mousedown draggedIds',
`      this._drag = { type: 'task', id: task.id, sm: { x: e.clientX, y: e.clientY }, sp: { x: task.x, y: task.y } };\r\n    });\r\n\r\n    // orb 클릭`,
`      const _tel = this._taskEls.get(task.id); if (_tel) _tel.style.willChange = 'transform';\r\n      this._drag = { type: 'task', id: task.id, sm: { x: e.clientX, y: e.clientY }, sp: { x: task.x, y: task.y }, draggedIds: new Set([task.id]) };\r\n    });\r\n\r\n    // orb 클릭`
);

// 2-4. done mini mousedown: will-change + draggedIds 추가
rep('mini mousedown draggedIds',
`        this._drag = { type: 'task', id: task.id, sm: { x: e.clientX, y: e.clientY }, sp: { x: task.x, y: task.y } };`,
`        const _dtel = this._taskEls.get(task.id); if (_dtel) _dtel.style.willChange = 'transform';\r\n        this._drag = { type: 'task', id: task.id, sm: { x: e.clientX, y: e.clientY }, sp: { x: task.x, y: task.y }, draggedIds: new Set([task.id]) };`
);

// ═══════════════════════════════════════════════════════
// 3단계: CSS 수정
// ═══════════════════════════════════════════════════════

// 3-1. highlight-self border-width 제거 (레이아웃 유발)
rep('remove border-width highlight',
`  border-color: #6B7280 !important;\r\n  border-width: 1.5px !important;`,
`  border-color: #6B7280 !important;`,
'css'
);

// 3-2. .task-node에 contain 추가
rep('task-node contain',
`.task-node {\r\n  position: absolute;`,
`.task-node {\r\n  position: absolute;\r\n  contain: layout style;`,
'css'
);

// ═══════════════════════════════════════════════════════
// VERSION bump
// ═══════════════════════════════════════════════════════
const a = fs.readFileSync('app.js', 'utf8');
fs.writeFileSync('app.js', a.replace(/const VERSION = 'v3\.\d+'/, "const VERSION = 'v3.20'"), 'utf8');
let h = fs.readFileSync('index.html', 'utf8');
fs.writeFileSync('index.html', h.replace(/app\.js\?v=[\d.]+/, 'app.js?v=3.20'), 'utf8');

fs.writeFileSync('graph.js', g, 'utf8');
fs.writeFileSync('style.css', css, 'utf8');

console.log('✓', ok.join('\n✓ '));
if (fail.length) console.error('\n✗ 실패:', fail.join('\n✗ '));
console.log('\napp.js → v3.20');
