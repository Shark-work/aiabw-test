// Render the saved real-pay QR text into an SVG file you can open and scan with a phone.
// Usage: node scripts/render-pay-qr.cjs [qrText] [out.svg]
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { QRCodeSVG } = require("qrcode.react");
const fs = require("fs");
const path = require("path");

const qrText =
  process.argv[2] ||
  (fs.existsSync(path.join(__dirname, "_realpay.qr.txt"))
    ? fs.readFileSync(path.join(__dirname, "_realpay.qr.txt"), "utf8").trim()
    : "");
const out = process.argv[3] || path.join(__dirname, "_realpay.qr.html");

// 从订单信息中读测试账号（用于支付后的验证提示）
let checkEmail = "realpay_xxx@test.aiabw";
try {
  const orderInfo = JSON.parse(
    fs.readFileSync(path.join(__dirname, "_realpay.order.txt"), "utf8"),
  );
  if (orderInfo.email) checkEmail = orderInfo.email;
} catch {
  // 无订单文件则用默认提示
}

if (!qrText) { console.log("no qr text available"); process.exit(2); }

const svg = renderToStaticMarkup(
  React.createElement(QRCodeSVG, { value: qrText, size: 400, marginSize: 2, includeMargin: true }),
);
const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>XorPay 0.01 收款二维码</title></head>
<body style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:system-ui;background:#f5f5f5">
  <h2 style="margin:12px 0 4px">支付宝 / 微信 扫码支付 0.01 元</h2>
  <p style="margin:0 0 16px;color:#666">用手机「扫一扫」识别下方二维码 → 支付</p>
  <div style="background:#fff;padding:16px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08)">${svg}</div>
  <p style="margin-top:20px;color:#888;font-size:12px">支付完成后运行：node scripts/pay-acceptance-check.cjs ${checkEmail}</p>
</body></html>`;

fs.writeFileSync(out, html, "utf8");
console.log("saved: " + out);
console.log("QR text: " + qrText.slice(0, 120));
