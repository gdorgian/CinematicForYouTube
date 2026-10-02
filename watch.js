// Cinematic — immersive theater mode on the watch page.
//
// In theater mode:
//  - the video gets most of the window (theaterSize% of its height, popup slider,
//    default 88) and the page starts at the very top; the top bar hides until the
//    mouse nears the top edge (content.js handles the reveal for .cyt-immersive)
//  - the title appears over the video together with YouTube's own controls
//    (it follows the player's ytp-autohide class); YouTube's title line is hidden
//  - one bar under the video: channel + Subscribe and the like/share/... buttons
//    (YouTube's own #top-row) with the related-video chips (All / From … /
//    Watched) on the right
//  - the recommendations sidebar becomes a row of cards like Home's (no heading),
//    and the description and comments below take the full width
// The sidebar stays when live chat is open (the chat lives there).
(() => {
  'use strict';

  const DEFAULTS = { enabled: true, immersiveTheater: true, theaterSize: 88 };
  let S = { ...DEFAULTS };
  const root = document.documentElement;

  let watchedFlexy = null;
  let overlay = null; // {el, key}
  let chipsEl = null;
  let chipsSig = '';
  let related = null; // {el, scroller, sig, updateArrows}

  const flexy = () => document.querySelector('ytd-watch-flexy');
  const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

  function mk(tag, cls, ...kids) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    el.append(...kids);
    return el;
  }

  function immersiveWanted() {
    const f = flexy();
    return S.enabled && S.immersiveTheater && location.pathname === '/watch'
      && !!f && f.hasAttribute('theater') && !f.hasAttribute('fullscreen') && !document.fullscreenElement;
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

  // ---------- related chips, moved into the bar next to the buttons ----------
  function sourceChips() {
    const rel = document.querySelector('#related');
    if (!rel) return [];
    return [...rel.querySelectorAll('chip-view-model, yt-chip-cloud-chip-renderer')]
      .filter((el) => !el.parentElement.closest('chip-view-model, yt-chip-cloud-chip-renderer'))
      .map((el) => {
        const target = el.querySelector('button, a, #chip-container') || el;
        return {
          label: txt(el.querySelector('.ytChipShapeChip, #text, yt-formatted-string') || el),
          selected: target.getAttribute('aria-selected') === 'true' || el.hasAttribute('selected'),
          target,
        };
      })
      .filter((c) => c.label);
  }

  function ensureChips() {
    const row = document.querySelector('ytd-watch-metadata #top-row');
    if (!row) return;
    if (!chipsEl || !row.contains(chipsEl)) {
      chipsEl = mk('div');
      chipsEl.id = 'cyt-bar-chips';
      row.append(chipsEl);
      chipsSig = '';
    }
    const chips = sourceChips();
    const sig = chips.map((c) => c.label + (c.selected ? '*' : '')).join('|');
    if (sig === chipsSig) return;
    chipsSig = sig;
    chipsEl.replaceChildren(...chips.map((c) => {
      const b = mk('button', c.selected ? 'cyt-chip cyt-on' : 'cyt-chip', c.label);
      b.addEventListener('click', () => c.target.click()); // YouTube reloads #related
      return b;
    }));
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
    const on = immersiveWanted();
    if (on !== root.classList.contains('cyt-immersive')) {
      root.classList.toggle('cyt-immersive', on);
      refit();
      if (on) setTimeout(alignBar, 300); // after the player has re-fitted
    }
    if (on) {
      ensureOverlay();
      ensureChips();
      ensureRelated();
      alignBar();
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
      if (root.classList.contains('cyt-immersive')) refit();
    }
    sync();
  });

  document.addEventListener('yt-navigate-finish', sync);
  document.addEventListener('fullscreenchange', sync);
  // also picks up the title, chips and related videos once YouTube has rendered them
  setInterval(sync, 1000);
})();
