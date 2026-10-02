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

  // Defaults = the user's own "Ambient light for YouTube" settings (spread 122.1,
  // blur 38.2, edge 15.3), exported 2026-10-02.
  const DEFAULTS = {
    enabled: true, ambient: true, ambientTheaterOnly: false,
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
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, off.width, off.height);
    for (const l of layers) octx.drawImage(src, l.x, l.y, l.w, l.h); // outermost first
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

    // the box is clipped to the window width so it never adds a sideways scrollbar
    Object.assign(amb.el.style, {
      left: '0px',
      top: `${r.top + window.scrollY - reach - room}px`,
      width: `${document.documentElement.clientWidth}px`,
      height: `${gh + 2 * room}px`,
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

  chrome.storage.sync.get(DEFAULTS, (v) => {
    S = { ...DEFAULTS, ...v };
    sync();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) S[k] = newValue ?? DEFAULTS[k];
    applyStrength();
    if (amb) amb.key = ''; // spread/blur may have changed: rebuild the layout
    sync();
  });

  document.addEventListener('yt-navigate-finish', sync);
  document.addEventListener('fullscreenchange', () => setTimeout(place, 50));
  window.addEventListener('resize', place);
  // Layout above the player can shift (theater mode, banners, sidebars loading in),
  // and YouTube may swap the <video> element: re-check once a second (cheap).
  setInterval(sync, 1000);
})();
