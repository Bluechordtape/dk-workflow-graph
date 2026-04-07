// graph.js — 3-tier hierarchy: Project > Group(Category) > Task

export const NODE_W = 200;
export const NODE_H = 60;
export const DONE_NODE_W = 29;  // 5(nh-l) + 19(mini-box) + 5(nh-r)
export const DONE_NODE_H = 19;

// Layout constants
const PROJECT_HEADER_H = 52;
const PROJECT_PAD_X    = 20;
const PROJECT_PAD_Y    = 16;
const GROUP_HEADER_H   = 40;
const GROUP_PAD_X      = 16;
const GROUP_PAD_Y      = 14;
const MIN_PROJECT_W    = 320;
const MIN_PROJECT_H    = 160;
const MIN_GROUP_W      = 270;
const MIN_GROUP_H      = 100;

const STATUS = {
  pending: { label: '착수전',   ico: '▶', color: '#fff', lbl: 'rgba(255,255,255,0.75)', bg: '#6B7280', border: '#6B7280' },
  doing:   { label: '진행중',   ico: '⏸', color: '#fff', lbl: 'rgba(255,255,255,0.75)', bg: '#C8102E',   border: '#C8102E'   },
  review:  { label: '완료요청', ico: '↑', color: '#fff', lbl: 'rgba(255,255,255,0.75)', bg: '#1754C4',  border: '#1754C4'  },
  done:    { label: '완료',     ico: '✓', color: '#fff', lbl: 'rgba(255,255,255,0.75)', bg: '#0D7A4E',    border: '#0D7A4E'    },
  delayed: { label: '지연',     ico: '▶', color: '#fff', lbl: 'rgba(255,255,255,0.75)', bg: '#D97706', border: '#D97706' },
};

const STATUS_CYCLE = ['pending', 'doing', 'review', 'done', 'delayed'];

const EDGE_COLOR = '#9CA3AF';

function getDoneColor(task) {
  if (task.done_color) return task.done_color;
  const hash = String(task.id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const r = hash % 9;
  if (r < 4) return 'black';
  else if (r < 7) return 'red';
  else return 'gray';
}

export class Graph {
  constructor(container, cb) {
    this.container = container;
    this.cb = cb;
    this.data = null;
    this.filter = { assignee: '', project: '', status: '' };
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this._drag = null;
    this._pan  = null;
    this._conn = null;
    this.userCtx = null;

    // DOM element maps for efficient drag updates
    this._taskEls    = new Map(); // taskId    → el
    this._groupEls   = new Map(); // groupId   → { el, group }
    this._projectEls = new Map(); // projectId → { el, project }
    this._edgePaths  = new Map(); // flowId    → { path, hitPath }

    // 데이터 인덱스 (O(1) 조회용)
    this._taskMap        = new Map(); // taskId    → task
    this._groupMap       = new Map(); // groupId   → group
    this._projectMap     = new Map(); // projectId → project
    this._tasksByGroup   = new Map(); // groupId   → [tasks]
    this._groupsByProject= new Map(); // projectId → [groups]
    this._orphansByProject=new Map(); // projectId → [tasks without groupId]

    this._setup();
    this._bind();
  }

  // ── DOM 초기화 ─────────────────────────────────────────
  _setup() {
    this.container.innerHTML = '';

    this.canvas = document.createElement('div');
    this.canvas.className = 'graph-canvas';

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('width', '8000');
    this.svg.setAttribute('height', '8000');
    this.svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:visible;';

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <marker id="arr" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto" markerUnits="strokeWidth">
        <polygon points="-5,-3 1,0 -5,3" fill="#9CA3AF" opacity="0.8" transform="translate(6,2.5)"/>
      </marker>
      <marker id="arr-group" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto" markerUnits="strokeWidth">
        <polygon points="-5,-3 1,0 -5,3" fill="#9CA3AF" opacity="0.8" transform="translate(6,2.5)"/>
      </marker>`;
    this.svg.appendChild(defs);

    this.tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.tempPath.setAttribute('fill', 'none');
    this.tempPath.setAttribute('stroke', '#B5BCC8');
    this.tempPath.setAttribute('stroke-width', '0.8');
    this.tempPath.setAttribute('stroke-dasharray', '6,3');
    this.tempPath.style.display = 'none';
    this.svg.appendChild(this.tempPath);

    this.nodesEl = document.createElement('div');
    this.nodesEl.className = 'graph-nodes';

    this.canvas.appendChild(this.svg);
    this.canvas.appendChild(this.nodesEl);
    this.container.appendChild(this.canvas);
  }

  // ── 공개 API ──────────────────────────────────────────
  setData(data) { this.data = data; this.render(); }
  setFilter(f)  { this.filter = { ...this.filter, ...f }; this.render(); }
  setUserContext(user) { this.userCtx = user; if (this.data) this.render(); }
  resetView() {
    if (!this.data) { this.scale = 1; this.offsetX = 0; this.offsetY = 0; this._transform(); return; }

    // 모든 컨텐츠의 전체 bbox 계산
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasContent = false;
    for (const t of (this.data.tasks || [])) {
      minX = Math.min(minX, t.x);           minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x + NODE_W);  maxY = Math.max(maxY, t.y + NODE_H);
      hasContent = true;
    }
    for (const g of (this.data.groups || [])) {
      const b = this._groupBBox(g);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      hasContent = true;
    }
    for (const p of (this.data.projects || [])) {
      const b = this._projectBBox(p);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      hasContent = true;
    }

    if (!hasContent) { this.scale = 1; this.offsetX = 0; this.offsetY = 0; this._transform(); return; }

    const PAD    = 40;
    const cw     = this.container.clientWidth;
    const ch     = this.container.clientHeight;
    const contentW = maxX - minX + PAD * 2;
    const contentH = maxY - minY + PAD * 2;
    const scale  = Math.min(1, Math.min(cw / contentW, ch / contentH));

    this.scale   = scale;
    this.offsetX = (cw - contentW * scale) / 2 - (minX - PAD) * scale;
    this.offsetY = (ch - contentH * scale) / 2 - (minY - PAD) * scale;
    this._transform();
  }
  getTransform() { return { x: this.offsetX, y: this.offsetY, k: this.scale }; }
  isDragging() { return !!this._drag || (!!this._dragEndedAt && Date.now() - this._dragEndedAt < 400); }

  setViewport(x, y, scale) {
    this.offsetX = x;
    this.offsetY = y;
    this.scale   = scale;
    this._transform();
  }

  render() {
    if (!this.data) return;
    this._renderNodes();
    this._renderEdges();
    this._transform();
  }

  // ── 바운딩 박스 계산 ──────────────────────────────────
  _groupBBox(group) {
    const tasks = this._tasksByGroup.get(group.id) || (this.data.tasks || []).filter(t => t.groupId === group.id);
    if (!tasks.length) {
      const x = group.x ?? 200;
      const y = group.y ?? 200;
      return { x, y, w: MIN_GROUP_W, h: MIN_GROUP_H };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of tasks) {
      minX = Math.min(minX, t.x); minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x + NODE_W); maxY = Math.max(maxY, t.y + NODE_H);
    }
    return {
      x: minX - GROUP_PAD_X,
      y: minY - GROUP_PAD_Y - GROUP_HEADER_H,
      w: Math.max(MIN_GROUP_W, (maxX - minX) + GROUP_PAD_X * 2),
      h: (maxY - minY) + GROUP_PAD_Y * 2 + GROUP_HEADER_H,
    };
  }

  _projectBBox(project) {
    const groups  = this._groupsByProject.get(project.id)  || (this.data.groups || []).filter(g => g.projectId === project.id);
    const orphans = this._orphansByProject.get(project.id) || (this.data.tasks  || []).filter(t => t.projectId === project.id && !t.groupId);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasContent = false;

    for (const g of groups) {
      const gb = this._groupBBox(g);
      minX = Math.min(minX, gb.x); minY = Math.min(minY, gb.y);
      maxX = Math.max(maxX, gb.x + gb.w); maxY = Math.max(maxY, gb.y + gb.h);
      hasContent = true;
    }
    for (const t of orphans) {
      minX = Math.min(minX, t.x); minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x + NODE_W); maxY = Math.max(maxY, t.y + NODE_H);
      hasContent = true;
    }

    if (!hasContent) {
      const x = project.x ?? 100;
      const y = project.y ?? 100;
      return { x, y, w: MIN_PROJECT_W, h: MIN_PROJECT_H };
    }
    return {
      x: minX - PROJECT_PAD_X,
      y: minY - PROJECT_PAD_Y - PROJECT_HEADER_H,
      w: Math.max(MIN_PROJECT_W, (maxX - minX) + PROJECT_PAD_X * 2),
      h: (maxY - minY) + PROJECT_PAD_Y * 2 + PROJECT_HEADER_H,
    };
  }

  // ── 노드 렌더링 ───────────────────────────────────────
  _taskVisible(task) {
    const { assignee, project, status } = this.filter;
    if (assignee === '__unassigned__') { if (task.assignee) return false; }
    else if (assignee && task.assignee !== assignee) return false;
    if (project && task.projectId !== project) return false;
    if (status  && task.status   !== status)   return false;
    return true;
  }

  _renderNodes() {
    this.nodesEl.innerHTML = '';
    this._taskEls.clear();
    this._groupEls.clear();
    this._projectEls.clear();

    // 인덱스 맵 빌드
    this._taskMap.clear(); this._groupMap.clear(); this._projectMap.clear();
    this._tasksByGroup.clear(); this._groupsByProject.clear(); this._orphansByProject.clear();
    for (const t of (this.data.tasks || [])) {
      this._taskMap.set(t.id, t);
      if (t.groupId) {
        if (!this._tasksByGroup.has(t.groupId)) this._tasksByGroup.set(t.groupId, []);
        this._tasksByGroup.get(t.groupId).push(t);
      } else if (t.projectId) {
        if (!this._orphansByProject.has(t.projectId)) this._orphansByProject.set(t.projectId, []);
        this._orphansByProject.get(t.projectId).push(t);
      }
    }
    for (const gr of (this.data.groups || [])) {
      this._groupMap.set(gr.id, gr);
      if (gr.projectId) {
        if (!this._groupsByProject.has(gr.projectId)) this._groupsByProject.set(gr.projectId, []);
        this._groupsByProject.get(gr.projectId).push(gr);
      }
    }
    for (const p of (this.data.projects || [])) this._projectMap.set(p.id, p);

    // 1. 프로젝트 박스 (z=1)
    for (const project of (this.data.projects || [])) {
      if (project.archived) continue;
      const bbox = this._projectBBox(project);
      const el = this._makeProjectBox(project, bbox);
      el.style.zIndex = '1';
      this.nodesEl.appendChild(el);
      this._projectEls.set(project.id, { el, project });
    }

    // 2. 묶음 박스 (z=2) — projectId 있는 것만 박스로 표시
    for (const group of (this.data.groups || [])) {
      if (!group.projectId) continue;
      const bbox = this._groupBBox(group);
      const el = this._makeGroupBox(group, bbox);
      el.style.zIndex = '2';
      this.nodesEl.appendChild(el);
      this._groupEls.set(group.id, { el, group });
    }

    // 3. 태스크 노드 (z=3)
    for (const task of (this.data.tasks || [])) {
      const project = this._projectMap.get(task.projectId);
      const color = project?.color || '#94a3b8';
      const hasFilter = this.filter.assignee || this.filter.project || this.filter.status;
      const dim = hasFilter && !this._taskVisible(task);
      const el = this._makeNode(task, color, dim);
      el.style.zIndex = '3';
      this.nodesEl.appendChild(el);
      this._taskEls.set(task.id, el);
    }
  }

  // ── 프로젝트 박스 ─────────────────────────────────────
  _makeProjectBox(project, bbox) {
    const el = document.createElement('div');
    el.className = 'project-box';
    el.dataset.projectId = project.id;
    el.style.left   = `${bbox.x}px`;
    el.style.top    = `${bbox.y}px`;
    el.style.width  = `${bbox.w}px`;
    el.style.height = `${bbox.h}px`;

    // 헤더 (드래그 핸들)
    const header = document.createElement('div');
    header.className = 'project-box-header';

    const colorDot = document.createElement('span');
    colorDot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${project.color};flex-shrink:0`;

    const pill = document.createElement('span');
    pill.className = 'project-label-pill';
    pill.style.cssText = `
      display:inline-flex;align-items:center;gap:8px;
      padding:6px 16px;border-radius:100px;
      background:#F3F4F6;color:#212121;
      border:1.5px solid #E5E7EB;
      font-size:21px;font-weight:800;letter-spacing:-0.5px;
    `;
    pill.appendChild(colorDot);
    pill.appendChild(document.createTextNode(project.name));
    header.appendChild(pill);

    // 드래그
    header.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const projectTasks  = (this.data.tasks  || []).filter(t => t.projectId === project.id);
      const projectGroups = (this.data.groups || []).filter(g => g.projectId === project.id);
      const curBBox = this._projectBBox(project);
      project.x = curBBox.x;
      project.y = curBBox.y;
      this._drag = {
        type: 'project',
        id:   project.id,
        sm:   { x: e.clientX, y: e.clientY },
        sp:   { x: project.x, y: project.y },
        taskOffsets:  projectTasks.map(t  => ({ t, ox: t.x, oy: t.y })),
        groupOffsets: projectGroups.map(g => ({ g, ox: g.x ?? 0, oy: g.y ?? 0, bbox: this._groupBBox(g) })),
        initialBBox: { ...curBBox },
        draggedIds: new Set([project.id, ...projectGroups.map(g => g.id), ...projectTasks.map(t => t.id)]),
      };
      // GPU 레이어 승격
      projectTasks.forEach(t => { const el = this._taskEls.get(t.id); if (el) el.style.willChange = 'transform'; });
      projectGroups.forEach(g => { const ge = this._groupEls.get(g.id); if (ge) ge.el.style.willChange = 'transform'; });
      { const pe = this._projectEls.get(project.id); if (pe) pe.el.style.willChange = 'transform'; }
    });

    el.appendChild(header);
    return el;
  }

  // ── 묶음 박스 ─────────────────────────────────────────
  _makeGroupBox(group, bbox) {
    const el = document.createElement('div');
    el.className = 'group-box';
    el.dataset.groupId = group.id;
    el.style.left   = `${bbox.x}px`;
    el.style.top    = `${bbox.y}px`;
    el.style.width  = `${bbox.w}px`;
    el.style.height = `${bbox.h}px`;

    // 헤더 (드래그 핸들)
    const header = document.createElement('div');
    header.className = 'group-box-header';

    const colorBar = document.createElement('span');
    colorBar.className = 'group-color-bar';
    colorBar.style.background = group.color;

    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-size:15px;font-weight:700;color:#374151;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    nameSpan.textContent = group.name;

    header.appendChild(colorBar);
    header.appendChild(nameSpan);

    // 드래그
    header.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const groupTasks = (this.data.tasks || []).filter(t => t.groupId === group.id);
      const curBBox = this._groupBBox(group);
      group.x = curBBox.x;
      group.y = curBBox.y;
      const proj = group.projectId ? (this.data.projects || []).find(p => p.id === group.projectId) : null;
      this._drag = {
        type: 'group',
        id:   group.id,
        sm:   { x: e.clientX, y: e.clientY },
        sp:   { x: group.x, y: group.y },
        taskOffsets: groupTasks.map(t => ({ t, ox: t.x, oy: t.y })),
        initialBBox: { ...curBBox },
        projectInitialBBox: proj ? { ...this._projectBBox(proj) } : null,
        draggedIds: new Set([group.id, ...groupTasks.map(t => t.id)]),
      };
      // GPU 레이어 승격
      groupTasks.forEach(t => { const el = this._taskEls.get(t.id); if (el) el.style.willChange = 'transform'; });
      const _ge = this._groupEls.get(group.id); if (_ge) _ge.el.style.willChange = 'transform';
      if (proj) { const _pe = this._projectEls.get(proj.id); if (_pe) _pe.el.style.willChange = 'transform'; }
    });

    // 연결 핸들 (묶음 간 연결)
    const handleL = document.createElement('div');
    handleL.className = 'nh nh-l group-nh';
    handleL.dataset.id   = group.id;
    handleL.dataset.side = 'left';

    const handleR = document.createElement('div');
    handleR.className = 'nh nh-r group-nh';
    handleR.dataset.id   = group.id;
    handleR.dataset.side = 'right';

    [handleL, handleR].forEach(h => {
      h.style.pointerEvents = 'auto';
      h.addEventListener('mousedown', (e) => {
        e.stopPropagation(); e.preventDefault();
        const b = this._groupBBox(group);
        const cx = h.dataset.side === 'right' ? b.x + b.w : b.x;
        const cy = b.y + b.h / 2;
        this._conn = { fromId: group.id, fromType: 'group', x: cx, y: cy };
        this.tempPath.style.display = '';
      });
    });

    el.appendChild(header);
    el.appendChild(handleL);
    el.appendChild(handleR);
    return el;
  }

  // ── 태스크 노드 ───────────────────────────────────────
  _dday(task) {
    if (!task.dueDate || task.status === 'done' || task.status === 'closed') return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due   = new Date(task.dueDate); due.setHours(0, 0, 0, 0);
    const diff  = Math.round((due - today) / 86400000);
    if (diff > 0)        return { label: `D-${diff}`,      color: diff <= 2 ? '#F97316' : '#9E9E9E' };
    else if (diff === 0) return { label: 'D-day',           color: '#C8102E' };
    else                 return { label: `D+${-diff} 초과`, color: '#C8102E' };
  }

  _makeNode(task, color, dim) {
    const el = document.createElement('div');
    el.className = 'task-node' + (dim ? ' dim' : '');
    el.dataset.id = task.id;
    el.style.left = `${task.x}px`;
    el.style.top  = `${task.y}px`;

    // ── 완료: 28×28 미니 사각형 ──────────────────────────
    if (task.status === 'done') {
      el.classList.add('task-node-done');
      const dc = getDoneColor(task);
      const doneBg = dc === 'red' ? '#C8102E' : dc === 'gray' ? '#888888' : '#111111';
      el.innerHTML = `
        <div class="nh nh-l" data-id="${task.id}" data-side="left"></div>
        <div class="node-done-wrapper">
          <div class="node-done-mini" title="${task.name}" style="background:${doneBg}"></div>
          <div class="node-done-label">${task.name}</div>
        </div>
        <div class="nh nh-r" data-id="${task.id}" data-side="right"></div>`;

      const mini = el.querySelector('.node-done-mini');
      mini.addEventListener('mouseenter', () => this._applyHover(task.id));
      mini.addEventListener('mouseleave', () => this._clearHover());
      mini.addEventListener('dblclick', () => this.cb.onNodeClick?.(task));
      mini.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const _dtel = this._taskEls.get(task.id); if (_dtel) _dtel.style.willChange = 'transform';
        this._drag = { type: 'task', id: task.id, sm: { x: e.clientX, y: e.clientY }, sp: { x: task.x, y: task.y }, draggedIds: new Set([task.id]) };
      });

      el.querySelectorAll('.nh').forEach(h => {
        h.addEventListener('mousedown', (e) => {
          e.stopPropagation(); e.preventDefault();
          const cx = h.dataset.side === 'right' ? task.x + DONE_NODE_W : task.x;
          const cy = task.y + DONE_NODE_H / 2;
          this._conn = { fromId: task.id, fromType: 'task', x: cx, y: cy };
          this.tempPath.style.display = '';
        });
      });
      return el;
    }

    // ── 일반: orb + 콘텐츠 카드 ──────────────────────────
    const st = STATUS[task.status] || STATUS.pending;
    el.innerHTML = `
      <div class="nh nh-l" data-id="${task.id}" data-side="left"></div>
      <div class="node-card">
        <div class="node-orb" data-id="${task.id}"
             style="background:${st.bg};border:2px solid ${st.border}">
          <span class="orb-ico" style="color:${st.color}">${st.ico}</span>
          <span class="orb-lbl" style="color:${st.lbl}">${st.label}</span>
        </div>
        <div class="node-content">
          <div class="node-name">${task.name}</div>
          <div class="node-assignee">${task.assignee || '미배정'}</div>
        </div>
      </div>
      <div class="nh nh-r" data-id="${task.id}" data-side="right"></div>`;

    const card = el.querySelector('.node-card');
    card.addEventListener('mouseenter', () => this._applyHover(task.id));
    card.addEventListener('mouseleave', () => this._clearHover());
    card.addEventListener('dblclick', (e) => {
      if (e.target.closest('.node-orb')) return;
      this.cb.onNodeClick?.(task);
    });
    card.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('.node-orb')) return;
      e.stopPropagation();
      const _tel = this._taskEls.get(task.id); if (_tel) _tel.style.willChange = 'transform';
      this._drag = { type: 'task', id: task.id, sm: { x: e.clientX, y: e.clientY }, sp: { x: task.x, y: task.y }, draggedIds: new Set([task.id]) };
    });

    // orb 클릭 → 상태 순환
    el.querySelector('.node-orb').addEventListener('click', (e) => {
      e.stopPropagation();
      const cur  = task.status || 'pending';
      const idx  = STATUS_CYCLE.indexOf(cur);
      const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
      const dc   = next === 'done' ? getDoneColor(task) : undefined;
      this.cb.onStatusChange?.(task.id, next, dc);
    });

    el.querySelectorAll('.nh').forEach(h => {
      h.addEventListener('mousedown', (e) => {
        e.stopPropagation(); e.preventDefault();
        const cx = h.dataset.side === 'right' ? task.x + NODE_W : task.x;
        const cy = task.y + NODE_H / 2;
        this._conn = { fromId: task.id, fromType: 'task', x: cx, y: cy };
        this.tempPath.style.display = '';
      });
    });

    return el;
  }

  // ── 엣지 렌더링 ───────────────────────────────────────
  _renderEdges(updateOnly = false, draggedIds = null) {
    if (!updateOnly) {
      Array.from(this.svg.children).forEach(c => {
        if (c.tagName !== 'defs' && c !== this.tempPath) c.remove();
      });
      this._edgePaths.clear();
    }
    if (!this.data?.flows) return;

    for (const flow of this.data.flows) {
      if (updateOnly && draggedIds && !draggedIds.has(flow.from) && !draggedIds.has(flow.to)) continue;
      const fromTask  = this._taskMap.get(flow.from);
      const toTask    = this._taskMap.get(flow.to);
      const fromGroup = this._groupMap.get(flow.from);
      const toGroup   = this._groupMap.get(flow.to);

      if (!fromTask && !fromGroup) continue;
      if (!toTask   && !toGroup)   continue;

      // 크로스 프로젝트 여부
      const isCross = fromTask && toTask &&
        fromTask.projectId && toTask.projectId &&
        fromTask.projectId !== toTask.projectId;

      const isGroup = !fromTask || !toTask;
      const edgeColor  = EDGE_COLOR;

      let x1, y1, x2, y2, pathD;

      if (isCross) {
        // 수직 S커브: 출발 카드 하단 → 도착 카드 상단
        const fW = fromTask.status === 'done' ? DONE_NODE_W : NODE_W;
        const fH = fromTask.status === 'done' ? DONE_NODE_H : NODE_H;
        const tW = toTask.status   === 'done' ? DONE_NODE_W : NODE_W;
        x1 = fromTask.x + fW / 2; y1 = fromTask.y + fH;
        x2 = toTask.x   + tW / 2; y2 = toTask.y;
        const my = (y1 + y2) / 2;
        pathD = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
      } else {
        // 수평 S커브: 출발 카드 오른쪽 → 도착 카드 왼쪽
        if (fromTask) {
          const fw = fromTask.status === 'done' ? DONE_NODE_W : NODE_W;
          const fh = fromTask.status === 'done' ? DONE_NODE_H : NODE_H;
          x1 = fromTask.x + fw; y1 = fromTask.y + fh / 2;
        } else {
          const b = this._groupBBox(fromGroup);
          x1 = b.x + b.w; y1 = b.y + b.h / 2;
        }
        if (toTask) {
          const th = toTask.status === 'done' ? DONE_NODE_H : NODE_H;
          x2 = toTask.x; y2 = toTask.y + th / 2;
        } else {
          const b = this._groupBBox(toGroup);
          x2 = b.x; y2 = b.y + b.h / 2;
        }
        const cx = (x1 + x2) / 2;
        pathD = `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
      }

      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const markerId = isGroup ? 'arr-group' : 'arr';

      // 표시선
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathD);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', edgeColor);
      path.setAttribute('stroke-width', '0.8');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('opacity', '0.6');
      if (isGroup) path.setAttribute('stroke-dasharray', '4 4');
      path.setAttribute('marker-end', `url(#${markerId})`);
      path.dataset.flowId     = flow.id;
      path.dataset.normalStroke = edgeColor;
      path.style.pointerEvents = 'none';

      // 히트 영역
      const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitPath.setAttribute('d', pathD);
      hitPath.setAttribute('fill', 'none');
      hitPath.setAttribute('stroke', 'transparent');
      hitPath.setAttribute('stroke-width', '14');
      hitPath.style.pointerEvents = 'stroke';
      hitPath.style.cursor = 'pointer';

      // 길게 누르기 → 선 빛남 → 확인 팝업
      let holdTimer = null;
      const startGlow = () => {
        path.setAttribute('stroke', '#C8102E');
        path.setAttribute('stroke-width', '1.4');
        path.setAttribute('opacity', '1');
      };
      const stopGlow = () => {
        path.setAttribute('stroke', edgeColor);
        path.setAttribute('stroke-width', '0.8');
        path.setAttribute('opacity', '0.6');
      };
      hitPath.addEventListener('pointerdown', e => {
        e.preventDefault();
        holdTimer = setTimeout(() => {
          holdTimer = null;
          startGlow();
          this.cb.onFlowHold?.(flow.id, midX, midY, stopGlow);
        }, 600);
      });
      const cancelHold = () => {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      };
      hitPath.addEventListener('pointerup',    cancelHold);
      hitPath.addEventListener('pointerleave', cancelHold);
      hitPath.addEventListener('pointermove',  cancelHold);

      if (updateOnly) {
        // 드래그 중: 기존 path d 속성만 갱신 (DOM 생성/삭제 없음)
        const ep = this._edgePaths.get(flow.id);
        if (ep) {
          ep.path.setAttribute('d', pathD);
          ep.hitPath.setAttribute('d', pathD);
        }
      } else {
        this.svg.insertBefore(path,    this.tempPath);
        this.svg.insertBefore(hitPath, this.tempPath);
        this._edgePaths.set(flow.id, { path, hitPath });
      }
    }
  }

  // ── 드래그 중 DOM 업데이트 (효율적) ──────────────────
  _updateGroupEl(groupId) {
    const entry = this._groupEls.get(groupId);
    if (!entry) return;
    const bbox = this._groupBBox(entry.group);
    const el = entry.el;
    el.style.left   = `${bbox.x}px`;
    el.style.top    = `${bbox.y}px`;
    el.style.width  = `${bbox.w}px`;
    el.style.height = `${bbox.h}px`;
  }

  _updateProjectEl(projectId) {
    const entry = this._projectEls.get(projectId);
    if (!entry) return;
    const bbox = this._projectBBox(entry.project);
    const el = entry.el;
    el.style.left   = `${bbox.x}px`;
    el.style.top    = `${bbox.y}px`;
    el.style.width  = `${bbox.w}px`;
    el.style.height = `${bbox.h}px`;
  }

  // ── 호버 하이라이트 ───────────────────────────────────
  _getConnected(taskId, depth = 2) {
    const visited = new Set([taskId]);
    let frontier = [taskId];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const fid of frontier) {
        for (const flow of (this.data.flows || [])) {
          if (flow.from === fid && !visited.has(flow.to))   { visited.add(flow.to);   next.push(flow.to); }
          if (flow.to   === fid && !visited.has(flow.from)) { visited.add(flow.from); next.push(flow.from); }
        }
      }
      frontier = next;
    }
    return visited;
  }

  _applyHover(taskId) {
    const connected = this._getConnected(taskId, 1); // 1단계 직접 연결만
    const connectedFlows = new Set(
      (this.data.flows || []).filter(f =>
        (f.from === taskId || f.to === taskId) &&
        (connected.has(f.from) && connected.has(f.to))
      ).map(f => f.id)
    );
    this.nodesEl.querySelectorAll('.task-node').forEach(n => {
      const isSelf = n.dataset.id === taskId;
      const isConn = connected.has(n.dataset.id) && !isSelf;
      n.classList.toggle('highlight-self',  isSelf);
      n.classList.toggle('highlight-hover', isConn);
      n.classList.toggle('dim-hover',       !isSelf && !isConn);
    });
    Array.from(this.svg.children).forEach(c => {
      if (c.tagName !== 'defs' && c !== this.tempPath) {
        const isConn = connectedFlows.has(c.dataset?.flowId);
        c.style.opacity = isConn ? '1' : '0.15';
        if (isConn) { c.setAttribute('stroke', c.dataset?.normalStroke || EDGE_COLOR); c.setAttribute('stroke-width', '1.4'); c.setAttribute('opacity', '1'); }
      }
    });
  }

  _clearHover() {
    this.nodesEl.querySelectorAll('.task-node').forEach(n => {
      n.classList.remove('dim-hover', 'highlight-hover', 'highlight-self');
    });
    Array.from(this.svg.children).forEach(c => {
      if (c.tagName !== 'defs' && c !== this.tempPath) {
        c.style.opacity = '';
        c.setAttribute('stroke', c.dataset?.normalStroke || EDGE_COLOR);
        c.setAttribute('stroke-width', '0.8');
        if (c.dataset?.normalStroke) c.setAttribute('opacity', '0.6');
      }
    });
  }

  // ── 인터랙션 바인딩 ───────────────────────────────────
  _getMovedPositions() {
    const { type, id, taskOffsets, groupOffsets } = this._drag;
    const moved = { tasks: [], groups: [], projects: [] };
    if (type === 'task') {
      const t = this._taskMap.get(id);
      if (t) moved.tasks.push({ id: t.id, x: t.x, y: t.y });
    } else if (type === 'group') {
      for (const { t } of (taskOffsets || [])) moved.tasks.push({ id: t.id, x: t.x, y: t.y });
      const g = this._groupMap.get(id);
      if (g) moved.groups.push({ id: g.id, x: g.x, y: g.y });
    } else if (type === 'project') {
      for (const { t } of (taskOffsets  || [])) moved.tasks.push({ id: t.id, x: t.x, y: t.y });
      for (const { g } of (groupOffsets || [])) moved.groups.push({ id: g.id, x: g.x, y: g.y });
      const p = this._projectMap.get(id);
      if (p) moved.projects.push({ id: p.id, x: p.x, y: p.y });
    }
    return moved;
  }

  _bind() {
    window.addEventListener('mousemove', (e) => {
      // 마우스 버튼이 이미 해제됐으면 드래그 강제 종료 (브라우저 밖 mouseup 미감지 대비)
      if (this._drag && e.buttons === 0) {
        this._dragEndedAt = Date.now();
        this._drag = null;
        this._rafPending = false;
        this._renderEdges();
        return;
      }
      // 드래그 처리
      if (this._drag) {
        // 최신 마우스 좌표를 항상 저장 (RAF 내에서 사용)
        this._lastMouse = { x: e.clientX, y: e.clientY };
        if (this._rafPending) return;
        this._rafPending = true;
        requestAnimationFrame(() => {
          this._rafPending = false;
          if (!this._drag) return;
          const { type, id, sm, sp, taskOffsets, groupOffsets, initialBBox } = this._drag;
          const dx = (this._lastMouse.x - sm.x) / this.scale;
          const dy = (this._lastMouse.y - sm.y) / this.scale;

          if (type === 'task') {
            const task = this._taskMap.get(id);
            if (task) {
              task.x = sp.x + dx;
              task.y = sp.y + dy;
              const el = this._taskEls.get(id);
              if (el) el.style.transform = `translate(${dx}px,${dy}px)`;
            }
          } else if (type === 'group') {
            const tdx = `translate(${dx}px,${dy}px)`;
            for (const { t, ox, oy } of taskOffsets) {
              t.x = ox + dx; t.y = oy + dy;
              const el = this._taskEls.get(t.id);
              if (el) el.style.transform = tdx;
            }
            const group = this._groupMap.get(id);
            if (group) { group.x = sp.x + dx; group.y = sp.y + dy; }
            const gEntry = this._groupEls.get(id);
            if (gEntry) gEntry.el.style.transform = tdx;
            if (group?.projectId) {
              const pEntry = this._projectEls.get(group.projectId);
              const piBBox = this._drag?.projectInitialBBox;
              if (pEntry) pEntry.el.style.transform = tdx;
            }
          } else if (type === 'project') {
            const tdx = `translate(${dx}px,${dy}px)`;
            for (const { t, ox, oy } of taskOffsets) {
              t.x = ox + dx; t.y = oy + dy;
              const el = this._taskEls.get(t.id);
              if (el) el.style.transform = tdx;
            }
            for (const { g, ox, oy } of (groupOffsets || [])) {
              g.x = ox + dx; g.y = oy + dy;
              const gEntry = this._groupEls.get(g.id);
              if (gEntry) gEntry.el.style.transform = tdx;
            }
            const project = this._projectMap.get(id);
            if (project) { project.x = sp.x + dx; project.y = sp.y + dy; }
            const pEntry = this._projectEls.get(id);
            if (pEntry) pEntry.el.style.transform = tdx;
          }
          this._renderEdges(true, this._drag?.draggedIds);
        });
        return;
      }

      // 패닝
      if (this._pan) {
        this.offsetX = this._pan.ox + (e.clientX - this._pan.sx);
        this.offsetY = this._pan.oy + (e.clientY - this._pan.sy);
        this._transform();
        this.cb.onViewportChange?.(this.offsetX, this.offsetY, this.scale);
        return;
      }

      // 연결선 미리보기
      if (this._conn) {
        const rect = this.container.getBoundingClientRect();
        const mx = (e.clientX - rect.left - this.offsetX) / this.scale;
        const my = (e.clientY - rect.top  - this.offsetY) / this.scale;
        const { x, y } = this._conn;
        const cx = (x + mx) / 2;
        this.tempPath.setAttribute('d', `M${x},${y} C${cx},${y} ${cx},${my} ${mx},${my}`);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (this._drag) {
        const { type, id, taskOffsets, groupOffsets } = this._drag;
        // transform 해제 & 최종 좌표 left/top 확정
        const fin = (el, x, y) => { if (!el) return; el.style.transform = ''; el.style.willChange = ''; if (x != null) { el.style.left = `${x}px`; el.style.top = `${y}px`; } };
        if (type === 'task') {
          const t = this._taskMap.get(id);
          fin(this._taskEls.get(id), t?.x, t?.y);
          if (t?.groupId)   this._updateGroupEl(t.groupId);
          if (t?.projectId) this._updateProjectEl(t.projectId);
        } else if (type === 'group') {
          for (const { t } of (taskOffsets || [])) fin(this._taskEls.get(t.id), t.x, t.y);
          const ge = this._groupEls.get(id);
          if (ge) { ge.el.style.transform = ''; ge.el.style.willChange = ''; this._updateGroupEl(id); }
          const grp = (this.data.groups || []).find(g => g.id === id);
          if (grp?.projectId) { const pe = this._projectEls.get(grp.projectId); if (pe) { pe.el.style.transform = ''; pe.el.style.willChange = ''; } this._updateProjectEl(grp.projectId); }
        } else if (type === 'project') {
          for (const { t } of (taskOffsets  || [])) fin(this._taskEls.get(t.id), t.x, t.y);
          for (const { g } of (groupOffsets || [])) { const ge = this._groupEls.get(g.id); if (ge) { ge.el.style.transform = ''; ge.el.style.willChange = ''; this._updateGroupEl(g.id); } }
          const pe = this._projectEls.get(id); if (pe) { pe.el.style.transform = ''; pe.el.style.willChange = ''; this._updateProjectEl(id); }
        }
        this._renderEdges();
        const moved = this._getMovedPositions();
        this.cb.onNodeMoved?.(moved);
        this._dragEndedAt = Date.now();
        this._drag = null;
      }
      if (this._conn) {
        // 태스크 또는 묶음 박스로 연결 완료
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const taskEl  = target?.closest('.task-node');
        const groupEl = target?.closest('.group-box');
        let toId = null;
        if      (taskEl  && taskEl.dataset.id   !== this._conn.fromId) toId = taskEl.dataset.id;
        else if (groupEl && groupEl.dataset.groupId !== this._conn.fromId) toId = groupEl.dataset.groupId;
        if (toId) this.cb.onFlowCreate?.(this._conn.fromId, toId);
        this._conn = null;
        this.tempPath.style.display = 'none';
        this.tempPath.setAttribute('d', '');
      }
      this._pan = null;
      this.container.style.cursor = '';
    });

    // 배경 패닝
    this.container.addEventListener('mousedown', (e) => {
      const onBg = e.target === this.container || e.target === this.canvas || e.target === this.svg;
      if (!onBg || e.button !== 0) return;
      this._pan = { sx: e.clientX, sy: e.clientY, ox: this.offsetX, oy: this.offsetY };
      this.container.style.cursor = 'grabbing';
    });

    // 더블클릭 → 컨텍스트 인식 업무 추가
    this.container.addEventListener('dblclick', (e) => {
      if (e.target.closest('.task-node')          ||
          e.target.closest('.project-box-header') ||
          e.target.closest('.group-box-header')   ||
          e.target.closest('.nh')) return;

      const rect = this.container.getBoundingClientRect();
      const cx = (e.clientX - rect.left - this.offsetX) / this.scale;
      const cy = (e.clientY - rect.top  - this.offsetY) / this.scale;
      const x  = cx - NODE_W / 2;
      const y  = cy - NODE_H / 2;

      // 클릭 위치에 해당하는 묶음/프로젝트 감지
      let context = {};
      for (const group of (this.data.groups || [])) {
        if (!group.projectId) continue;
        const b = this._groupBBox(group);
        if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
          context = { projectId: group.projectId, groupId: group.id };
          break;
        }
      }
      if (!context.projectId) {
        for (const project of (this.data.projects || [])) {
          if (project.archived) continue;
          const b = this._projectBBox(project);
          if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
            context = { projectId: project.id };
            break;
          }
        }
      }
      this.cb.onNodeCreate?.(x, y, context);
    });

    // 휠: Ctrl+휠=줌, Shift+휠=좌우패닝, 기본=위아래패닝
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const d = e.deltaY > 0 ? 0.9 : 1.1;
        const rect = this.container.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        this.offsetX = mx - (mx - this.offsetX) * d;
        this.offsetY = my - (my - this.offsetY) * d;
        this.scale = Math.min(3, Math.max(0.2, this.scale * d));
      } else if (e.shiftKey) {
        this.offsetX -= e.deltaY;
      } else {
        this.offsetY -= e.deltaY;
      }
      this._transform();
      this.cb.onViewportChange?.(this.offsetX, this.offsetY, this.scale);
    }, { passive: false });

    // ── 터치 제스처 ──────────────────────────────────────
    let _tc = null; // touch context

    this.container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        _tc = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          ox: this.offsetX,
          oy: this.offsetY,
          time: Date.now(),
          moved: false,
          tapCount: _tc?.tapCount || 0,
          lastTap: _tc?.lastTap || 0,
        };
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        _tc = { ..._tc, pinchDist: Math.sqrt(dx*dx + dy*dy), pinching: true };
      }
    }, { passive: true });

    this.container.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!_tc) return;

      if (e.touches.length === 1 && !_tc.pinching) {
        const dx = e.touches[0].clientX - _tc.x;
        const dy = e.touches[0].clientY - _tc.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _tc.moved = true;
        this.offsetX = _tc.ox + dx;
        this.offsetY = _tc.oy + dy;
        this._transform();
        this.cb.onViewportChange?.(this.offsetX, this.offsetY, this.scale);

      } else if (e.touches.length === 2 && _tc.pinchDist) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const ratio = dist / _tc.pinchDist;
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = this.container.getBoundingClientRect();
        const mx = cx - rect.left;
        const my = cy - rect.top;
        const newScale = Math.min(3, Math.max(0.2, this.scale * ratio));
        this.offsetX = mx - (mx - this.offsetX) * (newScale / this.scale);
        this.offsetY = my - (my - this.offsetY) * (newScale / this.scale);
        this.scale = newScale;
        _tc.pinchDist = dist;
        this._transform();
        this.cb.onViewportChange?.(this.offsetX, this.offsetY, this.scale);
      }
    }, { passive: false });

    this.container.addEventListener('touchend', (e) => {
      if (!_tc) return;
      const t = e.changedTouches[0];
      const dt = Date.now() - _tc.time;

      if (!_tc.moved && !_tc.pinching && dt < 300) {
        const el = document.elementFromPoint(t.clientX, t.clientY);
        if (el) {
          const now = Date.now();
          if (now - (_tc.lastTap || 0) < 300) {
            el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: t.clientX, clientY: t.clientY }));
          } else {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: t.clientX, clientY: t.clientY }));
          }
          _tc.lastTap = now;
        }
      }
      if (e.touches.length === 0) _tc = null;
    }, { passive: true });
  }

  _transform() {
    this.canvas.style.transform = `translate(${this.offsetX}px,${this.offsetY}px) scale(${this.scale})`;
    this.canvas.style.transformOrigin = '0 0';
  }
}


