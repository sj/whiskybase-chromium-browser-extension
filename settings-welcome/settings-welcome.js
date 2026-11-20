/**
 * The welcome page: opened once, on install (background.js), and as the
 * extension's options page. It says what the extension does and offers the two
 * steps that make it visible: pinning its icon, and checking every page
 * automatically. Each step shows whether it is done, and updates as it changes.
 * The automatic checking step's button holds the setting's checkbox, so it
 * also turns it off again.
 */
const $ = (id) => document.getElementById(id);

// A step that gets done fades (settings-welcome.css), and the steps still to do flash
// their border, in whichever order the steps are done. The state the page
// opens with shows as it is.
function showStep(id, done) {
  const step = $(id);
  const state = step.querySelector('.state');
  const gotDone = done && state.dataset.state === 'todo';
  step.classList.toggle('done', done);
  state.dataset.state = done ? 'done' : 'todo';
  setTimeout(() => step.classList.add('settled'), 100);
  if (gotDone) for (const other of document.querySelectorAll('.step:has(.state[data-state="todo"])')) flash(other);
}

function flash(step) {
  step.classList.remove('attention');
  void step.offsetWidth; // so that it starts again
  step.classList.add('attention');
}
for (const step of document.querySelectorAll('.step')) {
  step.addEventListener('animationend', () => step.classList.remove('attention'));
}

// --- Pinned ---------------------------------------------------------------------
// An extension can't pin itself, but it can see whether it is pinned. Chrome 130
// and later say when that changes; older versions are asked again when the page
// is looked at again.

async function showPinned() {
  if (!chrome.action.getUserSettings) return; // before Chrome 91: no state shown
  const { isOnToolbar } = await chrome.action.getUserSettings();
  showStep('step-pin', isOnToolbar);
}

showPinned();
chrome.action.onUserSettingsChanged?.addListener(showPinned);
window.addEventListener('focus', showPinned);
document.addEventListener('visibilitychange', showPinned);

// --- Automatic checking ---------------------------------------------------------
// On: the optional access to all sites is granted, autoCheck is set in
// chrome.storage.local, and the background registers the detector on every page.
// Turning it off only clears autoCheck and keeps the access (see background.js
// for why). The popup only says whether it is on (popup.js).

const ALL_SITES = ['http://*/*', 'https://*/*'];

async function showAutoCheck() {
  const { autoCheck } = await chrome.storage.local.get('autoCheck');
  const on = !!autoCheck && (await chrome.permissions.contains({ origins: ALL_SITES }));
  showStep('step-auto', on);
  $('auto-check').checked = on;
  if (on) $('step-auto').querySelector('.declined-note').hidden = true;
}

$('auto-check').addEventListener('change', async (e) => {
  try {
    if (e.target.checked) {
      // Asked straight away: Chrome only shows the prompt during the click.
      const granted = await chrome.permissions.request({ origins: ALL_SITES });
      if (granted) await chrome.storage.local.set({ autoCheck: true });
      $('step-auto').querySelector('.declined-note').hidden = granted;
    } else {
      await chrome.storage.local.set({ autoCheck: false });
    }
  } finally {
    showAutoCheck();
  }
});

showAutoCheck();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.autoCheck) showAutoCheck();
});
chrome.permissions.onAdded.addListener(showAutoCheck);
chrome.permissions.onRemoved.addListener(showAutoCheck);

// --- Stored bottles -------------------------------------------------------------
// The bottles matched before (known:<key>, see background.js), for the badges on
// lists of bottles.

$('clear-known').addEventListener('click', async () => {
  const keys = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('known:'));
  await chrome.storage.local.remove(keys);
  $('clear-known').textContent = 'Stored bottle data cleared';
  $('clear-known').disabled = true;
});
