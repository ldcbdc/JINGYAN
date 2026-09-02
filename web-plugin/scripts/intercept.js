const JINGYAN_INTERCEPT = (() => {

  const MONEY_CLICK_RE = /(充值|付款|支付|转账|汇款|确认支付|立即购买|买涨|买跌|买入|卖出)/i;
  async function interceptAction(e) {
    const btn = findActionButton(e.target);
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const btnText = (btn.textContent || '').trim();
    await JINGYAN_MODAL.showModalDialog({
      level: 'danger', title: '高危风险拦截',
      message: `已拦截"${btnText}"操作`,
      showCancel: false, timeout: 3000
    });
  }
  function bind() {
    document.addEventListener('click', interceptAction, true);
  }

  const FULL_MONEY_CLICK_RE = /(充值|付款|支付|转账|汇款|提交订单|确认支付|立即购买|立即充值|继续支付|去支付|确认付款|确认充值|购买|下单|确认下单|买涨|买跌|买入|卖出)/i;
  const FINAL_PAYMENT_RE = /(立即支付|确认支付|提交订单|确认付款|确认充值|确认转账|立即购买|确认下单|买涨|买跌|买入|卖出)/i;

  let activeClickRe = MONEY_CLICK_RE;

  function findActionButton(el) {
    const getElText = (el) => {
      const t = (el.textContent || '').trim();
      if (t) return t;
      const al = el.getAttribute?.('aria-label') || '';
      if (al) return al;
      const ti = el.getAttribute?.('title') || '';
      if (ti) return ti;
      return el.value || '';
    };
    const matchText = (el) => {
      const text = getElText(el);
      return text && activeClickRe.test(text) ? text : null;
    };
    const isNativeInteractive = (el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'button' || tag === 'a' || tag === 'input') return true;
      const role = el.getAttribute?.('role') || '';
      return ['button', 'link', 'tab', 'menuitem'].includes(role);
    };
    const isFakeButton = (el) => {
      if (el.hasAttribute?.('onclick')) return true;
      const cls = (el.className || '').toLowerCase();
      if (/\b(btn|button|trade|buy|sell|submit|action)\b/.test(cls)) return true;
      const tag = el.tagName.toLowerCase();
      if ((tag === 'div' || tag === 'span') && el.getAttribute?.('type')) return true;
      return false;
    };
    let target = el;
    while (target && target !== document.body && target !== document.documentElement) {
      if (isNativeInteractive(target)) {
        const text = matchText(target);
        if (text) return target;
      }
      target = target.parentElement;
    }
    target = el;
    let depth = 0;
    while (target && target !== document.body && target !== document.documentElement && depth < 3) {
      if (isFakeButton(target)) {
        const text = matchText(target);
        if (text) return target;
      }
      target = target.parentElement;
      depth++;
    }
    return null;
  }

  function readElementContext(el) {
    const chunks = []; let target = el; let depth = 0;
    while (target && target !== document.body && target !== document.documentElement && depth < 4) {
      chunks.push((target.textContent || "").slice(0, 2000));
      target = target.parentElement; depth++;
    }
    const form = el.closest?.("form");
    if (form) chunks.push((form.textContent || "").slice(0, 3000));
    return chunks.filter(Boolean).join(" ");
  }

  function buildClickMoneyCheck(btn, btnText) {
    const currentCheck = JINGYAN.checkMoneyText(btnText);
    if (currentCheck.risky) return currentCheck;
    const context = readElementContext(btn);
    const contextCheck = JINGYAN.checkMoneyText(context);
    if (contextCheck.risky) return contextCheck;
    return { risky: false };
  }

  function buildManualRisk(level, btnText, moneyCheck, urlNow) {
    const amount = moneyCheck?.amount || "";
    const urlDanger = urlNow?.risky && urlNow?.severity === "danger";
    const evidence = [
      urlDanger ? "当前域名命中仿冒网站黑名单" : "",
      btnText ? `用户点击：${btnText}` : "",
      amount ? `金额线索：${amount}` : ""
    ].filter(Boolean).join(" / ");
    return { level, score: level === "danger" ? 90 : 45, urlRisk: Boolean(urlNow?.risky), moneyRisk: true, urlCheck: urlDanger ? urlNow : { risky: false }, moneyCheck: moneyCheck?.risky ? moneyCheck : { risky: true, keyword: btnText || "资金操作", amount }, aiResult: { score: level === "danger" ? 90 : 45, level, reasons: [evidence || "用户正在执行资金相关操作。"], suggestion: level === "danger" ? "当前网站为高危仿冒网站，请立即停止操作，切勿充值转账。" : "请先核对域名、收款方和金额，确认无误后再继续。" } };
  }

  function createIntercept({ getState, report, redirectToBlockPage, scan }) {
    //
    const allowOnce = new WeakSet();

    function consumeAllowance(node) {
      if (!node || !allowOnce.has(node)) return false;
      allowOnce.delete(node);
      return true;
    }

    function hasAllowance(node) {
      let el = node;
      let depth = 0;
      while (el && el !== document.body && depth < 5) {
        if (allowOnce.has(el)) return true;
        el = el.parentElement;
        depth++;
      }
      return false;
    }

    const isMoneyAction = (text) => FULL_MONEY_CLICK_RE.test(text || "");

    function replayUserAction(btn) {
      allowOnce.add(btn);
      const form = btn.closest?.("form");
      if (form) allowOnce.add(form);
      lastReplayAt = Date.now();
      btn.click();
      setTimeout(() => {
        allowOnce.delete(btn);
        if (form) allowOnce.delete(form);
      }, 1000);
    }

    const ANALYZE_TIMEOUT = 6000;

    let trustedToastTimer = null;
    let lastReplayAt = 0;

    // 正规网站：不打断用户操作，仅在右上角展示本次行为的分析过程与结论
    async function analyzeTrustedAction(btnText) {
      if (typeof showAiThinking !== "function") return;
      try {
        clearTimeout(trustedToastTimer);
        showAiThinking(`正在分析当前操作：${btnText || "页面交互"}...`);
        const result = await resolveRisk(true);
        const safe = (result?.level || "safe") === "safe";
        showAiThinking(safe
          ? "分析完成：域名合法、页面无仿冒特征、无资金话术诱导，操作已放行。"
          : `分析完成：${result?.aiResult?.summary || "页面存在可疑特征，请谨慎操作。"}`);
        trustedToastTimer = setTimeout(() => {
          if (typeof hideAiToast === "function") hideAiToast();
        }, 3000);
      } catch {}
    }

    // 正规网站点击资金按钮：先按住跳转，分析完确认安全再放行
    async function holdAndAnalyzeTrustedAction(btn, btnText) {
      clearTimeout(trustedToastTimer);
      if (typeof showAiThinking === "function") {
        showAiThinking(`正在分析当前操作：${btnText}，请稍候...`);
      }
      let result = null;
      try {
        result = await resolveRisk(true);
      } catch {
        result = null;
      }
      const safe = (result?.level || "safe") === "safe";
      if (typeof showAiThinking === "function") {
        showAiThinking(safe
          ? "分析完成：域名合法、页面无仿冒特征、无资金话术诱导，正在跳转。"
          : `分析完成：${result?.aiResult?.summary || "页面存在可疑特征，请谨慎操作。"}`);
      }
      trustedToastTimer = setTimeout(() => {
        if (typeof hideAiToast === "function") hideAiToast();
      }, 3000);
      if (safe) replayUserAction(btn);
    }

    async function resolveRisk(force = false) {
      const { lastScanResult, scanning } = getState();
      if (!force && lastScanResult && !scanning) return lastScanResult;
      if (typeof scan !== "function") return lastScanResult || null;

      const result = await Promise.race([
        scan(force),
        new Promise(resolve => setTimeout(() => resolve(null), ANALYZE_TIMEOUT))
      ]);
      return result || lastScanResult || null;
    }

    async function fullInterceptAction(e, explicitBtn) {
      const btn = explicitBtn || findActionButton(e.target);
      if (!btn) return;
      if (consumeAllowance(btn)) return;

      const { enabled, hasEnabledState, clearRedirectTimer } = getState();
      if (hasEnabledState && !enabled) return;

      const btnText = (btn.textContent || btn.value || '').trim().slice(0, 50);
      const host = location.hostname;
      const moneyCheck = buildClickMoneyCheck(btn, btnText);
      const isFinalPayment = FINAL_PAYMENT_RE.test(btnText);
      const urlNow = JINGYAN.checkUrl(location.href);
      const blacklisted = urlNow.risky && urlNow.severity === "danger";
      if (urlNow.trusted) {
        // 正规网站点击资金按钮：先按住跳转，分析确认安全后再放行
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        holdAndAnalyzeTrustedAction(btn, btnText);
        return;
      }

      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();

      const isEnabled = await JINGYAN.getProtectionEnabled();
      if (!isEnabled) {
        replayUserAction(btn);
        return;
      }

      const bypassed = await getState().hasMoneyBypass?.();
      if (bypassed && !isFinalPayment) {
        replayUserAction(btn);
        return;
      }

      const needAiShow = blacklisted || isFinalPayment;
      if (needAiShow && typeof showAiThinking === "function") {
        showAiThinking(blacklisted ? "大模型正在分析本次支付行为..." : "实时检测本次支付操作...");
      }
      const result = await resolveRisk(isFinalPayment || blacklisted);
      if (needAiShow && typeof hideAiToast === "function") hideAiToast();

        const pageLevel = result?.level || "safe";
        const aiScore = Number(result?.score) || 0;
        const intelFlagged = Boolean(result?.intel?.flagged);
        const urlRiskSignal = Boolean(result?.urlCheck?.risky || result?.features?.url?.brandMismatchCount);
        const danger = isFinalPayment && (
          blacklisted ||
          intelFlagged ||
          pageLevel === "danger" ||
          (pageLevel === "warn" && urlRiskSignal && aiScore >= 55 && Boolean(moneyCheck?.largeAmount))
        );

        if (danger) {
          clearRedirectTimer?.();
          const riskData = result && (result.level === "danger" || result.urlCheck?.severity === "danger")
            ? result
            : buildManualRisk("danger", btnText, moneyCheck, urlNow);
          report(riskData);
          await JINGYAN_MODAL.showModalDialog({
            level: 'danger',
            title: '高危风险拦截',
            message: `检测到资金支付操作，已拦截"${btnText}"操作。`,
            detail: '请勿输入账号、密码、验证码，也不要继续充值或转账。',
            showCancel: false,
            timeout: 3000
          });
          redirectToBlockPage(riskData);
          return;
        }

        if (bypassed) {
          replayUserAction(btn);
          return;
        }

        clearRedirectTimer?.();
        const choice = await JINGYAN_MODAL.showModalDialog({
          level: 'warn',
          title: '支付风险确认',
          message: `您正在 ${host} 上执行"${btnText}"操作。`,
          detail: (blacklisted ? '该域名命中仿冒网站黑名单，' : '') + 'AI 检测后建议先核对域名、收款方和金额，确认无误后再继续。',
          showCancel: true,
          okText: '知道了',
          cancelText: '终止访问'
        });
        if (choice === 'ok') {
          await getState().setYellowBypass?.();
          replayUserAction(btn);
        }
    }

    function findSubmitControl(form) {
      const controls = form.querySelectorAll('button, input[type="submit"], input[type="button"]');
      for (const el of controls) {
        const text = (el.textContent || el.value || '').trim();
        if (text && FULL_MONEY_CLICK_RE.test(text)) return el;
      }
      return null;
    }

    function handleSubmit(e) {
      const form = e.target;
      if (!form) return;
      if (consumeAllowance(form)) return;

      const control = findSubmitControl(form);
      if (!control) return;
      fullInterceptAction(e, control);
    }

    function getClickLabel(target) {
      let el = target;
      let depth = 0;
      while (el && el !== document.body && el !== document.documentElement && depth < 5) {
        const tag = el.tagName ? el.tagName.toLowerCase() : "";
        const role = el.getAttribute?.("role") || "";
        if (["button", "a", "input", "submit"].includes(tag) || ["button", "link", "tab", "menuitem"].includes(role)) {
          const text = (el.textContent || el.value || el.getAttribute?.("aria-label") || el.getAttribute?.("title") || "").trim();
          if (text) return text.slice(0, 30);
        }
        el = el.parentElement;
        depth++;
      }
      const raw = (target && target.textContent ? target.textContent : "").trim();
      return raw ? raw.slice(0, 30) : "";
    }

    let lastObservedAt = 0;

    // 正规网站普通点击观察者：不拦截，仅在右上角展示本次行为的分析过程与结论
    function observeTrustedClick(e) {
      const { enabled, hasEnabledState } = getState();
      if (hasEnabledState && !enabled) return;
      if (!JINGYAN.checkUrl(location.href).trusted) return;
      // 放行重放产生的点击不再重复分析
      if (hasAllowance(e.target) || Date.now() - lastReplayAt < 1500) return;

      const now = Date.now();
      if (now - lastObservedAt < 800) return;
      lastObservedAt = now;

      analyzeTrustedAction(getClickLabel(e.target));
    }

    function fullBind() {
      activeClickRe = FULL_MONEY_CLICK_RE;
      document.addEventListener('click', fullInterceptAction, true);
      document.addEventListener('submit', handleSubmit, true);
      document.addEventListener('click', observeTrustedClick, true);
    }

    return { bind: fullBind, interceptAction: fullInterceptAction };
  }

  return { MONEY_CLICK_RE, FULL_MONEY_CLICK_RE, FINAL_PAYMENT_RE, findActionButton, interceptAction, bind, buildClickMoneyCheck, buildManualRisk, createIntercept };
})();
