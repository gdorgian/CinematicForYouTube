// Cinematic — ambient light on the watch page.
//
// The playing video is drawn into a tiny canvas (64x36) at up to 30 fps; that
// canvas sits behind the page, a bit larger than the video, and is blurred by the
// GPU, so the picture's colours spill out around the player. The page and app
// backgrounds are made transparent (with a black page underneath) so the glow
// shows through, while all content still paints on top of it.
(() => {
  'use strict';

  const DEFAULTS = { enabled: true, ambient: true, ambientStrength: 0.8 };
  let S = { ...DEFAULTS };
  const root = document.documentElement;

  const W = 64;
  const H = 36;
  const FRAME_MS = 1000 / 30; // plenty for a blurred glow, and half the work of 60 fps
  const BLEND = 0.35; // mix new frames into the old one: no flicker on fast cuts

  let amb = null; // {el, canvas, ctx, video, last, frameId, ro, onFrameEvent}

  const wanted = () => S.enabled && S.ambient && location.pathname === '/watch';
  const mainVideo = () => document.querySelector('#movie_player video.html5-main-video, #movie_player video');

  function draw(full) {
    const v = amb?.video;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    amb.ctx.globalAlpha = full ? 1 : BLEND;
    try { amb.ctx.drawImage(v, 0, 0, W, H); } catch {}
  }

  function onFrame(now) {
    if (!amb) return;
    if (now - amb.last >= FRAME_MS) {
      amb.last = now;
      draw(false);
    }
    amb.frameId = amb.video.requestVideoFrameCallback(onFrame);
  }

  // Keep the glow lined up with the picture (the <video> element is the visible
  // picture area inside the player). The glow is SPREAD larger than the picture;
  // its box is clipped to the window width so it can never add a sideways
  // scrollbar (theater mode), with BLUR_ROOM above/below for the soft fade.
  const SPREAD_X = 0.25;
  const SPREAD_Y = 0.3;
  const BLUR_ROOM = 200;

  function place() {
    if (!amb) return;
    const r = amb.video.getBoundingClientRect();
    const hide = !r.width || !r.height || !!document.fullscreenElement;
    amb.el.style.display = hide ? 'none' : '';
    if (hide) return;
    const padX = r.width * SPREAD_X;
    const padY = r.height * SPREAD_Y;
    const glowH = r.height + 2 * padY;
    Object.assign(amb.el.style, {
      left: '0px',
      top: `${r.top + window.scrollY - padY - BLUR_ROOM}px`,
      width: `${document.documentElement.clientWidth}px`,
      height: `${glowH + 2 * BLUR_ROOM}px`,
    });
    Object.assign(amb.canvas.style, {
      left: `${r.left + window.scrollX - padX}px`,
      top: `${BLUR_ROOM}px`,
      width: `${r.width + 2 * padX}px`,
      height: `${glowH}px`,
    });
  }

  function bind(video) {
    if (amb.video) {
      amb.video.cancelVideoFrameCallback?.(amb.frameId);
      for (const t of ['loadeddata', 'seeked', 'emptied']) amb.video.removeEventListener(t, amb.onFrameEvent);
      amb.ro.unobserve(amb.video);
    }
    amb.video = video;
    for (const t of ['loadeddata', 'seeked', 'emptied']) video.addEventListener(t, amb.onFrameEvent);
    amb.ro.observe(video);
    draw(true);
    place();
    amb.frameId = video.requestVideoFrameCallback(onFrame);
  }

  function start(video) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const el = document.createElement('div');
    el.id = 'cyt-amb';
    el.append(canvas);
    document.body.append(el);
    amb = {
      el,
      canvas,
      ctx: canvas.getContext('2d', { alpha: false }),
      video: null,
      last: 0,
      frameId: 0,
      ro: new ResizeObserver(place),
      onFrameEvent: () => draw(true),
    };
    applyStrength();
    root.classList.add('cyt-amb-on');
    bind(video);
  }

  function stop() {
    if (!amb) return;
    amb.video?.cancelVideoFrameCallback?.(amb.frameId);
    for (const t of ['loadeddata', 'seeked', 'emptied']) amb.video?.removeEventListener(t, amb.onFrameEvent);
    amb.ro.disconnect();
    amb.el.remove();
    amb = null;
    root.classList.remove('cyt-amb-on');
  }

  function applyStrength() {
    amb?.el.style.setProperty('--cyt-amb-strength', String(S.ambientStrength));
  }

  function sync() {
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
    sync();
  });

  document.addEventListener('yt-navigate-finish', sync);
  document.addEventListener('fullscreenchange', () => setTimeout(place, 50));
  window.addEventListener('resize', place);
  // Layout above the player can shift (theater mode, banners, sidebars loading in),
  // and YouTube may swap the <video> element: re-check once a second (cheap).
  setInterval(sync, 1000);
})();
