
var RISK_HOSTS = [
  "www.back0fchina.com", "back0fchina.com",
  "www.bank0fchina.com", "bank0fchina.com",
  "www.bankofchian.com", "bankofchian.com",
  "www.icbcq.com", "icbcq.com",
  "www.taobao-shop.com", "taobao-shop.com",
  "www.taobao-vip.com", "taobao-vip.com",
  "10086-10000.com", "www.10086-10000.com",
  "95588-ccb.com", "www.95588-ccb.com",
  "192.168.2.1","http://localhost"
];

var RISK_HOST_SET = new Set(RISK_HOSTS);

function isBlacklistedHost(host) {
  if (!host) return false;
  let current = String(host).toLowerCase();
  while (current) {
    if (RISK_HOST_SET.has(current)) return true;
    const dot = current.indexOf(".");
    if (dot < 0) return false;
    current = current.slice(dot + 1);
  }
  return false;
}

var TRUSTED_HOSTS = [
  "taobao.com", "tmall.com", "alipay.com", "alipay.com.cn", "jd.com", "jd.hk",
  "1688.com", "pinduoduo.com", "yangkeduo.com", "vip.com", "suning.com",
  "meituan.com", "ele.me", "didi.com", "douyin.com",
  "qq.com", "weixin.qq.com", "tenpay.com", "wechatpay.cn", "tencent.com",
  "icbc.com.cn", "ccb.com", "abchina.com", "boc.cn", "bankofchina.com",
  "cmbchina.com", "bocom.com", "psbc.com", "spdb.com.cn", "ceb.com.cn",
  "cgbchina.com.cn", "citicbank.com", "hxb.com.cn", "cmbc.com.cn",
  "pingan.com", "unionpay.com", "95516.com",
  "10086.cn", "10010.com", "189.cn", "12306.cn", "ctrip.com", "qunar.com",
  "gov.cn", "edu.cn", "aliyun.com", "deepseek.com", "apple.com", "microsoft.com", "paypal.com"
];

var TRUSTED_HOST_SET = new Set(TRUSTED_HOSTS);

function isTrustedHost(host) {
  if (!host) return false;
  let current = String(host).toLowerCase();
  while (current) {
    if (TRUSTED_HOST_SET.has(current)) return true;
    const dot = current.indexOf(".");
    if (dot < 0) return false;
    current = current.slice(dot + 1);
  }
  return false;
}

var MONEY_RE =
  /(充值金额|付款金额|支付金额|转账金额|应付金额|实付金额|充值|转账|汇款|付款|支付|提现|收款|收款码|银行卡|支付宝|微信支付|扫码|二维码|USDT|钱包|数字人民币|保证金|手续费)/i;

var ACTION_RE =
  /(确认|提交|立即|马上|继续|下一步|账户|账号|卡号|姓名|手机号|验证码|付款|支付|充值|转账|汇款|收款)/i;

var AMOUNT_RE =
  /((?:充值金额|付款金额|支付金额|转账金额|应付金额|实付金额|金额|充值|支付|付款|转账|汇款|保证金|手续费)[^\d￥¥$]{0,16}(?:￥|¥|\$|RMB|CNY|USD|USDT)?\s*\d+(?:[,.，]\d+)*(?:\.\d{1,2})?\s*(?:元|人民币|块|美元|美金|USDT|U)?|(?:￥|¥|\$|RMB|CNY|USD|USDT)\s*\d+(?:[,.，]\d+)*(?:\.\d{1,2})?\s*(?:元|人民币|块|美元|美金|USDT|U)?|\d+(?:[,.，]\d+)*(?:\.\d{1,2})?\s*(?:元|人民币|块|美元|美金|USDT|U))/i;

var LARGE_AMOUNT_THRESHOLD = 1000;

var RISK_SCORE_WARN = 40;
var RISK_SCORE_DANGER = 70;

var MONEY_RE_G = new RegExp(MONEY_RE.source, "gi");
var ACTION_RE_G = new RegExp(ACTION_RE.source, "gi");
var AMOUNT_RE_G = new RegExp(AMOUNT_RE.source, "gi");

var RISKY_TLD_RE =
  /\.(top|xyz|vip|club|tk|ml|ga|cf|gq|work|site|online|live|shop|wang|icu|cyou|sbs|zip|review|country|loan|win|download|racing|accountant|science|stream|gdn|bid|trade|date|faith)$/i;

var URGENT_RE_G =
  /(中奖|退款|解冻|异常|安全账户|保证金|手续费|验证码|登录|领取|审核|冻结|系统升级|账户异常|涉嫌违法|通缉|法院|公安|银保监|征信|清零|最后\d+|马上|立即|否则|后果自负|关闭|失效|即将到期|额度不足)/gi;

var CONTACT_RE_G =
  /(QQ|微信|WeChat|Telegram|WhatsApp|Line|添加.{0,6}客服|联系.{0,6}客服|在线客服|扫码|二维码|加好友|进群)/gi;

var SENSITIVE_RE_G =
  /(身份证|银行卡号|密码|验证码|CVV|有效期|支付密码|取款密码|姓名|手机号|卡号)/gi;

var COUNTDOWN_RE =
  /(剩余时间|倒计时|仅剩|最后\d+|尽快|秒后|即将关闭|马上失效)/i;


function matchAllHits(source, globalRe) {
  if (!source) return [];
  globalRe.lastIndex = 0;
  const hits = source.match(globalRe) || [];
  globalRe.lastIndex = 0;
  return hits;
}

function matchAllUnique(source, globalRe, limit = 10) {
  return Array.from(new Set(matchAllHits(source, globalRe))).slice(0, limit);
}
