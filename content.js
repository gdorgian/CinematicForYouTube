// Cinematic — Netflix-style YouTube Home (personal rebuild)
//
// On the Home page we lay a full-screen "stage" over YouTube: a hero that autoplays
// whichever video is selected, and Netflix-style rows underneath:
//   Recommended (YouTube's real Home feed, which stays mounted but hidden and also
//   provides infinite loading), Continue Watching, New from Subscriptions and
//   Watch Later (read from those pages' ytInitialData).
// The video itself is played by player.js in the page's MAIN world.
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
    down: 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z',
    up: 'M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z',
  };

  const txt = (el) => (el ? (el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim() : '');

  function parseDuration(s) {
    const m = s && s.match(/\b(?:(\d+):)?(\d{1,2}):(\d{2})\b/);
    if (!m) return { secs: 0, label: '' };
    return { secs: (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3], label: m[0] };
  }

  // ---------- metadata: channel • views • date ----------
  const DATE_RE = /\bago\b|streamed|premiere|scheduled|\b\d+\s*(?:s|sec|second|min|minute|h|hr|hour|d|day|w|wk|week|mo|month|y|yr|year)s?\b/i;
  const VIEWS_RE = /\bviews?\b|watching|waiting/i;
  const NUM_RE = /^[\d.,]+\s*[KMB]?$/i;
  const UNITS = { s: 'second', sec: 'second', m: 'minute', min: 'minute', h: 'hour', hr: 'hour', d: 'day', w: 'week', wk: 'week', mo: 'month', y: 'year', yr: 'year' };

  // "2mo ago" -> "2 months ago", "13y ago" -> "13 years ago"
  const expandDate = (s) =>
    s.replace(/\b(\d+)\s*(mo|min|sec|hr|wk|yr|s|m|h|d|w|y)\b(?=\s*ago)/i,
      (_, n, u) => `${n} ${UNITS[u.toLowerCase()]}${n === '1' ? '' : 's'}`);

  // parts: [{text, label}] in display order. label is YouTube's accessibility text
  // ("1.4 million views", "2 months ago"), clearer than the compact "1.4M"/"2mo ago".
  function classifyParts(parts) {
    let channel = '';
    let views = '';
    let date = '';
    for (const { text = '', label = '' } of parts) {
      const t = text.trim();
      if (!t || t === '•') continue;
      if (!views && (VIEWS_RE.test(t) || (NUM_RE.test(t) && VIEWS_RE.test(label)))) {
        views = VIEWS_RE.test(t) ? t : `${t} views`;
      } else if (!date && !NUM_RE.test(t) && DATE_RE.test(label || t)) {
        date = expandDate(label && label.length <= 30 ? label : t);
      } else if (!channel && !NUM_RE.test(t)) {
        channel = t;
      }
    }
    return { channel, views, date };
  }

  const metaLine = (item) => [item.views, item.date].filter(Boolean).join(' • ');

  // ---------- Home: hide YouTube's grid until the stage is ready ----------
  // Avoids a flash of the normal layout (and YouTube's own hover previews) while the
  // feed loads. Falls back to the normal page if no stage appears (e.g. signed out).
  let pendingTimer = 0;
  function setPending(on) {
    clearTimeout(pendingTimer);
    root.classList.toggle('cyt-pending', on);
    if (on) pendingTimer = setTimeout(() => root.classList.remove('cyt-pending'), 5000);
  }
  if (isHome()) setPending(true);

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

  // ---------- Recommended row: YouTube's (hidden) Home feed ----------
  const homeBrowse = () => document.querySelector('ytd-browse[page-subtype="home"]');

  const ROW_SEL = '.ytContentMetadataViewModelMetadataRow, .yt-content-metadata-view-model__metadata-row, .yt-content-metadata-view-model-wiz__metadata-row';
  const PART_SEL = '.ytContentMetadataViewModelMetadataText, .yt-content-metadata-view-model__metadata-text, .yt-content-metadata-view-model-wiz__metadata-text';

  function domParts(card) {
    const parts = [];
    for (const row of card.querySelectorAll(ROW_SEL)) {
      const spans = row.querySelectorAll(PART_SEL);
      if (!spans.length) {
        parts.push({ text: txt(row) });
        continue;
      }
      for (const s of spans) {
        parts.push({ text: s.textContent.replace(/\s+/g, ' ').trim(), label: s.getAttribute('aria-label') || '' });
      }
    }
    if (!parts.length) {
      // older grid markup
      parts.push({ text: txt(card.querySelector('ytd-channel-name #text, ytd-channel-name a')) });
      for (const s of card.querySelectorAll('#metadata-line .inline-metadata-item')) parts.push({ text: txt(s) });
    }
    return parts;
  }

  function domProgress(thumb) {
    const bar = thumb.querySelector('[class*="ProgressBar"] [style*="width"], [class*="progress-bar"] [style*="width"], #progress[style*="width"]');
    const m = bar?.getAttribute('style')?.match(/width:\s*([\d.]+)%/);
    return m ? +m[1] / 100 : 0;
  }

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

    const meta = classifyParts(domParts(card));
    if (!meta.channel) {
      const chanLink = [...card.querySelectorAll('a[href^="/@"], a[href^="/channel/"]')].find((a) => txt(a));
      meta.channel = txt(chanLink);
    }
    const avatarImg = [...card.querySelectorAll('img')].find((img) => !thumbLink.contains(img) && img.src);
    const thumbText = thumbLink.textContent || '';
    return {
      id,
      title,
      ...meta,
      avatar: avatarImg?.src || '',
      live: /\bLIVE\b/.test(thumbText),
      duration: parseDuration(thumbText),
      progress: domProgress(thumbLink),
      href: `https://www.youtube.com/watch?v=${id}`,
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

  // ---------- other rows: read ytInitialData out of YouTube's own pages ----------
  const textOf = (t) =>
    !t ? '' : typeof t === 'string' ? t : t.simpleText ?? t.content ?? (t.runs ? t.runs.map((r) => r.text).join('') : '');
  const labelOf = (t) => t?.accessibility?.accessibilityData?.label || '';

  function deepFind(obj, key, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 14) return undefined;
    if (key in obj) return obj[key];
    for (const v of Object.values(obj)) {
      const r = deepFind(v, key, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }

  function deepTexts(obj, out = [], depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 14) return out;
    for (const [k, v] of Object.entries(obj)) {
      if ((k === 'text' || k === 'content' || k === 'simpleText') && typeof v === 'string') out.push(v);
      else deepTexts(v, out, depth + 1);
    }
    return out;
  }

  const durationIn = (obj) => parseDuration(deepTexts(obj).find((s) => /^\s*(?:\d+:)?\d{1,2}:\d{2}\s*$/.test(s)) || '');

  // videoRenderer / gridVideoRenderer / compactVideoRenderer / playlistVideoRenderer
  function fromRenderer(v) {
    if (!v.videoId) return null;
    const views = v.shortViewCountText || v.viewCountText;
    const meta = classifyParts([
      { text: textOf(v.shortBylineText || v.ownerText || v.longBylineText) },
      { text: textOf(views), label: labelOf(views) },
      { text: textOf(v.publishedTimeText) },
      ...(v.videoInfo?.runs || []).map((r) => ({ text: r.text })), // playlists: "1.2M views • 2 years ago"
    ]);
    const pct = deepFind(v.thumbnailOverlays, 'percentDurationWatched');
    return {
      id: v.videoId,
      title: textOf(v.title),
      ...meta,
      avatar: deepFind(v.channelThumbnailSupportedRenderers || v.channelThumbnail || v.avatar, 'url') || '',
      live: deepFind(v.thumbnailOverlays, 'style') === 'LIVE' || /\bLIVE\b/.test(JSON.stringify(v.badges || '')),
      duration: v.lengthText ? parseDuration(textOf(v.lengthText)) : durationIn(v.thumbnailOverlays),
      progress: pct ? pct / 100 : 0,
    };
  }

  function fromLockup(l) {
    if (!l.contentId || (l.contentType && l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO')) return null;
    const meta = l.metadata?.lockupMetadataViewModel || {};
    const rows = meta.metadata?.contentMetadataViewModel?.metadataRows || [];
    const parts = rows.flatMap((r) => (r.metadataParts || []).map((p) => ({
      text: p.text?.content || '',
      label: p.accessibilityLabel || p.text?.accessibilityLabel || '',
    })));
    const pct = deepFind(l.contentImage, 'startPercent');
    return {
      id: l.contentId,
      title: textOf(meta.title),
      ...classifyParts(parts),
      avatar: deepFind(meta.image, 'url') || '',
      live: /\bLIVE\b/.test(deepTexts(l.contentImage).join(' ')),
      duration: durationIn(l.contentImage),
      progress: pct ? pct / 100 : 0,
    };
  }

  const RENDERERS = ['videoRenderer', 'gridVideoRenderer', 'compactVideoRenderer', 'playlistVideoRenderer'];

  function itemsFromData(data, limit) {
    const out = [];
    const seen = new Set();
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 40 || out.length >= limit) return;
      if (Array.isArray(o)) {
        for (const v of o) walk(v, depth + 1);
        return;
      }
      for (const [k, v] of Object.entries(o)) {
        let item = null;
        if (RENDERERS.includes(k)) item = fromRenderer(v);
        else if (k === 'lockupViewModel') item = fromLockup(v);
        else {
          walk(v, depth + 1);
          continue;
        }
        if (item && item.title && !seen.has(item.id)) {
          seen.add(item.id);
          item.href = `https://www.youtube.com/watch?v=${item.id}`;
          out.push(item);
        }
      }
    };
    walk(data, 0);
    return out;
  }

  function extractInitialData(html) {
    for (const marker of ['var ytInitialData = ', 'window["ytInitialData"] = ']) {
      const a = html.indexOf(marker);
      if (a < 0) continue;
      const start = a + marker.length;
      const end = html.indexOf(';</script>', start);
      if (end < 0) continue;
      try { return JSON.parse(html.slice(start, end)); } catch {}
    }
    return null;
  }

  const inProgress = (it) => it.progress > 0.03 && it.progress < 0.95;

  const EXTRA_ROWS = [
    { key: 'continue', title: 'Continue Watching', url: '/feed/history', filter: inProgress, limit: 30, ttl: 2 },
    { key: 'subs', title: 'New from Subscriptions', url: '/feed/subscriptions', limit: 40, ttl: 10 },
    { key: 'later', title: 'Watch Later', url: '/playlist?list=WL', limit: 50, ttl: 5 },
  ];
  const ROW_ORDER = ['home', ...EXTRA_ROWS.map((d) => d.key)];

  async function fetchRow(def) {
    const key = `cyt:row:${def.key}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(key));
      if (cached && Date.now() - cached.t < def.ttl * 60000) return cached.items;
    } catch {}
    const res = await fetch(def.url, { credentials: 'include' });
    if (!res.ok) return [];
    const data = extractInitialData(await res.text());
    let items = data ? itemsFromData(data, 200) : [];
    if (def.filter) items = items.filter(def.filter);
    items = items.slice(0, def.limit);
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), items })); } catch {}
    return items;
  }

  // ---------- player (lives in player.js, the page's MAIN world) ----------
  const send = (type, data = {}) =>
    document.dispatchEvent(new CustomEvent('cyt:cmd', { detail: JSON.stringify({ type, ...data }) }));

  const currentItem = () => st?.cur.row?.items[st.cur.i];

  document.addEventListener('cyt:player', (e) => {
    let d;
    try { d = JSON.parse(e.detail); } catch { return; }
    if (!st || currentItem()?.id !== d.id) return;
    if (d.type === 'playing') st.el.classList.add('cyt-playing');
    else st.el.classList.remove('cyt-playing');
  });

  function startSeconds(item) {
    const secs = item.duration.secs;
    if (item.live || !secs) return 0;
    if (inProgress(item)) return Math.floor(item.progress * secs); // pick up where you left off
    return secs < 90 ? 0 : Math.min(Math.floor(secs * 0.12), 600);
  }

  // ---------- battery: pause when idle, unfocused or hidden ----------
  const IDLE_MS = 2 * 60 * 1000;
  let lastActivity = Date.now();
  let idle = false;
  const shouldPlay = () => !document.hidden && document.hasFocus() && !idle;

  function updatePlayback() {
    if (!st) return;
    const play = shouldPlay();
    if (play === st.wantPlay) return;
    st.wantPlay = play;
    send(play ? 'resume' : 'pause');
  }

  for (const type of ['mousemove', 'keydown', 'wheel', 'pointerdown']) {
    document.addEventListener(type, () => {
      lastActivity = Date.now();
      if (idle) {
        idle = false;
        updatePlayback();
      }
    }, { capture: true, passive: true });
  }
  setInterval(() => {
    if (st && !idle && Date.now() - lastActivity > IDLE_MS) {
      idle = true;
      updatePlayback();
    }
  }, 10000);
  window.addEventListener('focus', updatePlayback);
  window.addEventListener('blur', updatePlayback);
  document.addEventListener('visibilitychange', updatePlayback);

  // ---------- top bar: hidden until the mouse nears the top edge ----------
  const typingInTopbar = () => !!document.activeElement?.closest?.('ytd-masthead');

  function revealTopbar(near) {
    if (!st) return;
    if (near) {
      clearTimeout(st.topbarTimer);
      st.topbarTimer = 0;
      root.classList.add('cyt-topbar');
      return;
    }
    if (!root.classList.contains('cyt-topbar') || st.topbarTimer) return;
    st.topbarTimer = setTimeout(function hide() {
      if (!st) return;
      if (typingInTopbar()) {
        st.topbarTimer = setTimeout(hide, 800); // keep it up while you type a search
        return;
      }
      root.classList.remove('cyt-topbar');
      st.topbarTimer = 0;
    }, 800);
  }

  document.addEventListener('focusin', (e) => {
    if (e.target.closest?.('ytd-masthead')) revealTopbar(true); // e.g. "/" focuses search
  });

  document.addEventListener('mousemove', (e) => {
    if (!st) return;
    revealTopbar(e.clientY < 90 || !!e.target.closest?.('ytd-masthead, ytd-popup-container, tp-yt-iron-dropdown'));
  }, { passive: true });

  // ---------- the stage ----------
  let st = null;

  function buildStage() {
    const el = mk('div', { id: 'cyt-stage' });
    const bg = mk('img', { class: 'cyt-bg', alt: '' });
    const video = mk('div', { class: 'cyt-video' }, mk('div', { id: 'cyt-player-host' }));
    const avatar = mk('img', { class: 'cyt-avatar', alt: '' });
    const chan = mk('span', { class: 'cyt-chan' });
    const meta = mk('span', { class: 'cyt-meta' });
    const title = mk('h1', { class: 'cyt-title' });
    const play = mk('button', { class: 'cyt-btn cyt-play' }, svg(P.play), 'Play');
    const mute = mk('button', { class: 'cyt-btn cyt-mute' });
    const prev = mk('button', { class: 'cyt-arrow cyt-prev', title: 'Previous' }, svg(P.left, 28));
    const next = mk('button', { class: 'cyt-arrow cyt-next', title: 'Next' }, svg(P.right, 28));
    const track = mk('div', { class: 'cyt-rows-track' });
    const rowsEl = mk('div', { class: 'cyt-rows' }, track);

    el.append(
      mk('div', { class: 'cyt-media' }, bg, video),
      mk('div', { class: 'cyt-shade' }),
      prev,
      next,
      mk('div', { class: 'cyt-front' },
        mk('div', { class: 'cyt-info' },
          mk('div', { class: 'cyt-channel' }, avatar, chan, meta),
          title,
          mk('div', { class: 'cyt-actions' }, play, mute)),
        rowsEl),
    );
    document.body.append(el);

    const s = {
      el, bg, avatar, chan, meta, title, mute, rowsEl, track,
      rows: [], cur: { row: null, i: -1 }, viewRow: null, wheelAcc: 0, wheelLast: 0, wheelLocked: false,
      muted: !S.sound, wantPlay: shouldPlay(), hoverTimer: 0, topbarTimer: 0, loadingMore: false,
    };

    const paintMute = () => {
      mute.replaceChildren(svg(s.muted ? P.muted : P.sound), s.muted ? 'Unmute' : 'Mute');
    };
    paintMute();

    play.addEventListener('click', () => go(currentItem()));
    title.addEventListener('click', () => go(currentItem()));
    mute.addEventListener('click', () => {
      s.muted = !s.muted;
      send(s.muted ? 'mute' : 'unmute');
      paintMute();
      chrome.storage.sync.set({ sound: !s.muted });
    });
    prev.addEventListener('click', () => select(s.cur.row, s.cur.i - 1, true));
    next.addEventListener('click', () => select(s.cur.row, s.cur.i + 1, true));

    // Scrolling up/down anywhere on the stage moves exactly one row per gesture:
    // trackpad momentum keeps firing wheel events for a second or so, and those are
    // swallowed until the gesture ends. Sideways swipes / shift+wheel scroll the row.
    el.addEventListener('wheel', (e) => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = performance.now();
      if (now - s.wheelLast > 250) {
        s.wheelAcc = 0;
        s.wheelLocked = false;
      }
      s.wheelLast = now;
      if (s.wheelLocked) return;
      s.wheelAcc += e.deltaY;
      if (Math.abs(s.wheelAcc) >= 40) {
        s.wheelLocked = true;
        stepRow(Math.sign(s.wheelAcc));
      }
    }, { passive: false });
    return s;
  }

  function addRow(key, title) {
    const scroller = mk('div', { class: 'cyt-row' });
    const left = mk('button', { class: 'cyt-row-arrow cyt-left' }, svg(P.left, 30));
    const right = mk('button', { class: 'cyt-row-arrow cyt-right' }, svg(P.right, 30));
    const hint = mk('button', { class: 'cyt-row-hint' });
    const block = mk('section', { class: 'cyt-block' },
      mk('div', { class: 'cyt-row-head' }, mk('h2', {}, title), hint),
      mk('div', { class: 'cyt-row-wrap' }, left, scroller, right));
    const row = { key, title, items: [], block, scroller, hint, sel: 0 };

    const page = (dir) => scroller.scrollBy({ left: dir * scroller.clientWidth * 0.8, behavior: 'smooth' });
    left.addEventListener('click', () => page(-1));
    right.addEventListener('click', () => page(1));
    row.updateArrows = () => {
      left.classList.toggle('cyt-hidden', scroller.scrollLeft < 10);
      right.classList.toggle('cyt-hidden', scroller.scrollLeft + scroller.clientWidth > scroller.scrollWidth - 10);
    };
    scroller.addEventListener('scroll', () => {
      row.updateArrows();
      if (key === 'home' && scroller.scrollLeft + scroller.clientWidth > scroller.scrollWidth - scroller.clientWidth * 0.6) {
        loadMore();
      }
    }, { passive: true });
    scroller.addEventListener('mouseleave', () => clearTimeout(st?.hoverTimer));
    hint.addEventListener('click', () => {
      const r = st.rows.indexOf(row);
      goRow(st.rows[r + 1] || st.rows[0]);
    });
    if (!st.viewRow) st.viewRow = row;

    // keep rows in a fixed order no matter which fetch finishes first
    const rank = ROW_ORDER.indexOf(key);
    const after = st.rows.findIndex((r) => ROW_ORDER.indexOf(r.key) > rank);
    if (after < 0) {
      st.rows.push(row);
      st.track.append(block);
    } else {
      st.rows.splice(after, 0, row);
      st.track.insertBefore(block, st.rows[after + 1].block);
    }
    updateHints();
    goRow(st.viewRow, false); // a row inserted above the visible one shifts the track
    return row;
  }

  function updateHints() {
    st.rows.forEach((row, r) => {
      const target = st.rows[r + 1];
      if (target) row.hint.replaceChildren(target.title, svg(P.down, 18));
      else if (r > 0) row.hint.replaceChildren(st.rows[0].title, svg(P.up, 18));
      else row.hint.replaceChildren();
    });
  }

  function goRow(row, animate = true) {
    if (!row) return;
    st.viewRow = row;
    st.track.classList.toggle('cyt-instant', !animate);
    st.track.style.transform = `translateY(${-row.block.offsetTop}px)`;
  }

  function stepRow(dir) {
    const r = st.rows.indexOf(st.viewRow) + dir;
    if (r >= 0 && r < st.rows.length) goRow(st.rows[r]);
  }

  // Scroll a row sideways just enough to show the card (no vertical scrolling).
  function revealCard(row, card) {
    const sc = row.scroller;
    const pad = sc.clientWidth * 0.06;
    if (card.offsetLeft < sc.scrollLeft + pad || card.offsetLeft + card.offsetWidth > sc.scrollLeft + sc.clientWidth - pad) {
      sc.scrollTo({ left: card.offsetLeft - pad, behavior: 'smooth' });
    }
  }

  function cardFor(row, item, i) {
    const img = mk('img', { alt: '', loading: 'lazy', src: `https://i.ytimg.com/vi/${item.id}/hq720.jpg` });
    img.addEventListener('error', () => {
      if (!img.src.includes('mqdefault')) img.src = `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`;
    }, { once: true });
    const card = mk('a', { class: 'cyt-card', href: item.href }, img);
    if (item.live) card.append(mk('span', { class: 'cyt-badge cyt-live' }, 'LIVE'));
    else if (item.duration.label) card.append(mk('span', { class: 'cyt-badge' }, item.duration.label));
    if (inProgress(item)) {
      const bar = mk('div', { class: 'cyt-progress' }, mk('div'));
      bar.firstChild.style.width = `${Math.round(item.progress * 100)}%`;
      card.append(bar);
    }
    card.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      go(item);
    });
    card.addEventListener('mouseenter', () => {
      clearTimeout(st.hoverTimer);
      // short dwell so sweeping the mouse across the row doesn't load every video
      st.hoverTimer = setTimeout(() => select(row, i, false), 120);
    });
    return card;
  }

  function setRowItems(row, items) {
    const appendOnly = row.items.length && items.length > row.items.length
      && row.items.every((it, k) => items[k].id === it.id);
    if (appendOnly) {
      const start = row.items.length;
      row.items = items;
      row.scroller.append(...items.slice(start).map((it, j) => cardFor(row, it, start + j)));
    } else {
      row.items = items;
      row.scroller.replaceChildren(...items.map((it, j) => cardFor(row, it, j)));
      row.scroller.scrollLeft = 0;
      row.sel = 0;
      if (st.cur.row === row || !st.cur.row) {
        st.cur = { row: null, i: -1 };
        select(row, 0, false);
      }
    }
    row.updateArrows();
  }

  function select(row, i, scroll) {
    if (!st || !row?.items.length) return;
    i = (i + row.items.length) % row.items.length;
    if (st.cur.row === row && st.cur.i === i) return;
    st.cur = { row, i };
    row.sel = i;
    const item = row.items[i];
    for (const c of st.rowsEl.querySelectorAll('.cyt-card.cyt-sel')) c.classList.remove('cyt-sel');
    const card = row.scroller.children[i];
    card?.classList.add('cyt-sel');
    if (scroll && card) revealCard(row, card);

    st.title.textContent = item.title;
    st.chan.textContent = item.channel;
    st.meta.textContent = metaLine(item);
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
        if (hi.naturalWidth > 120 && currentItem() === item) bg.src = hi.src;
      };
      hi.src = `https://i.ytimg.com/vi/${item.id}/maxresdefault.jpg`;
    }

    send('load', { id: item.id, start: startSeconds(item), muted: st.muted, paused: !st.wantPlay });
  }

  // Open the video on YouTube's watch page, continuing from wherever the preview got to.
  function go(item) {
    if (!item) return;
    send('open', { id: item.id, live: item.live });
  }

  // Ask YouTube for more Home videos: briefly scroll its hidden feed to the bottom so
  // its own infinite-scroll trigger fires, then return to the top.
  function loadMore() {
    if (!st || st.loadingMore) return;
    st.loadingMore = true;
    window.scrollTo(0, document.documentElement.scrollHeight);
    setTimeout(() => {
      window.scrollTo(0, 0);
      if (st) st.loadingMore = false;
    }, 1500);
  }

  async function loadExtraRows(s) {
    await Promise.all(EXTRA_ROWS.map(async (def) => {
      let items = [];
      try { items = await fetchRow(def); } catch {}
      if (st !== s || !items.length) return; // signed out, empty, or we left Home
      setRowItems(addRow(def.key, def.title), items);
    }));
  }

  function teardown() {
    if (!st) return;
    send('stop');
    send('destroy');
    send('stage', { on: false });
    clearTimeout(st.hoverTimer);
    clearTimeout(st.topbarTimer);
    st.el.remove();
    st = null;
    root.classList.remove('cyt-stage-on', 'cyt-topbar');
  }

  function sync() {
    const browse = homeBrowse();
    if (!(S.enabled && isHome() && browse && !browse.hasAttribute('hidden'))) {
      teardown();
      if (!isHome() || !S.enabled) setPending(false);
      return;
    }
    const items = readFeed();
    if (!st && items.length < 3) return; // feed not ready (or signed-out empty Home): leave YouTube as is
    if (!st) {
      st = buildStage();
      root.classList.add('cyt-stage-on');
      setPending(false);
      window.scrollTo(0, 0);
      send('stage', { on: true });
      st.home = addRow('home', 'Recommended for You');
      loadExtraRows(st);
    }
    const sig = items.map((i) => i.id).join(',');
    if (sig && sig !== st.sig) {
      st.sig = sig;
      setRowItems(st.home, items);
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
  document.addEventListener('yt-navigate-finish', () => {
    if (isHome() && !st) setPending(true);
    schedule();
  });
  window.addEventListener('popstate', schedule);

  const mo = new MutationObserver(() => {
    if (S.enabled && isHome()) schedule();
  });
  const observe = () => mo.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'],
  });
  if (document.body) observe();
  else document.addEventListener('DOMContentLoaded', observe, { once: true });

  document.addEventListener('keydown', (e) => {
    if (!st) return;
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const { row, i } = st.cur;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      select(row, i + (e.key === 'ArrowRight' ? 1 : -1), true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const target = st.rows[st.rows.indexOf(st.viewRow) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (target) {
        goRow(target);
        select(target, target.sel, true);
      }
    } else if (e.key === 'Enter') {
      go(currentItem());
    } else if (e.key === 'm') {
      st.mute.click();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
