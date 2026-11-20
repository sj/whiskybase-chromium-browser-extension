/**
 * The welcome page: opened once, on install (background.js), and as the
 * extension's options page. It says what the extension does and offers the two
 * steps that make it visible: pinning its icon, and checking every page
 * automatically. Each step shows whether it is done, and updates as it changes.
 * Below them, the setting for automatic checking turns it on and off again.
 */
const $ = (id) => document.getElementById(id);

function showStep(id, done) {
  const step = $(id);
  step.classList.toggle('done', done);
  step.querySelector('.state').dataset.state = done ? 'done' : 'todo';
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

$('auto-allow').addEventListener('click', async () => {
  // Asked straight away: Chrome only shows the prompt during the click.
  const granted = await chrome.permissions.request({ origins: ALL_SITES });
  if (granted) await chrome.storage.local.set({ autoCheck: true });
  $('step-auto').querySelector('.declined-note').hidden = granted;
  showAutoCheck();
});

$('auto-check').addEventListener('change', async (e) => {
  try {
    if (e.target.checked) {
      // Asked straight away: Chrome only shows the prompt during the click.
      if (await chrome.permissions.request({ origins: ALL_SITES })) await chrome.storage.local.set({ autoCheck: true });
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
