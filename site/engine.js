// Planted by Strangers: drawing engine (same code as the videos, without the rules that choose a flower)
const PBS = (() => {
// Deterministic helpers: every flower is derived from a string seed (the commenter's
// name + comment id), so the same person always gets the same flower, in every render
// and on the website.

function hashString(str) {
  // FNV-1a 32 bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeInOut = (t) => {
  t = clamp(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const easeOutBack = (t) => {
  t = clamp(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
// progress of t inside [a,b]
const seg = (t, a, b) => clamp((t - a) / (b - a));

function mixColor(c1, c2, t) {
  const a = hexToRgb(c1);
  const b = hexToRgb(c2);
  const r = Math.round(lerp(a[0], b[0], t));
  const g = Math.round(lerp(a[1], b[1], t));
  const bl = Math.round(lerp(a[2], b[2], t));
  return `rgb(${r},${g},${bl})`;
}

function hexToRgb(hex) {
  if (hex.startsWith('rgb')) return hex.match(/[\d.]+/g).slice(0, 3).map(Number);
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// Scene drawing for the comment garden: sky, hills, meadow, perspective camera,
// name tags, captions and the small UI badge. Pure Canvas-2D, so it runs in Node
// (video render) and in the browser (website) alike.
let W = 1080;
let H = 1920;
// stills (banner, profile picture) use other canvas sizes
function setSize(w, h) {
  W = w;
  H = h;
}

const FONT = {
  caption: 'NunitoBlack',
  ui: 'NunitoBold',
  title: 'FrauncesBold',
  tag: 'CaveatBold',
};

// ---------- camera ----------
// The garden lives on the ground plane (x right, z away). The camera orbits the
// garden centre: theta = orbit angle, D = distance, camH = height above ground.
function project(cam, wx, wz) {
  const c = Math.cos(cam.theta);
  const s = Math.sin(cam.theta);
  const x = wx * c - wz * s;
  const z = wx * s + wz * c;
  const depth = z + cam.D;
  if (depth < 0.6) return null;
  const k = cam.f / depth;
  return { sx: W / 2 + (x + (cam.panX || 0)) * k, sy: cam.horizon + cam.camH * k, s: k, depth, fx: x };
}

// Sunflower-seed spiral: flower #0 sits in the centre, later flowers grow outwards.
function gardenPos(i, spacing = 0.5) {
  const a = i * 2.399963229728653;
  const r = spacing * Math.sqrt(i + 0.35);
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

// ---------- sky and landscape ----------
const CLOUDS = [
  { x: 0.12, y: 0.115, k: 1.0, v: 0.006 },
  { x: 0.62, y: 0.2, k: 0.7, v: 0.004 },
  { x: 0.9, y: 0.085, k: 0.85, v: 0.005 },
  { x: 0.35, y: 0.3, k: 0.5, v: 0.003 },
];

function cloud(ctx, x, y, k, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#FFF6E9';
  const blobs = [
    [0, 0, 70], [70, -28, 86], [150, -8, 74], [215, 10, 52], [-58, 14, 46], [80, 24, 80],
  ];
  ctx.beginPath();
  for (const [bx, by, br] of blobs) {
    ctx.moveTo(x + (bx + br) * k, y + by * k);
    ctx.arc(x + bx * k, y + by * k, br * k, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}

function hillPath(ctx, baseY, amp, freq, phase) {
  ctx.beginPath();
  ctx.moveTo(-20, H);
  for (let x = -20; x <= W + 20; x += 12) {
    const y = baseY - amp * (Math.sin(x * freq + phase) * 0.6 + Math.sin(x * freq * 2.3 + phase * 1.7) * 0.4);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W + 20, H);
  ctx.closePath();
}

function hillY(x, baseY, amp, freq, phase) {
  return baseY - amp * (Math.sin(x * freq + phase) * 0.6 + Math.sin(x * freq * 2.3 + phase * 1.7) * 0.4);
}

function drawSky(ctx, cam, t) {
  const hz = cam.horizon;
  const g = ctx.createLinearGradient(0, 0, 0, hz + 40);
  g.addColorStop(0, '#6FB6EA');
  g.addColorStop(0.45, '#A9D8F2');
  g.addColorStop(0.8, '#FFE7C2');
  g.addColorStop(1, '#FFD7A6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, hz + 60);

  // sun
  const sunX = W * 0.74 - cam.theta * 260;
  const sunY = hz - 150;
  const sg = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 620);
  sg.addColorStop(0, 'rgba(255,246,214,0.95)');
  sg.addColorStop(0.12, 'rgba(255,236,180,0.55)');
  sg.addColorStop(0.45, 'rgba(255,220,160,0.16)');
  sg.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, W, hz + 60);
  ctx.fillStyle = '#FFF8E1';
  ctx.beginPath();
  ctx.arc(sunX, sunY, 58, 0, Math.PI * 2);
  ctx.fill();

  for (const c of CLOUDS) {
    let x = ((c.x + t * c.v - cam.theta * 0.12) % 1.3 + 1.3) % 1.3;
    cloud(ctx, x * W - 200, c.y * H + (hz - 760) * 0.5, c.k, 0.92);
  }

  // far hills (hazy) with a little orbit parallax
  const p1 = cam.theta * 1.3;
  ctx.fillStyle = '#B9DDC0';
  hillPath(ctx, hz - 6, 54, 0.0042, 1.2 + p1);
  ctx.fill();
  ctx.fillStyle = '#93CC9C';
  hillPath(ctx, hz + 14, 38, 0.0061, 4.0 + p1 * 1.7);
  ctx.fill();

  // storybook trees on the middle hill
  const rnd = mulberry32(77);
  for (let i = 0; i < 9; i++) {
    const bx = ((rnd() * 1.5 - 0.25 - cam.theta * 0.35) * W);
    const size = 22 + rnd() * 26;
    if (bx < -80 || bx > W + 80) continue;
    const by = hillY(bx, hz + 14, 38, 0.0061, 4.0 + p1 * 1.7) + 6;
    ctx.fillStyle = '#6E5A3A';
    ctx.fillRect(bx - 3, by - size * 1.1, 6, size * 1.1);
    ctx.fillStyle = i % 2 ? '#6FB37C' : '#7EBF86';
    ctx.beginPath();
    ctx.arc(bx, by - size * 1.5, size, 0, Math.PI * 2);
    ctx.arc(bx - size * 0.6, by - size * 1.15, size * 0.7, 0, Math.PI * 2);
    ctx.arc(bx + size * 0.6, by - size * 1.15, size * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

let TUFTS = null;
function tufts() {
  if (TUFTS) return TUFTS;
  const rnd = mulberry32(4242);
  TUFTS = [];
  for (let i = 0; i < 2600; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 46;
    TUFTS.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, h: 0.1 + rnd() * 0.16, ph: rnd() * 6.28, tone: rnd() });
  }
  return TUFTS;
}

let PATCHES = null;
function patches() {
  if (PATCHES) return PATCHES;
  const rnd = mulberry32(99);
  PATCHES = [];
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 40;
    PATCHES.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, R: 1.2 + rnd() * 3.2, light: rnd() < 0.5 });
  }
  return PATCHES;
}

function drawGround(ctx, cam, t) {
  const hz = cam.horizon;
  const g = ctx.createLinearGradient(0, hz, 0, H);
  g.addColorStop(0, '#A6D98A');
  g.addColorStop(0.12, '#86CB7C');
  g.addColorStop(0.5, '#5FB36B');
  g.addColorStop(1, '#3E955A');
  ctx.fillStyle = g;
  ctx.fillRect(0, hz + 22, W, H - hz);
  // soft rolling edge so the horizon is not a ruler line
  ctx.fillStyle = '#A6D98A';
  hillPath(ctx, hz + 30, 14, 0.0035, 2.2 + cam.theta * 2.2);
  ctx.fill();
  ctx.fillStyle = g;
  ctx.fillRect(0, hz + 46, W, H - hz);

  // the website moves its look-at point around the garden; gx/gz keep the meadow in step
  const gx = cam.gx || 0;
  const gz = cam.gz || 0;
  for (const p of patches()) {
    const pr = project(cam, p.x - gx, p.z - gz);
    if (!pr || pr.sy > H + 300 || pr.sx < -500 || pr.sx > W + 500) continue;
    const rx = p.R * pr.s;
    const ry = rx * clamp(cam.camH / pr.depth, 0.05, 0.9);
    if (pr.sy - ry < hz + 40) continue;
    ctx.fillStyle = p.light ? 'rgba(190,235,150,0.16)' : 'rgba(40,110,70,0.12)';
    ctx.beginPath();
    ctx.ellipse(pr.sx, pr.sy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.lineCap = 'round';
  for (const tf of tufts()) {
    const pr = project(cam, tf.x - gx, tf.z - gz);
    if (!pr || pr.s < 14 || pr.sy > H + 40 || pr.sy < hz + 50 || pr.sx < -40 || pr.sx > W + 40) continue;
    const h = tf.h * pr.s;
    const sway = Math.sin(t * 1.6 + tf.ph) * h * 0.18;
    ctx.strokeStyle = tf.tone < 0.5 ? 'rgba(52,128,74,0.75)' : 'rgba(150,214,120,0.7)';
    ctx.lineWidth = Math.max(1, pr.s * 0.012);
    ctx.beginPath();
    ctx.moveTo(pr.sx, pr.sy);
    ctx.lineTo(pr.sx + sway - h * 0.25, pr.sy - h * 0.8);
    ctx.moveTo(pr.sx, pr.sy);
    ctx.lineTo(pr.sx + sway, pr.sy - h);
    ctx.moveTo(pr.sx, pr.sy);
    ctx.lineTo(pr.sx + sway + h * 0.28, pr.sy - h * 0.75);
    ctx.stroke();
  }
}

// floating pollen / light motes
function drawMotes(ctx, cam, t, strength = 1) {
  const rnd = mulberry32(31337);
  ctx.save();
  for (let i = 0; i < 46; i++) {
    const bx = rnd() * W;
    const by = cam.horizon - 120 + rnd() * (H - cam.horizon + 100);
    const sp = 0.15 + rnd() * 0.4;
    const ph = rnd() * 6.28;
    const x = (bx + t * 26 * sp + Math.sin(t * sp + ph) * 30 + W) % W;
    const y = by + Math.sin(t * 0.7 * sp + ph * 2) * 40 - t * 6 * sp;
    const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.3 + ph * 3));
    const r = 2 + rnd() * 4;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    gr.addColorStop(0, `rgba(255,250,215,${0.75 * tw * strength})`);
    gr.addColorStop(1, 'rgba(255,250,215,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
  }
  ctx.restore();
}

function drawLightAndVignette(ctx, cam) {
  const sunX = W * 0.74 - cam.theta * 260;
  const sunY = cam.horizon - 150;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const lg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 1500);
  lg.addColorStop(0, 'rgba(255,214,150,0.30)');
  lg.addColorStop(0.5, 'rgba(255,200,140,0.10)');
  lg.addColorStop(1, 'rgba(255,200,140,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const vg = ctx.createRadialGradient(W / 2, H * 0.52, H * 0.42, W / 2, H * 0.52, H * 0.82);
  vg.addColorStop(0, 'rgba(20,40,30,0)');
  vg.addColorStop(1, 'rgba(20,40,30,0.34)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// colour grade for a different time of day (the scene itself is drawn in morning colours)
function drawGrade(ctx, mood) {
  if (mood !== 'evening') return;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#7C86C9');
  g.addColorStop(0.3, '#F2A7A0');
  g.addColorStop(0.42, '#FFC79A');
  g.addColorStop(0.6, '#C9B48E');
  g.addColorStop(1, '#8E9A86');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'screen';
  const w = ctx.createRadialGradient(W * 0.72, H * 0.3, 0, W * 0.72, H * 0.3, H * 0.6);
  w.addColorStop(0, 'rgba(255,170,110,0.38)');
  w.addColorStop(1, 'rgba(255,170,110,0)');
  ctx.fillStyle = w;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---------- overlays ----------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** handwritten name tag floating above a flower head */
function drawTag(ctx, hx, hy, r, text, k = 1, size = 58, sub = null) {
  if (k <= 0.01) return;
  const pop = easeOutBack(clamp(k));
  ctx.save();
  ctx.globalAlpha *= clamp(k * 1.6);
  ctx.font = `${size}px ${FONT.tag}`;
  let tw = ctx.measureText(text).width;
  // the small second line (species, planter) never drops below a readable size
  const subSize = Math.max(24, Math.round(size * 0.46));
  if (sub) {
    ctx.font = `${subSize}px ${FONT.ui}`;
    tw = Math.max(tw, ctx.measureText(sub).width);
    ctx.font = `${size}px ${FONT.tag}`;
  }
  const padX = size * 0.42;
  const bw = tw + padX * 2;
  const bh = sub ? size * 1.24 + subSize * 1.5 : size * 1.28;
  const gap = r + size * 0.55;
  const cx = clamp(hx, bw / 2 + 30, W - bw / 2 - 30);
  const cy = hy - gap - bh / 2;
  ctx.translate(cx, cy + bh / 2 + gap * 0.5);
  ctx.scale(pop, pop);
  ctx.translate(-cx, -(cy + bh / 2 + gap * 0.5));
  // string
  ctx.strokeStyle = 'rgba(90,70,50,0.75)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(hx, hy - r * 0.6);
  ctx.lineTo(cx, cy + bh / 2);
  ctx.stroke();
  // card
  ctx.shadowColor = 'rgba(30,40,30,0.28)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#FFF9EC';
  roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, bh * 0.36);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#4A3426';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, sub ? cy - bh / 2 + size * 0.66 : cy + size * 0.02);
  if (sub) {
    ctx.font = `${subSize}px ${FONT.ui}`;
    ctx.fillStyle = '#8A6B4A';
    ctx.fillText(sub, cx, cy + bh / 2 - subSize * 1.0);
  }
  ctx.restore();
}

function wrapLines(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** big spoken-word caption, centred in the safe area */
function drawCaption(ctx, text, k, y = 1420, size = 84) {
  if (!text || k <= 0.01) return;
  ctx.save();
  ctx.font = `${size}px ${FONT.caption}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapLines(ctx, text, 880);
  const lh = size * 1.14;
  const pop = 0.86 + 0.14 * easeOutBack(clamp(k));
  ctx.translate(W / 2, y);
  ctx.scale(pop, pop);
  ctx.globalAlpha *= clamp(k * 2.2);
  ctx.lineJoin = 'round';
  lines.forEach((ln, i) => {
    const yy = (i - (lines.length - 1) / 2) * lh;
    ctx.strokeStyle = 'rgba(24,52,36,0.92)';
    ctx.lineWidth = size * 0.2;
    ctx.strokeText(ln, 0, yy);
    ctx.fillStyle = '#FFFDF4';
    ctx.fillText(ln, 0, yy);
  });
  ctx.restore();
}

function sprout(ctx, x, y, s, color = '#3E9A5B') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s * 0.14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - s * 0.62);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x - s * 0.25, y - s * 0.8, s * 0.3, s * 0.15, 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + s * 0.25, y - s * 0.8, s * 0.3, s * 0.15, -0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** top badge: "DAY 1 · 1 flower" */
function drawBadge(ctx, day, countText, k = 1) {
  if (k <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= clamp(k);
  const y = 250;
  ctx.font = `62px ${FONT.title}`;
  const dayText = `DAY ${day}`;
  const w1 = ctx.measureText(dayText).width;
  ctx.font = `44px ${FONT.ui}`;
  const w2 = countText ? ctx.measureText(countText).width : 0;
  const padX = 38;
  const icon = 56;
  const gapMid = countText ? 34 : 0;
  const bw = padX + icon + 14 + w1 + gapMid + w2 + padX;
  const bh = 104;
  const x = (W - bw) / 2;
  ctx.translate(W / 2, y);
  const pop = 0.9 + 0.1 * easeOutBack(clamp(k));
  ctx.scale(pop, pop);
  ctx.translate(-W / 2, -y);
  ctx.shadowColor = 'rgba(20,40,30,0.25)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = 'rgba(255,249,236,0.96)';
  roundRect(ctx, x, y - bh / 2, bw, bh, bh / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  sprout(ctx, x + padX + icon / 2, y + 26, 56);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#2F5D3A';
  ctx.font = `62px ${FONT.title}`;
  ctx.fillText(dayText, x + padX + icon + 14, y + 3);
  if (countText) {
    ctx.fillStyle = 'rgba(47,93,58,0.35)';
    ctx.fillRect(x + padX + icon + 14 + w1 + gapMid / 2 - 2, y - 24, 4, 48);
    ctx.fillStyle = '#5B7A52';
    ctx.font = `44px ${FONT.ui}`;
    ctx.fillText(countText, x + padX + icon + 14 + w1 + gapMid, y + 3);
  }
  ctx.restore();
}

/** a planting spot that is still waiting for its flower */
function drawSeedSpot(ctx, pr, k, t) {
  if (k <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= clamp(k);
  const rx = pr.s * 0.2;
  const ry = rx * 0.34;
  ctx.fillStyle = 'rgba(92,64,40,0.85)';
  ctx.beginPath();
  ctx.ellipse(pr.sx, pr.sy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(128,92,58,0.9)';
  ctx.beginPath();
  ctx.ellipse(pr.sx - rx * 0.1, pr.sy - ry * 0.25, rx * 0.72, ry * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  const wob = Math.sin(t * 2.2 + pr.sx) * 0.08;
  ctx.translate(pr.sx, pr.sy - ry * 0.3);
  ctx.rotate(wob);
  sprout(ctx, 0, 0, pr.s * 0.22 * easeOutBack(clamp(k)), '#4FAE68');
  ctx.restore();
}

{ roundRect, smooth, lerp, seg, rgba, hashString };

// Procedural flowers. A flower is fully determined by its seed string, so the same
// commenter always gets the same flower (video, website, prints).
const LABEL = { lilyvalley: 'lily of the valley' };
function speciesLabel(type) {
  return LABEL[type] || type;
}

function ellipse(ctx, cx, cy, rx, ry, rot) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
}

function leaf(ctx, x, y, len, ang, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -len * 0.38, len, 0);
  ctx.quadraticCurveTo(len * 0.5, len * 0.22, 0, 0);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawHead(ctx, sp, r, t) {
  const n = sp.petals;
  switch (sp.type) {
    case 'sunflower': {
      for (let layer = 0; layer < 2; layer++) {
        ctx.fillStyle = layer === 0 ? sp.petalDark : sp.petal;
        const off = layer * (Math.PI / n);
        for (let i = 0; i < n; i++) {
          const a = sp.rot + off + (i / n) * Math.PI * 2;
          ctx.save();
          ctx.rotate(a);
          ctx.beginPath();
          ctx.moveTo(r * 0.3, -r * 0.13);
          ctx.quadraticCurveTo(r * 0.75, -r * 0.2, r * (layer ? 1.0 : 1.08), 0);
          ctx.quadraticCurveTo(r * 0.75, r * 0.2, r * 0.3, r * 0.13);
          ctx.fill();
          ctx.restore();
        }
      }
      ellipse(ctx, 0, 0, r * 0.46, r * 0.46, 0);
      ctx.fillStyle = sp.center;
      ctx.fill();
      ellipse(ctx, 0, 0, r * 0.3, r * 0.3, 0);
      ctx.fillStyle = '#7A4E2A';
      ctx.fill();
      ellipse(ctx, -r * 0.08, -r * 0.08, r * 0.12, r * 0.12, 0);
      ctx.fillStyle = 'rgba(255,220,150,0.35)';
      ctx.fill();
      break;
    }
    case 'tulip': {
      // side view cup
      ctx.fillStyle = sp.petalDark;
      ctx.beginPath();
      ctx.moveTo(-r * 0.62, -r * 0.1);
      ctx.bezierCurveTo(-r * 0.9, -r * 1.0, -r * 0.3, -r * 1.25, -r * 0.18, -r * 1.3);
      ctx.bezierCurveTo(0, -r * 0.8, 0, -r * 0.3, 0, r * 0.25);
      ctx.bezierCurveTo(-r * 0.35, r * 0.3, -r * 0.6, r * 0.15, -r * 0.62, -r * 0.1);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r * 0.62, -r * 0.1);
      ctx.bezierCurveTo(r * 0.9, -r * 1.0, r * 0.3, -r * 1.25, r * 0.18, -r * 1.3);
      ctx.bezierCurveTo(0, -r * 0.8, 0, -r * 0.3, 0, r * 0.25);
      ctx.bezierCurveTo(r * 0.35, r * 0.3, r * 0.6, r * 0.15, r * 0.62, -r * 0.1);
      ctx.fill();
      ctx.fillStyle = sp.petal;
      ctx.beginPath();
      ctx.moveTo(0, r * 0.28);
      ctx.bezierCurveTo(-r * 0.55, r * 0.1, -r * 0.45, -r * 1.0, 0, -r * 1.42);
      ctx.bezierCurveTo(r * 0.45, -r * 1.0, r * 0.55, r * 0.1, 0, r * 0.28);
      ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.18);
      ctx.beginPath();
      ctx.moveTo(-r * 0.05, r * 0.1);
      ctx.bezierCurveTo(-r * 0.3, -r * 0.2, -r * 0.25, -r * 0.9, 0, -r * 1.25);
      ctx.bezierCurveTo(-r * 0.1, -r * 0.8, -r * 0.05, -r * 0.3, -r * 0.05, r * 0.1);
      ctx.fill();
      break;
    }
    case 'poppy': {
      for (let i = 0; i < n; i++) {
        const a = sp.rot + (i / n) * Math.PI * 2;
        ctx.fillStyle = i % 2 ? sp.petal : sp.petalDark;
        ellipse(ctx, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.62, r * 0.55, a);
        ctx.fill();
      }
      ctx.fillStyle = rgba('#ffffff', 0.12);
      ellipse(ctx, -r * 0.2, -r * 0.25, r * 0.5, r * 0.4, 0);
      ctx.fill();
      ellipse(ctx, 0, 0, r * 0.26, r * 0.26, 0);
      ctx.fillStyle = sp.center;
      ctx.fill();
      ctx.fillStyle = '#F7D65A';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ellipse(ctx, Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, r * 0.045, r * 0.045, 0);
        ctx.fill();
      }
      break;
    }
    case 'rose': {
      // outer petals: a soft scalloped silhouette
      ctx.fillStyle = sp.petalDark;
      for (let i = 0; i < 5; i++) {
        const a = sp.rot + (i / 5) * Math.PI * 2;
        ellipse(ctx, Math.cos(a) * r * 0.46, Math.sin(a) * r * 0.46, r * 0.6, r * 0.54, a);
        ctx.fill();
      }
      // body of the bloom
      ctx.fillStyle = sp.petal;
      ellipse(ctx, 0, 0, r * 0.84, r * 0.84, 0);
      ctx.fill();
      // petal edges wrapping around the heart: the swirl that makes it a rose
      ctx.lineCap = 'round';
      const rings = [[0.7, 1.25, 0.0], [0.56, 1.3, 2.3], [0.42, 1.35, 4.5], [0.29, 1.4, 0.9], [0.17, 1.5, 3.1]];
      for (const [rr, span, off] of rings) {
        const a0 = sp.rot + off;
        ctx.strokeStyle = sp.petalDark;
        ctx.lineWidth = r * 0.085;
        ctx.beginPath();
        ctx.arc(0, 0, r * rr, a0, a0 + Math.PI * span);
        ctx.stroke();
        ctx.strokeStyle = sp.petalLight;
        ctx.lineWidth = r * 0.04;
        ctx.beginPath();
        ctx.arc(0, 0, r * (rr - 0.055), a0 + 0.25, a0 + Math.PI * span - 0.25);
        ctx.stroke();
      }
      // closed bud in the middle
      ctx.fillStyle = sp.petalDark;
      ellipse(ctx, 0, 0, r * 0.09, r * 0.09, 0);
      ctx.fill();
      break;
    }
    case 'lupine': {
      // handled in drawFlower (spike along the stem)
      break;
    }
    case 'cosmos': {
      for (let i = 0; i < 8; i++) {
        const a = sp.rot + (i / 8) * Math.PI * 2;
        ctx.save();
        ctx.rotate(a);
        ctx.fillStyle = i % 2 ? sp.petal : sp.petalDark;
        ctx.beginPath();
        ctx.moveTo(r * 0.1, 0);
        ctx.bezierCurveTo(r * 0.35, -r * 0.36, r * 0.85, -r * 0.4, r * 1.0, -r * 0.24);
        ctx.lineTo(r * 0.9, -r * 0.09);
        ctx.lineTo(r * 1.04, 0);
        ctx.lineTo(r * 0.9, r * 0.09);
        ctx.lineTo(r * 1.0, r * 0.24);
        ctx.bezierCurveTo(r * 0.85, r * 0.4, r * 0.35, r * 0.36, r * 0.1, 0);
        ctx.fill();
        // fine line down the petal
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = Math.max(1, r * 0.025);
        ctx.beginPath();
        ctx.moveTo(r * 0.3, 0);
        ctx.lineTo(r * 0.82, 0);
        ctx.stroke();
        ctx.restore();
      }
      ellipse(ctx, 0, 0, r * 0.22, r * 0.22, 0);
      ctx.fillStyle = sp.center;
      ctx.fill();
      ellipse(ctx, -r * 0.05, -r * 0.06, r * 0.09, r * 0.09, 0);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fill();
      break;
    }
    case 'daisy':
    default: {
      const wide = 0.19;
      for (let layer = 0; layer < 2; layer++) {
        ctx.fillStyle = layer === 0 ? sp.petalDark : sp.petal;
        const off = layer === 0 ? Math.PI / n : 0;
        for (let i = 0; i < n; i++) {
          const a = sp.rot + off + (i / n) * Math.PI * 2;
          ellipse(ctx, Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58, r * 0.46, r * wide, a);
          ctx.fill();
        }
      }
      ellipse(ctx, 0, 0, r * 0.3, r * 0.3, 0);
      ctx.fillStyle = sp.center;
      ctx.fill();
      ellipse(ctx, -r * 0.07, -r * 0.08, r * 0.13, r * 0.13, 0);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fill();
    }
  }
}

// Lavender: a small bush of thin stems, each ending in a slim purple spike.
function drawLavender(ctx, sp, x, y, s, g, stemH, bend, sway) {
  const lg = easeOutCubic(seg(g, 0.15, 0.7));
  const spikeG = seg(g, 0.45, 1);
  // narrow grey-green leaves at the base
  if (lg > 0) {
    [[-0.95, 0.3], [-0.5, 0.36], [0.5, 0.36], [0.95, 0.3]].forEach(([ang, len], i) => {
      ctx.strokeStyle = i % 2 ? '#7FA98A' : '#6E9A7C';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, s * 0.035);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.sin(ang) * s * len * 0.6 * lg, y - s * len * 0.75 * lg, x + Math.sin(ang) * s * len * lg, y - s * len * 0.9 * lg);
      ctx.stroke();
    });
  }
  const stems = [[-0.5, 0.8], [0.52, 0.84], [-0.24, 0.93], [0.27, 0.9], [0.02, 1.0]];
  let top = y - stemH;
  stems.forEach(([fan, k], si) => {
    const H = stemH * k;
    const tx = x + Math.sin(fan) * H * 0.62 + bend * k;
    const ty = y - H;
    const mx = x + Math.sin(fan) * H * 0.14 + bend * 0.15;
    const my = y - H * 0.55;
    ctx.strokeStyle = sp.stem;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.2, s * 0.022);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(mx, my, tx, ty);
    ctx.stroke();
    top = Math.min(top, ty);
    // the spike: small buds along the upper third, getting smaller towards the tip
    const count = 9;
    for (let i = 0; i < count; i++) {
      const u = 0.66 + (i / (count - 1)) * 0.36;
      const kk = clamp(spikeG * count - (count - 1 - i) * 0.5);
      if (kk <= 0) continue;
      const bx = (1 - u) * (1 - u) * x + 2 * (1 - u) * u * mx + u * u * tx;
      const by = (1 - u) * (1 - u) * y + 2 * (1 - u) * u * my + u * u * ty;
      const w = s * 0.034 * (1.1 - (i / count) * 0.5) * easeOutBack(kk);
      ctx.fillStyle = (i + si) % 2 ? sp.petal : sp.petalDark;
      ellipse(ctx, bx - w * 0.7, by, w, w * 0.85, 0);
      ctx.fill();
      ellipse(ctx, bx + w * 0.7, by - w * 0.35, w, w * 0.85, 0);
      ctx.fill();
      if (i === count - 1) {
        ctx.fillStyle = sp.petalLight;
        ellipse(ctx, bx, by - w * 0.9, w * 0.7, w * 0.9, 0);
        ctx.fill();
      }
    }
  });
  return { hx: x + bend, hy: y - stemH * 0.9, r: Math.max(s * 0.2 * seg(g, 0.5, 1), s * 0.1) };
}

// Lily of the valley: two broad leaves and an arching stem with a row of small white bells.
function drawLilyValley(ctx, sp, x, y, s, g, stemH, bend, sway) {
  const d = sp.leafSide;
  const lg = easeOutCubic(seg(g, 0.1, 0.7));
  if (lg > 0) {
    [[-d, 0.95, '#3F9160'], [-d * 0.25, 0.8, '#4FA36E']].forEach(([side, len, col]) => {
      const L = stemH * len * lg;
      const tipX = x + side * s * 0.3 + bend * 0.3;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + side * s * 0.42, y - L * 0.3, x + side * s * 0.5, y - L * 0.8, tipX, y - L);
      ctx.bezierCurveTo(x + side * s * 0.16, y - L * 0.75, x + side * s * 0.02, y - L * 0.3, x, y);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = Math.max(1, s * 0.012);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + side * s * 0.3, y - L * 0.55, tipX, y - L * 0.97);
      ctx.stroke();
    });
  }
  // arching stem: up, then over to the side
  const p0 = [x, y];
  const p1 = [x + bend * 0.2, y - stemH * 0.75];
  const p2 = [x + d * s * 0.1 + bend * 0.6, y - stemH * 1.16];
  const p3 = [x + d * s * 0.62 + bend, y - stemH * 0.74];
  const bz = (u) => {
    const a = (1 - u) ** 3;
    const b = 3 * (1 - u) ** 2 * u;
    const c = 3 * (1 - u) * u * u;
    const e = u ** 3;
    return [a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]];
  };
  ctx.strokeStyle = sp.stem;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.3, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
  ctx.stroke();
  // bells hang from the arch, the biggest lowest
  const bellG = seg(g, 0.5, 1);
  const count = 6;
  for (let i = 0; i < count; i++) {
    const kk = clamp(bellG * count - i * 0.6);
    if (kk <= 0) continue;
    const u = 0.44 + (i / (count - 1)) * 0.56;
    const [bx, by] = bz(u);
    const w = s * 0.074 * (0.78 + (i / count) * 0.36) * easeOutBack(kk);
    const drop = w * 0.9;
    const swing = sway * w * 6;
    ctx.strokeStyle = sp.stem;
    ctx.lineWidth = Math.max(1, s * 0.014);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + swing * 0.5, by + drop);
    ctx.stroke();
    const cx = bx + swing;
    const cy = by + drop;
    // bell: dome with a scalloped rim
    ctx.fillStyle = sp.petal;
    ctx.beginPath();
    ctx.moveTo(cx - w, cy + w * 1.05);
    ctx.bezierCurveTo(cx - w * 1.15, cy + w * 0.1, cx - w * 0.7, cy - w * 0.35, cx, cy - w * 0.35);
    ctx.bezierCurveTo(cx + w * 0.7, cy - w * 0.35, cx + w * 1.15, cy + w * 0.1, cx + w, cy + w * 1.05);
    ctx.quadraticCurveTo(cx + w * 0.66, cy + w * 0.78, cx + w * 0.33, cy + w * 1.08);
    ctx.quadraticCurveTo(cx, cy + w * 0.8, cx - w * 0.33, cy + w * 1.08);
    ctx.quadraticCurveTo(cx - w * 0.66, cy + w * 0.78, cx - w, cy + w * 1.05);
    ctx.fill();
    ctx.strokeStyle = 'rgba(96,138,112,0.55)';
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.stroke();
    ctx.fillStyle = 'rgba(150,185,160,0.35)';
    ellipse(ctx, cx + w * 0.35, cy + w * 0.35, w * 0.3, w * 0.5, 0.2);
    ctx.fill();
  }
  const [mx, my] = bz(0.72);
  return { hx: mx, hy: my - s * 0.02, r: Math.max(s * 0.2 * seg(g, 0.5, 1), s * 0.1) };
}

/**
 * Draw one flower.
 * x,y  = screen position of the stem base
 * s    = pixels per world unit at that depth
 * g    = growth 0..1
 * t    = time in seconds (for wind sway)
 * opts.alpha, opts.ghost (outline look), opts.wind
 * returns the screen position of the flower head (for tags / particles)
 */
function drawFlower(ctx, sp, x, y, s, g, t, opts = {}) {
  const alpha = opts.alpha ?? 1;
  const wind = opts.wind ?? 1;
  if (g <= 0.001 || alpha <= 0.001) return { hx: x, hy: y, r: 0 };
  const stemH = sp.height * s * easeOutCubic(seg(g, 0, 0.72));
  const sway = (Math.sin(t * 1.25 + sp.phase) * 0.055 + Math.sin(t * 0.61 + sp.phase * 2.3) * 0.03) * wind;
  const bend = (sway + sp.lean) * stemH;
  const hx = x + bend;
  const hy = y - stemH;
  const headK = easeOutBack(seg(g, 0.5, 1));
  const r = sp.head * s * headK;

  ctx.save();
  ctx.globalAlpha *= alpha;

  // contact shadow
  ctx.fillStyle = 'rgba(20,60,35,0.22)';
  ellipse(ctx, x + s * 0.05, y + s * 0.01, s * 0.2 * clamp(g * 1.5), s * 0.05 * clamp(g * 1.5), 0);
  ctx.fill();

  // tiny LOD: far away flowers are a stroke and a dot
  if (s < 26) {
    ctx.strokeStyle = sp.stem;
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    if (r > 0.3) {
      ctx.fillStyle = sp.petal;
      ellipse(ctx, hx, hy, Math.max(1.2, r), Math.max(1.2, r), 0);
      ctx.fill();
    }
    ctx.restore();
    return { hx, hy, r };
  }

  if (sp.type === 'lavender' || sp.type === 'lilyvalley') {
    const head = sp.type === 'lavender' ? drawLavender(ctx, sp, x, y, s, g, stemH, bend, sway) : drawLilyValley(ctx, sp, x, y, s, g, stemH, bend, sway);
    ctx.restore();
    return head;
  }

  // stem
  ctx.strokeStyle = sp.stem;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, s * 0.045);
  const cxp = x + bend * 0.15;
  const cyp = y - stemH * 0.55;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(cxp, cyp, hx, hy);
  ctx.stroke();

  // species details on the stem
  const lgS = easeOutCubic(seg(g, 0.2, 0.75));
  const bz = (u) => [(1 - u) * (1 - u) * x + 2 * (1 - u) * u * cxp + u * u * hx, (1 - u) * (1 - u) * y + 2 * (1 - u) * u * cyp + u * u * hy];
  if (sp.type === 'rose' && lgS > 0) {
    ctx.fillStyle = sp.stem;
    [[0.22, 1], [0.44, -1], [0.66, 1]].forEach(([u, side]) => {
      const [tx, ty] = bz(u);
      const w = s * 0.045 * lgS;
      ctx.beginPath();
      ctx.moveTo(tx, ty - w * 0.9);
      ctx.lineTo(tx + side * w * 1.9, ty - w * 0.2);
      ctx.lineTo(tx, ty + w * 0.9);
      ctx.fill();
    });
  }
  if (sp.type === 'tulip' && lgS > 0) {
    // long blade leaves rising from the ground
    [[-1, 0.62, '#3F9160'], [1, 0.5, '#4FA36E']].forEach(([side, len, col]) => {
      const L = stemH * len * lgS;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + side * s * 0.2, y - L * 0.35, x + side * s * 0.24, y - L * 0.8, x + side * s * 0.13 + bend * 0.3, y - L);
      ctx.bezierCurveTo(x + side * s * 0.1, y - L * 0.7, x + side * s * 0.03, y - L * 0.3, x, y);
      ctx.fill();
    });
  }

  // leaves
  const lg = sp.type === 'tulip' ? 0 : easeOutCubic(seg(g, 0.2, 0.75));
  if (lg > 0) {
    const leafLen = s * 0.3 * lg;
    const px = (u) => (1 - u) * (1 - u) * x + 2 * (1 - u) * u * cxp + u * u * hx;
    const py = (u) => (1 - u) * (1 - u) * y + 2 * (1 - u) * u * cyp + u * u * hy;
    const d = sp.leafSide;
    leaf(ctx, px(0.3), py(0.3), leafLen, d > 0 ? -0.5 + sway : Math.PI + 0.5 + sway, mixColor(sp.stem, '#8fd48f', 0.25));
    if (sp.twoLeaves) leaf(ctx, px(0.5), py(0.5), leafLen * 0.8, d > 0 ? Math.PI + 0.45 + sway : -0.45 + sway, mixColor(sp.stem, '#8fd48f', 0.12));
  }

  // head
  if (sp.type === 'lupine') {
    const spikeG = seg(g, 0.45, 1);
    const count = 13;
    for (let i = 0; i < count; i++) {
      const u = 0.5 + (i / (count - 1)) * 0.5; // along the upper half of the stem
      const k = clamp(spikeG * count - (count - 1 - i) * 0.6);
      if (k <= 0) continue;
      const bx = (1 - u) * (1 - u) * x + 2 * (1 - u) * u * cxp + u * u * hx;
      const by = (1 - u) * (1 - u) * y + 2 * (1 - u) * u * cyp + u * u * hy;
      const w = s * 0.11 * (1.15 - (i / count) * 0.75) * easeOutBack(k);
      ctx.fillStyle = i % 2 ? sp.petal : sp.petalDark;
      ellipse(ctx, bx - w * 0.9, by, w, w * 0.8, 0);
      ctx.fill();
      ellipse(ctx, bx + w * 0.9, by - w * 0.3, w, w * 0.8, 0);
      ctx.fill();
      ctx.fillStyle = sp.petalLight;
      ellipse(ctx, bx, by - w * 0.2, w * 0.75, w * 0.65, 0);
      ctx.fill();
    }
  } else if (r > 0.2) {
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate((sway + sp.lean) * 1.4);
    drawHead(ctx, sp, r, t);
    ctx.restore();
  }
  ctx.restore();
  return { hx, hy: sp.type === 'tulip' ? hy - r * 0.6 : hy, r: Math.max(r, s * 0.1) };
}

function petalColor(sp) {
  return sp.petal;
}

return { setSize, FONT, project, gardenPos, drawSky, drawGround, drawMotes, drawLightAndVignette, drawTag, drawFlower, speciesLabel };
})();
