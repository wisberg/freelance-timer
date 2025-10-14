const MIN_SESSION_LENGTH_MS = 5000;

let trackedPatterns = [];
let activeSession = null;

chrome.runtime.onInstalled.addListener(async () => {
  const items = await chrome.storage.local.get({
    trackedUrls: [],
    sessionLog: []
  });
  await chrome.storage.local.set({
    trackedUrls: items.trackedUrls ?? [],
    sessionLog: items.sessionLog ?? []
  });
  await loadTrackedPatterns();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.trackedUrls) {
    trackedPatterns = changes.trackedUrls.newValue || [];
  }
});

async function loadTrackedPatterns() {
  const { trackedUrls = [] } = await chrome.storage.local.get('trackedUrls');
  trackedPatterns = trackedUrls;
}

function normalizePattern(pattern) {
  return pattern.trim();
}

function matchesTracked(url) {
  if (!url || !trackedPatterns.length) return null;
  const normalized = url.toLowerCase();
  for (const entry of trackedPatterns) {
    const pattern = normalizePattern(entry.pattern || '');
    if (!pattern) continue;
    if (normalized.startsWith(pattern.toLowerCase())) {
      return entry;
    }
  }
  return null;
}

async function ensureActiveSession(tab) {
  const tracked = matchesTracked(tab.url);
  if (!tracked) {
    await endActiveSession('untracked');
    return;
  }

  if (activeSession && activeSession.tabId === tab.id && activeSession.patternId === tracked.id) {
    // continue same session
    return;
  }

  await endActiveSession('switch');

  activeSession = {
    patternId: tracked.id,
    pattern: tracked.pattern,
    displayName: tracked.label || tracked.pattern,
    url: tab.url,
    title: tab.title,
    faviconUrl: tab.favIconUrl || getFaviconFromUrl(tab.url),
    startTime: Date.now(),
    tabId: tab.id,
    windowId: tab.windowId
  };
}

function getFaviconFromUrl(url) {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}`;
  } catch (error) {
    return '';
  }
}

async function endActiveSession(reason = 'manual') {
  if (!activeSession) return;
  const endedAt = Date.now();
  const duration = endedAt - activeSession.startTime;
  if (duration >= MIN_SESSION_LENGTH_MS) {
    const session = {
      ...activeSession,
      endTime: endedAt,
      duration,
      reason
    };
    const { sessionLog = [] } = await chrome.storage.local.get('sessionLog');
    sessionLog.push(session);
    await chrome.storage.local.set({ sessionLog });
  }
  activeSession = null;
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
  if (!tab) {
    await endActiveSession('tab missing');
    return;
  }
  await ensureActiveSession(tab);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab) return;
  if (tab.active && changeInfo.status === 'complete') {
    await ensureActiveSession(tab);
  } else if (tabId === activeSession?.tabId && changeInfo.status === 'loading' && changeInfo.url) {
    await ensureActiveSession({ ...tab, url: changeInfo.url });
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await endActiveSession('window blurred');
  } else if (activeSession && activeSession.windowId !== windowId) {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab) {
      await ensureActiveSession(tab);
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (activeSession?.tabId === tabId) {
    await endActiveSession('tab closed');
  }
});

if (chrome.idle?.onStateChanged) {
  chrome.idle.onStateChanged.addListener(async (newState) => {
    if (newState !== 'active') {
      await endActiveSession(`idle-${newState}`);
    } else {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab) {
        await ensureActiveSession(tab);
      }
    }
  });
}

loadTrackedPatterns();
