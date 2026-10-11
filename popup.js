const DEFAULTS = {
  enabled: true,
  duration: 20,
  sound: true,
  warn: true,
  overtime: true,
  pauseHidden: true,
  pauseOnAnswer: true,
  onlyInQueue: true,
  debug: false,
  game: true,
  gameTokens: 5,
  gameRefillEvery: 50,
  gameRefillAmount: 5,
};

const TOGGLES = [
  'enabled', 'sound', 'warn', 'overtime', 'pauseOnAnswer',
  'pauseHidden', 'onlyInQueue', 'game', 'debug',
];

// Numeric settings other than duration: [id, min, max]
const NUMBERS = [
  ['gameTokens', 1, 20],
  ['gameRefillAmount', 1, 20],
  ['gameRefillEvery', 1, 500],
];

const range = document.getElementById('duration');
const num = document.getElementById('durationNum');

function setDuration(value, save) {
  const v = Math.max(1, Math.min(3600, Math.round(Number(value) || DEFAULTS.duration)));
  range.value = Math.min(180, v); // the slider tops out lower than the field
  num.value = v;
  if (save) chrome.storage.sync.set({ duration: v });
}

// The rest of the panel is dimmed when the master switch is off, and the
// budget settings only appear when that feature is on.
function syncMaster() {
  document.body.classList.toggle('off', !document.getElementById('enabled').checked);
  document.body.classList.toggle('game', document.getElementById('game').checked);
}

chrome.storage.sync.get(DEFAULTS, (opts) => {
  setDuration(opts.duration, false);
  for (const key of TOGGLES) {
    document.getElementById(key).checked = Boolean(opts[key]);
  }
  for (const [id] of NUMBERS) {
    document.getElementById(id).value = opts[id];
  }
  syncMaster();
});

range.addEventListener('input', () => setDuration(range.value, true));
num.addEventListener('change', () => setDuration(num.value, true));

for (const btn of document.querySelectorAll('[data-preset]')) {
  btn.addEventListener('click', () => setDuration(btn.dataset.preset, true));
}

for (const key of TOGGLES) {
  document.getElementById(key).addEventListener('change', (e) => {
    chrome.storage.sync.set({ [key]: e.target.checked });
    syncMaster();
  });
}

for (const [id, min, max] of NUMBERS) {
  const el = document.getElementById(id);
  el.addEventListener('change', () => {
    const v = Math.max(min, Math.min(max, Math.round(Number(el.value) || DEFAULTS[id])));
    el.value = v;
    chrome.storage.sync.set({ [id]: v });
  });
}

/* --- session score ---------------------------------------------------- */

const statsEl = document.getElementById('stats');

function renderStats(game) {
  const g = game || {};
  const done = g.cardsDone || 0;
  const onTime = g.onTime || 0;
  const pct = done ? Math.round((onTime / done) * 100) : 0;

  statsEl.innerHTML = done
    ? '<b>' + done + '</b> cards · <b>' + pct + '%</b> on time · streak <b>' +
      (g.streak || 0) + '</b> (best <b>' + (g.bestStreak || 0) + '</b>)<br />' +
      '<button id="resetScore">Reset score</button>'
    : 'No cards scored yet.<br /><button id="resetScore">Reset score</button>';

  document.getElementById('resetScore').addEventListener('click', () => {
    chrome.storage.sync.get({ gameTokens: DEFAULTS.gameTokens }, ({ gameTokens }) => {
      const fresh = {
        tokens: gameTokens,
        streak: 0,
        bestStreak: 0,
        cardsDone: 0,
        onTime: 0,
        sinceRefill: 0,
      };
      chrome.storage.local.set({ game: fresh }, () => renderStats(fresh));
    });
  });
}

chrome.storage.local.get({ game: null }, ({ game }) => renderStats(game));

/* --- pause shortcut ---------------------------------------------------- */

// Chrome owns the binding, so show whatever it currently is — the user may
// have changed it, or Chrome may have declined the default because another
// extension already claimed it.
chrome.commands.getAll((commands) => {
  const cmd = commands.find((c) => c.name === 'toggle-pause');
  document.getElementById('shortcut').textContent = (cmd && cmd.shortcut) || 'not set';
});

document.getElementById('rebind').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
