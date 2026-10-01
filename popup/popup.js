// Keep in sync with DEFAULTS in content.js
const DEFAULTS = { enabled: true, sound: false, hideShorts: true };
const inputs = [...document.querySelectorAll('[data-key]')];

function render(s) {
  for (const el of inputs) el.checked = !!s[el.dataset.key];
  document.body.classList.toggle('off', !s.enabled);
}

chrome.storage.sync.get(DEFAULTS, render);
chrome.storage.onChanged.addListener(() => chrome.storage.sync.get(DEFAULTS, render));

for (const el of inputs) {
  el.addEventListener('change', () => chrome.storage.sync.set({ [el.dataset.key]: el.checked }));
}

document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.youtube.com/' });
  window.close();
});
