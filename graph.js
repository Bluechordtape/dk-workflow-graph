// graph.js — 노드/엣지 렌더링 (SVG + HTML 오버레이)

const STATUS_COLOR = { done: '#1D9E75', wip: '#EF9F27', todo: '#888780' };
const STATUS_LABEL = { done: '완료', wip: '진행중', todo: '대기' };

// Layout constants
const PROJECT_W = 160, PROJECT_H = 52;
const CAT_W = 140, CAT_H = 44;
const TASK_W = 150, TASK_H = 64;
const H_GAP = 60;   // horizontal gap between nodes
const V_GAP = 36;   // vertical gap between categories/tasks
const PROJECT_START_X = 60;
const PROJECT_START_Y = 60;
const PROJECT_V_PADDING = 40; // space between projects

export class Graph {
  constructor(container, onNodeClick) {
    this.container = container;
    this.onNodeClick = onNodeClick;
    this.data = null;
    this.filter = { assignee: '', project: '', status: '' };
    this.nodePositions = {}; // id -> {x, y, w, h}
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this._dragging = null;
    this._panning = null;
    this.connectMode = false;
    this.connectFrom = null;
    this.onFlowCreate = null;
    this.onFlowDelete = null;
    this._setupDOM();
    this._setupInteractions();
  }

  _setupDOM() {
    this.container.innerHTML = '';
    this.canvas = document.createElement('div');
    this.canvas.className = 'graph-canvas';

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;';
    this.svg.setAttribute('id', 'edge-svg');

    // Arrow marker for flow edges
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `<marker id="flow-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L8,3 L0,6 Z" fill="#4f46e5" opacity="0.85"/>
    </marker>`;
    this.svg.appendChild(defs);

    this.nodesEl = document.createElement('div');
    this.nodesEl.className = 'graph-nodes';

    this.canvas.appendChild(this.svg);
    this.canvas.appendChild(this.nodesEl);
    this.container.appendChild(this.canvas);
  }

  setData(data) {
    this.data = data;
    const oldPositions = this.nodePositions;
    this._computeLayout();
    // Restore manually-dragged positions for existing nodes
    for (const id in oldPositions) {
      if (this.nodePositions[id]) {
        this.nodePositions[id] = oldPositions[id];
      }
    }
    this.render();
  }

  setFlowCallbacks(onCreate, onDelete) {
    this.onFlowCreate = onCreate;
    this.onFlowDelete = onDelete;
  }

  setConnectMode(enabled) {
    this.connectMode = enabled;
    this.connectFrom = null;
    this.nodesEl.querySelectorAll('.connect-selected').forEach(n => n.classList.remove('connect-selected'));
    this.container.style.cursor = enabled ? 'crosshair' : '';
  }

  setFilter(filter) {
    this.filter = { ...this.filter, ...filter };
    this.render();
  }

  _computeLayout() {
    // For each project, lay out categories in columns; tasks in rows within each column
    // Project node -> Category nodes (column) -> Task nodes (row per category)
    this.nodePositions = {};
    let currentY = PROJECT_START_Y;

    for (const project of this.data.projects) {
      const px = PROJECT_START_X;
      const py = currentY;
      this.nodePositions[project.id] = { x: px, y: py, w: PROJECT_W, h: PROJECT_H };

      // Categories start to the right of project node
      const catStartX = px + PROJECT_W + H_GAP;
      let catY = py;
      let maxBottom = py + PROJECT_H;

      for (const cat of project.categories) {
        const cx = catStartX;
        const cy = catY;
        this.nodePositions[cat.id] = { x: cx, y: cy, w: CAT_W, h: CAT_H };

        // Tasks to the right of category
        const taskStartX = cx + CAT_W + H_GAP;
        for (let ti = 0; ti < cat.tasks.length; ti++) {
          const task = cat.tasks[ti];
          const tx = taskStartX + ti * (TASK_W + H_GAP / 2);
          const ty = cy + (CAT_H - TASK_H) / 2;
          this.nodePositions[task.id] = { x: tx, y: ty, w: TASK_W, h: TASK_H };
        }

        const catBottom = cy + CAT_H;
        const taskBottom = cat.tasks.length ? cy + TASK_H : catBottom;
        maxBottom = Math.max(maxBottom, catBottom, taskBottom);
        catY = maxBottom + V_GAP;
      }

      currentY = Math.max(maxBottom, py + PROJECT_H) + PROJECT_V_PADDING;
    }
  }

  render() {
    if (!this.data) return;
    this._renderNodes();
    this._renderEdges();
    this._applyTransform();
  }

  _isFiltered(task, project) {
    const { assignee, status, project: pf } = this.filter;
    if (assignee && task.assignee !== assignee) return false;
    if (status && task.status !== status) return false;
    if (pf && project.id !== pf) return false;
    return true;
  }

  _renderNodes() {
    this.nodesEl.innerHTML = '';

    for (const project of this.data.projects) {
      // Check if any task in this project passes filter
      const hasMatch = project.categories.some(c =>
        c.tasks.some(t => this._isFiltered(t, project))
      );
      const dimProject = (this.filter.assignee || this.filter.status || this.filter.project) && !hasMatch;

      // Project node
      const pPos = this.nodePositions[project.id];
      const pEl = this._makeProjectNode(project, pPos, dimProject);
      this.nodesEl.appendChild(pEl);

      for (const cat of project.categories) {
        const catHasMatch = cat.tasks.some(t => this._isFiltered(t, project));
        const dimCat = (this.filter.assignee || this.filter.status || this.filter.project) && !catHasMatch;

        const cPos = this.nodePositions[cat.id];
        const cEl = this._makeCategoryNode(cat, project, cPos, dimCat);
        this.nodesEl.appendChild(cEl);

        for (const task of cat.tasks) {
          const match = this._isFiltered(task, project);
          const dim = (this.filter.assignee || this.filter.status || this.filter.project) && !match;
          const tPos = this.nodePositions[task.id];
          const tEl = this._makeTaskNode(task, project, tPos, dim);
          this.nodesEl.appendChild(tEl);
        }
      }
    }
  }

  _makeProjectNode(project, pos, dim) {
    const el = document.createElement('div');
    el.className = 'graph-node node-project' + (dim ? ' dim' : '');
    el.dataset.id = project.id;
    el.dataset.type = 'project';
    el.style.cssText = `left:${pos.x}px;top:${pos.y}px;width:${pos.w}px;height:${pos.h}px;border-left:4px solid ${project.color};`;
    el.innerHTML = `<span class="node-title">${project.name}</span>`;
    el.addEventListener('click', () => this.onNodeClick({ type: 'project', project }));
    this._makeDraggable(el, project.id);
    return el;
  }

  _makeCategoryNode(cat, project, pos, dim) {
    const el = document.createElement('div');
    el.className = 'graph-node node-category' + (dim ? ' dim' : '');
    el.dataset.id = cat.id;
    el.dataset.type = 'category';
    el.style.cssText = `left:${pos.x}px;top:${pos.y}px;width:${pos.w}px;height:${pos.h}px;border-left:3px solid ${project.color}88;`;
    el.innerHTML = `<span class="node-cat-label">${cat.name}</span>`;
    el.addEventListener('click', () => this.onNodeClick({ type: 'category', project, category: cat }));
    this._makeDraggable(el, cat.id);
    return el;
  }

  _makeTaskNode(task, project, pos, dim) {
    const el = document.createElement('div');
    el.className = 'graph-node node-task' + (dim ? ' dim' : '');
    el.dataset.id = task.id;
    el.dataset.type = 'task';
    const sc = STATUS_COLOR[task.status];
    el.style.cssText = `left:${pos.x}px;top:${pos.y}px;width:${pos.w}px;height:${pos.h}px;border-left:4px solid ${sc};`;
    el.innerHTML = `
      <div class="task-name">${task.name}</div>
      <div class="task-meta">
        ${task.assignee ? `<span class="assignee">${task.assignee}</span>` : ''}
        <span class="status-badge" style="background:${sc}22;color:${sc}">${STATUS_LABEL[task.status]}</span>
      </div>`;
    el.addEventListener('click', (e) => {
      if (this.connectMode) {
        e.stopPropagation();
        if (!this.connectFrom) {
          this.connectFrom = task.id;
          el.classList.add('connect-selected');
        } else if (this.connectFrom !== task.id) {
          this.onFlowCreate && this.onFlowCreate(this.connectFrom, task.id);
          this.connectFrom = null;
          this.nodesEl.querySelectorAll('.connect-selected').forEach(n => n.classList.remove('connect-selected'));
        }
        return;
      }
      this.onNodeClick({ type: 'task', project, task });
    });
    this._makeDraggable(el, task.id);
    return el;
  }

  _renderEdges() {
    // Clear everything except defs
    Array.from(this.svg.children).forEach(c => { if (c.tagName !== 'defs') c.remove(); });
    if (!this.data) return;

    for (const project of this.data.projects) {
      const pPos = this.nodePositions[project.id];
      for (const cat of project.categories) {
        const cPos = this.nodePositions[cat.id];
        // project -> category
        this._drawEdge(pPos, cat.id, project.color + '66');
        // category -> first task
        if (cat.tasks.length > 0) {
          this._drawEdge(cPos, cat.tasks[0].id, project.color + '44');
        }
        // task -> next task (chain)
        for (let i = 0; i < cat.tasks.length - 1; i++) {
          const a = this.nodePositions[cat.tasks[i].id];
          const b = this.nodePositions[cat.tasks[i + 1].id];
          this._drawEdgeBetween(a, b, '#55555533');
        }
      }
    }

    // Custom flow edges
    if (this.data.flows) {
      for (const flow of this.data.flows) {
        const a = this.nodePositions[flow.from];
        const b = this.nodePositions[flow.to];
        if (a && b) this._drawFlowEdge(a, b, flow.id);
      }
    }
  }

  _drawEdge(fromPos, toId, color) {
    const toPos = this.nodePositions[toId];
    if (!fromPos || !toPos) return;
    this._drawEdgeBetween(fromPos, toPos, color);
  }

  _drawEdgeBetween(a, b, color) {
    const x1 = a.x + a.w, y1 = a.y + a.h / 2;
    const x2 = b.x, y2 = b.y + b.h / 2;
    const cx = (x1 + x2) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('pointer-events', 'none');
    this.svg.appendChild(path);
  }

  _drawFlowEdge(a, b, flowId) {
    const x1 = a.x + a.w, y1 = a.y + a.h / 2;
    const x2 = b.x, y2 = b.y + b.h / 2;
    const cx = (x1 + x2) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#4f46e5');
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('stroke-opacity', '0.85');
    path.setAttribute('stroke-dasharray', '7,3');
    path.setAttribute('marker-end', 'url(#flow-arrow)');
    path.setAttribute('pointer-events', 'stroke');
    path.style.cursor = 'pointer';
    path.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('이 연결을 삭제하시겠습니까?')) {
        this.onFlowDelete && this.onFlowDelete(flowId);
      }
    });
    this.svg.appendChild(path);
  }

  _makeDraggable(el, nodeId) {
    let startMouse, startPos;
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      startMouse = { x: e.clientX, y: e.clientY };
      startPos = { ...this.nodePositions[nodeId] };
      this._dragging = { nodeId, startMouse, startPos };
    });
  }

  _setupInteractions() {
    // drag node
    window.addEventListener('mousemove', (e) => {
      if (this._dragging) {
        const { nodeId, startMouse, startPos } = this._dragging;
        const dx = (e.clientX - startMouse.x) / this.scale;
        const dy = (e.clientY - startMouse.y) / this.scale;
        this.nodePositions[nodeId].x = startPos.x + dx;
        this.nodePositions[nodeId].y = startPos.y + dy;
        const el = this.nodesEl.querySelector(`[data-id="${nodeId}"]`);
        if (el) {
          el.style.left = this.nodePositions[nodeId].x + 'px';
          el.style.top = this.nodePositions[nodeId].y + 'px';
        }
        this._renderEdges();
        return;
      }
      if (this._panning) {
        const dx = e.clientX - this._panning.startX;
        const dy = e.clientY - this._panning.startY;
        this.offsetX = this._panning.startOffX + dx;
        this.offsetY = this._panning.startOffY + dy;
        this._applyTransform();
      }
    });

    window.addEventListener('mouseup', () => {
      this._dragging = null;
      this._panning = null;
      this.container.style.cursor = '';
    });

    // pan on canvas background
    this.container.addEventListener('mousedown', (e) => {
      if (e.target !== this.container && e.target !== this.canvas) return;
      if (this.connectMode) {
        // Deselect connect source on background click
        this.connectFrom = null;
        this.nodesEl.querySelectorAll('.connect-selected').forEach(n => n.classList.remove('connect-selected'));
        return;
      }
      this._panning = {
        startX: e.clientX, startY: e.clientY,
        startOffX: this.offsetX, startOffY: this.offsetY
      };
      this.container.style.cursor = 'grabbing';
    });

    // zoom
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = this.container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.offsetX = mx - (mx - this.offsetX) * delta;
      this.offsetY = my - (my - this.offsetY) * delta;
      this.scale = Math.min(3, Math.max(0.2, this.scale * delta));
      this._applyTransform();
    }, { passive: false });
  }

  _applyTransform() {
    this.canvas.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale})`;
    this.canvas.style.transformOrigin = '0 0';
  }

  resetView() {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this._applyTransform();
  }

  relayout() {
    this._computeLayout();
    this.render();
  }
}
