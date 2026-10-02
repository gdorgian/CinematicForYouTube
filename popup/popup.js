// Keep in sync with DEFAULTS in content.js, ambient.js and watch.js
const DEFAULTS = {
  enabled: true, netflixHome: true, sound: false, hideShorts: true,
  immersiveTheater: true, theaterSize: 85,
  ambient: true, ambientTheaterOnly: false, ambientBars: true,
  ambientStrength: 1, ambientSpread: 122, ambientBlur: 38,
};
const inputs = [...document.querySelectorAll('[data-key]')];

function render(s) {
  for (const el of inputs) {
    if (el.type === 'range') el.value = s[el.dataset.key];
    else el.checked = !!s[el.dataset.key];
  }
  document.body.classList.toggle('off', !s.enabled);
  for (const sec of document.querySelectorAll('section[data-needs]')) {
    sec.classList.toggle('off', !s[sec.dataset.needs]);
  }
}

chrome.storage.sync.get(DEFAULTS, render);
chrome.storage.onChanged.addListener(() => chrome.storage.sync.get(DEFAULTS, render));

for (const el of inputs) {
  el.addEventListener('change', () => {
    chrome.storage.sync.set({ [el.dataset.key]: el.type === 'range' ? +el.value : el.checked });
  });
}

document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.youtube.com/' });
  window.close();
});
