const fs = require('fs');
let g = fs.readFileSync('graph.js', 'utf8');
const CRLF = '\r\n';
const ok = [];
const fail = [];

function rep(label, oldStr, newStr) {
  if (g.includes(oldStr)) { g = g.replace(oldStr, newStr); ok.push(label); }
  else { fail.push(label); }
}

// ── 1. 그룹 mousedown: draggedIds + projectInitialBBox + will-change ──
rep('group mousedown',
`      const groupTasks = (this.data.tasks || []).filter(t => t.groupId === group.id);\r\n      const curBBox = this._groupBBox(group);\r\n      group.x = curBBox.x;\r\n      group.y = curBBox.y;\r\n      this._drag = {\r\n        type: 'group',\r\n        id:   group.id,\r\n        sm:   { x: e.clientX, y: e.clientY },\r\n        sp:   { x: group.x, y: group.y },\r\n        taskOffsets: groupTasks.map(t => ({ t, ox: t.x, oy: t.y })),\r\n        initialBBox: { ...curBBox },\r\n      };`,
`      const groupTasks = (this.data.tasks || []).filter(t => t.groupId === group.id);\r\n      const curBBox = this._groupBBox(group);\r\n      group.x = curBBox.x;\r\n      group.y = curBBox.y;\r\n      const proj = group.projectId ? (this.data.projects || []).find(p => p.id === group.projectId) : null;\r\n      this._drag = {\r\n        type: 'group',\r\n        id:   group.id,\r\n        sm:   { x: e.clientX, y: e.clientY },\r\n        sp:   { x: group.x, y: group.y },\r\n        taskOffsets: groupTasks.map(t => ({ t, ox: t.x, oy: t.y })),\r\n        initialBBox: { ...curBBox },\r\n        projectInitialBBox: proj ? { ...this._projectBBox(proj) } : null,\r\n        draggedIds: new Set([group.id, ...groupTasks.map(t => t.id)]),\r\n      };\r\n      // GPU 레이어 승격\r\n      groupTasks.forEach(t => { const el = this._taskEls.get(t.id); if (el) el.style.willChange = 'transform'; });\r\n      const _ge = this._groupEls.get(group.id); if (_ge) _ge.el.style.willChange = 'transform';\r\n      if (proj) { const _pe = this._projectEls.get(proj.id); if (_pe) _pe.el.style.willChange = 'transform'; }`
);

// ── 2. 프로젝트 mousedown: draggedIds + will-change ──────────────────
rep('project mousedown',
`        taskOffsets:  projectTasks.map(t  => ({ t, ox: t.x, oy: t.y })),\r\n        groupOffsets: projectGroups.map(g => ({ g, ox: g.x ?? 0, oy: g.y ?? 0, bbox: this._groupBBox(g) })),\r\n        initialBBox: { ...curBBox },\r\n      };`,
`        taskOffsets:  projectTasks.map(t  => ({ t, ox: t.x, oy: t.y })),\r\n        groupOffsets: projectGroups.map(g => ({ g, ox: g.x ?? 0, oy: g.y ?? 0, bbox: this._groupBBox(g) })),\r\n        initialBBox: { ...curBBox },\r\n        draggedIds: new Set([project.id, ...projectGroups.map(g => g.id), ...projectTasks.map(t => t.id)]),\r\n      };\r\n      // GPU 레이어 승격\r\n      projectTasks.forEach(t => { const el = this._taskEls.get(t.id); if (el) el.style.willChange = 'transform'; });\r\n      projectGroups.forEach(g => { const ge = this._groupEls.get(g.id); if (ge) ge.el.style.willChange = 'transform'; });\r\n      { const pe = this._projectEls.get(project.id); if (pe) pe.el.style.willChange = 'transform'; }`
);

// ── 3. _renderEdges: draggedIds 파라미터 + 스킵 로직 ─────────────────
rep('_renderEdges signature',
`  _renderEdges(updateOnly = false) {\r\n    if (!updateOnly) {`,
`  _renderEdges(updateOnly = false, draggedIds = null) {\r\n    if (!updateOnly) {`
);

rep('_renderEdges flow skip',
`    for (const flow of this.data.flows) {\r\n      const fromTask  = (this.data.tasks  || []).find(t => t.id === flow.from);`,
`    for (const flow of this.data.flows) {\r\n      if (updateOnly && draggedIds && !draggedIds.has(flow.from) && !draggedIds.has(flow.to)) continue;\r\n      const fromTask  = (this.data.tasks  || []).find(t => t.id === flow.from);`
);

// ── 4. RAF: 그룹 드래그 → transform 사용, _updateProjectEl 제거 ──────
rep('RAF group branch',
`          } else if (type === 'group') {\r\n            for (const { t, ox, oy } of taskOffsets) {\r\n              t.x = ox + dx; t.y = oy + dy;\r\n              const el = this._taskEls.get(t.id);\r\n              if (el) { el.style.left = \`\${t.x}px\`; el.style.top = \`\${t.y}px\`; }\r\n            }\r\n            const group = (this.data.groups || []).find(g => g.id === id);\r\n            if (group) { group.x = sp.x + dx; group.y = sp.y + dy; }\r\n            // bbox 재계산 없이 초기 bbox에서 delta만 적용\r\n            const gEntry = this._groupEls.get(id);\r\n            if (gEntry && initialBBox) {\r\n              gEntry.el.style.left = \`\${initialBBox.x + dx}px\`;\r\n              gEntry.el.style.top  = \`\${initialBBox.y + dy}px\`;\r\n            }\r\n            if (group?.projectId) this._updateProjectEl(group.projectId);`,
`          } else if (type === 'group') {\r\n            const tdx = \`translate(\${dx}px,\${dy}px)\`;\r\n            for (const { t, ox, oy } of taskOffsets) {\r\n              t.x = ox + dx; t.y = oy + dy;\r\n              const el = this._taskEls.get(t.id);\r\n              if (el) el.style.transform = tdx;\r\n            }\r\n            const group = (this.data.groups || []).find(g => g.id === id);\r\n            if (group) { group.x = sp.x + dx; group.y = sp.y + dy; }\r\n            const gEntry = this._groupEls.get(id);\r\n            if (gEntry) gEntry.el.style.transform = tdx;\r\n            if (group?.projectId) {\r\n              const pEntry = this._projectEls.get(group.projectId);\r\n              const piBBox = this._drag?.projectInitialBBox;\r\n              if (pEntry) pEntry.el.style.transform = tdx;\r\n            }`
);

// ── 5. RAF: 프로젝트 드래그 → transform 사용 ────────────────────────
rep('RAF project branch',
`          } else if (type === 'project') {\r\n            for (const { t, ox, oy } of taskOffsets) {\r\n              t.x = ox + dx; t.y = oy + dy;\r\n              const el = this._taskEls.get(t.id);\r\n              if (el) { el.style.left = \`\${t.x}px\`; el.style.top = \`\${t.y}px\`; }\r\n            }\r\n            for (const { g, ox, oy, bbox } of (groupOffsets || [])) {\r\n              g.x = ox + dx; g.y = oy + dy;\r\n              const gEntry = this._groupEls.get(g.id);\r\n              if (gEntry && bbox) {\r\n                gEntry.el.style.left = \`\${bbox.x + dx}px\`;\r\n                gEntry.el.style.top  = \`\${bbox.y + dy}px\`;\r\n              }\r\n            }\r\n            const project = (this.data.projects || []).find(p => p.id === id);\r\n            if (project) { project.x = sp.x + dx; project.y = sp.y + dy; }\r\n            const pEntry = this._projectEls.get(id);\r\n            if (pEntry && initialBBox) {\r\n              pEntry.el.style.left = \`\${initialBBox.x + dx}px\`;\r\n              pEntry.el.style.top  = \`\${initialBBox.y + dy}px\`;\r\n            }\r\n          }`,
`          } else if (type === 'project') {\r\n            const tdx = \`translate(\${dx}px,\${dy}px)\`;\r\n            for (const { t, ox, oy } of taskOffsets) {\r\n              t.x = ox + dx; t.y = oy + dy;\r\n              const el = this._taskEls.get(t.id);\r\n              if (el) el.style.transform = tdx;\r\n            }\r\n            for (const { g, ox, oy } of (groupOffsets || [])) {\r\n              g.x = ox + dx; g.y = oy + dy;\r\n              const gEntry = this._groupEls.get(g.id);\r\n              if (gEntry) gEntry.el.style.transform = tdx;\r\n            }\r\n            const project = (this.data.projects || []).find(p => p.id === id);\r\n            if (project) { project.x = sp.x + dx; project.y = sp.y + dy; }\r\n            const pEntry = this._projectEls.get(id);\r\n            if (pEntry) pEntry.el.style.transform = tdx;\r\n          }`
);

// ── 6. RAF: _renderEdges(true) → draggedIds 전달 ─────────────────────
rep('RAF renderEdges call',
`          this._renderEdges(true);\r\n        });\r\n        return;`,
`          this._renderEdges(true, this._drag?.draggedIds);\r\n        });\r\n        return;`
);

// ── 7. mouseup: transform 해제 + 최종 left/top 적용 ─────────────────
rep('mouseup cleanup',
`    window.addEventListener('mouseup', (e) => {\r\n      if (this._drag) {\r\n        const moved = this._getMovedPositions();\r\n        this.cb.onNodeMoved?.(moved);\r\n        this._drag = null;\r\n      }`,
`    window.addEventListener('mouseup', (e) => {\r\n      if (this._drag) {\r\n        const { type, id, taskOffsets, groupOffsets } = this._drag;\r\n        // transform 해제 & 최종 좌표 left/top 확정\r\n        const fin = (el, x, y) => { if (!el) return; el.style.transform = ''; el.style.willChange = ''; if (x != null) { el.style.left = \`\${x}px\`; el.style.top = \`\${y}px\`; } };\r\n        if (type === 'task') {\r\n          const t = (this.data.tasks || []).find(t => t.id === id);\r\n          fin(this._taskEls.get(id), t?.x, t?.y);\r\n        } else if (type === 'group') {\r\n          for (const { t } of (taskOffsets || [])) fin(this._taskEls.get(t.id), t.x, t.y);\r\n          const ge = this._groupEls.get(id);\r\n          if (ge) { ge.el.style.transform = ''; ge.el.style.willChange = ''; this._updateGroupEl(id); }\r\n          const grp = (this.data.groups || []).find(g => g.id === id);\r\n          if (grp?.projectId) { const pe = this._projectEls.get(grp.projectId); if (pe) { pe.el.style.transform = ''; pe.el.style.willChange = ''; } this._updateProjectEl(grp.projectId); }\r\n        } else if (type === 'project') {\r\n          for (const { t } of (taskOffsets  || [])) fin(this._taskEls.get(t.id), t.x, t.y);\r\n          for (const { g } of (groupOffsets || [])) { const ge = this._groupEls.get(g.id); if (ge) { ge.el.style.transform = ''; ge.el.style.willChange = ''; this._updateGroupEl(g.id); } }\r\n          const pe = this._projectEls.get(id); if (pe) { pe.el.style.transform = ''; pe.el.style.willChange = ''; this._updateProjectEl(id); }\r\n        }\r\n        this._renderEdges();\r\n        const moved = this._getMovedPositions();\r\n        this.cb.onNodeMoved?.(moved);\r\n        this._drag = null;\r\n      }`
);

// ── 8. VERSION bump ──────────────────────────────────────────────────
const a = fs.readFileSync('app.js', 'utf8');
fs.writeFileSync('app.js', a.replace(/const VERSION = 'v3\.\d+'/, "const VERSION = 'v3.19'"), 'utf8');
let h = fs.readFileSync('index.html', 'utf8');
fs.writeFileSync('index.html', h.replace(/app\.js\?v=[\d.]+/, 'app.js?v=3.19'), 'utf8');

fs.writeFileSync('graph.js', g, 'utf8');
console.log('✓ 성공:', ok.join(', '));
if (fail.length) console.error('✗ 실패:', fail.join(', '));
console.log('app.js → v3.19');
