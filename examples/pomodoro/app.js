/* global CanvasWidget */
// Pomodoro Timer — Canvas Widget SPA
// Vanilla JS, no build step. Runs inside a sandboxed iframe.

(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────

  var DEFAULT_TIMES = {
    work: 25 * 60,
    shortBreak: 5 * 60,
    longBreak: 15 * 60,
  };

  var MODE_COLORS = {
    work: '#10b981',
    shortBreak: '#3b82f6',
    longBreak: '#8b5cf6',
  };

  var MODE_COLORS_LIGHT = {
    work: '#34d399',
    shortBreak: '#60a5fa',
    longBreak: '#a78bfa',
  };

  var MODE_LABELS = {
    work: 'Focus',
    shortBreak: 'Short Break',
    longBreak: 'Long Break',
  };

  var RADIUS = 80;
  var CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ── State ─────────────────────────────────────────────────────

  var state = {
    mode: 'work',
    timeRemaining: DEFAULT_TIMES.work,
    isRunning: false,
    completedSessions: 0,
    isExpanded: false,
  };

  var timerInterval = null;
  var lastTick = 0;
  var widget = null; // SDK instance — null in standalone mode

  // ── Cached DOM refs ───────────────────────────────────────────

  var els = {};

  // ── SVG helpers ───────────────────────────────────────────────

  function makeSvgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (k) {
      el.setAttribute(k, attrs[k]);
    });
    return el;
  }

  function makePlayIcon() {
    var svg = makeSvgEl('svg', {
      width: '20',
      height: '20',
      viewBox: '0 0 24 24',
      fill: 'currentColor',
    });
    svg.appendChild(makeSvgEl('path', { d: 'M5 3l14 9-14 9V3z' }));
    return svg;
  }

  function makePauseIcon() {
    var svg = makeSvgEl('svg', {
      width: '20',
      height: '20',
      viewBox: '0 0 24 24',
      fill: 'currentColor',
    });
    svg.appendChild(makeSvgEl('rect', { x: '6', y: '4', width: '4', height: '16', rx: '1' }));
    svg.appendChild(makeSvgEl('rect', { x: '14', y: '4', width: '4', height: '16', rx: '1' }));
    return svg;
  }

  function makeResetIcon() {
    var svg = makeSvgEl('svg', {
      width: '14',
      height: '14',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
    svg.appendChild(makeSvgEl('path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }));
    svg.appendChild(makeSvgEl('path', { d: 'M3 3v5h5' }));
    return svg;
  }

  // ── DOM builder ───────────────────────────────────────────────

  function el(tag, props) {
    var node = document.createElement(tag);
    if (props && props.className) node.className = props.className;
    if (props && props.id) node.id = props.id;
    if (props && props.title) node.title = props.title;
    if (props && props.textContent) node.textContent = props.textContent;
    return node;
  }

  function buildUI() {
    var app = document.getElementById('app');
    app.style.width = '100vw';
    app.style.height = '100vh';

    // Root widget div
    var widget_div = el('div', { className: 'pomodoro-widget', id: 'pomodoro-widget' });

    // ── Header: mode buttons ──
    var header = el('div', { className: 'pomodoro-header', id: 'pomodoro-header' });
    var modeBtns = {};
    ['work', 'shortBreak', 'longBreak'].forEach(function (mode) {
      var btn = el('button', {
        className: 'mode-btn',
        id: 'mode-btn-' + mode,
        textContent: MODE_LABELS[mode],
      });
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        setMode(mode);
      });
      modeBtns[mode] = btn;
      header.appendChild(btn);
    });
    widget_div.appendChild(header);

    // ── Timer ring ──
    var timerContainer = el('div', { className: 'timer-container', id: 'timer-container' });

    var glowBg = el('div', { className: 'timer-glow-bg', id: 'timer-glow-bg' });
    timerContainer.appendChild(glowBg);

    // SVG
    var svg = makeSvgEl('svg', { class: 'timer-svg', id: 'timer-svg', viewBox: '0 0 180 180' });

    var defs = makeSvgEl('defs', {});

    var gradient = makeSvgEl('linearGradient', {
      id: 'timerGradient',
      x1: '0%',
      y1: '0%',
      x2: '100%',
      y2: '100%',
    });
    var stop0 = makeSvgEl('stop', { id: 'grad-stop-0', offset: '0%' });
    var stop1 = makeSvgEl('stop', { id: 'grad-stop-1', offset: '100%' });
    gradient.appendChild(stop0);
    gradient.appendChild(stop1);
    defs.appendChild(gradient);

    var glowFilter = makeSvgEl('filter', { id: 'timerGlow' });
    var feBlur = makeSvgEl('feGaussianBlur', { stdDeviation: '4', result: 'blur' });
    var feComp = makeSvgEl('feComposite', { in: 'SourceGraphic', in2: 'blur', operator: 'over' });
    glowFilter.appendChild(feBlur);
    glowFilter.appendChild(feComp);
    defs.appendChild(glowFilter);

    svg.appendChild(defs);

    var bgCircle = makeSvgEl('circle', {
      class: 'timer-circle-bg',
      cx: '90',
      cy: '90',
      r: String(RADIUS),
    });
    svg.appendChild(bgCircle);

    var glowCircle = makeSvgEl('circle', {
      class: 'timer-circle-glow',
      id: 'timer-glow-circle',
      cx: '90',
      cy: '90',
      r: String(RADIUS),
      'stroke-dasharray': String(CIRCUMFERENCE),
      filter: 'url(#timerGlow)',
    });
    svg.appendChild(glowCircle);

    var progressCircle = makeSvgEl('circle', {
      class: 'timer-circle-progress',
      id: 'timer-progress-circle',
      cx: '90',
      cy: '90',
      r: String(RADIUS),
      stroke: 'url(#timerGradient)',
      'stroke-dasharray': String(CIRCUMFERENCE),
    });
    svg.appendChild(progressCircle);

    timerContainer.appendChild(svg);

    // Timer display overlay
    var timerDisplay = el('div', { className: 'timer-display' });
    var timeText = el('div', { className: 'time-text', id: 'time-text', textContent: '25:00' });
    var sessionCount = el('div', {
      className: 'session-count',
      id: 'session-count',
      textContent: 'Session #1',
    });
    timerDisplay.appendChild(timeText);
    timerDisplay.appendChild(sessionCount);
    timerContainer.appendChild(timerDisplay);

    widget_div.appendChild(timerContainer);

    // ── Controls ──
    var controls = el('div', { className: 'controls' });

    var btnReset = el('button', {
      className: 'control-btn btn-secondary',
      id: 'btn-reset',
      title: 'Reset Timer',
    });
    btnReset.appendChild(makeResetIcon());
    btnReset.addEventListener('click', function (e) {
      e.stopPropagation();
      resetTimer();
    });

    var btnPlayPause = el('button', {
      className: 'control-btn btn-primary',
      id: 'btn-playpause',
      title: 'Start',
    });
    btnPlayPause.appendChild(makePlayIcon());
    btnPlayPause.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleTimer();
    });

    controls.appendChild(btnReset);
    controls.appendChild(btnPlayPause);
    widget_div.appendChild(controls);

    app.appendChild(widget_div);

    // Cache refs
    els.widget = widget_div;
    els.timerContainer = timerContainer;
    els.glowBg = glowBg;
    els.glowCircle = glowCircle;
    els.progressCircle = progressCircle;
    els.gradStop0 = stop0;
    els.gradStop1 = stop1;
    els.timeText = timeText;
    els.sessionCount = sessionCount;
    els.btnPlayPause = btnPlayPause;
    els.btnReset = btnReset;
    els.modeBtns = modeBtns;

    syncUI();
  }

  // ── Sync UI to state ──────────────────────────────────────────

  function formatTime(seconds) {
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function syncUI() {
    var color = MODE_COLORS[state.mode];
    var lightColor = MODE_COLORS_LIGHT[state.mode];
    var totalTime = DEFAULT_TIMES[state.mode];
    var progress = state.timeRemaining / totalTime;
    var dashOffset = CIRCUMFERENCE * (1 - progress);

    // Glow background
    els.glowBg.style.background = 'radial-gradient(circle, ' + color + '10 0%, transparent 70%)';

    // Gradient stops
    els.gradStop0.setAttribute('stop-color', color);
    els.gradStop1.setAttribute('stop-color', lightColor);

    // Glow circle
    els.glowCircle.setAttribute('stroke', color);
    els.glowCircle.setAttribute('stroke-dashoffset', String(dashOffset));

    // Progress circle
    els.progressCircle.setAttribute('stroke-dashoffset', String(dashOffset));

    // Time text
    els.timeText.textContent = formatTime(state.timeRemaining);
    els.timeText.style.color = state.isRunning ? color : '';

    // Session count
    els.sessionCount.textContent = 'Session #' + (state.completedSessions + 1);

    // Mode buttons
    Object.keys(els.modeBtns).forEach(function (mode) {
      var btn = els.modeBtns[mode];
      var isActive = mode === state.mode;
      btn.className = 'mode-btn' + (isActive ? ' active' : '');
      btn.style.color = isActive ? color : '';
      btn.style.borderColor = isActive ? color : '';
    });

    // Play/pause button
    var playBtn = els.btnPlayPause;
    if (state.isRunning) {
      playBtn.style.background = 'rgba(255, 255, 255, 0.08)';
      playBtn.style.color = color;
      playBtn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
      playBtn.title = 'Pause';
      // Replace icon: remove old, append new
      while (playBtn.firstChild) playBtn.removeChild(playBtn.firstChild);
      playBtn.appendChild(makePauseIcon());
    } else {
      playBtn.style.background = 'linear-gradient(135deg, ' + color + ', ' + lightColor + ')';
      playBtn.style.color = '#fff';
      playBtn.style.boxShadow = '0 4px 16px ' + color + '40, 0 2px 8px rgba(0, 0, 0, 0.2)';
      playBtn.title = 'Start';
      while (playBtn.firstChild) playBtn.removeChild(playBtn.firstChild);
      playBtn.appendChild(makePlayIcon());
    }

    // Pulse animation
    if (state.isRunning) {
      els.timerContainer.classList.add('is-running');
    } else {
      els.timerContainer.classList.remove('is-running');
    }

    // Expanded class
    if (state.isExpanded) {
      els.widget.classList.add('is-expanded');
    } else {
      els.widget.classList.remove('is-expanded');
    }
  }

  // ── Timer logic ───────────────────────────────────────────────

  function startInterval() {
    lastTick = Date.now();
    timerInterval = setInterval(function () {
      var now = Date.now();
      var delta = Math.floor((now - lastTick) / 1000);

      if (delta >= 1) {
        var next = Math.max(0, state.timeRemaining - delta);
        state.timeRemaining = next;
        lastTick = now;

        if (next === 0) {
          state.isRunning = false;
          clearInterval(timerInterval);
          timerInterval = null;

          if (state.mode === 'work') {
            state.completedSessions += 1;
            if (widget) {
              widget.emit('pomodoro:session-completed', {
                sessions: state.completedSessions,
              });
            }
          } else {
            if (widget) {
              widget.emit('pomodoro:break-started', { mode: state.mode });
            }
          }
        }

        syncUI();
      }
    }, 1000);
  }

  function stopInterval() {
    if (timerInterval !== null) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function toggleTimer() {
    state.isRunning = !state.isRunning;

    if (state.isRunning) {
      startInterval();
      if (widget) {
        widget.log('info', 'Timer started', { mode: state.mode });
        widget.emit('pomodoro:session-started', { mode: state.mode });
      }
    } else {
      stopInterval();
    }

    syncUI();
  }

  function resetTimer() {
    stopInterval();
    state.isRunning = false;
    state.timeRemaining = DEFAULT_TIMES[state.mode];
    syncUI();
  }

  function setMode(mode) {
    stopInterval();
    state.mode = mode;
    state.isRunning = false;
    state.timeRemaining = DEFAULT_TIMES[mode];
    syncUI();
  }

  // ── SDK integration ───────────────────────────────────────────

  function initSDK() {
    if (typeof CanvasWidget === 'undefined') {
      // Running standalone without the SDK bundle — UI works fine
      return;
    }

    CanvasWidget.init()
      .then(function (sdk) {
        widget = sdk;

        function applyDisplayState(displayState) {
          state.isExpanded = displayState === 'expanded' || displayState === 'expanding';
          syncUI();
        }

        applyDisplayState(sdk.state);
        sdk.onStateChange(applyDisplayState);

        sdk.subscribe('space:entered', function () {
          widget.log('info', 'User entered space');
        });

        sdk.subscribe('call:joined', function () {
          widget.log('info', 'Call joined — timer available');
        });
      })
      .catch(function (err) {
        // Timeout expected when opening standalone in a browser tab
        if (typeof console !== 'undefined') {
          console.warn('[Pomodoro] SDK init timed out (standalone mode):', err.message);
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
