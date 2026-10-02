// Cinematic — immersive theater mode on the watch page.
//
// In theater mode the video gets most of the window: the player grows to
// theaterSize% of the window height (popup slider, default 85) and the page starts
// at the very top, so the title row peeks out below and the rest is a scroll away.
// The top bar hides until the mouse nears the top edge (content.js handles the
// reveal for .cyt-immersive, same as Home),
// and the channel + title appear over the video together with YouTube's own
// controls (they follow the player's ytp-autohide class) whenever YouTube's own
// title row is not on screen.
(() => {
  'use strict';

  const DEFAULTS = { enabled: true, immersiveTheater: true, theaterSize: 85 };
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

  // The overlay would only repeat YouTube's own title when that is on screen (it
  // peeks out below the video at the default size), so track whether it is.
  function checkTitle() {
    const h1 = document.querySelector('ytd-watch-metadata h1');
    const r = h1?.getBoundingClientRect();
    const onscreen = !!r && r.height > 0 && r.bottom > 0 && r.top + r.height / 2 < window.innerHeight;
    root.classList.toggle('cyt-title-onscreen', onscreen);
  }

  let scrollQueued = false;
  window.addEventListener('scroll', () => {
    if (scrollQueued || !root.classList.contains('cyt-immersive')) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      checkTitle();
    });
  }, { passive: true });

  // The player only re-fits the picture to its new box on a window resize.
  const refit = () => requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));

  function applySize() {
    root.style.setProperty('--cyt-theater-h', `${S.theaterSize}vh`);
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
      refit();
      setTimeout(checkTitle, 300); // after the player has re-fitted
    }
    if (on) {
      ensureInfo();
      checkTitle();
    }
  }

  chrome.storage.sync.get(DEFAULTS, (v) => {
    S = { ...DEFAULTS, ...v };
    applySize();
    sync();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) S[k] = newValue ?? DEFAULTS[k];
    if (changes.theaterSize) {
      applySize();
      if (root.classList.contains('cyt-immersive')) {
        refit();
        setTimeout(checkTitle, 300);
      }
    }
    sync();
  });

  document.addEventListener('yt-navigate-finish', sync);
  document.addEventListener('fullscreenchange', sync);
  setInterval(sync, 1000); // also picks up the title once YouTube has rendered it
})();
