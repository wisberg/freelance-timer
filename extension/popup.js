const trackedListEl = document.getElementById('tracked-items');
const historyListEl = document.getElementById('history-items');
const emptyStateEl = document.querySelector('#tracked-list .empty');
const patternForm = document.getElementById('pattern-form');
const labelInput = document.getElementById('pattern-label');
const patternInput = document.getElementById('pattern-input');
const refreshButton = document.getElementById('refresh-summary');
const historyButton = document.getElementById('load-history');
const summaryEl = document.getElementById('session-summary');
const statusEl = document.getElementById('report-status');
const downloadBtn = document.getElementById('generate-pdf');
const startDateEl = document.getElementById('start-date');
const endDateEl = document.getElementById('end-date');
const extensionIcon = chrome.runtime.getURL('icons/icon48.png');

let trackedUrls = [];
const iconCache = new Map();
const fallbackIcon = createFallbackIcon();

init();

async function init() {
  await loadTrackedUrls();
  setDefaultDates();
  await renderSummary();
}

function setDefaultDates() {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const startDate = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  const start = startDate.toISOString().split('T')[0];
  if (!startDateEl.value) startDateEl.value = start;
  if (!endDateEl.value) endDateEl.value = end;
}

async function loadTrackedUrls() {
  const { trackedUrls: stored = [] } = await chrome.storage.local.get('trackedUrls');
  trackedUrls = stored;
  renderTrackedList();
}

function renderTrackedList() {
  trackedListEl.innerHTML = '';
  if (!trackedUrls.length) {
    emptyStateEl.hidden = false;
    return;
  }
  emptyStateEl.hidden = true;
  const fragment = document.createDocumentFragment();
  for (const item of trackedUrls) {
    const li = document.createElement('li');
    const details = document.createElement('div');
    details.className = 'details';
    const title = document.createElement('strong');
    title.textContent = item.label || item.pattern;
    const subtitle = document.createElement('span');
    subtitle.textContent = item.pattern;
    details.append(title, subtitle);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeTracked(item.id));
    li.append(details, removeBtn);
    fragment.appendChild(li);
  }
  trackedListEl.appendChild(fragment);
}

patternForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const rawPattern = patternInput.value.trim();
  if (!rawPattern) return;
  const normalized = normalizePatternInput(rawPattern);
  const id = generateId();
  const entry = {
    id,
    pattern: normalized,
    label: labelInput.value.trim() || undefined
  };
  trackedUrls.push(entry);
  await chrome.storage.local.set({ trackedUrls });
  patternForm.reset();
  renderTrackedList();
  await renderSummary();
});

async function removeTracked(id) {
  trackedUrls = trackedUrls.filter((item) => item.id !== id);
  await chrome.storage.local.set({ trackedUrls });
  renderTrackedList();
  await renderSummary();
}

refreshButton.addEventListener('click', () => {
  renderSummary();
});

historyButton.addEventListener('click', async () => {
  historyButton.disabled = true;
  historyButton.textContent = 'Loading…';
  try {
    await loadHistorySuggestions();
  } finally {
    historyButton.disabled = false;
    historyButton.textContent = 'Load Recent';
  }
});

async function loadHistorySuggestions() {
  historyListEl.innerHTML = '';
  const historyItems = await chrome.history.search({ text: '', maxResults: 20 });
  const seen = new Set();
  const fragment = document.createDocumentFragment();
  for (const item of historyItems) {
    if (!item.url) continue;
    const url = item.url;
    const base = urlBase(url);
    if (seen.has(base)) continue;
    seen.add(base);
    if (trackedUrls.some((entry) => url.startsWith(entry.pattern))) continue;

    const li = document.createElement('li');
    const details = document.createElement('div');
    details.className = 'details';
    const title = document.createElement('strong');
    title.textContent = base;
    const subtitle = document.createElement('span');
    subtitle.textContent = url;
    details.append(title, subtitle);
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = 'Track';
    addBtn.addEventListener('click', async () => {
      patternInput.value = url;
      labelInput.value = item.title || base;
      patternInput.focus();
    });
    li.append(details, addBtn);
    fragment.appendChild(li);
  }
  if (!fragment.childElementCount) {
    const li = document.createElement('li');
    li.textContent = 'No recent pages found.';
    fragment.appendChild(li);
  }
  historyListEl.appendChild(fragment);
}

[startDateEl, endDateEl].forEach((el) => el.addEventListener('change', () => {
  renderSummary();
}));

downloadBtn.addEventListener('click', async () => {
  downloadBtn.disabled = true;
  setStatus('Building your PDF report…');
  try {
    const range = getDateRange();
    const { sessions, aggregated } = await getSessions(range);
    if (!sessions.length) {
      setStatus('No tracked activity for the selected dates.');
      return;
    }
    const canvas = await renderReportCanvas(range, aggregated, sessions);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const pdfBlob = createPdfFromImage(dataUrl, canvas.width, canvas.height);
    const url = URL.createObjectURL(pdfBlob);
    const fileName = buildReportFilename(range);
    triggerDownload(url, fileName);
    setStatus('Report downloaded successfully.');
  } catch (error) {
    console.error(error);
    setStatus('Unable to create the report. Please try again.');
  } finally {
    downloadBtn.disabled = false;
  }
});

function setStatus(message) {
  statusEl.textContent = message || '';
}

function generateId() {
  if (typeof crypto?.randomUUID === 'function') {
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
  let startTime = start ? new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() : null;
  let endTime = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).getTime() : null;
  if (startTime && endTime && endTime < startTime) {
    [startTime, endTime] = [endTime, startTime];
    startDateEl.value = new Date(startTime).toISOString().split('T')[0];
    endDateEl.value = new Date(endTime).toISOString().split('T')[0];
  }
  return { startTime, endTime };
}

async function getSessions(range) {
  const { sessionLog = [] } = await chrome.storage.local.get('sessionLog');
  const filtered = sessionLog.filter((session) => {
    if (!session.endTime) return false;
    if (range.startTime && session.endTime < range.startTime) return false;
    if (range.endTime && session.startTime > range.endTime) return false;
    return true;
  });
  filtered.sort((a, b) => a.startTime - b.startTime);

  const aggregatedMap = new Map();
  for (const session of filtered) {
    const key = session.patternId || session.pattern || session.url;
    if (!aggregatedMap.has(key)) {
      aggregatedMap.set(key, {
        key,
        patternId: session.patternId,
        pattern: session.pattern,
        displayName: session.displayName || session.pattern || session.url,
        faviconUrl: session.faviconUrl || guessFavicon(session.url),
        totalDuration: 0,
        sessions: []
      });
    }
    const bucket = aggregatedMap.get(key);
    bucket.sessions.push(session);
    bucket.totalDuration += session.duration || 0;
  }

  const aggregated = Array.from(aggregatedMap.values());
  aggregated.sort((a, b) => b.totalDuration - a.totalDuration);
  return { sessions: filtered, aggregated };
}

async function renderSummary() {
  const range = getDateRange();
  const { sessions, aggregated } = await getSessions(range);
  summaryEl.innerHTML = '';
  if (!sessions.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No tracked activity in this range yet.';
    summaryEl.appendChild(p);
    return;
  }
  const total = sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
  const totalRow = document.createElement('div');
  totalRow.className = 'summary-row';
  const totalImg = document.createElement('img');
  totalImg.src = extensionIcon;
  totalImg.alt = 'Freelance Timer logo';
  const totalMeta = document.createElement('div');
  totalMeta.className = 'meta';
  const totalLabel = document.createElement('strong');
  totalLabel.textContent = 'Total Tracked';
  const totalDuration = document.createElement('span');
  totalDuration.textContent = formatDuration(total);
  totalMeta.append(totalLabel, totalDuration);
  totalRow.append(totalImg, totalMeta);
  summaryEl.appendChild(totalRow);

  for (const item of aggregated) {
    const row = document.createElement('div');
    row.className = 'summary-row';
    const img = document.createElement('img');
    img.src = item.faviconUrl || guessFavicon(item.pattern);
    img.alt = `${item.displayName} logo`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const label = document.createElement('strong');
    label.textContent = item.displayName;
    const details = document.createElement('span');
    details.textContent = `${formatDuration(item.totalDuration)} • ${item.sessions.length} session${item.sessions.length === 1 ? '' : 's'}`;
    meta.append(label, details);
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
  return parts.join(' ');
}

function formatTimeRange(session) {
  const start = new Date(session.startTime);
  const end = new Date(session.endTime);
  const dateFormatter = new Intl.DateTimeFormat([], { dateStyle: 'medium' });
  const timeFormatter = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
  return `${dateFormatter.format(start)} ${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
}

function guessFavicon(url) {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
  } catch (error) {
    return '';
  }
}

function createFallbackIcon() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#f5b301';
  ctx.fillRect(12, 12, 40, 40);
  return canvas;
}

async function renderReportCanvas(range, aggregated, sessions) {
  const width = 1400;
  const margin = 80;
  const summaryRows = aggregated.length;
  const detailRows = sessions.length;
  const summaryHeight = summaryRows ? summaryRows * 80 + 60 : 0;
  const detailHeight = detailRows ? detailRows * 70 + 80 : 0;
  const baseHeight = margin * 2 + 260 + summaryHeight + detailHeight;
  const height = Math.max(baseHeight, 1400);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#111827';
  ctx.font = 'bold 64px "Inter", "Segoe UI", sans-serif';
  ctx.fillText('Freelance Timer Report', margin, margin + 70);

  const dateRange = describeRange(range);
  ctx.font = '24px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText(dateRange, margin, margin + 110);

  const total = sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
  ctx.font = 'bold 36px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = '#0f172a';
  ctx.fillText(`Total time: ${formatDuration(total)}`, margin, margin + 160);

  let y = margin + 210;

  if (aggregated.length) {
    ctx.font = 'bold 32px "Inter", "Segoe UI", sans-serif';
    ctx.fillStyle = '#111827';
    ctx.fillText('Summary by URL', margin, y);
    y += 40;
    for (const item of aggregated) {
      const icon = await getIcon(item.faviconUrl || guessFavicon(item.pattern));
      ctx.drawImage(icon, margin, y - 32, 48, 48);
      ctx.font = 'bold 26px "Inter", "Segoe UI", sans-serif';
      ctx.fillStyle = '#111827';
      ctx.fillText(item.displayName, margin + 60, y);
      ctx.font = '20px "Inter", "Segoe UI", sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText(`${formatDuration(item.totalDuration)} • ${item.sessions.length} session${item.sessions.length === 1 ? '' : 's'}`, margin + 60, y + 30);
      y += 70;
    }
    y += 20;
  }

  ctx.font = 'bold 32px "Inter", "Segoe UI", sans-serif';
  ctx.fillStyle = '#111827';
  ctx.fillText('Sessions', margin, y);
  y += 40;

  let truncated = false;
  for (const session of sessions) {
    const icon = await getIcon(session.faviconUrl || guessFavicon(session.url));
    ctx.drawImage(icon, margin, y - 28, 44, 44);
    ctx.font = 'bold 24px "Inter", "Segoe UI", sans-serif';
    ctx.fillStyle = '#111827';
    ctx.fillText(session.displayName || session.pattern || session.url, margin + 56, y);
    ctx.font = '20px "Inter", "Segoe UI", sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(`${formatTimeRange(session)} • ${formatDuration(session.duration)}`, margin + 56, y + 28);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px "Inter", "Segoe UI", sans-serif';
    ctx.fillText(session.url, margin + 56, y + 52);
    y += 70;
    if (y > height - margin - 100) {
      truncated = true;
      break;
    }
  }

  if (truncated) {
    ctx.font = '18px "Inter", "Segoe UI", sans-serif';
    ctx.fillStyle = '#ef4444';
    ctx.fillText('Report truncated. Narrow the date range for full details.', margin, height - margin);
  }

  return canvas;
}

async function getIcon(url) {
  const key = url || 'fallback';
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
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

function describeRange(range) {
  const { startTime, endTime } = range;
  if (!startTime && !endTime) {
    return 'All activity';
  }
  const dateFormatter = new Intl.DateTimeFormat([], { dateStyle: 'medium' });
  const start = startTime ? dateFormatter.format(new Date(startTime)) : '…';
  const end = endTime ? dateFormatter.format(new Date(endTime)) : '…';
  return `${start} – ${end}`;
}

function createPdfFromImage(imageDataUrl, sourceWidth, sourceHeight) {
  const imageData = atob(imageDataUrl.split(',')[1]);
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
    addPart(encoder.encode('endobj\n'));
  }

  addPart(encoder.encode('%PDF-1.4\n'));

  addObject(1, ['<< /Type /Catalog /Pages 2 0 R >>\n']);
  addObject(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n']);
  addObject(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject <</Im0 4 0 R>> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\n`]);
  addObject(4, [`<< /Type /XObject /Subtype /Image /Width ${sourceWidth} /Height ${sourceHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`, imageBytes, '\nendstream\n']);
  addObject(5, [`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\n`]);

  const xrefOffset = currentOffset;
  addPart(encoder.encode(`xref\n0 6\n`));
  addPart(encoder.encode('0000000000 65535 f \n'));
  for (let i = 1; i <= 5; i++) {
    const offset = String(offsets[i]).padStart(10, '0');
    addPart(encoder.encode(`${offset} 00000 n \n`));
  }
  addPart(encoder.encode(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));

  const totalLength = pdfParts.reduce((sum, part) => sum + part.length, 0);
  const pdfBytes = new Uint8Array(totalLength);
  let position = 0;
  for (const part of pdfParts) {
    pdfBytes.set(part, position);
    position += part.length;
  }
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

function triggerDownload(url, fileName) {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function buildReportFilename(range) {
  const formatter = (time) => new Date(time).toISOString().split('T')[0];
  if (range.startTime && range.endTime) {
    return `freelance-timer_${formatter(range.startTime)}_${formatter(range.endTime)}.pdf`;
  }
  return `freelance-timer_${Date.now()}.pdf`;
}
