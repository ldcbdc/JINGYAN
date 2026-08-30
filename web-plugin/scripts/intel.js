
(function () {
  const CACHE_KEY = "jingyanIntelCache";
  const VT_API_BASE = "https://www.virustotal.com/api/v3/domains/";
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const QUERY_TIMEOUT = 4000;
  const PROXY_TIMEOUT = 6000;
  const MALICIOUS_THRESHOLD = 2;

  const VT_APIKEY_STORAGE = "jingyanVtApiKey";

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

  function setStorage(key, value) {
    return new Promise(resolve => {
      try { chrome.storage.local.set({ [key]: value }, () => resolve()); } catch { resolve(); }
    });
  }

  async function readCache() {
    const raw = await getStorage(CACHE_KEY, {});
    return raw && typeof raw === "object" ? raw : {};
  }

  async function writeCache(map) {
    const now = Date.now();
    const pruned = {};
    for (const [domain, verdict] of Object.entries(map)) {
      if (verdict && (now - (verdict.fetchedAt || 0)) < CACHE_TTL) pruned[domain] = verdict;
    }
    await setStorage(CACHE_KEY, pruned);
  }

  function toQueryDomain(host) {
    return String(host || "").toLowerCase().replace(/^www\./, "");
  }

  async function queryVirusTotal(domain, apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT);
    try {
      const response = await fetch(VT_API_BASE + encodeURIComponent(domain), {
        headers: { "x-apikey": apiKey },
        signal: controller.signal
      });
      if (!response.ok) throw new Error("VT HTTP " + response.status);
      const data = await response.json();
      const attrs = data?.data?.attributes || {};
      const stats = attrs.last_analysis_stats || {};
      const malicious = Number(stats.malicious) || 0;
      const suspicious = Number(stats.suspicious) || 0;
      const categories = Array.from(new Set(Object.values(attrs.categories || {})))
        .filter(c => /phish|malic|scam|fraud|malware|spam|abuse/i.test(String(c)))
        .slice(0, 3);
      return {
        source: "virustotal",
        domain,
        malicious,
        suspicious,
        flagged: malicious >= MALICIOUS_THRESHOLD,
        categories,
        fetchedAt: Date.now()
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function queryInternal(host) {
    const domain = toQueryDomain(host);
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
    if (typeof isTrustedHost === "function" && isTrustedHost(domain)) return null;

    const cache = await readCache();
    const hit = cache[domain];
    if (hit && (Date.now() - (hit.fetchedAt || 0)) < CACHE_TTL) {
      try { console.info("[JINGYAN] 威胁情报缓存命中 " + domain + " →", hit.flagged ? "命中恶意" : "干净", "（24h 内不重复请求）"); } catch {}
      return hit;
    }

    const apiKey = String(await getStorage(VT_APIKEY_STORAGE, "")).trim();
    if (!apiKey) return null;

    try {
      const verdict = await queryVirusTotal(domain, apiKey);
      cache[domain] = verdict;
      await writeCache(cache);
      try { console.info("[JINGYAN] 威胁情报查询 " + domain + " →", verdict.flagged ? "命中恶意(" + verdict.malicious + "家引擎)" : "干净", verdict); } catch {}
      return verdict;
    } catch (err) {
      try { console.warn("[JINGYAN] 威胁情报查询失败，降级跳过：", err); } catch {}
      return null;
    }
  }


  if (typeof window === "undefined") {
    globalThis.JINGYAN_INTEL = { query: queryInternal };

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "JINGYAN_INTEL_QUERY") return;
      queryInternal(message.host || "")
        .then(verdict => sendResponse({ ok: true, verdict }))
        .catch(() => sendResponse({ ok: true, verdict: null }));
      return true;
    });
    return;
  }

  globalThis.JINGYAN_INTEL = {
    query(host) {
      return new Promise(resolve => {
        let settled = false;
        const done = value => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve(value);
        };
        const timeoutId = setTimeout(() => done(null), PROXY_TIMEOUT);
        try {
          chrome.runtime.sendMessage({ type: "JINGYAN_INTEL_QUERY", host: String(host || "") }, response => {
            if (chrome.runtime.lastError || !response?.ok) return done(null);
            done(response.verdict || null);
          });
        } catch {
          done(null);
        }
      });
    }
  };
})();
