importScripts("blacklist.js", "intel.js", "core.js", "ai.js");

const pageRisks = new Map();
const LAST_RESULT_PREFIX = "jingyanLastResult:";

const BADGE_STYLE = {
  danger: { text: "!", color: "#b42318", title: "净眼：发现高危风险" },
  warn: { text: "!", color: "#d47300", title: "净眼：发现资金风险" },
  safe: { text: "", color: "#b42318", title: "净眼：未发现明显风险" }
};

function setBadge(tabId, level, enabled) {
  if (!enabled) {
    chrome.action.setBadgeText({ tabId, text: "" });
    chrome.action.setTitle({ tabId, title: "净眼：防护已暂停" });
    return;
  }

  const style = BADGE_STYLE[level] || BADGE_STYLE.safe;
  chrome.action.setBadgeText({ tabId, text: style.text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: style.color });
  chrome.action.setTitle({ tabId, title: style.title });
}

function mergeLevel(a, b) {
  if (a === "danger" || b === "danger") return "danger";
  if (a === "warn" || b === "warn") return "warn";
  return "safe";
}

async function updateTab(tabId, url) {
  if (!tabId) return;

  const enabled = await JINGYAN.getProtectionEnabled();
  if (!enabled || !url || JINGYAN.isInternalUrl(url)) {
    setBadge(tabId, "safe", enabled);
    return;
  }

  const urlCheck = JINGYAN.checkUrl(url);
  const urlLevel = urlCheck.risky ? (urlCheck.severity === "danger" ? "danger" : "warn") : "safe";
  setBadge(tabId, mergeLevel(urlLevel, pageRisks.get(tabId) || "safe"), enabled);
}

function updateOpenTabs() {
  chrome.tabs.query({}, tabs => {
    tabs.forEach(tab => updateTab(tab.id, tab.url));
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(JINGYAN.STORAGE_KEY, result => {
    if (!(JINGYAN.STORAGE_KEY in result)) {
      chrome.storage.local.set({ [JINGYAN.STORAGE_KEY]: false });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "JINGYAN_GET_LAST_RESULT" && message?.tabId) {
    const key = LAST_RESULT_PREFIX + message.tabId;
    chrome.storage.local.get(key, r => {
      sendResponse({ ok: true, result: r[key] || null });
    });
    return true;
  }

  const tabId = sender.tab?.id;
  if (!tabId) return;

  if (message?.type === "JINGYAN_PAGE_RISK") {
    const level = ["safe", "warn", "danger"].includes(message.level)
      ? message.level
      : (message.moneyRisk || message.urlRisk ? "warn" : "safe");
    pageRisks.set(tabId, level);
    if (message.result) {
      chrome.storage.local.set({
        [LAST_RESULT_PREFIX + tabId]: {
          url: sender.tab.url || message.tabUrl || "",
          result: message.result,
          time: Date.now()
        }
      });
    }
    updateTab(tabId, sender.tab.url);
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "JINGYAN_NAVIGATE" && message?.url) {
    chrome.tabs.update(tabId, { url: chrome.runtime.getURL(message.url) });
    sendResponse({ ok: true });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") pageRisks.delete(tabId);
  if (changeInfo.status === "complete") updateTab(tabId, tab.url);
});

chrome.tabs.onRemoved.addListener(tabId => {
  pageRisks.delete(tabId);
  try { chrome.storage.local.remove(LAST_RESULT_PREFIX + tabId); } catch {}
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then(
    tab => updateTab(tabId, tab.url),
    () => {}
  );
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[JINGYAN.STORAGE_KEY]) updateOpenTabs();
});
