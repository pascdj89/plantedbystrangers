// Planted by Strangers: the page around the garden. Data comes from data.js (PBS_GARDEN,
// PBS_EPISODES), written by the daily run. Names, handles and reasons are comment text:
// they are only ever set as textContent or drawn on the canvas, never as HTML.
(() => {
  const flowers = (window.PBS_GARDEN && window.PBS_GARDEN.flowers) || [];
  // on the live site every flower has its own address (/flower/7); in a preview or opened
  // from a file the page falls back to #flower-7
  const SITE = window.PBS_SITE || {};
  const TITLE = document.title;
  const episodes = window.PBS_EPISODES || {};
  const CHANNEL = 'https://www.youtube.com/@plantedbystrangers';
  const $ = (id) => document.getElementById(id);
  const canvas = $('garden');
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const placed = PBSView.place(flowers);
  const byN = new Map(placed.map((p) => [p.f.n, p]));
  const R = PBSView.radius(flowers.length);
  const HOME_D = R * 1.15 + clamp(3.6 + flowers.length / 6, 4.6, 9);
  const MIN_D = 3.4;
  const MAX_D = HOME_D * 2;

  // cur eases towards goal every frame
  let homeD = HOME_D * 0.86; // set in resize(): an upright screen needs more distance to fit the garden
  const goal = { theta: -0.3, D: homeD, tx: 0, tz: 0, lift: 0.35 };
  const cur = { theta: -0.75, D: HOME_D * 1.25, tx: 0, tz: 0, lift: 0.5 };
  let selected = null;
  let selK = 0;
  let hover = null;
  let heads = [];
  let LW = 1080, LH = 1920, cssW = 0, cssH = 0;
  let lastTouch = 0; // time of the visitor's last own movement, for the idle drift
  let dirty = true;

  function resize() {
    const r = canvas.getBoundingClientRect();
    cssW = Math.max(1, r.width);
    cssH = Math.max(1, r.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    // the engine draws in video units: 1080 wide when upright, 1300 high when lying
    if (cssH >= cssW) { LW = 1080; LH = (1080 * cssH) / cssW; } else { LH = 1300; LW = (1300 * cssW) / cssH; }
    const was = homeD;
    homeD = HOME_D * (cssH >= cssW ? 1.1 : 0.86);
    if (selected == null && Math.abs(goal.D - was) < 0.01) goal.D = homeD;
    dirty = true;
  }

  function topInset() {
    return (150 * LH) / cssH; // keep small tags out from under the title
  }

  let t0 = performance.now();
  let prev = t0;
  function frame(now) {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    const t = reduced ? 2 : (now - t0) / 1000;
    if (!reduced && selected == null && !drag && now - lastTouch > 6000) goal.theta += dt * 0.035;
    const k = reduced ? 1 : 1 - Math.pow(0.0015, dt);
    let moving = false;
    for (const key of ['theta', 'D', 'tx', 'tz', 'lift']) {
      const d = goal[key] - cur[key];
      if (Math.abs(d) > 0.0005) { cur[key] += d * k; moving = true; } else cur[key] = goal[key];
    }
    const selGoal = selected == null ? 0 : 1;
    if (Math.abs(selGoal - selK) > 0.01) { selK += (selGoal - selK) * (reduced ? 1 : Math.min(1, dt * 6)); moving = true; } else selK = selGoal;
    if (!reduced || moving || dirty) {
      ctx.setTransform(canvas.width / LW, 0, 0, canvas.height / LH, 0, 0);
      heads = PBSView.draw(ctx, { LW, LH, t, cam: cur, placed, selected, selK, hover, showTags: true, topInset: topInset() });
      dirty = false;
    }
    requestAnimationFrame(frame);
  }

  // ---------- choosing a flower ----------
  function meta(f) {
    const parts = ['Flower ' + f.n, PBS.speciesLabel(f.spec.type), 'Day ' + f.day];
    return parts.join(' · ') + (f.by ? ' · planted by ' + f.by : '');
  }

  function select(n, fromHash) {
    const p = byN.get(n);
    if (!p) return;
    selected = n;
    goal.tx = p.x; goal.tz = p.z; goal.D = 5.2; goal.lift = 0.3;
    // walk round to the flower's side of the garden, so the rest stands behind it and not in front
    if (Math.hypot(p.x, p.z) > 0.3) {
      const th = Math.atan2(-p.x, -p.z);
      goal.theta = th + Math.round((goal.theta - th) / (Math.PI * 2)) * Math.PI * 2;
    }
    $('cName').textContent = p.f.name || 'Flower ' + p.f.n;
    $('cMeta').textContent = meta(p.f);
    const why = $('cWhy');
    why.hidden = !p.f.reason;
    why.textContent = p.f.reason ? '“' + p.f.reason + '”' : '';
    const vid = episodes[String(p.f.day)];
    const w = $('cWatch');
    w.hidden = !vid;
    if (vid) { w.href = 'https://www.youtube.com/shorts/' + vid; w.textContent = 'Watch it bloom (Day ' + p.f.day + ')'; }
    $('cCopied').hidden = true;
    $('card').hidden = false;
    document.body.classList.add('has-card');
    $('hint').classList.add('gone');
    if (!fromHash) setLoc(n);
    if (SITE.paths) document.title = (p.f.name || 'Flower ' + p.f.n) + ' · ' + TITLE;
    dirty = true;
  }

  function deselect(keepHash) {
    if (selected == null) return;
    selected = null;
    goal.tx = 0; goal.tz = 0; goal.D = homeD; goal.lift = 0.35;
    $('card').hidden = true;
    document.body.classList.remove('has-card');
    if (!keepHash) setLoc(null);
    document.title = TITLE;
    dirty = true;
  }

  function setLoc(n) {
    try {
      if (SITE.paths) {
        const to = n ? '/flower/' + n : '/';
        // pushState, so the back button walks back through the flowers and each one counts as a page view
        if (location.pathname !== to) history.pushState(null, '', to);
      } else history.replaceState(null, '', n ? '#flower-' + n : location.pathname + location.search);
    } catch (e) {
      try { location.hash = n ? 'flower-' + n : ''; } catch (e2) { /* the page works without it */ }
    }
  }

  function fromLoc() {
    const m = (SITE.paths && /^\/flower\/(\d+)\/?$/.exec(location.pathname)) || /^#flower-(\d+)$/.exec(location.hash || '');
    if (m && byN.has(+m[1])) select(+m[1], true);
    else {
      if (selected != null) deselect(true);
      // an address for a flower that does not exist shows the whole garden
      if (SITE.paths && /^\/flower\//.test(location.pathname)) { try { history.replaceState(null, '', '/'); } catch (e) { /* ignore */ } }
    }
  }

  // ---------- pointer: drag to walk round, pinch or wheel to zoom, tap to choose ----------
  const pts = new Map();
  let drag = null;
  function local(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / cssW) * LW, y: ((e.clientY - r.top) / cssH) * LH };
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastTouch = performance.now();
    if (pts.size === 1) {
      drag = { x: e.clientX, y: e.clientY, theta: goal.theta, lift: goal.lift, moved: 0 };
      canvas.classList.add('grabbing');
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y), D: goal.D, moved: 99 };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag && drag.pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      goal.D = clamp((drag.D * drag.pinch) / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), MIN_D, MAX_D);
      lastTouch = performance.now();
    } else if (drag && !drag.pinch && pts.size === 1) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      if (drag.moved > 6) {
        goal.theta = drag.theta - (dx / cssW) * 3.2;
        goal.lift = clamp(drag.lift + (dy / cssH) * 1.6, 0, 1);
        $('hint').classList.add('gone');
        lastTouch = performance.now();
      }
    } else if (e.pointerType === 'mouse') {
      const p = local(e);
      const n = PBSView.hit(heads, p.x, p.y);
      if (n !== hover) { hover = n; dirty = true; canvas.classList.toggle('pointing', n != null); }
    }
  });
  function up(e) {
    const was = drag;
    pts.delete(e.pointerId);
    if (pts.size === 0) {
      drag = null;
      canvas.classList.remove('grabbing');
      if (was && !was.pinch && was.moved <= 6 && e.type === 'pointerup') {
        const p = local(e);
        const n = PBSView.hit(heads, p.x, p.y);
        if (n != null) select(n); else deselect();
      }
    } else if (pts.size === 1) {
      const [a] = [...pts.values()];
      drag = { x: a.x, y: a.y, theta: goal.theta, lift: goal.lift, moved: 99 };
    }
  }
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    goal.D = clamp(goal.D * Math.exp(e.deltaY * 0.0012), MIN_D, MAX_D);
    lastTouch = performance.now();
    $('hint').classList.add('gone');
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: ['theta', 0.25], ArrowRight: ['theta', -0.25], ArrowUp: ['lift', 0.15], ArrowDown: ['lift', -0.15] }[e.key];
    if (step) { goal[step[0]] += step[1]; goal.lift = clamp(goal.lift, 0, 1); e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') goal.D = clamp(goal.D * 0.85, MIN_D, MAX_D);
    else if (e.key === '-') goal.D = clamp(goal.D / 0.85, MIN_D, MAX_D);
    else return;
    lastTouch = performance.now();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { deselect(); hideHits(); }
  });

  // ---------- search ----------
  const q = $('q');
  const hits = $('hits');
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '');
  function row(f, onPick) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const name = document.createElement('b');
    name.textContent = f.name || 'Flower ' + f.n;
    const s = document.createElement('small');
    s.textContent = PBS.speciesLabel(f.spec.type) + ' · Day ' + f.day + (f.by ? ' · ' + f.by : '');
    b.append(name, s);
    b.addEventListener('click', () => onPick(f));
    li.append(b);
    return li;
  }
  function hideHits() { hits.hidden = true; hits.replaceChildren(); }
  function search() {
    const s = norm(q.value.trim().replace(/^@/, ''));
    if (!s) return hideHits();
    const found = flowers.filter((f) => norm(f.name).includes(s) || norm(String(f.by || '').replace(/^@/, '')).includes(s)).slice(0, 8);
    hits.replaceChildren();
    if (!found.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = 'No flower with that name yet. New ones bloom every day at 18:00 German time.';
      hits.append(li);
    } else for (const f of found) hits.append(row(f, (x) => { hideHits(); q.blur(); select(x.n); }));
    hits.hidden = false;
    return found;
  }
  q.addEventListener('input', search);
  $('find').addEventListener('submit', (e) => {
    e.preventDefault();
    const found = search();
    if (found && found.length) { hideHits(); q.blur(); select(found[0].n); }
  });

  // ---------- card, dialogs, links ----------
  $('cardClose').addEventListener('click', () => deselect());
  $('cCopy').addEventListener('click', async () => {
    const url = SITE.paths ? location.origin + '/flower/' + selected : location.href.split('#')[0] + '#flower-' + selected;
    const out = $('cCopied');
    try { await navigator.clipboard.writeText(url); out.textContent = 'Link copied.'; } catch (e) { out.textContent = url; }
    out.hidden = false;
  });
  for (const b of document.querySelectorAll('[data-open]')) {
    b.addEventListener('click', () => { const d = $(b.dataset.open); if (d && d.showModal) d.showModal(); });
  }
  const list = $('list');
  for (const f of flowers) list.append(row(f, (x) => { $('all').close(); select(x.n); }));

  const lastDay = flowers.reduce((m, f) => Math.max(m, f.day || 0), 0);
  const days = Object.keys(episodes).map(Number).filter((d) => episodes[String(d)]);
  const newest = days.length ? Math.max(...days) : 0;
  $('plant').href = newest ? 'https://www.youtube.com/shorts/' + episodes[String(newest)] : CHANNEL;
  $('count').textContent = flowers.length + (flowers.length === 1 ? ' flower' : ' flowers') + ' · Day ' + lastDay;

  window.addEventListener('resize', resize);
  window.addEventListener('hashchange', fromLoc);
  window.addEventListener('popstate', fromLoc);
  resize();
  fromLoc();
  const start = () => { dirty = true; requestAnimationFrame(frame); };
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load('40px CaveatBold'), document.fonts.load('20px NunitoBold')]).then(start, start);
  } else start();
  setTimeout(() => $('hint').classList.add('gone'), 12000);
})();
