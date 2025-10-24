'use strict';

/* =========================================
 * Constants & Helpers
 * ========================================= */
const DEBUG = false; // set to true to see debug logs in popup DevTools
const DEFAULT_ENV = 'uat3';
const DEFAULT_LANG = 'zh_CN'; // server param default remains unchanged
const SIGN_IN_PATH_PART = '/thf/auth/signIn';
const MAX_MESSAGES = 152;

const ENV_BASES = {
  uat1: 'https://uataksindividuallogin.manulife.com.hk/thf/auth/signIn',
  uat2: 'https://uataksindividuallogin.manulife.com.hk/hk-cws-ee-portal-web-app-2/thf/auth/signIn',
  uat3: 'https://uataksindividuallogin.manulife.com.hk/hk-cws-ee-portal-web-app-3/thf/auth/signIn',
};

const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const getEnv = () => ($('env') ? $('env').value : DEFAULT_ENV);
const urlFor = (lang, env) => `${ENV_BASES[env]}?lang=${encodeURIComponent(lang)}`;
const isSignInUrl = (u) => {
  try { return new URL(u).pathname.includes(SIGN_IN_PATH_PART); }
  catch { return false; }
};
const debounce = (fn, ms = 300) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

// Normalize popup language to chatbot.language
function toChatbotLang(v) {
  const s = String(v ?? '').toLowerCase().replace('-', '_');
  if (s === 'en') return 'en';
  if (['zh_hk', 'zh_tw', 'zh_hant', 'tc'].includes(s)) return 'zh_hk';
  if (['zh_cn', 'zh', 'zh_hans', 'sc'].includes(s)) return 'zh_cn';
  if (s === 'zh-cn') return 'zh_cn';
  if (['zh-hk', 'zh-tw'].includes(s)) return 'zh_hk';
  return 'en';
}

function dlog(...args) { if (DEBUG) console.log('[popup]', ...args); }

/* =========================================
 * Chatbot sessionID helpers (read, render, live update)
 * ========================================= */
// 1) Primary source: chrome.storage.session (fast path)
async function getLatestChatbotSessionIdFromExtension() {
  try {
    try { chrome?.storage?.session?.setAccessLevel?.({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }); } catch {}
    if (!chrome.storage?.session?.get) return '';
    const out = await chrome.storage.session.get([
      'chatbot.sessionID', 'chatbotSessionID', 'chatbot_sessionID', 'sessionID'
    ]);
    const val =
      out['chatbot.sessionID'] ??
      out.chatbotSessionID ??
      out.chatbot_sessionID ??
      out.sessionID ??
      '';
    dlog('session.get ->', val ? 'HIT' : 'MISS', out);
    return val || '';
  } catch (e) {
    dlog('getLatestChatbotSessionIdFromExtension error:', e);
    return '';
  }
}

// 2) Fallback: read directly from active tab's window.sessionStorage (requires permissions)
async function getChatbotSessionIdFromActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return '';
    // Only run on pages (not chrome://, edge://, etc.)
    if (!/^https?:/i.test(tab.url || '')) return '';
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      func: () => {
        try { return window.sessionStorage.getItem('chatbot.sessionID') || ''; }
        catch { return ''; }
      },
    });
    const val = (result ?? '').toString();
    dlog('activeTab fallback ->', val ? 'HIT' : 'MISS', val);
    return val;
  } catch (e) {
    dlog('getChatbotSessionIdFromActiveTab error:', e);
    return '';
  }
}

// 3) Render into the popup
function renderChatbotSessionId(value) {
  const el = $('chatbot-session-id');
  const copyBtn = $('copy-session-id');
  const stamp = $('chatbot-session-updated');
  const val = (value ?? '').toString().trim();
  if (el) {
    // Support both <input> and <span>
    if (el.tagName === 'INPUT') {
      el.value = val || '—';
      el.setAttribute('readonly', 'readonly'); // ensure non-editable
    } else {
      el.textContent = val || '—';
    }
    el.title = val || 'Not available';
  }
  if (copyBtn) copyBtn.disabled = !val;
  if (stamp) {
    const now = new Date();
    stamp.textContent = val ? `Updated: ${now.toLocaleString()}` : '';
  }
}

async function refreshChatbotSessionId() {
  try {
    let id = await getLatestChatbotSessionIdFromExtension();
    if (!id) id = await getChatbotSessionIdFromActiveTab();
    renderChatbotSessionId(id);
  } catch (e) {
    console.error('refreshChatbotSessionId error:', e);
    renderChatbotSessionId('');
  }
}

/* =========================================
 * Messages UI
 * ========================================= */
function ensureOneMsgField() {
  const wrap = $('messages');
  if (!wrap) return;
  if (!wrap.querySelector('input[data-msg]')) addMsgField();
}
function addMsgField(value = '') {
  const wrap = $('messages');
  if (!wrap) return;

  // Remove dependency on loop count for injection
  const idx = wrap.querySelectorAll('input[data-msg]').length + 1;
  if (idx > MAX_MESSAGES) return alert(`Max ${MAX_MESSAGES} messages.`);

  const row = document.createElement('div');
  row.style.display = 'contents';

  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('data-msg', '');
  input.placeholder = `Message ${idx}`;
  input.value = String(value ?? '');
  row.appendChild(input);

  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';
  btn.setAttribute('data-remove', '');
  btn.title = 'Remove';
  btn.textContent = '✕';
  row.appendChild(btn);

  wrap.appendChild(row);
  renumberMsgPlaceholders();
}
function renumberMsgPlaceholders() {
  const wrap = $('messages');
  if (!wrap) return;
  qsa('input[data-msg]', wrap).forEach((el, i) => (el.placeholder = `Message ${i + 1}`));
}
function readMessages() {
  const wrap = $('messages');
  if (!wrap) return [];
  return qsa('input[data-msg]', wrap)
    .map((i) => i.value.trim())
    .filter((v) => v.length > 0)
    .slice(0, MAX_MESSAGES);
}
function clearMessages() {
  const wrap = $('messages');
  if (!wrap) return;
  wrap.innerHTML = '';
  ensureOneMsgField();
}

/* =========================================
 * Storage helpers
 * ========================================= */
async function loadSaved() {
  const persist = await chrome.storage.local.get([
    'username', 'password', 'remember', 'lang', 'env', 'testConfig'
  ]);
  let session = {};
  try {
    if (chrome.storage.session) {
      session = await chrome.storage.session.get(['username', 'password']);
    }
  } catch {}
  const remembered = persist.remember === true;
  if ($('env')) $('env').value = persist.env ?? DEFAULT_ENV;
  if ($('lang')) $('lang').value = persist.lang ?? DEFAULT_LANG;
  if ($('remember')) $('remember').checked = remembered;
  if ($('username')) $('username').value = session.username ?? (remembered ? (persist.username ?? '') : '');
  if ($('password')) $('password').value = session.password ?? (remembered ? (persist.password ?? '') : '');
  const msgs = persist.testConfig?.messages ?? [];
  if (msgs.length && $('messages')) {
    $('messages').innerHTML = '';
    msgs.forEach((m) => addMsgField(m));
  } else {
    ensureOneMsgField();
  }
}
async function saveEnvLangRemember() {
  await chrome.storage.local.set({
    env: $('env')?.value ?? DEFAULT_ENV,
    lang: $('lang')?.value ?? DEFAULT_LANG,
    remember: $('remember')?.checked ?? false,
  });
}
async function saveUserPassIfRemembered() {
  if (!$('remember')?.checked) return;
  const username = $('username')?.value.trim() ?? '';
  const password = $('password')?.value ?? '';
  await chrome.storage.local.set({ username, password });
}
async function saveCreds(username, password, remember, lang, env) {
  const ts = Date.now();
  const sessionPayload = { username, password, ephemeral: !remember, ts };
  try {
    if (chrome.storage.session) await chrome.storage.session.set(sessionPayload);
  } catch {}
  const localBase = { lang, env, remember, ephemeral: !remember, ts };
  if (remember) {
    await chrome.storage.local.set({ ...localBase, username, password });
  } else {
    await chrome.storage.local.set(localBase);
    try { await chrome.storage.local.remove(['username', 'password']); } catch {}
  }
}
async function saveTestConfig(cfg) {
  await chrome.storage.local.set({ testConfig: cfg });
}

// Save loop count to storage
async function saveLoopCount(loopCount) {
  try {
    await chrome.storage.local.set({ loopCount });
    dlog('Loop count saved:', loopCount);
  } catch (error) {
    console.error('Failed to save loop count:', error);
  }
}

// Load loop count from storage
async function loadLoopCount() {
  try {
    const result = await chrome.storage.local.get('loopCount');
    return result.loopCount || 1; // Default to 1 if not set
  } catch (error) {
    console.error('Failed to load loop count:', error);
    return 1;
  }
}

/* =========================================
 * Navigation
 * ========================================= */
async function navigateInSameTab(lang, env, action = 'loginOnly', payload = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found.');
  const targetUrl = urlFor(lang, env);

  const ping = async (tabId) => {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { action, ...payload });
      return res?.ok === true || res?.ok === undefined;
    } catch {
      return false;
    }
  };

  const samePage = isSignInUrl(tab.url) && new URL(tab.url).href === targetUrl;
  if (samePage && (await ping(tab.id))) return;

  await chrome.tabs.update(tab.id, { url: targetUrl });

  await new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }, 15000);
    const listener = (id, info) => {
      if (id === tab.id && info.status === 'complete' && !settled) {
        settled = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        ping(tab.id).finally(resolve);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/* =========================================
 * Auto Test
 * ========================================= */
async function runAutoTest() {
  const username = $('username')?.value.trim();
  const password = $('password')?.value.trim();
  const remember = $('remember')?.checked ?? false;
  const lang = $('lang')?.value ?? DEFAULT_LANG;
  const env = getEnv();
  const messages = readMessages();

  // Loop count validation
  let loopCount = 1;
  const loopInput = $('loop-count');
  if (loopInput) {
    loopCount = parseInt(loopInput.value, 10);
    if (isNaN(loopCount) || loopCount < 1) loopCount = 1;
    if (loopCount > 500) loopCount = 500;
    loopInput.value = loopCount; // enforce in UI
    await saveLoopCount(loopCount); // Save loop count
  }

  if (messages.length === 0) {
    alert('Please enter at least one message.');
    return;
  }
  if (!username || !password) {
    alert('Please enter both User ID and Password.');
    return;
  }

  const testConfig = { messages, delayMs: 500, loopCount };
  await saveTestConfig(testConfig);
  await saveCreds(username, password, remember, lang, env);

  const chatbotLang = toChatbotLang(lang);
  await navigateInSameTab(lang, env, 'runTest', { config: testConfig, language: chatbotLang });
}

/* =========================================
 * Wire-up
 * ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
  await loadSaved().catch(console.error);

  const loopInput = $('loop-count');
  if (loopInput) {
    const savedLoopCount = await loadLoopCount();
    loopInput.value = savedLoopCount;
  }

  $('env')?.addEventListener('change', saveEnvLangRemember);
  $('lang')?.addEventListener('change', saveEnvLangRemember);

  $('remember')?.addEventListener('change', async () => {
    await saveEnvLangRemember();
    await persistCredsNow();
  });

  $('username')?.addEventListener('blur', saveUserPassIfRemembered);
  $('password')?.addEventListener('blur', saveUserPassIfRemembered);

  const messagesEl = $('messages');

  async function persistMessagesNow() {
    // Preserve existing loop count when saving messages
    let existingLoopCount = 1;
    try {
      const existing = await chrome.storage.local.get('testConfig');
      existingLoopCount = existing.testConfig?.loopCount || 1;
    } catch {}
    
    const cfg = { 
      messages: readMessages(), 
      delayMs: 500,
      loopCount: existingLoopCount
    };
    return saveTestConfig(cfg);
  }
  const saveMsgsDebounced = debounce(persistMessagesNow, 300);

  if (messagesEl) {
    messagesEl.addEventListener('beforeinput', saveMsgsDebounced, { passive: true });
    messagesEl.addEventListener('input', saveMsgsDebounced, { passive: true });
    messagesEl.addEventListener('compositionend', persistMessagesNow, { passive: true });
    messagesEl.addEventListener('focusout', persistMessagesNow, { passive: true });
    messagesEl.addEventListener('change', persistMessagesNow, { passive: true });
    messagesEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') persistMessagesNow(); }, { passive: true });
  }

  $('add-msg')?.addEventListener('click', () => { addMsgField(''); persistMessagesNow(); });
  $('clear-msgs')?.addEventListener('click', async () => { 
    clearMessages(); 
    // Reset loop count to 1
    const loopInput = $('loop-count');
    if (loopInput) {
      loopInput.value = 1;
      await saveLoopCount(1);
    }
    persistMessagesNow(); 
  });
  $('messages')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-remove]');
    if (!btn) return;
    btn.parentElement?.remove();
    ensureOneMsgField();
    renumberMsgPlaceholders();
    persistMessagesNow();
  });

  function persistCredsNow() {
    const username = $('username')?.value.trim() ?? '';
    const password = $('password')?.value ?? '';
    const remember = $('remember')?.checked ?? false;
    const lang = $('lang')?.value ?? DEFAULT_LANG;
    const env = getEnv();
    return saveCreds(username, password, remember, lang, env);
  }
  const saveCredsDebounced = debounce(persistCredsNow, 300);
  const wireCredAutosave = (el) => {
    if (!el) return;
    el.addEventListener('beforeinput', saveCredsDebounced, { passive: true });
    el.addEventListener('input', saveCredsDebounced, { passive: true });
    el.addEventListener('compositionend', persistCredsNow, { passive: true });
    el.addEventListener('focusout', persistCredsNow, { passive: true });
    el.addEventListener('change', persistCredsNow, { passive: true });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') persistCredsNow(); }, { passive: true });
  };
  wireCredAutosave($('username'));
  wireCredAutosave($('password'));

  ensureOneMsgField();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'CLOSE_POPUP') {
      // window.close();
    }
  });

  $('login')?.addEventListener('click', async () => {
    const username = $('username')?.value.trim();
    const password = $('password')?.value.trim();
    const remember = $('remember')?.checked ?? false;
    const lang = $('lang')?.value ?? DEFAULT_LANG;
    const env = getEnv();
    if (!username || !password) return alert('Please enter both User ID and Password.');
    try {
      await saveCreds(username, password, remember, lang, env);
      await navigateInSameTab(lang, env, 'loginOnly', { force: true });
    } catch (e) {
      console.error('Failed to navigate/login:', e);
      alert('Could not navigate the current tab. Switch to a normal webpage tab and try again.');
    }
  });

  $('run-test')?.addEventListener('click', () => runAutoTest().catch(console.error));

  $('refresh-test')?.addEventListener('click', async () => {
    const messages = readMessages();
    
    // Preserve existing loop count when refreshing
    let existingLoopCount = 1;
    try {
      const existing = await chrome.storage.local.get('testConfig');
      existingLoopCount = existing.testConfig?.loopCount || 1;
    } catch {}
    
    const testConfig = { 
      messages, 
      delayMs: 500, 
      loopCount: existingLoopCount 
    };
    await saveTestConfig(testConfig);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const pending = {
      messages: testConfig.messages.slice(),
      inputSelector: testConfig.inputSelector,
      delayMs: testConfig.delayMs ?? 500,
      expected: null,
      createdAt: Date.now(),
      ttlMs: 60000
    };
    const resumeHint = { createdAt: Date.now(), ttlMs: 60000 };

    try {
      chrome?.storage?.session?.setAccessLevel?.({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
    } catch {}

    try {
      const writes = [];
      if (chrome.storage.session) {
        writes.push(chrome.storage.session.set({ pendingRefreshTest: pending }));
      }
      writes.push(chrome.storage.local.set({ pendingRefreshTest: pending, refreshResumeHint: resumeHint }));
      await Promise.allSettled(writes);
    } catch {}

    const popupLangRaw = $('lang')?.value ?? DEFAULT_LANG;
    const chatbotLang = toChatbotLang(popupLangRaw);
    const env = getEnv(); // <— pass env through to content script

    try {
      const res = await chrome.tabs.sendMessage(tab.id, {
        action: 'refreshTest',
        config: testConfig,
        options: {
          language: chatbotLang,
          env,                  // <— NEW
          reload: true,
          hardReload: false,
          replace: false,
          delayMs: 50
        }
      });
      console.log('Refresh result:', res);
    } catch (e) {
      console.error('Refresh sendMessage failed:', e);
      alert('Could not refresh this tab. Switch to the portal tab and try again.');
    }
  });

  /* --- Chatbot Session ID: init & live updates --- */
  if (DEBUG) { /* optionally dump */ }
  await refreshChatbotSessionId(); // initial load
  $('refresh-session-id')?.addEventListener('click', () => {
    refreshChatbotSessionId().catch(console.error);
  });
  $('copy-session-id')?.addEventListener('click', async () => {
    const el = $('chatbot-session-id');
    const val = el
      ? (el.tagName === 'INPUT' ? el.value : (el.textContent ?? '')).trim()
      : '';
    if (!val || val === '—') return;
    try {
      await navigator.clipboard.writeText(val);
      const old = el.title;
      el.title = 'Copied!';
      setTimeout(() => (el.title = old || val), 800);
    } catch (e) {
      console.error('Copy failed:', e);
      alert('Could not copy session ID.');
    }
  });

  // React to extension session storage changes (instant updates while popup is open)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session') return;
    const ch =
      changes['chatbot.sessionID'] ??
      changes['chatbotSessionID'] ??
      changes['chatbot_sessionID'] ??
      changes['sessionID'];
    if (ch) renderChatbotSessionId(ch.newValue || '');
  });

  // Also react to broadcast message from content script (if you use it)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'CHATBOT_SESSION_ID_CHANGED') {
      renderChatbotSessionId(msg.value || '');
    }
  });
});
