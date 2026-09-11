(() => {
  const collect = {
    "https://javdb.com": javDBTargets,
    "https://www.javbus.com": javBusTargets,
    "https://www.javlibrary.com": javLibraryTargets,
  }[window.location.origin];
  if (window.top !== window || !collect) return;

  const badgeSelector = "[data-javboss-ownership]";
  const cache = new Map();
  let generation = 0;
  let running = false;
  let timer;
  let lastRefresh = Date.now();
  let enabled = true;

  function javDBTargets() {
    const result = [];
    for (const item of document.querySelectorAll(".movie-list .item")) {
      const code = item.querySelector(".video-title strong");
      const cover = item.querySelector(".cover");
      if (code && cover) {
        cover.classList.add("javboss-ownership-cover");
        result.push({
          host: cover,
          code: code.textContent.trim(),
        });
      }
    }
    for (const block of document.querySelectorAll(
      ".movie-panel-info .panel-block",
    )) {
      const label = block
        .querySelector("strong")
        ?.textContent.replace(/[\s:：]/g, "");
      if (!["番號", "番号", "識別碼", "识别码", "ID"].includes(label)) continue;
      const anchor = block.querySelector(".value");
      const code = anchor?.textContent.trim();
      if (code) result.push({ host: block, anchor, code });
    }
    return result;
  }

  function javBusTargets() {
    const result = [];
    for (const item of document.querySelectorAll("a.movie-box")) {
      const cover = item.querySelector(".photo-frame");
      let code = item.querySelector(".photo-info date")?.textContent.trim();
      if (!code) {
        try {
          const url = new URL(item.getAttribute("href"), window.location.href);
          const parts = url.pathname.split("/").filter(Boolean);
          if (
            url.origin === window.location.origin &&
            (parts.length === 1 ||
              (parts.length === 2 && ["en", "ja", "ko"].includes(parts[0]))) &&
            /\d/.test(parts.at(-1))
          ) {
            code = decodeURIComponent(parts.at(-1));
          }
        } catch {
          // Related cards have no visible code; use only valid local movie URLs.
        }
      }
      if (code && cover) {
        cover.classList.add("javboss-ownership-cover");
        result.push({
          host: cover,
          cropImage: cover.querySelector("img"),
          code,
        });
      }
    }
    for (const block of document.querySelectorAll(".movie .info p")) {
      const label = block.querySelector(".header");
      if (
        !["識別碼", "识别码", "番號", "番号", "ID"].includes(
          label?.textContent.replace(/[\s:：]/g, ""),
        )
      )
        continue;
      const anchor = label.nextElementSibling;
      const code = anchor?.textContent.trim();
      if (code) result.push({ host: block, anchor, code });
    }
    return result;
  }

  function javLibraryTargets() {
    const result = [];
    for (const item of document.querySelectorAll(".videothumblist .video")) {
      const code = item.querySelector(".id")?.textContent.trim();
      const host = item.querySelector("a[href]");
      const image = host?.querySelector("img");
      if (code && image) result.push({ host: item, code });
    }
    const anchor = document.querySelector("#video_id .text");
    const code = anchor?.textContent.trim();
    if (code)
      result.push({
        host: anchor.parentElement,
        anchor,
        code,
        cell: anchor.tagName === "TD",
      });
    return result;
  }

  function targets() {
    return collect().filter(
      ({ code }) =>
        code.length <= 128 && /^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/.test(code),
    );
  }

  function render({ host, anchor, cropImage, cell, code }) {
    const result = cache.get(code);
    let badge = host.querySelector(badgeSelector);
    if (
      !enabled ||
      (result?.ok === true && result.owned === false) ||
      (badge && badge.dataset.javbossOwnershipCode !== code)
    ) {
      if (cell && badge) badge.parentElement.remove();
      else badge?.remove();
      badge = null;
    }
    // Keep confirmed badges while revalidating, including on temporary failures.
    if (!enabled || result?.ok !== true || result.owned !== true) return;
    if (badge) return;

    // Keep JavBus thumbnail cropping inside the overflowing badge container.
    if (cropImage?.parentElement === host) {
      const crop = document.createElement("span");
      crop.className = "javboss-ownership-crop";
      host.insertBefore(crop, cropImage);
      crop.appendChild(cropImage);
    }

    const ownedBadge = document.createElement("span");
    ownedBadge.className = "javboss-ownership";
    ownedBadge.dataset.javbossOwnership = "owned";
    ownedBadge.dataset.javbossOwnershipCode = code;
    ownedBadge.textContent = "已拥有";
    ownedBadge.title = "JavBoss 影片库中已有此番号的有效视频记录";
    if (cell) {
      const column = document.createElement("td");
      column.className = "javboss-ownership-cell";
      column.appendChild(ownedBadge);
      host.insertBefore(column, anchor.nextSibling);
    } else {
      host.insertBefore(ownedBadge, anchor?.nextSibling || null);
    }
  }

  function schedule() {
    window.clearTimeout(timer);
    if (!enabled) return;
    timer = window.setTimeout(scan, 100);
  }

  async function scan() {
    if (running || !enabled) return;
    running = true;
    const currentGeneration = generation;
    try {
      const entries = targets();
      entries.forEach(render);
      const codes = [...new Set(entries.map((entry) => entry.code))].filter(
        (code) => !cache.has(code),
      );
      for (let offset = 0; offset < codes.length; offset += 200) {
        const batch = codes.slice(offset, offset + 200);
        let response;
        try {
          response = await chrome.runtime.sendMessage({
            type: "JAVBOSS_JAV_OWNERSHIP",
            codes: batch,
          });
        } catch {
          response = { ok: false, error: "扩展连接已中断，请刷新页面后重试" };
        }
        if (currentGeneration !== generation) return;
        if (response?.enabled === false) {
          enabled = false;
          refresh();
          return;
        }
        const items = new Map(
          (response?.ok && Array.isArray(response.items)
            ? response.items
            : []
          ).map((item) => [item?.code, item?.owned]),
        );
        for (const code of batch) {
          cache.set(
            code,
            response?.ok && typeof items.get(code) === "boolean"
              ? { ok: true, owned: items.get(code) }
              : { ok: false, error: response?.error || "拥有状态响应无效" },
          );
        }
        targets().forEach(render);
      }
    } finally {
      running = false;
      // Catch cards added during a request and settings changed while it was pending.
      if (
        enabled &&
        (currentGeneration !== generation ||
          targets().some(({ code }) => !cache.has(code)))
      )
        schedule();
    }
  }

  function refresh() {
    generation += 1;
    lastRefresh = Date.now();
    cache.clear();
    if (!enabled) {
      for (const badge of document.querySelectorAll(badgeSelector)) {
        if (badge.parentElement?.className === "javboss-ownership-cell")
          badge.parentElement.remove();
        else badge.remove();
      }
    }
    schedule();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "JAVBOSS_JAV_OWNERSHIP_REFRESH") refresh();
    if (message?.type === "JAVBOSS_OWNERSHIP_SETTINGS_CHANGED") {
      enabled = message.enabled === true;
      refresh();
    }
  });
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.addEventListener("focus", () => {
    if (Date.now() - lastRefresh >= 30000) refresh();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) refresh();
  });
  schedule();
})();
