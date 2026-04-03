const fs = require('fs');
let g = fs.readFileSync('graph.js', 'utf8');

// ── 1. 그룹 mousedown: initialBBox 저장 ──────────────────────
// groupOffsets에 initialBBox 추가
const GROUP_MD_OLD =
`        taskOffsets: groupTasks.map(t => ({ t, ox: t.x, oy: t.y })),\r\n      };`;
const GROUP_MD_NEW =
`        taskOffsets: groupTasks.map(t => ({ t, ox: t.x, oy: t.y })),\r\n        initialBBox: { ...curBBox },\r\n      };`;

if (g.includes(GROUP_MD_OLD)) {
  g = g.replace(GROUP_MD_OLD, GROUP_MD_NEW);
  console.log('group mousedown: initialBBox 추가됨');
} else {
  console.error('group mousedown: 패턴 못찾음');
  console.log(JSON.stringify(g.slice(g.indexOf('taskOffsets: groupTasks'), g.indexOf('taskOffsets: groupTasks') + 80)));
}

// ── 2. 프로젝트 mousedown: initialBBox + 그룹별 bbox 저장 ────
const PROJ_MD_OLD =
`        groupOffsets: projectGroups.map(g => ({ g, ox: g.x ?? 0, oy: g.y ?? 0 })),\r\n      };`;
const PROJ_MD_NEW =
`        groupOffsets: projectGroups.map(g => ({ g, ox: g.x ?? 0, oy: g.y ?? 0, bbox: this._groupBBox(g) })),\r\n        initialBBox: { ...curBBox },\r\n      };`;

if (g.includes(PROJ_MD_OLD)) {
  g = g.replace(PROJ_MD_OLD, PROJ_MD_NEW);
  console.log('project mousedown: initialBBox + 그룹 bbox 추가됨');
} else {
  console.error('project mousedown: 패턴 못찾음');
}

// ── 3. mousemove 드래그 블록 전체 교체 ──────────────────────
// RAF 올바른 패턴: 최신 마우스 좌표 저장 + RAF 안에서 DOM 업데이트
const MM_OLD =
`      if (this._drag) {\r\n        if (this._rafPending) return;\r\n        this._rafPending = true;\r\n        requestAnimationFrame(() => { this._rafPending = false; });\r\n        const { type, id, sm, sp, taskOffsets, groupOffsets } = this._drag;\r\n        const dx = (e.clientX - sm.x) / this.scale;\r\n        const dy = (e.clientY - sm.y) / this.scale;\r\n\r\n        if (type === 'task') {\r\n          const task = (this.data.tasks || []).find(t => t.id === id);\r\n          if (task) {\r\n            task.x = sp.x + dx;\r\n            task.y = sp.y + dy;\r\n            const el = this._taskEls.get(id);\r\n            if (el) { el.style.left = \`\${task.x}px\`; el.style.top = \`\${task.y}px\`; }\r\n            if (task.groupId)   this._updateGroupEl(task.groupId);\r\n            if (task.projectId) this._updateProjectEl(task.projectId);\r\n          }\r\n        } else if (type === 'group') {\r\n          for (const { t, ox, oy } of taskOffsets) {\r\n            t.x = ox + dx; t.y = oy + dy;\r\n            const el = this._taskEls.get(t.id);\r\n            if (el) { el.style.left = \`\${t.x}px\`; el.style.top = \`\${t.y}px\`; }\r\n          }\r\n          const group = (this.data.groups || []).find(g => g.id === id);\r\n          if (group) { group.x = sp.x + dx; group.y = sp.y + dy; }\r\n          this._updateGroupEl(id);\r\n          if (group?.projectId) this._updateProjectEl(group.projectId);\r\n        } else if (type === 'project') {\r\n          for (const { t, ox, oy } of taskOffsets) {\r\n            t.x = ox + dx; t.y = oy + dy;\r\n            const el = this._taskEls.get(t.id);\r\n            if (el) { el.style.left = \`\${t.x}px\`; el.style.top = \`\${t.y}px\`; }\r\n          }\r\n          for (const { g, ox, oy } of groupOffsets) {\r\n            g.x = ox + dx; g.y = oy + dy;\r\n            this._updateGroupEl(g.id);\r\n          }\r\n          const project = (this.data.projects || []).find(p => p.id === id);\r\n          if (project) { project.x = sp.x + dx; project.y = sp.y + dy; }\r\n          this._updateProjectEl(id);\r\n        }\r\n        this._renderEdges();\r\n        return;\r\n      }`;

const MM_NEW =
`      if (this._drag) {\r\n        // 최신 마우스 좌표를 항상 저장 (RAF 내에서 사용)\r\n        this._lastMouse = { x: e.clientX, y: e.clientY };\r\n        if (this._rafPending) return;\r\n        this._rafPending = true;\r\n        requestAnimationFrame(() => {\r\n          this._rafPending = false;\r\n          if (!this._drag) return;\r\n          const { type, id, sm, sp, taskOffsets, groupOffsets, initialBBox } = this._drag;\r\n          const dx = (this._lastMouse.x - sm.x) / this.scale;\r\n          const dy = (this._lastMouse.y - sm.y) / this.scale;\r\n\r\n          if (type === 'task') {\r\n            const task = (this.data.tasks || []).find(t => t.id === id);\r\n            if (task) {\r\n              task.x = sp.x + dx;\r\n              task.y = sp.y + dy;\r\n              const el = this._taskEls.get(id);\r\n              if (el) { el.style.left = \`\${task.x}px\`; el.style.top = \`\${task.y}px\`; }\r\n              if (task.groupId)   this._updateGroupEl(task.groupId);\r\n              if (task.projectId) this._updateProjectEl(task.projectId);\r\n            }\r\n          } else if (type === 'group') {\r\n            for (const { t, ox, oy } of taskOffsets) {\r\n              t.x = ox + dx; t.y = oy + dy;\r\n              const el = this._taskEls.get(t.id);\r\n              if (el) { el.style.left = \`\${t.x}px\`; el.style.top = \`\${t.y}px\`; }\r\n            }\r\n            const group = (this.data.groups || []).find(g => g.id === id);\r\n            if (group) { group.x = sp.x + dx; group.y = sp.y + dy; }\r\n            // bbox 재계산 없이 초기 bbox에서 delta만 적용\r\n            const gEntry = this._groupEls.get(id);\r\n            if (gEntry && initialBBox) {\r\n              gEntry.el.style.left = \`\${initialBBox.x + dx}px\`;\r\n              gEntry.el.style.top  = \`\${initialBBox.y + dy}px\`;\r\n            }\r\n            if (group?.projectId) this._updateProjectEl(group.projectId);\r\n          } else if (type === 'project') {\r\n            for (const { t, ox, oy } of taskOffsets) {\r\n              t.x = ox + dx; t.y = oy + dy;\r\n              const el = this._taskEls.get(t.id);\r\n              if (el) { el.style.left = \`\${t.x}px\`; el.style.top = \`\${t.y}px\`; }\r\n            }\r\n            for (const { g, ox, oy, bbox } of (groupOffsets || [])) {\r\n              g.x = ox + dx; g.y = oy + dy;\r\n              const gEntry = this._groupEls.get(g.id);\r\n              if (gEntry && bbox) {\r\n                gEntry.el.style.left = \`\${bbox.x + dx}px\`;\r\n                gEntry.el.style.top  = \`\${bbox.y + dy}px\`;\r\n              }\r\n            }\r\n            const project = (this.data.projects || []).find(p => p.id === id);\r\n            if (project) { project.x = sp.x + dx; project.y = sp.y + dy; }\r\n            const pEntry = this._projectEls.get(id);\r\n            if (pEntry && initialBBox) {\r\n              pEntry.el.style.left = \`\${initialBBox.x + dx}px\`;\r\n              pEntry.el.style.top  = \`\${initialBBox.y + dy}px\`;\r\n            }\r\n          }\r\n          this._renderEdges();\r\n        });\r\n        return;\r\n      }`;

if (g.includes(MM_OLD)) {
  g = g.replace(MM_OLD, MM_NEW);
  console.log('mousemove: RAF + bbox 최적화 적용됨');
} else {
  console.error('mousemove: 패턴 못찾음 — 부분 확인 중...');
  const idx = g.indexOf("if (this._rafPending) return;");
  if (idx >= 0) console.log('rafPending 위치:', idx, JSON.stringify(g.slice(idx-20, idx+50)));
}

// ── 4. VERSION bump ──────────────────────────────────────────
const a = fs.readFileSync('app.js', 'utf8');
const aNew = a.replace(/const VERSION = 'v3\.\d+'/, "const VERSION = 'v3.17'");
fs.writeFileSync('app.js', aNew, 'utf8');
console.log('app.js: VERSION → v3.17');

let h = fs.readFileSync('index.html', 'utf8');
h = h.replace(/app\.js\?v=[\d.]+/, 'app.js?v=3.17');
fs.writeFileSync('index.html', h, 'utf8');
console.log('index.html: ?v=3.17');

fs.writeFileSync('graph.js', g, 'utf8');
console.log('\n완료!');
