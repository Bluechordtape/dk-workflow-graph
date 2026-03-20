// graph.js

export const NODE_W = 190;
export const NODE_H = 88;

const STATUS = {
  todo:    { label: '대기',     bar: '#D1D5DB', bg: '#F3F4F6', text: '#6B7280' },
  wip:     { label: '진행중',   bar: '#6366F1', bg: '#E0E7FF', text: '#3730A3' },
  pending: { label: '완료요청', bar: '#F59E0B', bg: '#FEF3C7', text: '#92400E' },
  done:    { label: '완료',     bar: '#10B981', bg: '#D1FAE5', text: '#065F46' }
};

export class Graph {
  constructor(container, cb) {
    this.container = container;
    this.cb = cb; // { onNodeClick, onNodeCreate, onFlowCreate, onFlowDelete, onStatusChange, onNodeMoved }
    this.data = null;
    this.filter = { assignee: '', project: '', status: '' };
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this._drag = null;      // { taskId, startMouse, startPos }
    this._pan = null;
    this._conn = null;      // { fromId, x1, y1 } — connection being drawn
    this._setup();
    this._bind();
  }

  // ── DOM ────────────────────────────────────────────────
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
        <path d="M0,0 L7,2.5 L0,5 Z" fill="#C7D2FE"/>
      </marker>`;
    this.svg.appendChild(defs);

    // 임시 연결선
    this.tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.tempPath.setAttribute('fill', 'none');
    this.tempPath.setAttribute('stroke', '#C7D2FE');
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
  setData(data) {
    this.data = data;
    this.render();
  }

  setFilter(f) {
    this.filter = { ...this.filter, ...f };
    this.render();
  }

  resetView() {
    this.scale = 1; this.offsetX = 0; this.offsetY = 0;
    this._transform();
  }

  render() {
    if (!this.data) return;
    this._renderNodes();
    this._renderEdges();
    this._transform();
  }

  // ── 노드 렌더링 ────────────────────────────────────────
  _taskVisible(task) {
    const { assignee, project, status } = this.filter;
    if (assignee && task.assignee !== assignee) return false;
    if (project  && task.projectId !== project) return false;
    if (status   && task.status   !== status)   return false;
    return true;
  }

  _renderNodes() {
    this.nodesEl.innerHTML = '';
    for (const task of this.data.tasks) {
      const project = this.data.projects.find(p => p.id === task.projectId);
      const color = project?.color || '#94a3b8';
      const hasFilter = this.filter.assignee || this.filter.project || this.filter.status;
      const dim = hasFilter && !this._taskVisible(task);
      this.nodesEl.appendChild(this._makeNode(task, color, dim));
    }
  }

  _makeNode(task, color, dim) {
    const st = STATUS[task.status] || STATUS.todo;
    const el = document.createElement('div');
    el.className = 'task-node' + (dim ? ' dim' : '');
    el.dataset.id = task.id;
    // cssText 대신 개별 style 설정 — CSS variable이 날아가지 않도록
    el.style.left = `${task.x}px`;
    el.style.top  = `${task.y}px`;

    const sub = task.subtasks || [];
    const subDone = sub.filter(s => s.status === 'done').length;
    const subLine = sub.length ? `<div class="node-sub">${subDone}/${sub.length} 세부업무</div>` : '';
    const actionBtn = task.status === 'wip'
      ? `<button class="node-action btn-req" data-id="${task.id}">완료 요청</button>`
      : task.status === 'pending'
      ? `<button class="node-action btn-cfm" data-id="${task.id}">✓ 컨펌</button>`
      : '';

    // node-inner에 box-shadow와 border-left를 인라인으로 직접 지정
    const innerStyle = [
      `border: 1px solid #E5E7EB`,
      `border-left: 3px solid ${st.bar}`,
      `border-radius: 10px`,
      `background: #FFFFFF`,
      `box-shadow: 0 2px 8px rgba(0,0,0,0.08)`,
      `padding: 10px 12px`,
      `min-height: 88px`,
      `display: flex`,
      `flex-direction: column`,
      `gap: 5px`,
      `cursor: pointer`,
      `user-select: none`,
    ].join(';');

    el.innerHTML = `
      <div class="nh nh-l" data-id="${task.id}" data-side="left"></div>
      <div class="node-inner" style="${innerStyle}">
        <div class="node-top">
          <span class="node-dot" style="width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:3px;background:${color}"></span>
          <span class="node-name" style="font-size:13px;font-weight:600;color:#111827;line-height:1.35;letter-spacing:-0.2px">${task.name}</span>
        </div>
        <div class="node-mid" style="display:flex;align-items:center;justify-content:space-between;gap:6px">
          <span class="node-assignee" style="font-size:11px;color:#9CA3AF">${task.assignee || '미배정'}</span>
          <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;white-space:nowrap;background:${st.bg};color:${st.text}">${st.label}</span>
        </div>
        ${subLine}
        ${actionBtn}
      </div>
      <div class="nh nh-r" data-id="${task.id}" data-side="right"></div>`;

    // 클릭 → 패널 열기
    el.querySelector('.node-inner').addEventListener('click', (e) => {
      if (e.target.closest('.node-action')) return;
      this.cb.onNodeClick?.(task);
    });

    // 완료 요청
    el.querySelector('.btn-req')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onStatusChange?.(task.id, 'pending');
    });

    // 컨펌
    el.querySelector('.btn-cfm')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onStatusChange?.(task.id, 'done');
    });

    // 드래그 이동
    el.querySelector('.node-inner').addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('.node-action')) return;
      e.stopPropagation();
      this._drag = { taskId: task.id, sm: { x: e.clientX, y: e.clientY }, sp: { x: task.x, y: task.y } };
    });

    // 연결 핸들 드래그
    el.querySelectorAll('.nh').forEach(h => {
      h.addEventListener('mousedown', (e) => {
        e.stopPropagation(); e.preventDefault();
        const cx = h.dataset.side === 'right' ? task.x + NODE_W : task.x;
        const cy = task.y + NODE_H / 2;
        this._conn = { fromId: task.id, x: cx, y: cy };
        this.tempPath.style.display = '';
      });
    });

    return el;
  }

  // ── 엣지 렌더링 ────────────────────────────────────────
  _renderEdges() {
    Array.from(this.svg.children).forEach(c => {
      if (c.tagName !== 'defs' && c !== this.tempPath) c.remove();
    });
    if (!this.data?.flows) return;

    for (const flow of this.data.flows) {
      const from = this.data.tasks.find(t => t.id === flow.from);
      const to   = this.data.tasks.find(t => t.id === flow.to);
      if (!from || !to) continue;

      const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
      const x2 = to.x,           y2 = to.y   + NODE_H / 2;
      const cx = (x1 + x2) / 2;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#C7D2FE');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('marker-end', 'url(#arr)');
      path.style.pointerEvents = 'stroke';
      path.style.cursor = 'pointer';
      path.addEventListener('click', () => {
        if (confirm('이 연결을 삭제하시겠습니까?')) this.cb.onFlowDelete?.(flow.id);
      });
      this.svg.insertBefore(path, this.tempPath);
    }
  }

  // ── 인터랙션 ──────────────────────────────────────────
  _bind() {
    window.addEventListener('mousemove', (e) => {
      // 노드 드래그
      if (this._drag) {
        const { taskId, sm, sp } = this._drag;
        const dx = (e.clientX - sm.x) / this.scale;
        const dy = (e.clientY - sm.y) / this.scale;
        const task = this.data.tasks.find(t => t.id === taskId);
        if (task) {
          task.x = sp.x + dx;
          task.y = sp.y + dy;
          const el = this.nodesEl.querySelector(`[data-id="${taskId}"]`);
          if (el) { el.style.left = task.x + 'px'; el.style.top = task.y + 'px'; }
          this._renderEdges();
        }
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
        this.cb.onNodeMoved?.();
        this._drag = null;
      }
      if (this._conn) {
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.task-node');
        if (el && el.dataset.id !== this._conn.fromId) {
          this.cb.onFlowCreate?.(this._conn.fromId, el.dataset.id);
        }
        this._conn = null;
        this.tempPath.style.display = 'none';
        this.tempPath.setAttribute('d', '');
      }
      this._pan = null;
      this.container.style.cursor = '';
    });

    // 배경 드래그 → 패닝
    this.container.addEventListener('mousedown', (e) => {
      const onBg = e.target === this.container || e.target === this.canvas || e.target === this.svg;
      if (!onBg || e.button !== 0) return;
      this._pan = { sx: e.clientX, sy: e.clientY, ox: this.offsetX, oy: this.offsetY };
      this.container.style.cursor = 'grabbing';
    });

    // 더블클릭 → 새 업무 생성
    this.container.addEventListener('dblclick', (e) => {
      const onBg = e.target === this.container || e.target === this.canvas || e.target === this.svg;
      if (!onBg) return;
      const rect = this.container.getBoundingClientRect();
      const x = (e.clientX - rect.left - this.offsetX) / this.scale - NODE_W / 2;
      const y = (e.clientY - rect.top  - this.offsetY) / this.scale - NODE_H / 2;
      this.cb.onNodeCreate?.(x, y);
    });

    // 줌
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = this.container.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      this.offsetX = mx - (mx - this.offsetX) * d;
      this.offsetY = my - (my - this.offsetY) * d;
      this.scale = Math.min(3, Math.max(0.2, this.scale * d));
      this._transform();
    }, { passive: false });
  }

  _transform() {
    this.canvas.style.transform = `translate(${this.offsetX}px,${this.offsetY}px) scale(${this.scale})`;
    this.canvas.style.transformOrigin = '0 0';
  }
}
