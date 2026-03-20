// graph.js

export const NODE_W = 190;
export const NODE_H = 88;

const STATUS = {
  todo:    { label: '대기',     bar: '#BDBDBD', bg: '#F5F5F5', text: '#757575' },
  pending: { label: '대기',     bar: '#BDBDBD', bg: '#F5F5F5', text: '#757575' },
  wip:     { label: '진행중',   bar: '#616161', bg: '#EEEEEE', text: '#212121' },
  doing:   { label: '진행중',   bar: '#616161', bg: '#EEEEEE', text: '#212121' },
  review:  { label: '완료요청', bar: '#424242', bg: '#E0E0E0', text: '#212121' },
  done:    { label: '완료',     bar: '#212121', bg: '#212121', text: '#FFFFFF' },
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
    this.userCtx = null;    // { id, name, role }
    this._physicsRaf = null;
    this._setup();
    this._bind();
    this._startPhysics();
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
        <path d="M0,0 L7,2.5 L0,5 Z" fill="#BDBDBD"/>
      </marker>`;
    this.svg.appendChild(defs);

    // 임시 연결선
    this.tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.tempPath.setAttribute('fill', 'none');
    this.tempPath.setAttribute('stroke', '#BDBDBD');
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

  setUserContext(user) {
    this.userCtx = user;
    if (this.data) this.render();
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

  _dday(task) {
    if (!task.dueDate || task.status === 'done') return '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due   = new Date(task.dueDate); due.setHours(0, 0, 0, 0);
    const diff  = Math.round((due - today) / 86400000);
    let label, color;
    if (diff > 0)       { label = `D-${diff}`;    color = diff <= 2 ? '#F97316' : '#9E9E9E'; }
    else if (diff === 0){ label = 'D-day';          color = '#C8102E'; }
    else                { label = `D+${-diff} 초과`; color = '#C8102E'; }
    return `<div class="node-dday" style="color:${color}">${label}</div>`;
  }

  _makeNode(task, color, dim) {
    const st = STATUS[task.status] || STATUS.pending;
    const el = document.createElement('div');
    el.className = 'task-node' + (dim ? ' dim' : '');
    el.dataset.id = task.id;
    el.style.left = `${task.x}px`;
    el.style.top  = `${task.y}px`;
    el.style.setProperty('--sc', st.bar);

    const sub = task.subtasks || [];
    const subDone = sub.filter(s => s.status === 'done').length;
    const subLine = sub.length ? `<div class="node-sub">${subDone}/${sub.length} 세부업무</div>` : '';
    const ddayLine = this._dday(task);
    const role   = this.userCtx?.role;
    const myName = this.userCtx?.name;
    const isMine = task.assignee === myName;
    const isMgmt = ['admin', 'leader', 'manager'].includes(role);
    const canStart = task.status === 'pending' && (isMgmt || isMine);
    const canReq   = task.status === 'doing'   && (isMgmt || isMine);
    const canCfm   = task.status === 'review'  && isMgmt;
    const group  = this.data.groups?.find(g => g.id === task.groupId);
    const groupBadge = group
      ? `<span style="font-size:10px;font-weight:600;padding:1px 7px;border-radius:3px;background:${group.color}1A;color:${group.color};border:1px solid ${group.color}44;white-space:nowrap">${group.name}</span>`
      : '';
    const actionBtn = canStart
      ? `<button class="node-action btn-start" data-id="${task.id}">▶ 시작</button>`
      : canReq
      ? `<button class="node-action btn-req" data-id="${task.id}">완료 요청</button>`
      : canCfm
      ? `<button class="node-action btn-cfm" data-id="${task.id}">✓ 컨펌</button>`
      : '';

    // node-inner에 box-shadow와 border-left를 인라인으로 직접 지정
    const innerStyle = [
      `border: 1px solid #E0E0E0`,
      `border-left: 3px solid ${st.bar}`,
      `border-radius: 8px`,
      `background: #FFFFFF`,
      `box-shadow: 0 1px 4px rgba(0,0,0,0.07)`,
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
          <span class="node-dot" style="width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:3px;background:${st.bar}"></span>
          <span class="node-name" style="font-size:13px;font-weight:600;color:#212121;line-height:1.35;letter-spacing:-0.2px;flex:1">${task.name}</span>
          ${groupBadge}
        </div>
        <div class="node-mid" style="display:flex;align-items:center;justify-content:space-between;gap:6px">
          <span class="node-assignee" style="font-size:11px;color:#9E9E9E">${task.assignee || '미배정'}</span>
          <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;white-space:nowrap;background:${st.bg};color:${st.text}">${st.label}</span>
        </div>
        ${subLine}
        ${ddayLine}
        ${actionBtn}
      </div>
      <div class="nh nh-r" data-id="${task.id}" data-side="right"></div>`;

    // 호버 하이라이트
    el.querySelector('.node-inner').addEventListener('mouseenter', () => this._applyHover(task.id));
    el.querySelector('.node-inner').addEventListener('mouseleave', () => this._clearHover());

    // 클릭 → 패널 열기
    el.querySelector('.node-inner').addEventListener('click', (e) => {
      if (e.target.closest('.node-action')) return;
      this.cb.onNodeClick?.(task);
    });

    // 시작
    el.querySelector('.btn-start')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onStatusChange?.(task.id, 'doing');
    });

    // 완료 요청
    el.querySelector('.btn-req')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onStatusChange?.(task.id, 'review');
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
      path.setAttribute('stroke', '#BDBDBD');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('marker-end', 'url(#arr)');
      path.dataset.flowId = flow.id;
      path.style.pointerEvents = 'stroke';
      path.style.cursor = 'pointer';
      path.addEventListener('click', () => {
        if (confirm('이 연결을 삭제하시겠습니까?')) this.cb.onFlowDelete?.(flow.id);
      });
      this.svg.insertBefore(path, this.tempPath);
    }
  }

  // ── 호버 하이라이트 ────────────────────────────────────
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
    const connected = this._getConnected(taskId);
    const connectedFlows = new Set(
      (this.data.flows || []).filter(f => connected.has(f.from) && connected.has(f.to)).map(f => f.id)
    );
    this.nodesEl.querySelectorAll('.task-node').forEach(n => {
      const isConn = connected.has(n.dataset.id);
      n.classList.toggle('dim-hover', !isConn);
      n.classList.toggle('highlight-hover', isConn && n.dataset.id !== taskId);
    });
    Array.from(this.svg.children).forEach(c => {
      if (c.tagName !== 'defs' && c !== this.tempPath) {
        const isConn = connectedFlows.has(c.dataset?.flowId);
        c.style.opacity = isConn ? '1' : '0.08';
        if (isConn) c.setAttribute('stroke', '#424242');
      }
    });
  }

  // ── 물리 애니메이션 ────────────────────────────────────
  _startPhysics() {
    const loop = () => {
      this._physicsRaf = requestAnimationFrame(loop);
      this._physicsStep();
    };
    this._physicsRaf = requestAnimationFrame(loop);
  }

  _physicsStep() {
    if (!this.data?.tasks?.length) return;

    const damping = 0.82;
    const maxVel  = 0.35;
    const springK = 0.018;
    let moved = false;

    for (const t of this.data.tasks) {
      if (t._vx === undefined) { t._vx = 0; t._vy = 0; }
    }

    // 드래그 중인 노드에서 연결된 노드로 스프링 힘 전달
    if (this._drag) {
      const dragged = this.data.tasks.find(t => t.id === this._drag.taskId);
      if (dragged) {
        for (const flow of (this.data.flows || [])) {
          let other = null;
          if (flow.from === dragged.id) other = this.data.tasks.find(t => t.id === flow.to);
          else if (flow.to === dragged.id) other = this.data.tasks.find(t => t.id === flow.from);
          if (!other || this._drag.taskId === other.id) continue;
          const dx = dragged.x - other.x, dy = dragged.y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          other._vx += (dx / dist) * springK * 3;
          other._vy += (dy / dist) * springK * 3;
        }
      }
    }

    for (const t of this.data.tasks) {
      if (this._drag?.taskId === t.id) { t._vx = 0; t._vy = 0; continue; }
      t._vx *= damping;
      t._vy *= damping;
      const spd = Math.sqrt(t._vx * t._vx + t._vy * t._vy);
      if (spd > maxVel) { t._vx = (t._vx / spd) * maxVel; t._vy = (t._vy / spd) * maxVel; }
      if (Math.abs(t._vx) > 0.008 || Math.abs(t._vy) > 0.008) {
        t.x += t._vx; t.y += t._vy;
        moved = true;
      }
    }

    if (moved) {
      for (const t of this.data.tasks) {
        const el = this.nodesEl.querySelector(`[data-id="${t.id}"]`);
        if (el) { el.style.left = t.x + 'px'; el.style.top = t.y + 'px'; }
      }
      this._renderEdges();
    }
  }

  _clearHover() {
    this.nodesEl.querySelectorAll('.task-node').forEach(n => {
      n.classList.remove('dim-hover', 'highlight-hover');
    });
    Array.from(this.svg.children).forEach(c => {
      if (c.tagName !== 'defs' && c !== this.tempPath) {
        c.style.opacity = '';
        c.setAttribute('stroke', '#BDBDBD');
      }
    });
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
