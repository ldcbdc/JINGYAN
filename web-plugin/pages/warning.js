const BYPASS_KEY = "JINGYAN_BYPASS_UNTIL";
const BYPASS_TTL = 10 * 60 * 1000;

// =====================================================
// =====================================================

const params = new URLSearchParams(location.search);
const rawUrl = params.get("url") || "";
const level = params.get("level") || "danger";

document.getElementById("site-domain").textContent =
  params.get("host") || rawUrl;
document.getElementById("risk-level").textContent =
  level === "warn" ? "中风险 · 需要核对" : "高危 · 疑似诈骗网站";
document.getElementById("risk-evidence").textContent =
  params.get("evidence") || "当前页面存在可疑资金操作或仿冒特征。";
document.getElementById("risk-suggestion").textContent =
  params.get("suggestion") ||
  "不要输入密码、验证码，也不要继续充值、转账或付款。";

async function continueAnyway() {
  if (!rawUrl) return;
  const key = getBypassKey(rawUrl);
  const current = await new Promise(r => chrome.storage.local.get(BYPASS_KEY, r));
  const map = current[BYPASS_KEY] && typeof current[BYPASS_KEY] === "object" ? current[BYPASS_KEY] : {};
  map[key] = Date.now() + BYPASS_TTL;
  await new Promise(r => chrome.storage.local.set({ [BYPASS_KEY]: map }, r));
  location.href = rawUrl;
}

document.getElementById("btn-continue").addEventListener("click", continueAnyway);

// =====================================================
// =====================================================

const rawHost = params.get("host") || "";
const score = params.get("score") || "";
const evidence = params.get("evidence") || "";
const reason = params.get("reason") || "";
const suggestion = params.get("suggestion") || "";

function getDisplayDomain() {
  if (rawHost) return rawHost.replace(/^www\./i, "");
  try { return new URL(rawUrl).hostname.replace(/^www\./i, ""); } catch { return rawUrl || "该网站"; }
}

function getBypassKey(url) {
  try { const parsed = new URL(url); return `${parsed.origin}${parsed.pathname}${parsed.search}`; } catch { return url; }
}

// chrome-extension://<id>/pages/intercept.html?url=javascript:...
function getSafeTargetUrl(url) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") ? parsed.href : "";
  } catch {
    return "";
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getStorage(key) {
  return new Promise(resolve => { try { chrome.storage.local.get(key, resolve); } catch { resolve({}); } });
}

function setStorage(value) {
  return new Promise(resolve => { try { chrome.storage.local.set(value, resolve); } catch { resolve(); } });
}

function showDetail() {
  document.getElementById("detail-panel").classList.add("show");
  document.getElementById("toggle-detail").textContent = "收起信息";
}

function hideDetail() {
  document.getElementById("detail-panel").classList.remove("show");
  document.getElementById("toggle-detail").textContent = "详细信息";
}

function formatSuggestion() {
  if (suggestion) return suggestion;
  return level === "warn" ? "请先核对域名、收款方和平台来源，确认无误后再继续。" : "不要输入密码、验证码，也不要继续充值、转账或付款。";
}

function formatThreatType() {
  if (reason) return reason;
  return level === "warn" ? "充值、付款或转账风险" : "仿冒网站 / 社会工程学诈骗";
}

function formatRiskLevel() {
  const suffix = score ? ` · 评分 ${score}` : "";
  return level === "warn" ? `中风险 · 需要核对${suffix}` : `高危 · 疑似诈骗网站${suffix}`;
}

async function continueAnywayFull() {
  const target = getSafeTargetUrl(rawUrl);
  if (!target) {
    setText("risk-suggestion", "无法继续访问：目标地址不是有效的网页链接。");
    return;
  }

  const current = await getStorage(BYPASS_KEY);
  const stored = current[BYPASS_KEY];
  const map = stored && typeof stored === "object" ? stored : {};

  const now = Date.now();
  for (const key of Object.keys(map)) {
    if (!map[key] || map[key] <= now) delete map[key];
  }
  map[getBypassKey(target)] = now + BYPASS_TTL;

  await setStorage({ [BYPASS_KEY]: map });
  location.href = target;
}

const continueBtn = document.getElementById("btn-continue");
continueBtn.removeEventListener("click", continueAnyway);
continueBtn.addEventListener("click", continueAnywayFull);

setText("site-domain", getDisplayDomain());
setText("risk-level", formatRiskLevel());
setText("risk-evidence", evidence || "当前页面存在可疑资金操作或仿冒特征。");
setText("risk-suggestion", formatSuggestion());
setText("time", new Date().toLocaleString("zh-CN"));
setText("threat-type", formatThreatType());
document.title = level === "warn" ? "净眼提示：此网站需要核对" : "净眼已拦截此风险网站";

document.getElementById("toggle-detail").addEventListener("click", function () {
  const panel = document.getElementById("detail-panel");
  if (panel.classList.contains("show")) hideDetail();
  else showDetail();
});
document.getElementById("learn-more-link").addEventListener("click", showDetail);
document.getElementById("btn-back").addEventListener("click", function () {
  if (history.length > 1) history.back();
  else location.href = "about:blank";
});
