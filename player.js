// Cinematic — page-world player driver.
//
// YouTube refuses to play /embed iframes inside youtube.com itself (player errors
// 152/153), so the hero uses a real YouTube player instead: the same
// "inline preview" player YouTube builds for its own hover previews. Creating one
// needs YouTube's page globals (yt.player, ytcfg), which only exist in the page's
// MAIN world, so this file runs there and content.js talks to it with DOM events
// carrying JSON strings:
//   content.js -> here : document 'cyt:cmd'    {type: load|mute|unmute|pause|resume|stop|destroy}
//   here -> content.js : document 'cyt:player' {type: playing|error|unavailable, id}
(() => {
  'use strict';

  const CONTEXTS = [
    'WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_INLINE_PREVIEW',
    'WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_CHANNEL_TRAILER',
    'WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH',
  ];

  let player = null;
  let host = null;
  let want = null; // {id, start, muted}
  let poll = 0;

  const emit = (type, data = {}) =>
    document.dispatchEvent(new CustomEvent('cyt:player', { detail: JSON.stringify({ type, ...data }) }));

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
    if (state === -1 || state === 3 || state === 5) cmd.sawLoading = true;
    if (state === 1 && (cmd.sawLoading || performance.now() - cmd.t0 > 250)) {
      cmd.announced = true;
      emit('playing', { id: cmd.id });
    }
  }

  function load(cmd, attempt = 0) {
    want = cmd;
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
    p.loadVideoById({ videoId: cmd.id, startSeconds: cmd.start || 0 });
    if (!document.hidden) p.playVideo(); // don't rely on autoplay kicking in

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
      } else if ((state === -1 || state === 5) && !document.hidden) {
        p.playVideo(); // autoplay sometimes stays "unstarted"
      }
    }, 100);
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
        p?.pauseVideo();
        break;
      case 'resume':
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
        try { p?.destroy?.(); } catch {}
        player = null;
        host = null;
        break;
    }
  });
})();
