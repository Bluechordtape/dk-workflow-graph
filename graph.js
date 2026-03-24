// graph.js — 3-tier hierarchy: Project > Group(Category) > Task

export const NODE_W = 230;
export const NODE_H = 118;

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
  pending: { label: '착수전',   bar: '#D1D5DB', bg: '#F3F4F6', text: '#4B5563', bdg: '#E5E7EB' },
  doing:   { label: '진행 중',  bar: '#7C3AED', bg: '#EDE9FE', text: '#5B21B6', bdg: '#C4B5FD' },
  delayed: { label: '지연',     bar: '#EF4444', bg: '#FEE2E2', text: '#991B1B', bdg: '#FECACA' },
  review:  { label: '완료요청', bar: '#EAB308', bg: '#FEF9C3', text: '#854D0E', bdg: '#FCD34D' },
  done:    { label: '완료',     bar: '#22C55E', bg: '#DCFCE7', text: '#15803D', bdg: '#86EFAC' },
};

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
      <marker id="arr" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L7,2.5 L0,5 Z" fill="#D1D5DB"/>
      </marker>
      <marker id="arr-group" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L7,2.5 L0,5 Z" fill="#BDBDBD"/>
      </marker>`;
    this.svg.appendChild(defs);

    this.tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.tempPath.setAttribute('fill', 'none');
    this.tempPath.setAttribute('stroke', '#D1D5DB');
    this.tempPath.setAttribute('stroke-width', '1.5');
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

  render() {
    if (!this.data) return;
    this._renderNodes();
    this._renderEdges();
    this._transform();
  }

  // ── 바운딩 박스 계산 ──────────────────────────────────
  _groupBBox(group) {
    const tasks = (this.data.tasks || []).filter(t => t.groupId === group.id);
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
    const groups = (this.data.groups || []).filter(g => g.projectId === project.id);
    const orphans = (this.data.tasks || []).filter(t => t.projectId === project.id && !t.groupId);

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
      const project = (this.data.projects || []).find(p => p.id === task.projectId);
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
      font-size:16px;font-weight:800;letter-spacing:-0.5px;
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
        groupOffsets: projectGroups.map(g => ({ g, ox: g.x ?? 0, oy: g.y ?? 0 })),
      };
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
      this._drag = {
        type: 'group',
        id:   group.id,
        sm:   { x: e.clientX, y: e.clientY },
        sp:   { x: group.x, y: group.y },
        taskOffsets: groupTasks.map(t => ({ t, ox: t.x, oy: t.y })),
      };
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
    const st = STATUS[task.status] || STATUS.pending;
    const el = document.createElement('div');
    el.className = 'task-node' + (dim ? ' dim' : '');
    el.dataset.id = task.id;
    el.style.left = `${task.x}px`;
    el.style.top  = `${task.y}px`;
    el.style.setProperty('--sc', st.bar);


    const role   = this.userCtx?.role;
    const myName = this.userCtx?.name;
    const isMine = task.assignee === myName;
    const isMgmt = ['admin', 'leader', 'manager'].includes(role);
    const canAct  = isMgmt || isMine;
    const st2 = task.status;

    const isLeader = ['admin', 'leader'].includes(role);
    let actionBtn = '';
    if (st2 === 'pending' && canAct)
      actionBtn = `<button class="node-action btn-start" data-id="${task.id}">▶ 시작</button>`;
    else if ((st2 === 'doing' || st2 === 'delayed') && canAct)
      actionBtn = `<button class="node-action btn-req" data-id="${task.id}">완료 요청</button>`;
    else if (st2 === 'review' && isLeader)
      actionBtn = `
        <button class="node-action btn-cfm" data-id="${task.id}">✓ 완료 확정</button>
        <button class="node-action btn-rej" data-id="${task.id}">반려</button>`;
    else if (st2 === 'review' && canAct)
      actionBtn = `<button class="node-action btn-req" data-id="${task.id}">완료 요청</button>`;

    const dday = this._dday(task);

    el.innerHTML = `
      <div class="nh nh-l" data-id="${task.id}" data-side="left"></div>
      <div class="node-inner">
        <div class="node-row1">
          <span class="node-dot" style="background:${st.bar}"></span>
          <span class="node-name">${task.name}</span>
          <span class="node-badge" style="background:${st.bg};color:${st.text};border:1px solid ${st.bdg}">${st.label}</span>
        </div>
        <div class="node-row2">
          <span class="node-assignee">${task.assignee || '미배정'}</span>
          ${dday ? `<span class="node-dday" style="color:${dday.color}">${dday.label}</span>` : ''}
        </div>
        ${actionBtn ? `<div class="node-action-row">${actionBtn}</div>` : ''}
      </div>
      <div class="nh nh-r" data-id="${task.id}" data-side="right"></div>`;

    const inner = el.querySelector('.node-inner');
    inner.addEventListener('mouseenter', () => this._applyHover(task.id));
    inner.addEventListener('mouseleave', () => this._clearHover());
    inner.addEventListener('click', (e) => {
      if (e.target.closest('.node-action')) return;
      this.cb.onNodeClick?.(task);
    });
    inner.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('.node-action')) return;
      e.stopPropagation();
      this._drag = {
        type: 'task',
        id:   task.id,
        sm:   { x: e.clientX, y: e.clientY },
        sp:   { x: task.x, y: task.y },
      };
    });

    el.querySelector('.btn-start')?.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onStatusChange?.(task.id, 'doing'); });
    el.querySelector('.btn-req')?.addEventListener('click',   (e) => { e.stopPropagation(); this.cb.onStatusChange?.(task.id, 'review'); });
    el.querySelector('.btn-cfm')?.addEventListener('click',   (e) => { e.stopPropagation(); this.cb.onStatusChange?.(task.id, 'done'); });
    el.querySelector('.btn-rej')?.addEventListener('click',   (e) => { e.stopPropagation(); this.cb.onStatusChange?.(task.id, 'doing'); });

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
  _renderEdges() {
    Array.from(this.svg.children).forEach(c => {
      if (c.tagName !== 'defs' && c !== this.tempPath) c.remove();
    });
    if (!this.data?.flows) return;

    for (const flow of this.data.flows) {
      const fromTask  = (this.data.tasks  || []).find(t => t.id === flow.from);
      const toTask    = (this.data.tasks  || []).find(t => t.id === flow.to);
      const fromGroup = (this.data.groups || []).find(g => g.id === flow.from);
      const toGroup   = (this.data.groups || []).find(g => g.id === flow.to);

      if (!fromTask && !fromGroup) continue;
      if (!toTask   && !toGroup)   continue;

      let x1, y1, x2, y2;
      if (fromTask) {
        x1 = fromTask.x + NODE_W; y1 = fromTask.y + NODE_H / 2;
      } else {
        const b = this._groupBBox(fromGroup);
        x1 = b.x + b.w; y1 = b.y + b.h / 2;
      }
      if (toTask) {
        x2 = toTask.x; y2 = toTask.y + NODE_H / 2;
      } else {
        const b = this._groupBBox(toGroup);
        x2 = b.x; y2 = b.y + b.h / 2;
      }

      const isGroup = !fromTask || !toTask;
      const cx = (x1 + x2) / 2;

      const normalStroke = isGroup ? '#BDBDBD' : '#D1D5DB';
      const midX = cx;
      const midY = (y1 + y2) / 2;

      // 표시선
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', normalStroke);
      path.setAttribute('stroke-width', '1.5');
      if (isGroup) path.setAttribute('stroke-dasharray', '4 4');
      path.setAttribute('marker-end', isGroup ? 'url(#arr-group)' : 'url(#arr)');
      path.style.pointerEvents = 'none';

      // 히트 영역 (넓은 투명 선, 길게 누르기용)
      const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitPath.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
      hitPath.setAttribute('fill', 'none');
      hitPath.setAttribute('stroke', 'transparent');
      hitPath.setAttribute('stroke-width', '14');
      hitPath.style.pointerEvents = 'stroke';
      hitPath.style.cursor = 'pointer';

      // 길게 누르기 → 선 빛남 → 확인 팝업
      let holdTimer = null;
      const startGlow = () => {
        path.setAttribute('stroke', '#C8102E');
        path.setAttribute('stroke-width', '2');
        path.style.filter = 'none';
      };
      const stopGlow = () => {
        path.setAttribute('stroke', normalStroke);
        path.setAttribute('stroke-width', '1.5');
        path.style.filter = '';
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

      this.svg.insertBefore(path,    this.tempPath);
      this.svg.insertBefore(hitPath, this.tempPath);
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
        if (isConn) { c.setAttribute('stroke', '#212121'); c.setAttribute('stroke-width', '2'); }
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
        c.setAttribute('stroke', '#D1D5DB');
        c.setAttribute('stroke-width', '1.5');
      }
    });
  }

  // ── 인터랙션 바인딩 ───────────────────────────────────
  _getMovedPositions() {
    const { type, id, taskOffsets, groupOffsets } = this._drag;
    const moved = { tasks: [], groups: [], projects: [] };
    if (type === 'task') {
      const t = (this.data.tasks || []).find(t => t.id === id);
      if (t) moved.tasks.push({ id: t.id, x: t.x, y: t.y });
    } else if (type === 'group') {
      for (const { t } of (taskOffsets || [])) moved.tasks.push({ id: t.id, x: t.x, y: t.y });
      const g = (this.data.groups || []).find(g => g.id === id);
      if (g) moved.groups.push({ id: g.id, x: g.x, y: g.y });
    } else if (type === 'project') {
      for (const { t } of (taskOffsets  || [])) moved.tasks.push({ id: t.id, x: t.x, y: t.y });
      for (const { g } of (groupOffsets || [])) moved.groups.push({ id: g.id, x: g.x, y: g.y });
      const p = (this.data.projects || []).find(p => p.id === id);
      if (p) moved.projects.push({ id: p.id, x: p.x, y: p.y });
    }
    return moved;
  }

  _bind() {
    window.addEventListener('mousemove', (e) => {
      // 드래그 처리
      if (this._drag) {
        const { type, id, sm, sp, taskOffsets, groupOffsets } = this._drag;
        const dx = (e.clientX - sm.x) / this.scale;
        const dy = (e.clientY - sm.y) / this.scale;

        if (type === 'task') {
          const task = (this.data.tasks || []).find(t => t.id === id);
          if (task) {
            task.x = sp.x + dx;
            task.y = sp.y + dy;
            const el = this._taskEls.get(id);
            if (el) { el.style.left = `${task.x}px`; el.style.top = `${task.y}px`; }
            if (task.groupId)   this._updateGroupEl(task.groupId);
            if (task.projectId) this._updateProjectEl(task.projectId);
          }
        } else if (type === 'group') {
          for (const { t, ox, oy } of taskOffsets) {
            t.x = ox + dx; t.y = oy + dy;
            const el = this._taskEls.get(t.id);
            if (el) { el.style.left = `${t.x}px`; el.style.top = `${t.y}px`; }
          }
          const group = (this.data.groups || []).find(g => g.id === id);
          if (group) { group.x = sp.x + dx; group.y = sp.y + dy; }
          this._updateGroupEl(id);
          if (group?.projectId) this._updateProjectEl(group.projectId);
        } else if (type === 'project') {
          for (const { t, ox, oy } of taskOffsets) {
            t.x = ox + dx; t.y = oy + dy;
            const el = this._taskEls.get(t.id);
            if (el) { el.style.left = `${t.x}px`; el.style.top = `${t.y}px`; }
          }
          for (const { g, ox, oy } of groupOffsets) {
            g.x = ox + dx; g.y = oy + dy;
            this._updateGroupEl(g.id);
          }
          const project = (this.data.projects || []).find(p => p.id === id);
          if (project) { project.x = sp.x + dx; project.y = sp.y + dy; }
          this._updateProjectEl(id);
        }
        this._renderEdges();
        return;
      }

      // 패닝
      if (this._pan) {
        this.offsetX = this._pan.ox + (e.clientX - this._pan.sx);
        this.offsetY = this._pan.oy + (e.clientY - this._pan.sy);
        this._transform();
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
        const moved = this._getMovedPositions();
        this.cb.onNodeMoved?.(moved);
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
    }, { passive: false });
  }

  _transform() {
    this.canvas.style.transform = `translate(${this.offsetX}px,${this.offsetY}px) scale(${this.scale})`;
    this.canvas.style.transformOrigin = '0 0';
  }
}
