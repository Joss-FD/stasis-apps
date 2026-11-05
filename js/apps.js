/*
 * App manifest — the only file you need to touch to add a new tab.
 *
 *   1. Copy apps/_template/ to apps/<your-id>/
 *   2. Add an entry below with the same id.
 *
 * Each app's script + stylesheet are loaded the first time its tab is opened.
 * Order here = order of the tabs. The first entry is the default tab.
 */
Hub.setApps([
  { id: 'trade-calculator', name: 'Trade Calculator', icon: '🃏' },
  { id: 'camera',           name: 'Cert Scanner',     icon: '📷' },
]);
