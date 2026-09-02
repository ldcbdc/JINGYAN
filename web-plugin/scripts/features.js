
(function () {
  const RISKY_TLD_MATCHER = RISKY_TLD_RE;

  const BRAND_HINTS = [
    { token: "taobao", name: "淘宝", domains: ["taobao.com"] },
    { token: "tmall", name: "天猫", domains: ["tmall.com"] },
    { token: "alipay", name: "支付宝", domains: ["alipay.com", "alipay.com.cn"] },
    { token: "icbc", name: "工商银行", domains: ["icbc.com.cn"] },
    { token: "ccb", name: "建设银行", domains: ["ccb.com"] },
    { token: "abchina", name: "农业银行", domains: ["abchina.com"] },
    { token: "bankofchina", name: "中国银行", domains: ["bankofchina.com"] },
    { token: "boc", name: "中国银行", domains: ["boc.cn", "bankofchina.com"] },
    { token: "weixin", name: "微信", domains: ["weixin.qq.com"] },
    { token: "qq", name: "QQ", domains: ["qq.com"] },
    { token: "douyin", name: "抖音", domains: ["douyin.com"] },
    { token: "kuaishou", name: "快手", domains: ["kuaishou.com"] },
    { token: "12306", name: "铁路12306", domains: ["12306.cn"] },
    { token: "10086", name: "中国移动", domains: ["10086.cn"] }
  ];

  const MAX_TEXT_LENGTH = 50000;

  function homoglyphNormalize(host) {
    return String(host || "")
      .replace(/0/g, "o").replace(/1/g, "l").replace(/3/g, "e")
      .replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t")
      .replace(/8/g, "b").replace(/9/g, "g");
  }

  function normalize(text) {
    if (globalThis.JINGYAN?.normalizeText) return JINGYAN.normalizeText(text);
    return String(text || "").replace(/\s+/g, " ").slice(0, MAX_TEXT_LENGTH);
  }

  function analyzeUrl(rawUrl) {
    const out = {
      rawUrl: rawUrl || "",
      host: "",
      protocol: "",
      isHttps: false,
      port: "",
      hasOddPort: false,
      isIp: false,
      isPunycode: false,
      riskyTld: false,
      riskyTldName: "",
      subdomainDepth: 0,
      hostLength: 0,
      brandMismatches: [],
      brandMismatchCount: 0,
      brandOfficialHits: [],
      isOfficialBrand: false
    };

    try {
      const u = new URL(rawUrl);
      const host = u.hostname.toLowerCase();
      out.host = host;
      out.protocol = u.protocol.replace(":", "");
      out.isHttps = u.protocol === "https:";
      out.port = u.port;
      out.hasOddPort = Boolean(u.port && !["80", "443"].includes(u.port));
      const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
      const isIpv6 = host.includes(":") && /^[0-9a-f:]+$/i.test(host);
      out.isIp = isIpv4 || isIpv6;
      out.isPunycode = host.startsWith("xn--");
      out.riskyTld = RISKY_TLD_MATCHER.test(host);
      out.riskyTldName = out.riskyTld ? host.split(".").pop() : "";
      out.subdomainDepth = Math.max(0, host.split(".").length - 2);
      out.hostLength = host.length;

      const normalizedHost = homoglyphNormalize(host);
      for (const brand of BRAND_HINTS) {
        if (host.includes(brand.token)) {
          const isOfficial = brand.domains.some(d => host === d || host.endsWith("." + d));
          if (!isOfficial) out.brandMismatches.push(brand.name + "(" + brand.token + ")");
          else out.brandOfficialHits.push(brand.name);
          continue;
        }
        if (normalizedHost.includes(brand.token)) {
          out.brandMismatches.push(brand.name + "(形近字符仿冒:" + brand.token + ")");
        }
      }
      out.brandMismatchCount = out.brandMismatches.length;
      out.isOfficialBrand = out.brandOfficialHits.length > 0;
    } catch {
    }

    return out;
  }

  function analyzePageDom(doc) {
    const out = {
      formCount: 0,
      externalFormAction: false,
      hasPasswordInput: false,
      inputCount: 0,
      qrCodeCount: 0,
      iframeCount: 0,
      iframeSrcs: [],
      externalLinkCount: 0,
      externalDomains: [],
      metaDescription: "",
      forms: []
    };

    try {
      if (!doc || typeof doc.querySelectorAll !== "function") return out;

      const pageOrigin = (() => { try { return new URL(doc.location.href).origin; } catch { return ""; } })();
      const baseHref = doc.baseURI || doc.location.href;

      const forms = Array.from(doc.querySelectorAll("form")).slice(0, 20);
      const formList = forms.map(form => {
        const inputs = form.querySelectorAll("input");
        let passwordInputs = 0;
        for (const input of inputs) {
          if (String(input.type).toLowerCase() === "password") passwordInputs++;
        }
        const text = String(form.textContent || "").replace(/\s+/g, " ").slice(0, 300);
        let action = form.getAttribute("action") || "";
        let external = false;
        try {
          if (action) action = new URL(action, baseHref).href;
          if (action) external = new URL(action).origin !== pageOrigin;
        } catch {}
        return { action, method: String(form.method || "get").toLowerCase(), inputCount: inputs.length, passwordInputs, external, text };
      });

      const links = Array.from(doc.querySelectorAll("a[href]")).slice(0, 300);
      const externalDomains = new Set();
      let externalLinkCount = 0;
      for (const a of links) {
        try {
          const u = new URL(a.href, baseHref);
          if (u.origin !== pageOrigin) {
            externalLinkCount++;
            externalDomains.add(u.hostname);
            if (externalDomains.size >= 10) break;
          }
        } catch {}
      }

      let qrCodeCount = 0;
      for (const img of doc.images) {
        if (/(qr|qrcode|erweima|二维码|收款码|pay.?code)/i.test((img.src || "") + " " + (img.alt || ""))) qrCodeCount++;
      }

      const iframeSrcs = Array.from(doc.querySelectorAll("iframe"))
        .map(f => f.src || "").filter(Boolean).slice(0, 10);

      out.formCount = formList.length;
      out.externalFormAction = formList.some(f => f.external);
      out.hasPasswordInput = doc.querySelector('input[type="password"]') !== null;
      out.inputCount = doc.querySelectorAll("input, textarea").length;
      out.qrCodeCount = qrCodeCount;
      out.iframeCount = iframeSrcs.length;
      out.iframeSrcs = iframeSrcs;
      out.externalLinkCount = externalLinkCount;
      out.externalDomains = Array.from(externalDomains).slice(0, 10);
      out.metaDescription = String(doc.querySelector('meta[name="description"]')?.content || "").slice(0, 300);
      out.forms = formList.slice(0, 5);
    } catch {
    }

    return out;
  }

  function analyzeText(text, title) {
    const source = normalize(text);
    const titleSource = String(title || "");

    const moneyHits = matchAllHits(source, MONEY_RE_G);
    const actionHits = matchAllHits(source, ACTION_RE_G);
    const amountHits = matchAllHits(source, AMOUNT_RE_G);

    const urgentHits = matchAllUnique(titleSource + " " + source, URGENT_RE_G, 10);
    const contactHits = matchAllUnique(source, CONTACT_RE_G, 10);
    const sensitiveHits = matchAllUnique(source, SENSITIVE_RE_G, 10);

    return {
      length: source.length,
      moneyCount: moneyHits.length,
      actionCount: actionHits.length,
      amountCount: amountHits.length,
      amountSamples: amountHits.slice(0, 10).map(s => s.trim()),
      urgentHits,
      contactHits,
      sensitiveHits,
      hasCountdown: COUNTDOWN_RE.test(source),
      hasMoney: moneyHits.length > 0,
      hasAmount: amountHits.length > 0,
      hasAction: actionHits.length > 0
    };
  }

  function collect(ctx) {
    const url = String(ctx?.url || "");
    const title = String(ctx?.title || "");
    const text = String(ctx?.text || "");
    return {
      url: analyzeUrl(url),
      page: ctx?.doc && typeof ctx.doc.querySelectorAll === "function" ? analyzePageDom(ctx.doc) : null,
      text: analyzeText(text, title),
      collectedAt: new Date().toISOString()
    };
  }

  function toHumanLines(features) {
    const lines = [];
    const u = features?.url;
    if (u) {
      lines.push(`URL 特征：host=${u.host}，HTTPS=${u.isHttps}，IP=${u.isIp}，Punycode=${u.isPunycode}，高风险顶级域=${u.riskyTldName || "无"}，非常规端口=${u.hasOddPort}，子域名层级=${u.subdomainDepth}，域名长度=${u.hostLength}，品牌域名不匹配=${u.brandMismatchCount ? u.brandMismatches.join("、") : "无"}，官方品牌域名匹配=${u.isOfficialBrand ? u.brandOfficialHits.join("、") : "无"}`);
    }
    const p = features?.page;
    if (p) {
      lines.push(`页面结构：表单数=${p.formCount}，表单提交到外部=${p.externalFormAction}，含密码输入=${p.hasPasswordInput}，输入框数=${p.inputCount}，二维码图片=${p.qrCodeCount}，iframe=${p.iframeCount}，外链数=${p.externalLinkCount}，外链域名=${p.externalDomains?.join("、") || "无"}`);
    }
    const t = features?.text;
    if (t) {
      lines.push(`文本特征：长度=${t.length}，资金词=${t.moneyCount}，动作词=${t.actionCount}，金额数=${t.amountCount}，金额样例=${t.amountSamples?.join("、") || "无"}，诱导/紧急话术=${t.urgentHits?.join("、") || "无"}，联系渠道=${t.contactHits?.join("、") || "无"}，敏感信息词=${t.sensitiveHits?.join("、") || "无"}，倒计时话术=${t.hasCountdown}`);
    }
    return lines;
  }

  globalThis.JINGYAN_FEATURES = { collect, analyzeUrl, analyzePageDom, analyzeText, toHumanLines, RISKY_TLD_RE: RISKY_TLD_MATCHER, BRAND_HINTS };
})();
