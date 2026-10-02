// Cinematic — ambient light on the watch page.
//
// Same look as "Ambient light for YouTube" (WesselKroos/youtube-ambilight), built lean:
//  - "projector" layers: the frame is drawn N+1 times, each copy bigger by EDGE% of the
//    video's width on every side, largest at the bottom. Every ring around the picture
//    therefore shows the picture's own edge band stretched outward, so light on the
//    left comes from the left edge, like an Ambilight TV. N = SPREAD / EDGE.
//  - a black fade over the outer part of the glow (their "spread fade start/curve")
//  - CSS blur scaled to the video height (their non-WebGL formula)
// Work per frame: one downscale of the video into a 128px-wide source, ~9 tiny
// drawImage calls, one fade overlay; at most 30 fps; the GPU does the blur.
// The page and app backgrounds are made transparent over a black page so the glow
// shows through, while all content still paints on top of it.
(() => {
  'use strict';

  // Defaults: a strong, room-filling glow (spread 122, blur 38, edge 15.3).
  const DEFAULTS = {
    enabled: true, ambient: true, ambientTheaterOnly: false, ambientBars: true,
    ambientStrength: 1, ambientSpread: 122, ambientBlur: 38,
  };
  let S = { ...DEFAULTS };
  const root = document.documentElement;

  const EDGE = 15.3; // % of video width each layer grows by, per side pair
  const FADE_START = 0.15; // the first 15% of the glow beyond the picture stays undimmed
  const FADE_CURVE = 35;
  const SRC_W = 128; // downscaled copy of the frame that all layers are drawn from
  const GLOW_W = 192; // pixel width of the glow canvas (it is heavily blurred anyway)
  const FRAME_MS = 1000 / 30;
  const BLEND = 0.35; // mix new frames into the old one: no flicker on fast cuts

  let amb = null;

  const flexy = () => document.querySelector('ytd-watch-flexy');
  const inTheater = () => !!flexy()?.hasAttribute('theater');
  // In YouTube's light theme content.js applies its dark skin while .cyt-amb-on is set.
  const wanted = () => S.enabled && S.ambient && location.pathname === '/watch'
    && (!S.ambientTheaterOnly || inTheater());
  const mainVideo = () => document.querySelector('#movie_player video.html5-main-video, #movie_player video');

  // ---------- black bars ----------
  // Widescreen films often have black bars baked into the video. The glow takes its
  // colours from the picture's edges, so above/below such a film it would just be
  // black. Twice a second, look for bars in the small source frame and crop them
  // off what the layers are drawn from. Bars are taken as symmetric (the smaller
  // of top/bottom, left/right), so a dark sky or floor isn't mistaken for one; an
  // all-dark frame (fade to black) keeps the last crop; during playback a new crop
  // must be seen twice in a row before it's used (right away after a load/seek).
  const BAR_LEVEL = 24 * 3; // r+g+b at or below this counts as black
  const DETECT_EVERY = 15; // renders (~0.5 s at 30 fps)

  function detectBars(w, h) {
    let data;
    try { data = amb.sctx.getImageData(0, 0, w, h).data; } catch { return null; }
    const lit = (x, y) => {
      const i = (y * w + x) * 4;
      return data[i] + data[i + 1] + data[i + 2] > BAR_LEVEL;
    };
    const rowDark = (y) => {
      let n = 0;
      for (let x = 0; x < w; x++) if (lit(x, y) && ++n > w * 0.02) return false;
      return true;
    };
    const colDark = (x, y0, y1) => {
      let n = 0;
      for (let y = y0; y < y1; y++) if (lit(x, y) && ++n > (y1 - y0) * 0.02) return false;
      return true;
    };
    let top = 0;
    while (top < h / 2 && rowDark(top)) top++;
    if (top >= h / 2 - 1) return null; // all dark: no information
    let bottom = 0;
    while (bottom < h / 2 && rowDark(h - 1 - bottom)) bottom++;
    const y = Math.min(top, bottom);
    let left = 0;
    while (left < w / 2 && colDark(left, y, h - y)) left++;
    let right = 0;
    while (right < w / 2 && colDark(w - 1 - right, y, h - y)) right++;
    const x = Math.min(left, right);
    // one extra pixel past the edge skips the bar's soft, half-dark border
    return { x: x ? x + 1 : 0, y: y ? y + 1 : 0 };
  }

  function updateBars(w, h, full) {
    if (!S.ambientBars) {
      amb.crop = null;
      return;
    }
    if (!full && ++amb.detectTick % DETECT_EVERY !== 1) return;
    const found = detectBars(w, h);
    if (!found) return;
    const key = `${found.x},${found.y}`;
    if (key === amb.cropKey) return;
    if (!full && key !== amb.cropCandidate) {
      amb.cropCandidate = key;
      return;
    }
    amb.cropKey = key;
    amb.crop = found.x || found.y ? found : null;
  }

  // ---------- drawing ----------
  function fadeGradient(ctx, total, edge, horizontal, w, h) {
    const g = ctx.createLinearGradient(0, 0, horizontal ? w : 0, horizontal ? 0 : h);
    const ease = 16 / (FADE_CURVE * 0.64);
    const K = 32;
    const stops = [];
    for (let i = K; i >= 1; i--) {
      const p = i / K;
      stops.push([Math.max(0, edge - edge * p - edge * FADE_START * (1 - p)), p ** ease]);
    }
    stops.push([edge * (1 - FADE_START), 0], [total - edge * (1 - FADE_START), 0]);
    for (let i = 1; i <= K; i++) {
      const p = i / K;
      stops.push([Math.min(total, total - edge + edge * p + edge * FADE_START * (1 - p)), p ** ease]);
    }
    for (const [x, o] of stops) g.addColorStop(Math.min(1, Math.max(0, x / total)), `rgba(0,0,0,${o.toFixed(4)})`);
    return g;
  }

  function render(full) {
    const v = amb?.video;
    if (!v || v.readyState < 2 || !v.videoWidth || !amb.layers.length) return;
    const { src, sctx, off, octx, ctx, layers, fade } = amb;
    const sh = Math.max(1, Math.round((SRC_W * v.videoHeight) / v.videoWidth));
    if (src.height !== sh) src.height = sh;
    try { sctx.drawImage(v, 0, 0, SRC_W, sh); } catch { return; }
    if (full) amb.detectTick = 0;
    updateBars(SRC_W, sh, full); // new video / seek: look for bars right away
    const c = amb.crop;
    const sx = c ? c.x : 0;
    const sy = c ? c.y : 0;
    const sw = SRC_W - 2 * sx;
    const sch = sh - 2 * sy;
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, off.width, off.height);
    for (const l of layers) octx.drawImage(src, sx, sy, sw, sch, l.x, l.y, l.w, l.h); // outermost first
    octx.drawImage(fade, 0, 0);
    ctx.globalAlpha = full ? 1 : BLEND;
    ctx.drawImage(off, 0, 0);
  }

  function onFrame(now) {
    if (!amb) return;
    if (now - amb.last >= FRAME_MS) {
      amb.last = now;
      render(false);
    }
    amb.frameId = amb.video.requestVideoFrameCallback(onFrame);
  }

  // ---------- geometry: follow the picture (the <video> element's box) ----------
  function place() {
    if (!amb) return;
    const r = amb.video.getBoundingClientRect();
    const hide = !r.width || !r.height || !!document.fullscreenElement;
    amb.el.style.display = hide ? 'none' : '';
    if (hide) return;

    const e = EDGE / 100;
    const n = Math.max(1, Math.round(S.ambientSpread / EDGE));
    const reach = (r.width * e * n) / 2; // same distance in px on every side
    const gw = r.width + 2 * reach;
    const gh = r.height + 2 * reach;
    const blur = r.height * 0.0025 * S.ambientBlur;
    const room = blur * 2; // space for the blur to fade out before the clip box ends

    // the box is clipped to the window width so it never adds a sideways scrollbar;
    // in Cinematic's theater layout it also stops at the bottom of the first screen
    // (the panel under the video), so below the fold the page stays plainly dark
    const boxTop = r.top + window.scrollY - reach - room;
    let boxH = gh + 2 * room;
    if (root.classList.contains('cyt-immersive')) boxH = Math.min(boxH, window.innerHeight - boxTop);
    Object.assign(amb.el.style, {
      left: '0px',
      top: `${boxTop}px`,
      width: `${document.documentElement.clientWidth}px`,
      height: `${boxH}px`,
    });
    Object.assign(amb.canvas.style, {
      left: `${r.left + window.scrollX - reach}px`,
      top: `${room}px`,
      width: `${gw}px`,
      height: `${gh}px`,
      filter: blur ? `blur(${blur.toFixed(1)}px)` : 'none',
    });

    // canvas-pixel layout; only rebuilt when something actually changed
    const k = GLOW_W / gw;
    const ch = Math.max(8, Math.round(gh * k));
    const key = `${ch}|${n}|${r.width.toFixed(0)}x${r.height.toFixed(0)}`;
    if (key === amb.key) return;
    amb.key = key;
    for (const c of [amb.canvas, amb.off, amb.fade]) {
      c.width = GLOW_W;
      c.height = ch;
    }
    amb.layers = [];
    for (let pos = n; pos >= 0; pos--) {
      const w = r.width * (1 + e * pos) * k;
      const h = (r.height + r.width * e * pos) * k;
      amb.layers.push({ x: (GLOW_W - w) / 2, y: (ch - h) / 2, w, h });
    }
    const fctx = amb.fade.getContext('2d');
    const edgePx = reach * k;
    fctx.clearRect(0, 0, GLOW_W, ch);
    fctx.fillStyle = fadeGradient(fctx, GLOW_W, edgePx, true, GLOW_W, ch);
    fctx.fillRect(0, 0, GLOW_W, ch);
    fctx.fillStyle = fadeGradient(fctx, ch, edgePx, false, GLOW_W, ch);
    fctx.fillRect(0, 0, GLOW_W, ch);
    render(true);
  }

  // ---------- lifecycle ----------
  const FRAME_EVENTS = ['loadeddata', 'seeked', 'emptied'];

  function bind(video) {
    if (amb.video) {
      amb.video.cancelVideoFrameCallback?.(amb.frameId);
      for (const t of FRAME_EVENTS) amb.video.removeEventListener(t, amb.onFrameEvent);
      amb.ro.unobserve(amb.video);
    }
    amb.video = video;
    amb.key = '';
    amb.crop = null;
    amb.cropKey = '0,0';
    amb.cropCandidate = '';
    for (const t of FRAME_EVENTS) video.addEventListener(t, amb.onFrameEvent);
    amb.ro.observe(video);
    place();
    amb.frameId = video.requestVideoFrameCallback(onFrame);
  }

  function start(video) {
    const canvas = document.createElement('canvas');
    const el = document.createElement('div');
    el.id = 'cyt-amb';
    el.append(canvas);
    document.body.append(el);
    const src = document.createElement('canvas');
    src.width = SRC_W;
    const off = document.createElement('canvas');
    amb = {
      el,
      canvas,
      ctx: canvas.getContext('2d', { alpha: false }),
      src,
      sctx: src.getContext('2d', { alpha: false }),
      off,
      octx: off.getContext('2d', { alpha: false }),
      fade: document.createElement('canvas'),
      layers: [],
      crop: null, // black bars cut off the source frame: {x, y} in source pixels
      cropKey: '0,0',
      cropCandidate: '',
      detectTick: 0,
      key: '',
      video: null,
      last: 0,
      frameId: 0,
      ro: new ResizeObserver(place),
      onFrameEvent: () => render(true),
    };
    applyStrength();
    root.classList.add('cyt-amb-on');
    bind(video);
  }

  function stop() {
    if (!amb) return;
    amb.video?.cancelVideoFrameCallback?.(amb.frameId);
    for (const t of FRAME_EVENTS) amb.video?.removeEventListener(t, amb.onFrameEvent);
    amb.ro.disconnect();
    amb.el.remove();
    amb = null;
    root.classList.remove('cyt-amb-on');
  }

  function applyStrength() {
    amb?.el.style.setProperty('--cyt-amb-strength', String(S.ambientStrength));
  }

  let watchedFlexy = null;

  function sync() {
    const f = flexy();
    if (f && f !== watchedFlexy) {
      // theater toggles take effect right away (for "only in theater mode")
      watchedFlexy = f;
      new MutationObserver(sync).observe(f, { attributes: true, attributeFilter: ['theater'] });
    }
    const video = wanted() && mainVideo();
    if (!video) {
      stop();
      return;
    }
    if (!amb) start(video);
    else if (amb.video !== video) bind(video);
    else place();
  }

  // right after a page/video change check often, so the glow shows up as soon as
  // the video does; afterwards the 1s tick is enough
  let kickTimers = [];
  function kick() {
    kickTimers.forEach(clearTimeout);
    kickTimers = [0, 100, 250, 500, 900].map((ms) => setTimeout(sync, ms));
  }

  chrome.storage.sync.get(DEFAULTS, (v) => {
    S = { ...DEFAULTS, ...v };
    kick();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) S[k] = newValue ?? DEFAULTS[k];
    applyStrength();
    if (amb) amb.key = ''; // spread/blur may have changed: rebuild the layout
    sync();
  });

  document.addEventListener('yt-navigate-finish', kick);
  document.addEventListener('DOMContentLoaded', kick);
  document.addEventListener('fullscreenchange', () => setTimeout(place, 50));
  window.addEventListener('resize', place);
  // Layout above the player can shift (theater mode, banners, sidebars loading in),
  // and YouTube may swap the <video> element: re-check once a second (cheap).
  setInterval(sync, 1000);
})();
