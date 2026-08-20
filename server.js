const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Busboy = require('busboy');
const WebSocket = require('ws');
const { XMLParser } = require('fast-xml-parser');

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
const ROOT = __dirname;

const SYSTEM_PROMPT = `你是「拾光成长」App 的职场成长助手，服务于 22-40 岁职场人。
针对用户的问题，用中文、口语化、可直接执行的方式回复。
只输出一个 JSON 对象，不要任何多余文字，字段如下：
{"point":"核心观点（一句话点破本质）","script":"话术模板（可直接说出口的一句话，用「」括起来）","avoid":"避坑提醒（一句话）"}
如果问题与职场无关，也尽量引导回职场成长场景。`;

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function json(res, status, body, origin) {
  const allowOrigin = origin && (CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin)) ? origin : '';
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin, Vary: 'Origin' } : {})
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
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') {
    const allowed = !origin || CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin);
    res.writeHead(allowed ? 204 : 403, allowed ? { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' } : {});
    return res.end();
  }
  if (req.method === 'GET' && req.url === '/api/health') {
    return json(res, 200, { ok: true, configured: Boolean(AI_API_KEY), speechConfigured: Boolean(IFLYTEK_APP_ID && IFLYTEK_API_KEY && IFLYTEK_API_SECRET), model: AI_MODEL }, origin);
  }
  if (req.method === 'POST' && req.url === '/api/ai/chat') {
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
  if (req.method === 'POST' && req.url === '/api/ai/speech-score') {
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
