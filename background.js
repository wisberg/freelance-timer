const MIN_SESSION_LENGTH_MS = 5000;
const SESSION_STORAGE_KEY = "activeSession";
const PAUSED_SESSION_KEY = "pausedSession";

let activeSession = null;
let pausedSession = null;
const restoreActiveSessionPromise = restoreActiveSession();

function formatDomainLabel(domainOrUrl) {
  if (!domainOrUrl) return "";
  const raw = String(domainOrUrl).trim();
  if (!raw) return "";
  const normalizedRaw = raw.toLowerCase();
  if (normalizedRaw.includes("newtab")) {
    return "New Tab";
  }
  if (normalizedRaw === "about:blank") {
    return "Blank Tab";
  }
  let hostname = raw;
  try {
    hostname = new URL(raw).hostname || raw;
  } catch (error) {
    // domainOrUrl may already be a hostname; ignore parse errors
  }
  hostname = hostname.replace(/^www\./i, "");
  const parts = hostname.split(".").filter(Boolean);
  if (!parts.length) return hostname;
  let candidate =
    parts.length > 1 ? parts[parts.length - 2] : parts[parts.length - 1];
  if (!candidate) {
    candidate = parts[parts.length - 1];
  }
  if (candidate && candidate.length <= 2 && parts.length > 2) {
    candidate = parts[parts.length - 3] || candidate;
  }
  const words = candidate.split(/[-_:]/g).filter(Boolean);
  if (!words.length) words.push(candidate);
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function inferDisplayName(source) {
  if (!source) return "";
  const title = source.displayName || source.title;
  if (title && title.trim()) return title.trim();
  if (source.domain) {
    const formatted = formatDomainLabel(source.domain);
    if (formatted) return formatted;
  }
  if (source.url) {
    const formatted = formatDomainLabel(source.url);
    if (formatted) return formatted;
    return source.url;
  }
  return "Current site";
}

function getDisplayNameFromTab(tab, domain) {
  if (tab?.title && tab.title.trim()) return tab.title.trim();
  const formatted = formatDomainLabel(domain || tab?.url);
  if (formatted) return formatted;
  if (tab?.url) return tab.url;
  return domain || "Current site";
}

async function restoreActiveSession() {
  const stored = await chrome.storage.local.get({
    [SESSION_STORAGE_KEY]: null,
    [PAUSED_SESSION_KEY]: null,
  });
  const storedActive = stored[SESSION_STORAGE_KEY];
  pausedSession = stored[PAUSED_SESSION_KEY] || null;
  if (!storedActive) return;
  const tab = await chrome.tabs.get(storedActive.tabId).catch(() => null);
  if (!tab || !shouldTrackUrl(tab.url)) {
    await chrome.storage.local.remove(SESSION_STORAGE_KEY);
    await chrome.storage.local.remove(PAUSED_SESSION_KEY);
    pausedSession = null;
    return;
  }
  const domain = getDomainFromUrl(tab.url);
  if (!domain) {
    await chrome.storage.local.remove(SESSION_STORAGE_KEY);
    await chrome.storage.local.remove(PAUSED_SESSION_KEY);
    pausedSession = null;
    return;
  }
  activeSession = {
    ...storedActive,
    domain,
    url: tab.url,
    title: tab.title,
    displayName: inferDisplayName({
      displayName: storedActive.displayName,
      title: tab.title,
      domain,
      url: tab.url,
    }),
    faviconUrl: tab.favIconUrl || getFaviconFromUrl(tab.url),
    tabId: tab.id,
    windowId: tab.windowId,
  };
  await persistActiveSession();
}

async function persistActiveSession() {
  if (!activeSession) {
    await chrome.storage.local.remove(SESSION_STORAGE_KEY);
    return;
  }
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: activeSession });
  await chrome.storage.local.remove(PAUSED_SESSION_KEY);
  pausedSession = null;
}

async function setPausedSession(snapshot) {
  pausedSession = snapshot || null;
  if (pausedSession) {
    await chrome.storage.local.set({ [PAUSED_SESSION_KEY]: pausedSession });
  } else {
    await chrome.storage.local.remove(PAUSED_SESSION_KEY);
  }
}

async function getActiveNormalTab(preferredWindowId) {
  const queryByWindow = async (windowId) => {
    if (typeof windowId !== "number") return null;
    const [tab] = await chrome.tabs
      .query({ active: true, windowId, windowType: "normal" })
      .catch(() => []);
    return tab || null;
  };

  const [focusedNormalTab] = await chrome.tabs
    .query({
      active: true,
      lastFocusedWindow: true,
      windowType: "normal",
    })
    .catch(() => []);
  if (focusedNormalTab) return focusedNormalTab;

  const tabFromPreferred = await queryByWindow(preferredWindowId);
  if (tabFromPreferred) return tabFromPreferred;

  const windows = await chrome.windows
    .getAll({ populate: false, windowTypes: ["normal"] })
    .catch(() => []);
  if (windows.length) {
    const focusedWindow = windows.find((w) => w.focused) || windows[0];
    const tab = await queryByWindow(focusedWindow.id);
    if (tab) return tab;
  }

  const [anyActive] = await chrome.tabs
    .query({ active: true, windowType: "normal" })
    .catch(() => []);
  return anyActive || null;
}

async function primeActiveSession() {
  await restoreActiveSessionPromise;
  if (activeSession) return;
  const tab = await getActiveNormalTab();
  if (tab) {
    await ensureActiveSession(tab);
  }
}

primeActiveSession().catch(() => {});

chrome.runtime.onInstalled.addListener(async () => {
  const items = await chrome.storage.local.get({
    sessionLog: [],
  });
  await chrome.storage.local.set({
    sessionLog: items.sessionLog ?? [],
  });
});

chrome.runtime.onStartup?.addListener(() => {
  primeActiveSession().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  // No need to track patterns anymore - we auto-track all domains
});

function getDomainFromUrl(url) {
  if (!url) return null;
  if (url.startsWith("about:")) {
    return url.toLowerCase();
  }
  try {
    const { hostname } = new URL(url);
    return hostname.toLowerCase();
  } catch (error) {
    return null;
  }
}

function shouldTrackUrl(url) {
  if (!url) return false;
  const normalized = url.toLowerCase();
  if (normalized.startsWith("chrome://")) {
    if (normalized.startsWith("chrome://newtab")) {
      return true;
    }
    return false;
  }
  if (normalized.startsWith("edge://")) {
    if (normalized.startsWith("edge://newtab")) {
      return true;
    }
    return false;
  }
  if (normalized.startsWith("about:")) {
    if (normalized === "about:blank") {
      return true;
    }
    return false;
  }
  if (
    normalized.startsWith("chrome-extension://") ||
    normalized.startsWith("moz-extension://")
  ) {
    return false;
  }
  if (normalized.startsWith("file://")) {
    return false;
  }
  if (normalized.startsWith("data:")) {
    return false;
  }
  return true;
}

async function ensureActiveSession(tab) {
  if (!tab) return { status: "untracked" };
  await restoreActiveSessionPromise;
  if (!shouldTrackUrl(tab.url)) {
    await pauseCurrentSession("untracked", { record: false });
    return { status: "paused" };
  }

  const domain = getDomainFromUrl(tab.url);
  if (!domain) {
    await pauseCurrentSession("untracked", { record: false });
    return { status: "paused" };
  }

  if (!activeSession && pausedSession) {
    const sameDomain = pausedSession.domain === domain;
    const sameTab = pausedSession.tabId === tab.id;
    if (sameDomain && (sameTab || !pausedSession.tabId)) {
      const carryDuration = pausedSession.pausedDuration || 0;
      activeSession = {
        ...pausedSession,
        domain,
        url: tab.url,
        title: tab.title,
        displayName: getDisplayNameFromTab(tab, domain),
        faviconUrl: tab.favIconUrl || getFaviconFromUrl(tab.url),
        windowId: tab.windowId,
        tabId: tab.id,
        startTime: Date.now() - carryDuration,
      };
      await setPausedSession(null);
      await persistActiveSession();
      return { status: "active" };
    }
  }

  if (
    activeSession &&
    activeSession.tabId === tab.id &&
    activeSession.domain === domain
  ) {
    activeSession = {
      ...activeSession,
      url: tab.url,
      title: tab.title,
      displayName: getDisplayNameFromTab(tab, domain),
      faviconUrl: tab.favIconUrl || getFaviconFromUrl(tab.url),
      windowId: tab.windowId,
    };
    await persistActiveSession();
    // continue same session
    return { status: "active" };
  }

  await pauseCurrentSession("switch", { keepSnapshot: false });

  activeSession = {
    domain: domain,
    displayName: getDisplayNameFromTab(tab, domain),
    url: tab.url,
    title: tab.title,
    faviconUrl: tab.favIconUrl || getFaviconFromUrl(tab.url),
    startTime: Date.now(),
    tabId: tab.id,
    windowId: tab.windowId,
  };
  await persistActiveSession();
  return { status: "active" };
}

function getFaviconFromUrl(url) {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}`;
  } catch (error) {
    return "";
  }
}

async function endActiveSession(reason = "manual", { record = true } = {}) {
  await restoreActiveSessionPromise;
  if (!activeSession) return;
  const endedAt = Date.now();
  const duration = endedAt - activeSession.startTime;
  if (record && duration >= MIN_SESSION_LENGTH_MS) {
    const session = {
      ...activeSession,
      endTime: endedAt,
      duration,
      reason,
    };
    const { sessionLog = [] } = await chrome.storage.local.get("sessionLog");
    sessionLog.push(session);
    await chrome.storage.local.set({ sessionLog });
  }
  activeSession = null;
  await persistActiveSession();
}

async function pauseCurrentSession(reason = "paused", options = {}) {
  await restoreActiveSessionPromise;
  if (!activeSession) return;
  const { record = true, keepSnapshot = true } = options;
  const snapshot = {
    ...activeSession,
    pausedReason: reason,
    pausedAt: Date.now(),
    pausedDuration: Math.max(0, Date.now() - activeSession.startTime),
  };
  if (keepSnapshot) {
    await setPausedSession(snapshot);
  } else {
    await setPausedSession(null);
  }
  await endActiveSession(reason, { record });
}

// Provide live status and allow the popup to request a session refresh
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.type === "freelance-timer:ensureActiveSession") {
    (async () => {
      await restoreActiveSessionPromise;
      let tab = null;
      let status = "no-tab";
      if (typeof message.tabId === "number") {
        tab = await chrome.tabs.get(message.tabId).catch(() => null);
      }
      if (!tab) {
        tab = await getActiveNormalTab(activeSession?.windowId);
      }
      if (tab) {
        const result = await ensureActiveSession(tab);
        status = result?.status || "active";
      } else {
        await pauseCurrentSession("no-tab", { record: false });
        status = "paused";
      }
      sendResponse({ activeSession, pausedSession, status });
    })();
    return true;
  }

  if (message.type === "freelance-timer:clearAll") {
    (async () => {
      await restoreActiveSessionPromise;
      await pauseCurrentSession("manual-clear", { record: false });
      await setPausedSession(null);
      await chrome.storage.local.set({ sessionLog: [] });
      sendResponse({ cleared: true });
    })();
    return true;
  }

  if (message.type !== "freelance-timer:getLiveStatus") return;
  (async () => {
    await restoreActiveSessionPromise;
    if (!activeSession && !pausedSession) {
      const tab = await getActiveNormalTab();
      if (tab && shouldTrackUrl(tab.url)) {
        await ensureActiveSession(tab);
      }
    }
    const now = Date.now();
    const { sessionLog = [] } = await chrome.storage.local.get("sessionLog");
    const totalsMap = new Map();
    const ensureBucket = (key, seed) => {
      if (!totalsMap.has(key))
        totalsMap.set(key, { ...seed, totalDuration: 0, sessions: 0 });
      return totalsMap.get(key);
    };
    for (const s of sessionLog) {
      const key = s.domain || s.url;
      const bucket = ensureBucket(key, {
        key,
        domain: s.domain,
        url: s.url,
        displayName: inferDisplayName(s),
        faviconUrl: s.faviconUrl || getFaviconFromUrl(s.url),
      });
      bucket.totalDuration += s.duration || 0;
      bucket.sessions += 1;
      if (!bucket.url && s.url) {
        bucket.url = s.url;
      }
    }
    if (activeSession) {
      const key = activeSession.domain || activeSession.url;
      const bucket = ensureBucket(key, {
        key,
        domain: activeSession.domain,
        url: activeSession.url,
        displayName: inferDisplayName(activeSession),
        faviconUrl:
          activeSession.faviconUrl || getFaviconFromUrl(activeSession.url),
      });
      bucket.totalDuration += Math.max(0, now - activeSession.startTime);
    }
    if (!activeSession && pausedSession) {
      const key = pausedSession.domain || pausedSession.url;
      const bucket = ensureBucket(key, {
        key,
        domain: pausedSession.domain,
        url: pausedSession.url,
        displayName: pausedSession.displayName || pausedSession.url,
        faviconUrl:
          pausedSession.faviconUrl || getFaviconFromUrl(pausedSession.url),
      });
      bucket.totalDuration += pausedSession.pausedDuration || 0;
    }
    const totals = Array.from(totalsMap.values()).sort(
      (a, b) => b.totalDuration - a.totalDuration
    );
    let state = "active";
    if (!activeSession) {
      state = pausedSession ? "paused" : "none";
    }
    sendResponse({ activeSession, pausedSession, totals, now, state });
  })();
  return true;
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
  if (!tab) {
    await pauseCurrentSession("tab missing", { record: false });
    return;
  }
  await ensureActiveSession(tab);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab) return;
  if (tab.active && changeInfo.status === "complete") {
    await ensureActiveSession(tab);
  } else if (
    tabId === activeSession?.tabId &&
    changeInfo.status === "loading" &&
    changeInfo.url
  ) {
    await ensureActiveSession({ ...tab, url: changeInfo.url });
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await pauseCurrentSession("window blurred", { record: false });
    return;
  }

  const windowInfo = await chrome.windows
    .get(windowId, { populate: false })
    .catch(() => null);
  if (windowInfo?.type !== "normal") {
    await pauseCurrentSession("window blurred", { record: false });
    return;
  }

  const tab = await getActiveNormalTab(windowId);
  if (tab) {
    await ensureActiveSession(tab);
  } else {
    await pauseCurrentSession("window blurred", { record: false });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (activeSession?.tabId === tabId) {
    await endActiveSession("tab closed");
  }
});
