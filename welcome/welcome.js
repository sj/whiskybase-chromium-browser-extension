/**
 * The welcome page: opened once, on install (background.js), and as the
 * extension's options page. It says what the extension does and offers the two
 * steps that make it visible: pinning its icon, and checking every page
 * automatically. Each step shows whether it is done, and updates as it changes.
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
// As the popup's checkbox (popup.js): the optional access to all sites, and
// autoCheck in chrome.storage.local; the background registers the detector.

const ALL_SITES = ['http://*/*', 'https://*/*'];

async function showAutoCheck() {
  const { autoCheck } = await chrome.storage.local.get('autoCheck');
  const on = !!autoCheck && (await chrome.permissions.contains({ origins: ALL_SITES }));
  showStep('step-auto', on);
  if (on) $('step-auto').querySelector('.declined-note').hidden = true;
}

$('auto-allow').addEventListener('click', async () => {
  // Asked straight away: Chrome only shows the prompt during the click.
  const granted = await chrome.permissions.request({ origins: ALL_SITES });
  if (granted) await chrome.storage.local.set({ autoCheck: true });
  $('step-auto').querySelector('.declined-note').hidden = granted;
  showAutoCheck();
});

showAutoCheck();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.autoCheck) showAutoCheck();
});
chrome.permissions.onAdded.addListener(showAutoCheck);
chrome.permissions.onRemoved.addListener(showAutoCheck);
