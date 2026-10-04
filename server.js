import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import './src/env.js';

import { createCareer, migrateCareer, careerView, deployProbability, hubAct, settle } from './src/career.js';
import { probabilityRaidView, actProbabilityRaid } from './src/probability-raid.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const SAVES = path.resolve(process.env.GAME_SAVE_DIR || path.join(__dirname, 'data', 'saves'));
const PORT = Number(process.env.PORT || 5173);

await fsp.mkdir(SAVES, { recursive: true });

const sessions = new Map();
const saveQueues = new Map();
const loadQueues = new Map();
const initQueues = new Map();
const mutationQueues = new Map();
async function loadCareerFromDisk(sid) {
  if (sessions.has(sid)) return sessions.get(sid);
  const file = path.join(SAVES, `${sid}.json`);
  try {
    const rawText = await fsp.readFile(file, 'utf8');
    const raw = JSON.parse(rawText);
    const career = migrateCareer(raw);
    const recovered = raw.version !== 2 || Boolean(raw.run && !career.run);
    if (recovered) {
      try {
        await fsp.copyFile(file, `${file}.pre-current.bak`, fsp.constants.COPYFILE_EXCL).catch(error => {
          if (error.code !== 'EEXIST') throw error;
        });
        await saveCareer(sid, career);
      } catch (error) {
        sessions.delete(sid);
        throw error;
      }
    } else sessions.set(sid, career);
    return career;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function loadCareer(sid) {
  if (sessions.has(sid)) return sessions.get(sid);
  if (loadQueues.has(sid)) return loadQueues.get(sid);
  const pending = loadCareerFromDisk(sid);
  loadQueues.set(sid, pending);
  try { return await pending; }
  finally { if (loadQueues.get(sid) === pending) loadQueues.delete(sid); }
}

async function saveCareer(sid, career) {
  sessions.set(sid, career);
  const previous = saveQueues.get(sid) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
    const file = path.join(SAVES, `${sid}.json`);
    const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(career), 'utf8');
    try {
      await fsp.rename(tmp, file);
    } catch (error) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  });
  saveQueues.set(sid, write);
  try {
    await write;
  } finally {
    if (saveQueues.get(sid) === write) saveQueues.delete(sid);
  }
}

async function ensureCareer(sid) {
  if (sessions.has(sid)) return sessions.get(sid);
  if (initQueues.has(sid)) return initQueues.get(sid);
  const pending = (async () => {
    let career = await loadCareer(sid);
    if (!career) {
      career = createCareer((Date.now() ^ crypto.randomInt(0x100000000)) >>> 0);
      await saveCareer(sid, career);
    }
    return career;
  })();
  initQueues.set(sid, pending);
  try { return await pending; }
  finally { if (initQueues.get(sid) === pending) initQueues.delete(sid); }
}

function statePayload(career) {
  const runView = career.run ? probabilityRaidView(career.run) : null;
  const phase = !career.run ? 'hub' : career.run.status === 'ended' ? 'result' : 'raid';
  return { ok: true, phase, hub: careerView(career), view: runView };
}

// A file write queue does not protect the game state. Commands commit
// their mutation, RNG state, settlement and retry receipt under one session lock.
async function withMutation(sid, callback) {
  const previous = mutationQueues.get(sid) || Promise.resolve();
  const current = previous.catch(() => {}).then(callback);
  mutationQueues.set(sid, current);
  try { return await current; }
  finally { if (mutationQueues.get(sid) === current) mutationQueues.delete(sid); }
}

function requestFingerprint(route, body) {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const payload = { ...body };
  delete payload.requestId;
  return crypto.createHash('sha256').update(JSON.stringify([route, canonical(payload)])).digest('hex');
}

async function commitCommand(sid, route, body, callback, required = true) {
  return withMutation(sid, async () => {
    const career = await ensureCareer(sid);
    const requestId = typeof body.requestId === 'string' ? body.requestId : null;
    if ((required || requestId !== null) && (!requestId || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId))) {
      return { ...statePayload(career), ok: false, reason: '请为本次操作提供有效的请求编号。' };
    }
    const fingerprint = requestFingerprint(route, body);
    const receipts = Array.isArray(career.profile.requestReceipts) ? career.profile.requestReceipts : [];
    const previous = requestId && receipts.find(row => row.id === requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return { ...statePayload(career), ok: false, reason: '这个请求编号已用于另一项操作，请刷新后重试。' };
      return { ...statePayload(career), ok: previous.result.ok, reason: previous.result.reason || null,
        actionResult: previous.result, replayed: true };
    }
    const before = structuredClone(career);
    try {
      const result = callback(career);
      // Keep the durable receipt: evicting old IDs would let a late retry repeat
      // a purchase or deployment after enough unrelated commands.
      if (requestId) career.profile.requestReceipts = [...receipts, { id: requestId, fingerprint, result: structuredClone(result) }];
      await saveCareer(sid, career);
      return { ...statePayload(career), ok: result.ok, reason: result.reason || null, actionResult: result };
    } catch (error) {
      // Failed persistence must not leave a successful-looking in-memory action.
      sessions.set(sid, before);
      throw error;
    }
  });
}

// ---------------------------------------------------------------- HTTP helpers

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

async function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, ''); }
  catch { res.writeHead(400); return res.end('bad path'); }
  const full = path.resolve(PUBLIC, rel);
  if (full !== PUBLIC && !full.startsWith(`${PUBLIC}${path.sep}`)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  try {
    const data = await fsp.readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}

// ---------------------------------------------------------------- routes

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { res.writeHead(400); return res.end('bad request'); }
  const route = url.pathname;
  if (!route.startsWith('/api/')) return serveStatic(req, res, route);

  const cookies = parseCookies(req);
  let sid = cookies.sid;
  if (!sid || !/^[a-f0-9]{24}$/.test(sid)) {
    sid = crypto.randomBytes(12).toString('hex');
    res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  }

  try {
    if (route === '/api/meta' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, defaultMode: 'probability', rulesVersion: '0.7.0', aiEnabled: false,
        features: ['probability-expedition', 'encounter-pacing', 'research', 'warehouse-upgrade'] });
    }

    if ((route === '/api/state' || route === '/api/hub') && req.method === 'GET') {
      if (mutationQueues.has(sid)) await mutationQueues.get(sid).catch(() => {});
      const career = await ensureCareer(sid);
      return sendJson(res, 200, statePayload(career));
    }

    if (route === '/api/hub/action' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await commitCommand(sid, route, body, career => hubAct(career, String(body.action || '')), false);
      return sendJson(res, 200, result);
    }

    if (route === '/api/hub/return' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await commitCommand(sid, route, body, career => {
        if (career.run?.status === 'playing') return { ok: false, reason: '本局尚未结束，暂时不能返回工位。' };
        if (career.run) settle(career);
        career.run = null;
        return { ok: true };
      }, false);
      return sendJson(res, 200, result);
    }

    if (route === '/api/new' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.mode && body.mode !== 'probability') return sendJson(res, 400, { ok: false, reason: '当前只支持正式概率远征。' });
      const result = await commitCommand(sid, route, body, career => {
        const options = { seed: crypto.randomInt(0x100000000) };
        for (const key of ['venue', 'difficulty', 'target', 'strategy']) {
          if (Object.hasOwn(body, key)) options[key] = body[key];
        }
        return deployProbability(career, options);
      });
      return sendJson(res, 200, result);
    }

    if (route === '/api/expedition/action' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await commitCommand(sid, route, body, career => {
        const run = career.run;
        if (!run || run.mode !== 'probability') return { ok: false, reason: '没有进行中的概率远征。' };
        if (typeof body.raidId !== 'string' || body.raidId !== run.raidId) return { ok: false, reason: '远征已经变化，请刷新后再操作。' };
        if (!Number.isInteger(body.revision) || body.revision !== run.revision) return { ok: false, reason: '本轮状态已更新，请根据最新结果重新选择。' };
        const actionResult = actProbabilityRaid(run, String(body.action || ''));
        if (actionResult.ok && run.status === 'ended') settle(career);
        return actionResult;
      });
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { ok: false, reason: 'no such api' });
  } catch (error) {
    // Keep malformed saves intact and do not expose local configuration.
    console.error('[server] request failed');
    return sendJson(res, 500, { ok: false, reason: '服务器暂时无法处理请求。' });
  }
});

server.listen(PORT, () => {
  console.log(`《逃离象牙塔夫》 / Escape from Ivory Towerkov running at http://localhost:${PORT}`);
});
