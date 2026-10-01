// Cinematic — Netflix-style YouTube Home (personal rebuild)
//
// On the Home page we lay a full-screen "stage" over YouTube: a hero that autoplays
// whichever video is selected and one horizontal row of videos. YouTube's real feed
// stays mounted underneath (hidden) and is our data source — infinite loading and
// navigation both go through YouTube's own DOM.
(() => {
  'use strict';

  const DEFAULTS = { enabled: true, sound: false, hideShorts: true };
  let S = { ...DEFAULTS };
  const root = document.documentElement;
  const isHome = () => location.pathname === '/';

  // ---------- small helpers (YouTube enforces Trusted Types: no innerHTML) ----------
  function mk(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else el.setAttribute(k, v);
    }
    el.append(...kids);
    return el;
  }

  function svg(d, size = 22) {
    const ns = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(ns, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('width', size);
    el.setAttribute('height', size);
    el.setAttribute('fill', 'currentColor');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    el.append(path);
    return el;
  }

  const P = {
    play: 'M7 4v16l13-8z',
    muted: 'M11 5 6 9H2v6h4l5 4V5zm5.6 4-1.4 1.4L16.8 12l-1.6 1.6 1.4 1.4 1.6-1.6 1.6 1.6 1.4-1.4L19.6 12l1.6-1.6L19.8 9l-1.6 1.6L16.6 9z',
    sound: 'M11 5 6 9H2v6h4l5 4V5zm4.5 3.5-1.4 1.4a3 3 0 0 1 0 4.2l1.4 1.4a5 5 0 0 0 0-7zm2.8-2.8-1.4 1.4a7 7 0 0 1 0 9.8l1.4 1.4a9 9 0 0 0 0-12.6z',
    left: 'M15 5 8 12l7 7 1.4-1.4L10.8 12l5.6-5.6z',
    right: 'M9 5 7.6 6.4 13.2 12l-5.6 5.6L9 19l7-7z',
  };

  const txt = (el) => (el ? (el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim() : '');

  function parseDuration(s) {
    const m = s && s.match(/\b(?:(\d+):)?(\d{1,2}):(\d{2})\b/);
    if (!m) return { secs: 0, label: '' };
    return { secs: (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3], label: m[0] };
  }

  // ---------- settings ----------
  let weAddedDark = false;
  function enforceDark() {
    if (S.enabled && !root.hasAttribute('dark')) {
      root.setAttribute('dark', '');
      weAddedDark = true;
    } else if (!S.enabled && weAddedDark) {
      root.removeAttribute('dark');
      weAddedDark = false;
    }
  }
  new MutationObserver(enforceDark).observe(root, { attributes: true, attributeFilter: ['dark'] });

  function applyClasses() {
    root.classList.toggle('cyt-on', S.enabled);
    root.classList.toggle('cyt-no-shorts', S.enabled && S.hideShorts);
    enforceDark();
  }

  chrome.storage.sync.get(DEFAULTS, (v) => {
    S = { ...DEFAULTS, ...v };
    applyClasses();
    schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) S[k] = newValue ?? DEFAULTS[k];
    applyClasses();
    if (!S.enabled) teardown();
    schedule();
  });

  // ---------- reading YouTube's (hidden) home feed ----------
  const homeBrowse = () => document.querySelector('ytd-browse[page-subtype="home"]');

  function readItem(card) {
    const links = [...card.querySelectorAll('a[href]')];
    if (links.some((a) => a.getAttribute('href').startsWith('/shorts/'))) return null;
    if (card.querySelector('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer')) return null;
    const watch = links.filter((a) => a.pathname === '/watch' && a.search.includes('v='));
    if (!watch.length) return null;
    const id = new URL(watch[0].href).searchParams.get('v');
    if (!id) return null;
    const thumbLink = watch.find((a) => a.querySelector('img')) || watch[0];

    const title = txt(card.querySelector(
      '#video-title, .ytLockupMetadataViewModelTitle, .yt-lockup-metadata-view-model__title, h3[title], h3 a, h3'
    ));
    if (!title) return null;

    let channel = '';
    let meta = '';
    const rows = [...card.querySelectorAll(
      '.ytContentMetadataViewModelMetadataRow, .yt-content-metadata-view-model__metadata-row'
    )].map(txt).filter(Boolean);
    if (rows.length) {
      channel = rows[0];
      meta = rows.slice(1).join(' • ');
    } else {
      channel = txt(card.querySelector('ytd-channel-name #text, ytd-channel-name a'));
      meta = [...card.querySelectorAll('#metadata-line .inline-metadata-item')].map(txt).filter(Boolean).join(' • ');
    }

    const avatarImg = [...card.querySelectorAll('img')].find((img) => !thumbLink.contains(img) && img.src);
    const thumbText = thumbLink.textContent || '';
    return {
      id,
      title,
      channel,
      meta,
      avatar: avatarImg?.src || '',
      live: /\bLIVE\b/.test(thumbText),
      duration: parseDuration(thumbText),
      href: watch[0].href,
      link: thumbLink,
    };
  }

  function readFeed() {
    const browse = homeBrowse();
    if (!browse) return [];
    const out = [];
    const seen = new Set();
    for (const card of browse.querySelectorAll('ytd-rich-grid-renderer ytd-rich-item-renderer')) {
      if (card.closest('ytd-rich-section-renderer')) continue;
      const item = readItem(card);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  // ---------- player (lives in player.js, the page's MAIN world) ----------
  const send = (type, data = {}) =>
    document.dispatchEvent(new CustomEvent('cyt:cmd', { detail: JSON.stringify({ type, ...data }) }));

  document.addEventListener('cyt:player', (e) => {
    let d;
    try { d = JSON.parse(e.detail); } catch { return; }
    if (!st || st.items[st.sel]?.id !== d.id) return;
    if (d.type === 'playing') st.el.classList.add('cyt-playing');
    else st.el.classList.remove('cyt-playing');
  });

  function startSeconds(item) {
    const secs = item.duration.secs;
    return item.live || secs < 90 ? 0 : Math.min(Math.floor(secs * 0.12), 600);
  }

  // ---------- the stage ----------
  let st = null;

  function buildStage() {
    const el = mk('div', { id: 'cyt-stage' });
    const bg = mk('img', { class: 'cyt-bg', alt: '' });
    const video = mk('div', { class: 'cyt-video' }, mk('div', { id: 'cyt-player-host' }));
    const avatar = mk('img', { class: 'cyt-avatar', alt: '' });
    const channel = mk('span');
    const title = mk('h1', { class: 'cyt-title' });
    const play = mk('button', { class: 'cyt-btn cyt-play' }, svg(P.play), 'Play');
    const mute = mk('button', { class: 'cyt-btn cyt-mute' });
    const prev = mk('button', { class: 'cyt-arrow cyt-prev', title: 'Previous' }, svg(P.left, 28));
    const next = mk('button', { class: 'cyt-arrow cyt-next', title: 'Next' }, svg(P.right, 28));
    const row = mk('div', { class: 'cyt-row' });
    const rowLeft = mk('button', { class: 'cyt-row-arrow cyt-left' }, svg(P.left, 30));
    const rowRight = mk('button', { class: 'cyt-row-arrow cyt-right' }, svg(P.right, 30));

    el.append(
      mk('div', { class: 'cyt-media' }, bg, video),
      mk('div', { class: 'cyt-shade' }),
      prev,
      next,
      mk('div', { class: 'cyt-front' },
        mk('div', { class: 'cyt-info' },
          mk('div', { class: 'cyt-channel' }, avatar, channel),
          title,
          mk('div', { class: 'cyt-actions' }, play, mute)),
        mk('div', { class: 'cyt-row-wrap' }, rowLeft, row, rowRight)),
    );
    document.body.append(el);

    const s = {
      el, bg, video, avatar, channel, title, mute, row,
      items: [], sig: '', sel: -1,
      muted: !S.sound, hoverTimer: 0, loadingMore: false,
    };

    const paintMute = () => {
      mute.replaceChildren(svg(s.muted ? P.muted : P.sound), s.muted ? 'Unmute' : 'Mute');
    };
    s.paintMute = paintMute;
    paintMute();

    play.addEventListener('click', () => go(s.items[s.sel]));
    title.addEventListener('click', () => go(s.items[s.sel]));
    mute.addEventListener('click', () => {
      s.muted = !s.muted;
      send(s.muted ? 'mute' : 'unmute');
      paintMute();
      chrome.storage.sync.set({ sound: !s.muted });
    });
    prev.addEventListener('click', () => select(s.sel - 1, true));
    next.addEventListener('click', () => select(s.sel + 1, true));

    const page = (dir) => row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: 'smooth' });
    rowLeft.addEventListener('click', () => page(-1));
    rowRight.addEventListener('click', () => page(1));
    row.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        row.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
    row.addEventListener('scroll', () => {
      updateRowArrows();
      if (row.scrollLeft + row.clientWidth > row.scrollWidth - row.clientWidth * 0.6) loadMore();
    }, { passive: true });
    row.addEventListener('mouseleave', () => clearTimeout(s.hoverTimer));

    function updateRowArrows() {
      rowLeft.classList.toggle('cyt-hidden', row.scrollLeft < 10);
      rowRight.classList.toggle('cyt-hidden', row.scrollLeft + row.clientWidth > row.scrollWidth - 10);
    }
    s.updateRowArrows = updateRowArrows;
    return s;
  }

  function cardFor(item, i) {
    const img = mk('img', { alt: '', loading: 'lazy', src: `https://i.ytimg.com/vi/${item.id}/hq720.jpg` });
    img.addEventListener('error', () => {
      if (!img.src.includes('mqdefault')) img.src = `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`;
    }, { once: true });
    const badge = item.live
      ? mk('span', { class: 'cyt-badge cyt-live' }, 'LIVE')
      : item.duration.label ? mk('span', { class: 'cyt-badge' }, item.duration.label) : '';
    const card = mk('a', { class: 'cyt-card', href: item.href, 'data-i': i }, img, badge);
    card.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      go(item);
    });
    card.addEventListener('mouseenter', () => {
      clearTimeout(st.hoverTimer);
      // short dwell so sweeping the mouse across the row doesn't load every video
      st.hoverTimer = setTimeout(() => select(+card.dataset.i, false), 120);
    });
    return card;
  }

  function renderItems(items) {
    const appendOnly = st.items.length && items.length > st.items.length
      && st.items.every((it, i) => items[i].id === it.id);
    if (appendOnly) {
      const start = st.items.length;
      st.items = items;
      st.row.append(...items.slice(start).map((it, j) => cardFor(it, start + j)));
    } else {
      st.items = items;
      st.row.replaceChildren(...items.map(cardFor));
      st.row.scrollLeft = 0;
      st.sel = -1;
      select(0, false);
    }
    st.updateRowArrows();
  }

  function select(i, scroll) {
    if (!st || !st.items.length) return;
    i = (i + st.items.length) % st.items.length;
    if (i === st.sel) return;
    st.sel = i;
    const item = st.items[i];
    for (const c of st.row.querySelectorAll('.cyt-card.cyt-sel')) c.classList.remove('cyt-sel');
    const card = st.row.children[i];
    card?.classList.add('cyt-sel');
    if (scroll && card) card.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });

    st.title.textContent = item.title;
    st.channel.textContent = item.channel;
    st.avatar.style.display = item.avatar ? '' : 'none';
    if (item.avatar) st.avatar.src = item.avatar;

    // Placeholder while the video buffers: the row card's thumbnail is already
    // downloaded, so it appears instantly. Upgrade to maxres only if the card
    // had to fall back to the small mqdefault.
    st.el.classList.remove('cyt-playing');
    const bg = st.bg;
    const quick = card?.querySelector('img')?.currentSrc || `https://i.ytimg.com/vi/${item.id}/hq720.jpg`;
    bg.src = quick;
    if (quick.includes('mqdefault')) {
      const hi = new Image();
      hi.onload = () => {
        // maxresdefault answers with a 120x90 placeholder when it doesn't exist
        if (hi.naturalWidth > 120 && st?.items[st.sel] === item) bg.src = hi.src;
      };
      hi.src = `https://i.ytimg.com/vi/${item.id}/maxresdefault.jpg`;
    }

    // Start the video right away; the hover dwell in cardFor() already debounces.
    send('load', { id: item.id, start: startSeconds(item), muted: st.muted });
  }

  function stopVideo() {
    if (!st) return;
    send('stop');
    st.el.classList.remove('cyt-playing');
  }

  function go(item) {
    if (!item) return;
    if (item.link?.isConnected) item.link.click();
    else location.href = item.href;
  }

  // Ask YouTube for more videos: briefly scroll its hidden feed to the bottom so its
  // own infinite-scroll trigger fires, then return to the top.
  function loadMore() {
    if (!st || st.loadingMore) return;
    st.loadingMore = true;
    window.scrollTo(0, document.documentElement.scrollHeight);
    setTimeout(() => {
      window.scrollTo(0, 0);
      if (st) st.loadingMore = false;
    }, 1500);
  }

  function teardown() {
    if (!st) return;
    stopVideo();
    send('destroy');
    clearTimeout(st.hoverTimer);
    st.el.remove();
    st = null;
    root.classList.remove('cyt-stage-on');
  }

  function sync() {
    const browse = homeBrowse();
    if (!(S.enabled && isHome() && browse && !browse.hasAttribute('hidden'))) {
      teardown();
      return;
    }
    const items = readFeed();
    if (!st && items.length < 3) return; // feed not ready (or signed-out empty Home): leave YouTube as is
    if (!st) {
      st = buildStage();
      root.classList.add('cyt-stage-on');
      window.scrollTo(0, 0);
    }
    const sig = items.map((i) => i.id).join(',');
    if (sig && sig !== st.sig) {
      st.sig = sig;
      renderItems(items);
    }
  }

  let syncTimer = 0;
  function schedule() {
    if (syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = 0;
      sync();
    }, 300);
  }

  document.addEventListener('yt-navigate-start', teardown);
  document.addEventListener('yt-navigate-finish', schedule);
  window.addEventListener('popstate', schedule);

  const mo = new MutationObserver(() => {
    if (S.enabled && isHome()) schedule();
  });
  const observe = () => mo.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'],
  });
  if (document.body) observe();
  else document.addEventListener('DOMContentLoaded', observe, { once: true });

  document.addEventListener('visibilitychange', () => {
    if (st) send(document.hidden ? 'pause' : 'resume');
  });

  document.addEventListener('keydown', (e) => {
    if (!st) return;
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      select(st.sel + (e.key === 'ArrowRight' ? 1 : -1), true);
    } else if (e.key === 'Enter') {
      go(st.items[st.sel]);
    } else if (e.key === 'm') {
      st.mute.click();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
