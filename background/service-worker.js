/**
 * ProxyShift — Background Service Worker
 * Handles proxy configuration, authentication, rotation, and messaging.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const ROTATION_ALARM = 'proxyshift-rotation';
// ipify: HTTPS, free, no-auth, returns {"ip":"..."} — used for proxy connectivity checks
const IP_API_URL = 'https://api.ipify.org?format=json';
// ipapi.co: HTTPS, free (30k/month), returns ip + timezone + country_code — used for geo/auto-detect
const GEO_API_URL = 'https://ipapi.co/';

// Country code → BCP 47 locale mapping for auto-locale detection
const COUNTRY_LOCALE_MAP = {
  US: 'en-US', GB: 'en-GB', AU: 'en-AU', CA: 'en-CA', NZ: 'en-NZ', IE: 'en-IE',
  DE: 'de-DE', AT: 'de-AT', CH: 'de-CH',
  FR: 'fr-FR', BE: 'fr-BE',
  ES: 'es-ES', MX: 'es-MX', AR: 'es-AR', CO: 'es-CO', CL: 'es-CL',
  PT: 'pt-PT', BR: 'pt-BR',
  IT: 'it-IT',
  NL: 'nl-NL',
  PL: 'pl-PL',
  RU: 'ru-RU', UA: 'uk-UA',
  JP: 'ja-JP',
  CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-HK',
  KR: 'ko-KR',
  SA: 'ar-SA', EG: 'ar-EG', AE: 'ar-AE',
  TR: 'tr-TR',
  IN: 'hi-IN',
  SE: 'sv-SE', NO: 'nb-NO', DK: 'da-DK', FI: 'fi-FI',
  CZ: 'cs-CZ', SK: 'sk-SK', HU: 'hu-HU', RO: 'ro-RO', BG: 'bg-BG',
  GR: 'el-GR', HR: 'hr-HR', SI: 'sl-SI', SR: 'sr-RS',
  TH: 'th-TH', VN: 'vi-VN', ID: 'id-ID', MY: 'ms-MY', PH: 'fil-PH',
  IL: 'he-IL', IR: 'fa-IR', PK: 'ur-PK',
  ZA: 'af-ZA', NG: 'en-NG', KE: 'sw-KE',
};
const DEFAULT_STATE = {
  enabled: false,
  activeProfileId: null,
  profiles: [],
  rotation: {
    enabled: false,
    interval: 10,
    currentIndex: 0,
  },
  theme: 'dark',
  globalSettings: {
    webrtcEnabled: true,
    localeEnabled: true,
    canvasFingerprintEnabled: false,
    timezoneEnabled: false,
    timezone: 'auto',
  },
};

// ─── Initialisation ──────────────────────────────────────────────────────────

async function getState() {
  const { proxyshiftState } = await chrome.storage.local.get('proxyshiftState');
  return proxyshiftState || DEFAULT_STATE;
}

async function setState(updates) {
  const current = await getState();
  const next = deepMerge(current, updates);
  await chrome.storage.local.set({ proxyshiftState: next });
  return next;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      key in target &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ─── Proxy Application ───────────────────────────────────────────────────────

async function applyProxy(state) {
  if (!state.enabled || !state.activeProfileId) {
    await clearProxy();
    return;
  }

  const profile = state.profiles.find((p) => p.id === state.activeProfileId);
  if (!profile) {
    await clearProxy();
    return;
  }

  const scheme = profile.type; // http, https, socks4, socks5
  const config = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: scheme,
        host: profile.host,
        port: parseInt(profile.port, 10),
      },
      bypassList: ['<local>', '127.0.0.1', 'localhost'],
    },
  };

  return new Promise((resolve) => {
    chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => {
      resolve();
    });
  });
}

async function clearProxy() {
  return new Promise((resolve) => {
    chrome.proxy.settings.clear({ scope: 'regular' }, () => {
      resolve();
    });
  });
}

// ─── Auth Handler ────────────────────────────────────────────────────────────

// Temporary credentials used during TEST_PROXY for unsaved profiles.
// Set before the test, cleared in the finally block.
let _testCredentials = null;

const IS_MV3 = chrome.runtime.getManifest().manifest_version >= 3;

async function resolveAuthCredentials(details) {
  if (!details.isProxy) return {};

  // Prioritise test credentials (unsaved profile being tested)
  if (_testCredentials?.username) {
    return { authCredentials: _testCredentials };
  }

  const { proxyshiftState } = await chrome.storage.local.get('proxyshiftState');
  const state = proxyshiftState || DEFAULT_STATE;
  const profile = state.profiles.find((p) => p.id === state.activeProfileId);
  if (profile?.username && profile?.password) {
    return { authCredentials: { username: profile.username, password: profile.password } };
  }
  return {};
}

if (IS_MV3) {
  // MV3 (Chrome/Edge/Brave): asyncBlocking + callback
  chrome.webRequest.onAuthRequired.addListener(
    (details, callback) => {
      resolveAuthCredentials(details).then(callback).catch(() => callback({}));
    },
    { urls: ['<all_urls>'] },
    ['asyncBlocking']
  );
} else {
  // MV2 (Firefox): blocking, return a Promise directly
  chrome.webRequest.onAuthRequired.addListener(
    (details) => resolveAuthCredentials(details),
    { urls: ['<all_urls>'] },
    ['blocking']
  );
}

// Fetch current outbound IP via ipify (HTTPS, no rate limit for individual users)
async function getCurrentIP() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(IP_API_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.ip || null;
  } catch (err) {
    console.error('[ProxyShift] IP lookup failed:', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Fetch geo info for an IP via ipapi.co (HTTPS, free tier)
// Pass null to look up the current outbound IP.
async function getGeoInfo(ip) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const url = ip ? `${GEO_API_URL}${ip}/json/` : `${GEO_API_URL}json/`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.reason || 'ipapi.co error');
    if (!data.ip) throw new Error('missing ip field in geo response');
    return {
      timezone: data.timezone || null,
      country: data.country_code || null,
      city: data.city || null,
      region: data.region || null,
      org: data.org || null,
      ip: data.ip,
    };
  } catch (err) {
    console.error('[ProxyShift] geo lookup failed:', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveSettings(state) {
  const profile = state.activeProfileId
    ? state.profiles.find((p) => p.id === state.activeProfileId)
    : null;

  const settings = { ...state.globalSettings };

  // Resolve 'auto' timezone
  if (settings.timezoneEnabled && settings.timezone === 'auto') {
    const tz = profile?._detectedTimezone;
    if (tz) {
      settings.timezone = tz;
    } else {
      // Cannot resolve yet — disable timezone spoofing until we have geo data
      settings.timezoneEnabled = false;
    }
  }

  // Resolve 'auto' locale from country code
  if (settings.localeEnabled && (!settings.locale || settings.locale === 'auto')) {
    const country = profile?._detectedCountry;
    if (country && COUNTRY_LOCALE_MAP[country]) {
      settings.locale = COUNTRY_LOCALE_MAP[country];
    } else {
      // Cannot resolve yet — disable locale spoofing until we have geo data
      settings.localeEnabled = false;
    }
  }

  return settings;
}

async function injectSettingsToTabs(state) {
  if (!state.enabled || !state.activeProfileId) {
    // Proxy disabled — inject null settings to clear patches
    await injectSettingsToAllTabs(null);
    return;
  }

  const settings = resolveSettings(state);
  await injectSettingsToAllTabs(settings);
}

// Builds a code string that injects settings into the PAGE context via a <script> tag.
// Used for Firefox MV2 where tabs.executeScript runs in the isolated content-script world,
// not the page's main world. DOM script injection is the standard cross-browser technique
// for patching window-level APIs (Intl, Date, RTCPeerConnection, navigator) from an extension.
function buildPageInjectionCode(settings) {
  // settings -> JSON string -> embed as JS literal via JSON.stringify (handles all escaping)
  const settingsLiteral = JSON.stringify(JSON.stringify(settings));
  const pageCode =
    '(function(){' +
    'var x=JSON.parse(' + settingsLiteral + ');' +
    'window.__proxyShiftSettings=x;' +
    'try{window.dispatchEvent(new CustomEvent("__proxyShiftSettingsUpdate",{detail:x}));}catch(e){}' +
    '})()';
  const pageCodeLiteral = JSON.stringify(pageCode);
  // The content-script creates a <script> element, sets its source, appends then removes it.
  return (
    '(function(){' +
    'var s=document.createElement("script");' +
    's.textContent=' + pageCodeLiteral + ';' +
    '(document.head||document.documentElement).appendChild(s);' +
    's.remove();' +
    '})();'
  );
}

async function executeInTab(tabId, settings) {
  if (chrome.scripting?.executeScript) {
    // MV3 (Chrome/Edge/Brave): direct MAIN-world injection, no content-script boundary
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: applyAntiDetectSettings,
        args: [settings],
        world: 'MAIN',
      });
      return;
    } catch (err) {
      console.error('[ProxyShift] scripting.executeScript failed for tab', tabId, err.message);
    }
  }

  if (chrome.tabs?.executeScript) {
    // MV2 (Firefox): runs in isolated content-script world → inject <script> to reach page world
    const code = buildPageInjectionCode(settings);
    try {
      await chrome.tabs.executeScript(tabId, { code, allFrames: true, runAt: 'document_idle' });
    } catch (err) {
      // Tab may be restricted (chrome://, about:, PDF) — expected, not an error
      if (!err.message?.includes('Cannot access') && !err.message?.includes('Missing host')) {
        console.error('[ProxyShift] tabs.executeScript failed for tab', tabId, err.message);
      }
    }
  }
}

async function injectSettingsToAllTabs(settings) {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  } catch (err) {
    console.error('[ProxyShift] tabs.query failed:', err.message);
    return;
  }
  for (const tab of tabs) {
    if (tab.id && tab.url && !tab.url.startsWith('chrome') && !tab.url.startsWith('about')) {
      executeInTab(tab.id, settings);
    }
  }
}

function applyAntiDetectSettings(settings) {
  // Set settings on window for content script access
  window.__proxyShiftSettings = settings;
  // Dispatch custom event so the content script can re-apply patches without polling
  window.dispatchEvent(new CustomEvent('__proxyShiftSettingsUpdate', { detail: settings }));
}

async function getActiveSettings() {
  const state = await getState();
  if (!state.enabled || !state.activeProfileId) return null;
  return resolveSettings(state);
}

// ─── Rotation ────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ROTATION_ALARM) return;
  const state = await getState();
  if (!state.rotation.enabled || !state.enabled) return;

  const enabledProfiles = state.profiles.filter((p) => p.enabled !== false);
  if (enabledProfiles.length < 2) return;

  const nextIndex = (state.rotation.currentIndex + 1) % enabledProfiles.length;
  const nextProfile = enabledProfiles[nextIndex];

  const next = await setState({
    activeProfileId: nextProfile.id,
    rotation: { ...state.rotation, currentIndex: nextIndex },
  });
  await applyProxy(next);

  // Re-inject updated anti-detect settings for the new proxy region
  await injectSettingsToTabs(next);

  // Kick off geo detection if 'auto' timezone or locale is configured.
  // detectAndStoreGeoData will re-inject once geo resolves.
  const needsGeo =
    (next.globalSettings.timezoneEnabled && next.globalSettings.timezone === 'auto') ||
    (next.globalSettings.localeEnabled &&
      (!next.globalSettings.locale || next.globalSettings.locale === 'auto'));

  if (nextProfile && needsGeo) {
    detectAndStoreGeoData(nextProfile.id);
  }

  notifyPopup({ type: 'STATE_UPDATED', state: next });
});

async function setupRotationAlarm(state) {
  await chrome.alarms.clear(ROTATION_ALARM);
  if (state.rotation.enabled && state.enabled) {
    chrome.alarms.create(ROTATION_ALARM, {
      periodInMinutes: Math.max(1, state.rotation.interval),
    });
  }
}

// ─── Message Handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_STATE': {
      return { state: await getState() };
    }

    case 'SET_ENABLED': {
      const state = await setState({ enabled: message.enabled });
      await applyProxy(state);
      await setupRotationAlarm(state);
      await injectSettingsToTabs(state);
      return { state };
    }

    case 'ACTIVATE_PROFILE': {
      const state = await setState({ activeProfileId: message.profileId, enabled: true });
      await applyProxy(state);

      // Auto-detect geo (timezone + locale) if any 'auto' settings are enabled
      const profile = state.profiles.find((p) => p.id === message.profileId);
      const needsGeo =
        (state.globalSettings.timezoneEnabled && state.globalSettings.timezone === 'auto') ||
        (state.globalSettings.localeEnabled && (!state.globalSettings.locale || state.globalSettings.locale === 'auto'));

      if (profile && needsGeo) {
        // Run async — will re-inject settings once geo resolves
        detectAndStoreGeoData(profile.id);
      }

      await injectSettingsToTabs(state);
      return { state };
    }

    case 'SAVE_PROFILE': {
      const currentState = await getState();
      const profiles = [...currentState.profiles];
      const idx = profiles.findIndex((p) => p.id === message.profile.id);
      if (idx >= 0) {
        profiles[idx] = message.profile;
      } else {
        profiles.push({ ...message.profile, id: message.profile.id || generateId() });
      }
      const state = await setState({ profiles });
      return { state };
    }

    case 'DELETE_PROFILE': {
      const currentState = await getState();
      const profiles = currentState.profiles.filter((p) => p.id !== message.profileId);
      const updates = { profiles };
      if (currentState.activeProfileId === message.profileId) {
        updates.activeProfileId = null;
        updates.enabled = false;
      }
      const state = await setState(updates);
      if (updates.enabled === false) await clearProxy();
      return { state };
    }

    case 'TEST_PROXY': {
      // Accepts either { profileId } (saved profile) or { profile } (inline data, not saved)
      const currentState = await getState();
      const profile = message.profile
        || currentState.profiles.find((p) => p.id === message.profileId);
      if (!profile) return { error: 'Profile not found' };

      // Snapshot prior proxy config so we can always restore it
      const priorEnabled = currentState.enabled;
      const priorProfileId = currentState.activeProfileId;

      // Set test credentials so onAuthRequired supplies them during the test
      if (profile.username) {
        _testCredentials = { username: profile.username, password: profile.password || '' };
      }

      try {
        // Apply the test proxy (synthesise a minimal state without mutating storage)
        const testState = {
          ...currentState,
          enabled: true,
          activeProfileId: profile.id,
          profiles: currentState.profiles.some((p) => p.id === profile.id)
            ? currentState.profiles
            : [...currentState.profiles, profile],
        };
        await applyProxy(testState);

        // Short delay to let the proxy connection settle
        await new Promise((r) => setTimeout(r, 600));

        // Step 1: verify proxy works via ipify (HTTPS, reliable)
        const ip = await getCurrentIP();
        if (!ip) return { success: false, error: 'Could not reach IP check server' };

        // Step 2: fetch geo data for display (optional — failure does not fail the test)
        const geo = await getGeoInfo(ip);
        return { success: true, ip, geo: geo || { ip } };
      } finally {
        // Clear temp auth credentials
        _testCredentials = null;

        // Always restore prior proxy state — never leave user in unexpected state
        if (priorEnabled && priorProfileId) {
          await applyProxy(currentState);
        } else {
          await clearProxy();
        }
      }
    }

    case 'GET_CURRENT_IP': {
      const ip = await getCurrentIP();
      const geo = ip ? await getGeoInfo(ip) : null;
      return { ip, geo };
    }

    case 'DETECT_TIMEZONE': {
      const geo = await getGeoInfo(null);
      return { timezone: geo?.timezone, geo };
    }

    case 'GET_SETTINGS': {
      // Used by content scripts to fetch resolved settings at document_start
      const activeSettings = await getActiveSettings();
      return { settings: activeSettings };
    }

    case 'SET_ROTATION': {
      const state = await setState({ rotation: message.rotation });
      await setupRotationAlarm(state);
      return { state };
    }

    case 'SET_GLOBAL_SETTINGS': {
      const state = await setState({ globalSettings: message.settings });
      await injectSettingsToTabs(state);
      return { state };
    }

    case 'SET_THEME': {
      const state = await setState({ theme: message.theme });
      return { state };
    }

    case 'IMPORT_PROFILES': {
      const currentState = await getState();
      const incoming = message.profiles.map((p) => ({
        ...p,
        id: p.id || generateId(),
      }));
      const merged = [...currentState.profiles];
      for (const p of incoming) {
        const existing = merged.findIndex((x) => x.id === p.id);
        if (existing >= 0) merged[existing] = p;
        else merged.push(p);
      }
      const state = await setState({ profiles: merged });
      return { state };
    }

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function detectAndStoreGeoData(profileId) {
  const geo = await getGeoInfo(null);
  if (!geo) return;

  const currentState = await getState();
  const updates = {};
  if (geo.timezone) updates._detectedTimezone = geo.timezone;
  if (geo.country) updates._detectedCountry = geo.country;

  const profiles = currentState.profiles.map((p) =>
    p.id === profileId ? { ...p, ...updates } : p
  );
  const next = await setState({ profiles });

  // Re-inject settings now that we have resolved timezone and locale
  await injectSettingsToTabs(next);
  notifyPopup({ type: 'STATE_UPDATED', state: next });
}

function notifyPopup(message) {
  try {
    // sendMessage returns a Promise in MV3/modern Firefox; may be callback-only in older MV2
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (_) {}
}

// ─── Startup ─────────────────────────────────────────────────────────────────

async function onStartup() {
  const state = await getState();
  if (state.enabled && state.activeProfileId) {
    await applyProxy(state);
    await setupRotationAlarm(state);
  }
}

chrome.runtime.onStartup.addListener(onStartup);
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.local.set({ proxyshiftState: DEFAULT_STATE });
  }
  onStartup();
});

// ─── Navigation-Time Injection ────────────────────────────────────────────────
// Inject anti-detect settings immediately when a new navigation is committed
// so settings are available before page scripts run (bridge for new tabs).
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!details.url || details.url.startsWith('chrome') || details.url.startsWith('about')) return;

  const state = await getState();
  if (!state.enabled || !state.activeProfileId) return;

  const settings = resolveSettings(state);
  executeInTab(details.tabId, settings).catch((err) => {
    console.error('[ProxyShift] onCommitted injection failed:', err.message);
  });
});
