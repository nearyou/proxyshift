/**
 * ProxyShift — Anti-Detection Content Script
 *
 * Chrome MV3: this script runs in MAIN world (manifest.json world: "MAIN")
 *             → window is the page's real window; patches take effect directly.
 * Firefox MV2: this script runs in the isolated content-script world
 *              → we inject ALL patch code into the page via a <script> element.
 *
 * Single-file approach: patchPageContext() is defined as a named function so
 * its source can be obtained with .toString() and injected as a <script> string.
 * A window.__proxyShiftPatched guard prevents double-execution in MAIN world.
 */

(function () {
  'use strict';

  // ─── Patch code (injected into page context) ────────────────────────────────
  // IMPORTANT: this function must be completely self-contained — no closure
  // references to the outer scope, because it will be serialised with .toString().
  function patchPageContext() {
    if (window.__proxyShiftPatched) return;
    window.__proxyShiftPatched = true;

    // ── State ──────────────────────────────────────────────────────────────────
    var _timezonePatch = null;
    var _localePatch = null;
    var _canvasPatched = false;
    var _origCanvas = {};
    var _webrtcPatched = false;
    var _noiseSeed = (Math.random() * 0xffffff) | 0;

    // Store original RTC constructors before any patching
    var _OrigRTC = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection || null;

    // ── WebRTC helpers ─────────────────────────────────────────────────────────
    function applyWebRTC() {
      if (_webrtcPatched || !_OrigRTC) return;
      function BlockedRTC(config, constraints) {
        var safe = config ? Object.assign({}, config) : {};
        if (safe.iceServers) {
          safe.iceServers = safe.iceServers.map(function (s) {
            return s.credential ? s : { urls: [] };
          });
        }
        return new _OrigRTC(safe, constraints);
      }
      try {
        Object.setPrototypeOf(BlockedRTC, _OrigRTC);
        BlockedRTC.prototype = _OrigRTC.prototype;
        if (_OrigRTC.generateCertificate) {
          BlockedRTC.generateCertificate = _OrigRTC.generateCertificate.bind(_OrigRTC);
        }
        if ('RTCPeerConnection' in window) window.RTCPeerConnection = BlockedRTC;
        if ('webkitRTCPeerConnection' in window) window.webkitRTCPeerConnection = BlockedRTC;
        if ('mozRTCPeerConnection' in window) window.mozRTCPeerConnection = BlockedRTC;
        _webrtcPatched = true;
      } catch (_) {}
    }
    function removeWebRTC() {
      if (!_webrtcPatched || !_OrigRTC) return;
      try {
        if ('RTCPeerConnection' in window) window.RTCPeerConnection = _OrigRTC;
        if ('webkitRTCPeerConnection' in window) window.webkitRTCPeerConnection = _OrigRTC;
        if ('mozRTCPeerConnection' in window) window.mozRTCPeerConnection = _OrigRTC;
        _webrtcPatched = false;
      } catch (_) {}
    }

    // Apply WebRTC blocking immediately as a safe default before settings arrive
    applyWebRTC();

    // ── Apply / remove canvas patch ────────────────────────────────────────────
    function applyCanvas() {
      if (_canvasPatched) return;
      _origCanvas.toDataURL = HTMLCanvasElement.prototype.toDataURL;
      _origCanvas.getImageData = CanvasRenderingContext2D.prototype.getImageData;
      _origCanvas.toBlob = HTMLCanvasElement.prototype.toBlob;
      var seed = _noiseSeed;
      function addNoise(d) {
        var s = seed;
        for (var i = 0; i < d.length; i += 4) {
          s = (((s * 1664525) + 1013904223) | 0) >>> 0;
          var n = s & 1 ? 1 : -1;
          d[i] = Math.max(0, Math.min(255, d[i] + n));
        }
      }
      HTMLCanvasElement.prototype.toDataURL = function () {
        var ctx = this.getContext('2d');
        if (ctx && this.width > 0 && this.height > 0) {
          var id = ctx.getImageData(0, 0, this.width, this.height);
          addNoise(id.data); ctx.putImageData(id, 0, 0);
        }
        return _origCanvas.toDataURL.apply(this, arguments);
      };
      CanvasRenderingContext2D.prototype.getImageData = function () {
        var id = _origCanvas.getImageData.apply(this, arguments);
        addNoise(id.data);
        return id;
      };
      HTMLCanvasElement.prototype.toBlob = function (cb) {
        var ctx = this.getContext('2d');
        if (ctx && this.width > 0 && this.height > 0) {
          var id = ctx.getImageData(0, 0, this.width, this.height);
          addNoise(id.data); ctx.putImageData(id, 0, 0);
        }
        return _origCanvas.toBlob.apply(this, arguments);
      };
      _canvasPatched = true;
    }
    function removeCanvas() {
      if (!_canvasPatched) return;
      HTMLCanvasElement.prototype.toDataURL = _origCanvas.toDataURL;
      CanvasRenderingContext2D.prototype.getImageData = _origCanvas.getImageData;
      HTMLCanvasElement.prototype.toBlob = _origCanvas.toBlob;
      _canvasPatched = false;
    }

    // ── Apply / remove timezone patch ──────────────────────────────────────────
    function applyTimezone(tz) {
      if (!tz || tz === 'auto') return;
      if (_timezonePatch === tz) return;
      removeTimezone();
      var OrigDTF = Intl.DateTimeFormat;
      function PatchedDTF(locales, opts) {
        opts = opts || {};
        if (!opts.timeZone) opts = Object.assign({}, opts, { timeZone: tz });
        return new OrigDTF(locales, opts);
      }
      PatchedDTF.prototype = OrigDTF.prototype;
      PatchedDTF.supportedLocalesOf = OrigDTF.supportedLocalesOf.bind(OrigDTF);
      var origTZO = Date.prototype.getTimezoneOffset;
      function spoofedTZO() {
        try {
          var utc = new Date(this.toLocaleString('en-US', { timeZone: 'UTC' }));
          var local = new Date(this.toLocaleString('en-US', { timeZone: tz }));
          return (utc - local) / 60000;
        } catch (_) { return origTZO.call(this); }
      }
      var origLocale = {};
      ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach(function (m) {
        origLocale[m] = Date.prototype[m];
        Date.prototype[m] = function (lc, opts) {
          opts = opts || {};
          if (!opts.timeZone) opts = Object.assign({}, opts, { timeZone: tz });
          return origLocale[m].call(this, lc, opts);
        };
      });
      try { Intl.DateTimeFormat = PatchedDTF; } catch (_) {}
      try { Date.prototype.getTimezoneOffset = spoofedTZO; } catch (_) {}
      _timezonePatch = { tz: tz, OrigDTF: OrigDTF, origTZO: origTZO, origLocale: origLocale };
    }
    function removeTimezone() {
      if (!_timezonePatch) return;
      try { Intl.DateTimeFormat = _timezonePatch.OrigDTF; } catch (_) {}
      try { Date.prototype.getTimezoneOffset = _timezonePatch.origTZO; } catch (_) {}
      ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach(function (m) {
        try { Date.prototype[m] = _timezonePatch.origLocale[m]; } catch (_) {}
      });
      _timezonePatch = null;
    }

    // ── Apply / remove locale patch ────────────────────────────────────────────
    function applyLocale(locale) {
      if (!locale || locale === 'auto') return;
      if (_localePatch === locale) return;
      var langs = [locale, locale.split('-')[0]].filter(function (v, i, a) {
        return v && a.indexOf(v) === i;
      });
      try {
        Object.defineProperty(navigator, 'language', { get: function () { return langs[0]; }, configurable: true });
        Object.defineProperty(navigator, 'languages', { get: function () { return Object.freeze(langs.slice()); }, configurable: true });
        _localePatch = locale;
      } catch (_) {}
    }
    function removeLocale() {
      if (!_localePatch) return;
      try { delete navigator.language; } catch (_) {}
      try { delete navigator.languages; } catch (_) {}
      _localePatch = null;
    }

    // ── Apply settings ─────────────────────────────────────────────────────────
    function applySettings(settings) {
      if (!settings) {
        removeWebRTC(); removeTimezone(); removeLocale(); removeCanvas();
        return;
      }
      // WebRTC toggle
      if (settings.webrtcEnabled) applyWebRTC();
      else removeWebRTC();
      // Timezone toggle
      if (settings.timezoneEnabled && settings.timezone && settings.timezone !== 'auto') {
        applyTimezone(settings.timezone);
      } else {
        removeTimezone();
      }
      // Locale toggle
      if (settings.localeEnabled && settings.locale && settings.locale !== 'auto') {
        applyLocale(settings.locale);
      } else {
        removeLocale();
      }
      // Canvas fingerprint toggle
      if (settings.canvasFingerprintEnabled) applyCanvas();
      else removeCanvas();
    }

    // ── Settings bootstrap ─────────────────────────────────────────────────────
    // A: settings already injected by background's scripting.executeScript
    if (window.__proxyShiftSettings !== undefined) {
      applySettings(window.__proxyShiftSettings);
    }

    // B: custom event from background (MAIN world path)
    window.addEventListener('__proxyShiftSettingsUpdate', function (e) {
      applySettings(e.detail);
    });

    // C: postMessage relay from isolated-world content script (Firefox path)
    window.addEventListener('message', function (e) {
      if (e.source === window && e.data && e.data.__proxyShiftBridge) {
        applySettings(e.data.settings);
      }
    });
  }

  // ─── Inject into page context ────────────────────────────────────────────────
  // In Firefox (isolated world): window !== page window → <script> injection reaches the page.
  // In Chrome MAIN world: window IS the page window → <script> injection runs in same context;
  // the __proxyShiftPatched guard prevents double-execution.
  if (!window.__proxyShiftPatched) {
    var src = '(' + patchPageContext.toString() + ')();';
    var s = document.createElement('script');
    s.textContent = src;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
    // Mark this context (isolated or main) to skip the direct call below
    window.__proxyShiftPatched = true;
  }

  // ─── Settings bridge (isolated world → page world) ──────────────────────────
  // Fetch settings from the background and relay them to the page-world script
  // via window.postMessage. In MAIN world the background also injects settings
  // directly, but the postMessage path is harmless to run there too.
  function relaySettings(settings) {
    window.postMessage({ __proxyShiftBridge: true, settings: settings }, '*');
    // Also dispatch the custom event for the MAIN-world listener
    try {
      window.dispatchEvent(new CustomEvent('__proxyShiftSettingsUpdate', { detail: settings }));
    } catch (_) {}
  }

  try {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, function (res) {
      if (chrome.runtime.lastError) return;
      if (res && res.settings !== undefined) relaySettings(res.settings);
    });
  } catch (_) {}

  // Re-apply when background pushes a settings update
  window.addEventListener('__proxyShiftSettingsUpdate', function (e) {
    window.postMessage({ __proxyShiftBridge: true, settings: e.detail }, '*');
  });
})();
