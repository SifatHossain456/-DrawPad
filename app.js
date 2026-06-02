// ── Canvas Setup ─────────────────────────────────────────────
const gridCanvas = document.getElementById('gridCanvas');
const canvas     = document.getElementById('canvas');
const tempCanvas = document.getElementById('tempCanvas');
const gctx       = gridCanvas.getContext('2d');
const ctx        = canvas.getContext('2d');
const tctx       = tempCanvas.getContext('2d');
const area       = document.getElementById('canvasArea');
const viewport   = document.getElementById('viewport');
const cursorRing = document.getElementById('cursorRing');

// ── State ─────────────────────────────────────────────────────
let tool      = 'pen';
let color     = '#ffffff';
let bgColor   = '#0f172a';
let size      = 4;
let opacity   = 1;
let fontSize  = 20;
let fill      = false;
let showGrid  = false;
let zoom      = 1;
let panX      = 0, panY = 0;
let drawing   = false;
let startX    = 0, startY = 0;
let lastX     = 0, lastY  = 0;
let undoStack = [], redoStack = [];
let recentColors = [];
const MAX_UNDO = 40;
const CW = 1200, CH = 750;   // logical canvas size

// ── Init ──────────────────────────────────────────────────────
function initCanvas() {
  [gridCanvas, canvas, tempCanvas].forEach(c => {
    c.width  = CW;
    c.height = CH;
    c.style.width  = CW + 'px';
    c.style.height = CH + 'px';
  });
  viewport.style.width  = CW + 'px';
  viewport.style.height = CH + 'px';
  document.getElementById('canvasSize').textContent = `${CW} × ${CH}`;
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
  viewport.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}

function fillBg() {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, CW, CH);
  ctx.restore();
}

// ── Grid ──────────────────────────────────────────────────────
function drawGrid() {
  gctx.clearRect(0, 0, CW, CH);
  if (!showGrid) return;
  gctx.save();
  gctx.strokeStyle = 'rgba(255,255,255,0.07)';
  gctx.lineWidth = 1;
  const step = 40;
  for (let x = 0; x <= CW; x += step) {
    gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, CH); gctx.stroke();
  }
  for (let y = 0; y <= CH; y += step) {
    gctx.beginPath(); gctx.moveTo(0, y); gctx.lineTo(CW, y); gctx.stroke();
  }
  gctx.restore();
}

// ── Zoom ──────────────────────────────────────────────────────
function setZoom(z, originX, originY) {
  const prev = zoom;
  zoom = Math.min(Math.max(z, 0.1), 8);
  if (originX !== undefined) {
    panX -= (originX - panX) * (zoom / prev - 1);
    panY -= (originY - panY) * (zoom / prev - 1);
  }
  applyTransform();
  document.getElementById('zoomLabel').textContent = Math.round(zoom * 100) + '%';
}

// Wheel zoom
area.addEventListener('wheel', e => {
  e.preventDefault();
  const r = area.getBoundingClientRect();
  setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

document.getElementById('zoomInBtn').addEventListener('click',    () => setZoom(zoom * 1.25));
document.getElementById('zoomOutBtn').addEventListener('click',   () => setZoom(zoom * 0.8));
document.getElementById('zoomResetBtn').addEventListener('click', () => { zoom = 1; centerCanvas(); document.getElementById('zoomLabel').textContent = '100%'; });

// ── Undo / Redo ───────────────────────────────────────────────
function saveState() {
  undoStack.push(ctx.getImageData(0, 0, CW, CH));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
  updateButtons();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(ctx.getImageData(0, 0, CW, CH));
  ctx.putImageData(undoStack.pop(), 0, 0);
  updateButtons();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(ctx.getImageData(0, 0, CW, CH));
  ctx.putImageData(redoStack.pop(), 0, 0);
  updateButtons();
}

function updateButtons() {
  document.getElementById('undoBtn').disabled = !undoStack.length;
  document.getElementById('redoBtn').disabled = !redoStack.length;
}

// ── Coords (screen → canvas) ──────────────────────────────────
function getPos(e) {
  const r   = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - r.left) / zoom,
    y: (src.clientY - r.top)  / zoom,
  };
}

// ── Drawing ───────────────────────────────────────────────────
function applyStyle(c, isEraser) {
  c.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
  c.globalAlpha  = isEraser ? 1 : opacity;
  c.strokeStyle  = color;
  c.fillStyle    = color;
  c.lineWidth    = isEraser ? size * 3 : size;
  c.lineCap      = 'round';
  c.lineJoin     = 'round';
}

// Smooth bezier pen
let penPoints = [];

function penDown(x, y) {
  penPoints = [{ x, y }];
  applyStyle(ctx, false);
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function penMove(x, y) {
  penPoints.push({ x, y });
  const n = penPoints.length;
  if (n < 3) { ctx.lineTo(x, y); ctx.stroke(); return; }
  const p0 = penPoints[n - 3];
  const p1 = penPoints[n - 2];
  const p2 = penPoints[n - 1];
  const cpx = (p0.x + p2.x) / 2;
  const cpy = (p0.y + p2.y) / 2;
  applyStyle(ctx, false);
  ctx.beginPath();
  ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
  ctx.quadraticCurveTo(p1.x, p1.y, cpx, cpy);
  ctx.stroke();
}

function drawShape(c, x1, y1, x2, y2) {
  if (c === tctx) c.clearRect(0, 0, CW, CH);
  applyStyle(c, false);
  c.beginPath();

  switch (tool) {
    case 'line':
      c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      break;

    case 'arrow': {
      const dx = x2 - x1, dy = y2 - y1;
      const angle = Math.atan2(dy, dx);
      const len   = Math.hypot(dx, dy);
      const hw    = Math.max(size * 3, 14);
      const hl    = Math.min(hw * 1.5, len * 0.4);
      const tx    = x2 - Math.cos(angle) * hl;
      const ty    = y2 - Math.sin(angle) * hl;
      c.moveTo(x1, y1); c.lineTo(tx, ty); c.stroke();
      c.beginPath();
      c.moveTo(x2, y2);
      c.lineTo(x2 - hw * Math.cos(angle - 0.42), y2 - hw * Math.sin(angle - 0.42));
      c.lineTo(x2 - hw * Math.cos(angle + 0.42), y2 - hw * Math.sin(angle + 0.42));
      c.closePath(); c.fill();
      break;
    }

    case 'rect': {
      const w = x2 - x1, h = y2 - y1;
      if (fill) c.fillRect(x1, y1, w, h);
      c.strokeRect(x1, y1, w, h);
      break;
    }

    case 'circle': {
      const rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
      c.ellipse(x1 + rx, y1 + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
      if (fill) c.fill();
      c.stroke();
      break;
    }

    case 'triangle':
      c.moveTo((x1 + x2) / 2, y1);
      c.lineTo(x2, y2); c.lineTo(x1, y2); c.closePath();
      if (fill) c.fill();
      c.stroke();
      break;
  }
}

// ── Text Tool ─────────────────────────────────────────────────
const textOverlay = document.getElementById('textOverlay');
const textInput   = document.getElementById('textInput');

function placeText(x, y) {
  const r  = area.getBoundingClientRect();
  const cx = r.left + panX + x * zoom;
  const cy = r.top  + panY + y * zoom;
  textOverlay.style.display = 'block';
  textOverlay.style.left    = cx + 'px';
  textOverlay.style.top     = cy + 'px';
  textInput.style.fontSize  = Math.max(12, fontSize * zoom) + 'px';
  textInput.value = '';
  textInput.focus();

  function commit() {
    const val = textInput.value.trim();
    textOverlay.style.display = 'none';
    textInput.removeEventListener('keydown', onKey);
    textInput.removeEventListener('blur', onBlur);
    if (!val) return;
    saveState();
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = color;
    ctx.font = `${fontSize}px Inter, sans-serif`;
    ctx.fillText(val, x, y + fontSize * 0.8);
    ctx.restore();
    pushRecent(color);
  }

  function onKey(e)  { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { textOverlay.style.display='none'; textInput.removeEventListener('keydown',onKey); textInput.removeEventListener('blur',onBlur); } }
  function onBlur()  { setTimeout(commit, 80); }

  textInput.addEventListener('keydown', onKey);
  textInput.addEventListener('blur',    onBlur);
}

// ── Mouse Events ──────────────────────────────────────────────
function onStart(e) {
  e.preventDefault();
  const { x, y } = getPos(e);
  startX = x; startY = y; lastX = x; lastY = y;

  if (tool === 'text') { placeText(x, y); return; }

  drawing = true;
  saveState();

  if (tool === 'pen')    { applyStyle(ctx, false); penDown(x, y); }
  if (tool === 'brush')  { applyStyle(ctx, false); ctx.beginPath(); }
  if (tool === 'eraser') { applyStyle(ctx, true);  ctx.beginPath(); ctx.moveTo(x, y); }
}

function onMove(e) {
  e.preventDefault();
  const { x, y } = getPos(e);
  updateCursorRing(e);
  if (!drawing) return;

  if (tool === 'pen') {
    penMove(x, y);
  } else if (tool === 'brush') {
    applyStyle(ctx, false);
    ctx.beginPath();
    ctx.arc(x, y, size * 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (tool === 'eraser') {
    applyStyle(ctx, true);
    ctx.lineTo(x, y);
    ctx.stroke();
  } else {
    drawShape(tctx, startX, startY, x, y);
  }

  lastX = x; lastY = y;
}

function onEnd(e) {
  if (!drawing) return;
  drawing = false;
  const pos = e.changedTouches
    ? { x: (e.changedTouches[0].clientX - canvas.getBoundingClientRect().left) / zoom,
        y: (e.changedTouches[0].clientY - canvas.getBoundingClientRect().top)  / zoom }
    : { x: lastX, y: lastY };

  const shapeTols = ['line','arrow','rect','circle','triangle'];
  if (shapeTols.includes(tool)) {
    drawShape(ctx, startX, startY, pos.x, pos.y);
    tctx.clearRect(0, 0, CW, CH);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  penPoints = [];

  if (['pen','brush','eraser','line','arrow','rect','circle','triangle'].includes(tool)) {
    pushRecent(color);
  }
}

canvas.addEventListener('mousedown',  onStart);
canvas.addEventListener('mousemove',  onMove);
canvas.addEventListener('mouseup',    onEnd);
canvas.addEventListener('mouseleave', e => { cursorRing.style.display='none'; onEnd(e); });
canvas.addEventListener('touchstart', onStart, { passive: false });
canvas.addEventListener('touchmove',  onMove,  { passive: false });
canvas.addEventListener('touchend',   onEnd);

// ── Cursor ring ───────────────────────────────────────────────
function updateCursorRing(e) {
  const src = e.touches ? e.touches[0] : e;
  const r   = canvas.getBoundingClientRect();
  const inside = src.clientX >= r.left && src.clientX <= r.right &&
                 src.clientY >= r.top  && src.clientY <= r.bottom;
  cursorRing.style.display = inside ? 'block' : 'none';
  const d = (tool === 'eraser' ? size * 3 * zoom : size * zoom) * 2 + 4;
  cursorRing.style.width  = d + 'px';
  cursorRing.style.height = d + 'px';
  cursorRing.style.left   = src.clientX + 'px';
  cursorRing.style.top    = src.clientY + 'px';
}
document.addEventListener('mousemove', updateCursorRing);

// ── Recent Colors ─────────────────────────────────────────────
function pushRecent(c) {
  if (recentColors[0] === c) return;
  recentColors = [c, ...recentColors.filter(x => x !== c)].slice(0, 8);
  renderRecentColors();
}

function renderRecentColors() {
  const el = document.getElementById('recentColors');
  const cells = Array.from({ length: 8 }, (_, i) => {
    const c = recentColors[i];
    if (!c) return `<button class="swatch empty" style="background:transparent"></button>`;
    return `<button class="swatch" style="background:${c}" data-color="${c}" title="${c}"></button>`;
  });
  el.innerHTML = cells.join('');
  el.querySelectorAll('[data-color]').forEach(s => {
    s.addEventListener('click', () => setColor(s.dataset.color));
  });
}

// ── Tool Selection ────────────────────────────────────────────
document.querySelectorAll('.tool').forEach(btn => {
  btn.addEventListener('click', () => {
    tool = btn.dataset.tool;
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── Fill ──────────────────────────────────────────────────────
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

// ── Size ──────────────────────────────────────────────────────
const sizeSlider = document.getElementById('sizeSlider');
const sizeValEl  = document.getElementById('sizeVal');

sizeSlider.addEventListener('input', () => { size = +sizeSlider.value; sizeValEl.textContent = size; });
document.querySelectorAll('.dot').forEach(d => {
  d.addEventListener('click', () => {
    size = +d.dataset.size;
    sizeSlider.value = size;
    sizeValEl.textContent = size;
  });
});

// ── Opacity ───────────────────────────────────────────────────
document.getElementById('opacitySlider').addEventListener('input', function() {
  opacity = this.value / 100;
  document.getElementById('opacityVal').textContent = this.value + '%';
});

// ── Font Size ─────────────────────────────────────────────────
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
  document.querySelectorAll('.palette:not(#recentColors) .swatch[data-color]').forEach(s => {
    s.classList.toggle('active', s.dataset.color === c);
  });
}

colorPicker.addEventListener('input', () => setColor(colorPicker.value));
document.querySelectorAll('.palette .swatch[data-color]').forEach(s => {
  s.addEventListener('click', () => setColor(s.dataset.color));
});

// ── Background ────────────────────────────────────────────────
document.querySelectorAll('.swatch[data-bg]').forEach(s => {
  s.addEventListener('click', () => {
    bgColor = s.dataset.bg;
    document.querySelectorAll('[data-bg]').forEach(b => b.classList.remove('active'));
    s.classList.add('active');
    saveState();
    const img = ctx.getImageData(0, 0, CW, CH);
    fillBg();
    ctx.putImageData(img, 0, 0);
  });
});

// ── Grid ──────────────────────────────────────────────────────
const gridBtn = document.getElementById('gridBtn');
gridBtn.addEventListener('click', () => {
  showGrid = !showGrid;
  gridBtn.classList.toggle('active', showGrid);
  drawGrid();
});

// ── Header Buttons ────────────────────────────────────────────
document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);

document.getElementById('clearBtn').addEventListener('click', () => {
  if (confirm('Clear the canvas?')) { saveState(); fillBg(); }
});

document.getElementById('downloadBtn').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'drawpad-' + Date.now() + '.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// ── Shortcuts Modal ───────────────────────────────────────────
const backdrop  = document.getElementById('modalBackdrop');
const modalClose = document.getElementById('modalClose');
document.getElementById('helpBtn').addEventListener('click',  () => backdrop.classList.add('open'));
modalClose.addEventListener('click',                          () => backdrop.classList.remove('open'));
backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.classList.remove('open'); });

// ── Keyboard Shortcuts ────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (document.activeElement === textInput) return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'y') { e.preventDefault(); redo(); }
    return;
  }
  const toolMap = { p:'pen', b:'brush', l:'line', a:'arrow', r:'rect', c:'circle', t:'triangle', x:'text', e:'eraser' };
  if (toolMap[e.key]) {
    tool = toolMap[e.key];
    document.querySelectorAll('.tool').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
    return;
  }
  if (e.key === 'g') { gridBtn.click(); return; }
  if (e.key === 'f') { toggleFill(); return; }
  if (e.key === '+' || e.key === '=') { setZoom(zoom * 1.2); return; }
  if (e.key === '-') { setZoom(zoom * 0.83); return; }
  if (e.key === '0') { zoom = 1; centerCanvas(); document.getElementById('zoomLabel').textContent='100%'; return; }
  if (e.key === '?') { backdrop.classList.toggle('open'); return; }
  if (e.key === 'Escape') { backdrop.classList.remove('open'); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (confirm('Clear canvas?')) { saveState(); fillBg(); }
  }
});

// ── Window resize ─────────────────────────────────────────────
window.addEventListener('resize', centerCanvas);

// ── Start ─────────────────────────────────────────────────────
initCanvas();
renderRecentColors();
updateButtons();
