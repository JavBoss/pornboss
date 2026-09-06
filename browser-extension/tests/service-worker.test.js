const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "service-worker.js"),
  "utf8",
);

const RELAY_PREFIX = "javboss:browser-relay:";
const SESSION_PREFIX = "javboss:browser-session:";
const JAVDB_ASSIST_PREFIX = "javboss:javdb-assist:";
const TEST_TOKEN = "jbe_" + "a".repeat(43);
const SESSION_ID = "test-session-1234";

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createHarness(options = {}) {
  const data = new Map([
    [`${RELAY_PREFIX}1`, { sessionId: SESSION_ID }],
    [`${SESSION_PREFIX}${SESSION_ID}`, { sessionId: SESSION_ID }],
  ]);
  const localData = new Map();
  localData.set("javboss:server-tokens", options.serverTokens || {});
  if (options.magnetSettings) {
    localData.set("javboss:magnet-download-settings", options.magnetSettings);
  }
  if (options.javDBSettings) {
    localData.set("javboss:javdb-settings", options.javDBSettings);
  }
  const listeners = {};
  const sentMessages = [];
  const createdTabs = [];
  const updatedTabs = [];
  const fetchCalls = [];

  const sessionStorage = {
    async get(keys) {
      if (keys === null) return Object.fromEntries(data);
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested
          .filter((key) => data.has(key))
          .map((key) => [key, data.get(key)]),
      );
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) data.set(key, value);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    },
  };

  const accessLevels = [];
  const localStorage = {
    async setAccessLevel(value) {
      accessLevels.push(value);
      if (options.storageFailure) throw new Error("storage denied");
    },
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested
          .filter((key) => localData.has(key))
          .map((key) => [key, localData.get(key)]),
      );
    },
  };

  const chrome = {
    runtime: {
      onMessage: { addListener: (listener) => (listeners.message = listener) },
      onInstalled: {
        addListener: (listener) => (listeners.installed = listener),
      },
      getURL: (resourcePath) =>
        `chrome-extension://iikdjhkpjihfkehccfmkpkdmenmbaacn/${resourcePath}`,
      sendMessage: async () => ({ ok: true }),
    },
    storage: {
      local: localStorage,
      session: sessionStorage,
      onChanged: {
        addListener: (listener) => {
          listeners.storage = listener;
        },
      },
    },
    tabs: {
      query: async () => [{ id: 2 }],
      create: async (properties) => {
        createdTabs.push(properties);
        return { id: 10 };
      },
      update: async (tabId, properties) => {
        updatedTabs.push({ tabId, properties });
      },
      remove: async () => {},
      sendMessage: async (tabId, message) => {
        sentMessages.push({ tabId, message });
        return { ok: true };
      },
      onRemoved: { addListener: (listener) => (listeners.removed = listener) },
    },
  };

  const fetch = async (url, init) => {
    fetchCalls.push({ url, options: init });
    return {
      ok: !options.responseStatus || options.responseStatus < 400,
      status: options.responseStatus || 201,
      json: async () => ({}),
    };
  };

  vm.runInNewContext(source, { chrome, fetch, URL });

  async function send(message, tab) {
    return new Promise((resolve) => {
      const keepChannelOpen = listeners.message(
        message,
        { tab, url: tab.url },
        resolve,
      );
      assert.equal(keepChannelOpen, true);
    });
  }

  return {
    accessLevels,
    localData,
    createdTabs,
    data,
    fetchCalls,
    listeners,
    send,
    sentMessages,
    updatedTabs,
  };
}

test("a clicked magnet link is submitted to the configured JavBoss server", async () => {
  const harness = createHarness({
    serverTokens: { "https://192.168.1.20:17654/javboss": TEST_TOKEN },
    magnetSettings: {
      enabled: true,
      serverUrl: "https://192.168.1.20:17654/javboss",
    },
  });
  const magnetUrl =
    "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567&dn=Test";
  const response = await harness.send(
    { type: "JAVBOSS_DOWNLOAD_MAGNET", magnetUrl },
    { id: 2, url: "https://www.javbus.com/ABC-123" },
  );

  assert.deepEqual(plain(response), { ok: true });
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(
    harness.fetchCalls[0].url,
    "https://192.168.1.20:17654/javboss/extension/downloads",
  );
  assert.equal(harness.fetchCalls[0].options.method, "POST");
  assert.equal(
    harness.fetchCalls[0].options.headers.Authorization,
    `Bearer ${TEST_TOKEN}`,
  );
  assert.equal(harness.fetchCalls[0].options.credentials, "omit");
  assert.equal(harness.fetchCalls[0].options.redirect, "error");
  assert.deepEqual(plain(harness.accessLevels), [
    { accessLevel: "TRUSTED_CONTEXTS" },
  ]);
  assert.deepEqual(JSON.parse(harness.fetchCalls[0].options.body), {
    magnet_url: magnetUrl,
  });
});

test("magnet submission is rejected until it is manually enabled", async () => {
  const harness = createHarness({
    magnetSettings: {
      enabled: false,
      serverUrl: "http://127.0.0.1:17654",
    },
  });
  const response = await harness.send(
    {
      type: "JAVBOSS_DOWNLOAD_MAGNET",
      magnetUrl: "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567",
    },
    { id: 2, url: "https://www.javbus.com/ABC-123" },
  );

  assert.deepEqual(plain(response), {
    ok: false,
    error: "请先在扩展中填写 JavBoss Server 地址并启用磁力下载",
  });
  assert.equal(harness.fetchCalls.length, 0);
});

test("a non-magnet URL is rejected without contacting JavBoss", async () => {
  const harness = createHarness();
  const response = await harness.send(
    { type: "JAVBOSS_DOWNLOAD_MAGNET", magnetUrl: "https://example.com/file" },
    { id: 2, url: "https://www.javbus.com/ABC-123" },
  );

  assert.deepEqual(plain(response), {
    ok: false,
    error: "invalid magnet link",
  });
  assert.equal(harness.fetchCalls.length, 0);
});

test("a manually created tab cannot inherit from its opener", async () => {
  const harness = createHarness();
  const response = await harness.send(
    { type: "JAVBOSS_SCRAPE_IS_RELAY", sessionId: "" },
    { id: 2, openerTabId: 1, url: "https://www.javbus.com/ABC-123" },
  );

  assert.deepEqual(plain(response), { ok: true, relay: false });
  assert.equal(harness.data.has(`${RELAY_PREFIX}2`), false);
});

test("all scrape providers open immediately after the sender tab", async () => {
  const urls = [
    "https://www.javbus.com/search/OFJE-282",
    "https://www.javlibrary.com/tw/vl_searchbyid.php?keyword=OFJE-282",
    "https://javdb.com/search?q=OFJE-282&f=all",
    "https://avsox.click/tw/search/030919_047",
  ];

  for (const url of urls) {
    const harness = createHarness();
    const response = await harness.send(
      {
        type: "JAVBOSS_SCRAPE_OPEN_RELAY",
        sessionId: SESSION_ID,
        url,
      },
      {
        id: 1,
        index: 3,
        windowId: 5,
        url: "chrome-extension://iikdjhkpjihfkehccfmkpkdmenmbaacn/bridge.html",
      },
    );

    assert.deepEqual(plain(response), { ok: true });
    assert.deepEqual(plain(harness.createdTabs), [
      {
        url: "about:blank",
        active: true,
        index: 4,
        windowId: 5,
      },
    ]);
    assert.deepEqual(plain(harness.updatedTabs), [
      { tabId: 10, properties: { url } },
    ]);
  }
});

test("the bridge can open an allowed JavLibrary URL", async () => {
  const harness = createHarness();
  const response = await harness.send(
    {
      type: "JAVBOSS_SCRAPE_OPEN_RELAY",
      sessionId: SESSION_ID,
      url: "https://www.javlibrary.com/tw/vl_searchbyid.php?keyword=OFJE-282",
    },
    {
      id: 1,
      windowId: 5,
      url: "chrome-extension://iikdjhkpjihfkehccfmkpkdmenmbaacn/bridge.html",
    },
  );

  assert.deepEqual(plain(response), { ok: true });
  assert.deepEqual(plain(harness.data.get(`${RELAY_PREFIX}10`)), {
    sessionId: SESSION_ID,
  });
});

test("the bridge can open an allowed JavDB search URL", async () => {
  const harness = createHarness();
  const response = await harness.send(
    {
      type: "JAVBOSS_SCRAPE_OPEN_RELAY",
      sessionId: SESSION_ID,
      url: "https://javdb.com/search?q=OFJE-282&f=all",
    },
    {
      id: 1,
      windowId: 5,
      url: "chrome-extension://iikdjhkpjihfkehccfmkpkdmenmbaacn/bridge.html",
    },
  );

  assert.deepEqual(plain(response), { ok: true });
  assert.deepEqual(plain(harness.data.get(`${RELAY_PREFIX}10`)), {
    sessionId: SESSION_ID,
  });
});

test("the bridge opens JavDB assistance with clean URLs and temporary state", async () => {
  const harness = createHarness();
  const request = {
    target: "idol",
    code: "ADN-429",
    name: "岬ななみ",
  };
  const response = await harness.send(
    {
      type: "JAVBOSS_JAVDB_OPEN_ASSIST",
      sessionId: SESSION_ID,
      url: "https://javdb.com/search?q=ADN-429&f=all#legacy-marker",
      request,
    },
    {
      id: 1,
      index: 3,
      windowId: 5,
      url: "chrome-extension://iikdjhkpjihfkehccfmkpkdmenmbaacn/bridge.html",
    },
  );

  assert.deepEqual(plain(response), { ok: true });
  assert.deepEqual(
    plain(harness.data.get(`${JAVDB_ASSIST_PREFIX}10`)),
    request,
  );
  assert.deepEqual(plain(harness.createdTabs), [
    {
      url: "chrome-extension://iikdjhkpjihfkehccfmkpkdmenmbaacn/assist-loading.html",
      active: true,
      index: 4,
      windowId: 5,
    },
  ]);
  assert.deepEqual(plain(harness.updatedTabs), [
    {
      tabId: 10,
      properties: { url: "https://javdb.com/search?q=ADN-429&f=all" },
    },
  ]);

  const stored = await harness.send(
    { type: "JAVBOSS_JAVDB_GET_ASSIST" },
    { id: 10, url: "https://javdb.com/search?q=ADN-429&f=all" },
  );
  assert.deepEqual(plain(stored), { ok: true, request });

  assert.deepEqual(
    plain(
      await harness.send(
        { type: "JAVBOSS_JAVDB_COMPLETE_ASSIST" },
        { id: 10, url: "https://javdb.com/actors/QNen" },
      ),
    ),
    { ok: true },
  );
  assert.equal(harness.data.has(`${JAVDB_ASSIST_PREFIX}10`), false);
  assert.deepEqual(plain(harness.updatedTabs.at(-1)), {
    tabId: 10,
    properties: { active: true },
  });
});

test("disabled JavDB auto redirect uses every original fallback search", async () => {
  const cases = [
    {
      request: { target: "movie", code: "ADN-429" },
      fallbackUrl: "https://javdb.com/search?q=ADN-429&f=all",
    },
    {
      request: { target: "idol", code: "ADN-429", name: "岬ななみ" },
      fallbackUrl:
        "https://javdb.com/search?f=actor&q=%E5%B2%AC%E3%81%AA%E3%81%AA%E3%81%BF",
    },
    {
      request: { target: "studio", code: "ADN-429", name: "S1 NO.1 STYLE" },
      fallbackUrl: "https://javdb.com/search?f=maker&q=S1%20NO.1%20STYLE",
    },
    {
      request: { target: "series", code: "ADN-429", name: "絶対的美少女" },
      fallbackUrl:
        "https://javdb.com/search?f=series&q=%E7%B5%B6%E5%AF%BE%E7%9A%84%E7%BE%8E%E5%B0%91%E5%A5%B3",
    },
  ];

  for (const current of cases) {
    const harness = createHarness({
      javDBSettings: { autoRedirect: false },
    });
    const response = await harness.send(
      {
        type: "JAVBOSS_JAVDB_OPEN_ASSIST",
        sessionId: SESSION_ID,
        url: "https://javdb.com/search?q=ADN-429&f=all#assist-marker",
        fallbackUrl: `${current.fallbackUrl}#fallback-marker`,
        request: current.request,
      },
      {
        id: 1,
        index: 3,
        windowId: 5,
        url: "chrome-extension://iikdjhkpjihfkehccfmkpkdmenmbaacn/bridge.html",
      },
    );

    assert.deepEqual(plain(response), { ok: true });
    assert.deepEqual(plain(harness.createdTabs), [
      {
        url: current.fallbackUrl,
        active: true,
        index: 4,
        windowId: 5,
      },
    ]);
    assert.equal(harness.data.has(`${JAVDB_ASSIST_PREFIX}10`), false);
    assert.deepEqual(plain(harness.updatedTabs), []);
  }
});

test("an ordinary JavDB tab cannot activate itself through assistance", async () => {
  const harness = createHarness();
  const response = await harness.send(
    { type: "JAVBOSS_JAVDB_COMPLETE_ASSIST" },
    { id: 25, url: "https://javdb.com/v/kKdRm" },
  );

  assert.deepEqual(plain(response), {
    ok: false,
    error: "JavDB assistance has expired",
  });
  assert.deepEqual(plain(harness.updatedTabs), []);
});

test("the bridge can open an allowed AVSOX search URL", async () => {
  const harness = createHarness();
  const response = await harness.send(
    {
      type: "JAVBOSS_SCRAPE_OPEN_RELAY",
      sessionId: SESSION_ID,
      url: "https://avsox.click/tw/search/030919_047",
    },
    {
      id: 1,
      windowId: 5,
      url: "chrome-extension://iikdjhkpjihfkehccfmkpkdmenmbaacn/bridge.html",
    },
  );

  assert.deepEqual(plain(response), { ok: true });
  assert.deepEqual(plain(harness.data.get(`${RELAY_PREFIX}10`)), {
    sessionId: SESSION_ID,
  });
});

test("a tab with the temporary marker can claim the scrape session", async () => {
  const harness = createHarness();
  const response = await harness.send(
    { type: "JAVBOSS_SCRAPE_IS_RELAY", sessionId: SESSION_ID },
    { id: 2, url: "https://www.javbus.com/search/ABC-123" },
  );

  assert.deepEqual(plain(response), {
    ok: true,
    relay: true,
    sessionId: SESSION_ID,
  });
  assert.deepEqual(plain(harness.data.get(`${RELAY_PREFIX}2`)), {
    sessionId: SESSION_ID,
  });
});

test("missing or mismatched server tokens never send a download request", async () => {
  for (const serverTokens of [{}, { "https://other.example": TEST_TOKEN }]) {
    const harness = createHarness({
      magnetSettings: { enabled: true, serverUrl: "https://boss.example" },
      serverTokens,
    });
    const response = await harness.send(
      {
        type: "JAVBOSS_DOWNLOAD_MAGNET",
        magnetUrl:
          "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567",
      },
      { id: 2, url: "https://example.com" },
    );
    assert.equal(response.ok, false);
    assert.equal(harness.fetchCalls.length, 0);
    assert.match(response.error, /Token/);
  }
});

test("content settings and updates never expose the server token", async () => {
  const harness = createHarness({
    magnetSettings: { enabled: true, serverUrl: "https://boss.example" },
    serverTokens: { "https://boss.example": TEST_TOKEN },
  });
  const response = await harness.send(
    { type: "JAVBOSS_MAGNET_SETTINGS" },
    { id: 2, url: "https://example.com" },
  );
  assert.deepEqual(plain(response), { enabled: true });
  harness.listeners.storage(
    { "javboss:magnet-download-settings": {} },
    "local",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(plain(harness.sentMessages), [
    {
      tabId: 2,
      message: { type: "JAVBOSS_MAGNET_SETTINGS_CHANGED", enabled: true },
    },
  ]);
});

test("an expired token produces a reauthorization message", async () => {
  const harness = createHarness({
    magnetSettings: { enabled: true, serverUrl: "https://boss.example" },
    serverTokens: { "https://boss.example": TEST_TOKEN },
    responseStatus: 401,
  });
  const response = await harness.send(
    {
      type: "JAVBOSS_DOWNLOAD_MAGNET",
      magnetUrl: "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567",
    },
    { id: 2, url: "https://example.com" },
  );
  assert.equal(response.ok, false);
  assert.match(response.error, /重新生成/);
  assert.equal(response.error.includes(TEST_TOKEN), false);
});

test("remote HTTP and failure to isolate storage fail closed", async () => {
  for (const options of [
    { serverUrl: "http://boss.example" },
    { serverUrl: "https://boss.example", storageFailure: true },
  ]) {
    const harness = createHarness({
      ...options,
      magnetSettings: { enabled: true, serverUrl: options.serverUrl },
      serverTokens: { [options.serverUrl]: TEST_TOKEN },
    });
    const response = await harness.send(
      {
        type: "JAVBOSS_DOWNLOAD_MAGNET",
        magnetUrl:
          "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567",
      },
      { id: 2, url: "https://example.com" },
    );
    assert.equal(response.ok, false);
    assert.equal(harness.fetchCalls.length, 0);
  }
});

test("loopback servers can use HTTP and messages cannot override the destination", async () => {
  for (const serverUrl of [
    "http://127.0.0.1:17654",
    "http://localhost:17654",
    "http://[::1]:17654",
  ]) {
    const harness = createHarness({
      magnetSettings: { enabled: true, serverUrl },
      serverTokens: { [serverUrl]: TEST_TOKEN },
    });
    const response = await harness.send(
      {
        type: "JAVBOSS_DOWNLOAD_MAGNET",
        magnetUrl:
          "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567",
        serverUrl: "https://untrusted.example",
        token: "untrusted",
      },
      { id: 2, url: "https://example.com" },
    );
    assert.equal(response.ok, true);
    assert.equal(harness.fetchCalls[0].url, `${serverUrl}/extension/downloads`);
    assert.equal(
      harness.fetchCalls[0].options.headers.Authorization,
      `Bearer ${TEST_TOKEN}`,
    );
  }
});
