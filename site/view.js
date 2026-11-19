// The garden as the website shows it. Pure drawing: no DOM, so the same function can be
// checked in Node. Uses the video engine (PBS) unchanged, so a flower looks exactly as it
// does in the episode it bloomed in.
const PBSView = (() => {
  const E = PBS;
  const SPACING = 0.74; // same as src/episodes/daily.js
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  function place(flowers) {
    return flowers.map((f, i) => {
      const p = E.gardenPos(i, SPACING);
      return { f, i, x: p.x, z: p.z, sp: f.spec };
    });
  }

  function radius(n) {
    return SPACING * Math.sqrt(Math.max(1, n));
  }

  // cam: { theta, D, tx, tz, lift } in garden units; size: logical canvas size
  function camera(cam, LW, LH) {
    return { f: LH > LW ? 1500 : 1350, theta: cam.theta, D: cam.D, camH: cam.D * (0.3 + 0.16 * (cam.lift || 0)),
      horizon: LH * (LH > LW ? 0.34 : 0.3), tx: cam.tx, tz: cam.tz, gx: cam.tx, gz: cam.tz };
  }

  function draw(ctx, v) {
    const { LW, LH, t } = v;
    E.setSize(LW, LH);
    const cam = camera(v.cam, LW, LH);
    // sky, sun and far hills only sway a little, however far the visitor walks round
    const sky = Object.assign({}, cam, { theta: Math.sin(cam.theta) * 0.45 });
    E.drawSky(ctx, sky, t);
    E.drawGround(ctx, cam, t);

    const items = [];
    for (const it of v.placed) {
      const pr = E.project(cam, it.x - cam.tx, it.z - cam.tz);
      if (!pr || pr.sx < -400 || pr.sx > LW + 400) continue;
      items.push({ it, pr });
    }
    items.sort((a, b) => b.pr.depth - a.pr.depth);
    const heads = [];
    const sel = v.selected;
    let selPr = null;
    if (sel != null) {
      const s = items.find((x) => x.it.f.n === sel);
      if (s) selPr = s.pr;
    }
    for (const { it, pr } of items) {
      // a flower right in front of the lens fades out instead of filling the screen
      let alpha = clamp((pr.depth - 1.3) / 1.6);
      // flowers in front of the chosen one step aside, those close behind turn pale (as in the videos)
      if (selPr && it.f.n !== sel) {
        const dx = Math.abs(pr.sx - selPr.sx) / (selPr.s * 1.1);
        const inFront = pr.depth < selPr.depth - 0.1;
        alpha *= 1 - (inFront ? 0.97 : 0.55) * clamp(1.5 - dx * 0.75) * (v.selK == null ? 1 : v.selK);
      }
      if (alpha < 0.03) continue;
      const head = E.drawFlower(ctx, it.sp, pr.sx, pr.sy, pr.s, 1, t + it.i * 0.37, { wind: 1.1, alpha });
      heads.push({ n: it.f.n, hx: head.hx, hy: head.hy, r: head.r, depth: pr.depth, s: pr.s, sx: pr.sx, alpha });
    }
    E.drawMotes(ctx, sky, t, 1);
    E.drawLightAndVignette(ctx, sky);

    // name tags: the chosen flower first, then the nearest ones while there is room
    const byN = new Map(v.placed.map((p) => [p.f.n, p.f]));
    const tags = [];
    for (const h of heads) {
      const f = byN.get(h.n);
      if (h.alpha < 0.6) continue;
      if (!f.name) {
        // a flower asked for without a name: when chosen, its tag reads species + planter
        if (h.n === sel && f.by) tags.push({ h, text: E.speciesLabel(f.spec.type), sub: 'by ' + f.by, size: clamp(h.s * 0.2, 52, 72), pri: 3 });
        continue;
      }
      if (h.n === sel) {
        const sub = [E.speciesLabel(f.spec.type), f.by ? 'by ' + f.by : null].filter(Boolean).join(' · ');
        tags.push({ h, text: f.name, sub, size: clamp(h.s * 0.2, 52, 72), pri: 3 });
      } else if (h.n === v.hover) {
        tags.push({ h, text: f.name, sub: E.speciesLabel(f.spec.type), size: clamp(h.s * 0.19, 38, 50), pri: 2 });
      } else if (v.showTags && h.s > 58 && h.hx > 60 && h.hx < LW - 60) {
        tags.push({ h, text: f.name, sub: null, size: clamp(h.s * 0.17, 30, 42), pri: 1 });
      }
    }
    tags.sort((a, b) => b.pri - a.pri || a.h.depth - b.h.depth);
    const boxes = [];
    for (const tg of tags) {
      const subSize = Math.max(24, Math.round(tg.size * 0.46));
      const bw = Math.max(tg.text.length * tg.size * 0.42, (tg.sub || '').length * subSize * 0.5) + tg.size;
      const bh = tg.sub ? tg.size * 1.24 + subSize * 1.5 : tg.size * 1.28;
      const box = { x0: tg.h.hx - bw / 2, x1: tg.h.hx + bw / 2, y0: tg.h.hy - tg.h.r - tg.size * 0.55 - bh - 8, y1: tg.h.hy - tg.h.r - tg.size * 0.3 };
      if (box.y0 < (v.topInset || 0)) { if (tg.pri < 3) continue; }
      if (tg.pri < 3 && boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
      boxes.push(box);
      E.drawTag(ctx, tg.h.hx, tg.h.hy, tg.h.r, tg.text, 1, tg.size, tg.sub);
    }
    return heads;
  }

  // which flower is under a point (logical coordinates)? nearest head wins, front before back
  function hit(heads, x, y) {
    let best = null;
    for (const h of heads) {
      if (h.alpha < 0.5) continue;
      const d = Math.hypot(x - h.hx, y - h.hy);
      const reach = Math.max(h.r * 1.25, 34);
      if (d > reach) continue;
      const score = d / reach + h.depth * 0.02;
      if (!best || score < best.score) best = { n: h.n, score };
    }
    return best ? best.n : null;
  }

  return { draw, hit, place, radius, SPACING };
})();
