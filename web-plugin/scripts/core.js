globalThis.JINGYAN = (() => {
  const STORAGE_KEY = "jingyanProtectionEnabled";

  function checkUrl(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      const risky = RISK_HOSTS.some(item => host === item || host.endsWith("." + item));
      return risky ? { risky: true, type: "url", host } : { risky: false };
    } catch {
      return { risky: false };
    }
  }

  function checkMoneyText(text) {
    const source = String(text || "").slice(0, 50000);
    const hasMoney  = MONEY_RE.test(source);
    const hasAction = ACTION_RE.test(source);
    const hasAmount = AMOUNT_RE.test(source);
    return {
      risky: hasMoney && hasAction && hasAmount,
      keyword: (source.match(MONEY_RE) || [""])[0],
      amount:  (source.match(AMOUNT_RE) || [""])[0]
    };
  }

  const MAX_TEXT_LENGTH = 50000;

  let normalizeCacheKey = null;
  let normalizeCacheValue = "";

  function normalizeText(text) {
    const raw = String(text || "");
    if (raw === normalizeCacheKey) return normalizeCacheValue;
    if (raw === normalizeCacheValue) return raw;
    normalizeCacheKey = raw;
    normalizeCacheValue = raw.replace(/\s+/g, " ").slice(0, MAX_TEXT_LENGTH);
    return normalizeCacheValue;
  }

  function checkUrlFull(url) {
    if (!url || isInternalUrl(url)) return { risky: false };
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      if (isBlacklistedHost(host)) {
        return { risky: true, type: "url", host, reason: "命中仿冒网站黑名单", severity: "danger" };
      }
      if (typeof isTrustedHost === "function" && isTrustedHost(host)) {
        return { risky: false, trusted: true, host };
      }

      const warnings = [];
      const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
      const isIpv6 = host.includes(":") && /^[0-9a-f:]+$/i.test(host);
      if (isIpv4 || isIpv6) warnings.push("使用 IP 地址访问");
      if (host.startsWith("xn--")) warnings.push("使用 Punycode 国际化域名");
      if (typeof RISKY_TLD_RE !== "undefined" && RISKY_TLD_RE.test(host)) warnings.push("使用高风险顶级域名 ." + host.split(".").pop());
      if (u.port && !["80", "443"].includes(u.port)) warnings.push("使用非常规端口 " + u.port);
      if (warnings.length) return { risky: true, type: "url", host, reason: warnings.join("、"), severity: "warn" };

      return { risky: false };
    } catch {
      return { risky: false };
    }
  }

  function checkMoneyTextFull(text) {
    const source = normalizeText(text);
    const moneyHit = source.match(MONEY_RE);
    const actionHit = source.match(ACTION_RE);
    const amountHit = source.match(AMOUNT_RE);
    const amountText = amountHit?.[0]?.trim() || "";
    const amountValue = parseAmountValue(amountText);
    const nearAmount = Boolean(
      moneyHit && amountHit &&
      (Math.abs((moneyHit.index || 0) - (amountHit.index || 0)) <= 120 ||
       /金额|充值|支付|付款|转账|汇款|应付|实付|保证金|手续费/i.test(amountText))
    );
    const risky = Boolean(moneyHit && amountHit && nearAmount);
    return risky
      ? { risky: true, type: "money", keyword: moneyHit[0], action: actionHit?.[0] || "", amount: amountText, amountValue, largeAmount: amountValue >= LARGE_AMOUNT_THRESHOLD }
      : { risky: false, keyword: moneyHit?.[0] || "", action: actionHit?.[0] || "", amount: amountText, amountValue, largeAmount: false };
  }

  checkUrl = checkUrlFull;
  checkMoneyText = checkMoneyTextFull;

  function isInternalUrl(url) {
    return /^(chrome|edge|about|chrome-extension|moz-extension):/i.test(url || "");
  }

  function parseAmountValue(amountText) {
    const match = String(amountText || "").replace(/[,，]/g, "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  let enabledCache = null;
  let enabledCachePromise = null;

  function readProtectionEnabled(defaultValue) {
    return new Promise(resolve => {
      if (!globalThis.chrome?.storage?.local) { resolve(defaultValue); return; }
      chrome.storage.local.get({ [STORAGE_KEY]: defaultValue }, result => {
        resolve(result?.[STORAGE_KEY] !== false);
      });
    });
  }

  function getProtectionEnabled(defaultValue = false) {
    if (enabledCache !== null) return Promise.resolve(enabledCache);
    if (!enabledCachePromise) {
      enabledCachePromise = readProtectionEnabled(defaultValue).then(value => {
        enabledCache = value;
        enabledCachePromise = null;
        return value;
      });
    }
    return enabledCachePromise;
  }

  function invalidateProtectionCache(nextValue) {
    enabledCache = typeof nextValue === "boolean" ? nextValue : null;
    enabledCachePromise = null;
  }

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes[STORAGE_KEY]) {
        invalidateProtectionCache(changes[STORAGE_KEY].newValue !== false);
      }
    });
  } catch {
  }

  function mergeLevel(urlCheck, moneyCheck, aiResult, hardSignals = {}) {
    if (urlCheck.trusted) return "safe";
    if (urlCheck.risky && urlCheck.severity === "danger") return "danger";

    const aiScore = Number(aiResult?.score) || 0;
    const localEvidence = Boolean(
      moneyCheck.risky || hardSignals.brandMismatch || hardSignals.credentialHarvest
    );
    if (aiScore >= RISK_SCORE_DANGER && localEvidence) return "danger";
    if (urlCheck.risky || moneyCheck.risky || aiScore >= RISK_SCORE_WARN) return "warn";
    return "safe";
  }

  function safeHost(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
  }

  async function analyzePage(ctx, hooks = {}) {
    const { url, title, text } = ctx;
    const normalized = normalizeText(text);

    const urlCheck = checkUrl(url);
    const moneyCheck = checkMoneyText(normalized);
    const features = globalThis.JINGYAN_FEATURES?.collect
      ? JINGYAN_FEATURES.collect({ url, title, text: normalized, doc: typeof document !== "undefined" ? document : null })
      : null;
    const hardSignals = {
      brandMismatch: Boolean(features?.url?.brandMismatchCount),
      credentialHarvest: Boolean(features?.page?.externalFormAction && features?.page?.hasPasswordInput)
    };
    let intel = null;
    const hasLocalRiskSignal = Boolean(
      urlCheck.risky || moneyCheck.risky || hardSignals.brandMismatch || hardSignals.credentialHarvest
    );
    if (hasLocalRiskSignal) {
      try { intel = await globalThis.JINGYAN_INTEL?.query?.(safeHost(url)); } catch {}
    }

    let aiResult = { score: 0, level: "safe", reasons: [], suggestion: "" };
    const ai = globalThis.JINGYAN_AI;
    if (ai?.analyzeRisk) {
      let useAi = true;
      try {
        if (typeof ai.shouldAnalyze === "function") {
          useAi = await ai.shouldAnalyze({ urlCheck, moneyCheck });
        }
      } catch {
        useAi = true;
      }
      if (useAi) {
        try {
          aiResult = await ai.analyzeRisk({
            url,
            host: safeHost(url),
            trusted: Boolean(urlCheck.trusted),
            title: title || (typeof document !== "undefined" ? document.title : "") || "",
            text: normalized,
            urlRisk: urlCheck.risky,
            moneyRisk: moneyCheck.risky,
            moneyKeyword: moneyCheck.keyword || "",
            moneyAmount: moneyCheck.amount || "",
            features
          }, hooks.onStep, hooks.onThinking);
        } catch (err) { if (globalThis.console) console.error("[JINGYAN] AI analyze failed:", err); }
      }
    }

    let level = mergeLevel(urlCheck, moneyCheck, aiResult, hardSignals);
    if (intel?.flagged) level = "danger";
    return { level, score: aiResult.score || 0, urlRisk: urlCheck.risky, moneyRisk: moneyCheck.risky, urlCheck, moneyCheck, aiResult, features, intel };
  }

  return {
    STORAGE_KEY,
    checkUrl,
    checkMoneyText,
    getProtectionEnabled,
    invalidateProtectionCache,
    isInternalUrl,
    normalizeText,
    analyzePage
  };
})();
