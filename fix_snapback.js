const fs = require('fs');
let g = fs.readFileSync('graph.js', 'utf8');
let a = fs.readFileSync('app.js', 'utf8');
const ok = [], fail = [];

function rep(label, old, neu, target) {
  const src = target === 'a' ? a : g;
  if (src.includes(old)) {
    if (target === 'a') a = a.replace(old, neu);
    else g = g.replace(old, neu);
    ok.push(label);
  } else {
    fail.push(label + ' [패턴없음]');
  }
}

// ── 1. isDragging() 중복 제거 + 쿨다운 지원으로 교체 ────────────────
// 두 개의 isDragging()을 하나로 교체
// 중복 패턴: LF 버전 + CRLF 버전이 연속으로 존재
const DUP = "isDragging() { return !!this._drag; }\n  isDragging() { return !!this._drag; }";
const SINGLE = "isDragging() { return !!this._drag || (!!this._dragEndedAt && Date.now() - this._dragEndedAt < 400); }";
if (g.includes(DUP)) {
  g = g.replace(DUP, SINGLE);
  ok.push('isDragging dedup + cooldown');
} else {
  // 혹시 이미 단일인 경우 그냥 교체
  const SINGLE_OLD = "isDragging() { return !!this._drag; }";
  if (g.includes(SINGLE_OLD)) {
    g = g.replace(SINGLE_OLD, SINGLE);
    ok.push('isDragging cooldown (single)');
  } else {
    fail.push('isDragging dedup [패턴없음]');
  }
}

// ── 2. mouseup: _drag = null 전에 _dragEndedAt 기록 ─────────────────
rep('dragEndedAt on mouseup',
`        this._renderEdges();\r\n        const moved = this._getMovedPositions();\r\n        this.cb.onNodeMoved?.(moved);\r\n        this._drag = null;`,
`        this._renderEdges();\r\n        const moved = this._getMovedPositions();\r\n        this.cb.onNodeMoved?.(moved);\r\n        this._dragEndedAt = Date.now();\r\n        this._drag = null;`
);

// ── 3. mousemove: 버튼 안눌린 상태에서 _drag 있으면 강제 종료 ────────
rep('mousemove button check',
`    window.addEventListener('mousemove', (e) => {\r\n      // 드래그 처리\r\n      if (this._drag) {`,
`    window.addEventListener('mousemove', (e) => {\r\n      // 마우스 버튼이 이미 해제됐으면 드래그 강제 종료 (브라우저 밖 mouseup 미감지 대비)\r\n      if (this._drag && e.buttons === 0) {\r\n        this._dragEndedAt = Date.now();\r\n        this._drag = null;\r\n        this._rafPending = false;\r\n        this._renderEdges();\r\n        return;\r\n      }\r\n      // 드래그 처리\r\n      if (this._drag) {`
);

// ── 4. app.js data:updated 에 isDragging 가드 추가 ───────────────────
rep('data:updated guard',
`    data = normalize(newData);\r\n    graph.setData(filteredData());`,
`    data = normalize(newData);\r\n    if (!graph?.isDragging()) graph.setData(filteredData());`
);

// ── 5. VERSION bump ──────────────────────────────────────────────────
a = a.replace(/const VERSION = 'v3\.\d+'/, "const VERSION = 'v3.21'");
let h = fs.readFileSync('index.html', 'utf8');
h = h.replace(/app\.js\?v=[\d.]+/, 'app.js?v=3.21');

fs.writeFileSync('graph.js', g, 'utf8');
fs.writeFileSync('app.js', a, 'utf8');
fs.writeFileSync('index.html', h, 'utf8');

console.log('✓', ok.join('\n✓ '));
if (fail.length) console.error('✗', fail.join('\n✗ '));
console.log('\nVERSION → v3.21');
