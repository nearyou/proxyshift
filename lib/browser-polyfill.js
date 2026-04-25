/**
 * ProxyShift — Browser API Polyfill
 * Provides a unified `browser.*` API that works in both Chrome (MV3) and Firefox.
 * Include this as the first script in any page that needs cross-browser compatibility.
 *
 * Chrome uses `chrome.*` (callback-based).
 * Firefox provides `browser.*` (Promise-based, plus `chrome.*` as alias).
 * This polyfill wraps Chrome's callback API to be Promise-based like Firefox's.
 */

(function (globalThis) {
  'use strict';

  // Firefox already has a Promise-based `browser` namespace — don't override it.
  if (typeof globalThis.browser !== 'undefined' && globalThis.browser.runtime) {
    return;
  }

  // No chrome API available (e.g. in test env) — skip.
  if (typeof globalThis.chrome === 'undefined') {
    return;
  }

  const CHROME = globalThis.chrome;

  function promisify(fn, ...args) {
    return new Promise((resolve, reject) => {
      fn(...args, (...results) => {
        if (CHROME.runtime.lastError) {
          reject(new Error(CHROME.runtime.lastError.message));
        } else {
          resolve(results.length === 1 ? results[0] : results);
        }
      });
    });
  }

  function wrapNamespace(ns) {
    if (!ns) return undefined;
    const wrapper = {};
    for (const key of Object.getOwnPropertyNames(ns)) {
      const val = ns[key];
      if (typeof val === 'function') {
        // Heuristic: functions that accept a callback get promisified.
        // Functions that return something meaningful (like addListener) are passed through.
        wrapper[key] = function (...args) {
          // If last arg is already a function, pass through (it's a callback-style call)
          if (typeof args[args.length - 1] === 'function') {
            return val.apply(ns, args);
          }
          return promisify(val.bind(ns), ...args);
        };
      } else if (val && typeof val === 'object' && !(val instanceof Event)) {
        wrapper[key] = val; // Pass through event emitters etc.
      } else {
        wrapper[key] = val;
      }
    }
    return wrapper;
  }

  globalThis.browser = {
    runtime: wrapNamespace(CHROME.runtime),
    storage: {
      local: wrapNamespace(CHROME.storage?.local),
      sync: wrapNamespace(CHROME.storage?.sync),
      session: wrapNamespace(CHROME.storage?.session),
    },
    proxy: wrapNamespace(CHROME.proxy),
    tabs: wrapNamespace(CHROME.tabs),
    alarms: wrapNamespace(CHROME.alarms),
    webRequest: wrapNamespace(CHROME.webRequest),
    scripting: wrapNamespace(CHROME.scripting),
    action: wrapNamespace(CHROME.action || CHROME.browserAction),
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
