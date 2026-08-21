// Fix chatPanel missing placeholder/send keys (chat-panel.tsx uses chatPanel namespace).
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));
zh.chatPanel = { ...zh.chatPanel, placeholder: "和{name}聊聊你的需求吧~", send: "发送" };
en.chatPanel = { ...en.chatPanel, placeholder: "Tell {name} what you need~", send: "Send" };
fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");
console.log("chatPanel.placeholder/send added to zh+en");
