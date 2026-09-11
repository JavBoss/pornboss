const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"),
);
const serviceWorker = fs.readFileSync(
  path.join(__dirname, "..", "service-worker.js"),
  "utf8",
);
const contentScript = fs.readFileSync(
  path.join(__dirname, "..", "content", "scrape-content.js"),
  "utf8",
);
const assistLoadingHTML = fs.readFileSync(
  path.join(__dirname, "..", "assist-loading.html"),
  "utf8",
);
const assistLoadingCSS = fs.readFileSync(
  path.join(__dirname, "..", "assist-loading.css"),
  "utf8",
);

function extensionIdFromKey(key) {
  const digest = crypto
    .createHash("sha256")
    .update(Buffer.from(key, "base64"))
    .digest();
  return [...digest.subarray(0, 16)]
    .map(
      (byte) =>
        `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 15))}`,
    )
    .join("");
}

test("manifest public key produces the extension ID used by JavBoss", () => {
  assert.equal(manifest.name, "JavBoss 助手");
  assert.equal(
    manifest.description,
    "JavBoss 浏览器助手，增强 JavBoss 和其他网站的联动。",
  );
  assert.equal(
    extensionIdFromKey(manifest.key),
    "iikdjhkpjihfkehccfmkpkdmenmbaacn",
  );
});

test("manifest uses the JavBoss icon at the Chrome extension sizes", () => {
  const expectedIcons = {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  };

  assert.deepEqual(manifest.icons, expectedIcons);
  for (const [size, iconPath] of Object.entries(expectedIcons)) {
    const icon = fs.readFileSync(path.join(__dirname, "..", iconPath));
    assert.equal(icon.toString("ascii", 1, 4), "PNG");
    assert.equal(icon.readUInt32BE(16), Number(size));
    assert.equal(icon.readUInt32BE(20), Number(size));
  }
});

test("bridge resources are web accessible without broad host permissions", () => {
  assert.deepEqual(manifest.host_permissions, [
    "https://www.javbus.com/*",
    "https://www.javlibrary.com/*",
    "https://javdb.com/*",
    "https://avsox.click/*",
  ]);
  assert.deepEqual(manifest.optional_host_permissions, [
    "http://*/*",
    "https://*/*",
  ]);
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.deepEqual(manifest.web_accessible_resources[0].resources, [
    "bridge.html",
    "bridge.js",
  ]);
  assert.deepEqual(
    manifest.content_scripts.slice(0, 4).map((entry) => entry.js.at(-1)),
    [
      "content/scrape-content.js",
      "content/scrape-content.js",
      "content/scrape-content.js",
      "content/scrape-content.js",
    ],
  );
  const javDBScript = manifest.content_scripts.find((entry) =>
    entry.matches.includes("https://javdb.com/*"),
  );
  assert.deepEqual(javDBScript.js, [
    "content/javdb-parser.js",
    "content/scrape-content.js",
  ]);
  assert.equal(javDBScript.run_at, "document_start");
  const avsoxScript = manifest.content_scripts.find((entry) =>
    entry.matches.includes("https://avsox.click/*"),
  );
  assert.deepEqual(avsoxScript.js, [
    "content/avsox-parser.js",
    "content/scrape-content.js",
  ]);
  const magnetScript = manifest.content_scripts.find((entry) =>
    entry.js.includes("content/magnet-download.js"),
  );
  assert.deepEqual(magnetScript.matches, ["http://*/*", "https://*/*"]);
  assert.equal(magnetScript.run_at, "document_start");
  assert.equal(magnetScript.all_frames, true);
  const ownership = manifest.content_scripts.find((entry) =>
    entry.js.includes("content/jav-ownership.js"),
  );
  assert.deepEqual(ownership.matches, [
    "https://javdb.com/*",
    "https://www.javbus.com/*",
    "https://www.javlibrary.com/*",
  ]);
  assert.equal(ownership.run_at, "document_idle");
  assert.notEqual(ownership.all_frames, true);
  assert.deepEqual(ownership.css, ["content/jav-ownership.css"]);
});

test("JavBus opens in a new tab instead of a popup window", () => {
  assert.match(serviceWorker, /chrome\.tabs\.create\(/);
  assert.doesNotMatch(serviceWorker, /chrome\.windows\.create\(/);
});

test("assisted JavDB navigation starts on a forced-light loading page", () => {
  assert.match(serviceWorker, /getURL\("assist-loading\.html"\)/);
  assert.match(assistLoadingHTML, /name="color-scheme" content="only light"/);
  assert.match(assistLoadingHTML, /bgcolor="#ffffff"/);
  assert.match(assistLoadingCSS, /background: #fff/);
  assert.match(contentScript, /position: fixed !important/);
  assert.match(contentScript, /z-index: 2147483647 !important/);
  assert.match(contentScript, /color-scheme: only light !important/);
});

test("relay propagation uses a temporary marker instead of tab opener inheritance", () => {
  assert.doesNotMatch(serviceWorker, /chrome\.tabs\.onCreated/);
  assert.match(serviceWorker, /RELAY_SESSION_KEY_PREFIX/);
  assert.match(contentScript, /window\.sessionStorage/);
  assert.match(contentScript, /JAVBOSS_SCRAPE_DISABLE_RELAY/);
  assert.doesNotMatch(contentScript, /移除/);
  assert.doesNotMatch(contentScript, /JAVBOSS_SCRAPE_FINISH_RELAY/);
  assert.doesNotMatch(serviceWorker, /chrome\.tabs\.remove\(/);
});
