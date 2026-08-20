const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Busboy = require('busboy');
const WebSocket = require('ws');
const { XMLParser } = require('fast-xml-parser');
const nodemailer = require('nodemailer');

loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 8787);
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const AI_MODEL = process.env.AI_MODEL || 'deepseek-chat';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_TEMPERATURE = Number(process.env.AI_TEMPERATURE || 0.7);
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 20000);
const IFLYTEK_APP_ID = process.env.IFLYTEK_APP_ID || '';
const IFLYTEK_API_KEY = process.env.IFLYTEK_API_KEY || '';
const IFLYTEK_API_SECRET = process.env.IFLYTEK_API_SECRET || '';
const IFLYTEK_HOST = 'ise-api.xfyun.cn';
const IFLYTEK_PATH = '/v2/open-ise';
const IFLYTEK_TIMEOUT_MS = Number(process.env.IFLYTEK_TIMEOUT_MS || 45000);
const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES || 10 * 1024 * 1024);
const safeModelName = AI_MODEL.slice(0, 80).replace(/[\r\n<>]/g, '');
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const AUTH_DATA_FILE = path.resolve(process.env.AUTH_DATA_FILE || path.join(__dirname, 'data', 'users.json'));
const AUTH_SECRET = process.env.AUTH_SECRET || (process.env.NODE_ENV === 'production' ? '' : crypto.randomBytes(48).toString('base64url'));
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'sg_session';
const AUTH_SESSION_DAYS = clampInt(process.env.AUTH_SESSION_DAYS, 1, 90, 14);
const AUTH_COOKIE_SECURE = /^(1|true|yes)$/i.test(process.env.AUTH_COOKIE_SECURE || (process.env.NODE_ENV === 'production' ? 'true' : 'false'));
const PRIVACY_POLICY_VERSION = process.env.PRIVACY_POLICY_VERSION || '2026-08-20';
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_MAX = 8;
const loginAttempts = new Map();
const SMTP_HOST = (process.env.SMTP_HOST || '').trim();
const SMTP_PORT = clampInt(process.env.SMTP_PORT, 1, 65535, 465);
const SMTP_SECURE = /^(1|true|yes)$/i.test(process.env.SMTP_SECURE || 'true');
const SMTP_USER = (process.env.SMTP_USER || '').trim();
const SMTP_PASS = (process.env.SMTP_PASS || '').trim();
const SMTP_FROM = (process.env.SMTP_FROM || SMTP_USER).trim();
const APP_BASE_URL = (process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
const EMAIL_VERIFY_TTL_MINUTES = clampInt(process.env.EMAIL_VERIFY_TTL_MINUTES, 5, 10080, 1440);
const PASSWORD_RESET_TTL_MINUTES = clampInt(process.env.PASSWORD_RESET_TTL_MINUTES, 5, 1440, 30);
const EMAIL_SEND_RATE_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_SEND_RATE_MAX = 3;
const emailSendAttempts = new Map();
const SMTP_STREAM_TRANSPORT = /^(1|true|yes)$/i.test(process.env.SMTP_STREAM_TRANSPORT || 'false');
const ROOT = __dirname;

if (!AUTH_SECRET) {
  console.error('AUTH_SECRET must be configured when NODE_ENV=production');
  process.exit(1);
}

const SYSTEM_PROMPT = `你是「拾光成长」App 的职场成长助手，服务于 22-40 岁职场人。
针对用户的问题，用中文、口语化、可直接执行的方式回复。
只输出一个 JSON 对象，不要任何多余文字，字段如下：
{"point":"核心观点（一句话点破本质）","script":"话术模板（可直接说出口的一句话，用「」括起来）","avoid":"避坑提醒（一句话）"}
如果问题与职场无关，也尽量引导回职场成长场景。`;

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function json(res, status, body, origin, extraHeaders = {}) {
  const allowOrigin = origin && CORS_ORIGINS.includes(origin) ? origin : '';
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {}),
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}
function readBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('request too large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,63}$/.test(email) && email.length <= 254 ? email : '';
}
function normalizeDisplayName(value, fallback) {
  const name = String(value || '').replace(/[\r\n<>]/g, '').trim();
  return (name || fallback).slice(0, 32);
}
function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 128) return '密码应为 8–128 个字符';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密码需同时包含字母和数字';
  return '';
}
function getClientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 128); }
function rateLimitKey(req, email) { return `${getClientIp(req)}:${email || '-'}`; }
function isRateLimited(key) {
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter(time => now - time < LOGIN_RATE_WINDOW_MS);
  loginAttempts.set(key, attempts);
  return attempts.length >= LOGIN_RATE_MAX;
}
function recordFailedAttempt(key) {
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter(time => now - time < LOGIN_RATE_WINDOW_MS);
  attempts.push(now); loginAttempts.set(key, attempts);
}
function clearFailedAttempts(key) { loginAttempts.delete(key); }
function readStore() {
  try {
    if (!fs.existsSync(AUTH_DATA_FILE)) return { users: [] };
    const parsed = JSON.parse(fs.readFileSync(AUTH_DATA_FILE, 'utf8'));
    return parsed && Array.isArray(parsed.users) ? parsed : { users: [] };
  } catch (error) { console.error('[Auth] unable to read user store:', error.message); throw new Error('user store unavailable'); }
}
function writeStore(store) {
  const directory = path.dirname(AUTH_DATA_FILE);
  fs.mkdirSync(directory, { recursive: true });
  const temp = `${AUTH_DATA_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, AUTH_DATA_FILE);
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('base64url')}`;
}
function verifyPassword(password, stored) {
  const [algorithm, salt, expected] = String(stored || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('base64url');
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function signToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${crypto.createHmac('sha256', AUTH_SECRET).update(encoded).digest('base64url')}`;
}
function verifyToken(token) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(encoded).digest();
  const received = Buffer.from(signature, 'base64url');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  try { const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); return payload && payload.exp > Math.floor(Date.now() / 1000) ? payload : null; } catch (_) { return null; }
}
function parseCookies(header) {
  return String(header || '').split(';').reduce((out, item) => { const i = item.indexOf('='); if (i > 0) out[item.slice(0, i).trim()] = decodeURIComponent(item.slice(i + 1).trim()); return out; }, {});
}
function sessionCookie(token) {
  const attrs = [`${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${AUTH_SESSION_DAYS * 86400}`];
  if (AUTH_COOKIE_SECURE) attrs.push('Secure'); return attrs.join('; ');
}
function clearSessionCookie() {
  const attrs = [`${AUTH_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (AUTH_COOKIE_SECURE) attrs.push('Secure'); return attrs.join('; ');
}
function toPublicUser(user) {
  return { id: user.id, email: user.email, nick: user.displayName, avatar: user.displayName.charAt(0).toUpperCase(), provider: 'email', createdAt: user.createdAt };
}
function createSession(user) {
  const now = Math.floor(Date.now() / 1000);
  return signToken({ sub: user.id, ver: user.sessionVersion || 1, iat: now, exp: now + AUTH_SESSION_DAYS * 86400 });
}
function currentSessionUser(req) {
  const token = parseCookies(req.headers.cookie)[AUTH_COOKIE_NAME];
  const payload = verifyToken(token);
  if (!payload || !payload.sub) return null;
  return readStore().users.find(item => item.id === payload.sub && item.sessionVersion === payload.ver) || null;
}

function isMailerConfigured() {
  return SMTP_STREAM_TRANSPORT || Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM);
}
let mailer;
function getMailer() {
  if (!isMailerConfigured()) throw new Error('SMTP is not configured');
  if (!mailer) {
    mailer = SMTP_STREAM_TRANSPORT
      ? nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' })
      : nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  }
  return mailer;
}
function htmlEscape(value) {
  return String(value || '').replace(/[&<>'"]/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]);
}
function publicBaseUrl(req) {
  if (APP_BASE_URL) return APP_BASE_URL;
  const host = String(req.headers.host || '').replace(/[\r\n]/g, '');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return `${forwardedProto === 'https' ? 'https' : 'http'}://${host}`;
}
function tokenHash(purpose, token) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(`${purpose}:${token}`).digest('hex');
}
function newEmailToken() { return crypto.randomBytes(32).toString('base64url'); }
function tokenRecord(purpose, token, ttlMinutes) {
  return { tokenHash: tokenHash(purpose, token), expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(), sentAt: new Date().toISOString() };
}
function hasUsableToken(record, purpose, token) {
  if (!record || !record.tokenHash || !record.expiresAt || Date.parse(record.expiresAt) < Date.now()) return false;
  const expected = Buffer.from(record.tokenHash, 'hex');
  const received = Buffer.from(tokenHash(purpose, token), 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
function emailRateLimitKey(req, purpose, email) { return `${getClientIp(req)}:${purpose}:${email || '-'}`; }
function isEmailRateLimited(key) {
  const now = Date.now(); const attempts = (emailSendAttempts.get(key) || []).filter(time => now - time < EMAIL_SEND_RATE_WINDOW_MS);
  emailSendAttempts.set(key, attempts); return attempts.length >= EMAIL_SEND_RATE_MAX;
}
function recordEmailAttempt(key) {
  const now = Date.now(); const attempts = (emailSendAttempts.get(key) || []).filter(time => now - time < EMAIL_SEND_RATE_WINDOW_MS);
  attempts.push(now); emailSendAttempts.set(key, attempts);
}
async function sendVerificationEmail(req, user, token) {
  const url = `${publicBaseUrl(req)}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await getMailer().sendMail({ from: SMTP_FROM, to: user.email, subject: '请验证你的拾光成长邮箱', text: `你好，${user.displayName}。请在 ${EMAIL_VERIFY_TTL_MINUTES} 分钟内打开以下链接验证邮箱：${url}`, html: `<p>你好，${htmlEscape(user.displayName)}：</p><p>请在 ${EMAIL_VERIFY_TTL_MINUTES} 分钟内点击链接验证你的拾光成长邮箱：</p><p><a href="${htmlEscape(url)}">验证邮箱</a></p><p>如果不是你本人注册，请忽略此邮件。</p>` });
}
async function sendPasswordResetEmail(req, user, token) {
  const url = `${publicBaseUrl(req)}/?reset_token=${encodeURIComponent(token)}`;
  await getMailer().sendMail({ from: SMTP_FROM, to: user.email, subject: '重置你的拾光成长密码', text: `你好，${user.displayName}。请在 ${PASSWORD_RESET_TTL_MINUTES} 分钟内打开以下链接设置新密码：${url}`, html: `<p>你好，${htmlEscape(user.displayName)}：</p><p>请在 ${PASSWORD_RESET_TTL_MINUTES} 分钟内点击链接设置新密码：</p><p><a href="${htmlEscape(url)}">重置密码</a></p><p>如果不是你本人发起，请忽略此邮件；你的密码不会因此改变。</p>` });
}
function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end();
}
function emailActionPage(title, message) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}</title><body style="margin:0;background:#f5f6fa;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1d21"><main style="max-width:480px;margin:12vh auto;padding:32px;background:#fff;border-radius:18px;box-shadow:0 12px 35px rgba(20,24,40,.12);text-align:center"><div style="font-size:42px">🌅</div><h1 style="font-size:22px">${htmlEscape(title)}</h1><p style="line-height:1.7;color:#59606b">${htmlEscape(message)}</p><a href="/" style="display:inline-block;margin-top:12px;background:#2a78d6;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:700">返回拾光成长</a></main></body></html>`;
}
function html(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(body);
}

function normalizeReply(value) {
  if (!value || typeof value !== 'object') return null;
  const reply = {
    point: String(value.point || value['核心观点'] || value['观点'] || '').trim(),
    script: String(value.script || value['话术模板'] || value['话术'] || '').trim(),
    avoid: String(value.avoid || value['避坑提醒'] || value['避坑'] || '').trim()
  };
  return reply.point || reply.script || reply.avoid ? reply : null;
}

function parseModelReply(text) {
  if (text && typeof text === 'object') {
    if (Array.isArray(text)) return parseModelReply(text.map(item => item && (item.text || item.content || item.value || '')).join(''));
    return normalizeReply(text);
  }
  if (typeof text !== 'string') return null;
  const clean = text.trim();
  if (!clean) return null;
  try { return normalizeReply(JSON.parse(clean)); } catch (_) {}
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = normalizeReply(JSON.parse(match[0]));
      if (parsed) return parsed;
    } catch (_) {}
  }
  // 某些兼容接口忽略 response_format，返回普通文本；这仍是上游真实回复。
  return { point: clean.slice(0, 4000), script: '', avoid: '' };
}

function extractProviderContent(data) {
  const message = data?.choices?.[0]?.message || {};
  const candidates = [
    message.content,
    message.reasoning_content,
    data?.choices?.[0]?.text,
    data?.output_text,
    data?.output?.[0]?.content,
  ];
  for (const candidate of candidates) {
    if (candidate && (typeof candidate === 'string' || typeof candidate === 'object')) return candidate;
  }
  return '';
}

async function callProvider(message) {
  if (!AI_API_KEY) throw new Error('AI_API_KEY is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch(AI_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: AI_TEMPERATURE,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: message }],
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`provider returned ${response.status}`);
    const data = await response.json();
    const content = extractProviderContent(data);
    const reply = parseModelReply(content);
    if (!reply) throw new Error('provider returned empty reply');
    return reply;
  } finally { clearTimeout(timer); }
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('multipart/form-data')) return reject(new Error('multipart/form-data is required'));
    const fields = {};
    const files = {};
    const chunks = [];
    let total = 0;
    let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    let bb;
    try {
      bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 10 } });
    } catch (error) { return fail(error); }
    bb.on('field', (name, value) => { fields[name] = value; });
    bb.on('file', (name, stream, info) => {
      stream.on('data', chunk => { total += chunk.length; chunks.push(chunk); });
      stream.on('limit', () => fail(new Error('audio file too large')));
      stream.on('end', () => {
        files[name] = { buffer: Buffer.concat(chunks), mimeType: info.mimeType, filename: info.filename };
      });
    });
    bb.on('error', fail);
    bb.on('finish', () => {
      if (settled) return;
      if (total > MAX_AUDIO_BYTES) return fail(new Error('audio file too large'));
      settled = true;
      resolve({ fields, files });
    });
    req.pipe(bb);
  });
}

function createIflytekUrl() {
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${IFLYTEK_HOST}\ndate: ${date}\nGET ${IFLYTEK_PATH} HTTP/1.1`;
  const signature = crypto.createHmac('sha256', IFLYTEK_API_SECRET).update(signatureOrigin).digest('base64');
  const authorizationOrigin = `api_key="${IFLYTEK_API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const params = new URLSearchParams({
    authorization: Buffer.from(authorizationOrigin).toString('base64'),
    date,
    host: IFLYTEK_HOST
  });
  return `wss://${IFLYTEK_HOST}${IFLYTEK_PATH}?${params.toString()}`;
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function decodeResult(value) {
  if (!value) return null;
  try { return xmlParser.parse(Buffer.from(value, 'base64').toString('utf8')); } catch (_) {}
  try { return xmlParser.parse(String(value)); } catch (_) { return null; }
}

function findNumber(root, names) {
  if (root === null || root === undefined) return null;
  if (typeof root !== 'object') return null;
  for (const name of names) {
    if (root[name] !== undefined && Number.isFinite(Number(root[name]))) return Number(root[name]);
  }
  for (const value of Object.values(root)) {
    const found = findNumber(value, names);
    if (found !== null) return found;
  }
  return null;
}

function extractIflytekScores(result) {
  const root = decodeResult(result);
  const pick = (names, fallback = null) => {
    const value = findNumber(root, names);
    return value === null ? fallback : Math.max(0, Math.min(100, Math.round(value)));
  };
  return {
    total: pick(['total_score', 'totalScore', 'overall_score']),
    fluency: pick(['fluency_score', 'fluencyScore']),
    completeness: pick(['integrity_score', 'integrityScore', 'completeness']),
    pronunciation: pick(['phone_score', 'pronunciation_score', 'standard_score']),
    tone: pick(['tone_score', 'emotion_score']),
    raw: root
  };
}

function evaluateWithIflytek({ audio, targetText }) {
  if (!IFLYTEK_APP_ID || !IFLYTEK_API_KEY || !IFLYTEK_API_SECRET) {
    throw new Error('IFLYTEK credentials are not configured');
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(createIflytekUrl());
    const results = [];
    const frameSize = 1280;
    const frameIntervalMs = 40;
    const text = Buffer.from(`\ufeff${targetText}`, 'utf8').toString('base64');
    let state = 'CONNECTING';
    let offset = 0;
    let timer = null;
    let frameTimer = null;
    let finished = false;

    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (frameTimer) clearTimeout(frameTimer);
      if (error) {
        state = 'ERROR';
        try { ws.terminate(); } catch (_) {}
        reject(error);
      } else {
        state = 'DONE';
        try { ws.close(); } catch (_) {}
        resolve(value);
      }
    };

    const fail = message => finish(new Error(message));
    const sendJson = payload => {
      if (finished || ws.readyState !== WebSocket.OPEN) return fail(`iFlytek socket is not open while in ${state}`);
      ws.send(JSON.stringify(payload));
    };
    const sendAudio = (chunk, aus, status) => {
      sendJson({
        business: { cmd: 'auw', aus },
        data: { status, data: chunk.toString('base64'), format: 'audio/L16;rate=16000', encoding: 'raw' }
      });
    };
    const scheduleNext = () => {
      if (!finished) frameTimer = setTimeout(sendNextFrame, frameIntervalMs);
    };
    const sendNextFrame = () => {
      if (finished || state !== 'STREAMING') return;
      if (offset >= audio.length) {
        state = 'WAITING_RESULT';
        sendAudio(Buffer.alloc(0), 4, 2);
        return;
      }
      const chunk = audio.subarray(offset, Math.min(offset + frameSize, audio.length));
      offset += chunk.length;
      const isLast = offset >= audio.length;
      sendAudio(chunk, isLast ? 4 : 2, isLast ? 2 : 1);
      if (isLast) state = 'WAITING_RESULT';
      else scheduleNext();
    };

    timer = setTimeout(() => fail(`iFlytek evaluation timeout in state ${state}`), IFLYTEK_TIMEOUT_MS);

    ws.on('open', () => {
      state = 'SENDING_FIRST';
      const firstChunk = audio.subarray(0, Math.min(frameSize, audio.length));
      offset = firstChunk.length;
      sendJson({
        common: { app_id: IFLYTEK_APP_ID },
        business: { sub: 'ise', ent: 'cn_vip', category: 'read_sentence', cmd: 'auw', aus: 1, auf: 'audio/L16;rate=16000', aue: 'raw', rstcd: 'utf8', text },
        data: { status: 1, data: firstChunk.toString('base64'), format: 'audio/L16;rate=16000', encoding: 'raw' }
      });
      if (offset >= audio.length) state = 'WAITING_RESULT';
      else { state = 'STREAMING'; scheduleNext(); }
    });

    ws.on('message', raw => {
      if (finished) return;
      let packet;
      try { packet = JSON.parse(raw.toString('utf8')); }
      catch (_) { return fail('iFlytek returned invalid JSON'); }
      if (packet.code !== undefined && Number(packet.code) !== 0) return fail(`iFlytek returned ${packet.code}: ${packet.message || ''}`);
      if (packet.sid) results.push({ sid: packet.sid });
      if (packet.data?.data) results.push({ frame: packet, result: packet.data.data });
      if (packet.data?.status === 2 || packet.status === 2) {
        const lastResult = results.slice().reverse().find(item => item.result);
        if (!lastResult) return fail('iFlytek returned final status without evaluation data');
        const scores = extractIflytekScores(lastResult.result);
        finish(null, { scores, rawResult: results });
      }
    });
    ws.on('error', error => finish(error));
    ws.on('close', () => {
      if (!finished) fail(`iFlytek socket closed in state ${state}`);
    });
  });
}

function buildSpeechScores(iflytek, targetText, durationMs) {
  const source = iflytek || {};
  const fallback = Number.isFinite(source.total) ? source.total : 0;
  return {
    accuracy: source.pronunciation ?? fallback,
    fluency: source.fluency ?? fallback,
    completeness: source.completeness ?? fallback,
    speed: source.fluency ?? fallback,
    tone: source.tone ?? fallback,
    total: source.total ?? fallback,
    durationMs: Number(durationMs || 0),
    targetLength: String(targetText || '').length
  };
}

async function scoreSpeechRequest({ audio, targetText, durationMs }) {
  const evaluated = await evaluateWithIflytek({ audio, targetText });
  const scores = buildSpeechScores(evaluated.scores, targetText, durationMs);
  return { scores, transcript: '', feedback: null, provider: 'iflytek-ise', raw: evaluated.scores.raw };
}

function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname); }
  catch (_) { return json(res, 400, { error: 'invalid url' }, req.headers.origin); }
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(ROOT, '.' + requested);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'not found' }, req.headers.origin);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  let requestUrl;
  try { requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch (_) { return json(res, 400, { error: 'invalid url' }, origin); }
  const pathname = requestUrl.pathname;
  if (req.method === 'OPTIONS') {
    const allowed = !origin || CORS_ORIGINS.includes(origin);
    res.writeHead(allowed ? 204 : 403, allowed ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' } : {});
    return res.end();
  }
  if (req.method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { ok: true, configured: Boolean(AI_API_KEY), speechConfigured: Boolean(IFLYTEK_APP_ID && IFLYTEK_API_KEY && IFLYTEK_API_SECRET), emailConfigured: isMailerConfigured(), emailLogin: true, privacyPolicyVersion: PRIVACY_POLICY_VERSION, model: AI_MODEL }, origin);
  }
  if (req.method === 'POST' && pathname === '/api/auth/register') {
    try {
      if (!isMailerConfigured()) return json(res, 503, { error: '邮箱服务暂未配置，请稍后重试' }, origin);
      const body = JSON.parse(await readBody(req) || '{}'); const email = normalizeEmail(body.email); const passwordError = validatePassword(body.password); const emailKey = emailRateLimitKey(req, 'register', email);
      if (!email) return json(res, 400, { error: '请输入有效的邮箱地址' }, origin);
      if (isEmailRateLimited(emailKey)) return json(res, 429, { error: '发送次数过多，请 15 分钟后再试' }, origin);
      if (passwordError) return json(res, 400, { error: passwordError }, origin);
      if (body.privacyAccepted !== true || body.privacyPolicyVersion !== PRIVACY_POLICY_VERSION) return json(res, 400, { error: '请阅读并同意当前版本的隐私政策' }, origin);
      const store = readStore();
      if (store.users.some(user => user.email === email)) return json(res, 409, { error: '该邮箱已注册，请直接登录或重新发送验证邮件' }, origin);
      const now = new Date().toISOString(), token = newEmailToken();
      const user = { id: crypto.randomUUID(), email, displayName: normalizeDisplayName(body.displayName, email.split('@')[0]), passwordHash: hashPassword(String(body.password)), createdAt: now, updatedAt: now, sessionVersion: 1, emailVerifiedAt: null, emailVerification: tokenRecord('verify', token, EMAIL_VERIFY_TTL_MINUTES), passwordReset: null, privacyConsent: { version: PRIVACY_POLICY_VERSION, acceptedAt: now } };
      store.users.push(user); writeStore(store);
      await sendVerificationEmail(req, user, token); recordEmailAttempt(emailKey);
      return json(res, 202, { verificationRequired: true, message: '验证邮件已发送，请打开邮箱完成验证后登录' }, origin);
    } catch (error) { console.error('[Auth] registration email failed:', error.message); return json(res, 503, { error: '验证邮件发送失败，请检查邮箱服务后重试' }, origin); }
  }
  if (req.method === 'GET' && pathname === '/api/auth/verify-email') {
    try {
      const token = requestUrl.searchParams.get('token') || ''; const store = readStore();
      const user = store.users.find(item => !item.emailVerifiedAt && hasUsableToken(item.emailVerification, 'verify', token));
      if (!user) return html(res, 400, emailActionPage('验证链接无效', '链接可能已过期、已被使用，或不完整。请返回登录页重新发送验证邮件。'));
      user.emailVerifiedAt = new Date().toISOString(); user.emailVerification = null; user.updatedAt = user.emailVerifiedAt; writeStore(store);
      return redirect(res, `${publicBaseUrl(req)}/?email_verified=1`);
    } catch (error) { console.error('[Auth] verification failed:', error.message); return html(res, 503, emailActionPage('暂时无法验证邮箱', '服务暂时不可用，请稍后重试。')); }
  }
  if (req.method === 'POST' && pathname === '/api/auth/resend-verification') {
    try {
      if (!isMailerConfigured()) return json(res, 503, { error: '邮箱服务暂未配置，请稍后重试' }, origin);
      const body = JSON.parse(await readBody(req) || '{}'); const email = normalizeEmail(body.email); const key = emailRateLimitKey(req, 'verify', email);
      if (!email) return json(res, 400, { error: '请输入有效的邮箱地址' }, origin);
      if (isEmailRateLimited(key)) return json(res, 429, { error: '发送次数过多，请 15 分钟后再试' }, origin);
      const store = readStore(), user = store.users.find(item => item.email === email);
      if (user && !user.emailVerifiedAt) { const token = newEmailToken(); user.emailVerification = tokenRecord('verify', token, EMAIL_VERIFY_TTL_MINUTES); user.updatedAt = new Date().toISOString(); writeStore(store); await sendVerificationEmail(req, user, token); recordEmailAttempt(key); }
      return json(res, 200, { ok: true, message: '如该邮箱存在未验证账号，验证邮件已发送' }, origin);
    } catch (error) { console.error('[Auth] resend verification failed:', error.message); return json(res, 503, { error: '验证邮件暂时无法发送，请稍后重试' }, origin); }
  }
  if (req.method === 'POST' && pathname === '/api/auth/forgot-password') {
    try {
      if (!isMailerConfigured()) return json(res, 503, { error: '邮箱服务暂未配置，请稍后重试' }, origin);
      const body = JSON.parse(await readBody(req) || '{}'); const email = normalizeEmail(body.email); const key = emailRateLimitKey(req, 'reset', email);
      if (!email) return json(res, 400, { error: '请输入有效的邮箱地址' }, origin);
      if (isEmailRateLimited(key)) return json(res, 429, { error: '发送次数过多，请 15 分钟后再试' }, origin);
      const store = readStore(), user = store.users.find(item => item.email === email);
      if (user && user.emailVerifiedAt) { const token = newEmailToken(); user.passwordReset = tokenRecord('reset', token, PASSWORD_RESET_TTL_MINUTES); user.updatedAt = new Date().toISOString(); writeStore(store); await sendPasswordResetEmail(req, user, token); recordEmailAttempt(key); }
      return json(res, 200, { ok: true, message: '如果该邮箱已注册且完成验证，重置邮件已发送' }, origin);
    } catch (error) { console.error('[Auth] reset request failed:', error.message); return json(res, 503, { error: '重置邮件暂时无法发送，请稍后重试' }, origin); }
  }
  if (req.method === 'POST' && pathname === '/api/auth/reset-password') {
    try {
      const body = JSON.parse(await readBody(req) || '{}'), token = typeof body.token === 'string' ? body.token : '', passwordError = validatePassword(body.password);
      if (!token || token.length > 256) return json(res, 400, { error: '重置链接无效或不完整' }, origin);
      if (passwordError) return json(res, 400, { error: passwordError }, origin);
      const store = readStore(), user = store.users.find(item => hasUsableToken(item.passwordReset, 'reset', token));
      if (!user) return json(res, 400, { error: '重置链接无效或已过期，请重新申请' }, origin);
      user.passwordHash = hashPassword(String(body.password)); user.passwordReset = null; user.sessionVersion = (user.sessionVersion || 1) + 1; user.updatedAt = new Date().toISOString(); writeStore(store);
      return json(res, 200, { ok: true, message: '密码已重置，请使用新密码登录' }, origin, { 'Set-Cookie': clearSessionCookie() });
    } catch (error) { console.error('[Auth] password reset failed:', error.message); return json(res, 500, { error: '密码重置暂时不可用，请稍后重试' }, origin); }
  }
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    try {
      const body = JSON.parse(await readBody(req) || '{}'); const email = normalizeEmail(body.email); const key = rateLimitKey(req, email);
      if (!email || typeof body.password !== 'string') return json(res, 400, { error: '请输入邮箱和密码' }, origin);
      if (isRateLimited(key)) return json(res, 429, { error: '尝试次数过多，请 15 分钟后再试' }, origin);
      const user = readStore().users.find(item => item.email === email);
      if (!user || !verifyPassword(body.password, user.passwordHash)) { recordFailedAttempt(key); return json(res, 401, { error: '邮箱或密码不正确' }, origin); }
      if (!user.emailVerifiedAt) return json(res, 403, { error: '请先完成邮箱验证后再登录', needsVerification: true }, origin);
      clearFailedAttempts(key); return json(res, 200, { user: toPublicUser(user) }, origin, { 'Set-Cookie': sessionCookie(createSession(user)) });
    } catch (error) { console.error('[Auth] login failed:', error.message); return json(res, 500, { error: '账号服务暂时不可用，请稍后重试' }, origin); }
  }
  if (req.method === 'GET' && pathname === '/api/auth/session') {
    try { const user = currentSessionUser(req); return json(res, 200, { user: user ? toPublicUser(user) : null }, origin); }
    catch (error) { console.error('[Auth] session failed:', error.message); return json(res, 500, { error: '账号服务暂时不可用，请稍后重试' }, origin); }
  }
  if (req.method === 'POST' && pathname === '/api/auth/logout') return json(res, 200, { ok: true }, origin, { 'Set-Cookie': clearSessionCookie() });
  if (req.method === 'GET' && pathname === '/api/account/export') {
    try { const user = currentSessionUser(req); if (!user) return json(res, 401, { error: '请先登录' }, origin); return json(res, 200, { exportedAt: new Date().toISOString(), account: { ...toPublicUser(user), privacyConsent: user.privacyConsent || null }, notice: '当前成长记录仍存储在你的浏览器，请同时使用“导出本机数据”。' }, origin); }
    catch (error) { console.error('[Auth] export failed:', error.message); return json(res, 500, { error: '账号服务暂时不可用，请稍后重试' }, origin); }
  }
  if (req.method === 'DELETE' && pathname === '/api/account') {
    try {
      const user = currentSessionUser(req); const body = JSON.parse(await readBody(req) || '{}');
      if (!user) return json(res, 401, { error: '请先登录' }, origin);
      if (normalizeEmail(body.confirmEmail) !== user.email) return json(res, 400, { error: '请填写当前账号邮箱以确认删除' }, origin);
      const store = readStore(); store.users = store.users.filter(item => item.id !== user.id); writeStore(store);
      return json(res, 200, { ok: true }, origin, { 'Set-Cookie': clearSessionCookie() });
    } catch (error) { console.error('[Auth] deletion failed:', error.message); return json(res, 500, { error: '账号服务暂时不可用，请稍后重试' }, origin); }
  }
  if (req.method === 'POST' && pathname === '/api/ai/chat') {
    try {
      const payload = JSON.parse(await readBody(req) || '{}');
      const message = typeof payload.message === 'string' ? payload.message.trim() : '';
      if (!message || message.length > 4000) return json(res, 400, { error: 'message must be 1-4000 characters' }, origin);
      const reply = await callProvider(message);
      return json(res, 200, { ...reply, meta: { source: 'provider', model: safeModelName } }, origin);
    } catch (error) {
      console.error('[AI] request failed:', error.message);
      return json(res, error.message === 'AI_API_KEY is not configured' ? 503 : 502, { error: 'AI service temporarily unavailable' }, origin);
    }
  }
  if (req.method === 'POST' && pathname === '/api/ai/speech-score') {
    try {
      const form = await parseMultipart(req);
      const targetText = String(form.fields.targetText || '').trim();
      const durationMs = Number(form.fields.durationMs || 0);
      const audio = form.files.audio?.buffer;
      if (!audio || !audio.length || !targetText) return json(res, 400, { error: 'audio and targetText are required' }, origin);
      if (targetText.length > 500) return json(res, 400, { error: 'targetText is too long' }, origin);
      const result = await scoreSpeechRequest({ audio, targetText, durationMs });
      return json(res, 200, { ok: true, result }, origin);
    } catch (error) {
      console.error('[Speech] request failed:', error.message);
      const notConfigured = error.message.includes('credentials are not configured');
      const status = notConfigured ? 503 : 502;
      const detail = notConfigured ? '请在 .env 中配置 IFLYTEK_APP_ID、IFLYTEK_API_KEY、IFLYTEK_API_SECRET。' : error.message;
      const code = notConfigured
        ? 'IFLYTEK_NOT_CONFIGURED'
        : /10222|DeadlineExceeded|timeout/i.test(error.message)
          ? 'IFLYTEK_TIMEOUT'
          : /48195|iSEInputAppend/i.test(error.message)
            ? 'IFLYTEK_AUDIO_STREAM'
            : /10163|param validate/i.test(error.message)
              ? 'IFLYTEK_PARAM'
              : /30002|30011/i.test(error.message)
                ? 'IFLYTEK_FRAME'
                : 'IFLYTEK_UPSTREAM_ERROR';
      return json(res, status, {
        ok: false,
        error: notConfigured ? 'iFlytek speech service is not configured' : 'iFlytek speech evaluation failed',
        code,
        detail
      }, origin);
    }
  }
  if (req.method === 'GET') return serveStatic(req, res);
  return json(res, 405, { error: 'method not allowed' }, origin);
});

server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`拾光成长 AI server listening on http://${process.env.HOST || '0.0.0.0'}:${PORT}`);
});
