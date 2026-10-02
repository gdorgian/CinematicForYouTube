// Cinematic — immersive theater mode on the watch page.
//
// In theater mode the video takes the whole window: the player grows to 100vh and
// the page starts at the very top, so the title, buttons and recommendations sit
// below the fold (scroll to reach them). The top bar hides until the mouse nears
// the top edge (content.js handles the reveal for .cyt-immersive, same as Home),
// and the channel + title appear over the video together with YouTube's own
// controls (they follow the player's ytp-autohide class).
(() => {
  'use strict';

  const DEFAULTS = { enabled: true, immersiveTheater: true };
  let S = { ...DEFAULTS };
  const root = document.documentElement;

  let info = null; // the overlay: {el, avatar, chan, title, key}
  let watchedFlexy = null;

  const flexy = () => document.querySelector('ytd-watch-flexy');

  function immersiveWanted() {
    const f = flexy();
    return S.enabled && S.immersiveTheater && location.pathname === '/watch'
      && !!f && f.hasAttribute('theater') && !f.hasAttribute('fullscreen') && !document.fullscreenElement;
  }

  function readInfo() {
    const meta = document.querySelector('ytd-watch-metadata');
    const title = meta?.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim();
    if (!title) return null;
    return {
      title,
      channel: meta.querySelector('ytd-channel-name a, ytd-channel-name #text')?.textContent.trim() || '',
      avatar: meta.querySelector('#owner #avatar img, ytd-video-owner-renderer #avatar img')?.src || '',
    };
  }

  function ensureInfo() {
    const player = document.getElementById('movie_player');
    if (!player) return;
    if (!info || !player.contains(info.el)) {
      info?.el.remove();
      const el = document.createElement('div');
      el.id = 'cyt-watch-info';
      const avatar = document.createElement('img');
      avatar.alt = '';
      const chan = document.createElement('span');
      const row = document.createElement('div');
      row.className = 'cyt-wi-channel';
      row.append(avatar, chan);
      const title = document.createElement('div');
      title.className = 'cyt-wi-title';
      el.append(row, title);
      player.append(el);
      info = { el, avatar, chan, title, key: '' };
    }
    const data = readInfo();
    if (!data) return;
    const key = `${data.title}|${data.channel}|${data.avatar}`;
    if (key === info.key) return;
    info.key = key;
    info.title.textContent = data.title;
    info.chan.textContent = data.channel;
    info.avatar.style.display = data.avatar ? '' : 'none';
    if (data.avatar) info.avatar.src = data.avatar;
  }

  function sync() {
    const f = flexy();
    if (f && f !== watchedFlexy) {
      // react to theater / fullscreen toggles right away instead of on the next tick
      watchedFlexy = f;
      new MutationObserver(sync).observe(f, { attributes: true, attributeFilter: ['theater', 'fullscreen'] });
    }
    const on = immersiveWanted();
    if (on !== root.classList.contains('cyt-immersive')) {
      root.classList.toggle('cyt-immersive', on);
      // The player only re-fits the picture to its new box on a window resize.
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
    if (on) ensureInfo();
  }

  chrome.storage.sync.get(DEFAULTS, (v) => {
    S = { ...DEFAULTS, ...v };
    sync();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) S[k] = newValue ?? DEFAULTS[k];
    sync();
  });

  document.addEventListener('yt-navigate-finish', sync);
  document.addEventListener('fullscreenchange', sync);
  setInterval(sync, 1000); // also picks up the title once YouTube has rendered it
})();
