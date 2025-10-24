// refresh.js (module-ized)

export const KEYS = {
  TOKEN: "chatbot.appToken",
  SESSION_ID: "chatbot.sessionID",
  HISTORY: "chatbot.historyMessages",
  IFP_STATUS: "chatbot.ifpStatus",
  POPUP_VISIBLE: "chatbot.popupVisible",
  HAS_BEEN_OPENED: "chatbot.hasBeenOpened",
  LAND_STATUS: "chatbot.landStatus",
  TNC_STATUS: "chatbot.tAndCStatus",
};

export function getSessionIdFromPayload(data, headers) {
  return (
    data?.sessionId ??
    data?.data?.sessionId ??
    data?.sessionID ??
    data?.data?.sessionID ??
    data?.unique_key ??
    data?.data?.unique_key ??
    data?.conversationId ??
    data?.data?.conversationId ??
    headers?.get?.("x-session-id") ??
    headers?.get?.("x-sessionid") ??
    null
  );
}

export function resetChatbotState() {
  [KEYS.HISTORY, KEYS.IFP_STATUS, KEYS.HAS_BEEN_OPENED, KEYS.LAND_STATUS, KEYS.TNC_STATUS]
    .forEach(k => sessionStorage.removeItem(k));
  sessionStorage.setItem(KEYS.POPUP_VISIBLE, "true");
}

export function reloadBrowser({ hard = false, replace = false, delayMs = 50 } = {}) {
  setTimeout(() => {
    if (hard) {
      const url = new URL(window.location.href);
      url.searchParams.set("_ts", Date.now().toString());
      replace ? window.location.replace(url.toString()) : (window.location.href = url.toString());
    } else {
      replace ? window.location.replace(window.location.href) : window.location.reload();
    }
  }, delayMs);
}

/**
 * Explicit refresh endpoints by env (as requested)
 * - UAT1: no web-app path
 * - UAT2/UAT3: with web-app suffix
 */
const ENV_REFRESH_BASES = {
  uat1: 'https://uataksindividuallogin.manulife.com.hk/chatbot/chatbotApi/api/ccaas/v1/init/unique_key',
  uat2: 'https://uataksindividuallogin.manulife.com.hk/hk-cws-ee-portal-web-app-2/chatbot/chatbotApi/api/ccaas/v1/init/unique_key',
  uat3: 'https://uataksindividuallogin.manulife.com.hk/hk-cws-ee-portal-web-app-3/chatbot/chatbotApi/api/ccaas/v1/init/unique_key',
  stg: 'https://stg-ap.manulife.com.hk/chatbot/chatbotApi/api/ccaas/v1/init/unique_key',
  preprod: 'https://preprod-ap.manulife.com.hk/chatbot/chatbotApi/api/ccaas/v1/init/unique_key',
};

// Build URL using popup-selected env when provided; otherwise fall back to page-derived path
function buildRefreshUrl(language, env) {
  const pageLang = new URLSearchParams(location.search).get('lang');
  const lang = String(language ?? pageLang ?? 'en').trim();

  // 1) If env explicitly provided (recommended path)
  if (env && ENV_REFRESH_BASES[env]) {
    return `${ENV_REFRESH_BASES[env]}?language=${encodeURIComponent(lang)}`;
  }

  // 2) Fallback: derive from current location (existing behavior)
  const { origin, pathname } = window.location;
  const m =
    pathname.match(/\/hk-cws-ee-portal-web-app-(\d)\b/) ||
    pathname.match(/\/web-app-(\d)\b/);
  const appN = m ? m[1] : '3'; // default to -3 if nothing matched
  const base = `/hk-cws-ee-portal-web-app-${appN}/chatbot/chatbotApi/api/ccaas/v1/init/unique_key`;
  return `${origin}${base}?language=${encodeURIComponent(lang)}`;
}

export async function refreshSection({
  language,
  env,            // <— NEW: honor popup env for refresh endpoint
  reload = true,  // default false for "refresh & keep sending"
  hardReload = true,
  replace = false,
  delayMs = 50,
} = {}) {
  const token = sessionStorage.getItem(KEYS.TOKEN);
  if (!token) {
    console.error("No token found in sessionStorage under 'chatbot.appToken'.");
    return { ok: false, reason: 'no-token' };
  }
  const url = buildRefreshUrl(language, env);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
        "Cache-Control": "no-store",
        "X-Requested-With": "XMLHttpRequest",
      },
      cache: "no-store",
      credentials: "include",
    });

    let data = null;
    try {
      const ct = response.headers.get("content-type") || "";
      data = ct.includes("application/json") ? await response.json()
        : (() => { throw new Error('non-json'); })();
    } catch {
      const text = await response.text();
      try { data = text ? JSON.parse(text) : null; }
      catch { data = { raw: text }; }
    }

    if (!response.ok) {
      return { ok: false, status: response.status, data };
    }

    const sessionId = getSessionIdFromPayload(data, response.headers);
    if (sessionId) sessionStorage.setItem(KEYS.SESSION_ID, String(sessionId));
    resetChatbotState();

    if (reload) {
      // let UI/console flush
      await new Promise(r => setTimeout(r, delayMs));
      reloadBrowser({ hard: hardReload, replace, delayMs: 0 });
    }
    return { ok: true, status: response.status, sessionId, data, reloaded: !!reload };
  } catch (err) {
    console.error("Error refreshing section:", err);
    return { ok: false, error: String(err) };
  }
}
