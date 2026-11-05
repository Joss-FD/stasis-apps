# Stasis Apps

A small hub of single-purpose tools, each one a tab. Plain HTML/CSS/JS — no build step, works on GitHub Pages.

## Apps

| Tab | Status |
| --- | --- |
| 🃏 Trade Calculator | Blended card + cash trade maths |
| 📷 Cert Scanner | Scan PSA slab barcodes / QR codes into a de-duplicated list, copy one cert per line for CardUploader |

## Layout

```
index.html          hub shell (header + tabs + view)
css/hub.css         shared theme and building blocks (.card, .grid, .field, buttons…)
js/hub.js           registry, lazy loader, #/hash router
js/apps.js          the list of tabs  ← edit this to add/reorder apps
apps/<id>/app.js    the app (calls Hub.register)
apps/<id>/style.css optional, scoped under .app-<id>
apps/_template/     copy this to start a new app
```

## Adding an app

1. Copy `apps/_template/` to `apps/<id>/` and replace `my-app` with `<id>` in both files.
2. Add `{ id: '<id>', name: 'Name', icon: '🔧' }` to `js/apps.js`.

Each app gets `mount(el, ctx)` when its tab opens and `unmount()` when you leave it (release cameras, timers, etc. there). `ctx.storage` is a per-app localStorage helper. Apps are only loaded the first time their tab is opened, and each tab has its own URL (`#/trade-calculator`, `#/camera`).

## Running locally

Opening `index.html` directly works. The Cert Scanner needs HTTPS or `localhost`, so for that tab run e.g. `python3 -m http.server` and open http://localhost:8000.
