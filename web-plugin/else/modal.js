const JINGYAN_MODAL = (() => {
  const MODAL_ID = "jingyan-modal";
  let lastAlertKey = "";

  function removeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function showModalDialog({ level, title, message, detail, showCancel, dedupKey, timeout }) {
    return new Promise(resolve => {
      if (dedupKey) {
        if (lastAlertKey === dedupKey) { resolve('skip'); return; }
        lastAlertKey = dedupKey;
      }

      removeModal();

      const isDanger = level === 'danger';
      const accentColor = isDanger ? '#c42b1c' : '#d47300';
      const accentLight = isDanger ? '#e8442e' : '#e8961a';
      const hostName = location.hostname;

      const host = document.createElement('div');
      host.id = MODAL_ID;
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';

      const root = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        .overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.55);
          display: flex; align-items: center; justify-content: center;
          z-index: 2147483647;
          font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", "Tahoma", Arial, sans-serif;
        }
        .dialog {
          width: min(480px, calc(100vw - 40px)); background: #f0f0f0;
          border-radius: 8px; overflow: hidden;
          box-shadow: 0 18px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.15);
          animation: dialog-in 120ms ease-out;
        }
        @keyframes dialog-in { from { transform: scale(0.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .titlebar {
          display: flex; align-items: center; gap: 10px; padding: 10px 16px;
          background: linear-gradient(180deg, ${accentLight}, ${accentColor});
          color: #fff; user-select: none;
        }
        .titlebar-icon { font-size: 18px; line-height: 1; flex-shrink: 0; }
        .titlebar-text { flex: 1; font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .body { padding: 20px 22px 16px; color: #222; font-size: 14px; line-height: 1.65; }
        .body-text { min-width: 0; }
        .body-title { font-size: 16px; font-weight: 800; margin: 0 0 6px; color: #111; }
        .body-desc { margin: 0; color: #444; }
        .body-detail { margin: 10px 0 0; padding: 10px 12px; background: #fff; border: 1px solid #d0d0d0; border-radius: 4px; color: #555; font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; }
        .host-info { margin: 12px 0 0; padding: 8px 12px; background: #fafafa; border: 1px solid #e0e0e0; border-radius: 4px; font-size: 12px; color: #777; word-break: break-all; }
        .auto-msg { margin: 14px 0 0; padding: 10px 14px; background: #fff3e0; border-radius: 4px; display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: #222; }
        .auto-msg .warn-text { color: ${accentColor}; }
        .auto-msg .countdown { display: flex; align-items: baseline; gap: 2px; font-size: 13px; color: #999; line-height: 1; }
        .auto-msg .countdown .num { font-size: 14px; color: ${accentColor}; min-width: 18px; text-align: center; }
        .footer { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 22px 16px; }
        .btn { min-width: 80px; height: 32px; padding: 0 18px; border: 1px solid #b0b0b0; border-radius: 4px; background: linear-gradient(180deg, #fafafa, #e8e8e8); color: #222; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; outline: none; }
        .btn:hover { background: linear-gradient(180deg, #f0f0f0, #dcdcdc); }
        .btn:active { transform: scale(0.97); }
        .btn-primary { background: linear-gradient(180deg, ${accentLight}, ${accentColor}); border-color: ${accentColor}; color: #fff; }
        .btn-primary:hover { background: linear-gradient(180deg, ${accentLight}, ${accentColor}); filter: none; }
        .btn-primary:active { filter: brightness(0.95); }
        @media (max-width: 500px) { .body { padding: 16px 16px 12px; } .footer { padding: 10px 16px 14px; flex-wrap: wrap; } .btn { flex: 1; min-width: 0; } }
      `;

      const overlay = document.createElement('div');
      overlay.className = 'overlay';

      const dialog = document.createElement('div');
      dialog.className = 'dialog';

      const titlebar = document.createElement('div');
      titlebar.className = 'titlebar';
      titlebar.innerHTML = `<span class="titlebar-icon">⚠</span><span class="titlebar-text">${title}</span>`;

      const body = document.createElement('div');
      body.className = 'body';

      const bodyText = document.createElement('div');
      bodyText.className = 'body-text';
      const bodyTitle = document.createElement('p');
      bodyTitle.className = 'body-title';
      bodyTitle.textContent = isDanger ? '高危操作拦截' : '检测到危险';
      const bodyDesc = document.createElement('p');
      bodyDesc.className = 'body-desc';
      bodyDesc.textContent = message;
      bodyText.append(bodyTitle, bodyDesc);
      body.appendChild(bodyText);

      if (detail) {
        const de = document.createElement('div');
        de.className = 'body-detail';
        de.textContent = detail;
        body.appendChild(de);
      }

      const hostInfo = document.createElement('div');
      hostInfo.className = 'host-info';
      hostInfo.textContent = '当前网站：' + hostName;
      body.appendChild(hostInfo);

      let countdownNumEl = null;
      if (timeout) {
        const bar = document.createElement('div');
        bar.className = 'auto-msg';
        const warnText = document.createElement('span');
        warnText.className = 'warn-text';
        warnText.textContent = '⚠ 当前页面为危险页面';
        const countdownWrap = document.createElement('span');
        countdownWrap.className = 'countdown';
        countdownNumEl = document.createElement('span');
        countdownNumEl.className = 'num';
        const totalSec = Math.ceil(timeout / 1000);
        countdownNumEl.textContent = String(totalSec);
        const countdownLabel = document.createElement('span');
        countdownLabel.textContent = '秒后即将跳转...';
        countdownWrap.append(countdownNumEl, countdownLabel);
        bar.append(warnText, countdownWrap);
        body.appendChild(bar);

        let seconds = totalSec;
        const ci = setInterval(() => {
          seconds--;
          if (seconds > 0) countdownNumEl.textContent = seconds;
          else { countdownNumEl.textContent = '0'; clearInterval(ci); }
        }, 1000);
      }

      const footer = document.createElement('div');
      footer.className = 'footer';

      function finish(result) { removeModal(); resolve(result); }

      if (showCancel) {
        const cb = document.createElement('button');
        cb.className = 'btn';
        cb.textContent = '取消';
        cb.addEventListener('click', () => finish('cancel'));
        footer.appendChild(cb);
      }

      const okBtn = document.createElement('button');
      okBtn.className = 'btn btn-primary';
      okBtn.textContent = showCancel ? '确定' : (isDanger ? '终止访问' : '知道了');
      okBtn.addEventListener('click', () => finish('ok'));
      footer.appendChild(okBtn);

      dialog.append(titlebar, body, footer);
      overlay.appendChild(dialog);
      root.append(style, overlay);
      document.documentElement.appendChild(host);

      setTimeout(() => okBtn.focus(), 50);
    });
  }

  function clearAlertKey() { lastAlertKey = ""; }

  return { removeModal, showModalDialog, clearAlertKey };
})();
