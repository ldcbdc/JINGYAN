function checkUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (isBlacklistedHost(h)) return { risky: true, host: h, reason: "命中仿冒网站黑名单", severity: "danger" };
    return { risky: false };
  } catch { return { risky: false }; }
}
function checkMoneyText(text) {
  const s = String(text || "").replace(/\s+/g, " ").slice(0, 50000), m = s.match(MONEY_RE), n = s.match(AMOUNT_RE);
  return m && n && Math.abs((m.index || 0) - (n.index || 0)) <= 120 ? { risky: true, keyword: m[0], amount: (n?.[0] || "").trim() } : { risky: false };
}
const AI_CFG = { prompt: `你是反诈专家，分析网页风险。输出JSON：{"score":0-100,"level":"safe/warn/danger","reasons":["理由"],"suggestion":"建议"}` };
async function analyzeRisk(inp) {
  const get = (k, d) => new Promise(r => { try { chrome.storage.local.get({ [k]: d }, v => r(v?.[k] ?? d)); } catch { r(d); } });
  const cfg = { api: await get("jingyanAiApiKey", ""), url: await get("jingyanAiApiUrl", "https://api.deepseek.com/v1/chat/completions"), model: await get("jingyanAiModel", "deepseek-chat") };
  const call = async () => {
    const r = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.api },
      body: JSON.stringify({ model: cfg.model, temperature: 0.1,
        messages: [{ role: "user", content: AI_CFG.prompt + "\n\n网页数据：" + JSON.stringify(inp) }] })
    });
    if (!r.ok) throw 0;
    return JSON.parse((await r.json()).choices[0].message.content.match(/\{[\s\S]*\}/)?.[0] || "{}");
  };
  if (cfg.api && cfg.url) try { return await call(); } catch {}
  return { score: 50, level: "warn", reasons: ["云端AI不可用，已按可疑预警"], suggestion: "请人工核对网站真实性后再操作。" };
}
function intercept(e) {
  if (!enabled) return;
  const t = e.target.closest("button, a, input, [role=button]");
  if (!t) return;
  const txt = (t.textContent || t.value || "").trim();
  if (!/(充值|付款|支付|转账|汇款|确认支付|立即购买|提交订单)/i.test(txt)) return;
  e.preventDefault(); e.stopPropagation();
  const mc = checkMoneyText(txt + " " + (document.body?.innerText || "").slice(0, 2000)), risk = lastResult || { level: "safe", aiResult: {} };
  const final = /(确认支付|立即支付|确认付款|确认充值|确认转账|立即购买|确认下单|提交订单)/i.test(txt);
  if (final && risk.level === "danger") { showModal({ ...risk, interceptedBtn: txt }, true); setTimeout(() => redirectToWarningPage(risk), 3000); }
  else if (risk.level === "warn" || risk.level === "danger" || mc.risky) showModal({ ...risk, interceptedBtn: txt }, false);
}
const mergeLevel = (uc, mc, ai) => (uc.risky && uc.severity === "danger") || (ai?.level === "danger" && (ai.score >= 70 || uc.risky || mc.risky)) ? "danger" : uc.risky || mc.risky || ai?.level === "warn" ? "warn" : "safe";
let lastResult = null, enabled = false;
async function scan() {
  if (!enabled) return lastResult;
  const text = (document.body?.innerText || "").slice(0, 50000), uc = checkUrl(location.href), mc = checkMoneyText(text);
  const ai = await analyzeRisk({ url: location.href, title: document.title, text, urlRisk: uc.risky, moneyRisk: mc.risky, moneyKeyword: mc.keyword || "", moneyAmount: mc.amount || "" });
  lastResult = { level: mergeLevel(uc, mc, ai), score: ai.score || 0, urlCheck: uc, moneyCheck: mc, aiResult: ai };
  return lastResult;
}

function showModal(r, block) {
  document.getElementById("jingyan-modal")?.remove();
  const d = document.createElement("div"); d.id = "jingyan-modal";
  const tip = r.aiResult?.suggestion || (block ? "请勿输入账号密码，不要转账付款。" : "请核对域名、收款方和金额。");
  const go = () => { if (d.dataset.go) return; d.dataset.go = "1"; d.remove(); if (block) redirectToWarningPage(r); };
  const body = block ? `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:999999;display:flex;align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:12px;padding:24px;max-width:400px">
    <div style="color:#e74c3c;font-size:20px;font-weight:bold">⚠️ 高危风险拦截</div>
    <div style="margin:12px 0;color:#333">${r.interceptedBtn ? `已拦截"${r.interceptedBtn}"` : "检测到高危风险"}</div>
    <div style="color:#666;font-size:14px">${tip}</div>
    <button style="background:#e74c3c;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer">查看风险详情</button>
    </div></div>` : `
    <div style="position:fixed;bottom:20px;right:20px;max-width:320px;background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;z-index:999999">
    <div style="color:#856404;font-weight:bold">⚠️ 支付风险提示 —— ${tip}</div>
    <button style="background:#ffc107;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer">知道了</button>
    </div>`;
  d.innerHTML = body;
  document.body.appendChild(d);
  d.querySelector("button").onclick = go;
  if (block) setTimeout(go, 3000);
}
function redirectToWarningPage(r) {
  const p = new URLSearchParams({
    url: location.href, level: r.level || "danger", score: String(r.score || 0),
    reason: (r.aiResult?.reasons || []).slice(0, 3).join("；") || r.urlCheck?.reason || "命中仿冒网站特征",
    evidence: [r.moneyCheck?.keyword, r.moneyCheck?.amount, r.urlCheck?.host].filter(Boolean).join(" / "),
    suggestion: r.aiResult?.suggestion || "请立即停止操作，切勿输入账号密码或转账付款。"
  });
  window.open(chrome.runtime.getURL("pages/intercept.html?" + p.toString()), "_blank");
}
chrome.runtime.onMessage.addListener((m, _, sr) => { if (m?.type === "JINGYAN_PROTECTION_CHANGED") { enabled = m.enabled !== false; sr({ ok: true }); } if (m?.type === "JINGYAN_GET_RISK") { scan().then(sr); return true; } });
chrome.storage.local.get({ jingyanProtectionEnabled: false }, r => { enabled = r.jingyanProtectionEnabled !== false; if (enabled) scan(); });
document.addEventListener("click", intercept, true);