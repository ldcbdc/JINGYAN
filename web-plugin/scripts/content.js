
// =====================================================
// =====================================================

let lastScanResult = null;


async function scan() {
  if (!await JINGYAN.getProtectionEnabled()) return;

  const result = await JINGYAN.analyzePage({
    url: location.href,
    title: document.title,
    text: document.body?.innerText || ""
  });
  lastScanResult = result;

  if (result.level === "danger") {
    JINGYAN_MODAL.showModalDialog({
      level: 'danger', title: '高危风险拦截',
      message: "检测到充值、转账、付款等高危交易行为",
      showCancel: false, timeout: 3000
    });
  } else if (result.level === "warn") {
    JINGYAN_MODAL.showModalDialog({
      level: 'warn', title: '充值/付款风险提示',
      message: "页面包含充值金额、转账、支付等敏感资金操作",
      showCancel: false
    });
  }
  return result;
}

let lastContentKey = "";
let scanning = false;
let scanPromise = null;
let scanPromiseIsForced = false;
const AUTO_SCAN_COOLDOWN = 30000;
let scanCooldownUntil = 0;

const AI_TOAST_ID = "jingyan-ai-toast";
let aiToast = null;

function ensureAiToast() {
  if (aiToast) {
    aiToast.host.style.display = "block";
    return aiToast;
  }
  const host = document.createElement("div");
  host.id = AI_TOAST_ID;
  host.style.cssText = "position:fixed;right:16px;top:16px;z-index:2147483646;font-family:'Microsoft YaHei','PingFang SC','Segoe UI',Arial,sans-serif;";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    .toast { width: min(340px, calc(100vw - 32px)); background: rgba(18, 25, 40, 0.92); color: #eaf2ff; border-radius: 10px; padding: 12px 14px; box-shadow: 0 10px 30px rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); }
    .head { font-size: 12px; color: #7dd3fc; margin-bottom: 6px; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px; }
    .head::before { content: "✦"; color: #fbbf24; }
    .title { font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 4px; }
    .body { font-size: 12px; line-height: 1.6; color: #cbd5e1; word-break: break-all; max-height: 120px; overflow: hidden; }
  `;
  const toast = document.createElement("div");
  toast.className = "toast";
  const head = document.createElement("div");
  head.className = "head";
  head.textContent = "净眼 AI 实时分析";
  const title = document.createElement("div");
  title.className = "title";
  const body = document.createElement("div");
  body.className = "body";
  toast.append(head, title, body);
  root.append(style, toast);
  document.documentElement.appendChild(host);
  aiToast = { host, title, body, buffer: "" };
  return aiToast;
}

function showAiThinking(chunk) {
  try {
    const els = ensureAiToast();
    els.title.textContent = "实时检测中...";
    els.buffer = (els.buffer + String(chunk || "")).slice(-500);
    els.body.textContent = els.buffer || "正在分析网页特征...";
  } catch {}
}

function showAiStep(step) {
  if (!step || step.streaming) return;
  try {
    const els = ensureAiToast();
    els.title.textContent = `第${step.id || "?"}步 · ${step.title || "分析步骤"}`;
    els.body.textContent = step.detail || "";
    els.buffer = "";
  } catch {}
}

function hideAiToast() {
  if (aiToast) aiToast.host.style.display = "none";
}

let isRedirecting = false;
let lastTimerKey = "";
let redirectTimerId = null;
let lastScannedHref = "";

function resetForNewUrl() {
  if (lastScannedHref === location.href) return;
  lastScannedHref = location.href;
  isRedirecting = false;
  lastTimerKey = "";
  clearRedirectTimer();
  scanCooldownUntil = 0;
}

function setRedirectTimer(fn, delay) {
  clearRedirectTimer();
  redirectTimerId = setTimeout(fn, delay);
  return redirectTimerId;
}

function clearRedirectTimer() {
  if (redirectTimerId) {
    clearTimeout(redirectTimerId);
    redirectTimerId = null;
  }
}

async function scan(force = false) {
  if (scanPromise && (!force || scanPromiseIsForced)) return scanPromise;

  resetForNewUrl();

  if (!force && currentUrlBypassed) return lastScanResult;
  if (!force && Date.now() < scanCooldownUntil && lastScanResult) return lastScanResult;

  scanPromiseIsForced = force;
  scanPromise = (async () => {
    scanning = true;
    try {
      resetForNewUrl();
      if (!await JINGYAN.getProtectionEnabled()) return lastScanResult;

      if (force) lastContentKey = "";
      const text = readPageText();
      const contentKey = location.href + "\n" + text;
      if (contentKey === lastContentKey && lastScanResult) {
        return lastScanResult;
      }
      lastContentKey = contentKey;

      showAiThinking("正在提取网页特征...");
      const result = await JINGYAN.analyzePage({
        url: location.href, title: document.title, text
      }, {
        onThinking: (chunk) => showAiThinking(chunk),
        onStep: (step) => showAiStep(step)
      });
      hideAiToast();
      lastScanResult = result;
      scanCooldownUntil = Date.now() + AUTO_SCAN_COOLDOWN;

      report(result);

      applyScanVerdict(result);
      return result;
    } finally {
      scanning = false;
      scanPromise = null;
      scanPromiseIsForced = false;
    }
  })();
  return scanPromise;
}

function applyScanVerdict(result) {
  clearRedirectTimer();
  lastTimerKey = "";
}

let pageTextCache = "";
let pageTextDirty = true;
const MAX_CONTROLS = 400;

function markPageDirty() {
  pageTextDirty = true;
}

function readPageText() {
  if (!pageTextDirty && pageTextCache) return pageTextCache;

  const controls = [];
  const nodes = document.querySelectorAll("a,button,input,textarea,label,select,option");
  const limit = Math.min(nodes.length, MAX_CONTROLS);
  for (let i = 0; i < limit; i++) {
    const el = nodes[i];
    const text = el.textContent;
    if (text) controls.push(text);
    if (el.value) controls.push(el.value);
    if (el.placeholder) controls.push(el.placeholder);
  }

  pageTextCache = [document.body?.innerText || "", controls.join(" ")].join(" ");
  pageTextDirty = false;
  return pageTextCache;
}

function getBlockUrl(result) {
  const reasons = [...(result.aiResult?.reasons || (result.aiResult?.steps || []).map(s => s.detail).filter(Boolean))];
  if (result.intel?.flagged) {
    reasons.unshift(`威胁情报：${result.intel.domain} 被 ${result.intel.malicious} 家安全引擎判定为恶意${result.intel.categories?.length ? "（" + result.intel.categories.join("、") + "）" : ""}`);
  }
  const evidence = [result.moneyCheck?.keyword, result.moneyCheck?.amount, result.urlCheck?.host].filter(Boolean).join(" / ");
  const params = new URLSearchParams({
    url: location.href, host: location.hostname,
    level: result.level || "danger",
    score: String(result.score || result.aiResult?.score || 0),
    evidence,
    reason: reasons.slice(0, 4).join("；"),
    suggestion: result.aiResult?.suggestion || "检测到充值、转账、付款等高危交易行为，请立即终止当前访问。"
  });
  return `pages/intercept.html?${params.toString()}`;
}

function navigateToExtensionPage(pageUrl) {
  if (isRedirecting) return;
  isRedirecting = true;
  try { chrome.runtime.sendMessage({ type: "JINGYAN_NAVIGATE", url: pageUrl }); } catch {}
}

function redirectToBlockPage(result) {
  JINGYAN_MODAL.removeModal();
  hideAiToast();
  navigateToExtensionPage(getBlockUrl(result));
}

const BYPASS_KEY = "JINGYAN_BYPASS_UNTIL";

function report(result) {
  try {
    chrome.runtime.sendMessage({
      type: "JINGYAN_PAGE_RISK",
      level: result.level,
      urlRisk: result.urlRisk,
      moneyRisk: result.moneyRisk,
      score: result.score,
      aiResult: result.aiResult,
      result,
      tabUrl: location.href
    }, () => void chrome.runtime.lastError);
  } catch {}
}

function reportSafe() {
  report({ level: "safe", urlRisk: false, moneyRisk: false, score: 0 });
}

let enabled = false;
let hasEnabledState = false;
let currentUrlBypassed = false;

function getBypassKey(url) {
  try { const p = new URL(url); return `${p.origin}${p.pathname}${p.search}`; } catch { return url; }
}

function readBypassMap() {
  return new Promise(resolve => {
    try { chrome.storage.local.get(BYPASS_KEY, r => resolve(r[BYPASS_KEY] && typeof r[BYPASS_KEY] === "object" ? r[BYPASS_KEY] : {})); } catch { resolve({}); }
  });
}

async function hasBypassForCurrentUrl() {
  const map = await readBypassMap();
  const now = Date.now();
  const key = getBypassKey(location.href);
  let changed = false;
  Object.keys(map).forEach(k => { if (!map[k] || map[k] <= now) { delete map[k]; changed = true; } });
  if (changed) try { chrome.storage.local.set({ [BYPASS_KEY]: map }); } catch {}
  return Boolean(map[key] && map[key] > now);
}

const YELLOW_BYPASS_TTL = 10 * 60 * 1000;

function getOriginBypassKey(url) {
  try { return new URL(url).origin; } catch { return url; }
}

async function setYellowBypass() {
  const map = await readBypassMap();
  map[getOriginBypassKey(location.href)] = Date.now() + YELLOW_BYPASS_TTL;
  try { chrome.storage.local.set({ [BYPASS_KEY]: map }); } catch {}
}

async function hasMoneyBypass() {
  if (await hasBypassForCurrentUrl()) return true;
  const map = await readBypassMap();
  const until = map[getOriginBypassKey(location.href)];
  return Boolean(until && until > Date.now());
}

function getState() {
  return {
    enabled,
    hasEnabledState,
    currentUrlBypassed,
    lastScanResult,
    scanning,
    clearRedirectTimer,
    hasBypassForCurrentUrl,
    hasMoneyBypass,
    setYellowBypass
  };
}

async function ensureEnabledState() {
  if (!hasEnabledState) { enabled = await JINGYAN.getProtectionEnabled(); hasEnabledState = true; }
  return enabled;
}

const SCAN_DEBOUNCE = 500;
const SCAN_MAX_WAIT = 3000;
let scanTimer = 0;
let scanFirstRequestAt = 0;

function scheduleScan() {
  markPageDirty();
  const now = Date.now();
  if (!scanFirstRequestAt) scanFirstRequestAt = now;

  if (now - scanFirstRequestAt >= SCAN_MAX_WAIT) {
    runScheduledScan();
    return;
  }

  clearTimeout(scanTimer);
  scanTimer = setTimeout(runScheduledScan, SCAN_DEBOUNCE);
}

function runScheduledScan() {
  clearTimeout(scanTimer);
  scanTimer = 0;
  scanFirstRequestAt = 0;
  scan();
}

function applyEnabledChange(nextEnabled) {
  if (hasEnabledState && enabled === nextEnabled) return;
  enabled = nextEnabled;
  hasEnabledState = true;

  JINGYAN_MODAL.clearAlertKey();
  lastTimerKey = "";
  isRedirecting = false;
  clearRedirectTimer();
  JINGYAN_MODAL.removeModal();
  hideAiToast();

  if (enabled) {
    lastContentKey = "";
    markPageDirty();
    scheduleScan();
  } else {
    reportSafe();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "JINGYAN_GET_RISK") {
    if (message.force) {
      lastContentKey = "";
      markPageDirty();
    }
    scan(Boolean(message.force)).then(sendResponse);
    return true;
  }
  if (message?.type === "JINGYAN_GET_SNAPSHOT") {
    sendResponse({ url: location.href, title: document.title, text: readPageText() });
    return true;
  }
  if (message?.type === "JINGYAN_PROTECTION_CHANGED") {
    applyEnabledChange(message.enabled !== false);
    sendResponse({ ok: true });
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[JINGYAN.STORAGE_KEY]) return;
  applyEnabledChange(changes[JINGYAN.STORAGE_KEY].newValue !== false);
});

ensureEnabledState().then(async () => {
  currentUrlBypassed = await hasBypassForCurrentUrl();
  if (enabled && document.body) scan();
  else reportSafe();
});

const intercept = JINGYAN_INTERCEPT.createIntercept({ getState, report, redirectToBlockPage, scan });
intercept.bind();

const OWN_NODE_IDS = new Set([JINGYAN_MODAL.MODAL_ID, AI_TOAST_ID]);

function isOwnNode(node) {
  return Boolean(node && node.nodeType === 1 && node.id && OWN_NODE_IDS.has(node.id));
}

function isOwnMutation(mutation) {
  if (isOwnNode(mutation.target)) return true;
  for (const node of mutation.addedNodes) if (isOwnNode(node)) return true;
  for (const node of mutation.removedNodes) if (isOwnNode(node)) return true;
  return false;
}

new MutationObserver(mutations => {
  for (const mutation of mutations) {
    if (!isOwnMutation(mutation)) {
      scheduleScan();
      return;
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

document.addEventListener("input", scheduleScan, true);
document.addEventListener("change", scheduleScan, true);
