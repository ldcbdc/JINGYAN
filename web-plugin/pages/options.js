const STORAGE_KEYS = {
  apiKey: "jingyanAiApiKey",
  apiUrl: "jingyanAiApiUrl",
  model: "jingyanAiModel",
  alwaysAnalyze: "jingyanAiAlwaysAnalyze",
  localApiUrl: "jingyanAiLocalApiUrl",
  localModel: "jingyanAiLocalModel",
  localApiKey: "jingyanAiLocalApiKey",
  localFallback: "jingyanAiLocalFallback",
  providerMode: "jingyanAiProviderMode",
  vtApiKey: "jingyanVtApiKey"
};

const DEFAULT_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_LOCAL_MODEL = "qwen2.5:7b";
const DEFAULT_PROVIDER_MODE = "auto";

const apiKeyEl = document.getElementById("api-key");
const apiUrlEl = document.getElementById("api-url");
const modelEl = document.getElementById("model");
const alwaysEl = document.getElementById("always-analyze");
const localApiUrlEl = document.getElementById("local-api-url");
const localModelEl = document.getElementById("local-model");
const localApiKeyEl = document.getElementById("local-api-key");
const localFallbackEl = document.getElementById("local-fallback");
const providerModeEl = document.getElementById("provider-mode");
const vtApiKeyEl = document.getElementById("vt-api-key");
const msgEl = document.getElementById("msg");

function load() {
  chrome.storage.local.get(
    {
      [STORAGE_KEYS.apiKey]: "",
      [STORAGE_KEYS.apiUrl]: DEFAULT_API_URL,
      [STORAGE_KEYS.model]: DEFAULT_MODEL,
      [STORAGE_KEYS.alwaysAnalyze]: true,
      [STORAGE_KEYS.localApiUrl]: "",
      [STORAGE_KEYS.localModel]: "",
      [STORAGE_KEYS.localApiKey]: "",
      [STORAGE_KEYS.localFallback]: true,
      [STORAGE_KEYS.providerMode]: DEFAULT_PROVIDER_MODE,
      [STORAGE_KEYS.vtApiKey]: ""
    },
    result => {
      apiKeyEl.value = result[STORAGE_KEYS.apiKey] || "";
      apiUrlEl.value = result[STORAGE_KEYS.apiUrl] || DEFAULT_API_URL;
      modelEl.value = result[STORAGE_KEYS.model] || DEFAULT_MODEL;
      alwaysEl.checked = result[STORAGE_KEYS.alwaysAnalyze] !== false;
      localApiUrlEl.value = result[STORAGE_KEYS.localApiUrl] || "";
      localModelEl.value = result[STORAGE_KEYS.localModel] || "";
      localApiKeyEl.value = result[STORAGE_KEYS.localApiKey] || "";
      localFallbackEl.checked = result[STORAGE_KEYS.localFallback] !== false;
      providerModeEl.value = ["auto", "cloud", "local"].includes(result[STORAGE_KEYS.providerMode])
        ? result[STORAGE_KEYS.providerMode]
        : DEFAULT_PROVIDER_MODE;
      vtApiKeyEl.value = result[STORAGE_KEYS.vtApiKey] || "";
    }
  );
}

function save() {
  chrome.storage.local.set(
    {
      [STORAGE_KEYS.apiKey]: apiKeyEl.value.trim(),
      [STORAGE_KEYS.apiUrl]: apiUrlEl.value.trim() || DEFAULT_API_URL,
      [STORAGE_KEYS.model]: modelEl.value.trim() || DEFAULT_MODEL,
      [STORAGE_KEYS.alwaysAnalyze]: alwaysEl.checked,
      [STORAGE_KEYS.localApiUrl]: localApiUrlEl.value.trim(),
      [STORAGE_KEYS.localModel]: localModelEl.value.trim(),
      [STORAGE_KEYS.localApiKey]: localApiKeyEl.value.trim(),
      [STORAGE_KEYS.localFallback]: localFallbackEl.checked,
      [STORAGE_KEYS.providerMode]: providerModeEl.value || DEFAULT_PROVIDER_MODE,
      [STORAGE_KEYS.vtApiKey]: vtApiKeyEl.value.trim()
    },
    () => {
      msgEl.textContent = "✅ 已保存，重新打开插件弹窗即可生效。";
      setTimeout(() => { msgEl.textContent = ""; }, 2500);
    }
  );
}

async function testApi() {
  const apiUrl = apiUrlEl.value.trim() || DEFAULT_API_URL;
  const apiKey = apiKeyEl.value.trim();
  const model = modelEl.value.trim() || DEFAULT_MODEL;
  if (!apiKey) {
    msgEl.textContent = "⚠ 请先填写 API Key。";
    setTimeout(() => { msgEl.textContent = ""; }, 2500);
    return;
  }
  msgEl.textContent = "⏳ 正在测试连接...";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "只回复：OK" }],
        temperature: 0,
        max_tokens: 5,
        stream: false
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) {
      msgEl.textContent = "❌ 连接失败：HTTP " + response.status;
    } else {
      const data = await response.json();
      msgEl.textContent = "✅ 连接成功，模型 " + model + " 已就绪。";
    }
  } catch (err) {
    msgEl.textContent = "❌ 连接失败：" + (err?.message || String(err));
  }
  setTimeout(() => { msgEl.textContent = ""; }, 4000);
}

async function testLocalApi() {
  const localUrl = localApiUrlEl.value.trim();
  if (!localUrl) {
    msgEl.textContent = "⚠ 请先填写本地模型地址。";
    setTimeout(() => { msgEl.textContent = ""; }, 2500);
    return;
  }

  const localModel = localModelEl.value.trim() || DEFAULT_LOCAL_MODEL;
  const localKey = localApiKeyEl.value.trim();
  const isOllamaNative = /\/api\/(chat|generate)\/?$/i.test(localUrl);
  const headers = { "Content-Type": "application/json" };
  let body;

  if (isOllamaNative) {
    body = {
      model: localModel,
      messages: [{ role: "user", content: "只回复：OK" }],
      stream: false
    };
  } else {
    if (localKey) headers["Authorization"] = "Bearer " + localKey;
    body = {
      model: localModel,
      messages: [{ role: "user", content: "只回复：OK" }],
      temperature: 0,
      max_tokens: 5,
      stream: false
    };
  }

  msgEl.textContent = "⏳ 正在测试本地模型...";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(localUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) {
      msgEl.textContent = "❌ 本地连接失败：HTTP " + response.status;
    } else {
      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content || data?.message?.content || data?.response || "";
      msgEl.textContent = "✅ 本地连接成功，模型 " + localModel + " 已就绪。" + (reply ? " 返回：" + String(reply).slice(0, 20) : "");
    }
  } catch (err) {
    msgEl.textContent = "❌ 本地连接失败：" + (err?.message || String(err));
  }
  setTimeout(() => { msgEl.textContent = ""; }, 4000);
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("test").addEventListener("click", testApi);
document.getElementById("test-local").addEventListener("click", testLocalApi);
document.addEventListener("DOMContentLoaded", load);