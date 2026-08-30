const statusEl = document.getElementById("status");
const markEl = document.getElementById("mark");
const statusBadgeEl = document.getElementById("status-badge");
const titleEl = document.getElementById("title");
const descEl = document.getElementById("desc");
const detailWrap = document.getElementById("detail-wrap");
const detailEl = document.getElementById("detail");
const modeTextEl = document.getElementById("mode-text");
const toggleEl = document.getElementById("protection-toggle");
const toggleLabelEl = document.getElementById("toggle-label");
const aiWrapEl = document.getElementById("ai-wrap");
const aiStatusEl = document.getElementById("ai-status");
const aiStepsEl = document.getElementById("ai-steps");
const aiReanalyzeEl = document.getElementById("ai-reanalyze");

let currentEnabled = false;

function setResult(type, mark, title, desc, detail = "", badge = "") {
  statusEl.className = "status " + type;
  markEl.textContent = "";
  markEl.setAttribute("aria-label", mark);
  statusBadgeEl.textContent = badge || mark;
  titleEl.textContent = title;
  descEl.textContent = desc;
  detailEl.textContent = detail;
  detailWrap.hidden = !detail;
}


function setToggle(enabled, riskLevel) {
  currentEnabled = enabled;
  toggleEl.classList.remove('is-on', 'is-warning', 'is-danger');

  if (enabled) {
    toggleEl.classList.add('is-on');
    if (riskLevel === 'warn') {
      toggleEl.classList.add('is-warning');
      toggleLabelEl.textContent = '已开启·有风险';
    } else if (riskLevel === 'danger') {
      toggleEl.classList.add('is-danger');
      toggleLabelEl.textContent = '已开启·高危';
    } else {
      toggleLabelEl.textContent = '已开启';
    }
  } else {
    toggleLabelEl.textContent = '已暂停';
  }

  toggleEl.setAttribute("aria-checked", String(enabled));
  modeTextEl.textContent = enabled ? "安全检测" : "已暂停";
}

function setEnabled(enabled) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [JINGYAN.STORAGE_KEY]: enabled }, resolve);
  });
}

const USER_TOGGLED_KEY = "jingyanUserToggled";

function getUserToggled() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get({ [USER_TOGGLED_KEY]: false }, result => {
        resolve(result?.[USER_TOGGLED_KEY] === true);
      });
    } catch {
      resolve(false);
    }
  });
}

function setUserToggled(value) {
  return new Promise(resolve => {
    try {
      chrome.storage.local.set({ [USER_TOGGLED_KEY]: value }, resolve);
    } catch {
      resolve();
    }
  });
}

function askPage(tabId, force = false) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { type: "JINGYAN_GET_RISK", force }, response => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response || null);
    });
  });
}

function askSnapshot(tabId) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { type: "JINGYAN_GET_SNAPSHOT" }, response => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response || null);
    });
  });
}

function askLastResult(tabId) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type: "JINGYAN_GET_LAST_RESULT", tabId }, response => {
        if (chrome.runtime.lastError || !response?.ok) resolve(null);
        else resolve(response.result || null);
      });
    } catch {
      resolve(null);
    }
  });
}

function notifyPage(tabId, enabled) {
  if (!tabId) return;

  chrome.tabs.sendMessage(
    tabId,
    { type: "JINGYAN_PROTECTION_CHANGED", enabled },
    () => void chrome.runtime.lastError
  );
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function buildMoneyDetail(pageRisk) {
  const moneyCheck = pageRisk?.moneyCheck || {};
  const evidence = [moneyCheck.keyword || pageRisk?.moneyKeyword, moneyCheck.amount || pageRisk?.moneyAmount].filter(Boolean).join(" / ");
  const suffix = evidence ? `检测线索：${evidence}` : "确认收款方、金额和平台来源后再继续。";
  return ["核对当前域名是否来自官方入口。", suffix]
    .filter(Boolean)
    .join("\n");
}

function clearAiSteps() {
  aiStepsEl.innerHTML = "";
}

let renderToken = 0;
let stepChainTimer = null;

function beginRender() {
  renderToken++;
  if (stepChainTimer) { clearTimeout(stepChainTimer); stepChainTimer = null; }
  stopThinkingAnimation();
  return renderToken;
}

function isStale(token) {
  return token !== renderToken;
}

let thinkingTimer = null;
const THINKING_PHRASES = [
  "实时检测域名...",
  "实时检测页面内容...",
  "实时检测风险关键词...",
  "实时核验品牌身份...",
  "实时检测交易风险...",
  "实时计算风险分..."
];

function setThinkingLine(text, isActive = true) {
  if (!aiWrapEl) return;
  aiWrapEl.hidden = false;
  clearAiSteps();
  const line = document.createElement("div");
  line.className = "ai-thinking-line" + (isActive ? " active" : " done");
  line.textContent = text;
  aiStepsEl.appendChild(line);
  aiStepsEl.scrollTop = aiStepsEl.scrollHeight;
}

function startThinkingAnimation() {
  stopThinkingAnimation();
  let index = 0;
  setThinkingLine(THINKING_PHRASES[0], true);
  thinkingTimer = setInterval(() => {
    index = (index + 1) % THINKING_PHRASES.length;
    const line = aiStepsEl.querySelector(".ai-thinking-line");
    if (!line) {
      setThinkingLine(THINKING_PHRASES[index], true);
      return;
    }
    line.textContent = THINKING_PHRASES[index];
  }, 450);
}

function stopThinkingAnimation() {
  if (thinkingTimer) {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }
}

function updateThinkingStep(step) {
  stopThinkingAnimation();
  setThinkingLine(step?.title || "实时检测中...", true);
}

function createAiStepEl(step, className = "") {
  const item = document.createElement("div");
  const riskClass = step.risk === "high" ? " high" : step.risk === "medium" ? " medium" : "";
  item.className = "ai-step" + (className ? " " + className : "") + riskClass;

  const icon = document.createElement("span");
  icon.className = "ai-step-icon";
  const stepId = Number(step.id) || 0;
  icon.textContent = step.icon === "terminal" ? "❯_" : (stepId % 2 === 1 ? "⚛" : "❯_");

  const body = document.createElement("div");
  body.className = "ai-step-body";

  const title = document.createElement("div");
  title.className = "ai-step-title";
  title.textContent = step.title || "";

  const detail = document.createElement("div");
  detail.className = "ai-step-detail";
  detail.textContent = step.detail || "";
  detail.hidden = true;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ai-step-toggle";
  toggle.textContent = "⌄";
  toggle.setAttribute("aria-label", "展开/收起");
  toggle.addEventListener("click", event => {
    event.stopPropagation();
    item.classList.toggle("expanded");
    toggle.textContent = item.classList.contains("expanded") ? "⌃" : "⌄";
  });

  item.addEventListener("click", () => {
    item.classList.toggle("expanded");
    toggle.textContent = item.classList.contains("expanded") ? "⌃" : "⌄";
  });

  body.append(title, detail);
  item.append(icon, body, toggle);
  return item;
}

function renderAiSteps(steps, token = renderToken) {
  if (!aiWrapEl) return;
  aiWrapEl.hidden = false;
  aiStatusEl.textContent = "实时检测中";
  clearAiSteps();

  const list = steps || [];
  if (!list.length) {
    aiStatusEl.textContent = "分析完成";
    return;
  }

  let index = 0;
  const next = () => {
    if (isStale(token)) return;
    if (index >= list.length) {
      aiStatusEl.textContent = "分析完成";
      const items = aiStepsEl.querySelectorAll(".ai-step");
      items.forEach(item => item.classList.remove("active"));
      if (items.length) items[items.length - 1].classList.add("done");
      return;
    }
    const step = list[index++];
    appendAiStep(step);
    aiStatusEl.textContent = `检测中 ${index}/${list.length}`;
    stepChainTimer = setTimeout(next, 260);
  };
  next();
}

function appendAiStep(step) {
  if (!aiWrapEl) return;

  const placeholder = aiStepsEl.querySelector(".ai-think-placeholder");
  const thinkingLine = aiStepsEl.querySelector(".ai-thinking-line");
  if (thinkingLine) thinkingLine.remove();
  if (placeholder) placeholder.remove();

  const previousActive = aiStepsEl.querySelector(".ai-step.active");
  if (previousActive) {
    previousActive.classList.remove("active");
    previousActive.classList.add("done");
  }

  const item = createAiStepEl(step, "active");
  aiStepsEl.appendChild(item);

  while (aiStepsEl.children.length > 3) {
    aiStepsEl.firstElementChild?.remove();
  }

  aiStepsEl.scrollTop = aiStepsEl.scrollHeight;
}

async function runAiFromSnapshot(snapshot, token = renderToken) {
  if (!snapshot) return null;
  startThinkingAnimation();

  const moneyCheck = JINGYAN.checkMoneyText(snapshot.text || "");
  const features = globalThis.JINGYAN_FEATURES?.collect
    ? JINGYAN_FEATURES.collect({ url: snapshot.url || "", title: snapshot.title || "", text: snapshot.text || "" })
    : null;

  const result = await JINGYAN_AI.analyzeRisk(
    {
      url: snapshot.url || "",
      host: (() => { try { return new URL(snapshot.url).hostname.toLowerCase(); } catch { return ""; } })(),
      title: snapshot.title || "",
      text: snapshot.text || "",
      urlRisk: JINGYAN.checkUrl(snapshot.url || "").risky,
      moneyRisk: moneyCheck.risky,
      moneyKeyword: moneyCheck.keyword || "",
      moneyAmount: moneyCheck.amount || "",
      features
    },
    step => { if (!isStale(token)) appendAiStep(step); },
    chunk => { if (!isStale(token)) setThinkingLine(chunk, true); }
  );

  if (isStale(token)) return result;

  stopThinkingAnimation();
  const items = aiStepsEl.querySelectorAll(".ai-step");
  items.forEach(item => item.classList.remove("active"));
  if (items.length) items[items.length - 1].classList.add("done");
  aiStatusEl.textContent = "分析完成";
  return result;
}


function showAiAnalyzing() {
  if (!aiWrapEl) return;
  aiWrapEl.hidden = false;
  aiStatusEl.textContent = "AI 分析中";
  startThinkingAnimation();
}

async function render(forceAi = false) {
  const token = beginRender();

  const userHasToggled = await getUserToggled();
  if (isStale(token)) return;

  let enabled;
  if (userHasToggled) {
    enabled = await JINGYAN.getProtectionEnabled();
  } else {
    enabled = false;
    try { await setEnabled(false); } catch {}
  }
  if (isStale(token)) return;
  setToggle(enabled, "safe");

  const tab = await getCurrentTab();
  if (isStale(token)) return;

  if (!enabled) {
    stopThinkingAnimation();
    if (aiWrapEl) aiWrapEl.hidden = true;
    setToggle(enabled, 'safe');
    setResult("paused", "防护暂停", "防护已暂停", "开启后会继续检测当前页面和资金操作。", "", "已暂停");
    return;
  }

  if (!tab?.url) {
    setToggle(enabled, 'safe');
    setResult("info", "无法检测", "无法检测", "没有获取到当前页面信息。", "", "信息");
    return;
  }

  let pageRisk = null;
  let fromCache = false;

  if (JINGYAN.isInternalUrl(tab.url)) {
    const cached = tab.id ? await askLastResult(tab.id) : null;
    if (isStale(token)) return;
    if (cached?.result) {
      pageRisk = cached.result;
      fromCache = true;
      stopThinkingAnimation();
      if (aiWrapEl) aiWrapEl.hidden = true;
    } else {
      stopThinkingAnimation();
      if (aiWrapEl) aiWrapEl.hidden = true;
      setToggle(enabled, 'safe');
      setResult("info", "无需检测", "无需检测", "浏览器内部页面不会处理网页内容。", "", "内部页面");
      return;
    }
  }

  const urlCheck = fromCache ? { risky: false, severity: "" } : JINGYAN.checkUrl(tab.url);
  if (!fromCache) {
    if (tab.id) showAiAnalyzing();
    pageRisk = tab.id ? await askPage(tab.id, forceAi) : null;
    if (isStale(token)) return;
  }
  const moneyRisk = Boolean(pageRisk?.moneyRisk);

  if (!fromCache) {
    if (pageRisk?.aiResult?.steps?.length) {
      renderAiSteps(pageRisk.aiResult.steps, token);
    } else if (pageRisk) {
      stopThinkingAnimation();
      if (aiWrapEl) aiWrapEl.hidden = true;
    } else if (tab.id) {
      const snapshot = await askSnapshot(tab.id);
      if (isStale(token)) return;
      if (snapshot) {
        let useAi = true;
        try {
          useAi = await JINGYAN_AI.shouldAnalyze({
            urlCheck: JINGYAN.checkUrl(snapshot.url || ""),
            moneyCheck: JINGYAN.checkMoneyText(snapshot.text || "")
          });
        } catch {
          useAi = true;
        }
        if (isStale(token)) return;
        if (useAi) {
          const aiResult = await runAiFromSnapshot(snapshot, token);
          if (isStale(token)) return;
          if (aiResult) pageRisk = { ...(pageRisk || {}), level: aiResult.level, aiResult };
        } else if (aiWrapEl) {
          aiWrapEl.hidden = true;
        }
      } else if (aiWrapEl) {
        aiWrapEl.hidden = true;
      }
    } else if (aiWrapEl) {
      aiWrapEl.hidden = true;
    }
  } else {
    stopThinkingAnimation();
    if (aiWrapEl) aiWrapEl.hidden = true;
  }
  const riskLevel = pageRisk?.level || (urlCheck.risky ? (urlCheck.severity === "warn" ? "warn" : "danger") : moneyRisk ? "warn" : "safe");

  if (riskLevel === "danger") {
    setToggle(enabled, "danger");
    setResult(
      "danger",
      "高危风险",
      "高危诈骗网站警报",
      pageRisk?.aiResult?.summary || "仿冒正规金融机构，含虚假行情和诱导充值，属于高危仿冒网站。",
      "请勿充值、转账或输入验证码。请通过官方渠道核实。",
      "高危风险"
    );
    return;
  }

  if (riskLevel === "warn") {
    setToggle(enabled, "warn");
    setResult(
      "warn",
      "资金风险",
      "发现充值或付款风险",
      pageRisk?.aiResult?.summary || "页面包含充值金额、转账、支付等敏感资金操作。",
      buildMoneyDetail(pageRisk),
      "资金操作风险"
    );
    return;
  }

  setToggle(enabled, "safe");
  setResult("safe", "安全", "未发现明显风险", "仍建议不要在陌生网站提交敏感信息。", "", "安全");
}

toggleEl.addEventListener("click", async () => {
  const nextEnabled = !currentEnabled;
  setToggle(nextEnabled, "safe");
  setUserToggled(true);
  await setEnabled(nextEnabled);
  const tab = await getCurrentTab();
  notifyPage(tab?.id, nextEnabled);

  if (!nextEnabled) {
    beginRender();
    if (aiWrapEl) aiWrapEl.hidden = true;
    setResult("paused", "防护暂停", "防护已暂停", "开启后会继续检测当前页面和资金操作。", "", "已暂停");
    return;
  }

  setResult("checking", "开启中", "正在启动检测", "正在开启 AI 分析...", "", "开启中");
  render().catch(() => {});
});

aiReanalyzeEl?.addEventListener("click", async () => {
  const tab = await getCurrentTab();
  if (!tab?.id) return;
  await render(true);
});

document.getElementById("ai-settings")?.addEventListener("click", event => {
  event.preventDefault();
  chrome.runtime.openOptionsPage?.();
});

document.getElementById("top-settings")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage?.();
});

document.addEventListener("DOMContentLoaded", () => render());





