(() => {
  const MAGNET_DOWNLOAD_SETTINGS_KEY = "javboss:magnet-download-settings";
  const SERVER_TOKENS_KEY = "javboss:server-tokens";
  const storageReady = chrome.storage.local
    .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
    .then(
      () => true,
      () => false,
    );
  const tokenInput = document.getElementById("server-token");
  let serverTokens = {};
  let saveQueue = Promise.resolve();
  let connectionVersion = 0;
  const JAVDB_SETTINGS_KEY = "javboss:javdb-settings";
  const serverInput = document.getElementById("server-url");
  const enabledInput = document.getElementById("enabled");
  const javDBAutoRedirectInput = document.getElementById("javdb-auto-redirect");
  const testButton = document.getElementById("test-connection");
  const connectionStatus = document.getElementById("connection-status");
  const status = document.getElementById("status");

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

  function hostPermission(serverUrl) {
    const parsed = new URL(serverUrl);
    return `${parsed.protocol}//${parsed.hostname}/*`;
  }

  function showStatus(message, failed = false) {
    status.textContent = message;
    status.classList.toggle("error", failed);
  }

  function showConnectionStatus(message, failed = false) {
    connectionStatus.textContent = message;
    connectionStatus.classList.toggle("error", failed);
  }

  async function testConnection() {
    if (testButton.disabled) return;
    const serverUrl = normalizedServerURL(serverInput.value);
    const token = tokenInput.value.trim();
    if (!serverUrl) {
      showConnectionStatus("请输入有效的 Server 地址", true);
      return;
    }
    if (!/^jbe_[A-Za-z0-9_-]{43}$/.test(token)) {
      showConnectionStatus("请输入有效的 API 令牌", true);
      return;
    }
    testButton.disabled = true;
    serverInput.disabled = tokenInput.disabled = true;
    testButton.textContent = "测试中…";
    showConnectionStatus("");
    try {
      if (!(await storageReady))
        throw new Error("无法安全访问扩展凭据，请重新加载扩展");
      const granted = await chrome.permissions.request({
        origins: [hostPermission(serverUrl)],
      });
      if (!granted) throw new Error("需要允许访问该 Server 才能测试连接");
      const response = await fetch(
        new URL("extension/status", `${serverUrl}/`).href,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        },
      );
      if (response.status === 401)
        throw new Error("API 令牌无效或已过期，请检查令牌");
      if (response.status === 403)
        throw new Error("服务器拒绝访问，请检查扩展接口配置");
      if (response.status === 404)
        throw new Error("未找到连接测试接口，请检查地址或更新 JavBoss 后台");
      if (!response.ok)
        throw new Error(`连接测试失败（HTTP ${response.status}）`);
      const contentType = response.headers.get("Content-Type") || "";
      if (contentType.toLowerCase().includes("text/html"))
        throw new Error(
          "服务器返回了网页，请检查 Server 地址及 /extension 接口代理配置",
        );
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error("服务器响应不是有效的 JSON，请检查 Server 地址");
      }
      if (payload?.authenticated !== true)
        throw new Error("服务器响应无效，请检查 Server 地址");
      showConnectionStatus("连接成功，API 令牌有效");
    } catch (error) {
      showConnectionStatus(
        error?.name === "TimeoutError"
          ? "连接超时，请检查 Server 地址和网络"
          : error instanceof TypeError
            ? "无法连接服务器，请检查地址、网络及 HTTPS 证书"
            : String(error?.message || "连接测试失败"),
        true,
      );
    } finally {
      testButton.disabled = false;
      serverInput.disabled = tokenInput.disabled = false;
      testButton.textContent = "测试连接";
    }
  }

  async function loadSettings() {
    if (!(await storageReady))
      throw new Error("无法安全访问扩展凭据，请重新加载扩展");
    const stored = await chrome.storage.local.get([
      MAGNET_DOWNLOAD_SETTINGS_KEY,
      SERVER_TOKENS_KEY,
      JAVDB_SETTINGS_KEY,
    ]);
    serverTokens = stored[SERVER_TOKENS_KEY] || {};
    const magnetSettings = stored[MAGNET_DOWNLOAD_SETTINGS_KEY] || {};
    const javDBSettings = stored[JAVDB_SETTINGS_KEY] || {};
    serverInput.value = String(magnetSettings.serverUrl || "");
    tokenInput.value =
      serverTokens[normalizedServerURL(serverInput.value)] || "";
    enabledInput.checked = magnetSettings.enabled === true;
    javDBAutoRedirectInput.checked = javDBSettings.autoRedirect !== false;
  }

  function persistSettings(values) {
    const save = saveQueue.then(async () => {
      if (!(await storageReady))
        throw new Error("无法安全保存扩展凭据，请重新加载扩展");
      await chrome.storage.local.set(values);
    });
    saveQueue = save.catch(() => {});
    return save.then(
      () => {
        showStatus("");
        return true;
      },
      (error) => {
        showStatus(String(error?.message || "保存失败"), true);
        return false;
      },
    );
  }

  function saveConnection() {
    const serverUrl = normalizedServerURL(serverInput.value);
    const token = tokenInput.value.trim();
    if (serverUrl) {
      if (token) serverTokens[serverUrl] = token;
      else delete serverTokens[serverUrl];
    }
    return persistSettings({
      [SERVER_TOKENS_KEY]: { ...serverTokens },
      [MAGNET_DOWNLOAD_SETTINGS_KEY]: {
        enabled:
          enabledInput.checked &&
          Boolean(serverUrl) &&
          /^jbe_[A-Za-z0-9_-]{43}$/.test(token),
        serverUrl: serverUrl || serverInput.value.trim(),
      },
    });
  }

  async function enableDownloads() {
    const version = connectionVersion;
    const serverUrl = normalizedServerURL(serverInput.value);
    const token = tokenInput.value.trim();
    try {
      if (!serverUrl || !/^jbe_[A-Za-z0-9_-]{43}$/.test(token))
        throw new Error("请先填写有效的 Server 地址和 API 令牌");
      if (!(await storageReady))
        throw new Error("无法安全保存扩展凭据，请重新加载扩展");
      const granted = await chrome.permissions.request({
        origins: [hostPermission(serverUrl)],
      });
      if (version !== connectionVersion || !enabledInput.checked) return;
      if (!granted)
        throw new Error("需要允许访问该 JavBoss Server 才能启用磁力下载");
      if (!(await saveConnection())) enabledInput.checked = false;
    } catch (error) {
      if (version !== connectionVersion) return;
      enabledInput.checked = false;
      await saveConnection();
      showStatus(String(error?.message || "启用磁力下载失败"), true);
    }
  }

  serverInput.addEventListener("input", () => {
    connectionVersion += 1;
    showConnectionStatus("");
    tokenInput.value =
      serverTokens[normalizedServerURL(serverInput.value)] || "";
    return saveConnection();
  });
  tokenInput.addEventListener("input", () => {
    connectionVersion += 1;
    showConnectionStatus("");
    return saveConnection();
  });
  // Host permission prompts run only when editing is committed or the toggle is enabled.
  for (const input of [serverInput, tokenInput]) {
    input.addEventListener("change", () => {
      if (enabledInput.checked) return enableDownloads();
    });
  }
  enabledInput.addEventListener("change", () => {
    connectionVersion += 1;
    return enabledInput.checked ? enableDownloads() : saveConnection();
  });
  javDBAutoRedirectInput.addEventListener("change", async () => {
    const autoRedirect = javDBAutoRedirectInput.checked;
    javDBAutoRedirectInput.disabled = true;
    const saved = await persistSettings({
      [JAVDB_SETTINGS_KEY]: { autoRedirect },
    });
    if (!saved) javDBAutoRedirectInput.checked = !autoRedirect;
    javDBAutoRedirectInput.disabled = false;
  });
  testButton.addEventListener("click", testConnection);
  loadSettings().catch((error) => {
    showStatus(String(error?.message || error || "读取设置失败"), true);
  });
})();
