// Cinematic — immersive theater mode on the watch page.
//
// In theater mode:
//  - the video gets most of the window (theaterSize% of its height, popup slider,
//    default 85) and the page starts at the very top; the top bar hides until the
//    mouse nears the top edge (content.js handles the reveal for .cyt-immersive)
//  - the title appears over the video together with YouTube's own controls
//    (it follows the player's ytp-autohide class); YouTube's title line is hidden
//  - under the video a glass panel fills exactly the rest of the screen: channel +
//    Subscribe on the left, views • date in the middle, YouTube's like/share/...
//    buttons on the right (scaled up to fit the panel), and a "More videos" hint,
//    so nothing else shows until you scroll
//  - below the fold, the recommendations sidebar becomes a row of cards like
//    Home's; the description and comments below take the full width. (The
//    sidebar's chips are left out: YouTube only refreshes them in the sidebar.)
// The sidebar stays when live chat is open (the chat lives there).
(() => {
  'use strict';

  const DEFAULTS = { enabled: true, immersiveTheater: true, autoTheater: true, theaterSize: 85 };
  let S = { ...DEFAULTS };
  const root = document.documentElement;

  let watchedFlexy = null;
  let overlay = null; // {el, key}
  let related = null; // {el, scroller, sig, updateArrows}
  let moreEl = null;
  let statsEl = null;

  const flexy = () => document.querySelector('ytd-watch-flexy');
  const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

  function mk(tag, cls, ...kids) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    el.append(...kids);
    return el;
  }

  // YouTube remembers theater mode in a cookie, so the layout is known before the
  // page renders: applying it right away avoids a visible jump (and a player resize)
  // once YouTube's own page appears.
  const wideCookie = () => /(?:^|;\s*)wide=1(?:;|$)/.test(document.cookie);
  const videoId = () => new URLSearchParams(location.search).get('v') || '';
  let autoTheaterFor = ''; // video we already switched into theater for
  let theaterWaitFor = '';
  let theaterWaitSince = 0;

  function immersiveWanted() {
    if (!(S.enabled && S.immersiveTheater && location.pathname === '/watch') || document.fullscreenElement) return false;
    const f = flexy();
    if (!f) return wideCookie() || S.autoTheater; // page still booting
    if (f.hasAttribute('fullscreen')) return false;
    // about to be switched to theater by ensureTheater(): keep the layout, no flicker
    return f.hasAttribute('theater') || (S.autoTheater && autoTheaterFor !== videoId());
  }

  // "Open videos in theater mode": switch YouTube to theater once per video, so
  // leaving theater on a video sticks until the next one.
  function ensureTheater() {
    const f = flexy();
    const id = videoId();
    if (!S.enabled || !S.immersiveTheater || !S.autoTheater || !f || !id || autoTheaterFor === id) return;
    if (f.hasAttribute('theater') || f.hasAttribute('fullscreen')) {
      autoTheaterFor = id;
      return;
    }
    const button = document.querySelector('#movie_player .ytp-size-button');
    if (!button) {
      // player controls not built yet: try again on the next check, but give up after
      // 3 s (some pages never get a theater button) so the layout isn't left waiting
      if (theaterWaitFor !== id) {
        theaterWaitFor = id;
        theaterWaitSince = performance.now();
      } else if (performance.now() - theaterWaitSince > 3000) {
        autoTheaterFor = id;
      }
      return;
    }
    autoTheaterFor = id;
    button.click();
  }

  // ---------- title over the video ----------
  function ensureOverlay() {
    const player = document.getElementById('movie_player');
    if (!player) return;
    if (!overlay || !player.contains(overlay.el)) {
      overlay?.el.remove();
      overlay = { el: mk('div'), key: '' };
      overlay.el.id = 'cyt-watch-info';
      player.append(overlay.el);
    }
    const title = txt(document.querySelector('ytd-watch-metadata #title h1, ytd-watch-metadata h1'));
    if (title && title !== overlay.key) {
      overlay.key = title;
      overlay.el.textContent = title;
    }
  }

  // ---------- "Up next": the sidebar as a Home-style row of cards ----------
  function relatedItems() {
    const readItem = globalThis.cytShared?.readItem;
    if (!readItem) return [];
    const out = [];
    const seen = new Set();
    const cards = document.querySelectorAll('#related yt-lockup-view-model, #related ytd-compact-video-renderer');
    for (const card of cards) {
      if (card.parentElement.closest('yt-lockup-view-model, ytd-compact-video-renderer')) continue;
      const item = readItem(card);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  const open = (id) =>
    document.dispatchEvent(new CustomEvent('cyt:cmd', { detail: JSON.stringify({ type: 'open', id }) }));

  function card(item) {
    const img = mk('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = `https://i.ytimg.com/vi/${item.id}/hq720.jpg`;
    img.addEventListener('error', () => {
      if (!img.src.includes('mqdefault')) img.src = `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`;
    }, { once: true });
    const a = mk('a', 'cyt-card', img);
    a.href = item.href;
    if (item.live) a.append(mk('span', 'cyt-badge cyt-live', 'LIVE'));
    else if (item.duration.label) a.append(mk('span', 'cyt-badge', item.duration.label));
    if (item.progress > 0.03 && item.progress < 0.95) {
      const bar = mk('div', 'cyt-progress', mk('div'));
      bar.firstChild.style.width = `${Math.round(item.progress * 100)}%`;
      a.append(bar);
    }
    // picture-only cards like Home's; title + channel • views • date on hover
    const meta = [item.channel, item.views, item.date].filter(Boolean).join(' • ');
    a.append(mk('div', 'cyt-card-cap', mk('b', '', item.title), mk('small', '', meta)));
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      open(item.id);
    });
    return a;
  }

  function ensureRelated() {
    const topRow = document.querySelector('ytd-watch-metadata #above-the-fold #top-row');
    if (!topRow) return;
    if (!related || !topRow.parentElement.contains(related.el)) {
      related?.el.remove();
      const scroller = mk('div', 'cyt-row');
      const left = mk('button', 'cyt-row-arrow cyt-left', '‹');
      const right = mk('button', 'cyt-row-arrow cyt-right', '›');
      const page = (dir) => scroller.scrollBy({ left: dir * scroller.clientWidth * 0.8, behavior: 'smooth' });
      left.addEventListener('click', () => page(-1));
      right.addEventListener('click', () => page(1));
      const updateArrows = () => {
        left.classList.toggle('cyt-hidden', scroller.scrollLeft < 10);
        right.classList.toggle('cyt-hidden', scroller.scrollLeft + scroller.clientWidth > scroller.scrollWidth - 10);
      };
      scroller.addEventListener('scroll', updateArrows, { passive: true });
      const el = mk('section', '', mk('div', 'cyt-row-wrap', left, scroller, right));
      el.id = 'cyt-related';
      topRow.after(el);
      related = { el, scroller, sig: '', updateArrows };
    }
    const items = relatedItems();
    const sig = items.map((i) => i.id).join(',');
    if (!sig || sig === related.sig) return;
    related.sig = sig;
    related.scroller.replaceChildren(...items.map(card));
    related.scroller.scrollLeft = 0;
    related.updateArrows();
  }

  // ---------- views • date in the middle of the panel ----------
  function ensureStats() {
    const row = document.querySelector('ytd-watch-metadata #top-row');
    const owner = row?.querySelector('#owner');
    if (!owner) return;
    if (!statsEl || !row.contains(statsEl)) {
      statsEl?.remove();
      statsEl = mk('div');
      statsEl.id = 'cyt-stats';
      owner.after(statsEl);
      statsEl.dataset.key = '';
    }
    const parts = [...document.querySelectorAll('ytd-watch-metadata ytd-watch-info-text #info span')]
      .map((el) => txt(el)).filter(Boolean).slice(0, 2);
    const key = parts.join('|');
    if (!key || key === statsEl.dataset.key) return;
    statsEl.dataset.key = key;
    statsEl.replaceChildren(mk('b', '', parts[0]), ...(parts[1] ? [mk('i'), mk('span', '', parts[1])] : []));
  }

  // ---------- scale the panel's contents to the space it has ----------
  // YouTube's channel block and buttons are ~43px tall; the panel is usually 2-3x
  // that. CSS zoom (on a variable) scales them up as a whole, capped by the width
  // available so nothing overflows; the middle stats drop out first when tight.
  function fitBand() {
    const row = document.querySelector('ytd-watch-metadata #top-row');
    const owner = row?.querySelector('#owner');
    const actions = row?.querySelector('#actions');
    if (!owner || !actions || !row.offsetHeight) return;
    const zoom = parseFloat(root.style.getPropertyValue('--cyt-band-zoom')) || 1;
    const ownerW = owner.getBoundingClientRect().width / zoom;
    const actionsW = (actions.querySelector('#top-level-buttons-computed, #actions-inner') || actions)
      .getBoundingClientRect().width / zoom;
    // the text's own width (the element itself stretches to fill the middle)
    let statsW = 0;
    if (statsEl?.firstChild) {
      const range = document.createRange();
      range.selectNodeContents(statsEl);
      statsW = range.getBoundingClientRect().width / zoom;
    }
    const pad = 96; // panel padding + gaps
    const byHeight = ((row.clientHeight - 22) * 0.52) / 43;
    const fits = (z, withStats) => (ownerW + actionsW + (withStats ? statsW + 48 : 0)) * z + pad <= row.clientWidth;
    let z = Math.max(1, Math.min(1.45, byHeight));
    let withStats = true;
    while (z > 1 && !fits(z, true)) z -= 0.05;
    if (!fits(z, true)) {
      withStats = false;
      z = Math.max(1, Math.min(1.45, byHeight));
      while (z > 1 && !fits(z, false)) z -= 0.05;
    }
    z = Math.round(z * 100) / 100;
    if (Math.abs(z - zoom) > 0.01) root.style.setProperty('--cyt-band-zoom', String(z));
    root.classList.toggle('cyt-band-tight', !withStats);
  }

  // ---------- "More videos" hint at the bottom of the band ----------
  function ensureMore() {
    const row = document.querySelector('ytd-watch-metadata #top-row');
    if (!row || (moreEl && row.contains(moreEl))) return;
    moreEl?.remove();
    moreEl = mk('button', '', 'More videos', mk('span', 'cyt-more-chev', '⌄'));
    moreEl.id = 'cyt-more';
    moreEl.addEventListener('click', () => {
      const top = related?.el.getBoundingClientRect().top;
      if (top !== undefined) window.scrollBy({ top: top - 16, behavior: 'smooth' });
    });
    row.append(moreEl);
  }

  // ---------- the bar sits right under the video ----------
  // YouTube puts ~24px between the player and the bar, partly through spacing that
  // no element reports as margin/padding, so measure the real gap and pull the
  // content up by it (self-correcting if YouTube's spacing changes).
  const BAR_GAP = 6;

  function alignBar() {
    const fb = document.querySelector('#full-bleed-container');
    const bar = document.querySelector('ytd-watch-metadata #top-row');
    if (!fb || !bar?.offsetHeight) return;
    const gap = bar.getBoundingClientRect().top - fb.getBoundingClientRect().bottom;
    if (Math.abs(gap - BAR_GAP) < 1) return;
    const cur = parseFloat(root.style.getPropertyValue('--cyt-bar-pull')) || 0;
    const next = Math.max(-80, Math.min(0, Math.round(cur - (gap - BAR_GAP))));
    root.style.setProperty('--cyt-bar-pull', `${next}px`);
  }

  // ---------- state ----------
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
    if (location.pathname === '/watch') ensureTheater();
    const on = immersiveWanted();
    if (on !== root.classList.contains('cyt-immersive')) {
      root.classList.toggle('cyt-immersive', on);
      refit();
      if (on) setTimeout(alignBar, 300); // after the player has re-fitted
    }
    if (on) {
      ensureOverlay();
      ensureRelated();
      ensureStats();
      ensureMore();
      alignBar();
      fitBand();
    }
  }

  // While YouTube builds a page, check often (it fills in the player, title and
  // buttons over the first second or so); afterwards the 1s tick is enough.
  let kickTimers = [];
  function kick() {
    kickTimers.forEach(clearTimeout);
    kickTimers = [0, 60, 150, 300, 500, 800, 1300].map((ms) => setTimeout(sync, ms));
  }

  chrome.storage.sync.get(DEFAULTS, (v) => {
    S = { ...DEFAULTS, ...v };
    applySize();
    kick();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) S[k] = newValue ?? DEFAULTS[k];
    if (changes.theaterSize) {
      applySize();
      if (root.classList.contains('cyt-immersive')) refit();
    }
    sync();
  });

  document.addEventListener('yt-navigate-finish', kick);
  document.addEventListener('DOMContentLoaded', kick);
  window.addEventListener('resize', () => {
    if (root.classList.contains('cyt-immersive')) setTimeout(fitBand, 100);
  });
  document.addEventListener('fullscreenchange', sync);
  // also picks up the title, stats and related videos once YouTube has rendered them
  setInterval(sync, 1000);
})();
