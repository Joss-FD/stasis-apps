/*
 * New app template.
 *  1. Copy this folder to apps/<your-id>/
 *  2. Replace 'my-app' below with <your-id>
 *  3. Add { id: '<your-id>', name: '…', icon: '…' } to js/apps.js
 */
Hub.register('my-app', {
  mount(el, ctx) {
    // ctx.storage.get(key, fallback) / ctx.storage.set(key, value) — saved per app.
    el.innerHTML = `
      <div class="card">
        <div class="header">
          <div class="title-wrap">
            <h1>My App</h1>
            <div class="subtitle">What this tool does.</div>
          </div>
        </div>
        <div class="actions">
          <button class="primary" data-action="go">Go</button>
        </div>
      </div>
    `;
    el.querySelector('[data-action="go"]').addEventListener('click', () => {
      // …
    });
  },

  unmount() {
    // Stop timers, cameras, intervals, global listeners, etc.
  },
});
