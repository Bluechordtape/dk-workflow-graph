const fs = require('fs');

// ── graph.js 수정 ─────────────────────────────────────────────
let g = fs.readFileSync('graph.js', 'utf8');

// 1. isDragging() getter 추가 (getTransform() 바로 뒤)
const GETTER_TARGET = 'getTransform() { return { x: this.offsetX, y: this.offsetY, k: this.scale }; }';
const GETTER_REPLACE = 'getTransform() { return { x: this.offsetX, y: this.offsetY, k: this.scale }; }\r\n  isDragging() { return !!this._drag; }';
if (g.includes(GETTER_TARGET)) {
  g = g.replace(GETTER_TARGET, GETTER_REPLACE);
  console.log('graph.js: isDragging() getter 추가됨');
} else {
  console.error('graph.js: getTransform 라인 못찾음');
}

// 2. mousemove 드래그 블록에 RAF 스로틀링 추가 (CRLF 대응)
const DRAG_OLD = "window.addEventListener('mousemove', (e) => {\r\n      // 드래그 처리\r\n      if (this._drag) {";
const DRAG_NEW = "window.addEventListener('mousemove', (e) => {\r\n      // 드래그 처리\r\n      if (this._drag) {\r\n        if (this._rafPending) return;\r\n        this._rafPending = true;\r\n        requestAnimationFrame(() => { this._rafPending = false; });";

if (g.includes(DRAG_OLD)) {
  g = g.replace(DRAG_OLD, DRAG_NEW);
  console.log('graph.js: RAF 스로틀링 추가됨');
} else {
  console.error('graph.js: 드래그 mousemove 블록 못찾음');
}

fs.writeFileSync('graph.js', g, 'utf8');

// ── app.js 수정 ─────────────────────────────────────────────
let a = fs.readFileSync('app.js', 'utf8');

// 1. socket data:updated 에서 드래그 중 setData 스킵 (CRLF 대응)
const SOCK_OLD = "graph.setData(filteredData());\r\n  buildFilters();";
const SOCK_NEW = "if (!graph?.isDragging()) graph.setData(filteredData());\r\n  buildFilters();";
if (a.includes(SOCK_OLD)) {
  a = a.replace(SOCK_OLD, SOCK_NEW);
  console.log('app.js: 드래그 중 setData 스킵 추가됨');
} else {
  // 4-space indent variant
  const SOCK_OLD2 = "    graph.setData(filteredData());\r\n    buildFilters();";
  const SOCK_NEW2 = "    if (!graph?.isDragging()) graph.setData(filteredData());\r\n    buildFilters();";
  if (a.includes(SOCK_OLD2)) {
    a = a.replace(SOCK_OLD2, SOCK_NEW2);
    console.log('app.js: 드래그 중 setData 스킵 추가됨 (4-space indent)');
  } else {
    console.error('app.js: socket data:updated 블록 못찾음');
    // print context for debugging
    const idx = a.indexOf('graph.setData(filteredData())');
    console.log('context:', JSON.stringify(a.slice(idx-10, idx+60)));
  }
}

// 2. VERSION 업데이트
if (a.includes("const VERSION = 'v3.16'")) {
  console.log('app.js: VERSION 이미 v3.16');
} else {
  a = a.replace(/const VERSION = 'v3\.\d+'/, "const VERSION = 'v3.16'");
  console.log('app.js: VERSION → v3.16');
}

fs.writeFileSync('app.js', a, 'utf8');

// ── index.html 버전 쿼리스트링 업데이트 ─────────────────────
let h = fs.readFileSync('index.html', 'utf8');
const hBefore = h;
h = h.replace(/app\.js\?v=[\d.]+/, 'app.js?v=3.16');
if (h !== hBefore) console.log('index.html: ?v=3.16 업데이트됨');
else console.log('index.html: 이미 최신');
fs.writeFileSync('index.html', h, 'utf8');

console.log('\n완료!');
