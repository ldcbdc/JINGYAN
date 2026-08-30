//

(function () {
  const STORAGE_KEYS = {
    apiKey: "jingyanAiApiKey",
    apiUrl: "jingyanAiApiUrl",
    model: "jingyanAiModel",
    alwaysAnalyze: "jingyanAiAlwaysAnalyze",
    localApiUrl: "jingyanAiLocalApiUrl",
    localModel: "jingyanAiLocalModel",
    localApiKey: "jingyanAiLocalApiKey",
    localFallback: "jingyanAiLocalFallback",
    providerMode: "jingyanAiProviderMode"
  };

  const DEFAULT_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  const DEFAULT_MODEL = "glm-5.3-flash";
  const DEFAULT_LOCAL_API_URL = "http://127.0.0.1:11434/v1/chat/completions";
  const DEFAULT_LOCAL_MODEL = "qwen2.5:7b";
  const DEFAULT_PROVIDER_MODE = "auto";
  const STREAM_MARKER = "<<<JSON>>>";
  const API_TIMEOUT = 25000;

  const SYSTEM_PROMPT = `你是一名专业的反诈安全分析专家，正在实时分析用户当前访问的网页。
请像真人专家一样，先输出你的逐步推理过程，再输出最终 JSON 结论。

推理过程要求：
1. 从网页特征数据中挑选真正的风险点，说明“检查了什么特征、这个特征为什么可疑或安全”；
2. 至少分析：网址/域名特征、页面结构特征、文本话术与资金风险特征；
3. 用“步骤1：”“步骤2：”开头，每步控制在 1-3 句话；
4. 如果特征数据显示安全，不要强行制造风险。

评分标准（score 为 0-100 整数，必须严格遵守）：
- 0-39 安全：官方或知名域名、正常业务页面。页面出现“充值/支付/转账”等词汇且域名可信时属于正常业务场景，不得因此给高分。
- 40-69 可疑：出现单一风险信号，如高风险顶级域名、IP 直连访问、诱导/紧急话术、收集账号密码，或资金话术密集但域名无明显仿冒特征。
- 70-100 高危：多重独立风险信号叠加，例如“品牌仿冒域名 + 资金话术 + 收集账号密码/验证码”的组合。

评分纪律：
1. 单一弱信号不得给到 70 分以上；
2. 给到 70 分以上时，reasons 必须同时引用至少两类特征字段（如 url.brandMismatches、page.hasPasswordInput、text.urgentHits），不得只凭话术定罪；
3. 特征显示域名与品牌官方域名匹配（isOfficialBrand=true）且无其他强风险信号时，按安全处理；
4. 不要编造特征数据里不存在的事实。

输出格式：
步骤1：...
步骤2：...
...
${STREAM_MARKER}
{
  "score": 0到100之间的整数,
  "summary": "一句话总结",
  "steps": [
    {
      "title": "步骤名称",
      "detail": "这一步的分析过程和判断依据",
      "risk": "high" 或 "medium" 或 "low"
    }
  ],
  "reasons": ["判断理由1", "判断理由2"],
  "suggestion": "给用户的最终安全建议"
}

注意：
1. steps 数组必须和你前面输出的推理步骤一致；
2. 档位（safe/warn/danger）由系统根据 score 统一换算，不需要输出 level 字段；
3. 没有风险时 score 要低。`;

  let configCache = null;
  let configPromise = null;

  function getStorage(key, defaultValue) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get({ [key]: defaultValue }, result => {
          resolve(result?.[key] ?? defaultValue);
        });
      } catch {
        resolve(defaultValue);
      }
    });
  }

  async function readConfig() {
    const [apiKey, apiUrl, model, alwaysAnalyze, localApiUrl, localModel, localApiKey, localFallback, providerMode] = await Promise.all([
      getStorage(STORAGE_KEYS.apiKey, ""),
      getStorage(STORAGE_KEYS.apiUrl, DEFAULT_API_URL),
      getStorage(STORAGE_KEYS.model, DEFAULT_MODEL),
      getStorage(STORAGE_KEYS.alwaysAnalyze, true),
      getStorage(STORAGE_KEYS.localApiUrl, ""),
      getStorage(STORAGE_KEYS.localModel, ""),
      getStorage(STORAGE_KEYS.localApiKey, ""),
      getStorage(STORAGE_KEYS.localFallback, true),
      getStorage(STORAGE_KEYS.providerMode, DEFAULT_PROVIDER_MODE)
    ]);
    const mode = String(providerMode || DEFAULT_PROVIDER_MODE).trim().toLowerCase();
    return {
      apiKey: String(apiKey || "").trim(),
      apiUrl: String(apiUrl || DEFAULT_API_URL).trim(),
      model: String(model || DEFAULT_MODEL).trim(),
      alwaysAnalyze: alwaysAnalyze !== false,
      localApiUrl: String(localApiUrl || "").trim(),
      localModel: String(localModel || "").trim(),
      localApiKey: String(localApiKey || "").trim(),
      localFallback: localFallback !== false,
      providerMode: ["auto", "cloud", "local"].includes(mode) ? mode : DEFAULT_PROVIDER_MODE
    };
  }

  function getConfig() {
    if (configCache) return Promise.resolve(configCache);
    if (!configPromise) {
      configPromise = readConfig().then(cfg => {
        configCache = cfg;
        configPromise = null;
        return cfg;
      });
    }
    return configPromise;
  }

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      const touched = Object.values(STORAGE_KEYS).some(key => key in changes);
      if (touched) { configCache = null; configPromise = null; }
    });
  } catch {
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function buildPrompt(input) {
    const lines = [];
    lines.push("【当前网址】");
    lines.push(input.url || "");
    lines.push("");
    lines.push("【域名】");
    lines.push(input.host || "");
    lines.push("");
    lines.push("【页面标题】");
    lines.push(input.title || "");
    lines.push("");
    lines.push("【实时网页特征（结构化数据）】");
    lines.push(JSON.stringify(input.features || {}, null, 2));
    lines.push("");
    lines.push("【本地规则引擎命中】");
    lines.push(JSON.stringify({
      urlRisk: Boolean(input.urlRisk),
      moneyRisk: Boolean(input.moneyRisk),
      moneyKeyword: input.moneyKeyword || "",
      moneyAmount: input.moneyAmount || ""
    }));
    lines.push("");
    lines.push("【页面文本摘要】");
    lines.push(String(input.text || "").replace(/\s+/g, " ").slice(0, 12000));
    return lines.join("\n");
  }

  function sliceBalancedJson(text, from = 0) {
    const start = text.indexOf("{", from);
    if (start < 0) return "";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return "";
  }

  function extractJson(text) {
    const source = String(text || "");
    const markerIndex = source.lastIndexOf(STREAM_MARKER);
    const from = markerIndex >= 0 ? markerIndex + STREAM_MARKER.length : 0;
    const candidate = sliceBalancedJson(source, from) || sliceBalancedJson(source, 0);
    return candidate ? JSON.parse(candidate) : {};
  }

  function extractThinking(text) {
    const source = String(text || "");
    const markerIndex = source.lastIndexOf(STREAM_MARKER);
    if (markerIndex >= 0) return source.slice(0, markerIndex).trim();
    return "";
  }

  function parseAiResponse(data) {
    const message = data?.choices?.[0]?.message || {};
    const content = message.content ?? data?.message?.content ?? data?.content ?? data;
    const reasoning = String(message.reasoning_content || "");
    const text = typeof content === "string" && content ? content : JSON.stringify(content ?? "");
    let obj = {};
    try {
      obj = extractJson(text);
    } catch {
      obj = {};
    }
    return normalizeResult(obj, extractThinking(text) || reasoning);
  }

  function normalizeResult(obj, thinking) {
    let steps = Array.isArray(obj.steps)
      ? obj.steps.map((step, index) => ({
          id: index + 1,
          title: String(step.title || `分析步骤 ${index + 1}`),
          detail: String(step.detail || ""),
          risk: ["high", "medium", "low"].includes(step.risk) ? step.risk : "medium"
        }))
      : [];

    if (!steps.length && thinking) {
      steps = thinking
        .split(/\n+/)
        .map(line => line.trim())
        .filter(line => /^步骤\s*\d+/.test(line))
        .map((line, index) => {
          const cleaned = line.replace(/^步骤\s*\d+\s*[:：、.\-]?\s*/, "");
          const title = cleaned.split(/[：:，,。]/)[0]?.trim() || `分析步骤 ${index + 1}`;
          return {
            id: index + 1,
            title: title.slice(0, 40),
            detail: cleaned.slice(0, 400),
            risk: "medium"
          };
        });
    }

    const reasons = Array.isArray(obj.reasons)
      ? obj.reasons.map(String)
      : (steps.length ? steps.filter(s => s.risk === "high").map(s => s.detail).slice(0, 4) : []);

    const score = Math.max(0, Math.min(100, Math.round(Number(obj.score) || 0)));

    const level = score >= RISK_SCORE_DANGER ? "danger" : score >= RISK_SCORE_WARN ? "warn" : "safe";

    return {
      score,
      level,
      summary: String(obj.summary || ""),
      steps,
      reasons,
      suggestion: String(obj.suggestion || ""),
      thinking: String(thinking || "")
    };
  }

  function buildLocalSteps(input) {
    const steps = [];
    const host = String(input.host || input.url || "");
    const urlRisk = Boolean(input.urlRisk);
    const moneyRisk = Boolean(input.moneyRisk);
    const moneyKeyword = String(input.moneyKeyword || "");
    const moneyAmount = String(input.moneyAmount || "");
    const urlF = input.features?.url || {};
    const pageF = input.features?.page || {};
    const textF = input.features?.text || {};

    let urlRiskLevel = "low";
    let urlDetail = "域名结构正常，未发现明显仿冒特征。";
    const urlAlerts = [];
    if (urlRisk) urlAlerts.push("命中仿冒网站黑名单");
    if (urlF.isIp) urlAlerts.push("使用 IP 地址访问");
    if (urlF.isPunycode) urlAlerts.push("使用 Punycode 国际化域名");
    if (urlF.riskyTld) urlAlerts.push("使用高风险顶级域名 ." + (urlF.riskyTldName || "unknown"));
    if (urlF.hasOddPort) urlAlerts.push("使用非常规端口 " + (urlF.port || ""));
    if (urlF.brandMismatchCount) urlAlerts.push("域名包含品牌词但非官方域名：" + urlF.brandMismatches.join("、"));
    if (urlAlerts.length) {
      urlRiskLevel = urlRisk ? "high" : "medium";
      urlDetail = urlAlerts.join("；") + "。";
    } else if (urlF.isOfficialBrand) {
      urlDetail = "域名与官方品牌域名匹配：" + urlF.brandOfficialHits.join("、") + "，未发现仿冒特征。";
    }
    steps.push({ title: `网址特征分析 · ${host || "未知域名"}`, detail: urlDetail, risk: urlRiskLevel });

    let pageRiskLevel = "low";
    let pageDetail = "页面结构正常，未发现高危表单或二维码。";
    const pageAlerts = [];
    if (pageF.externalFormAction) pageAlerts.push("表单提交到外部域名");
    if (pageF.hasPasswordInput) pageAlerts.push("页面包含密码输入框");
    if (pageF.qrCodeCount > 0) pageAlerts.push(`检测到 ${pageF.qrCodeCount} 个二维码/收款码图片`);
    if (pageF.iframeCount > 0) pageAlerts.push(`嵌入 ${pageF.iframeCount} 个 iframe`);
    if (pageF.externalLinkCount > 3) pageAlerts.push(`存在 ${pageF.externalLinkCount} 个外部链接`);
    if (pageAlerts.length) {
      pageRiskLevel = (pageF.externalFormAction && pageF.hasPasswordInput) ? "high" : "medium";
      pageDetail = pageAlerts.join("；") + "。";
    }
    steps.push({ title: "页面结构分析", detail: pageDetail, risk: pageRiskLevel });

    let moneyRiskLevel = "low";
    let moneyDetail = "未发现明显的充值、转账、付款等资金操作。";
    const textAlerts = [];
    if (moneyRisk) {
      moneyRiskLevel = "high";
      textAlerts.push(`检测到资金敏感词“${moneyKeyword || "充值/转账/支付"}”${moneyAmount ? `，并出现金额“${moneyAmount}”` : ""}`);
    } else if (textF.hasMoney && textF.hasAmount) {
      moneyRiskLevel = "medium";
      textAlerts.push("页面出现资金类词汇和金额，但本地规则尚未形成完整风险闭环");
    }
    if (textF.urgentHits?.length) {
      moneyRiskLevel = moneyRiskLevel === "low" ? "medium" : moneyRiskLevel;
      textAlerts.push("出现诱导/紧急话术：" + textF.urgentHits.slice(0, 5).join("、"));
    }
    if (textF.contactHits?.length) {
      textAlerts.push("出现客服/社交联系渠道：" + textF.contactHits.slice(0, 5).join("、"));
    }
    if (textF.hasCountdown) {
      moneyRiskLevel = moneyRiskLevel === "low" ? "medium" : moneyRiskLevel;
      textAlerts.push("出现倒计时/限时话术");
    }
    if (textAlerts.length) moneyDetail = textAlerts.join("；") + "。";
    steps.push({ title: "文本话术与资金风险分析", detail: moneyDetail, risk: moneyRiskLevel });

    const highCount = steps.filter(s => s.risk === "high").length;
    const mediumCount = steps.filter(s => s.risk === "medium").length;
    let finalLevel = "low";
    let finalDetail = "综合来看，当前页面未发现明显诈骗特征。";
    if (highCount >= 2 || (highCount >= 1 && mediumCount >= 2)) {
      finalLevel = "high";
      finalDetail = "网址、页面结构、资金话术等多重风险叠加，高度疑似诈骗/仿冒网站。";
    } else if (highCount === 1 || mediumCount >= 2) {
      finalLevel = "medium";
      finalDetail = "页面存在可疑特征，建议用户进一步核实后再操作。";
    }
    steps.push({ title: "综合风险研判", detail: finalDetail, risk: finalLevel });

    return steps;
  }

  const STEP_INTERVAL = 300;

  async function simulateAnalysis(input, onStep, onThinking) {
    const steps = buildLocalSteps(input).map((step, index) => ({ ...step, id: index + 1 }));
    const highCount = steps.filter(s => s.risk === "high").length;
    const mediumCount = steps.filter(s => s.risk === "medium").length;
    const score = Math.min(
      100,
      highCount * 25 +
      mediumCount * 10 +
      (input.urlRisk ? 15 : 0) +
      (input.moneyRisk ? 10 : 0)
    );
    const level = score >= RISK_SCORE_DANGER ? "danger" : score >= RISK_SCORE_WARN ? "warn" : "safe";
    const result = {
      score,
      level,
      summary: level === "danger"
        ? "检测到明显诈骗特征"
        : level === "warn"
          ? "页面存在一定风险，请谨慎操作"
          : "未发现明显风险",
      steps,
      reasons: steps
        .filter(s => s.risk === "high" || s.risk === "medium")
        .map(s => s.detail),
      suggestion: level === "danger"
        ? "请立即停止操作，不要输入账号、密码、验证码，也不要转账或付款。"
        : level === "warn"
          ? "请先核对网站域名、收款方和金额，确认无误后再继续。"
          : "当前页面未发现明显风险，仍建议不要在陌生网站提交敏感信息。",
      thinking: steps.map(s => `步骤${s.id}：${s.title}——${s.detail}`).join("\n")
    };

    if (onThinking || onStep) {
      for (const step of result.steps) {
        await sleep(STEP_INTERVAL);
        if (onThinking) {
          try { onThinking(`步骤${step.id}：${step.title}——${step.detail}`); } catch {}
        }
        if (onStep) {
          try { onStep(step); } catch {}
        }
      }
    }
    return result;
  }

  function createStreamEmitter(onThinking) {
    if (!onThinking) return { push() {}, flush() {} };
    let buffer = "";
    let timer = setInterval(() => {
      if (buffer) {
        const chunk = buffer;
        buffer = "";
        try { onThinking(chunk); } catch {}
      }
    }, 120);
    return {
      push(delta) { buffer += delta; },
      flush() {
        if (timer) { clearInterval(timer); timer = null; }
        if (buffer) { const chunk = buffer; buffer = ""; try { onThinking(chunk); } catch {} }
      }
    };
  }

  function parseSseLine(line, onDelta) {
    if (!line || line.startsWith(":")) return "";
    if (!line.startsWith("data:")) return "";
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return "";
    try {
      const json = JSON.parse(payload);
      const choice = json.choices?.[0] || {};
      const delta = choice.delta?.content || json.content || "";
      if (delta) { onDelta(delta); return delta; }
      const reasoning = choice.delta?.reasoning_content || choice.message?.reasoning_content || "";
      if (reasoning) { onDelta(reasoning); }
    } catch {
    }
    return "";
  }

  async function readStream(response, onDelta, parseLine = parseSseLine) {
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      let full = "";
      if (text) {
        const lines = text.split(/\r?\n/);
        for (const rawLine of lines) {
          full += parseLine(rawLine.trim(), onDelta);
        }
      }
      return full || text;
    }

    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let full = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const rawLine of lines) {
          full += parseLine(rawLine.trim(), onDelta);
        }
      }
      if (buffer.trim()) full += parseLine(buffer.trim(), onDelta);
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    return full;
  }

  async function callOpenAICompatible(input, onStep, onThinking, endpoint, signal) {
    const headers = { "Content-Type": "application/json" };
    if (endpoint.apiKey) {
      headers["Authorization"] = "Bearer " + endpoint.apiKey;
    }

    const body = {
      model: endpoint.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(input) }
      ],
      temperature: 0.1,
      stream: true
    };
    if (/bigmodel\.cn/i.test(endpoint.apiUrl)) {
      body.thinking = { type: "disabled" };
    }

    const response = await fetch(endpoint.apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      throw new Error("AI API HTTP " + response.status);
    }

    const contentType = String(response.headers.get("content-type") || "");
    let result;
    if (contentType.includes("text/event-stream")) {
      const emitter = createStreamEmitter(onThinking);
      let rawText = "";
      try {
        rawText = await readStream(response, delta => emitter.push(delta));
      } finally {
        emitter.flush();
      }
      result = parseAiResponse(rawText);
    } else {
      const data = await response.json();
      result = parseAiResponse(data);
    }

    await playSteps(result, onStep);

    return result;
  }

  async function playSteps(result, onStep) {
    if (onStep && result.steps.length) {
      for (const step of result.steps) {
        await sleep(STEP_INTERVAL);
        try { onStep(step); } catch {}
      }
    }
  }

  // ──────────────────────────────────────────
  // ──────────────────────────────────────────

  function detectApiProtocol(url) {
    const u = String(url || "");
    if (/generativelanguage\.googleapis\.com|streamGenerateContent|generateContent/i.test(u)) return "gemini";
    if (/anthropic|\/v1\/messages/i.test(u)) return "anthropic";
    return "openai";
  }


  function buildAnthropicUrl(url) {
    const u = String(url || "").replace(/\/+$/, "");
    return /\/v1\/messages$/.test(u) ? u : u + "/v1/messages";
  }

  function parseAnthropicSseLine(line, onDelta) {
    if (!line || !line.startsWith("data:")) return "";
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return "";
    try {
      const json = JSON.parse(payload);
      if (json.type === "content_block_delta") {
        const d = json.delta || {};
        if (d.type === "text_delta" && d.text) { onDelta(d.text); return d.text; }
        if (d.type === "thinking_delta" && d.thinking) onDelta(d.thinking);
      }
    } catch {
    }
    return "";
  }

  function parseAnthropicResponse(data) {
    const blocks = Array.isArray(data?.content) ? data.content : [];
    let text = "";
    let thinking = "";
    for (const block of blocks) {
      if (block?.type === "text") text += block.text || "";
      else if (block?.type === "thinking") thinking += block.thinking || "";
    }
    let obj = {};
    try { obj = extractJson(text); } catch { obj = {}; }
    return normalizeResult(obj, extractThinking(text) || thinking);
  }

  async function callAnthropic(input, onStep, onThinking, endpoint, signal) {
    const headers = { "content-type": "application/json" };
    if (endpoint.apiKey) {
      headers["x-api-key"] = endpoint.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    }

    const response = await fetch(buildAnthropicUrl(endpoint.apiUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: endpoint.model,
        max_tokens: 2048,
        temperature: 0.1,
        system: SYSTEM_PROMPT,
        stream: true,
        messages: [{ role: "user", content: buildPrompt(input) }]
      }),
      signal
    });

    if (!response.ok) {
      throw new Error("AI API HTTP " + response.status);
    }

    const contentType = String(response.headers.get("content-type") || "");
    let result;
    if (contentType.includes("text/event-stream")) {
      const emitter = createStreamEmitter(onThinking);
      let rawText = "";
      try {
        rawText = await readStream(response, delta => emitter.push(delta), parseAnthropicSseLine);
      } finally {
        emitter.flush();
      }
      result = parseAiResponse(rawText);
    } else {
      result = parseAnthropicResponse(await response.json());
    }

    await playSteps(result, onStep);
    return result;
  }


  function buildGeminiUrl(url, model) {
    const u = String(url || "").trim();
    if (/:(streamGenerateContent|generateContent)/i.test(u)) {
      let out = u.replace(/\/models\/[^:/:]+:/i, "/models/" + encodeURIComponent(model) + ":");
      if (/streamGenerateContent/i.test(out) && !/alt=sse/i.test(out)) {
        out += out.includes("?") ? "&alt=sse" : "?alt=sse";
      }
      return out;
    }
    const base = u.replace(/\/+$/, "") || "https://generativelanguage.googleapis.com";
    const versioned = /\/v1[a-z]*$/.test(base) ? base : base + "/v1beta";
    return versioned + "/models/" + encodeURIComponent(model) + ":streamGenerateContent?alt=sse";
  }

  function parseGeminiSseLine(line, onDelta) {
    if (!line || !line.startsWith("data:")) return "";
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return "";
    try {
      const json = JSON.parse(payload);
      let full = "";
      for (const part of json.candidates?.[0]?.content?.parts || []) {
        if (typeof part?.text !== "string" || !part.text) continue;
        if (part.thought) { onDelta(part.text); continue; }
        onDelta(part.text);
        full += part.text;
      }
      return full;
    } catch {
      return "";
    }
  }

  function parseGeminiResponse(data) {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    let text = "";
    let thinking = "";
    for (const part of parts) {
      if (typeof part?.text !== "string" || !part.text) continue;
      if (part.thought) thinking += part.text;
      else text += part.text;
    }
    let obj = {};
    try { obj = extractJson(text); } catch { obj = {}; }
    return normalizeResult(obj, extractThinking(text) || thinking);
  }

  async function callGemini(input, onStep, onThinking, endpoint, signal) {
    const headers = { "Content-Type": "application/json" };
    if (endpoint.apiKey) {
      headers["x-goog-api-key"] = endpoint.apiKey;
    }

    const response = await fetch(buildGeminiUrl(endpoint.apiUrl, endpoint.model), {
      method: "POST",
      headers,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
        generationConfig: { temperature: 0.1 }
      }),
      signal
    });

    if (!response.ok) {
      throw new Error("AI API HTTP " + response.status);
    }

    const contentType = String(response.headers.get("content-type") || "");
    let result;
    if (contentType.includes("text/event-stream")) {
      const emitter = createStreamEmitter(onThinking);
      let rawText = "";
      try {
        rawText = await readStream(response, delta => emitter.push(delta), parseGeminiSseLine);
      } finally {
        emitter.flush();
      }
      result = parseAiResponse(rawText);
    } else {
      result = parseGeminiResponse(await response.json());
    }

    await playSteps(result, onStep);
    return result;
  }

  async function callProvider(input, onStep, onThinking, endpoint, signal) {
    const protocol = endpoint.protocol || detectApiProtocol(endpoint.apiUrl);
    if (protocol === "anthropic") return callAnthropic(input, onStep, onThinking, endpoint, signal);
    if (protocol === "gemini") return callGemini(input, onStep, onThinking, endpoint, signal);
    return callOpenAICompatible(input, onStep, onThinking, endpoint, signal);
  }

  function callRemote(input, onStep, onThinking, config, signal) {
    return callProvider(input, onStep, onThinking, {
      apiUrl: config.apiUrl,
      model: config.model,
      apiKey: config.apiKey
    }, signal);
  }

  function isOllamaNativeUrl(url) {
    return /\/api\/(chat|generate)\/?$/i.test(String(url || "").trim().replace(/\/+$/, ""));
  }

  function parseOllamaLine(line, onDelta) {
    if (!line) return "";
    try {
      const data = JSON.parse(line);
      const delta = data.message?.content || data.response || "";
      if (delta) { onDelta(delta); return delta; }
    } catch {
    }
    return "";
  }

  async function readOllamaStream(response, onDelta) {
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      let full = "";
      if (text) {
        const lines = text.split(/\r?\n/);
        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (trimmed) full += parseOllamaLine(trimmed, onDelta);
        }
      }
      return full || text;
    }

    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let full = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (trimmed) full += parseOllamaLine(trimmed, onDelta);
        }
      }
      if (buffer.trim()) full += parseOllamaLine(buffer.trim(), onDelta);
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    return full;
  }

  async function callLocalOllama(input, onStep, onThinking, config, signal) {
    const headers = { "Content-Type": "application/json" };
    if (config.localApiKey) {
      headers["Authorization"] = "Bearer " + config.localApiKey;
    }

    const response = await fetch(config.localApiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.localModel || DEFAULT_LOCAL_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(input) }
        ],
        stream: true
      }),
      signal
    });

    if (!response.ok) {
      throw new Error("Local AI API HTTP " + response.status);
    }

    const contentType = String(response.headers.get("content-type") || "");
    let result;
    if (contentType.includes("application/json") && !contentType.includes("ndjson") && !contentType.includes("event-stream")) {
      const data = await response.json();
      result = parseAiResponse(data);
    } else {
      const emitter = createStreamEmitter(onThinking);
      let rawText = "";
      try {
        rawText = await readOllamaStream(response, delta => emitter.push(delta));
      } finally {
        emitter.flush();
      }
      result = parseAiResponse(rawText);
    }

    if (onStep && result.steps.length) {
      for (const step of result.steps) {
        await sleep(STEP_INTERVAL);
        try { onStep(step); } catch {}
      }
    }

    return result;
  }

  async function callLocal(input, onStep, onThinking, config, signal) {
    if (!config.localApiUrl) {
      throw new Error("本地模型地址未配置");
    }

    if (isOllamaNativeUrl(config.localApiUrl)) {
      return callLocalOllama(input, onStep, onThinking, config, signal);
    }

    return callProvider(input, onStep, onThinking, {
      apiUrl: config.localApiUrl,
      model: config.localModel || DEFAULT_LOCAL_MODEL,
      apiKey: config.localApiKey || ""
    }, signal);
  }

  async function callWithTimeout(callFn) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
    try {
      return await callFn(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  const MODEL_PROVIDERS = {
    cloud: { name: "云端模型接口（协议自适应）", call: callRemote },
    local: { name: "本地模型", call: callLocal }
  };

  async function shouldAnalyze({ urlCheck, moneyCheck }) {
    if (urlCheck?.risky || moneyCheck?.risky) return true;
    const config = await getConfig();
    return config.alwaysAnalyze !== false;
  }

  async function analyzeRisk(input, onStep, onThinking) {
    const config = await getConfig();
    const cloudReady = Boolean(config.apiKey && config.apiUrl);
    const localReady = Boolean(config.localApiUrl && (config.localModel || DEFAULT_LOCAL_MODEL));
    const canFallbackLocal = config.localFallback && localReady;

    const runCloud = () => callWithTimeout(signal => MODEL_PROVIDERS.cloud.call(input, onStep, onThinking, config, signal));
    const runLocal = () => callWithTimeout(signal => MODEL_PROVIDERS.local.call(input, onStep, onThinking, config, signal));

    if (config.providerMode === "local") {
      if (localReady) {
        try {
          return await runLocal();
        } catch (err) {
          console.error("[JINGYAN] 本地 AI 调用失败，降级为本地规则模拟分析：", err);
        }
      }
      return simulateAnalysis(input, onStep, onThinking);
    }

    if (config.providerMode === "cloud") {
      if (cloudReady) {
        try {
          return await runCloud();
        } catch (err) {
          console.error("[JINGYAN] 云端 AI 调用失败，降级为本地规则模拟分析：", err);
        }
      }
      return simulateAnalysis(input, onStep, onThinking);
    }

    if (cloudReady) {
      try {
        return await runCloud();
      } catch (err) {
        console.error("[JINGYAN] 云端 AI 调用失败：", err);
        if (canFallbackLocal) {
          try {
            return await runLocal();
          } catch (localErr) {
            console.error("[JINGYAN] 本地 AI 调用失败，降级为本地规则模拟分析：", localErr);
          }
        }
        return simulateAnalysis(input, onStep, onThinking);
      }
    }

    if (config.providerMode === "auto" && canFallbackLocal) {
      try {
        return await runLocal();
      } catch (err) {
        console.error("[JINGYAN] 本地 AI 调用失败，降级为本地规则模拟分析：", err);
      }
    }

    return simulateAnalysis(input, onStep, onThinking);
  }

  const fullApi = {
    analyzeRisk,
    shouldAnalyze,
    getConfig,
    buildPrompt,
    parseAiResponse,
    simulateAnalysis,
    callRemote,
    callLocal,
    callLocalOllama,
    callOpenAICompatible,
    callProvider,
    callAnthropic,
    callGemini,
    parseAnthropicSseLine,
    parseAnthropicResponse,
    parseGeminiSseLine,
    parseGeminiResponse,
    detectApiProtocol,
    buildAnthropicUrl,
    buildGeminiUrl,
    isOllamaNativeUrl,
    MODEL_PROVIDERS,
    providers: MODEL_PROVIDERS,
    DEFAULT_API_URL,
    DEFAULT_MODEL,
    DEFAULT_LOCAL_API_URL,
    DEFAULT_LOCAL_MODEL,
    DEFAULT_PROVIDER_MODE,
    STORAGE_KEYS
  };


  // 1. background / service worker
  if (typeof window === "undefined") {
    globalThis.JINGYAN_AI = fullApi;

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type === "JINGYAN_AI_SHOULD_ANALYZE") {
        shouldAnalyze(message.payload || {})
          .then(use => sendResponse({ ok: true, use }))
          .catch(() => sendResponse({ ok: true, use: true }));
        return true;
      }

      if (message?.type === "JINGYAN_AI_ANALYZE") {
        const payload = message.payload || {};
        const requestId = message.requestId || "";
        const tabId = sender.tab?.id;
        const sendStep = (step) => {
          if (!tabId) return;
          try {
            chrome.tabs.sendMessage(tabId, {
              type: "JINGYAN_AI_STEP",
              step,
              requestId
            }, () => void chrome.runtime.lastError);
          } catch {}
        };
        analyzeRisk(
          payload,
          step => sendStep(step),
          chunk => sendStep({ streaming: true, chunk })
        )
          .then(result => sendResponse({ ok: true, result }))
          .catch(err => sendResponse({ ok: false, error: String(err) }));
        return true;
      }
    });
    return;
  }

  if (location.protocol === "chrome-extension:") {
    globalThis.JINGYAN_AI = fullApi;
    return;
  }

  const PROXY_TIMEOUT = API_TIMEOUT + 5000;
  let requestSeq = 0;

  globalThis.JINGYAN_AI = {
    analyzeRisk(input, onStep, onThinking) {
      return new Promise((resolve, reject) => {
        const requestId = `${Date.now()}-${++requestSeq}`;
        let settled = false;

        const listener = (message) => {
          if (!message || message.type !== "JINGYAN_AI_STEP" || message.requestId !== requestId) return;
          if (message.step?.streaming) {
            try { onThinking?.(message.step.chunk || ""); } catch {}
          } else {
            try { onStep?.(message.step); } catch {}
          }
        };

        const cleanup = () => {
          if (settled) return true;
          settled = true;
          clearTimeout(timeoutId);
          try { chrome.runtime.onMessage.removeListener(listener); } catch {}
          return false;
        };

        const timeoutId = setTimeout(() => {
          if (cleanup()) return;
          reject(new Error("AI analyze timeout"));
        }, PROXY_TIMEOUT);

        try {
          chrome.runtime.onMessage.addListener(listener);
          chrome.runtime.sendMessage(
            { type: "JINGYAN_AI_ANALYZE", payload: input, requestId },
            response => {
              if (cleanup()) return;
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (response?.ok) {
                resolve(response.result);
              } else {
                reject(new Error(response?.error || "AI analyze failed"));
              }
            }
          );
        } catch (err) {
          cleanup();
          reject(err);
        }
      });
    },

    shouldAnalyze(payload) {
      if (payload?.urlCheck?.risky || payload?.moneyCheck?.risky) return Promise.resolve(true);

      return new Promise(resolve => {
        let settled = false;
        const done = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve(value);
        };
        const timeoutId = setTimeout(() => done(true), 3000);

        try {
          chrome.runtime.sendMessage(
            { type: "JINGYAN_AI_SHOULD_ANALYZE", payload: payload || {} },
            response => {
              if (chrome.runtime.lastError || !response?.ok) done(true);
              else done(response.use);
            }
          );
        } catch {
          done(true);
        }
      });
    }
  };
})();
