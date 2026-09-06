const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "content", "magnet-download.js"),
  "utf8",
);

function createHarness({
  confirmation = true,
  response = { ok: true },
  settings = null,
} = {}) {
  const elements = new Map();
  const listeners = {};
  const sentMessages = [];
  const storageListeners = [];
  const document = {
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    createElement() {
      return {
        id: "",
        style: {},
        textContent: "",
        remove() {
          elements.delete(this.id);
        },
      };
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    documentElement: {
      appendChild(element) {
        elements.set(element.id, element);
      },
    },
  };
  const chrome = {
    runtime: {
      onMessage: { addListener: (listener) => storageListeners.push(listener) },
      async sendMessage(message) {
        if (message.type === "JAVBOSS_MAGNET_SETTINGS")
          return {
            enabled: settings?.enabled === true && Boolean(settings?.serverUrl),
          };
        sentMessages.push(message);
        return response;
      },
    },
    storage: {
      local: {
        async get(key) {
          return settings ? { [key]: settings } : {};
        },
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
      },
    },
  };
  const window = {
    confirm() {
      return confirmation;
    },
    clearTimeout() {},
    setTimeout() {
      return 1;
    },
  };
  vm.runInNewContext(source, { chrome, document, URL, window });
  return { elements, listeners, sentMessages, storageListeners };
}

function clickPathEvent(path) {
  const event = {
    button: 0,
    defaultPrevented: false,
    isTrusted: true,
    composedPath: () => path,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      this.propagationStopped = true;
    },
  };
  return event;
}

function clickEvent(href) {
  return clickPathEvent([{ tagName: "A", href }]);
}

test("clicking a magnet link submits it and prevents external navigation", async () => {
  const harness = createHarness({
    settings: {
      enabled: true,
      serverUrl: "http://127.0.0.1:17654",
    },
  });
  const magnetUrl =
    "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567&dn=Test";
  const event = clickEvent(magnetUrl);

  await new Promise((resolve) => setImmediate(resolve));
  harness.listeners.click(event);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.sentMessages)), [
    { type: "JAVBOSS_DOWNLOAD_MAGNET", magnetUrl },
  ]);
  assert.equal(
    harness.elements.get("javboss-magnet-download-toast").textContent,
    "已提交到 JavBoss 下载队列",
  );
});

test("magnet links keep their normal behavior while the feature is disabled", async () => {
  const harness = createHarness();
  const event = clickEvent(
    "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567",
  );

  await new Promise((resolve) => setImmediate(resolve));
  harness.listeners.click(event);

  assert.equal(event.defaultPrevented, false);
  assert.equal(harness.sentMessages.length, 0);
});

test("cancelling the confirmation does not submit the magnet link", async () => {
  const harness = createHarness({
    confirmation: false,
    settings: {
      enabled: true,
      serverUrl: "http://127.0.0.1:17654",
    },
  });
  const event = clickEvent(
    "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567",
  );

  await new Promise((resolve) => setImmediate(resolve));
  harness.listeners.click(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.equal(harness.sentMessages.length, 0);
  assert.equal(
    harness.elements.get("javboss-magnet-download-toast").textContent,
    "已取消提交",
  );
});

test("ordinary links keep their normal browser behavior", async () => {
  const harness = createHarness({
    settings: {
      enabled: true,
      serverUrl: "http://127.0.0.1:17654",
    },
  });
  const event = clickEvent("https://example.com/video");

  await new Promise((resolve) => setImmediate(resolve));
  harness.listeners.click(event);

  assert.equal(event.defaultPrevented, false);
  assert.equal(harness.sentMessages.length, 0);
});

test("clicking a plain-text magnet span submits it", async () => {
  const harness = createHarness({
    settings: {
      enabled: true,
      serverUrl: "http://127.0.0.1:17654",
    },
  });
  const magnetUrl =
    "magnet:?xt=urn:btih:5c213a0e5541d503b7c89783d7067ef96ae6b0e7";
  const event = clickPathEvent([
    { tagName: "SPAN", textContent: magnetUrl },
    { tagName: "P", textContent: `Magnet Link: ${magnetUrl}` },
  ]);

  await new Promise((resolve) => setImmediate(resolve));
  harness.listeners.click(event);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.sentMessages)), [
    { type: "JAVBOSS_DOWNLOAD_MAGNET", magnetUrl },
  ]);
});

test("clicking the copy button beside a magnet does not create a task", async () => {
  const harness = createHarness({
    settings: {
      enabled: true,
      serverUrl: "http://127.0.0.1:17654",
    },
  });
  const magnetUrl =
    "magnet:?xt=urn:btih:5c213a0e5541d503b7c89783d7067ef96ae6b0e7";
  const event = clickPathEvent([
    { tagName: "PATH", textContent: "" },
    { tagName: "SVG", textContent: "" },
    { tagName: "BUTTON", textContent: "" },
    { tagName: "P", textContent: `Magnet Link: ${magnetUrl}` },
  ]);

  await new Promise((resolve) => setImmediate(resolve));
  harness.listeners.click(event);

  assert.equal(event.defaultPrevented, false);
  assert.equal(harness.sentMessages.length, 0);
});

test("settings messages update interception without exposing credentials to the content script", async () => {
  const harness = createHarness();
  await new Promise((resolve) => setImmediate(resolve));
  harness.storageListeners[0]({
    type: "JAVBOSS_MAGNET_SETTINGS_CHANGED",
    enabled: true,
  });
  const event = clickEvent(
    "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567",
  );
  harness.listeners.click(event);
  assert.equal(event.defaultPrevented, true);
  harness.storageListeners[0]({
    type: "JAVBOSS_MAGNET_SETTINGS_CHANGED",
    enabled: false,
  });
  const next = clickEvent(
    "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567",
  );
  harness.listeners.click(next);
  assert.equal(next.defaultPrevented, false);
});
