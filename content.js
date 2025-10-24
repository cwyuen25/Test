// content.js — Chatbot auto-open & messaging (organized & optimized)
// Maintains original behavior; internal structure & robustness improved.
(() => {
  'use strict';

  /* ============================================================
   * CONFIG / CONSTANTS
   * ========================================================== */
  const TAG = '[UAT TEST V3.1]';

  // Match the TFM page across UAT1 (no web-app prefix) and UAT2/3 (with -2/-3), STG, and PREPROD, allowing optional trailing segments
  const TFM_URL_RE =
    /^https:\/\/(uataksindividuallogin\.manulife\.com\.hk\/(?:hk-cws-ee-portal-web-app-\d+\/)?tfm|stg-ap\.manulife\.com\.hk|preprod-ap\.manulife\.com\.hk)(?:[\/?#].*)?$/i;

  // Helper so we can centralize the check (reads cleaner in runTest & any SPA hook)
  function isTfmUrl(href) {
    try {
      return TFM_URL_RE.test(String(href || window.location.href));
    } catch {
      return false;
    }
  }

  const TIME = Object.freeze({
    docLoad: 20000,
    waitDefault: 15000,
    poll: 80,
    findAny: 8000,
    chatboxReady: 20000,
    sendWaitEnter: 140,
    sendWaitSubmit: 160,
    messagesDelayDefault: 500,
    resumeHintTtl: 60000,
    contactInfo: 10000
  });

  const PATHS = Object.freeze({
    signIn: '/thf/auth/signIn'
  });

  const SELECTORS = Object.freeze({
    user: ['input.input-username'],
    pass: ['input[type="password"].input-id-name-pwd'],
    submit: [
      'button.sign-in-btn',
      'button.mld-button.sign-in-btn',
      'button[type="submit"]',
      'input[type="submit"]'
    ],
    typeboxContainer: '#chatbot-typebox-container'
  });

  const TEXTAREA_DEFAULT = `${SELECTORS.typeboxContainer} textarea`;
  const SEND_CANDIDATES = [
    `${SELECTORS.typeboxContainer} button[type="submit"]`,
    `${SELECTORS.typeboxContainer} [role="button"]`,
    `${SELECTORS.typeboxContainer} svg`
  ];

  const CONTACT_MODAL_SEL = '.base-modal.position-middle.contact-info-alert, cws-landing-contact-info-alert .mld-modal';

  // Fixed: proper alternation to match OK/Okay/Confirm/確定/确定
  const OK_LABEL_RE = /^(ok|okay|confirm|確定|确定)$/i;

  /* ============================================================
   * LOGGING
   * ========================================================== */
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const err = (...a) => console.error(TAG, ...a);

  /* ============================================================
   * GENERIC UTILS
   * ========================================================== */
  const sleep = (ms) =>
    new Promise((r) => setTimeout(r, Math.max(0, Number(ms) || 0)));

  async function waitForDocumentComplete(timeout = TIME.docLoad) {
    if (document.readyState === 'complete') return true;
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('load-timeout')), Math.max(0, timeout));
        window.addEventListener('load', () => { clearTimeout(t); resolve(); }, { once: true });
      });
      return true;
    } catch {
      return false;
    }
  }

  const waitFor = async (predicate, { timeout = TIME.waitDefault, poll = TIME.poll } = {}) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { if (await predicate()) return true; } catch {}
      await sleep(poll);
    }
    return false;
  };

  const getWin = (el) => el?.ownerDocument?.defaultView ?? window;

  const isShown = (el) => {
    if (!el) return false;
    const win = getWin(el);
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0' || cs.pointerEvents === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const isInteractable = (el) =>
    !!el && isShown(el) && !el.disabled && el.getAttribute('disabled') == null && el.getAttribute('aria-disabled') !== 'true';

  function setValue(el, v) {
    if (!el) return;
    const win = getWin(el);
    try {
      const proto =
        el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement?.prototype :
        el.tagName === 'INPUT' ? win.HTMLInputElement?.prototype : null;
      const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;
      if (setter) { el.focus(); setter.call(el, v); } else { el.value = v; }
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
    } catch {
      try { el.value = v; } catch {}
    }
  }

  function clickEl(el) {
    if (!el) return;
    const win = getWin(el);
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const o = { bubbles: true, cancelable: true, view: win };
    try {
      el.dispatchEvent(new win.PointerEvent('pointerdown', o));
      el.dispatchEvent(new win.MouseEvent('mousedown', o));
      el.dispatchEvent(new win.PointerEvent('pointerup', o));
      el.dispatchEvent(new win.MouseEvent('mouseup', o));
      el.dispatchEvent(new win.MouseEvent('click', o));
    } catch {}
    try { el.click?.(); } catch {}
  }

  const pressEnter = (el) => {
    if (!el) return;
    const win = getWin(el);
    const e = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    try { el.focus(); } catch {}
    try {
      el.dispatchEvent(new win.KeyboardEvent('keydown', e));
      el.dispatchEvent(new win.KeyboardEvent('keypress', e));
      el.dispatchEvent(new win.KeyboardEvent('keyup', e));
    } catch {}
  };

  function waitForSelector(selectorOrFn, timeout = TIME.waitDefault, root = document) {
    return new Promise((resolve, reject) => {
      const get = () => (typeof selectorOrFn === 'function' ? selectorOrFn() : root.querySelector(selectorOrFn));
      const first = get();
      if (first) return resolve(first);
      const target = root.documentElement ?? root;
      const obs = new MutationObserver(() => {
        const el = get();
        if (el) {
          try { obs.disconnect(); } catch {}
          resolve(el);
        }
      });
      try { obs.observe(target, { childList: true, subtree: true }); } catch {}
      setTimeout(() => { try { obs.disconnect(); } catch {} reject(new Error('waitForSelector timeout')); }, timeout);
    });
  }

  async function findAny(selectors, timeout = TIME.findAny) {
    const end = Date.now() + timeout;
    const listRaw = Array.isArray(selectors) ? selectors : [selectors];
    const list = listRaw.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
    if (list.length === 0) return { el: null, doc: null };
    while (Date.now() < end) {
      for (const sel of list) {
        const topEl = document.querySelector(sel);
        if (topEl) return { el: topEl, doc: document };
        for (const fr of Array.from(document.querySelectorAll('iframe,frame'))) {
          try {
            const doc = fr.contentDocument;
            if (!doc) continue;
            const hit = doc.querySelector(sel);
            if (hit) return { el: hit, doc };
          } catch { /* cross-origin */ }
        }
      }
      await sleep(120);
    }
    return { el: null, doc: null };
  }

  /* ============================================================
   * I18N
   * ========================================================== */
  function normalizeChatbotLang(input) {
    const v = String(input ?? '').trim().toLowerCase().replace('-', '_');
    if (v === 'en') return 'en';
    // Traditional Chinese
    if (v === 'zh_hk' || v === 'zh_tw' || v === 'zh_hant' || v === 'tc') return 'zh_hk';
    // Simplified Chinese (default for zh, zh_cn, zh_hans, sc)
    if (v === 'zh_cn' || v === 'zh' || v === 'zh_hans' || v === 'sc') return 'zh_cn';
    // Extra lenient fallbacks
    if (v === 'zh-cn') return 'zh_cn';
    if (v === 'zh-hk' || v === 'zh-tw') return 'zh_hk';
    return 'en';
  }

  /* ============================================================
   * STORAGE & URL HELPERS
   * ========================================================== */
  let memCreds = null;

  async function getCreds() {
    if (memCreds) return memCreds;
    let ses = {};
    try {
      if (chrome.storage.session) {
        ses = await chrome.storage.session.get(['username', 'password', 'ephemeral']);
      }
    } catch {}
    const loc = await chrome.storage.local.get(['username', 'password', 'ephemeral']);
    memCreds = {
      username: ses.username ?? loc.username,
      password: ses.password ?? loc.password,
      ephemeral: (ses.ephemeral ?? loc.ephemeral) === true
    };
    return memCreds;
  }

  async function cleanupAfterRun(ephemeral) {
    if (!ephemeral) return;
    await chrome.storage.local.remove(['username', 'password', 'ephemeral']);
    try {
      if (chrome.storage.session) await chrome.storage.session.remove(['username', 'password', 'ephemeral']);
    } catch {}
  }

  const isSignInUrl = (u) => {
    try {
      return new URL(u, location.href).pathname.includes(PATHS.signIn);
    } catch { return false; }
  };

  /* ============================================================
   * LOGIN
   * ========================================================== */
  const buttonByText = (doc, re) => {
    const candidates = doc.querySelectorAll('button, [role="button"], input[type="submit"]');
    for (const b of candidates) {
      const t = (b.textContent ?? b.value ?? b.getAttribute?.('aria-label') ?? '').trim();
      if (re.test(t)) return b;
    }
    return null;
  };

  async function performLoginSteps(username, password, hints = {}) {
    log('Login: locating inputs...');
    const u = await findAny(SELECTORS.user, 15000);
    const p = await findAny(SELECTORS.pass, 15000);
    const userEl = u.el, passEl = p.el;
    if (!userEl || !passEl) {
      warn('Login: inputs not found (top or same-origin frames).');
      return false;
    }
    const doc = passEl.ownerDocument;

    // Fill
    setValue(userEl, username);
    setValue(passEl, password);

    // Submit preference: submit button in same doc → form → Enter
    let submitEl =
      doc.querySelector(SELECTORS.submit.join(',')) ||
      buttonByText(doc, /(登录|登入|Sign\s*in|Log\s*in)/i);

    const formEl =
      passEl.closest('form') ||
      userEl.closest('form') ||
      doc.querySelector('form');

    if (submitEl && isInteractable(submitEl)) {
      clickEl(submitEl);
    } else if (formEl) {
      try {
        formEl.requestSubmit ? formEl.requestSubmit()
          : clickEl(formEl.querySelector('button[type="submit"],input[type="submit"]'));
      } catch { pressEnter(passEl); }
    } else {
      pressEnter(passEl);
    }

    // Success heuristics
    const startUrl = (doc.defaultView ?? window).location.href;
    const urlRe = hints.postLoginUrlRegex instanceof RegExp
      ? hints.postLoginUrlRegex
      : /(home|dashboard|landing|overview)\b/i;

    const successSel =
      hints.postLoginSelector ??
      '[data-qa="header-logout"], a[href*="logout"], [data-user], .user-profile';

    const success = await Promise.race([
      waitFor(() => {
        const href = window.location.href;
        return ((href !== startUrl && !/\/adapter\b/i.test(href)) || urlRe.test(href));
      }, { timeout: 10000 }),
      (async () => {
        const gone = await waitFor(
          () => !document.querySelector(SELECTORS.user.join(',')) && !document.querySelector(SELECTORS.pass.join(',')),
          { timeout: 5000 }
        );
        if (!gone) return false;
        await sleep(300);
        return !document.querySelector(SELECTORS.user.join(',')) && !document.querySelector(SELECTORS.pass.join(','));
      })(),
      waitFor(() => !!document.querySelector(successSel), { timeout: 10000 })
    ]);

    log('Login: success =', !!success);
    if (success) { try { chrome.runtime.sendMessage({ type: 'CLOSE_POPUP' }); } catch {} }
    return !!success;
  }

  async function login({ username, password, force = false, cleanup = true, loginSuccess } = {}) {
    try {
      const creds = await getCreds();
      const u = (username ?? creds.username);
      const p = (password ?? creds.password);
      if (!u || !p) return { ok: false, reason: 'missing creds' };

      if (!force && !isSignInUrl(location.href)) {
        const uHint = document.querySelector(SELECTORS.user.join(','));
        const pHint = document.querySelector(SELECTORS.pass.join(','));
        if (!uHint && !pHint) return { ok: false, reason: 'not on sign-in page' };
      }

      const ok = await performLoginSteps(u, p, loginSuccess ?? {});
      if (ok && cleanup) {
        const { ephemeral } = await getCreds();
        await cleanupAfterRun(ephemeral);
      }
      return { ok };
    } catch (e) {
      err('login() error:', e);
      return { ok: false, error: String(e) };
    }
  }

  /* ============================================================
   * OVERLAY DISMISSAL (Contact Info Alert)
   * ========================================================== */
  function extractControlLabel(el) {
    const parts = [el?.textContent, el?.value, el?.getAttribute?.('aria-label'), el?.getAttribute?.('title')]
      .filter(Boolean).map((s) => String(s).trim());
    const raw = parts.join(' ').trim();
    const normalized = raw
      .replace(/\s+/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\(\)\[\]\{\}.,;:!\?，。！？”、・·•]/g, '');
    return { raw, normalized };
  }

  function findContactInfoOkButton() {
    const modal = document.querySelector(CONTACT_MODAL_SEL);
    const scope = modal && isShown(modal) ? modal : document;
    const candidates = scope.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]');
    for (const b of candidates) {
      const { normalized } = extractControlLabel(b);
      if (OK_LABEL_RE.test(normalized) && isInteractable(b)) return b;
    }
    return Array.from(document.querySelectorAll('button,[role="button"]'))
      .find((b) => {
        const { normalized } = extractControlLabel(b);
        return OK_LABEL_RE.test(normalized) && isInteractable(b) && !!b.closest('.contact-info-alert');
      }) || null;
  }

  async function dismissContactInfoAlert(timeout = TIME.contactInfo) {
    const okBtn = await waitForSelector(findContactInfoOkButton, timeout).catch(() => null);
    if (!okBtn) return false;
    clickEl(okBtn);
    log('Contact info alert: dismissed (OK/確定 clicked).');
    return true;
  }

  /* ============================================================
   * CHATBOT INPUT HELPERS
   * ========================================================== */
  const normalizeInputSelector = (sel) => {
    if (typeof sel !== 'string') return TEXTAREA_DEFAULT;
    const s = sel.trim();
    return s.length ? s : TEXTAREA_DEFAULT;
  };

  function isDisabledish(el) {
    if (!el) return true;
    const win = getWin(el);
    let cs = null;
    try { cs = win.getComputedStyle(el); } catch {}
    const aria = el.getAttribute?.('aria-disabled') === 'true';
    const peNone = cs?.pointerEvents === 'none';
    const curNA = cs?.cursor === 'not-allowed';
    return !!(el.disabled || aria || el.readOnly || peNone || curNA);
  }

  async function waitUntilChatboxReady({
    inputSelector = TEXTAREA_DEFAULT,
    containerSelector = SELECTORS.typeboxContainer,
    timeout = TIME.chatboxReady
  } = {}) {
    inputSelector = normalizeInputSelector(inputSelector);
    containerSelector = (typeof containerSelector === 'string' && containerSelector.trim())
      ? containerSelector.trim() : SELECTORS.typeboxContainer;

    const deadline = Date.now() + Math.max(0, Number(timeout) || 0);

    let taDocPair = await findAny(inputSelector, 8000);
    if (!taDocPair.el) {
      while (!taDocPair.el && Date.now() < deadline) {
        await sleep(120);
        taDocPair = await findAny(inputSelector, 800);
      }
      if (!taDocPair.el) return { ok: false, reason: 'textarea-not-found' };
    }

    const textarea = taDocPair.el;
    const doc = taDocPair.doc || document;

    let container =
      textarea.closest(containerSelector) ||
      doc.querySelector(containerSelector) ||
      doc;

    const blockedByClass = () => container?.classList?.contains('cb:cursor-not-allowed');
    const resolveSend = () => (container || doc).querySelector(SEND_CANDIDATES.join(','));

    if (isDisabledish(textarea) || blockedByClass()) {
      const ready = await new Promise((resolve) => {
        let done = false;
        const finish = (val) => { if (!done) { done = true; try { obs.disconnect(); } catch {} resolve(val); } };
        const obs = new MutationObserver(() => {
          if (!isDisabledish(textarea) && !blockedByClass()) finish(true);
        });
        try { obs.observe(container, { attributes: true, subtree: true }); } catch {}
        (async () => {
          while (Date.now() < deadline) {
            if (!isDisabledish(textarea) && !blockedByClass()) return finish(true);
            await sleep(120);
          }
          finish(false);
        })();
      });
      if (!ready) return { ok: false, reason: 'chatbox-not-ready' };
    }

    if (!isInteractable(textarea)) {
      try { textarea.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    }
    return { ok: true, textarea, sendEl: resolveSend(), container };
  }

  async function inputMessage(text, { inputSelector = TEXTAREA_DEFAULT, timeout = TIME.chatboxReady } = {}) {
    inputSelector = normalizeInputSelector(inputSelector);
    const ready = await waitUntilChatboxReady({ inputSelector, timeout });
    if (!ready.ok) return { ok: false, reason: ready.reason || 'not-ready' };
    const { textarea, sendEl } = ready;
    setValue(textarea, text);
    try { const win = getWin(textarea); textarea.dispatchEvent(new win.KeyboardEvent('keyup', { key: ' ', bubbles: true })); } catch {}
    return { ok: true, textarea, sendEl };
  }

  async function sendMessage({ textarea = null, sendEl = null, inputSelector = TEXTAREA_DEFAULT, timeout = 10000 } = {}) {
    inputSelector = normalizeInputSelector(inputSelector);
    if (!textarea) {
      const found = await waitUntilChatboxReady({ inputSelector, timeout });
      if (!found.ok) return { ok: false, method: 'none', reason: found.reason || 'not-ready' };
      textarea = found.textarea;
      sendEl = found.sendEl;
    }

    // 1) Try Enter
    pressEnter(textarea);
    await sleep(TIME.sendWaitEnter);
    if (!textarea.value || textarea.value.trim().length === 0) return { ok: true, method: 'enter' };

    // 2) Try form submission
    const form = textarea.closest('form');
    if (form) {
      try {
        if (form.requestSubmit) form.requestSubmit();
        else clickEl(form.querySelector('button[type="submit"], input[type="submit"]'));
        await sleep(TIME.sendWaitSubmit);
        if (!textarea.value || textarea.value.trim().length === 0) return { ok: true, method: 'form-submit' };
      } catch { /* ignore */ }
    }

    // 3) Click send control
    if (sendEl) {
      try {
        const clickable = sendEl.closest('button,[role="button"]') || sendEl;
        clickEl(clickable);
        await sleep(TIME.sendWaitSubmit);
        if (!textarea.value || textarea.value.trim().length === 0) return { ok: true, method: 'click' };
      } catch { /* ignore */ }
    }

    return { ok: false, method: 'exhausted', reason: 'not-cleared-after-submit' };
  }

  async function sendAllMessages(
    messages,
    { inputSelector = TEXTAREA_DEFAULT, delayMs = TIME.messagesDelayDefault, waitBeforeNext = null } = {}
  ) {
    inputSelector = normalizeInputSelector(inputSelector);
    if (!Array.isArray(messages) || messages.length === 0) return { ok: false, reason: 'no-messages' };
    for (let i = 0; i < messages.length; i++) {
      const msg = String(messages[i] ?? '').trim();
      if (!msg) continue;
      const typed = await inputMessage(msg, { inputSelector });
      if (!typed.ok) return { ok: false, index: i, reason: typed.reason || 'input-failed' };
      const sent = await sendMessage({ textarea: typed.textarea, sendEl: typed.sendEl, inputSelector });
      if (!sent.ok) return { ok: false, index: i, reason: sent.reason || 'send-failed' };
      if (typeof waitBeforeNext === 'function') { try { await waitBeforeNext(i, msg); } catch {} }
      if (delayMs > 0) await sleep(delayMs);
    }
    return { ok: true };
  }

  /* ============================================================
   * CHATBOT SESSION HELPERS
   * ========================================================== */
  function setChatbotPopupFlagInSession(language) {
    // Ensure the chatbot popup opens after reload
    try { sessionStorage.setItem('chatbot.popupVisible', 'true'); } catch {}
    // Decide and persist language
    const fromUrl = new URLSearchParams(location.search).get('lang');
    const chosen = normalizeChatbotLang(language ?? fromUrl ?? 'en');
    try { sessionStorage.setItem('chatbot.language', chosen); } catch {}
  }

  function setChatbotLanguageInSession(language) {
    if (!language) return;
    try { sessionStorage.setItem('chatbot.language', normalizeChatbotLang(language)); } catch {}
  }

  function clearChatbotPopupFlagInSession() {
    try { sessionStorage.removeItem('chatbot.popupVisible'); } catch {}
    try {
      const KEY = 'chatbot.popupVisible';
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        let obj = {};
        try { obj = JSON.parse(raw); } catch {}
        if (obj && typeof obj === 'object' && 'popupVisible' in obj) {
          delete obj.popupVisible;
          sessionStorage.setItem(KEY, JSON.stringify(obj));
        }
      }
    } catch {}
  }

  async function openChatbotViaSessionReload({
    resumePlan = null,
    hintTtlMs = TIME.resumeHintTtl,
    hardReload = false,
    language = null
  } = {}) {
    // 1) Set the popup flag so the page opens the chatbot on next load, and persist chatbot.language
    setChatbotPopupFlagInSession(language);

    // 2) Prepare auto‑resume so messages send after reload
    if (resumePlan && Array.isArray(resumePlan.messages) && resumePlan.messages.length > 0) {
      const now = Date.now();
      try {
        await chrome.storage.local.set({
          refreshResumeHint: { createdAt: now, ttlMs: hintTtlMs },
          // Note: DO NOT save testConfig here with repeated messages
          // This would overwrite the original popup config and cause
          // message input fields to multiply on popup reload
        });
      } catch {}
    }

    // 3) Reload (hard or soft)
    try {
      if (hardReload) {
        // Force a navigation-based reload to mimic a “hard” reload
        location.href = location.href;
      } else {
        location.reload();
      }
    } catch {
      location.href = location.href;
    }

    // The tab will reload; this return is mostly for completeness
    return { ok: true, reloading: true };
  }

  /* ============================================================
   * ORCHESTRATOR
   * ========================================================== */
  async function runTest(config, language = null) {
    try {
      if (!config || !Array.isArray(config.messages) || config.messages.length === 0) {
        warn('runTest: no messages provided; aborting.');
        return { ok: false, reason: 'no messages' };
      }

      // 1) Login (best‑effort) - Skip for STG and PREPROD
      const currentUrl = window.location.href;
      const isNoLoginEnv = /stg-ap\.manulife\.com\.hk|preprod-ap\.manulife\.com\.hk/i.test(currentUrl);
      if (!isNoLoginEnv) {
        try { await login({ force: true, loginSuccess: config?.loginSuccess }); }
        catch (e) { warn('Login step warning (continuing):', e); }
      } else {
        log('Skipping login for STG/PREPROD environment');
      }

      // 2) Wait until the URL is one of the TFM pages (root /tfm, app-2/tfm, app-3/tfm, etc.)
      const waitMs = Number.isFinite(config?.waitForTfmMs) ? config.waitForTfmMs : 60000; // default 60s
      log('runTest: waiting for TFM URL...', { waitMs });
      const alreadyOnTfm = isTfmUrl(window.location.href);
      const matched = alreadyOnTfm ||
        await waitFor(
          () => isTfmUrl(window.location.href),
          { timeout: waitMs, poll: TIME.poll }
        );
      if (!matched) {
        warn('runTest: TFM URL did not appear within timeout; skipping reload.');
        return { ok: false, reason: 'tfm-url-timeout' };
      }

      // 3) We are (now) on TFM URL → set session + reload; messages will be sent by auto‑resume
      // Repeat messages according to loopCount (default 1, max 500)
      let loopCount = 1;
      if (typeof config.loopCount === 'number') {
        loopCount = Math.max(1, Math.min(500, Math.floor(config.loopCount)));
      }
      let repeatedMessages = [];
      for (let i = 0; i < loopCount; ++i) {
        repeatedMessages = repeatedMessages.concat(config.messages);
      }
      await openChatbotViaSessionReload({
        resumePlan: {
          messages: repeatedMessages,
          inputSelector: normalizeInputSelector(config.inputSelector),
          delayMs: config.delayMs ?? TIME.messagesDelayDefault
        },
        hintTtlMs: TIME.resumeHintTtl,
        hardReload: !!config?.hardReload,
        language
      });

      // Typically not reached because the tab reloads
      return { ok: true, stage: 'reloading-after-tfm' };
    } catch (e) {
      err('Auto Test error:', e);
      return { ok: false, error: String(e) };
    }
  }

  /* ============================================================
   * AUTO‑RESUME AFTER RELOAD (IIFE)
   * ========================================================== */
  (async function resumeAfterRefresh() {
    try {
      log('Auto-resume: start');
      const loaded = await waitForDocumentComplete(TIME.docLoad);
      if (!loaded) warn('Auto-resume: document load timeout, continuing anyway');

      // 1) Pending plan from session → local
      let pending = null;
      try {
        if (chrome.storage.session) {
          const ses = await chrome.storage.session.get(['pendingRefreshTest']);
          pending = ses?.pendingRefreshTest ?? null;
        }
      } catch {}
      if (!pending) {
        try {
          const loc = await chrome.storage.local.get(['pendingRefreshTest']);
          pending = loc?.pendingRefreshTest ?? null;
        } catch {}
      }

      // 2) Fallback to popup config if resume hint is fresh
      let useTestConfigFallback = false;
      let testConfig = null;
      if (!pending) {
        try {
          const { refreshResumeHint, testConfig: cfg } = await chrome.storage.local.get(['refreshResumeHint', 'testConfig']);
          const now = Date.now();
          const fresh = refreshResumeHint?.createdAt && (now - refreshResumeHint.createdAt) <= (refreshResumeHint.ttlMs ?? TIME.resumeHintTtl);
          if (fresh && Array.isArray(cfg?.messages) && cfg.messages.length > 0) {
            useTestConfigFallback = true;
            testConfig = cfg;
            log('Auto-resume: using popup testConfig fallback (messages from popup).');
          } else {
            log('Auto-resume: no pending plan and no fresh resume hint; exit.');
            return;
          }
        } catch (e) {
          warn('Auto-resume: could not load fallback testConfig; exit.', e);
          return;
        }
      } else {
        log('Auto-resume: pending plan found', {
          haveMessages: Array.isArray(pending.messages) && pending.messages.length > 0,
          ttlMs: pending.ttlMs, createdAt: pending.createdAt
        });
        const now = Date.now();
        const ttlMs = Number.isFinite(pending.ttlMs) ? pending.ttlMs : TIME.resumeHintTtl;
        if (pending.createdAt && now - pending.createdAt > ttlMs) {
          warn('Auto-resume: pending is stale, clearing.');
          try {
            const clears = [];
            if (chrome.storage.session) clears.push(chrome.storage.session.remove(['pendingRefreshTest']));
            clears.push(chrome.storage.local.remove(['pendingRefreshTest']));
            await Promise.allSettled(clears);
          } catch {}
          return;
        }
      }

      // 4) Build message list and repeat for loopCount
      let loopCount = 1;
      let baseMessages = [];
      let inputSelector, delayMs;
      if (useTestConfigFallback) {
        baseMessages = Array.isArray(testConfig.messages) ? testConfig.messages.slice() : [];
        inputSelector = normalizeInputSelector(testConfig.inputSelector);
        delayMs = Number.isFinite(testConfig.delayMs) ? testConfig.delayMs : TIME.messagesDelayDefault;
        if (typeof testConfig.loopCount === 'number') {
          loopCount = Math.max(1, Math.min(500, Math.floor(testConfig.loopCount)));
        }
      } else {
        baseMessages = Array.isArray(pending.messages) ? pending.messages.slice() : [];
        inputSelector = normalizeInputSelector(pending.inputSelector);
        delayMs = Number.isFinite(pending.delayMs) ? pending.delayMs : TIME.messagesDelayDefault;
        if (typeof pending.loopCount === 'number') {
          loopCount = Math.max(1, Math.min(500, Math.floor(pending.loopCount)));
        }
      }
      let repeatedMessages = [];
      for (let i = 0; i < loopCount; ++i) {
        repeatedMessages = repeatedMessages.concat(baseMessages);
      }
      if (!repeatedMessages.length) { warn('Auto-resume: no messages to send; abort.'); return; }

      // 5) Send messages
      const sendRes = await sendAllMessages(repeatedMessages, { inputSelector, delayMs });
      log('Auto-resume: sendAllMessages result:', sendRes);

      // 6) Cleanup: clear plan + hint + popup flag
      try {
        const tasks = [];
        if (chrome.storage.session) tasks.push(chrome.storage.session.remove(['pendingRefreshTest']));
        tasks.push(chrome.storage.local.remove(['pendingRefreshTest', 'refreshResumeHint']));
        await Promise.allSettled(tasks);
      } catch {}
      try { clearChatbotPopupFlagInSession(); } catch {}
      try { sessionStorage.removeItem('chatbot.reloadAttempt'); } catch {}

      // 7) Notify
      try { chrome.runtime.sendMessage({ type: 'REFRESH_TEST_DONE', ok: !!sendRes.ok }); } catch {}
    } catch (e) {
      err('Auto-resume: unexpected error:', e);
    }
  })();

  /* ============================================================
   * CHATBOT SESSION ID SYNC (page <-> extension)
   * Keeps chrome.storage.session['chatbot.sessionID'] in sync with
   * window.sessionStorage['chatbot.sessionID'] so the popup can live-update.
   * ========================================================== */
  (function chatbotSessionIdSync() {
    const KEY = 'chatbot.sessionID';
    const TOP_ONLY = true; // Avoid duplicate writers when all_frames=true
    if (TOP_ONLY && window !== window.top) return;

    // Allow content script to write to chrome.storage.session in MV3
    try {
      chrome?.storage?.session?.setAccessLevel?.({
        accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
      });
    } catch {}

    let last = null;

    const readFromPage = () => {
      try { return window.sessionStorage.getItem(KEY) || ''; }
      catch { return ''; }
    };

    const writeToExtension = async (val) => {
      if (val === last) return;
      last = val;
      // 1) Update extension session storage (popup listens to onChanged)
      try {
        if (chrome?.storage?.session) {
          await chrome.storage.session.set({ [KEY]: val });
        }
      } catch {}
      // 2) Broadcast runtime message (popup also listens to this)
      try {
        chrome.runtime.sendMessage({
          type: 'CHATBOT_SESSION_ID_CHANGED',
          value: val,
        });
      } catch {}
    };

    // Initial sync
    writeToExtension(readFromPage());

    // Lightweight polling fallback (robust across SPA navigations/edge cases)
    const POLL_MS = 1000; // tune if needed
    setInterval(() => {
      const v = readFromPage();
      if (v !== last) writeToExtension(v);
    }, POLL_MS);

    // Inject small page-world hook to catch immediate changes to sessionStorage
    try {
      const code = `
        (function () {
          const KEY = '${KEY}';
          const notify = () => {
            try {
              window.postMessage(
                { type: '__CHATBOT_SESSION_ID__', value: sessionStorage.getItem(KEY) },
                '*'
              );
            } catch {}
          };
          const _set = sessionStorage.setItem;
          const _rm = sessionStorage.removeItem;
          const _clr = sessionStorage.clear;
          sessionStorage.setItem = function(k, v) {
            try { return _set.call(this, k, v); }
            finally { if (k === KEY) notify(); }
          };
          sessionStorage.removeItem = function(k) {
            try { return _rm.call(this, k); }
            finally { if (k === KEY) notify(); }
          };
          sessionStorage.clear = function() {
            try { return _clr.call(this); }
            finally { notify(); }
          };
          // Emit current value once at startup
          notify();
        })();
      `;
      const s = document.createElement('script');
      s.textContent = code;
      (document.documentElement || document.head).appendChild(s);
      s.remove();
      // Receive page->content updates
      window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        if (e.data && e.data.type === '__CHATBOT_SESSION_ID__') {
          const val = (e.data.value ?? '').toString();
          writeToExtension(val);
        }
      });
    } catch {}
  })();

  /* ============================================================
   * POPUP BRIDGE
   * ========================================================== */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg?.action === 'loginOnly' || msg?.action === 'login') {
          const res = await login({
            username: msg?.username,
            password: msg?.password,
            force: !!msg?.force,
            cleanup: msg?.cleanup !== false,
            loginSuccess: msg?.loginSuccess
          });
          sendResponse(res);
          return;
        }

        if (msg?.action === 'runTest') {
          // Run test triggers a reload-based open; messages are sent on auto‑resume
          const cfg = msg?.config ?? null;
          const langFromUrl = new URLSearchParams(location.search).get('lang');
          const chosenLang = normalizeChatbotLang(msg?.language ?? langFromUrl ?? 'en');
          const res = await runTest(cfg, chosenLang);
          sendResponse(res);
          return;
        }

        if (msg?.action === 'refreshTest') {
          // Env-aware refresh flow
          const cfg = msg?.config ?? { messages: [] };
          const { refreshSection } = await import(chrome.runtime.getURL('refresh.js'));
          const langFromUrl = new URLSearchParams(location.search).get('lang');
          const rawLang = msg?.options?.language ?? langFromUrl ?? 'en';
          const language = normalizeChatbotLang(rawLang);

          // Persist chatbot.language immediately for the refreshed view
          setChatbotLanguageInSession(language);

          // NEW: validate & forward env from popup so refresh.js can pick the correct endpoint
          const env = /^(uat1|uat2|uat3)$/i.test(msg?.options?.env ?? '')
            ? msg.options.env.toLowerCase()
            : undefined;

          const reload = msg?.options?.reload ?? false;
          const refreshRes = await refreshSection({
            language,
            env,            // <— NEW
            reload,
            hardReload: !!msg?.options?.hardReload,
            replace: !!msg?.options?.replace,
            delayMs: Number.isFinite(msg?.options?.delayMs) ? msg.options.delayMs : 50
          });

          if (!refreshRes.ok) {
            sendResponse({ ok: false, stage: 'refresh', refreshRes });
            log('Refresh FAILED', refreshRes);
            return;
          }

          if (reload) {
            sendResponse({ ok: true, stage: 'reloaded', refreshRes });
            log('Reload OK');
            return;
          }

          const sendRes = await sendAllMessages(cfg.messages, {
            inputSelector: normalizeInputSelector(cfg.inputSelector),
            delayMs: cfg.delayMs ?? 100
          });
          sendResponse({ ok: !!sendRes.ok, refreshRes, sendRes });
          return;
        }
      } catch (e) {
        console.error('bridge error:', e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // keep channel alive for async response
  });
})();
