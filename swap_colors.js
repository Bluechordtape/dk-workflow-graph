const fs = require('fs');

// doing: #1754C4 → #C8102E
// review: #C8102E → #1754C4
// 직접 교체 시 충돌 방지를 위해 임시값 경유
function swap(str) {
  return str
    .replace(/#1754C4/g, '__DOING__')
    .replace(/#C8102E/g, '#1754C4')
    .replace(/__DOING__/g, '#C8102E');
}

['graph.js', 'app.js', 'style.css'].forEach(f => {
  const orig = fs.readFileSync(f, 'utf8');
  const updated = swap(orig);
  fs.writeFileSync(f, updated, 'utf8');
  const count = (orig.match(/#1754C4|#C8102E/g) || []).length;
  console.log(`${f}: ${count}개 교체`);
});
