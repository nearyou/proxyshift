/**
 * ProxyShift — Popup Script
 */

// ─── State ────────────────────────────────────────────────────────────────────
let appState = null;
let editingProfileId = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  bindEvents();
  refreshCurrentIP();
});

// ─── State Management ─────────────────────────────────────────────────────────
async function loadState() {
  try {
    const response = await sendMessage({ type: 'GET_STATE' });
    if (response?.state) {
      appState = response.state;
      renderAll();
    }
  } catch (err) {
    console.error('Failed to load state:', err);
  }
}

async function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderAll() {
  if (!appState) return;
  applyTheme(appState.theme);
  renderToggle();
  renderStatusBar();
  renderProfiles();
}

function applyTheme(theme) {
  const body = document.body;
  body.classList.remove('theme-dark', 'theme-light');
  body.classList.add(theme === 'light' ? 'theme-light' : 'theme-dark');
}

function renderToggle() {
  const toggle = document.getElementById('masterToggle');
  const label = document.getElementById('masterLabel');
  if (appState.enabled) {
    toggle.classList.add('active');
    label.textContent = 'ON';
  } else {
    toggle.classList.remove('active');
    label.textContent = 'OFF';
  }
}

function renderStatusBar() {
  const indicator = document.getElementById('statusIndicator');
  const text = document.getElementById('statusText');

  if (appState.enabled && appState.activeProfileId) {
    const profile = appState.profiles.find((p) => p.id === appState.activeProfileId);
    indicator.className = 'status-indicator active';
    text.textContent = profile ? `${profile.name} — ${profile.host}:${profile.port}` : 'Active';
  } else {
    indicator.className = 'status-indicator';
    text.textContent = 'No proxy active';
  }
}

function renderProfiles() {
  const list = document.getElementById('profilesList');
  const empty = document.getElementById('emptyState');
  const profiles = appState.profiles || [];

  // Clear existing cards
  const existing = list.querySelectorAll('.profile-card');
  existing.forEach((el) => el.remove());

  if (profiles.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  profiles.forEach((profile) => {
    const card = createProfileCard(profile);
    list.appendChild(card);
  });
}

function createProfileCard(profile) {
  const isActive = appState.enabled && appState.activeProfileId === profile.id;
  const div = document.createElement('div');
  div.className = `profile-card${isActive ? ' active' : ''}`;
  div.dataset.profileId = profile.id;

  const typeColors = { http: '#3b82f6', https: '#22c55e', socks4: '#f59e0b', socks5: '#a78bfa' };
  const color = typeColors[profile.type] || '#6366f1';
  const hasAuth = profile.username && profile.password;

  div.innerHTML = `
    <div class="profile-type-dot" style="background:${color}"></div>
    <div class="profile-info">
      <div class="profile-name">${escapeHtml(profile.name)}</div>
      <div class="profile-meta">
        <span class="type-badge badge-${profile.type}">${profile.type.toUpperCase()}</span>
        <span class="profile-host">${escapeHtml(profile.host)}:${profile.port}</span>
        ${hasAuth ? '<span class="auth-dot" title="Has credentials"></span>' : ''}
      </div>
    </div>
    <div class="profile-actions">
      <button class="profile-btn profile-activate-btn" title="${isActive ? 'Deactivate' : 'Activate'}" data-action="activate">
        ${isActive
          ? `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><circle cx="8" cy="8" r="6" fill="currentColor" opacity="0.3"/><circle cx="8" cy="8" r="3.5" fill="currentColor"/></svg>`
          : `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><circle cx="8" cy="8" r="6"/></svg>`
        }
      </button>
      <button class="profile-btn" title="Edit" data-action="edit">
        <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
          <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/>
        </svg>
      </button>
      <button class="profile-btn delete" title="Delete" data-action="delete">
        <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
          <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
        </svg>
      </button>
    </div>
  `;

  // Event delegation on action buttons
  div.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const profileId = profile.id;

    if (action === 'activate') {
      handleActivate(profileId, isActive);
    } else if (action === 'edit') {
      openEditModal(profile);
    } else if (action === 'delete') {
      handleDelete(profileId, profile.name);
    }
    e.stopPropagation();
  });

  return div;
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function handleActivate(profileId, isCurrentlyActive) {
  try {
    if (isCurrentlyActive) {
      const res = await sendMessage({ type: 'SET_ENABLED', enabled: false });
      if (res?.state) { appState = res.state; renderAll(); }
    } else {
      const res = await sendMessage({ type: 'ACTIVATE_PROFILE', profileId });
      if (res?.state) {
        appState = res.state;
        renderAll();
        refreshCurrentIP();
      }
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function handleDelete(profileId, name) {
  if (!confirm(`Delete proxy "${name}"?`)) return;
  try {
    const res = await sendMessage({ type: 'DELETE_PROFILE', profileId });
    if (res?.state) { appState = res.state; renderAll(); }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
document.getElementById('masterToggle').addEventListener('click', async () => {
  if (!appState) return;
  const newEnabled = !appState.enabled;

  // If enabling but no active profile, prompt to pick one
  if (newEnabled && !appState.activeProfileId && appState.profiles.length === 0) {
    showToast('Add a proxy profile first', 'error');
    return;
  }
  if (newEnabled && !appState.activeProfileId && appState.profiles.length > 0) {
    showToast('Select a proxy profile to activate', 'error');
    return;
  }

  try {
    const res = await sendMessage({ type: 'SET_ENABLED', enabled: newEnabled });
    if (res?.state) {
      appState = res.state;
      renderAll();
      if (newEnabled) refreshCurrentIP();
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
});

// ─── IP Refresh ───────────────────────────────────────────────────────────────
async function refreshCurrentIP() {
  const btn = document.getElementById('refreshIpBtn');
  const ipText = document.getElementById('currentIpText');
  btn.classList.add('spinning');
  ipText.textContent = '…';
  try {
    const res = await sendMessage({ type: 'GET_CURRENT_IP' });
    ipText.textContent = res?.ip || '—';
  } catch {
    ipText.textContent = '—';
  } finally {
    btn.classList.remove('spinning');
  }
}

document.getElementById('refreshIpBtn').addEventListener('click', refreshCurrentIP);

// ─── Modal: Add / Edit ────────────────────────────────────────────────────────
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
  resetTestBtn();
  openModal();
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
  resetTestBtn();
  openModal();
}

function openModal() {
  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('profileName').focus();
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

function resetTestBtn() {
  const btn = document.getElementById('testProxyBtn');
  btn.className = 'btn-test';
  document.getElementById('testBtnText').textContent = 'Test';
}

function getFormProfile() {
  const host = document.getElementById('proxyHost').value.trim();
  const port = parseInt(document.getElementById('proxyPort').value.trim(), 10);
  const name = document.getElementById('profileName').value.trim();

  if (!name) return { error: 'Name is required' };
  if (!host) return { error: 'Host is required' };
  if (!port || port < 1 || port > 65535) return { error: 'Valid port (1–65535) is required' };

  return {
    profile: {
      id: editingProfileId || generateId(),
      name,
      type: document.getElementById('proxyType').value,
      host,
      port,
      username: document.getElementById('proxyUser').value.trim() || undefined,
      password: document.getElementById('proxyPass').value || undefined,
    }
  };
}

// Save
document.getElementById('saveProfileBtn').addEventListener('click', async () => {
  const { profile, error } = getFormProfile();
  if (error) {
    document.getElementById('modalError').textContent = error;
    return;
  }
  try {
    const res = await sendMessage({ type: 'SAVE_PROFILE', profile });
    if (res?.state) { appState = res.state; renderAll(); }
    closeModal();
    showToast(editingProfileId ? 'Proxy updated' : 'Proxy added', 'success');
  } catch (err) {
    document.getElementById('modalError').textContent = err.message;
  }
});

// Test proxy — passes profile data inline; background handles state restoration
document.getElementById('testProxyBtn').addEventListener('click', async () => {
  const { profile, error } = getFormProfile();
  if (error) {
    document.getElementById('modalError').textContent = error;
    return;
  }

  const btn = document.getElementById('testProxyBtn');
  const text = document.getElementById('testBtnText');
  btn.disabled = true;
  text.textContent = '…';

  try {
    const res = await sendMessage({ type: 'TEST_PROXY', profile });
    if (res?.success) {
      btn.className = 'btn-test success';
      text.textContent = `✓ ${res.ip}`;
    } else {
      btn.className = 'btn-test fail';
      text.textContent = '✗ Failed';
    }
  } catch (err) {
    btn.className = 'btn-test fail';
    text.textContent = '✗ Error';
  } finally {
    btn.disabled = false;
  }
});

// Close modal buttons
document.getElementById('closeModalBtn').addEventListener('click', closeModal);
document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
});

// ─── Bind Events ─────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('addProfileBtn').addEventListener('click', openAddModal);
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById('openOptionsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Listen for state updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATE_UPDATED' && msg.state) {
      appState = msg.state;
      renderAll();
    }
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
