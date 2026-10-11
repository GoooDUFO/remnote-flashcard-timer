// Relays the keyboard shortcut to the RemNote tab you're looking at.
// Chrome handles the key itself, so it never reaches RemNote's own shortcuts,
// and you can rebind it at chrome://extensions/shortcuts.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-pause') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle-pause' });
  } catch (_) {
    /* not a RemNote tab — no content script to receive it */
  }
});
