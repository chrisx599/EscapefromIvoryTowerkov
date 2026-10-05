import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createCareer, hubAct } from '../src/career.js';
import { finishPaper, nextResearchAction } from './research-qa.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, '.artifacts');
const screenshots = [];
const checks = [];
const errors = [];
const externalRequests = [];
let browser;
let server;
let saveDir;
let base;

function fixture(papers = 0) {
  const career = createCareer(123456789);
  career.profile.funding = 100000;
  Object.assign(career.profile.stash, { dataset: 20, src_code: 20, compute: 100 });
  for (let index = 0; index < papers; index++) finishPaper(career.profile, { start: 'replicate' });
  for (const [index, paper] of career.profile.research.papers.entries()) paper.title = `不得展示的历史论文-${index + 1}-<独特内容&证据>`;
  career.profile.research.rng = 1; // Controlled passing promotion draw: these fixtures test immutable paper totals.
  return career;
}

function readyFixture() {
  const career = fixture();
  assert.equal(hubAct(career, 'research:start:replicate').ok, true);
  for (let step = 0; career.profile.research.project.status !== 'ready'; step++) {
    assert.ok(step < 72, 'the fixture must earn acceptance through real research');
    assert.equal(hubAct(career, `research:${nextResearchAction(career.profile.research)}`).ok, true);
  }
  return career;
}

async function startServer() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), GAME_SAVE_DIR: saveDir, LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: '' } });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error('Paper-summary QA server exited before startup');
    try { if ((await fetch(`${base}/api/meta`, { signal: AbortSignal.timeout(300) })).ok) return; } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Paper-summary QA server did not start');
}

async function state(page) {
  const response = await page.request.get('/api/state');
  assert.equal(response.status(), 200);
  return response.json();
}

async function workspace(page) {
  await page.locator('[data-workspace-tab="research"]').click();
  await page.locator('#workspace-panel-research').waitFor({ state: 'visible' });
}

async function assertSummary(page, current, label) {
  const papers = current.hub.research.papers;
  const summary = page.locator('#research-papers');
  assert.equal(await summary.count(), 1);
  assert.equal(await summary.isVisible(), true, `${label}: total is visible without expanding anything`);
  assert.equal((await summary.innerText()).replace(/\s/g, ''), `已录用论文${papers.length.toLocaleString('zh-CN')}篇`);
  assert.equal(Number(await summary.locator('[data-paper-count]').getAttribute('data-paper-count')), papers.length);
  assert.equal(await page.locator('[data-research-detail="papers"], #research-papers :is(details, summary, ul, ol, li, button)').count(), 0,
    'the removed paper list cannot remain as hidden or expandable DOM');
  const html = await page.locator('#research-card').innerHTML();
  for (const paper of papers) {
    const escaped = paper.title.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    assert.equal(html.includes(paper.title), false, 'historic paper titles are absent from markup');
    assert.equal(html.includes(escaped), false, 'historic paper titles are absent from hidden/accessibility attributes too');
  }
  const primary = page.locator('#research-card [data-research-primary]');
  assert.equal(await primary.count(), 1);
  assert.equal(await primary.isVisible(), true);
  assert.equal(await primary.isEnabled(), true);
  const bounds = await primary.boundingBox();
  assert.ok(bounds.height >= 44, `${label}: primary action remains a touch-sized target`);
  const layout = await summary.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const count = element.querySelector('[data-paper-count]').getBoundingClientRect();
    return { width: innerWidth, document: document.documentElement.scrollWidth, left: rect.left, right: rect.right,
      height: rect.height, countLeft: count.left, countRight: count.right };
  });
  assert.ok(layout.document <= layout.width + 1, `${label}: no horizontal page overflow ${JSON.stringify(layout)}`);
  assert.ok(layout.left >= 0 && layout.right <= layout.width + 1 && layout.countLeft >= layout.left && layout.countRight <= layout.right,
    `${label}: total and count fit their visible row`);
  assert.ok(layout.height >= 44 && layout.height <= 64, `${label}: accepted papers occupy one compact row`);
  checks.push({ label, papers: papers.length, ...layout });
}

async function captureLayouts(page, current, label) {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await assertSummary(page, current, `${label}-${width}`);
    await page.locator('#research-papers').scrollIntoViewIfNeeded();
    const file = path.join(ARTIFACTS, `ui-v8-paper-summary-${label}-${width}.png`);
    await page.screenshot({ path: file, fullPage: false });
    screenshots.push(file);
  }
}

async function clickPrimary(page, expectedAction) {
  const primary = page.locator('#research-card [data-research-primary]');
  assert.equal(await primary.getAttribute('data-hub-action'), expectedAction);
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/hub/action'
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === expectedAction);
  await primary.click();
  const response = await pending;
  const body = await response.json();
  assert.equal(body.ok, true, `${expectedAction}: ${body.reason || ''}`);
  await page.waitForFunction(() => !document.body.classList.contains('is-pending'));
  return { current: await state(page), receipt: response.request().postDataJSON() };
}

async function reloadUnchanged(page, before, label) {
  const posts = [];
  const observe = request => { if (request.method() === 'POST') posts.push(request.url()); };
  page.on('request', observe);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#hub-screen').waitFor({ state: 'visible' });
    await workspace(page);
    const after = await state(page);
    assert.deepEqual(after, before, `${label}: reload must preserve the complete API state`);
    assert.deepEqual(posts, [], `${label}: rendering never submits a game action`);
    await assertSummary(page, after, `${label}-reload`);
    return after;
  } finally { page.off('request', observe); }
}

async function scenario(label, career, primaryAction) {
  const sid = randomBytes(12).toString('hex');
  const save = path.join(saveDir, `${sid}.json`);
  const originalPapers = structuredClone(career.profile.research.papers);
  await fs.writeFile(save, JSON.stringify(career), 'utf8');
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'sid', value: sid, url: base }]);
  const page = await context.newPage();
  const posts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'POST') posts.push(url.pathname);
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) externalRequests.push(url.href);
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#hub-screen').waitFor({ state: 'visible' });
    await workspace(page);
    const before = await state(page);
    const storedBefore = await fs.readFile(save, 'utf8');
    assert.equal(before.hub.research.papers.length, originalPapers.length);
    for (const [index, paper] of originalPapers.entries()) {
      for (const [key, value] of Object.entries(paper)) assert.deepEqual(before.hub.research.papers[index][key], value);
    }
    await captureLayouts(page, before, label);
    await page.locator('#research-papers').click();
    await page.locator('[data-workspace-tab="prepare"]').click();
    await workspace(page);
    await reloadUnchanged(page, before, `${label}-read-only`);
    assert.deepEqual(posts, [], 'viewing, resizing, clicking the summary, navigating and reloading submit no mutations');
    assert.equal(await fs.readFile(save, 'utf8'), storedBefore, 'read-only UI does not rewrite persisted records or random state');
    const { current: after, receipt } = await clickPrimary(page, primaryAction);
    if (primaryAction === 'research:publish') {
      assert.equal(after.hub.research.papers.length, before.hub.research.papers.length + 1);
      assert.equal(after.hub.research.project, null);
      assert.deepEqual(after.hub.research.papers.slice(0, -1), before.hub.research.papers);
      await captureLayouts(page, after, 'published');
      assert.equal(await page.locator('#research-card [data-research-primary]').getAttribute('data-hub-action'), 'research:promote');
      const replay = await (await page.request.post('/api/hub/action', { data: receipt })).json();
      assert.equal(replay.replayed, true);
      assert.deepEqual(await state(page), after, 'replayed publication cannot increase the total again');
    } else {
      assert.deepEqual(after.hub.research.papers, before.hub.research.papers, 'starting research or promoting keeps every accepted-paper record');
      if (primaryAction === 'research:promote') assert.equal(after.hub.research.stage, before.hub.research.stage + 1);
      else assert.ok(after.hub.research.project, 'the remaining start action still creates the actual project');
    }
    await reloadUnchanged(page, after, `${label}-primary-action`);
    const storedAfter = JSON.parse(await fs.readFile(save, 'utf8'));
    assert.deepEqual(storedAfter.profile.research.papers, after.hub.research.papers, 'the saved data preserves complete records, not only the visible count');
  } finally { await context.close(); }
}

try {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  saveDir = await fs.mkdtemp(path.join(ARTIFACTS, 'paper-summary-browser-'));
  await startServer();
  const chromePath = [process.env.CHROME_PATH, path.join(ROOT, '.browser-cache/chromium_headless_shell-1161/chrome-linux/headless_shell'),
    '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean).find(existsSync);
  browser = await chromium.launch({ ...(chromePath ? { executablePath: chromePath } : {}), headless: true });
  await scenario('zero', fixture(0), 'research:start:replicate');
  await scenario('one', fixture(1), 'research:promote');
  await scenario('many', fixture(12), 'research:promote');
  const legacy = fixture(3);
  legacy.version = 1;
  for (const paper of legacy.profile.research.papers) delete paper.evidence;
  await scenario('legacy', legacy, 'research:promote');
  await scenario('ready', readyFixture(), 'research:publish');
  assert.deepEqual(errors, [], 'no browser JavaScript errors');
  assert.deepEqual(externalRequests, [], 'QA loads only its isolated localhost app and assets');
  const report = { passed: true, checks, screenshots, browserErrors: errors, externalRequests };
  await fs.writeFile(path.join(ARTIFACTS, 'paper-summary-browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, screenshots }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit').catch(() => {});
    server.kill();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
  }
  if (saveDir && path.dirname(await fs.realpath(saveDir)) === ARTIFACTS) await fs.rm(saveDir, { recursive: true, force: true });
}
