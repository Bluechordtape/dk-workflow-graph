const fs = require('fs');
let g = fs.readFileSync('graph.js', 'utf8');

// ── 1. _edgePaths Map 초기화 (_taskEls 등 있는 곳 근처) ──────
const INIT_OLD = `    this._taskEls    = new Map(); // taskId    → el\r\n    this._groupEls   = new Map(); // groupId   → { el, group }\r\n    this._projectEls = new Map(); // projectId → { el, project }`;
const INIT_NEW = `    this._taskEls    = new Map(); // taskId    → el\r\n    this._groupEls   = new Map(); // groupId   → { el, group }\r\n    this._projectEls = new Map(); // projectId → { el, project }\r\n    this._edgePaths  = new Map(); // flowId    → { path, hitPath }`;

if (g.includes(INIT_OLD)) {
  g = g.replace(INIT_OLD, INIT_NEW);
  console.log('1. _edgePaths 초기화 추가됨');
} else { console.error('1. 초기화 패턴 못찾음'); }

// ── 2. _renderEdges() 교체: updateOnly 모드 추가 ─────────────
// 기존 _renderEdges 시작 부분 찾기
const RE_OLD = `  _renderEdges() {\r\n    Array.from(this.svg.children).forEach(c => {\r\n      if (c.tagName !== 'defs' && c !== this.tempPath) c.remove();\r\n    });\r\n    if (!this.data?.flows) return;`;
const RE_NEW = `  _renderEdges(updateOnly = false) {\r\n    if (!updateOnly) {\r\n      Array.from(this.svg.children).forEach(c => {\r\n        if (c.tagName !== 'defs' && c !== this.tempPath) c.remove();\r\n      });\r\n      this._edgePaths.clear();\r\n    }\r\n    if (!this.data?.flows) return;`;

if (g.includes(RE_OLD)) {
  g = g.replace(RE_OLD, RE_NEW);
  console.log('2. _renderEdges updateOnly 모드 추가됨');
} else { console.error('2. _renderEdges 시작 패턴 못찾음'); }

// ── 3. insertBefore 두 줄 이후에 _edgePaths 저장 추가 ─────────
// hitPath 등록 직후 (this.svg.insertBefore 두 번 후)
const IB_OLD = `      this.svg.insertBefore(path,    this.tempPath);\r\n      this.svg.insertBefore(hitPath, this.tempPath);\r\n    }\r\n  }`;
const IB_NEW = `      if (updateOnly) {\r\n        // 드래그 중: 기존 path d 속성만 갱신 (DOM 생성/삭제 없음)\r\n        const ep = this._edgePaths.get(flow.id);\r\n        if (ep) {\r\n          ep.path.setAttribute('d', pathD);\r\n          ep.hitPath.setAttribute('d', pathD);\r\n        }\r\n      } else {\r\n        this.svg.insertBefore(path,    this.tempPath);\r\n        this.svg.insertBefore(hitPath, this.tempPath);\r\n        this._edgePaths.set(flow.id, { path, hitPath });\r\n      }\r\n    }\r\n  }`;

if (g.includes(IB_OLD)) {
  g = g.replace(IB_OLD, IB_NEW);
  console.log('3. insertBefore → updateOnly 분기 추가됨');
} else { console.error('3. insertBefore 패턴 못찾음'); }

// ── 4. 드래그 RAF 안의 _renderEdges() → _renderEdges(true) ───
// mouseup 후 _renderEdges 는 false 유지, RAF 안에서만 true
const RAF_RE_OLD = `          this._renderEdges();\r\n        });\r\n        return;`;
const RAF_RE_NEW = `          this._renderEdges(true);\r\n        });\r\n        return;`;

if (g.includes(RAF_RE_OLD)) {
  g = g.replace(RAF_RE_OLD, RAF_RE_NEW);
  console.log('4. 드래그 RAF _renderEdges(true) 적용됨');
} else { console.error('4. RAF _renderEdges 패턴 못찾음'); }

// ── 5. VERSION + index.html ──────────────────────────────────
const a = fs.readFileSync('app.js', 'utf8');
fs.writeFileSync('app.js', a.replace(/const VERSION = 'v3\.\d+'/, "const VERSION = 'v3.18'"), 'utf8');
console.log('5. app.js VERSION → v3.18');

let h = fs.readFileSync('index.html', 'utf8');
fs.writeFileSync('index.html', h.replace(/app\.js\?v=[\d.]+/, 'app.js?v=3.18'), 'utf8');
console.log('6. index.html ?v=3.18');

fs.writeFileSync('graph.js', g, 'utf8');
console.log('\n완료!');
