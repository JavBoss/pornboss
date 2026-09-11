const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");

const TEST_TOKEN = "jbe_" + "a".repeat(43);

function createHarness({
  magnetSettings = null,
  javDBSettings = null,
  ownershipSettings = null,
  connectionSettings = {},
  storageFailure = false,
  saveFailure = false,
  permissionGranted = true,
  fetchResponse = { status: 200, body: { authenticated: true } },
  fetchError = null,
  fetchImpl = null,
  abortSignal = AbortSignal,
} = {}) {
  const elements = new Map();
  for (const id of [
    "server-url",
    "server-token",
    "enabled",
    "javdb-auto-redirect",
    "ownership-enabled",
    "test-connection",
    "connection-status",
    "status",
  ]) {
    const listeners = {};
    elements.set(id, {
      checked: false,
      classList: { toggle() {} },
      disabled: false,
      value: "",
      textContent: "",
      addEventListener(type, listener) {
        listeners[type] = listener;
      },
      listeners,
    });
  }
  const storedValues = [];
  const permissionRequests = [];
  const fetchCalls = [];
  const timers = new Map();
  let nextTimerId = 0;
  const chrome = {
    permissions: {
      async request(request) {
        permissionRequests.push(request);
        return permissionGranted;
      },
    },
    storage: {
      local: {
        async setAccessLevel(value) {
          assert.equal(value.accessLevel, "TRUSTED_CONTEXTS");
          if (storageFailure) throw new Error("storage denied");
        },
        async get(keys) {
          const stored = {};
          if (connectionSettings)
            stored["javboss:connection-settings"] = connectionSettings;
          if (magnetSettings) {
            stored["javboss:magnet-download-settings"] = magnetSettings;
          }
          if (javDBSettings) {
            stored["javboss:javdb-settings"] = javDBSettings;
          }
          if (ownershipSettings)
            stored["javboss:ownership-settings"] = ownershipSettings;
          const requested = new Set(Array.isArray(keys) ? keys : [keys]);
          return Object.fromEntries(
            Object.entries(stored).filter(([key]) => requested.has(key)),
          );
        },
        async set(value) {
          if (saveFailure) throw new Error("storage write failed");
          storedValues.push(value);
        },
      },
    },
  };
  const document = {
    getElementById(id) {
      return elements.get(id);
    },
  };
  const fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    if (fetchError) throw fetchError;
    if (fetchImpl) return fetchImpl(url, options);
    return {
      status: fetchResponse.status,
      ok: fetchResponse.status >= 200 && fetchResponse.status < 300,
      headers: { get: () => fetchResponse.contentType || "application/json" },
      async json() {
        if (fetchResponse.jsonError)
          throw new SyntaxError("Unexpected token '<'");
        return fetchResponse.body;
      },
    };
  };
  vm.runInNewContext(source, {
    chrome,
    document,
    URL,
    fetch,
    AbortSignal: abortSignal,
    AbortController,
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    TypeError,
  });
  return {
    elements,
    permissionRequests,
    storedValues,
    fetchCalls,
    timers,
  };
}

test("the popup starts with magnet downloads disabled and JavDB redirects enabled", async () => {
  const harness = createHarness();

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.elements.get("server-url").value, "");
  assert.equal(harness.elements.get("enabled").checked, false);
  assert.equal(harness.elements.get("javdb-auto-redirect").checked, true);
  assert.equal(harness.elements.get("ownership-enabled").checked, true);
});

test("ownership toggle restores preferences and saves independently of connection settings", async () => {
  const harness = createHarness({ ownershipSettings: { enabled: false } });
  await new Promise((resolve) => setImmediate(resolve));
  const toggle = harness.elements.get("ownership-enabled");
  assert.equal(toggle.checked, false);
  assert.equal(toggle.disabled, false);
  harness.elements.get("server-url").value = "incomplete";
  for (const enabled of [true, false]) {
    toggle.checked = enabled;
    await toggle.listeners.change();
    assert.equal(toggle.disabled, false);
    assert.deepEqual(JSON.parse(JSON.stringify(harness.storedValues.at(-1))), {
      "javboss:ownership-settings": { enabled },
    });
  }
  assert.equal(harness.permissionRequests.length, 0);
  assert.equal(harness.fetchCalls.length, 0);
});

test("ownership toggle rolls back when saving fails", async () => {
  const harness = createHarness({ saveFailure: true });
  await new Promise((resolve) => setImmediate(resolve));
  const toggle = harness.elements.get("ownership-enabled");
  toggle.checked = false;
  await toggle.listeners.change();
  assert.equal(toggle.checked, true);
  assert.equal(toggle.disabled, false);
  assert.match(
    harness.elements.get("status").textContent,
    /storage write failed/,
  );
});

test("the popup restores a disabled JavDB auto redirect setting", async () => {
  const harness = createHarness({
    javDBSettings: { autoRedirect: false },
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.elements.get("javdb-auto-redirect").checked, false);
});

test("connection inputs save immediately and enabling requests host access", async () => {
  const harness = createHarness();
  await new Promise((resolve) => setImmediate(resolve));
  harness.elements.get("server-url").value =
    " http://192.168.1.20:17654/javboss/ ";
  await harness.elements.get("server-url").listeners.input();
  harness.elements.get("server-token").value = TEST_TOKEN;
  await harness.elements.get("server-token").listeners.input();
  assert.equal(harness.permissionRequests.length, 0);
  harness.elements.get("enabled").checked = true;
  await harness.elements.get("enabled").listeners.change();
  assert.deepEqual(JSON.parse(JSON.stringify(harness.permissionRequests)), [
    { origins: ["http://192.168.1.20/*"] },
  ]);
  const saved = harness.storedValues.at(-1);
  assert.equal(
    saved["javboss:connection-settings"].serverUrl,
    "http://192.168.1.20:17654/javboss",
  );
  assert.equal(saved["javboss:connection-settings"].apiToken, TEST_TOKEN);
  assert.deepEqual(
    JSON.parse(JSON.stringify(saved["javboss:magnet-download-settings"])),
    { enabled: true },
  );
  assert.equal(harness.storedValues.length, 3);
});

test("JavDB toggle saves independently of incomplete connection settings", async () => {
  const harness = createHarness();
  await new Promise((resolve) => setImmediate(resolve));
  harness.elements.get("server-url").value = "invalid";
  harness.elements.get("server-token").value = "incomplete";
  harness.elements.get("javdb-auto-redirect").checked = false;
  await harness.elements.get("javdb-auto-redirect").listeners.change();
  assert.equal(harness.permissionRequests.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.storedValues)), [
    { "javboss:javdb-settings": { autoRedirect: false } },
  ]);
});

test("changing the address preserves the single current API token", async () => {
  const harness = createHarness({
    magnetSettings: { enabled: true },
    connectionSettings: {
      serverUrl: "https://first.example",
      apiToken: TEST_TOKEN,
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  for (const serverUrl of [
    "https://second.example",
    "",
    "https://third.example",
  ]) {
    harness.elements.get("server-url").value = serverUrl;
    await harness.elements.get("server-url").listeners.input();
    assert.equal(harness.elements.get("server-token").value, TEST_TOKEN);
    const saved = harness.storedValues.at(-1);
    assert.deepEqual(
      JSON.parse(JSON.stringify(saved["javboss:connection-settings"])),
      { serverUrl, apiToken: TEST_TOKEN },
    );
    assert.equal(saved["javboss:server-tokens"], undefined);
    assert.equal(
      saved["javboss:magnet-download-settings"].serverUrl,
      undefined,
    );
  }
});

test("storage isolation failure prevents saving credentials", async () => {
  const harness = createHarness({ storageFailure: true });
  await new Promise((resolve) => setImmediate(resolve));
  harness.elements.get("server-url").value = "https://boss.example";
  harness.elements.get("server-token").value = TEST_TOKEN;
  harness.elements.get("enabled").checked = true;
  await harness.elements.get("enabled").listeners.change();
  assert.equal(harness.storedValues.length, 0);
  assert.equal(harness.permissionRequests.length, 0);
});

test("connection test checks current inputs without enabling downloads or writing settings", async () => {
  const harness = createHarness({
    magnetSettings: { serverUrl: "https://old.example", enabled: false },
  });
  await new Promise((resolve) => setImmediate(resolve));
  harness.elements.get("server-url").value =
    " http://nas.local:17654/javboss/ ";
  harness.elements.get("server-token").value = TEST_TOKEN;
  await harness.elements.get("test-connection").listeners.click();
  assert.equal(harness.fetchCalls.length, 1);
  const { url, options } = harness.fetchCalls[0];
  assert.equal(url, "http://nas.local:17654/javboss/extension/status");
  assert.equal(options.headers.Authorization, `Bearer ${TEST_TOKEN}`);
  assert.equal(options.headers.Accept, "application/json");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.equal(options.cache, "no-store");
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.permissionRequests)), [
    { origins: ["http://nas.local/*"] },
  ]);
  assert.equal(harness.storedValues.length, 0);
  assert.equal(harness.elements.get("enabled").checked, false);
  assert.equal(
    harness.elements.get("connection-status").textContent,
    "连接成功，API 令牌有效",
  );
  assert.equal(harness.elements.get("test-connection").disabled, false);
  assert.equal(harness.timers.size, 0);
});

test("connection test works without AbortSignal.timeout on Chrome 102", async () => {
  const harness = createHarness({ abortSignal: {} });
  await new Promise((resolve) => setImmediate(resolve));
  harness.elements.get("server-url").value = "https://boss.example";
  harness.elements.get("server-token").value = TEST_TOKEN;
  await harness.elements.get("test-connection").listeners.click();
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(
    harness.elements.get("connection-status").textContent,
    "连接成功，API 令牌有效",
  );
  assert.equal(harness.fetchCalls[0].options.signal.aborted, false);
  assert.equal(harness.timers.size, 0);
});

test("connection timeout aborts stalled requests and response bodies and restores controls", async () => {
  for (const stage of ["request", "body"]) {
    const harness = createHarness({
      abortSignal: {},
      fetchImpl: (url, { signal }) => {
        const waitForAbort = () =>
          new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
        if (stage === "request") return waitForAbort();
        return {
          status: 200,
          ok: true,
          headers: { get: () => "application/json" },
          json: waitForAbort,
        };
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    harness.elements.get("server-url").value = "https://boss.example";
    harness.elements.get("server-token").value = TEST_TOKEN;
    const pending = harness.elements.get("test-connection").listeners.click();
    await new Promise((resolve) => setImmediate(resolve));
    for (const id of ["test-connection", "server-url", "server-token"]) {
      assert.equal(harness.elements.get(id).disabled, true);
    }
    assert.equal(harness.timers.size, 1);
    const timer = [...harness.timers.values()][0];
    assert.equal(timer.delay, 10000);
    timer.callback();
    await pending;
    assert.equal(harness.fetchCalls[0].options.signal.aborted, true);
    assert.equal(
      harness.elements.get("connection-status").textContent,
      "连接超时，请检查 Server 地址和网络",
    );
    for (const id of ["test-connection", "server-url", "server-token"]) {
      assert.equal(harness.elements.get(id).disabled, false);
    }
    assert.equal(
      harness.elements.get("test-connection").textContent,
      "测试连接",
    );
    assert.equal(harness.timers.size, 0);
  }
});

test("connection test rejects invalid input and permission or storage failures before fetching", async () => {
  for (const scenario of [
    { url: "", token: TEST_TOKEN },
    { url: "ftp://remote.example", token: TEST_TOKEN },
    { url: "https://boss.example", token: "invalid" },
    {
      url: "https://boss.example",
      token: TEST_TOKEN,
      permissionGranted: false,
    },
    { url: "https://boss.example", token: TEST_TOKEN, storageFailure: true },
  ]) {
    const harness = createHarness(scenario);
    await new Promise((resolve) => setImmediate(resolve));
    harness.elements.get("server-url").value = scenario.url;
    harness.elements.get("server-token").value = scenario.token;
    await harness.elements.get("test-connection").listeners.click();
    assert.equal(harness.fetchCalls.length, 0);
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.storedValues.length, 0);
    assert.notEqual(harness.elements.get("connection-status").textContent, "");
    assert.equal(harness.elements.get("test-connection").disabled, false);
  }
});

test("connection test reports auth, HTTP, response, timeout and network failures", async () => {
  for (const scenario of [
    { fetchResponse: { status: 401 }, expected: "API 令牌无效" },
    { fetchResponse: { status: 403 }, expected: "服务器拒绝访问" },
    { fetchResponse: { status: 404 }, expected: "未找到连接测试接口" },
    { fetchResponse: { status: 500 }, expected: "HTTP 500" },
    { fetchResponse: { status: 200, body: {} }, expected: "服务器响应无效" },
    {
      fetchResponse: {
        status: 200,
        contentType: "text/html; charset=utf-8",
        jsonError: true,
      },
      expected: "服务器返回了网页",
    },
    {
      fetchResponse: { status: 200, jsonError: true },
      expected: "服务器响应不是有效的 JSON",
    },
    { fetchError: { name: "TimeoutError" }, expected: "连接超时" },
    {
      fetchError: new TypeError("Failed to fetch"),
      expected: "无法连接服务器",
    },
  ]) {
    const harness = createHarness(scenario);
    await new Promise((resolve) => setImmediate(resolve));
    harness.elements.get("server-url").value = "https://boss.example";
    harness.elements.get("server-token").value = TEST_TOKEN;
    await harness.elements.get("test-connection").listeners.click();
    assert.ok(
      harness.elements
        .get("connection-status")
        .textContent.includes(scenario.expected),
    );
    for (const id of ["test-connection", "server-url", "server-token"]) {
      assert.equal(harness.elements.get(id).disabled, false);
    }
    assert.equal(harness.storedValues.length, 0);
    assert.equal(harness.timers.size, 0);
  }
});

test("connection test prevents duplicate requests and clears stale results on edit", async () => {
  let finish;
  const harness = createHarness({
    fetchImpl: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  harness.elements.get("server-url").value = "https://boss.example";
  harness.elements.get("server-token").value = TEST_TOKEN;
  const pending = harness.elements.get("test-connection").listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.elements.get("test-connection").disabled, true);
  await harness.elements.get("test-connection").listeners.click();
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.storedValues.length, 0);
  finish({
    status: 200,
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({ authenticated: true }),
  });
  await pending;
  harness.elements.get("server-token").listeners.input();
  assert.equal(harness.elements.get("connection-status").textContent, "");
});

test("disabling downloads saves even when the connection is incomplete", async () => {
  const harness = createHarness({
    magnetSettings: { enabled: true, serverUrl: "https://boss.example" },
    connectionSettings: {
      serverUrl: "https://boss.example",
      apiToken: TEST_TOKEN,
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  harness.elements.get("server-url").value = "incomplete";
  harness.elements.get("server-token").value = "";
  harness.elements.get("enabled").checked = false;
  await harness.elements.get("enabled").listeners.change();
  assert.equal(
    harness.storedValues.at(-1)["javboss:magnet-download-settings"].enabled,
    false,
  );
  assert.equal(harness.permissionRequests.length, 0);
});

test("permission denial turns the downloads toggle back off", async () => {
  const harness = createHarness({ permissionGranted: false });
  await new Promise((resolve) => setImmediate(resolve));
  harness.elements.get("server-url").value = "https://boss.example";
  harness.elements.get("server-token").value = TEST_TOKEN;
  harness.elements.get("enabled").checked = true;
  await harness.elements.get("enabled").listeners.change();
  assert.equal(harness.elements.get("enabled").checked, false);
  assert.equal(
    harness.storedValues.at(-1)["javboss:magnet-download-settings"].enabled,
    false,
  );
  assert.ok(
    harness.elements.get("status").textContent.includes("需要允许访问"),
  );
});

test("rapid token edits save in order and never reuse an older valid token", async () => {
  const harness = createHarness({
    magnetSettings: { enabled: true, serverUrl: "https://boss.example" },
    connectionSettings: {
      serverUrl: "https://boss.example",
      apiToken: TEST_TOKEN,
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  harness.elements.get("server-token").value = "jbe_partial";
  const first = harness.elements.get("server-token").listeners.input();
  const nextToken = "jbe_" + "b".repeat(43);
  harness.elements.get("server-token").value = nextToken;
  const second = harness.elements.get("server-token").listeners.input();
  await Promise.all([first, second]);
  assert.equal(
    harness.storedValues[0]["javboss:magnet-download-settings"].enabled,
    false,
  );
  assert.equal(
    harness.storedValues[0]["javboss:connection-settings"].apiToken,
    "jbe_partial",
  );
  assert.equal(
    harness.storedValues[1]["javboss:magnet-download-settings"].enabled,
    true,
  );
  assert.equal(
    harness.storedValues[1]["javboss:connection-settings"].apiToken,
    nextToken,
  );
  harness.elements.get("server-token").value = "";
  await harness.elements.get("server-token").listeners.input();
  assert.equal(
    harness.storedValues.at(-1)["javboss:connection-settings"].apiToken,
    "",
  );
  assert.equal(
    harness.storedValues.at(-1)["javboss:magnet-download-settings"].enabled,
    false,
  );
});
