/**
 * ProxyShift — Options Page Script
 */

let appState = null;
let editingProfileId = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  bindNavigation();
  bindProxiesSection();
  bindAntiDetectSection();
  bindRotationSection();
  bindImportExport();
  bindAppearanceSection();
  bindModal();
});

// ─── State ────────────────────────────────────────────────────────────────────
async function loadState() {
  const res = await sendMessage({ type: 'GET_STATE' });
  if (res?.state) {
    appState = res.state;
    renderAll();
  }
}

async function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

function renderAll() {
  applyTheme(appState.theme);
  renderProxyTable();
  renderAntiDetectForm();
  renderRotationForm();
}

function applyTheme(theme) {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add(theme === 'light' ? 'theme-light' : 'theme-dark');
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function bindNavigation() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.dataset.section;
      document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
      document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(`section-${section}`)?.classList.add('active');
    });
  });
}

// ─── Proxy Profiles ───────────────────────────────────────────────────────────
function renderProxyTable() {
  const profiles = appState?.profiles || [];
  const empty = document.getElementById('proxyEmptyState');
  const table = document.getElementById('proxyTable');
  const tbody = document.getElementById('proxyTableBody');

  if (profiles.length === 0) {
    empty.style.display = 'block';
    table.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  table.style.display = 'table';
  tbody.innerHTML = '';

  profiles.forEach((p) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td><span class="type-badge badge-${p.type}">${p.type.toUpperCase()}</span></td>
      <td><code style="font-size:12px">${escapeHtml(p.host)}</code></td>
      <td>${p.port}</td>
      <td>${p.username ? '✓' : '—'}</td>
      <td>
        <button class="table-btn" data-action="edit" data-id="${p.id}">Edit</button>
        <button class="table-btn danger" data-action="delete" data-id="${p.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'edit') {
        const profile = appState.profiles.find((p) => p.id === id);
        if (profile) openEditModal(profile);
      } else if (action === 'delete') {
        handleDelete(id);
      }
    });
  });
}

function bindProxiesSection() {
  document.getElementById('addProxyBtn').addEventListener('click', openAddModal);
}

async function handleDelete(id) {
  const profile = appState.profiles.find((p) => p.id === id);
  if (!profile || !confirm(`Delete "${profile.name}"?`)) return;
  const res = await sendMessage({ type: 'DELETE_PROFILE', profileId: id });
  if (res?.state) { appState = res.state; renderProxyTable(); }
}

// ─── Anti-Detection ───────────────────────────────────────────────────────────
function renderAntiDetectForm() {
  const s = appState?.globalSettings || {};
  document.getElementById('webrtcCheck').checked = !!s.webrtcEnabled;
  document.getElementById('localeCheck').checked = !!s.localeEnabled;
  document.getElementById('localeInput').value = s.locale || 'auto';
  document.getElementById('timezoneCheck').checked = !!s.timezoneEnabled;
  document.getElementById('timezoneInput').value = s.timezone || 'auto';
  document.getElementById('canvasCheck').checked = !!s.canvasFingerprintEnabled;
  updateSubRows();
}

function updateSubRows() {
  const localeEnabled = document.getElementById('localeCheck').checked;
  const tzEnabled = document.getElementById('timezoneCheck').checked;
  const localeRow = document.getElementById('localeSubRow');
  const tzRow = document.getElementById('tzSubRow');
  if (localeRow) localeRow.classList.toggle('sub-row', true);
  if (localeRow) localeRow.querySelector('.setting-input')?.toggleAttribute('disabled', !localeEnabled);
  if (tzRow) tzRow.classList.toggle('sub-row', true);
  if (tzRow) tzRow.querySelector('.setting-input')?.toggleAttribute('disabled', !tzEnabled);
}

function bindAntiDetectSection() {
  document.getElementById('localeCheck').addEventListener('change', updateSubRows);
  document.getElementById('timezoneCheck').addEventListener('change', updateSubRows);

  document.getElementById('saveAntiDetectBtn').addEventListener('click', async () => {
    const settings = {
      webrtcEnabled: document.getElementById('webrtcCheck').checked,
      localeEnabled: document.getElementById('localeCheck').checked,
      locale: document.getElementById('localeInput').value.trim() || 'auto',
      timezoneEnabled: document.getElementById('timezoneCheck').checked,
      timezone: document.getElementById('timezoneInput').value.trim() || 'auto',
      canvasFingerprintEnabled: document.getElementById('canvasCheck').checked,
    };
    const res = await sendMessage({ type: 'SET_GLOBAL_SETTINGS', settings });
    if (res?.state) {
      appState = res.state;
      showNotice('Anti-detection settings saved.', 'success');
    }
  });
}

// ─── Rotation ─────────────────────────────────────────────────────────────────
function renderRotationForm() {
  const r = appState?.rotation || {};
  document.getElementById('rotationCheck').checked = !!r.enabled;
  document.getElementById('rotationInterval').value = r.interval || 10;
}

function bindRotationSection() {
  document.getElementById('saveRotationBtn').addEventListener('click', async () => {
    const rotation = {
      enabled: document.getElementById('rotationCheck').checked,
      interval: parseInt(document.getElementById('rotationInterval').value, 10) || 10,
      currentIndex: appState?.rotation?.currentIndex || 0,
    };
    const res = await sendMessage({ type: 'SET_ROTATION', rotation });
    if (res?.state) {
      appState = res.state;
      showNotice('Rotation settings saved.', 'success', 'io-notice');
    }
  });
}

// ─── Import / Export ──────────────────────────────────────────────────────────
function bindImportExport() {
  document.getElementById('exportBtn').addEventListener('click', () => {
    const profiles = appState?.profiles || [];
    const json = JSON.stringify(profiles, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'proxyshift-profiles.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const profiles = JSON.parse(text);
      if (!Array.isArray(profiles)) throw new Error('Expected an array of profiles');
      const res = await sendMessage({ type: 'IMPORT_PROFILES', profiles });
      if (res?.state) {
        appState = res.state;
        renderProxyTable();
        showNotice(`Imported ${profiles.length} profile(s).`, 'success');
      }
    } catch (err) {
      showNotice('Import failed: ' + err.message, 'error');
    } finally {
      e.target.value = '';
    }
  });

  document.getElementById('importPlainBtn').addEventListener('click', async () => {
    const text = document.getElementById('plainTextImport').value.trim();
    if (!text) return;
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const profiles = [];
    for (const line of lines) {
      try {
        const url = new URL(line);
        const type = url.protocol.replace(':', '').toLowerCase();
        if (!['http', 'https', 'socks4', 'socks5'].includes(type)) continue;
        profiles.push({
          id: generateId(),
          name: `${type.toUpperCase()} ${url.hostname}`,
          type,
          host: url.hostname,
          port: parseInt(url.port || (type === 'http' ? '80' : type === 'https' ? '443' : '1080'), 10),
          username: url.username || undefined,
          password: url.password || undefined,
        });
      } catch {}
    }
    if (profiles.length === 0) {
      showNotice('No valid proxies found. Use format: socks5://host:port or socks5://user:pass@host:port', 'error');
      return;
    }
    const res = await sendMessage({ type: 'IMPORT_PROFILES', profiles });
    if (res?.state) {
      appState = res.state;
      renderProxyTable();
      document.getElementById('plainTextImport').value = '';
      showNotice(`Imported ${profiles.length} proxy profile(s).`, 'success');
    }
  });
}

// ─── Appearance ───────────────────────────────────────────────────────────────
function bindAppearanceSection() {
  const select = document.getElementById('themeSelect');
  if (appState?.theme) select.value = appState.theme;

  document.getElementById('saveAppearanceBtn').addEventListener('click', async () => {
    const theme = select.value;
    const res = await sendMessage({ type: 'SET_THEME', theme });
    if (res?.state) {
      appState = res.state;
      applyTheme(theme);
    }
  });
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function bindModal() {
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  });
  document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
}

function openAddModal() {
  editingProfileId = null;
  document.getElementById('modalTitle').textContent = 'Add Proxy';
  document.getElementById('profileId').value = '';
  document.getElementById('profileName').value = '';
  document.getElementById('proxyType').value = 'socks5';
  document.getElementById('proxyHost').value = '';
  document.getElementById('proxyPort').value = '';
  document.getElementById('proxyUser').value = '';
  document.getElementById('proxyPass').value = '';
  document.getElementById('modalError').textContent = '';
  document.getElementById('modalOverlay').classList.add('open');
}

function openEditModal(profile) {
  editingProfileId = profile.id;
  document.getElementById('modalTitle').textContent = 'Edit Proxy';
  document.getElementById('profileId').value = profile.id;
  document.getElementById('profileName').value = profile.name;
  document.getElementById('proxyType').value = profile.type;
  document.getElementById('proxyHost').value = profile.host;
  document.getElementById('proxyPort').value = profile.port;
  document.getElementById('proxyUser').value = profile.username || '';
  document.getElementById('proxyPass').value = profile.password || '';
  document.getElementById('modalError').textContent = '';
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

async function saveProfile() {
  const name = document.getElementById('profileName').value.trim();
  const host = document.getElementById('proxyHost').value.trim();
  const port = parseInt(document.getElementById('proxyPort').value.trim(), 10);

  if (!name) { document.getElementById('modalError').textContent = 'Name is required'; return; }
  if (!host) { document.getElementById('modalError').textContent = 'Host is required'; return; }
  if (!port || port < 1 || port > 65535) { document.getElementById('modalError').textContent = 'Valid port required'; return; }

  const profile = {
    id: editingProfileId || generateId(),
    name,
    type: document.getElementById('proxyType').value,
    host,
    port,
    username: document.getElementById('proxyUser').value.trim() || undefined,
    password: document.getElementById('proxyPass').value || undefined,
  };

  const res = await sendMessage({ type: 'SAVE_PROFILE', profile });
  if (res?.state) {
    appState = res.state;
    renderProxyTable();
    closeModal();
  }
}

// ─── Notice ───────────────────────────────────────────────────────────────────
let noticeTimer = null;
function showNotice(msg, type = '', id = 'ioNotice') {
  const el = document.getElementById(id) || document.getElementById('ioNotice');
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.className = `io-notice ${type}`;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.textContent = ''; el.className = 'io-notice'; }, 3500);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
