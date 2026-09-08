const SCRAPE_ORIGINS = new Set([
  "https://www.javbus.com",
  "https://www.javlibrary.com",
  "https://javdb.com",
  "https://avsox.click",
]);
const RELAY_KEY_PREFIX = "javboss:browser-relay:";
const RELAY_SESSION_KEY_PREFIX = "javboss:browser-session:";
const JAVDB_ASSIST_KEY_PREFIX = "javboss:javdb-assist:";
const LEGACY_RELAY_KEY_PREFIX = "javboss:javbus-relay:";
const LEGACY_RELAY_SESSION_KEY_PREFIX = "javboss:javbus-session:";
const MAGNET_DOWNLOAD_SETTINGS_KEY = "javboss:magnet-download-settings";
const CONNECTION_SETTINGS_KEY = "javboss:connection-settings";
const storageReady = chrome.storage.local
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .then(
    () => true,
    () => false,
  );

async function requirePrivateStorage() {
  if (!(await storageReady))
    throw new Error("无法安全访问扩展凭据，请重新加载扩展");
}

const JAVDB_SETTINGS_KEY = "javboss:javdb-settings";

function relayKey(tabId) {
  return `${RELAY_KEY_PREFIX}${tabId}`;
}

function relaySessionKey(sessionId) {
  return `${RELAY_SESSION_KEY_PREFIX}${sessionId}`;
}

function javDBAssistKey(tabId) {
  return `${JAVDB_ASSIST_KEY_PREFIX}${tabId}`;
}

function validScrapeURL(value) {
  try {
    const parsed = new URL(String(value || ""));
    return SCRAPE_ORIGINS.has(parsed.origin) ? parsed.href : "";
  } catch {
    return "";
  }
}

function validJavDBURL(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.origin !== "https://javdb.com") return "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return "";
  }
}

function validSessionID(value) {
  const sessionId = String(value || "");
  return /^[a-zA-Z0-9_-]{8,128}$/.test(sessionId) ? sessionId : "";
}

function validMagnetURL(value) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.length > 16384) return "";
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "magnet:") return "";
    return parsed.searchParams
      .getAll("xt")
      .some((value) => value.toLowerCase().startsWith("urn:btih:"))
      ? candidate
      : "";
  } catch {
    return "";
  }
}

function normalizedServerURL(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      (parsed.protocol === "http:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) ||
      parsed.username ||
      parsed.password
    ) {
      return "";
    }
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

async function magnetDownloadSettings() {
  await requirePrivateStorage();
  const stored = await chrome.storage.local.get([
    MAGNET_DOWNLOAD_SETTINGS_KEY,
    CONNECTION_SETTINGS_KEY,
  ]);
  const settings = stored[MAGNET_DOWNLOAD_SETTINGS_KEY];
  const connection = stored[CONNECTION_SETTINGS_KEY];
  const serverUrl = normalizedServerURL(connection?.serverUrl);
  return {
    enabled: settings?.enabled === true && Boolean(serverUrl),
    serverUrl,
    apiToken: String(connection?.apiToken || "").trim(),
  };
}

async function javDBAutoRedirectEnabled() {
  await requirePrivateStorage();
  const stored = await chrome.storage.local.get(JAVDB_SETTINGS_KEY);
  return stored[JAVDB_SETTINGS_KEY]?.autoRedirect !== false;
}

async function submitMagnetDownload(message) {
  const magnetUrl = validMagnetURL(message?.magnetUrl);
  if (!magnetUrl) return { ok: false, error: "invalid magnet link" };
  const settings = await magnetDownloadSettings();
  if (!settings.enabled) {
    return {
      ok: false,
      error: "请先在扩展中填写 JavBoss Server 地址并启用磁力下载",
    };
  }
  const token = settings.apiToken;
  if (!/^jbe_[A-Za-z0-9_-]{43}$/.test(token)) {
    return {
      ok: false,
      error:
        "请先在 JavBoss 全局设置的安全页面创建 API 令牌，并在扩展中保存 Token",
    };
  }
  const downloadUrl = new URL("extension/downloads", `${settings.serverUrl}/`)
    .href;

  const response = await fetch(downloadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "omit",
    redirect: "error",
    body: JSON.stringify({ magnet_url: magnetUrl }),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Error responses from an unavailable or stale server may not be JSON.
  }
  if (response.status === 401) {
    return {
      ok: false,
      error:
        "API 令牌无效或已过期，请在 JavBoss 中创建或重新生成 API 令牌，再更新扩展 Token",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: String(
        payload?.error_zh ||
          payload?.error_en ||
          `JavBoss returned HTTP ${response.status}`,
      ),
    };
  }
  return { ok: true };
}

function validJavDBAssistRequest(value) {
  const target = String(value?.target || "").trim();
  const code = String(value?.code || "").trim();
  const name = String(value?.name || "").trim();
  if (
    !["movie", "idol", "series", "studio"].includes(target) ||
    !code ||
    code.length > 128 ||
    name.length > 256
  ) {
    return null;
  }
  return { target, code, name };
}

function isExtensionBridgeSender(sender) {
  try {
    const senderURL = new URL(String(sender.url || ""));
    return (
      senderURL.protocol === "chrome-extension:" &&
      senderURL.pathname === "/bridge.html"
    );
  } catch {
    return false;
  }
}

function placeTabAfterSender(createProperties, sender) {
  if (Number.isInteger(sender.tab?.windowId)) {
    createProperties.windowId = sender.tab.windowId;
  }
  if (Number.isInteger(sender.tab?.index) && sender.tab.index >= 0) {
    createProperties.index = sender.tab.index + 1;
  }
}

async function openRelayTab(message, sender) {
  const url = validScrapeURL(message?.url);
  const sessionId = validSessionID(message?.sessionId);
  let senderURL;
  try {
    senderURL = new URL(String(sender.url || ""));
  } catch {
    senderURL = null;
  }
  if (
    !url ||
    !sessionId ||
    senderURL?.protocol !== "chrome-extension:" ||
    senderURL.pathname !== "/bridge.html"
  ) {
    return { ok: false, error: "invalid relay request" };
  }

  const createProperties = {
    url: "about:blank",
    active: true,
  };
  placeTabAfterSender(createProperties, sender);
  const relayTab = await chrome.tabs.create(createProperties);
  const relayTabId = relayTab?.id;
  if (!Number.isInteger(relayTabId)) {
    return { ok: false, error: "failed to create metadata tab" };
  }

  await chrome.storage.session.set({
    [relayKey(relayTabId)]: {
      sessionId,
    },
    [relaySessionKey(sessionId)]: {
      sessionId,
    },
  });
  await chrome.tabs.update(relayTabId, { url });
  return { ok: true };
}

async function openJavDBAssistTab(message, sender) {
  const request = validJavDBAssistRequest(message?.request);
  const sessionId = validSessionID(message?.sessionId);
  const url = validJavDBURL(message?.url);
  const fallbackUrl = validJavDBURL(message?.fallbackUrl) || url;
  if (!url || !request || !sessionId || !isExtensionBridgeSender(sender)) {
    return { ok: false, error: "invalid JavDB assist request" };
  }

  if (!(await javDBAutoRedirectEnabled())) {
    const createProperties = { url: fallbackUrl, active: true };
    placeTabAfterSender(createProperties, sender);
    await chrome.tabs.create(createProperties);
    return { ok: true };
  }

  // Activate a controlled white page immediately. The assist state is stored
  // before this tab is sent to JavDB, avoiding both a state race and the
  // browser-dependent color of about:blank.
  const createProperties = {
    url: chrome.runtime.getURL("assist-loading.html"),
    active: true,
  };
  placeTabAfterSender(createProperties, sender);
  const assistTab = await chrome.tabs.create(createProperties);
  const assistTabId = assistTab?.id;
  if (!Number.isInteger(assistTabId)) {
    return { ok: false, error: "failed to create JavDB tab" };
  }

  await chrome.storage.session.set({
    [javDBAssistKey(assistTabId)]: request,
  });
  await chrome.tabs.update(assistTabId, { url });
  return { ok: true };
}

async function getJavDBAssist(_message, sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) return { ok: true, request: null };
  const key = javDBAssistKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return {
    ok: true,
    request: validJavDBAssistRequest(stored[key]),
  };
}

async function clearJavDBAssist(_message, sender) {
  const tabId = sender.tab?.id;
  if (Number.isInteger(tabId)) {
    await chrome.storage.session.remove(javDBAssistKey(tabId));
  }
  return { ok: true };
}

async function completeJavDBAssist(_message, sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) {
    return { ok: false, error: "missing JavDB tab" };
  }

  const key = javDBAssistKey(tabId);
  const stored = await chrome.storage.session.get(key);
  if (!validJavDBAssistRequest(stored[key])) {
    return { ok: false, error: "JavDB assistance has expired" };
  }

  await chrome.storage.session.remove(key);
  await chrome.tabs.update(tabId, { active: true });
  return { ok: true };
}

async function isRelayTab(message, sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) return { ok: true, relay: false };
  const key = relayKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const currentSessionId = validSessionID(stored[key]?.sessionId);
  if (currentSessionId) {
    const active = await chrome.storage.session.get(
      relaySessionKey(currentSessionId),
    );
    if (active[relaySessionKey(currentSessionId)]) {
      return { ok: true, relay: true, sessionId: currentSessionId };
    }
    await chrome.storage.session.remove(key);
  }

  const inheritedSessionId = validSessionID(message?.sessionId);
  if (!inheritedSessionId) return { ok: true, relay: false };
  const active = await chrome.storage.session.get(
    relaySessionKey(inheritedSessionId),
  );
  if (!active[relaySessionKey(inheritedSessionId)]) {
    return { ok: true, relay: false };
  }
  await chrome.storage.session.set({
    [key]: { sessionId: inheritedSessionId },
  });
  return { ok: true, relay: true, sessionId: inheritedSessionId };
}

async function invalidateRelaySession(sessionId) {
  const validID = validSessionID(sessionId);
  if (!validID) return;
  const stored = await chrome.storage.session.get(null);
  const keys = [relaySessionKey(validID)];
  const tabIds = [];
  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith(RELAY_KEY_PREFIX) || value?.sessionId !== validID) {
      continue;
    }
    keys.push(key);
    const tabId = Number.parseInt(key.slice(RELAY_KEY_PREFIX.length), 10);
    if (Number.isInteger(tabId)) tabIds.push(tabId);
  }
  await chrome.storage.session.remove(keys);
  await Promise.all(
    tabIds.map((tabId) =>
      chrome.tabs
        .sendMessage(
          tabId,
          { type: "JAVBOSS_SCRAPE_DISABLE_RELAY" },
          { frameId: 0 },
        )
        .catch(() => {}),
    ),
  );
}

async function relayMetadata(message, sender) {
  const relayTabId = sender.tab?.id;
  if (!Number.isInteger(relayTabId))
    return { ok: false, error: "missing sender tab" };

  const key = relayKey(relayTabId);
  const stored = await chrome.storage.session.get(key);
  const relay = stored[key];
  if (!relay)
    return { ok: false, error: "this page was not opened from JavBoss" };
  const active = await chrome.storage.session.get(
    relaySessionKey(relay.sessionId),
  );
  if (!active[relaySessionKey(relay.sessionId)]) {
    await chrome.storage.session.remove(key);
    return { ok: false, error: "the JavBoss scrape session has expired" };
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "JAVBOSS_SCRAPE_BRIDGE_METADATA",
      sessionId: relay.sessionId,
      payload: message?.payload,
    });
    if (!response?.ok)
      throw new Error("matching extension bridge was not found");
  } catch {
    await invalidateRelaySession(relay.sessionId);
    return {
      ok: false,
      error: "the JavBoss extension bridge is no longer open",
    };
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let operation;
  if (message?.type === "JAVBOSS_SCRAPE_OPEN_RELAY") {
    operation = openRelayTab(message, sender);
  } else if (message?.type === "JAVBOSS_SCRAPE_IS_RELAY") {
    operation = isRelayTab(message, sender);
  } else if (message?.type === "JAVBOSS_SCRAPE_SUBMIT_RELAY") {
    operation = relayMetadata(message, sender);
  } else if (message?.type === "JAVBOSS_JAVDB_OPEN_ASSIST") {
    operation = openJavDBAssistTab(message, sender);
  } else if (message?.type === "JAVBOSS_JAVDB_GET_ASSIST") {
    operation = getJavDBAssist(message, sender);
  } else if (message?.type === "JAVBOSS_JAVDB_CLEAR_ASSIST") {
    operation = clearJavDBAssist(message, sender);
  } else if (message?.type === "JAVBOSS_JAVDB_COMPLETE_ASSIST") {
    operation = completeJavDBAssist(message, sender);
  } else if (message?.type === "JAVBOSS_MAGNET_SETTINGS") {
    operation = magnetDownloadSettings().then(({ enabled }) => ({ enabled }));
  } else if (message?.type === "JAVBOSS_DOWNLOAD_MAGNET") {
    operation = submitMagnetDownload(message);
  } else {
    return false;
  }

  operation.then(sendResponse).catch((error) => {
    sendResponse({
      ok: false,
      error: String(error?.message || error || "extension error"),
    });
  });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session
    .remove([relayKey(tabId), javDBAssistKey(tabId)])
    .catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session
    .get(null)
    .then((stored) =>
      chrome.storage.session.remove(
        Object.keys(stored).filter(
          (key) =>
            key.startsWith(RELAY_KEY_PREFIX) ||
            key.startsWith(RELAY_SESSION_KEY_PREFIX) ||
            key.startsWith(JAVDB_ASSIST_KEY_PREFIX) ||
            key.startsWith(LEGACY_RELAY_KEY_PREFIX) ||
            key.startsWith(LEGACY_RELAY_SESSION_KEY_PREFIX),
        ),
      ),
    )
    .catch(() => {});
});

// Content scripts receive only the enabled flag, never server credentials.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName !== "local" ||
    (!changes[MAGNET_DOWNLOAD_SETTINGS_KEY] &&
      !changes[CONNECTION_SETTINGS_KEY])
  )
    return;
  magnetDownloadSettings()
    .then(async ({ enabled }) => {
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(
        tabs.map((tab) =>
          chrome.tabs.sendMessage(tab.id, {
            type: "JAVBOSS_MAGNET_SETTINGS_CHANGED",
            enabled,
          }),
        ),
      );
    })
    .catch(() => {});
});
