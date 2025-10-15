// Removed tracked domains section
const summaryEl = document.getElementById("session-summary");
const statusEl = document.getElementById("report-status");
const downloadBtn = document.getElementById("generate-pdf");
const liveListEl = document.getElementById("live-items");
const liveEmptyEl = document.getElementById("live-empty");
const liveClockEl = document.getElementById("live-clock");
const currentSessionEl = document.getElementById("current-session");
const domainGroupsEl = document.getElementById("domain-groups");
const liveSeeMoreBtn = document.getElementById("live-see-more");
const groupSeeMoreBtn = document.getElementById("group-see-more");
const clearAllBtn = document.getElementById("clear-all");
const fallbackIcon = createFallbackIcon();
const extensionIcon = fallbackIcon.toDataURL();

let allDomains = [];
const selectedDomains = new Set();
const iconCache = new Map();
let lastEnsureAttempt = 0;
let lastEnsureStatus = null;
const ITEMS_PER_PAGE = 3;
let visibleLiveCount = ITEMS_PER_PAGE;
let visibleGroupCount = ITEMS_PER_PAGE;

function clampVisibleCount(current, total) {
  if (!total) return ITEMS_PER_PAGE;
  const baseline = Math.min(ITEMS_PER_PAGE, total);
  return Math.min(Math.max(current, baseline), total);
}

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
    hostname = raw;
  }
  hostname = hostname.replace(/^www\./i, "");
  const parts = hostname.split(".").filter(Boolean);
  if (!parts.length) return hostname;
  let candidate =
    parts.length > 1 ? parts[parts.length - 2] : parts[parts.length - 1];
  if (!candidate) candidate = parts[parts.length - 1];
  if (candidate && candidate.length <= 2 && parts.length > 2) {
    candidate = parts[parts.length - 3] || candidate;
  }
  const words = candidate.split(/[-_:]/g).filter(Boolean);
  if (!words.length) words.push(candidate);
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getDisplayName(item) {
  if (!item) return "";
  const title =
    (typeof item.displayName === "string" && item.displayName.trim()) ||
    (typeof item.title === "string" && item.title.trim());
  if (title) return title;
  if (item.domain) {
    const formatted = formatDomainLabel(item.domain);
    if (formatted) return formatted;
  }
  if (item.url) {
    const formatted = formatDomainLabel(item.url);
    if (formatted) return formatted;
    return item.url;
  }
  if (item.key) {
    const formatted = formatDomainLabel(item.key);
    if (formatted) return formatted;
    return item.key;
  }
  return "Current site";
}

function formatLiveDuration(duration) {
  const totalSeconds = Math.max(0, Math.floor(duration / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  if (hours) {
    return `${hours}:${pad(minutes)}hr`;
  }
  return `${minutes}:${pad(seconds)}m`;
}

function getHostname(item) {
  const source = item?.url || item?.domain || item?.key;
  if (!source) return "";
  const normalize = (value) => value.replace(/^www\./i, "");
  try {
    const url = /^https?:\/\//i.test(source) ? source : `https://${source}`;
    return normalize(new URL(url).hostname);
  } catch (error) {
    return normalize(String(source));
  }
}

function renderLiveList() {
  liveListEl.innerHTML = "";
  if (!allDomains.length) {
    liveEmptyEl.hidden = false;
    liveSeeMoreBtn.hidden = true;
    visibleLiveCount = ITEMS_PER_PAGE;
    return;
  }
  liveEmptyEl.hidden = true;
  visibleLiveCount = clampVisibleCount(visibleLiveCount, allDomains.length);
  const fragment = document.createDocumentFragment();
  const visibleItems = allDomains.slice(0, visibleLiveCount);
  for (const item of visibleItems) {
    const li = document.createElement("li");
    const details = document.createElement("div");
    details.className = "details";
    const title = document.createElement("strong");
    title.textContent = getDisplayName(item);
    const subtitle = document.createElement("span");
    subtitle.className = "details-url";
    subtitle.textContent = getHostname(item);
    details.append(title, subtitle);
    const right = document.createElement("div");
    right.className = "right";
    const timer = document.createElement("span");
    timer.className = "timer";
    timer.textContent = formatDuration(item.totalDuration);
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.textContent = "Reset";
    resetBtn.className = "reset-btn";
    resetBtn.addEventListener("click", async () => {
      if (confirm(`Reset timer for ${getDisplayName(item)}?`)) {
        await resetDomainTimer(item.domain || item.key);
        visibleLiveCount = ITEMS_PER_PAGE;
        await renderSummary();
        updateLiveTimers();
      }
    });
    right.append(timer, resetBtn);
    li.append(details, right);
    fragment.appendChild(li);
  }
  liveListEl.appendChild(fragment);
  const moreToShow = visibleLiveCount < allDomains.length;
  liveSeeMoreBtn.hidden = !moreToShow;
  if (moreToShow) {
    const remaining = allDomains.length - visibleLiveCount;
    liveSeeMoreBtn.textContent = `See more${remaining > 1 ? ` (${remaining})` : ""}`;
  }
}

init();

liveSeeMoreBtn?.addEventListener("click", () => {
  if (!allDomains.length) return;
  visibleLiveCount = clampVisibleCount(
    visibleLiveCount + ITEMS_PER_PAGE,
    allDomains.length
  );
  renderLiveList();
});

groupSeeMoreBtn?.addEventListener("click", () => {
  if (!allDomains.length) return;
  visibleGroupCount = clampVisibleCount(
    visibleGroupCount + ITEMS_PER_PAGE,
    allDomains.length
  );
  updateDomainGroups();
});

clearAllBtn?.addEventListener("click", async () => {
  if (!confirm("Clear all tracked sessions?")) return;
  selectedDomains.clear();
  visibleLiveCount = ITEMS_PER_PAGE;
  visibleGroupCount = ITEMS_PER_PAGE;
  setStatus("Clearing activity…");
  const response = await chrome.runtime
    .sendMessage({ type: "freelance-timer:clearAll" })
    .catch(() => null);
  if (!response?.cleared) {
    setStatus("Unable to clear activity. Please try again.");
    return;
  }
  setStatus("All activity cleared.");
  await renderSummary();
  await updateLiveTimers();
});

async function init() {
  await renderSummary();
  startLivePolling();
}

async function updateLiveTimers() {
  liveClockEl.textContent = new Date().toLocaleTimeString();
  const fetchStatus = () =>
    chrome.runtime
      .sendMessage({ type: "freelance-timer:getLiveStatus" })
      .catch(() => null);

  let ensureStatus = lastEnsureStatus;
  let response = await fetchStatus();
  let state = response?.state || (response?.activeSession ? "active" : null);

  if (state === "active") {
    ensureStatus = null;
    lastEnsureStatus = null;
  } else if (state === "paused") {
    ensureStatus = "paused";
    lastEnsureStatus = "paused";
  } else {
    const nowStamp = Date.now();
    if (nowStamp - lastEnsureAttempt > 2000) {
      lastEnsureAttempt = nowStamp;
      const ensureResponse = await chrome.runtime
        .sendMessage({ type: "freelance-timer:ensureActiveSession" })
        .catch(() => null);
      ensureStatus = ensureResponse?.status || null;
      response = await fetchStatus();
      state = response?.state || ensureStatus || state;
      if (ensureStatus === "active") {
        ensureStatus = null;
      }
    }
    lastEnsureStatus = ensureStatus;
  }

  if (!response) return;
  const {
    activeSession,
    pausedSession,
    totals = [],
    now = Date.now(),
  } = response;
  const sessionState =
    state ||
    ensureStatus ||
    (activeSession ? "active" : pausedSession ? "paused" : "none");

  const primarySession =
    sessionState === "active" && activeSession?.startTime
      ? {
          ...activeSession,
          duration: Math.max(0, now - activeSession.startTime),
          state: "active",
        }
      : sessionState === "paused" && pausedSession
      ? {
          ...pausedSession,
          duration: pausedSession.pausedDuration || 0,
          state: "paused",
        }
      : null;

  if (primarySession) {
    const sessionUrl = getHostname(primarySession);
    const sessionUrlHtml = sessionUrl
      ? `<div class="session-url">${sessionUrl}</div>`
      : "";
    const badge =
      primarySession.state === "paused"
        ? '<span class="session-badge">Paused</span>'
        : "";
    const durationText = formatLiveDuration(primarySession.duration);
    currentSessionEl.innerHTML = `
      <div class="current-session-content">
        <img src="${
          primarySession.faviconUrl || guessFavicon(sessionUrl)
        }" alt="favicon" class="session-favicon" />
        <div class="session-info">
          ${badge}
          <div class="session-title">${getDisplayName(primarySession)}</div>
          ${sessionUrlHtml}
          <div class="session-duration">${durationText}</div>
        </div>
      </div>
    `;
  } else {
    const isPausedDisplay =
      (sessionState === "paused" && pausedSession) ||
      (ensureStatus === "paused" && pausedSession);
    const message = isPausedDisplay
      ? "Tracking paused while this window is inactive."
      : ensureStatus === "untracked"
      ? "Tracking is paused for this page."
      : ensureStatus === "no-tab"
      ? "No active browser tab detected."
      : "No active session yet. Switch to a site to start tracking.";
    currentSessionEl.innerHTML = `<p class="empty">${message}</p>`;
  }

  // Update all domains list
  allDomains = totals
    .slice()
    .sort((a, b) => (b.totalDuration || 0) - (a.totalDuration || 0));
  if (!allDomains.length) {
    visibleLiveCount = ITEMS_PER_PAGE;
  }
  renderLiveList();

  // Update domain groups for export
  updateDomainGroups();

  lastEnsureStatus =
    sessionState === "active" || sessionState === "none"
      ? null
      : sessionState;
}

function startLivePolling() {
  updateLiveTimers();
  setInterval(updateLiveTimers, 1000);
}

function updateDomainGroups() {
  if (!domainGroupsEl) return;
  if (!allDomains.length) {
    domainGroupsEl.innerHTML = "";
    selectedDomains.clear();
    groupSeeMoreBtn.hidden = true;
    visibleGroupCount = ITEMS_PER_PAGE;
    return;
  }

  domainGroupsEl.innerHTML = "";
  visibleGroupCount = clampVisibleCount(visibleGroupCount, allDomains.length);
  const allKeys = new Set(
    allDomains.map((domain) => domain.domain || domain.key)
  );

  allDomains.forEach((domain, index) => {
    if (index >= visibleGroupCount) return;
    const group = document.createElement("div");
    group.className = "domain-group";

    const value = domain.domain || domain.key;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "domain-group";
    checkbox.value = value;
    checkbox.id = `domain-${index}`;
    checkbox.checked = selectedDomains.has(value);

    const label = document.createElement("label");
    label.htmlFor = `domain-${index}`;
    label.className = "domain-label";

    const titleSpan = document.createElement("span");
    titleSpan.className = "domain-label-title";
    titleSpan.textContent = getDisplayName(domain);

    const urlSpan = document.createElement("span");
    urlSpan.className = "domain-label-url";
    urlSpan.textContent = getHostname(domain);

    const durationSpan = document.createElement("span");
    durationSpan.className = "domain-label-duration";
    durationSpan.textContent = `Total: ${formatDuration(domain.totalDuration)}`;

    label.append(titleSpan, urlSpan, durationSpan);

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedDomains.add(value);
      } else {
        selectedDomains.delete(value);
      }
    });

    group.appendChild(checkbox);
    group.appendChild(label);
    domainGroupsEl.appendChild(group);
  });

  for (const value of Array.from(selectedDomains)) {
    if (!allKeys.has(value)) {
      selectedDomains.delete(value);
    }
  }

  const moreToShow = visibleGroupCount < allDomains.length;
  groupSeeMoreBtn.hidden = !moreToShow;
  if (moreToShow) {
    const remaining = allDomains.length - visibleGroupCount;
    groupSeeMoreBtn.textContent = `See more${remaining > 1 ? ` (${remaining})` : ""}`;
  }
}

async function resetDomainTimer(domain) {
  const { sessionLog = [] } = await chrome.storage.local.get("sessionLog");
  const remaining = sessionLog.filter((s) => s.domain !== domain);
  await chrome.storage.local.set({ sessionLog: remaining });
}

// Removed renderTrackedList function

// No manual pattern input needed - auto-tracking all domains

// Removed refresh button functionality

// Removed history functionality - auto-tracking all domains

// Removed date range functionality - auto-tracking all domains

downloadBtn.addEventListener("click", async () => {
  downloadBtn.disabled = true;
  setStatus("Building your PDF report…");
  try {
    const range = {};
    let { sessions, aggregated } = await getSessions(range);

    // Filter by selected checkboxes if any
    const selectedValues = new Set(selectedDomains);

    if (selectedValues.size) {
      sessions = sessions.filter((s) =>
        selectedValues.has(s.domain || s.url)
      );
      aggregated = aggregated.filter((a) =>
        selectedValues.has(a.domain || a.key)
      );
    }

    if (!sessions.length) {
      setStatus("No tracked activity for the selected domains.");
      downloadBtn.disabled = false;
      return;
    }
    const { canvas, annotations } = await renderReportCanvas(
      range,
      aggregated,
      sessions
    );
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const pdfBlob = createPdfFromImage(
      dataUrl,
      canvas.width,
      canvas.height,
      annotations
    );
    const url = URL.createObjectURL(pdfBlob);
    const fileName = buildReportFilename(range);
    triggerDownload(url, fileName);
    setStatus("Report downloaded successfully.");
  } catch (error) {
    console.error(error);
    setStatus("Unable to create the report. Please try again.");
  } finally {
    downloadBtn.disabled = false;
  }
});

const downloadAndResetBtn = document.getElementById("generate-pdf-reset");
downloadAndResetBtn?.addEventListener("click", async () => {
  if (!confirm("Download and clear all sessions?")) return;
  await downloadBtn.click();
  await chrome.storage.local.set({ sessionLog: [] });
  await renderSummary();
  updateLiveTimers();
});

function setStatus(message) {
  statusEl.textContent = message || "";
}

function generateId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pattern-${Math.random().toString(16).slice(2)}`;
}

function normalizePatternInput(input) {
  if (!/^https?:\/\//i.test(input)) {
    return `https://${input}`;
  }
  return input;
}

function urlBase(url) {
  try {
    const { origin } = new URL(url);
    return origin;
  } catch (error) {
    return url;
  }
}

function getDateRange() {
  const start = startDateEl.value ? new Date(startDateEl.value) : null;
  const end = endDateEl.value ? new Date(endDateEl.value) : null;
  let startTime = start
    ? new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
    : null;
  let endTime = end
    ? new Date(
        end.getFullYear(),
        end.getMonth(),
        end.getDate(),
        23,
        59,
        59,
        999
      ).getTime()
    : null;
  if (startTime && endTime && endTime < startTime) {
    [startTime, endTime] = [endTime, startTime];
    startDateEl.value = new Date(startTime).toISOString().split("T")[0];
    endDateEl.value = new Date(endTime).toISOString().split("T")[0];
  }
  return { startTime, endTime };
}

async function getSessions(range) {
  const { sessionLog = [] } = await chrome.storage.local.get("sessionLog");
  const filtered = sessionLog.filter((session) => {
    if (!session.endTime) return false;
    return true;
  });
  filtered.sort((a, b) => a.startTime - b.startTime);

  const aggregatedMap = new Map();
  for (const session of filtered) {
    const key = session.domain || session.url;
    const displayName = getDisplayName(session);
    if (!aggregatedMap.has(key)) {
      aggregatedMap.set(key, {
        key,
        domain: session.domain,
        url: session.url,
        displayName,
        faviconUrl: session.faviconUrl || guessFavicon(session.url),
        totalDuration: 0,
        sessions: [],
      });
    }
    const bucket = aggregatedMap.get(key);
    bucket.sessions.push(session);
    bucket.totalDuration += session.duration || 0;
    if (
      (!bucket.displayName ||
        bucket.displayName === bucket.domain ||
        bucket.displayName === bucket.key) &&
      displayName
    ) {
      bucket.displayName = displayName;
    }
    if (!bucket.url && session.url) {
      bucket.url = session.url;
    }
  }

  const aggregated = Array.from(aggregatedMap.values());
  aggregated.sort((a, b) => b.totalDuration - a.totalDuration);
  return { sessions: filtered, aggregated };
}

async function renderSummary() {
  const range = {};
  const { sessions, aggregated } = await getSessions(range);
  summaryEl.innerHTML = "";
  if (!sessions.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No tracked activity yet.";
    summaryEl.appendChild(p);
    return;
  }

  const total = sessions.reduce(
    (sum, session) => sum + (session.duration || 0),
    0
  );
  const totalRow = document.createElement("div");
  totalRow.className = "summary-row";
  const totalImg = document.createElement("img");
  totalImg.src = extensionIcon;
  totalImg.alt = "Freelance Timer logo";
  const totalMeta = document.createElement("div");
  totalMeta.className = "meta";
  const totalLabel = document.createElement("strong");
  totalLabel.textContent = "Total Tracked";
  const totalDuration = document.createElement("span");
  totalDuration.textContent = formatDuration(total);
  totalMeta.append(totalLabel, totalDuration);
  totalRow.append(totalImg, totalMeta);
  summaryEl.appendChild(totalRow);

  for (const item of aggregated) {
    const row = document.createElement("div");
    row.className = "summary-row";
    const img = document.createElement("img");
    img.src =
      item.faviconUrl || guessFavicon(item.domain || item.key || item.url);
    img.alt = `${getDisplayName(item)} logo`;
    const meta = document.createElement("div");
    meta.className = "meta";
    const label = document.createElement("strong");
    label.textContent = getDisplayName(item);
    const urlLine = document.createElement("span");
    urlLine.className = "meta-url";
    urlLine.textContent = getHostname(item);
    const details = document.createElement("span");
    details.className = "meta-details";
    details.textContent = `${formatDuration(item.totalDuration)} • ${
      item.sessions.length
    } session${item.sessions.length === 1 ? "" : "s"}`;
    meta.append(label, urlLine, details);
    row.append(img, meta);
    summaryEl.appendChild(row);
  }
}

function formatDuration(duration) {
  const totalMinutes = Math.round(duration / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function formatTimeRange(session) {
  const start = new Date(session.startTime);
  const end = new Date(session.endTime);
  const dateFormatter = new Intl.DateTimeFormat([], { dateStyle: "medium" });
  const timeFormatter = new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dateFormatter.format(start)} ${timeFormatter.format(
    start
  )} – ${timeFormatter.format(end)}`;
}

function guessFavicon(url) {
  if (!url) return "";
  const normalized = url.toLowerCase();
  if (
    normalized === "about:blank" ||
    normalized.startsWith("chrome://newtab") ||
    normalized.startsWith("edge://newtab")
  ) {
    return "";
  }
  try {
    const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const { hostname } = new URL(normalizedUrl);
    return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
  } catch (error) {
    return "";
  }
}

function createFallbackIcon() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "#f5b301";
  ctx.fillRect(12, 12, 40, 40);
  return canvas;
}

async function renderReportCanvas(range, aggregated, sessions) {
  const width = 1400;
  const margin = 80;
  const headerHeight = 300;
  const summaryRows = aggregated.length;
  const detailRows = sessions.length;
  const summaryHeight = summaryRows ? summaryRows * 120 + 90 : 0;
  const detailHeight = detailRows ? detailRows * 112 + 150 : 0;
  const footerHeight = 160;
  const baseHeight =
    margin + headerHeight + summaryHeight + detailHeight + footerHeight;
  const height = Math.max(baseHeight, 1600);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);

  const headerGradient = ctx.createLinearGradient(0, 0, width, 0);
  headerGradient.addColorStop(0, "#1e3a8a");
  headerGradient.addColorStop(1, "#2563eb");
  ctx.fillStyle = headerGradient;
  ctx.fillRect(0, 0, width, headerHeight);

  const logoUrl = chrome.runtime.getURL("Freelance_Timer_Logo_White.png");
  const logo = await getIcon(logoUrl);
  const logoWidth = 280;
  const intrinsicWidth = logo.naturalWidth || logo.width || 1;
  const intrinsicHeight =
    logo.naturalHeight || logo.height || intrinsicWidth;
  const logoHeight = (intrinsicHeight / intrinsicWidth) * logoWidth || 80;
  const logoX = width / 2 - logoWidth / 2;
  const logoY = headerHeight / 2 - logoHeight / 2;
  ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);

  const dateRange = describeRange(range);
  const total = sessions.reduce(
    (sum, session) => sum + (session.duration || 0),
    0
  );
  ctx.fillStyle = "#f8fafc";
  ctx.beginPath();
  ctx.moveTo(0, headerHeight);
  ctx.quadraticCurveTo(width / 2, headerHeight + 80, width, headerHeight);
  ctx.lineTo(width, headerHeight + 90);
  ctx.quadraticCurveTo(width / 2, headerHeight + 150, 0, headerHeight + 90);
  ctx.closePath();
  ctx.fill();

  const statsY = headerHeight + 85;
  ctx.font = 'bold 50px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "#0f172a";
  ctx.fillText(formatDuration(total), margin, statsY);
  ctx.font = '24px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "#475569";
  ctx.fillText("Total time tracked", margin, statsY + 34);
  ctx.font = '20px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "#64748b";
  ctx.fillText(dateRange, margin, statsY + 68);

  let y = statsY + 110;

  ctx.font = 'bold 34px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "#0f172a";
  ctx.fillText("Summary by site", margin, y);
  y += 40;

  if (aggregated.length) {
    for (const item of aggregated) {
      drawSummaryCard(ctx, {
        x: margin,
        y,
        width: width - margin * 2,
        height: 110,
        icon: await getIcon(
          item.faviconUrl || guessFavicon(item.domain || item.key || item.url)
        ),
        title: getDisplayName(item),
        subtitle: getHostname(item),
        meta: `${formatDuration(item.totalDuration)} • ${
          item.sessions.length
        } session${item.sessions.length === 1 ? "" : "s"}`,
      });
      y += 120;
    }
  } else {
    ctx.font = '22px "Inter", "Segoe UI", sans-serif';
    ctx.fillStyle = "#64748b";
    ctx.fillText(
      "No tracked activity for this range yet.",
      margin,
      y + 24
    );
    y += 60;
  }

  y += 30;
  ctx.font = 'bold 34px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "#0f172a";
  ctx.fillText("Sessions", margin, y);
  y += 40;

  let truncated = false;
  for (const session of sessions) {
      drawSessionRow(ctx, {
        x: margin,
        y,
        width: width - margin * 2,
        height: 105,
        icon: await getIcon(session.faviconUrl || guessFavicon(session.url)),
        title: getDisplayName(session),
        details: `${formatTimeRange(session)} • ${formatDuration(
          session.duration
        )}`,
        url: getHostname(session),
      });
    y += 112;
    if (y > height - footerHeight) {
      truncated = true;
      break;
    }
  }

  const annotations = [];

  const footerY = height - footerHeight + 40;
  ctx.font = '20px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(
    `Generated on ${new Date().toLocaleString()}`,
    margin,
    footerY
  );

  const creditText = "Developed by Duff Isberg";
  ctx.font = 'bold 22px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "#1d4ed8";
  ctx.fillText(creditText, margin, footerY + 40);
  const creditWidth = ctx.measureText(creditText).width;
  annotations.push({
    x: margin,
    y: footerY + 40 - 26,
    width: creditWidth,
    height: 30,
    url: "https://duffisberg.com",
  });

  if (truncated) {
    ctx.font = '18px "Inter", "Segoe UI", sans-serif';
    ctx.fillStyle = "#ef4444";
    ctx.fillText(
      "Report truncated. Narrow the date range for full details.",
      margin,
      height - margin
    );
  }

  return { canvas, annotations };
}

function drawSummaryCard(ctx, { x, y, width, height, icon, title, subtitle, meta }) {
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.1)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "#ffffff";
  roundedRect(ctx, x, y, width, height, 18);
  ctx.fill();
  ctx.restore();

  ctx.drawImage(icon, x + 24, y + height / 2 - 28, 56, 56);
  ctx.font = 'bold 26px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "#0f172a";
  ctx.fillText(title, x + 96, y + 48);
  if (subtitle) {
    ctx.font = '18px "Inter", "Segoe UI", sans-serif';
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(subtitle, x + 96, y + 74);
  }
  ctx.font = 'bold 22px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "#1e3a8a";
  ctx.textAlign = "right";
  ctx.fillText(meta, x + width - 32, y + 58);
  ctx.textAlign = "left";
}

function drawSessionRow(ctx, { x, y, width, height, icon, title, details, url }) {
  ctx.save();
  ctx.fillStyle = "#eef2ff";
  roundedRect(ctx, x, y, width, height, 16);
  ctx.fill();
  ctx.restore();

  ctx.drawImage(icon, x + 20, y + height / 2 - 24, 48, 48);
  ctx.font = 'bold 24px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "#0f172a";
  ctx.fillText(title, x + 84, y + 44);
  ctx.font = '18px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = "#475569";
  ctx.fillText(details, x + 84, y + 72);
  if (url) {
    ctx.font = '16px "Inter", "Segoe UI", sans-serif';
    ctx.fillStyle = "#6366f1";
    ctx.fillText(url, x + 84, y + 96);
  }
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radius,
    y + height
  );
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

async function getIcon(url) {
  const key = url || "fallback";
  if (iconCache.has(key)) return iconCache.get(key);
  if (!url) {
    iconCache.set(key, fallbackIcon);
    return fallbackIcon;
  }
  try {
    const img = await loadImage(url);
    iconCache.set(key, img);
    return img;
  } catch (error) {
    iconCache.set(key, fallbackIcon);
    return fallbackIcon;
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(url)) {
      img.crossOrigin = "anonymous";
      img.referrerPolicy = "no-referrer";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

function describeRange(range) {
  const { startTime, endTime } = range;
  if (!startTime && !endTime) {
    return "All activity";
  }
  const dateFormatter = new Intl.DateTimeFormat([], { dateStyle: "medium" });
  const start = startTime ? dateFormatter.format(new Date(startTime)) : "…";
  const end = endTime ? dateFormatter.format(new Date(endTime)) : "…";
  return `${start} – ${end}`;
}

function createPdfFromImage(
  imageDataUrl,
  sourceWidth,
  sourceHeight,
  annotations = []
) {
  const imageData = atob(imageDataUrl.split(",")[1]);
  const imageBytes = new Uint8Array(imageData.length);
  for (let i = 0; i < imageData.length; i++) {
    imageBytes[i] = imageData.charCodeAt(i);
  }
  const pageWidth = 612; // 8.5in
  const pageHeight = Math.round(pageWidth * (sourceHeight / sourceWidth));
  const contentStream = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
  const encoder = new TextEncoder();
  const offsets = [];
  let currentOffset = 0;
  const pdfParts = [];
  const scale = pageWidth / sourceWidth;
  const filteredAnnotations = Array.isArray(annotations)
    ? annotations
        .map((item) => {
          if (!item || !item.url) return null;
          const x = Number(item.x ?? 0);
          const y = Number(item.y ?? 0);
          const width = Number(item.width ?? 0);
          const height = Number(item.height ?? 0);
          if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            width <= 0 ||
            height <= 0
          ) {
            return null;
          }
          return { x, y, width, height, url: item.url };
        })
        .filter(Boolean)
    : [];
  const annotationIds = filteredAnnotations.map((_, index) => 6 + index);

  function addPart(part) {
    pdfParts.push(part);
    currentOffset += part.length;
  }

  function addObject(id, parts) {
    offsets[id] = currentOffset;
    addPart(encoder.encode(`${id} 0 obj\n`));
    for (const part of parts) {
      addPart(part instanceof Uint8Array ? part : encoder.encode(part));
    }
    addPart(encoder.encode("endobj\n"));
  }

  addPart(encoder.encode("%PDF-1.4\n"));

  addObject(1, ["<< /Type /Catalog /Pages 2 0 R >>\n"]);
  addObject(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n"]);
  const annotsSnippet = annotationIds.length
    ? ` /Annots [${annotationIds.map((id) => `${id} 0 R`).join(" ")}]`
    : "";
  addObject(3, [
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject <</Im0 4 0 R>> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R${annotsSnippet} >>\n`,
  ]);
  addObject(4, [
    `<< /Type /XObject /Subtype /Image /Width ${sourceWidth} /Height ${sourceHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`,
    imageBytes,
    "\nendstream\n",
  ]);
  addObject(5, [
    `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\n`,
  ]);
  filteredAnnotations.forEach((annotation, index) => {
    const { x, y, width: w, height: h, url } = annotation;
    const x1 = x * scale;
    const y1 = pageHeight - (y + h) * scale;
    const x2 = (x + w) * scale;
    const y2 = pageHeight - y * scale;
    const rect = [
      x1.toFixed(2),
      y1.toFixed(2),
      x2.toFixed(2),
      y2.toFixed(2),
    ].join(" ");
    addObject(6 + index, [
      `<< /Type /Annot /Subtype /Link /Rect [${rect}] /Border [0 0 0] /A << /S /URI /URI (${url}) >> >>\n`,
    ]);
  });

  const xrefOffset = currentOffset;
  const totalObjects = 5 + filteredAnnotations.length;
  addPart(encoder.encode(`xref\n0 ${totalObjects + 1}\n`));
  addPart(encoder.encode("0000000000 65535 f \n"));
  for (let i = 1; i <= totalObjects; i++) {
    const offset = String(offsets[i]).padStart(10, "0");
    addPart(encoder.encode(`${offset} 00000 n \n`));
  }
  addPart(
    encoder.encode(
      `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
    )
  );

  const totalLength = pdfParts.reduce((sum, part) => sum + part.length, 0);
  const pdfBytes = new Uint8Array(totalLength);
  let position = 0;
  for (const part of pdfParts) {
    pdfBytes.set(part, position);
    position += part.length;
  }
  return new Blob([pdfBytes], { type: "application/pdf" });
}

function triggerDownload(url, fileName) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function buildReportFilename(range) {
  const formatter = (time) => new Date(time).toISOString().split("T")[0];
  if (range.startTime && range.endTime) {
    return `freelance-timer_${formatter(range.startTime)}_${formatter(
      range.endTime
    )}.pdf`;
  }
  return `freelance-timer_${Date.now()}.pdf`;
}
