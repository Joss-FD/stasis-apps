/*
 * Hub core: app registry, lazy loader and hash router.
 *
 * Plain <script> files (no modules, no build step) so the site works on
 * GitHub Pages and when opening index.html straight from disk.
 *
 * App contract — apps/<id>/app.js must call:
 *
 *   Hub.register('<id>', {
 *     mount(el, ctx) { ... },   // required: render into `el`
 *     unmount() { ... },        // optional: clean up (timers, camera, listeners)
 *   });
 *
 * `ctx` gives the app: { id, storage } where storage is a namespaced
 * localStorage helper: ctx.storage.get(key, fallback) / ctx.storage.set(key, value).
 */
(function () {
  const apps = [];               // manifest entries, in tab order
  const modules = {};            // id -> registered module
  const loading = {};            // id -> Promise
  let current = null;            // { id, module }

  const $tabs = () => document.getElementById('hubTabs');
  const $view = () => document.getElementById('hubView');

  function storageFor(id) {
    const prefix = 'hub:' + id + ':';
    return {
      get(key, fallback) {
        try {
          const raw = localStorage.getItem(prefix + key);
          return raw === null ? fallback : JSON.parse(raw);
        } catch (e) { return fallback; }
      },
      set(key, value) {
        try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch (e) {}
      },
    };
  }

  function loadAsset(tag, attrs) {
    return new Promise((resolve, reject) => {
      const node = document.createElement(tag);
      Object.assign(node, attrs);
      node.onload = resolve;
      node.onerror = () => reject(new Error('Failed to load ' + (attrs.src || attrs.href)));
      document.head.appendChild(node);
    });
  }

  function loadApp(id) {
    if (modules[id]) return Promise.resolve(modules[id]);
    if (!loading[id]) {
      const base = 'apps/' + id + '/';
      // Stylesheet is optional — ignore a missing one.
      const css = loadAsset('link', { rel: 'stylesheet', href: base + 'style.css' }).catch(() => {});
      const js = loadAsset('script', { src: base + 'app.js' });
      loading[id] = Promise.all([css, js]).then(() => {
        if (!modules[id]) throw new Error('apps/' + id + '/app.js did not call Hub.register("' + id + '", …)');
        return modules[id];
      });
      loading[id].catch(() => { delete loading[id]; });
    }
    return loading[id];
  }

  function renderTabs(activeId) {
    const nav = $tabs();
    nav.innerHTML = '';
    apps.forEach((app) => {
      const a = document.createElement('a');
      a.href = '#/' + app.id;
      a.className = 'hub-tab' + (app.id === activeId ? ' active' : '');
      a.setAttribute('role', 'tab');
      a.setAttribute('aria-selected', app.id === activeId ? 'true' : 'false');
      a.innerHTML = '<span class="hub-tab-icon"></span><span class="hub-tab-name"></span>';
      a.firstChild.textContent = app.icon || '•';
      a.lastChild.textContent = app.name;
      nav.appendChild(a);
    });
  }

  async function show(id) {
    const entry = apps.find((a) => a.id === id) || apps[0];
    if (!entry) return;
    if (current && current.id === entry.id) return;

    // Tear down the previous app so things like the camera are released.
    if (current && current.module.unmount) {
      try { current.module.unmount(); } catch (e) { console.error(e); }
    }
    current = null;

    renderTabs(entry.id);
    document.title = entry.name + ' · Stasis Apps';
    const view = $view();
    view.innerHTML = '<div class="card hub-status">Loading…</div>';

    try {
      const mod = await loadApp(entry.id);
      // User may have switched tabs while this one was loading.
      if (currentRouteId() !== entry.id) return;
      view.innerHTML = '';
      const el = document.createElement('section');
      el.className = 'app app-' + entry.id;
      view.appendChild(el);
      mod.mount(el, { id: entry.id, storage: storageFor(entry.id) });
      current = { id: entry.id, module: mod };
    } catch (err) {
      console.error(err);
      view.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'card hub-status hub-error';
      box.textContent = 'Could not load “' + entry.name + '”: ' + err.message;
      view.appendChild(box);
    }
  }

  function currentRouteId() {
    const m = location.hash.match(/^#\/([\w-]+)/);
    const id = m ? m[1] : null;
    return apps.some((a) => a.id === id) ? id : (apps[0] && apps[0].id);
  }

  window.Hub = {
    register(id, module) {
      if (!module || typeof module.mount !== 'function') {
        throw new Error('Hub.register("' + id + '") needs a mount(el, ctx) function');
      }
      modules[id] = module;
    },
    setApps(list) {
      apps.splice(0, apps.length, ...list);
      window.addEventListener('hashchange', () => show(currentRouteId()));
      show(currentRouteId());
    },
  };
})();
