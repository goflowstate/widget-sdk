/* global CanvasWidget */
// Hello World — Canvas Widget SPA
// Minimal counter widget demonstrating SDK basics.
// Runs in a sandboxed iframe — no build step required.

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────

  var state = {
    count: 0,
    isExpanded: false,
  };

  var widget = null; // SDK instance — null in standalone mode

  // ── DOM refs ──────────────────────────────────────────────────

  var els = {};

  // ── DOM builder ───────────────────────────────────────────────

  function buildUI() {
    var app = document.getElementById('app');
    app.style.width = '100vw';
    app.style.height = '100vh';

    var root = document.createElement('div');
    root.className = 'hw-widget';
    root.id = 'hw-widget';

    // ── Collapsed view: count badge only ──
    var collapsed = document.createElement('div');
    collapsed.className = 'hw-collapsed';
    collapsed.id = 'hw-collapsed';

    var badge = document.createElement('div');
    badge.className = 'hw-badge';
    badge.id = 'hw-badge';
    badge.textContent = '0';

    var label = document.createElement('div');
    label.className = 'hw-label';
    label.textContent = 'Hello World';

    collapsed.appendChild(badge);
    collapsed.appendChild(label);

    // ── Expanded view: count + controls + reset ──
    var expanded = document.createElement('div');
    expanded.className = 'hw-expanded';
    expanded.id = 'hw-expanded';

    var title = document.createElement('div');
    title.className = 'hw-title';
    title.textContent = 'Hello World Counter';

    var countDisplay = document.createElement('div');
    countDisplay.className = 'hw-count';
    countDisplay.id = 'hw-count';
    countDisplay.textContent = '0';

    var controls = document.createElement('div');
    controls.className = 'hw-controls';

    var btnMinus = document.createElement('button');
    btnMinus.className = 'hw-btn hw-btn-secondary';
    btnMinus.textContent = '−';
    btnMinus.addEventListener('click', function (e) {
      e.stopPropagation();
      decrement();
    });

    var btnPlus = document.createElement('button');
    btnPlus.className = 'hw-btn hw-btn-primary';
    btnPlus.textContent = '+';
    btnPlus.addEventListener('click', function (e) {
      e.stopPropagation();
      increment();
    });

    controls.appendChild(btnMinus);
    controls.appendChild(btnPlus);

    var btnReset = document.createElement('button');
    btnReset.className = 'hw-btn hw-btn-reset';
    btnReset.textContent = 'Reset';
    btnReset.addEventListener('click', function (e) {
      e.stopPropagation();
      reset();
    });

    expanded.appendChild(title);
    expanded.appendChild(countDisplay);
    expanded.appendChild(controls);
    expanded.appendChild(btnReset);

    root.appendChild(collapsed);
    root.appendChild(expanded);
    app.appendChild(root);

    // Cache refs
    els.root = root;
    els.badge = badge;
    els.countDisplay = countDisplay;

    syncUI();
  }

  // ── UI sync ───────────────────────────────────────────────────

  function syncUI() {
    els.badge.textContent = String(state.count);
    els.countDisplay.textContent = String(state.count);

    if (state.isExpanded) {
      els.root.classList.add('is-expanded');
    } else {
      els.root.classList.remove('is-expanded');
    }
  }

  // ── Counter actions ───────────────────────────────────────────

  function increment() {
    state.count += 1;
    syncUI();
    persist();
  }

  function decrement() {
    state.count = Math.max(0, state.count - 1);
    syncUI();
    persist();
  }

  function reset() {
    state.count = 0;
    syncUI();
    persist();
  }

  function persist() {
    if (widget) {
      widget.storage.set('count', state.count).catch(function (err) {
        if (typeof console !== 'undefined') {
          console.warn('[HelloWorld] storage.set failed:', err);
        }
      });
    }
  }

  // ── SDK integration ───────────────────────────────────────────

  function initSDK() {
    if (typeof CanvasWidget === 'undefined') {
      // Running standalone without the SDK — UI still works fine
      return;
    }

    CanvasWidget.init()
      .then(function (sdk) {
        widget = sdk;

        // Restore persisted count
        return sdk.storage.get('count').then(function (saved) {
          if (typeof saved === 'number') {
            state.count = saved;
          }

          // Sync display state (collapsed vs expanded)
          function applyDisplayState(displayState) {
            state.isExpanded = displayState === 'expanded' || displayState === 'expanding';
            syncUI();
          }

          applyDisplayState(sdk.state);
          sdk.onStateChange(applyDisplayState);

          syncUI();
        });
      })
      .catch(function (err) {
        // Timeout is expected when opening standalone in a browser tab
        if (typeof console !== 'undefined') {
          console.warn('[HelloWorld] SDK init timed out (standalone mode):', err.message);
        }
      });
  }

  // ── Boot ──────────────────────────────────────────────────────

  function boot() {
    buildUI();
    initSDK();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
