// ── Canvas constants ──────────────────────────────────────────
const CW = 1200, CH = 750, MAX_UNDO = 20;

// ── Static canvases ───────────────────────────────────────────
const gridCanvas = document.getElementById('gridCanvas');
const tempCanvas  = document.getElementById('tempCanvas');
const gctx        = gridCanvas.getContext('2d');
const tctx        = tempCanvas.getContext('2d');
const area        = document.getElementById('canvasArea');
const viewport    = document.getElementById('viewport');
const cursorRing  = document.getElementById('cursorRing');

// ── Layer state ───────────────────────────────────────────────
let layers           = [];   // [{ id, name, canvas, ctx, visible, opacity }]
let activeLayerIndex = 0;
let undoStacks       = [];   // parallel to layers
let redoStacks       = [];

// ── Tool / draw state ─────────────────────────────────────────
let tool      = 'pen';
let color     = '#ffffff';
let bgColor   = '#0f172a';
let size      = 4;
let opacity   = 1;
let fontSize  = 20;
let fill      = false;
let showGrid  = false;
let dashStyle = 'solid';
let zoom      = 1;
let panX      = 0, panY = 0;
let drawing   = false;
let isPanning = false;
let panStartX = 0, panStartY = 0;
let startX    = 0, startY = 0, lastX = 0, lastY = 0;
let penPoints = [];
let recentColors = [];

// ── Helpers ───────────────────────────────────────────────────
function activeCtx()  { return layers[activeLayerIndex].ctx; }
function activeLayer(){ return layers[activeLayerIndex]; }
function inBounds(x, y){ return x >= 0 && x <= CW && y >= 0 && y <= CH; }

function fmt2(n) { return Math.round(n * 100) / 100; }

// ── Init ──────────────────────────────────────────────────────
function initCanvas() {
  [gridCanvas, tempCanvas].forEach(c => {
    c.width = CW; c.height = CH;
    c.style.width = CW + 'px'; c.style.height = CH + 'px';
  });
  tempCanvas.style.zIndex = 100;
  gridCanvas.style.zIndex = 0;
  viewport.style.width  = CW + 'px';
  viewport.style.height = CH + 'px';
  document.getElementById('canvasSize').textContent = `${CW} × ${CH}`;
  addLayer('Background');
  fillBg();
  centerCanvas();
}

function centerCanvas() {
  const aw = area.clientWidth, ah = area.clientHeight;
  panX = Math.max(0, (aw - CW * zoom) / 2);
  panY = Math.max(0, (ah - CH * zoom) / 2);
  applyTransform();
}

function applyTransform() {
  viewport.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
}

function fillBg() {
  const c = layers[0].ctx;
  c.save();
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = bgColor;
  c.fillRect(0, 0, CW, CH);
  c.restore();
}

// ── Layers ────────────────────────────────────────────────────
function addLayer(name, above) {
  const canvas = document.createElement('canvas');
  canvas.width = CW; canvas.height = CH;
  canvas.classList.add('layer-canvas');
  canvas.style.width  = CW + 'px';
  canvas.style.height = CH + 'px';

  const idx = above !== undefined ? above + 1 : layers.length;
  const layer = {
    id:      Date.now() + Math.random(),
    name:    name || `Layer ${layers.length + 1}`,
    canvas,
    ctx:     canvas.getContext('2d'),
    visible: true,
    opacity: 1,
  };

  layers.splice(idx, 0, layer);
  undoStacks.splice(idx, 0, []);
  redoStacks.splice(idx, 0, []);
  activeLayerIndex = idx;

  // Insert canvas into viewport before tempCanvas
  viewport.insertBefore(canvas, tempCanvas);
  updateLayerZIndexes();
  renderLayerPanel();
}

function deleteLayer() {
  if (layers.length === 1) { showToast('Must have at least one layer'); return; }
  const idx = activeLayerIndex;
  layers[idx].canvas.remove();
  layers.splice(idx, 1);
  undoStacks.splice(idx, 1);
  redoStacks.splice(idx, 1);
  activeLayerIndex = Math.min(idx, layers.length - 1);
  updateLayerZIndexes();
  renderLayerPanel();
}

function duplicateLayer() {
  const src = activeLayer();
  const idx  = activeLayerIndex;
  addLayer(src.name + ' copy', idx);
  const dst = activeLayer();
  dst.ctx.drawImage(src.canvas, 0, 0);
  renderLayerPanel();
  updateLayerThumb(activeLayerIndex);
}

function mergeAll() {
  if (layers.length === 1) return;
  const merged = document.createElement('canvas');
  merged.width = CW; merged.height = CH;
  const mc = merged.getContext('2d');
  mc.fillStyle = bgColor;
  mc.fillRect(0, 0, CW, CH);
  layers.forEach(l => {
    if (!l.visible) return;
    mc.globalAlpha = l.opacity;
    mc.drawImage(l.canvas, 0, 0);
  });
  mc.globalAlpha = 1;
  // Remove all but first layer
  while (layers.length > 1) {
    layers[layers.length - 1].canvas.remove();
    layers.pop();
    undoStacks.pop();
    redoStacks.pop();
  }
  layers[0].ctx.clearRect(0, 0, CW, CH);
  layers[0].ctx.drawImage(merged, 0, 0);
  layers[0].name    = 'Merged';
  layers[0].visible = true;
  layers[0].opacity = 1;
  layers[0].canvas.style.opacity = 1;
  activeLayerIndex = 0;
  updateLayerZIndexes();
  renderLayerPanel();
  updateLayerThumb(0);
  showToast('All layers merged');
}

function moveLayer(dir) {
  const idx  = activeLayerIndex;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= layers.length) return;
  // Swap
  [layers[idx], layers[newIdx]]           = [layers[newIdx], layers[idx]];
  [undoStacks[idx], undoStacks[newIdx]]   = [undoStacks[newIdx], undoStacks[idx]];
  [redoStacks[idx], redoStacks[newIdx]]   = [redoStacks[newIdx], redoStacks[idx]];
  activeLayerIndex = newIdx;
  updateLayerZIndexes();
  renderLayerPanel();
}

function updateLayerZIndexes() {
  layers.forEach((l, i) => { l.canvas.style.zIndex = i + 1; });
}

function setLayerVisibility(idx, vis) {
  layers[idx].visible = vis;
  layers[idx].canvas.style.display = vis ? 'block' : 'none';
  renderLayerPanel();
}

function setLayerOpacity(idx, val) {
  layers[idx].opacity = val;
  layers[idx].canvas.style.opacity = val;
}

// ── Layer panel rendering ─────────────────────────────────────
function renderLayerPanel() {
  const list = document.getElementById('lpList');
  list.innerHTML = '';
  // Show top layer first (reverse order)
  for (let i = layers.length - 1; i >= 0; i--) {
    const l   = layers[i];
    const item = document.createElement('div');
    item.className = 'lp-item' + (i === activeLayerIndex ? ' active' : '');
    item.dataset.idx = i;

    item.innerHTML = `
      <button class="lp-eye ${l.visible ? '' : 'hidden'}" data-idx="${i}" title="Toggle Visibility">
        ${l.visible
          ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`}
      </button>
      <canvas class="lp-thumb" width="52" height="32" data-idx="${i}"></canvas>
      <div class="lp-item-inner">
        <div class="lp-name" title="${l.name}">${l.name}</div>
        <div class="lp-opacity-row">
          <input type="range" class="lp-opacity-slider" min="0" max="1" step="0.01" value="${l.opacity}" data-idx="${i}" />
          <span class="lp-opacity-val">${Math.round(l.opacity*100)}%</span>
        </div>
      </div>`;

    // Click to activate
    item.addEventListener('click', e => {
      if (e.target.closest('.lp-eye') || e.target.closest('.lp-opacity-slider')) return;
      activeLayerIndex = +item.dataset.idx;
      renderLayerPanel();
    });

    // Eye toggle
    item.querySelector('.lp-eye').addEventListener('click', e => {
      e.stopPropagation();
      setLayerVisibility(i, !layers[i].visible);
    });

    // Opacity
    const slider = item.querySelector('.lp-opacity-slider');
    slider.addEventListener('input', e => {
      e.stopPropagation();
      const val = +slider.value;
      setLayerOpacity(i, val);
      item.querySelector('.lp-opacity-val').textContent = Math.round(val * 100) + '%';
    });

    list.appendChild(item);
    updateLayerThumb(i);
  }
}

function updateLayerThumb(idx) {
  const thumbs = document.querySelectorAll(`.lp-thumb[data-idx="${idx}"]`);
  thumbs.forEach(th => {
    const tc = th.getContext('2d');
    tc.clearRect(0, 0, 52, 32);
    tc.fillStyle = bgColor;
    tc.fillRect(0, 0, 52, 32);
    if (layers[idx].visible) {
      tc.globalAlpha = layers[idx].opacity;
      tc.drawImage(layers[idx].canvas, 0, 0, 52, 32);
      tc.globalAlpha = 1;
    }
  });
}

// ── Grid ──────────────────────────────────────────────────────
function drawGrid() {
  gctx.clearRect(0, 0, CW, CH);
  if (!showGrid) return;
  gctx.save();
  gctx.strokeStyle = 'rgba(255,255,255,0.07)';
  gctx.lineWidth = 1;
  for (let x = 0; x <= CW; x += 40) { gctx.beginPath(); gctx.moveTo(x,0); gctx.lineTo(x,CH); gctx.stroke(); }
  for (let y = 0; y <= CH; y += 40) { gctx.beginPath(); gctx.moveTo(0,y); gctx.lineTo(CW,y); gctx.stroke(); }
  gctx.restore();
}

// ── Zoom ──────────────────────────────────────────────────────
function setZoom(z, ox, oy) {
  const prev = zoom;
  zoom = Math.min(Math.max(z, 0.1), 8);
  if (ox !== undefined) { panX -= (ox - panX) * (zoom/prev - 1); panY -= (oy - panY) * (zoom/prev - 1); }
  applyTransform();
  document.getElementById('zoomLabel').textContent = Math.round(zoom * 100) + '%';
}

area.addEventListener('wheel', e => {
  e.preventDefault();
  const r = area.getBoundingClientRect();
  setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

document.getElementById('zoomInBtn').addEventListener('click',    () => setZoom(zoom * 1.25));
document.getElementById('zoomOutBtn').addEventListener('click',   () => setZoom(zoom * 0.8));
document.getElementById('zoomResetBtn').addEventListener('click', () => { zoom = 1; centerCanvas(); document.getElementById('zoomLabel').textContent = '100%'; });

// ── Undo / Redo (per layer) ───────────────────────────────────
function saveState() {
  const i = activeLayerIndex;
  undoStacks[i].push(layers[i].ctx.getImageData(0, 0, CW, CH));
  if (undoStacks[i].length > MAX_UNDO) undoStacks[i].shift();
  redoStacks[i] = [];
  updateButtons();
}

function undo() {
  const i = activeLayerIndex;
  if (!undoStacks[i].length) return;
  redoStacks[i].push(layers[i].ctx.getImageData(0, 0, CW, CH));
  layers[i].ctx.putImageData(undoStacks[i].pop(), 0, 0);
  updateLayerThumb(i);
  updateButtons();
}

function redo() {
  const i = activeLayerIndex;
  if (!redoStacks[i].length) return;
  undoStacks[i].push(layers[i].ctx.getImageData(0, 0, CW, CH));
  layers[i].ctx.putImageData(redoStacks[i].pop(), 0, 0);
  updateLayerThumb(i);
  updateButtons();
}

function updateButtons() {
  const i = activeLayerIndex;
  document.getElementById('undoBtn').disabled = !(undoStacks[i] && undoStacks[i].length);
  document.getElementById('redoBtn').disabled = !(redoStacks[i] && redoStacks[i].length);
}

// ── Coords ────────────────────────────────────────────────────
function getPos(e) {
  const r   = area.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - r.left - panX) / zoom,
    y: (src.clientY - r.top  - panY) / zoom,
  };
}

// ── Style helpers ─────────────────────────────────────────────
function applyStyle(c, isEraser) {
  c.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
  c.globalAlpha  = isEraser ? 1 : opacity;
  c.strokeStyle  = color;
  c.fillStyle    = color;
  c.lineWidth    = isEraser ? size * 3 : size;
  c.lineCap      = 'round';
  c.lineJoin     = 'round';
  applyDash(c, isEraser);
}

function applyDash(c, isEraser) {
  if (isEraser) { c.setLineDash([]); return; }
  switch (dashStyle) {
    case 'solid':  c.setLineDash([]); break;
    case 'dashed': c.setLineDash([size * 4 + 4, size * 2 + 2]); break;
    case 'dotted': c.setLineDash([1, size * 2 + 3]); c.lineCap = 'round'; break;
  }
}

// ── Smooth pen (bezier) ───────────────────────────────────────
function penDown(x, y) {
  penPoints = [{ x, y }];
  applyStyle(activeCtx(), false);
  activeCtx().beginPath();
  activeCtx().moveTo(x, y);
}

function penMove(x, y) {
  penPoints.push({ x, y });
  const n = penPoints.length;
  if (n < 3) { activeCtx().lineTo(x, y); activeCtx().stroke(); return; }
  const p0 = penPoints[n - 3], p1 = penPoints[n - 2], p2 = penPoints[n - 1];
  const cpx = (p0.x + p2.x) / 2, cpy = (p0.y + p2.y) / 2;
  applyStyle(activeCtx(), false);
  activeCtx().beginPath();
  activeCtx().moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
  activeCtx().quadraticCurveTo(p1.x, p1.y, cpx, cpy);
  activeCtx().stroke();
}

// ── Shape drawing ─────────────────────────────────────────────
function drawShape(c, x1, y1, x2, y2, preview) {
  if (preview) c.clearRect(0, 0, CW, CH);
  applyStyle(c, false);
  c.beginPath();
  switch (tool) {
    case 'line':
      c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); break;

    case 'arrow': {
      const dx = x2-x1, dy = y2-y1;
      const angle = Math.atan2(dy, dx);
      const len   = Math.hypot(dx, dy);
      const hw    = Math.max(size * 3, 14);
      const hl    = Math.min(hw * 1.5, len * 0.4);
      c.moveTo(x1, y1); c.lineTo(x2 - Math.cos(angle)*hl, y2 - Math.sin(angle)*hl); c.stroke();
      c.beginPath();
      c.moveTo(x2, y2);
      c.lineTo(x2 - hw*Math.cos(angle-0.42), y2 - hw*Math.sin(angle-0.42));
      c.lineTo(x2 - hw*Math.cos(angle+0.42), y2 - hw*Math.sin(angle+0.42));
      c.closePath(); c.fill();
      break;
    }

    case 'rect': {
      const w = x2-x1, h = y2-y1;
      if (fill) c.fillRect(x1, y1, w, h);
      c.strokeRect(x1, y1, w, h);
      break;
    }

    case 'circle': {
      const rx = (x2-x1)/2, ry = (y2-y1)/2;
      c.ellipse(x1+rx, y1+ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI*2);
      if (fill) c.fill(); c.stroke(); break;
    }

    case 'triangle':
      c.moveTo((x1+x2)/2, y1); c.lineTo(x2, y2); c.lineTo(x1, y2);
      c.closePath(); if (fill) c.fill(); c.stroke(); break;
  }
}

const SHAPE_TOOLS = new Set(['line','arrow','rect','circle','triangle']);

// ── Eyedropper ────────────────────────────────────────────────
function pickColor(x, y) {
  const tmp = document.createElement('canvas');
  tmp.width = CW; tmp.height = CH;
  const tc  = tmp.getContext('2d');
  tc.fillStyle = bgColor; tc.fillRect(0, 0, CW, CH);
  layers.filter(l => l.visible).forEach(l => {
    tc.globalAlpha = l.opacity; tc.drawImage(l.canvas, 0, 0);
  });
  tc.globalAlpha = 1;
  const px = tc.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
  const hex = '#' + [px[0],px[1],px[2]].map(v => v.toString(16).padStart(2,'0')).join('');
  setColor(hex);
  showToast('Color picked: ' + hex);
}

// ── Text tool ─────────────────────────────────────────────────
const textOverlay = document.getElementById('textOverlay');
const textInput   = document.getElementById('textInput');

function placeText(x, y) {
  const r  = area.getBoundingClientRect();
  textOverlay.style.display = 'block';
  textOverlay.style.left    = (r.left + panX + x * zoom) + 'px';
  textOverlay.style.top     = (r.top  + panY + y * zoom) + 'px';
  textInput.style.fontSize  = Math.max(12, fontSize * zoom) + 'px';
  textInput.value = '';
  setTimeout(() => textInput.focus(), 0);

  function commit() {
    const val = textInput.value.trim();
    textOverlay.style.display = 'none';
    cleanup();
    if (!val) return;
    saveState();
    const ac = activeCtx();
    ac.save();
    ac.globalAlpha = opacity;
    ac.globalCompositeOperation = 'source-over';
    ac.fillStyle = color;
    ac.font = `${fontSize}px Inter, sans-serif`;
    ac.fillText(val, x, y + fontSize * 0.8);
    ac.restore();
    updateLayerThumb(activeLayerIndex);
    pushRecent(color);
  }

  function onKey(e)  {
    if (e.key === 'Enter')  commit();
    if (e.key === 'Escape') { textOverlay.style.display = 'none'; cleanup(); }
  }
  function onBlur()  { setTimeout(commit, 100); }
  function cleanup() { textInput.removeEventListener('keydown', onKey); textInput.removeEventListener('blur', onBlur); }

  textInput.addEventListener('keydown', onKey);
  textInput.addEventListener('blur',    onBlur);
}

// ── Image import ──────────────────────────────────────────────
function importImage(file, dropX, dropY) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      saveState();
      let iw = img.width, ih = img.height;
      const maxW = CW * 0.8, maxH = CH * 0.8;
      if (iw > maxW || ih > maxH) { const s = Math.min(maxW/iw, maxH/ih); iw *= s; ih *= s; }
      const ix = dropX !== undefined ? dropX - iw/2 : (CW - iw) / 2;
      const iy = dropY !== undefined ? dropY - ih/2 : (CH - ih) / 2;
      const ac = activeCtx();
      ac.save(); ac.globalAlpha = 1; ac.globalCompositeOperation = 'source-over';
      ac.drawImage(img, ix, iy, iw, ih);
      ac.restore();
      updateLayerThumb(activeLayerIndex);
      showToast('Image imported');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

document.getElementById('importFile').addEventListener('change', function() {
  if (this.files[0]) importImage(this.files[0]);
  this.value = '';
});

// Drag & drop
area.addEventListener('dragenter', e => { e.preventDefault(); document.getElementById('dropOverlay').classList.add('show'); });
area.addEventListener('dragleave', e => { if (!area.contains(e.relatedTarget)) document.getElementById('dropOverlay').classList.remove('show'); });
area.addEventListener('dragover',  e => e.preventDefault());
area.addEventListener('drop', e => {
  e.preventDefault();
  document.getElementById('dropOverlay').classList.remove('show');
  const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
  if (file) { const { x, y } = getPos(e); importImage(file, x, y); }
});

// ── Mouse / Touch events ──────────────────────────────────────
function onStart(e) {
  if (e.target === textInput) return;
  e.preventDefault();
  const { x, y } = getPos(e);

  if (tool === 'hand') {
    isPanning = true;
    const src = e.touches ? e.touches[0] : e;
    panStartX = src.clientX - panX;
    panStartY = src.clientY - panY;
    area.style.cursor = 'grabbing';
    return;
  }
  if (tool === 'text')       { if (inBounds(x, y)) placeText(x, y); return; }
  if (tool === 'eyedropper') { if (inBounds(x, y)) pickColor(x, y); return; }
  if (!inBounds(x, y))  return;

  drawing = true;
  saveState();
  startX = x; startY = y; lastX = x; lastY = y;

  if (tool === 'pen')    penDown(x, y);
  if (tool === 'brush')  { applyStyle(activeCtx(), false); }
  if (tool === 'eraser') { applyStyle(activeCtx(), true); activeCtx().beginPath(); activeCtx().moveTo(x, y); }
}

function onMove(e) {
  e.preventDefault();
  updateCursorRing(e);

  if (isPanning) {
    const src = e.touches ? e.touches[0] : e;
    panX = src.clientX - panStartX;
    panY = src.clientY - panStartY;
    applyTransform();
    return;
  }
  if (!drawing) return;

  const { x, y } = getPos(e);

  if (tool === 'pen') {
    penMove(x, y);
  } else if (tool === 'brush') {
    applyStyle(activeCtx(), false);
    activeCtx().beginPath();
    activeCtx().arc(x, y, size * 1.6, 0, Math.PI * 2);
    activeCtx().fill();
  } else if (tool === 'eraser') {
    applyStyle(activeCtx(), true);
    activeCtx().lineTo(x, y);
    activeCtx().stroke();
  } else if (SHAPE_TOOLS.has(tool)) {
    drawShape(tctx, startX, startY, x, y, true);
  }

  lastX = x; lastY = y;
}

function onEnd(e) {
  if (isPanning) {
    isPanning = false;
    area.style.cursor = tool === 'hand' ? 'grab' : 'none';
    return;
  }
  if (!drawing) return;
  drawing = false;

  if (SHAPE_TOOLS.has(tool)) {
    drawShape(activeCtx(), startX, startY, lastX, lastY, false);
    tctx.clearRect(0, 0, CW, CH);
  }

  const ac = activeCtx();
  ac.globalCompositeOperation = 'source-over';
  ac.globalAlpha = 1;
  ac.setLineDash([]);
  penPoints = [];

  pushRecent(color);
  updateLayerThumb(activeLayerIndex);
}

area.addEventListener('mousedown',  onStart);
area.addEventListener('mousemove',  onMove);
area.addEventListener('mouseup',    onEnd);
area.addEventListener('mouseleave', e => { cursorRing.style.display='none'; onEnd(e); });
area.addEventListener('touchstart', onStart, { passive: false });
area.addEventListener('touchmove',  onMove,  { passive: false });
area.addEventListener('touchend',   onEnd);

// ── Cursor ring ───────────────────────────────────────────────
function updateCursorRing(e) {
  const src = e.touches ? e.touches[0] : e;
  const r   = area.getBoundingClientRect();
  const inside = src.clientX >= r.left && src.clientX <= r.right &&
                 src.clientY >= r.top  && src.clientY <= r.bottom;
  cursorRing.style.display = inside && tool !== 'hand' ? 'block' : 'none';
  const d  = (tool === 'eraser' ? size * 3 * zoom : size * zoom) * 2 + 4;
  const cl = tool === 'eyedropper' ? 'rgba(255,200,0,.8)' : 'rgba(255,255,255,.65)';
  cursorRing.style.width        = (tool === 'eyedropper' ? 20 : d) + 'px';
  cursorRing.style.height       = (tool === 'eyedropper' ? 20 : d) + 'px';
  cursorRing.style.borderColor  = cl;
  cursorRing.style.left         = src.clientX + 'px';
  cursorRing.style.top          = src.clientY + 'px';
}
document.addEventListener('mousemove', updateCursorRing);

// ── Recent colors ─────────────────────────────────────────────
function pushRecent(c) {
  if (recentColors[0] === c) return;
  recentColors = [c, ...recentColors.filter(x => x !== c)].slice(0, 8);
  renderRecent();
}

function renderRecent() {
  const el = document.getElementById('recentColors');
  el.innerHTML = Array.from({ length: 8 }, (_, i) => {
    const c = recentColors[i];
    return c
      ? `<button class="swatch" style="background:${c}" data-color="${c}" title="${c}"></button>`
      : `<button class="swatch empty"></button>`;
  }).join('');
  el.querySelectorAll('[data-color]').forEach(s => s.addEventListener('click', () => setColor(s.dataset.color)));
}

// ── Tool buttons ──────────────────────────────────────────────
document.querySelectorAll('.tool').forEach(btn => {
  btn.addEventListener('click', () => {
    tool = btn.dataset.tool;
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    area.style.cursor = tool === 'hand' ? 'grab' : 'none';
  });
});

// ── Fill toggle ───────────────────────────────────────────────
const fillToggle  = document.getElementById('fillToggle');
const fillPreview = document.getElementById('fillPreview');
const fillLabel   = document.getElementById('fillLabel');

function toggleFill() {
  fill = !fill;
  fillToggle.classList.toggle('active', fill);
  fillLabel.textContent = fill ? 'On' : 'Off';
  fillPreview.style.background = fill ? color : 'transparent';
}
fillToggle.addEventListener('click', toggleFill);

// ── Stroke style ──────────────────────────────────────────────
document.querySelectorAll('.stroke-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    dashStyle = btn.dataset.dash;
    document.querySelectorAll('.stroke-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── Size ──────────────────────────────────────────────────────
const sizeSlider = document.getElementById('sizeSlider');
const sizeValEl  = document.getElementById('sizeVal');
sizeSlider.addEventListener('input', () => { size = +sizeSlider.value; sizeValEl.textContent = size; });
document.querySelectorAll('.dot').forEach(d => {
  d.addEventListener('click', () => { size = +d.dataset.size; sizeSlider.value = size; sizeValEl.textContent = size; });
});

// ── Opacity ───────────────────────────────────────────────────
document.getElementById('opacitySlider').addEventListener('input', function() {
  opacity = this.value / 100;
  document.getElementById('opacityVal').textContent = this.value + '%';
});

// ── Font size ─────────────────────────────────────────────────
document.getElementById('fontSizeSlider').addEventListener('input', function() {
  fontSize = +this.value;
  document.getElementById('fontSizeVal').textContent = fontSize;
});

// ── Color ─────────────────────────────────────────────────────
const colorPicker = document.getElementById('colorPicker');

function setColor(c) {
  color = c;
  colorPicker.value = c;
  if (fill) fillPreview.style.background = c;
  document.querySelectorAll('.palette .swatch[data-color]').forEach(s => {
    s.classList.toggle('active', s.dataset.color === c);
  });
}
colorPicker.addEventListener('input', () => setColor(colorPicker.value));
document.querySelectorAll('.palette .swatch[data-color]').forEach(s => s.addEventListener('click', () => setColor(s.dataset.color)));

// ── Background ────────────────────────────────────────────────
document.querySelectorAll('[data-bg]').forEach(s => {
  s.addEventListener('click', () => {
    bgColor = s.dataset.bg;
    document.querySelectorAll('[data-bg]').forEach(b => b.classList.remove('active'));
    s.classList.add('active');
    saveState();
    const img = layers[0].ctx.getImageData(0, 0, CW, CH);
    fillBg();
    layers[0].ctx.putImageData(img, 0, 0);
    updateLayerThumb(0);
  });
});

// ── Grid ──────────────────────────────────────────────────────
const gridBtn = document.getElementById('gridBtn');
gridBtn.addEventListener('click', () => {
  showGrid = !showGrid;
  gridBtn.classList.toggle('active', showGrid);
  drawGrid();
});

// ── Layer panel buttons ───────────────────────────────────────
document.getElementById('addLayerBtn').addEventListener('click', () => { addLayer(); showToast('Layer added'); });
document.getElementById('dupLayerBtn').addEventListener('click', () => { duplicateLayer(); showToast('Layer duplicated'); });
document.getElementById('delLayerBtn').addEventListener('click', deleteLayer);
document.getElementById('mergeAllBtn').addEventListener('click', mergeAll);
document.getElementById('moveUpBtn').addEventListener('click',   () => moveLayer(1));
document.getElementById('moveDownBtn').addEventListener('click', () => moveLayer(-1));

// ── Header buttons ────────────────────────────────────────────
document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);

document.getElementById('clearBtn').addEventListener('click', () => {
  if (confirm('Clear active layer?')) { saveState(); activeCtx().clearRect(0, 0, CW, CH); if (activeLayerIndex === 0) fillBg(); updateLayerThumb(activeLayerIndex); }
});

document.getElementById('downloadBtn').addEventListener('click', () => {
  const tmp = document.createElement('canvas');
  tmp.width = CW; tmp.height = CH;
  const tc  = tmp.getContext('2d');
  tc.fillStyle = bgColor; tc.fillRect(0, 0, CW, CH);
  layers.filter(l => l.visible).forEach(l => { tc.globalAlpha = l.opacity; tc.drawImage(l.canvas, 0, 0); });
  tc.globalAlpha = 1;
  const link = document.createElement('a');
  link.download = 'drawpad-' + Date.now() + '.png';
  link.href = tmp.toDataURL('image/png');
  link.click();
});

// ── Shortcuts modal ───────────────────────────────────────────
const backdrop   = document.getElementById('modalBackdrop');
document.getElementById('helpBtn').addEventListener('click',   () => backdrop.classList.add('open'));
document.getElementById('modalClose').addEventListener('click', () => backdrop.classList.remove('open'));
backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.classList.remove('open'); });

// ── Keyboard shortcuts ────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (document.activeElement === textInput) return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'y') { e.preventDefault(); redo(); }
    return;
  }
  const toolMap = { p:'pen', b:'brush', l:'line', a:'arrow', r:'rect', c:'circle', t:'triangle', x:'text', i:'eyedropper', h:'hand', e:'eraser' };
  if (toolMap[e.key]) {
    tool = toolMap[e.key];
    document.querySelectorAll('.tool').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
    area.style.cursor = tool === 'hand' ? 'grab' : 'none';
    return;
  }
  if (e.key === 'g') { gridBtn.click(); return; }
  if (e.key === 'f') { toggleFill(); return; }
  if (e.key === '+' || e.key === '=') { setZoom(zoom * 1.2); return; }
  if (e.key === '-') { setZoom(zoom * 0.83); return; }
  if (e.key === '0') { zoom = 1; centerCanvas(); document.getElementById('zoomLabel').textContent = '100%'; return; }
  if (e.key === '?') { backdrop.classList.toggle('open'); return; }
  if (e.key === 'Escape') { backdrop.classList.remove('open'); return; }
  if (e.key === 'Delete') { if (confirm('Clear active layer?')) { saveState(); activeCtx().clearRect(0, 0, CW, CH); if (activeLayerIndex===0) fillBg(); updateLayerThumb(activeLayerIndex); } }
});

// ── Toast ─────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  let t = document.getElementById('__toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '__toast';
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1f2937;color:#f1f5f9;border:1px solid #1e2d42;padding:9px 16px;border-radius:9px;font-size:12px;font-weight:600;z-index:9999;transition:all .3s;pointer-events:none;opacity:0;transform:translateY(8px)';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1'; t.style.transform = 'translateY(0)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; }, 2200);
}

// ── Resize ────────────────────────────────────────────────────
window.addEventListener('resize', centerCanvas);

// ── Boot ──────────────────────────────────────────────────────
initCanvas();
renderRecent();
updateButtons();
