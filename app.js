// ── Canvas Setup ────────────────────────────────────────────
const canvas     = document.getElementById('canvas');
const tempCanvas = document.getElementById('tempCanvas');
const ctx        = canvas.getContext('2d');
const tctx       = tempCanvas.getContext('2d');
const area       = document.getElementById('canvasArea');
const cursorRing = document.getElementById('cursorRing');

// ── State ────────────────────────────────────────────────────
let tool       = 'pen';
let color      = '#ffffff';
let bgColor    = '#0f172a';
let size       = 4;
let opacity    = 1;
let fill       = false;
let drawing    = false;
let startX     = 0;
let startY     = 0;
let undoStack  = [];
let redoStack  = [];
const MAX_UNDO = 30;

// ── Resize canvas to fill area ───────────────────────────────
function resizeCanvas() {
  const W = area.clientWidth;
  const H = area.clientHeight;
  const cw = Math.floor(W * 0.92);
  const ch = Math.floor(H * 0.92);

  // Preserve drawn content
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);

  canvas.width      = cw; canvas.height      = ch;
  tempCanvas.width  = cw; tempCanvas.height  = ch;

  canvas.style.left = tempCanvas.style.left = `${(W - cw) / 2}px`;
  canvas.style.top  = tempCanvas.style.top  = `${(H - ch) / 2}px`;

  fillBg();
  ctx.putImageData(img, 0, 0);
  document.getElementById('canvasSize').textContent = `${cw} × ${ch}`;
}

function fillBg() {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// ── Undo / Redo ──────────────────────────────────────────────
function saveState() {
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
  updateButtons();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  ctx.putImageData(undoStack.pop(), 0, 0);
  updateButtons();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  ctx.putImageData(redoStack.pop(), 0, 0);
  updateButtons();
}

function updateButtons() {
  document.getElementById('undoBtn').disabled = undoStack.length === 0;
  document.getElementById('redoBtn').disabled = redoStack.length === 0;
}

// ── Mouse Coords relative to canvas ─────────────────────────
function getPos(e) {
  const r = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return { x: src.clientX - r.left, y: src.clientY - r.top };
}

// ── Drawing helpers ──────────────────────────────────────────
function applyStyle(c) {
  c.strokeStyle = color;
  c.fillStyle   = color;
  c.lineWidth   = tool === 'eraser' ? size * 3 : size;
  c.globalAlpha = tool === 'eraser' ? 1 : opacity;
  c.lineCap     = 'round';
  c.lineJoin    = 'round';
  if (tool === 'eraser') { c.globalCompositeOperation = 'destination-out'; }
  else                   { c.globalCompositeOperation = 'source-over'; }
}

function drawShape(c, x1, y1, x2, y2) {
  if (c === tctx) c.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
  applyStyle(c);
  c.beginPath();

  switch (tool) {
    case 'line':
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.stroke();
      break;

    case 'rect': {
      const w = x2 - x1, h = y2 - y1;
      if (fill) c.fillRect(x1, y1, w, h);
      c.strokeRect(x1, y1, w, h);
      break;
    }

    case 'circle': {
      const rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
      const cx = x1 + rx, cy = y1 + ry;
      c.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
      if (fill) c.fill();
      c.stroke();
      break;
    }

    case 'triangle':
      c.moveTo((x1 + x2) / 2, y1);
      c.lineTo(x2, y2);
      c.lineTo(x1, y2);
      c.closePath();
      if (fill) c.fill();
      c.stroke();
      break;
  }
}

// ── Events ───────────────────────────────────────────────────
function onStart(e) {
  e.preventDefault();
  drawing = true;
  const { x, y } = getPos(e);
  startX = x; startY = y;
  saveState();

  if (tool === 'pen' || tool === 'brush' || tool === 'eraser') {
    applyStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
}

function onMove(e) {
  e.preventDefault();
  const { x, y } = getPos(e);
  moveCursorRing(e);

  if (!drawing) return;

  if (tool === 'pen' || tool === 'eraser') {
    applyStyle(ctx);
    ctx.lineTo(x, y);
    ctx.stroke();
  } else if (tool === 'brush') {
    applyStyle(ctx);
    ctx.beginPath();
    ctx.arc(x, y, size * 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else {
    drawShape(tctx, startX, startY, x, y);
  }
}

function onEnd(e) {
  if (!drawing) return;
  drawing = false;
  const { x, y } = getPos(e);

  if (['line', 'rect', 'circle', 'triangle'].includes(tool)) {
    // Commit temp to main canvas
    applyStyle(ctx);
    drawShape(ctx, startX, startY, x, y);
    tctx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

canvas.addEventListener('mousedown',  onStart);
canvas.addEventListener('mousemove',  onMove);
canvas.addEventListener('mouseup',    onEnd);
canvas.addEventListener('mouseleave', onEnd);
canvas.addEventListener('touchstart', onStart, { passive: false });
canvas.addEventListener('touchmove',  onMove,  { passive: false });
canvas.addEventListener('touchend',   onEnd);

// ── Cursor ring ──────────────────────────────────────────────
function moveCursorRing(e) {
  const src = e.touches ? e.touches[0] : e;
  const r = canvas.getBoundingClientRect();
  const inside = src.clientX >= r.left && src.clientX <= r.right &&
                 src.clientY >= r.top  && src.clientY <= r.bottom;

  cursorRing.style.display = inside ? 'block' : 'none';
  const d = (tool === 'eraser' ? size * 3 : size) * 2 + 4;
  cursorRing.style.width  = d + 'px';
  cursorRing.style.height = d + 'px';
  cursorRing.style.left   = src.clientX + 'px';
  cursorRing.style.top    = src.clientY + 'px';
}
document.addEventListener('mousemove', moveCursorRing);
canvas.addEventListener('mouseleave', () => { cursorRing.style.display = 'none'; });

// ── Toolbar: tools ───────────────────────────────────────────
document.querySelectorAll('.tool').forEach(btn => {
  btn.addEventListener('click', () => {
    tool = btn.dataset.tool;
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── Fill toggle ──────────────────────────────────────────────
const fillToggle = document.getElementById('fillToggle');
const fillPreview = document.getElementById('fillPreview');
const fillLabel   = document.getElementById('fillLabel');

fillToggle.addEventListener('click', () => {
  fill = !fill;
  fillToggle.classList.toggle('active', fill);
  fillLabel.textContent = fill ? 'On' : 'Off';
  fillPreview.style.background = fill ? color : 'transparent';
});

function syncFillPreview() {
  fillPreview.style.background = fill ? color : 'transparent';
}

// ── Size ─────────────────────────────────────────────────────
const sizeSlider = document.getElementById('sizeSlider');
const sizeVal    = document.getElementById('sizeVal');

sizeSlider.addEventListener('input', () => {
  size = parseInt(sizeSlider.value);
  sizeVal.textContent = size + 'px';
});

document.querySelectorAll('.dot').forEach(d => {
  d.addEventListener('click', () => {
    size = parseInt(d.dataset.size);
    sizeSlider.value = size;
    sizeVal.textContent = size + 'px';
  });
});

// ── Opacity ──────────────────────────────────────────────────
const opacitySlider = document.getElementById('opacitySlider');
const opacityVal    = document.getElementById('opacityVal');

opacitySlider.addEventListener('input', () => {
  opacity = parseInt(opacitySlider.value) / 100;
  opacityVal.textContent = opacitySlider.value + '%';
});

// ── Color ────────────────────────────────────────────────────
const colorPicker = document.getElementById('colorPicker');

function setColor(c) {
  color = c;
  colorPicker.value = c;
  syncFillPreview();
  document.querySelectorAll('.palette .swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === c);
  });
}

colorPicker.addEventListener('input', () => setColor(colorPicker.value));

document.querySelectorAll('.palette .swatch').forEach(s => {
  s.addEventListener('click', () => setColor(s.dataset.color));
});

// ── Background ───────────────────────────────────────────────
document.querySelectorAll('.bg-swatches .swatch').forEach(s => {
  s.addEventListener('click', () => {
    bgColor = s.dataset.bg;
    document.querySelectorAll('.bg-swatches .swatch').forEach(b => b.classList.remove('active'));
    s.classList.add('active');
    saveState();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    fillBg();
    ctx.putImageData(img, 0, 0);
  });
});

// ── Header Buttons ───────────────────────────────────────────
document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);

document.getElementById('clearBtn').addEventListener('click', () => {
  if (confirm('Clear the canvas?')) {
    saveState();
    fillBg();
  }
});

document.getElementById('downloadBtn').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'drawpad-' + Date.now() + '.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// ── Keyboard Shortcuts ───────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'y') { e.preventDefault(); redo(); }
    return;
  }
  const map = { p: 'pen', b: 'brush', l: 'line', r: 'rect', c: 'circle', t: 'triangle', e: 'eraser' };
  const t = map[e.key.toLowerCase()];
  if (t) {
    tool = t;
    document.querySelectorAll('.tool').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === t);
    });
  }
});

// ── Init ─────────────────────────────────────────────────────
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
updateButtons();
