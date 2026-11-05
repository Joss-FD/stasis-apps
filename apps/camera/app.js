/*
 * Cert Scanner — scan PSA slabs, collect cert numbers, copy them one per line.
 *
 * Reads the barcode on the front label or the QR code on the back
 * (QR text looks like https://www.psacard.com/cert/12345678/psa).
 *
 * Decoding uses the browser's built-in BarcodeDetector where it exists
 * (Android Chrome) and falls back to the vendored ZXing build otherwise
 * (iPhone Safari, desktop) — see apps/camera/vendor/.
 */
(function () {
  const VENDOR = 'apps/camera/vendor/';
  const FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'qr_code', 'data_matrix'];
  const SCAN_INTERVAL_MS = 120;   // time between decode attempts
  const COOLDOWN_MS = 2500;       // ignore the same cert for this long after seeing it

  /* ---------- cert parsing ---------- */

  // Returns the cert number from a scanned/typed string, or null.
  function extractCert(raw) {
    const text = String(raw || '').trim();
    const url = text.match(/psacard\.com\/cert\/(\d{6,10})/i);
    if (url) return url[1];
    const digits = text.replace(/[\s-]/g, '');
    return /^\d{8,10}$/.test(digits) ? digits : null;
  }

  /* ---------- barcode detector (native or vendored) ---------- */

  let detectorPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  function getDetector() {
    if (!detectorPromise) {
      detectorPromise = (async () => {
        if ('BarcodeDetector' in window) {
          try {
            const supported = await window.BarcodeDetector.getSupportedFormats();
            const formats = FORMATS.filter((f) => supported.includes(f));
            if (formats.includes('qr_code') && formats.includes('code_128')) {
              return new window.BarcodeDetector({ formats });
            }
          } catch (e) { /* fall through to vendored decoder */ }
        }
        if (!window.BarcodeDetectionAPI) await loadScript(VENDOR + 'barcode-detector.js');
        const api = window.BarcodeDetectionAPI;
        const wasmUrl = new URL(VENDOR + 'zxing_reader.wasm', location.href).href;
        api.prepareZXingModule({
          overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
          fireImmediately: true,
        });
        return new api.BarcodeDetector({ formats: FORMATS });
      })();
      detectorPromise.catch(() => { detectorPromise = null; });
    }
    return detectorPromise;
  }

  /* ---------- feedback ---------- */

  let audioCtx = null;
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }
  function beep(freq, ms) {
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + ms / 1000);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + ms / 1000);
    } catch (e) {}
  }
  function vibrate(pattern) {
    try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) {}
  }

  /* ---------- app ---------- */

  let teardown = null;

  Hub.register('camera', {
    mount(el, ctx) {
      let certs = ctx.storage.get('certs', []);
      const settings = Object.assign({ confirm: false, sound: true, facing: 'environment' }, ctx.storage.get('settings', {}));

      let stream = null;
      let detector = null;
      let scanTimer = null;
      let pending = null;          // cert awaiting confirmation
      let torchOn = false;
      let wakeLock = null;
      let resumeOnVisible = false;
      const lastSeen = new Map();  // cert -> timestamp
      let toastTimer = null;
      let pillTimer = null;

      el.innerHTML = `
        <div class="card cs-scan-card">
          <div class="header">
            <div class="title-wrap">
              <h1>Cert Scanner</h1>
              <div class="subtitle">Scan a PSA slab's front barcode or back QR code. Copy the list into CardUploader, one cert per line.</div>
            </div>
          </div>

          <div class="cs-stage">
            <video class="cs-video" playsinline muted autoplay></video>
            <div class="cs-guide" hidden></div>

            <div class="cs-topbar" hidden>
              <span class="cs-count-chip" data-el="countChip">0 certs</span>
              <span class="cs-cam-buttons">
                <button class="cs-icon" data-act="torch" hidden aria-label="Torch">🔦</button>
                <button class="cs-icon" data-act="flip" aria-label="Switch camera">🔄</button>
                <button class="cs-icon" data-act="stop" aria-label="Stop camera">✕</button>
              </span>
            </div>

            <div class="cs-pill" hidden></div>

            <button class="cs-idle" data-act="start">
              <span class="cs-idle-icon">📷</span>
              <span class="cs-idle-title">Tap to start scanning</span>
              <span class="cs-idle-sub" data-el="idleSub">Hold the slab label inside the frame</span>
            </button>

            <div class="cs-confirm" hidden>
              <div class="cs-confirm-box">
                <div class="cs-confirm-label">Add this cert?</div>
                <div class="cs-confirm-num" data-el="confirmNum"></div>
                <div class="cs-confirm-actions">
                  <button class="secondary" data-act="skip">Skip</button>
                  <button class="primary" data-act="accept">✓ Add</button>
                </div>
              </div>
            </div>
          </div>

          <div class="cs-options">
            <label class="cs-switch">
              <input type="checkbox" data-el="confirmToggle" />
              <span class="cs-switch-track"></span>
              <span>Confirm each scan</span>
            </label>
            <label class="cs-switch">
              <input type="checkbox" data-el="soundToggle" />
              <span class="cs-switch-track"></span>
              <span>Sound</span>
            </label>
          </div>

          <form class="cs-manual" data-el="manualForm" autocomplete="off">
            <input data-el="manualInput" type="text" inputmode="numeric" enterkeyhint="done"
                   placeholder="Type or paste cert number(s)" aria-label="Cert number" />
            <button class="secondary" type="submit">Add</button>
          </form>
        </div>

        <div class="card cs-list-card">
          <div class="cs-list-head">
            <h2>Certs <span class="cs-count" data-el="count">0</span></h2>
            <button class="cs-link" data-act="clear">Clear all</button>
          </div>

          <div class="cs-list-actions">
            <button class="primary cs-copy" data-act="copy">📋 Copy all</button>
            <button class="secondary" data-act="share" hidden>Share</button>
          </div>

          <ol class="cs-list" data-el="list"></ol>
          <div class="cs-empty" data-el="empty">No certs yet — start scanning or type one in above.</div>
        </div>

        <div class="cs-toast" hidden>
          <span data-el="toastText"></span>
          <button data-act="undo" hidden>Undo</button>
        </div>
      `;

      const q = (sel) => el.querySelector(sel);
      const E = (name) => el.querySelector('[data-el="' + name + '"]');
      const A = (name) => el.querySelector('[data-act="' + name + '"]');

      const stage = q('.cs-stage');
      const video = q('.cs-video');
      const guide = q('.cs-guide');
      const topbar = q('.cs-topbar');
      const pill = q('.cs-pill');
      const idle = A('start');
      const confirmBox = q('.cs-confirm');
      const toast = q('.cs-toast');
      let undoFn = null;

      /* ----- persistence + rendering ----- */

      function save() {
        ctx.storage.set('certs', certs);
      }
      function saveSettings() {
        ctx.storage.set('settings', settings);
      }

      function render(highlight) {
        E('count').textContent = certs.length;
        E('countChip').textContent = certs.length + (certs.length === 1 ? ' cert' : ' certs');
        E('empty').hidden = certs.length > 0;
        A('copy').disabled = certs.length === 0;
        A('share').disabled = certs.length === 0;
        A('clear').hidden = certs.length === 0;

        const list = E('list');
        list.innerHTML = '';
        certs.forEach((cert) => {
          const li = document.createElement('li');
          li.className = 'cs-item' + (cert === highlight ? ' cs-flash-row' : '');
          li.dataset.cert = cert;
          const num = document.createElement('span');
          num.className = 'cs-cert';
          num.textContent = cert;
          const rm = document.createElement('button');
          rm.className = 'cs-remove';
          rm.setAttribute('aria-label', 'Remove ' + cert);
          rm.textContent = '✕';
          rm.dataset.remove = cert;
          li.append(num, rm);
          list.appendChild(li);
        });
      }

      /* ----- toast + status pill ----- */

      function showToast(text, onUndo) {
        clearTimeout(toastTimer);
        E('toastText').textContent = text;
        undoFn = onUndo || null;
        A('undo').hidden = !onUndo;
        toast.hidden = false;
        toastTimer = setTimeout(() => { toast.hidden = true; undoFn = null; }, onUndo ? 5000 : 2200);
      }

      function showPill(text, tone) {
        clearTimeout(pillTimer);
        pill.textContent = text;
        pill.className = 'cs-pill cs-pill-' + (tone || 'info');
        pill.hidden = false;
        if (tone === 'ok' || tone === 'warn') {
          stage.classList.remove('cs-hit-ok', 'cs-hit-warn');
          void stage.offsetWidth; // restart the flash animation
          stage.classList.add(tone === 'ok' ? 'cs-hit-ok' : 'cs-hit-warn');
        }
        pillTimer = setTimeout(() => {
          if (stream && !pending) showPill('Scanning…', 'info');
          else pill.hidden = true;
        }, tone === 'info' ? 60000 : 1800);
      }

      /* ----- adding certs ----- */

      function addCert(cert, source) {
        if (certs.includes(cert)) {
          if (source === 'scan') {
            showPill('Already added · ' + cert, 'warn');
            if (settings.sound) beep(330, 160);
            vibrate([40, 60, 40]);
          }
          flashRow(cert);
          return false;
        }
        certs.push(cert);
        save();
        render(cert);
        if (source === 'scan') {
          showPill('✓ Added ' + cert, 'ok');
          if (settings.sound) beep(1046, 90);
          vibrate(60);
        }
        return true;
      }

      function flashRow(cert) {
        const row = E('list').querySelector('[data-cert="' + cert + '"]');
        if (!row) return;
        row.classList.remove('cs-flash-row');
        void row.offsetWidth;
        row.classList.add('cs-flash-dup');
        setTimeout(() => row.classList.remove('cs-flash-dup'), 1200);
      }

      function handleScan(cert) {
        const now = Date.now();
        const prev = lastSeen.get(cert) || 0;
        lastSeen.set(cert, now);
        if (now - prev < COOLDOWN_MS) return;

        if (certs.includes(cert) || !settings.confirm) {
          addCert(cert, 'scan');
          return;
        }
        // Confirm mode: pause and ask.
        pending = cert;
        E('confirmNum').textContent = cert;
        confirmBox.hidden = false;
        clearTimeout(pillTimer);
        pill.hidden = true;
        if (settings.sound) beep(784, 70);
        vibrate(30);
      }

      function resolvePending(accept) {
        if (!pending) return;
        const cert = pending;
        pending = null;
        confirmBox.hidden = true;
        lastSeen.set(cert, Date.now());
        if (accept) addCert(cert, 'scan');
        else showPill('Skipped ' + cert, 'info');
      }

      /* ----- camera ----- */

      async function startCamera() {
        unlockAudio();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          E('idleSub').textContent = 'Camera needs HTTPS and a supported browser.';
          return;
        }
        // Release any current camera first — many phones can't open two at once.
        if (stream) stopCamera(true);
        idle.hidden = false;
        topbar.hidden = true;
        E('idleSub').textContent = 'Starting camera…';
        try {
          const [s, d] = await Promise.all([
            navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                facingMode: { ideal: settings.facing },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
            }),
            getDetector(),
          ]);
          stopCamera(true);
          stream = s;
          detector = d;
        } catch (err) {
          const msg = err && err.name === 'NotAllowedError'
            ? 'Camera permission was blocked. Allow it in your browser settings and try again.'
            : 'Could not start: ' + (err.message || err.name);
          E('idleSub').textContent = msg;
          return;
        }

        const track = stream.getVideoTracks()[0];
        try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {}
        const caps = (track.getCapabilities && track.getCapabilities()) || {};
        A('torch').hidden = !caps.torch;
        torchOn = false;
        A('torch').classList.remove('on');

        video.srcObject = stream;
        try { await video.play(); } catch (e) {}

        setRunningUI(true);
        showPill('Scanning…', 'info');
        requestWakeLock();
        scanLoop();
      }

      function stopCamera(keepUI) {
        clearTimeout(scanTimer);
        scanTimer = null;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
        video.srcObject = null;
        pending = null;
        confirmBox.hidden = true;
        releaseWakeLock();
        if (!keepUI) {
          setRunningUI(false);
          E('idleSub').textContent = 'Hold the slab label inside the frame';
        }
      }

      function setRunningUI(on) {
        idle.hidden = on;
        topbar.hidden = !on;
        guide.hidden = !on;
        video.classList.toggle('cs-live', on);
        if (!on) pill.hidden = true;
        stage.classList.toggle('cs-mirror', on && settings.facing === 'user');
      }

      async function scanLoop() {
        if (!stream) return;
        if (!pending && video.readyState >= 2 && !document.hidden) {
          try {
            const codes = await detector.detect(video);
            for (const code of codes) {
              const cert = extractCert(code.rawValue);
              if (cert) { handleScan(cert); break; }
            }
          } catch (e) { /* frame not ready / transient decode error */ }
        }
        if (stream) scanTimer = setTimeout(scanLoop, SCAN_INTERVAL_MS);
      }

      async function toggleTorch() {
        if (!stream) return;
        const track = stream.getVideoTracks()[0];
        try {
          await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
          torchOn = !torchOn;
          A('torch').classList.toggle('on', torchOn);
        } catch (e) {
          showToast('Torch not available on this camera');
        }
      }

      async function requestWakeLock() {
        try {
          if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
        } catch (e) { wakeLock = null; }
      }
      function releaseWakeLock() {
        try { wakeLock && wakeLock.release(); } catch (e) {}
        wakeLock = null;
      }

      function onVisibility() {
        if (document.hidden) {
          if (stream) { resumeOnVisible = true; stopCamera(); }
        } else if (resumeOnVisible) {
          resumeOnVisible = false;
          startCamera();
        }
      }

      /* ----- list actions ----- */

      async function copyAll() {
        if (!certs.length) return;
        const text = certs.join('\n');
        let ok = false;
        try {
          await navigator.clipboard.writeText(text);
          ok = true;
        } catch (e) {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try { ok = document.execCommand('copy'); } catch (err) {}
          ta.remove();
        }
        showToast(ok ? 'Copied ' + certs.length + ' cert' + (certs.length === 1 ? '' : 's') : 'Copy failed — long-press to copy instead');
        if (ok) {
          const btn = A('copy');
          btn.textContent = '✓ Copied';
          setTimeout(() => { btn.textContent = '📋 Copy all'; }, 1500);
        }
      }

      async function shareAll() {
        if (!certs.length || !navigator.share) return;
        try { await navigator.share({ text: certs.join('\n') }); } catch (e) {}
      }

      function clearAll() {
        if (!certs.length) return;
        const before = certs.slice();
        certs = [];
        lastSeen.clear();
        save();
        render();
        showToast('Cleared ' + before.length + (before.length === 1 ? ' cert' : ' certs'), () => { certs = before; save(); render(); });
      }

      function removeCert(cert) {
        const idx = certs.indexOf(cert);
        if (idx < 0) return;
        certs.splice(idx, 1);
        lastSeen.delete(cert);
        save();
        render();
        showToast('Removed ' + cert, () => {
          if (!certs.includes(cert)) certs.splice(Math.min(idx, certs.length), 0, cert);
          save();
          render(cert);
        });
      }

      function addManual(e) {
        e.preventDefault();
        const input = E('manualInput');
        const tokens = input.value.split(/[\s,;]+/).filter(Boolean);
        if (!tokens.length) return;
        let added = 0, dupes = 0, invalid = 0;
        tokens.forEach((t) => {
          const cert = extractCert(t);
          if (!cert) invalid++;
          else if (addCert(cert, 'manual')) added++;
          else dupes++;
        });
        const parts = [];
        if (added) parts.push('Added ' + added);
        if (dupes) parts.push(dupes + ' already in list');
        if (invalid) parts.push(invalid + ' not a valid cert (8–10 digits)');
        showToast(parts.join(' · '));
        if (!invalid) input.value = '';
      }

      /* ----- wiring ----- */

      E('confirmToggle').checked = settings.confirm;
      E('soundToggle').checked = settings.sound;
      E('confirmToggle').addEventListener('change', (e) => {
        settings.confirm = e.target.checked;
        saveSettings();
        if (!settings.confirm && pending) resolvePending(true);
      });
      E('soundToggle').addEventListener('change', (e) => {
        settings.sound = e.target.checked;
        saveSettings();
        if (settings.sound) { unlockAudio(); beep(1046, 60); }
      });

      idle.addEventListener('click', startCamera);
      A('stop').addEventListener('click', () => stopCamera());
      A('flip').addEventListener('click', () => {
        settings.facing = settings.facing === 'environment' ? 'user' : 'environment';
        saveSettings();
        startCamera();
      });
      A('torch').addEventListener('click', toggleTorch);
      A('accept').addEventListener('click', () => resolvePending(true));
      A('skip').addEventListener('click', () => resolvePending(false));
      A('copy').addEventListener('click', copyAll);
      A('share').addEventListener('click', shareAll);
      A('share').hidden = !navigator.share;
      A('clear').addEventListener('click', clearAll);
      A('undo').addEventListener('click', () => {
        if (undoFn) undoFn();
        undoFn = null;
        toast.hidden = true;
      });
      E('list').addEventListener('click', (e) => {
        const cert = e.target.dataset && e.target.dataset.remove;
        if (cert) removeCert(cert);
      });
      E('manualForm').addEventListener('submit', addManual);
      document.addEventListener('visibilitychange', onVisibility);

      // Warm up the decoder in the background so the first scan is instant.
      getDetector().catch(() => {});

      render();

      teardown = () => {
        document.removeEventListener('visibilitychange', onVisibility);
        clearTimeout(toastTimer);
        clearTimeout(pillTimer);
        stopCamera();
      };
    },

    unmount() {
      if (teardown) teardown();
      teardown = null;
    },
  });

  // Exposed for tests.
  window.__certScanner = { extractCert };
})();
