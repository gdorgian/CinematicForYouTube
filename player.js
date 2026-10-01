// Cinematic — page-world player driver.
//
// YouTube refuses to play /embed iframes inside youtube.com itself (player errors
// 152/153), so the hero uses a real YouTube player instead: the same
// "inline preview" player YouTube builds for its own hover previews. Creating one
// needs YouTube's page globals (yt.player, ytcfg), which only exist in the page's
// MAIN world, so this file runs there and content.js talks to it with DOM events
// carrying JSON strings:
//   content.js -> here : document 'cyt:cmd'
//       load {id, start, muted, paused} | mute | unmute | pause | resume | stop |
//       destroy | open {id, live} | stage {on}
//   here -> content.js : document 'cyt:player' {type: playing|error|unavailable, id}
(() => {
  'use strict';

  // ---------- keep previews out of watch history ----------
  // A view lands in your history through the player's stats pings
  // (/api/stats/playback, /watchtime, /ptracking). Each ping carries the playback's
  // "cpn" id, so we drop pings that belong to a preview playback. While the Home
  // stage is up we drop all of them: no other player runs there, and the first ping
  // can fire before we've had a chance to read the new preview's cpn.
  const STATS_RE = /\/api\/stats\/(?:playback|watchtime|delayplay|atr)\b|\/ptracking\b/;
  const previewCpns = new Set();
  let stageOn = false;

  function blocked(input) {
    try {
      const s = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (!STATS_RE.test(s)) return false;
      if (stageOn) return true;
      const cpn = new URL(s, location.href).searchParams.get('cpn');
      return !!cpn && previewCpns.has(cpn);
    } catch {
      return false;
    }
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    if (blocked(input)) return Promise.resolve(new Response(null, { status: 204 }));
    return origFetch.apply(this, arguments);
  };
  if (navigator.sendBeacon) {
    const origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => (blocked(url) ? true : origBeacon(url, data));
  }
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__cytBlocked = blocked(url);
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__cytBlocked) return undefined;
    return origSend.apply(this, arguments);
  };
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (srcDesc?.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...srcDesc,
      set(v) {
        if (!blocked(v)) srcDesc.set.call(this, v);
      },
    });
  }

  // ---------- the preview player ----------
  const CONTEXTS = [
    'WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_INLINE_PREVIEW',
    'WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_CHANNEL_TRAILER',
    'WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH',
  ];

  let player = null;
  let host = null;
  let want = null; // {id, start, muted, paused}
  let paused = false; // idle / unfocused / hidden: content.js asked us to hold
  let poll = 0;

  const emit = (type, data = {}) =>
    document.dispatchEvent(new CustomEvent('cyt:player', { detail: JSON.stringify({ type, ...data }) }));

  function recordCpn(p) {
    const cpn = p?.getVideoData?.()?.cpn;
    if (cpn) previewCpns.add(cpn);
  }

  // Previews sit behind dark shading; 720p looks the same there and costs far
  // less bandwidth and battery than 1080p+.
  function capQuality(p) {
    try { p.setPlaybackQualityRange?.('hd720', 'hd720'); } catch {}
    try { p.setPlaybackQuality?.('hd720'); } catch {}
  }

  function ensurePlayer() {
    const h = document.getElementById('cyt-player-host');
    if (!h) return null;
    if (player && host === h && h.contains(player)) return player;

    const configs = window.ytcfg?.get?.('WEB_PLAYER_CONTEXT_CONFIGS') || {};
    const ctx = CONTEXTS.map((k) => configs[k]).find(Boolean);
    const create = window.yt?.player?.Application?.create;
    if (!ctx || typeof create !== 'function') return null;

    h.replaceChildren();
    try {
      create(h, { args: { autoplay: '1', controls: '0' }, attrs: { id: 'cyt-player' } }, ctx);
    } catch (e) {
      console.warn('[Cinematic] could not create player', e);
      return null;
    }
    host = h;
    player = h.querySelector('.html5-video-player');
    if (player) {
      try {
        player.addEventListener('onError', () => {
          if (want) emit('error', { id: want.id });
        });
        // react the instant the state changes instead of waiting for the poll
        player.addEventListener('onStateChange', (state) => check(state));
      } catch {}
    }
    return player;
  }

  function stopPoll() {
    clearInterval(poll);
    poll = 0;
  }

  // Tell content.js the new video is on screen, as early as possible. Right after
  // loadVideoById() the player can still report "playing" with the previous
  // video's frames, so only trust state 1 once this load has gone through a
  // loading state, or once enough time has passed for the swap to have happened.
  function check(state = player?.getPlayerState?.()) {
    const cmd = want;
    const p = player;
    if (!cmd || !p || cmd.announced) return;
    if (p.getVideoData?.()?.video_id !== cmd.id) return;
    recordCpn(p);
    if (state === -1 || state === 3 || state === 5) cmd.sawLoading = true;
    if (state === 1 && (cmd.sawLoading || performance.now() - cmd.t0 > 250)) {
      cmd.announced = true;
      capQuality(p);
      emit('playing', { id: cmd.id });
    }
  }

  function load(cmd, attempt = 0) {
    want = cmd;
    paused = !!cmd.paused;
    const p = ensurePlayer();
    if (!p || typeof p.loadVideoById !== 'function') {
      // YouTube's player code can still be booting right after page load
      if (attempt < 40) setTimeout(() => want === cmd && load(cmd, attempt + 1), 100);
      else emit('unavailable', { id: cmd.id });
      return;
    }
    const video = p.querySelector('video');
    if (video && !video.dataset.cytHooked) {
      video.dataset.cytHooked = '1';
      video.addEventListener('playing', () => check());
      video.addEventListener('timeupdate', () => check());
    }

    if (cmd.muted) p.mute();
    else {
      p.unMute();
      p.setVolume(100);
    }
    cmd.t0 = performance.now();
    cmd.sawLoading = false;
    cmd.announced = false;
    const args = { videoId: cmd.id, startSeconds: cmd.start || 0 };
    if (paused) p.cueVideoById(args); // ready to go, but don't burn battery yet
    else {
      p.loadVideoById(args);
      if (!document.hidden) p.playVideo(); // don't rely on autoplay kicking in
    }
    recordCpn(p);
    capQuality(p);

    stopPoll();
    poll = setInterval(() => {
      if (want !== cmd || !p.isConnected) {
        stopPoll();
        return;
      }
      if (p.getVideoData?.()?.video_id !== cmd.id) return;
      const state = p.getPlayerState?.();
      check(state);
      if (state === 0) {
        p.seekTo(cmd.start || 0, true); // loop
        p.playVideo();
      } else if ((state === -1 || state === 5) && !paused && !document.hidden) {
        p.playVideo(); // autoplay sometimes stays "unstarted"
      }
    }, 100);
  }

  // Open the watch page with an in-app navigation (no page reload), starting where
  // the preview currently is. Falls back to a normal page load.
  function open(cmd) {
    const p = player && player.isConnected ? player : null;
    let t = 0;
    if (p && !cmd.live && p.getVideoData?.()?.video_id === cmd.id) {
      const now = p.getCurrentTime?.() || 0;
      if (now > 1) t = Math.floor(now);
    }
    recordCpn(p);
    try { p?.pauseVideo(); } catch {}
    want = null;
    stopPoll();
    stageOn = false; // from here on the real watch page logs to history as normal

    const url = `/watch?v=${encodeURIComponent(cmd.id)}${t ? `&t=${t}s` : ''}`;
    const endpoint = {
      commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } },
      watchEndpoint: { videoId: cmd.id, ...(t ? { startTimeSeconds: t } : {}) },
    };
    try {
      document.querySelector('ytd-app')?.dispatchEvent(
        new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } })
      );
    } catch {}
    setTimeout(() => {
      if (!location.pathname.startsWith('/watch')) location.href = url;
    }, 1500);
  }

  document.addEventListener('cyt:cmd', (e) => {
    let cmd;
    try { cmd = JSON.parse(e.detail); } catch { return; }
    const p = player && player.isConnected ? player : null;
    switch (cmd.type) {
      case 'load':
        load(cmd);
        break;
      case 'mute':
        if (want) want.muted = true;
        p?.mute();
        break;
      case 'unmute':
        if (want) want.muted = false;
        p?.unMute();
        p?.setVolume(100);
        break;
      case 'pause':
        paused = true;
        p?.pauseVideo();
        break;
      case 'resume':
        paused = false;
        if (want) p?.playVideo();
        break;
      case 'stop':
        want = null;
        stopPoll();
        p?.pauseVideo();
        break;
      case 'destroy':
        want = null;
        stopPoll();
        recordCpn(p);
        try { p?.destroy?.(); } catch {}
        player = null;
        host = null;
        break;
      case 'open':
        open(cmd);
        break;
      case 'stage':
        stageOn = !!cmd.on;
        break;
    }
  });
})();
