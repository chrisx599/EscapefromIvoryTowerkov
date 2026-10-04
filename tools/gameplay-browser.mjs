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
import { createCareer, careerView, deployProbability, hubAct } from '../src/career.js';
import { actProbabilityRaid, createProbabilityRaid, probabilityRaidView } from '../src/probability-raid.js';
import { finishPaper, nextResearchAction } from './research-qa.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, '.artifacts');
const SHOTS = [];
const errors = [];
const externalRequests = [];
const checks = [];
let browser;
let server;
let saveDir;
let base;

const action = (career, id) => {
  const result = hubAct(career, id);
  assert.equal(result.ok, true, `${id}: ${result.reason || ''}`);
};
const raidAction = (run, id) => {
  const result = actProbabilityRaid(run, id);
  assert.equal(result.ok, true, `${id}: ${result.reason || ''}`);
};

function materialFixture() {
  const career = createCareer(123456789);
  for (const id of ['dataset', 'src_code', ...Array(7).fill('compute')]) action(career, `buy:${id}`);
  return career;
}

function readyForPromotionFixture() {
  const career = materialFixture();
  finishPaper(career.profile, { start: 'replicate' });
  return career;
}

function storyFixture(id) {
  for (let seed = 1; seed <= 300; seed += 1) {
    const career = createCareer(seed * 7919);
    assert.equal(deployProbability(career, { seed: seed * 7919, difficulty: 'easy' }).ok, true);
    for (let search = 0; search < 2 && !career.run.event; search += 1) {
      raidAction(career.run, 'search:cautious');
      if (career.run.pendingLoot.length) raidAction(career.run, 'take:available');
    }
    if (career.run.event?.story?.id === id) return career;
  }
  throw new Error(`No natural opening seed for story ${id}`);
}

function legacyTalentFixture(id, used = false) {
  const career = readyForPromotionFixture();
  action(career, 'research:promote');
  career.profile.research.talent = { id, rank: 1 };
  career.run = createProbabilityRaid({ seed: 7919, raidId: `legacy-${id}-${used}`, difficulty: 'easy', talent: { id, rank: 1 }, network: 2 });
  career.run.bag = ['dataset', 'src_code', 'wind'];
  if (id === 'connector') career.run.event = { id: 'legacy-network', type: 'npc', name: '同学', title: '合作边界', text: '商议合作。', choices: [] };
  if (used) raidAction(career.run, id === 'connector' ? 'event:talent-negotiate' : `talent:${id === 'archivist' ? 'archive' : 'convert'}:0`);
  career.run.stats.risk = 100;
  career.run.rngState = 1;
  return career;
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startServer() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), GAME_SAVE_DIR: saveDir, LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: '' } });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (server.exitCode !== null) throw new Error('Gameplay QA server exited before startup');
    try { if ((await fetch(`${base}/api/meta`, { signal: AbortSignal.timeout(300) })).ok) return; } catch { /* listener startup */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Gameplay QA server did not start');
}

async function scenario(career, run) {
  const sid = randomBytes(12).toString('hex');
  await fs.writeFile(path.join(saveDir, `${sid}.json`), JSON.stringify(career), 'utf8');
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'sid', value: sid, url: base }]);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) externalRequests.push(url.href);
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator(career.run ? '#raid-screen' : '#hub-screen').waitFor({ state: 'visible' });
    await run(page);
  } finally { await context.close(); }
}

async function state(page) {
  const result = await page.evaluate(async () => { const response = await fetch('/api/state', { cache: 'no-store' }); return { status: response.status, body: await response.json() }; });
  assert.equal(result.status, 200);
  return result.body;
}

async function workspace(page, id) {
  await page.locator(`[data-workspace-tab="${id}"]`).click();
  await page.locator(`#workspace-panel-${id}`).waitFor({ state: 'visible' });
}

async function clickAction(page, id, hub = true) {
  const attr = hub ? 'data-hub-action' : 'data-action';
  const route = hub ? '/api/hub/action' : '/api/expedition/action';
  const locator = page.locator(`[${attr}="${id}"]:visible`).first();
  await locator.waitFor({ state: 'visible' });
  assert.equal(await locator.isEnabled(), true, `${id} must be enabled in this fixture`);
  const response = page.waitForResponse(response => new URL(response.url()).pathname === route
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === id);
  await locator.click();
  const body = await (await response).json();
  assert.equal(body.ok, true, `${id}: ${body.reason || ''}`);
  await page.waitForFunction(() => !document.body.classList.contains('is-pending'));
  return state(page);
}

async function reloadUnchanged(page, before, label) {
  const posts = [];
  const listener = request => { if (request.method() === 'POST') posts.push(request.url()); };
  page.on('request', listener);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator(before.phase === 'raid' ? '#raid-screen' : before.phase === 'result' ? '#result-screen' : '#hub-screen').waitFor({ state: 'visible' });
    const after = await state(page);
    assert.equal(after.phase, before.phase, `${label}: phase`);
    assert.equal(after.hub.funding, before.hub.funding, `${label}: funds`);
    assert.deepEqual(after.hub.research, before.hub.research, `${label}: research`);
    assert.deepEqual(after.hub.stories, before.hub.stories, `${label}: persistent stories`);
    if (before.view) assert.deepEqual(after.view, before.view, `${label}: raid state and RNG projection`);
    assert.deepEqual(posts, [], `${label}: reload must not submit an action`);
    return after;
  } finally { page.off('request', listener); }
}

async function fits(page, label) {
  const layout = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(layout.document <= layout.width + 1, `${label}: horizontal overflow ${JSON.stringify(layout)}`);
  checks.push({ label, ...layout });
}

async function captureLayouts(page, selector, prefix) {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const surface = page.locator(selector);
    await surface.scrollIntoViewIfNeeded();
    await fits(page, `${prefix}-${width}`);
    const file = path.join(ARTIFACTS, `${prefix}-${width === 1440 ? 'desktop' : width === 390 ? 'mobile' : '320'}.png`);
    await page.screenshot({ path: file, fullPage: false });
    SHOTS.push(file);
  }
}

async function promotionScenario(page, label, completePaper) {
  await workspace(page, 'research');
  if (completePaper) {
    await clickAction(page, 'research:start:replicate');
    for (let attempt = 0; attempt < 72; attempt += 1) {
      const current = await state(page);
      const project = current.hub.research.project;
      if (!project) break;
      await clickAction(page, `research:${nextResearchAction(current.hub.research)}`);
    }
  }
  const before = await state(page);
  assert.equal(before.hub.research.papers.length, 1, 'promotion starts from a genuinely accepted paper');
  let receipt;
  const observe = request => {
    if (new URL(request.url()).pathname === '/api/hub/action' && request.postDataJSON()?.action === 'research:promote') receipt = request.postDataJSON();
  };
  page.on('request', observe);
  let promoted;
  try { promoted = await clickAction(page, 'research:promote'); }
  finally { page.off('request', observe); }
  assert.equal(promoted.hub.research.stage, 1);
  assert.equal(promoted.hub.funding, before.hub.funding + 180);
  assert.equal(await page.locator('#promotion-celebration').isVisible(), true);
  assert.match(await page.locator('#promotion-celebration').innerText(), /180/);
  assert.equal(await page.locator('#career-talent-choice, [data-hub-action^="research:talent:"]').count(), 0);
  assert.equal(promoted.hub.research.canChooseTalent, false);
  assert.deepEqual(promoted.hub.research.talents, []);
  if (completePaper) await captureLayouts(page, '#promotion-celebration', 'ui-v7-promotion');
  promoted = await reloadUnchanged(page, promoted, `${label} earned promotion`);
  assert.ok(receipt?.requestId);
  const replayed = await (await page.request.post('/api/hub/action', { data: receipt })).json();
  assert.equal(replayed.replayed, true);
  assert.deepEqual((await state(page)).hub, promoted.hub, 'replaying a promotion receipt must not grant funds twice');
  await workspace(page, 'research');
  const acknowledged = await clickAction(page, 'research:milestone:ack');
  assert.equal(acknowledged.hub.research.lastMilestone.acknowledged, true);
  assert.equal(acknowledged.hub.funding, promoted.hub.funding);
  await reloadUnchanged(page, acknowledged, `${label} acknowledged promotion`);
  await fits(page, `${label}-promoted`);
}

async function storyScenario(page, storyId, screenshots) {
  let current = await state(page);
  assert.equal(current.view.event.story.id, storyId);
  assert.equal(current.view.event.story.chapter, 1);
  assert.equal(await page.locator('#event-story-context').count(), 0, 'story history should not create a persistent raid narrative panel');
  assert.ok((await page.locator('#event-title').innerText()).trim().length <= 100, 'story events need one short current prompt');
  const choice = current.view.event.actions.find(row => !row.disabled && !row.endsRaid && row.id !== 'event:story-decline');
  assert.ok(choice, 'every fresh story offers a real branch without special resources');
  current = await clickAction(page, choice.id, false);
  current = await reloadUnchanged(page, current, `${storyId} first choice`);
  let searches = 0;
  while (!current.view.event && searches < 2) {
    if (current.view.pendingLoot.length) current = await clickAction(page, 'take:available', false);
    current = await clickAction(page, 'search', false);
    searches += 1;
  }
  assert.equal(searches, 2, 'a callback follows one cooldown search');
  if (current.view.pendingLoot.length) current = await clickAction(page, 'take:available', false);
  assert.equal(current.view.event.story.id, storyId);
  assert.equal(current.view.event.story.chapter, 2);
  assert.ok(current.view.event.story.priorChoice);
  assert.ok((await page.locator('#event-title').innerText()).trim(), 'the callback must still present its current choice prompt');
  assert.equal(await page.locator('#event-story-context').count(), 0);
  if (screenshots) await captureLayouts(page, '#raid-event-card', 'ui-v5-story');
  current = await reloadUnchanged(page, current, `${storyId} pending callback`);
  const finish = current.view.event.actions.find(row => !row.disabled && !row.endsRaid && row.id !== 'event:story-decline');
  assert.ok(finish);
  current = await clickAction(page, finish.id, false);
  if (current.view.pendingLoot.length) current = await clickAction(page, 'take:available', false);
  current = await clickAction(page, 'extract', false);
  assert.equal(current.phase, 'result');
  assert.equal(await page.locator('#result-stories').isVisible(), true);
  current = await reloadUnchanged(page, current, `${storyId} settlement`);
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/hub/return' && response.request().method() === 'POST');
  await page.locator('#result-return').click();
  assert.equal((await (await response).json()).ok, true);
  await page.locator('#hub-screen').waitFor({ state: 'visible' });
  await workspace(page, 'records');
  assert.equal(await page.locator('#career-stories').isVisible(), true);
  assert.match(await page.locator('#career-stories').innerText(), /已结局|落幕|完成|打印机|公章|院长猫/);
  await fits(page, `${storyId}-settled`);
}

async function legacyTalentScenario(page, id, used) {
  await page.setViewportSize({ width: 390, height: 844 });
  let before = await state(page);
  assert.equal(before.view.talent.id, id, 'an existing raid preserves its legacy serialized rule state');
  assert.equal(before.view.talent.used, used);
  assert.equal(before.hub.research.talent, null, 'the career has already converted to neutral research support');
  assert.equal(await page.locator('#field-talent, [data-action^="talent:"], [data-action="event:talent-negotiate"]').count(), 0,
    'no retired active ability is offered, including on old live raids');
  assert.equal(await page.locator('#raid-bag').isVisible(), true);
  const cell = page.locator('button.item-cell[data-item-zone="bag"]').first();
  await cell.click();
  assert.equal(await page.locator('[data-action^="talent:"]').count(), 0, 'opening a bag detail cannot reveal retired abilities');
  before = await reloadUnchanged(page, before, `${id}/${used} old active save`);
  await fits(page, `${id}/${used}-legacy-raid`);
  let result = await clickAction(page, before.view.event ? 'event:leave' : 'extract', false);
  assert.equal(result.phase, 'result');
  if (id === 'archivist' && used) {
    assert.ok(result.view.result.archivedIds.includes('dataset'), 'protection already earned before migration survives failed extraction');
  }
  result = await reloadUnchanged(page, result, `${id}/${used} legacy settlement`);
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/hub/return' && response.request().method() === 'POST');
  await page.locator('#result-return').click();
  assert.equal((await (await response).json()).ok, true);
  await page.locator('#hub-screen').waitFor({ state: 'visible' });
  await workspace(page, 'research');
  assert.equal(await page.locator('#career-talent-choice, [data-hub-action^="research:talent:"]').count(), 0);
  const migrated = await state(page);
  assert.equal(migrated.hub.research.stage, 1);
  assert.equal(migrated.hub.research.papers.length, 1);
  await reloadUnchanged(page, migrated, `${id}/${used} converted neutral support`);
  await workspace(page, 'prepare');
  const deployed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/new' && response.request().method() === 'POST');
  await page.locator('#hub-start-raid').click();
  const next = await (await deployed).json();
  assert.equal(next.ok, true);
  assert.equal(next.view.talent, null, 'the next expedition has no faction ability');
}

try {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  saveDir = await fs.mkdtemp(path.join(ARTIFACTS, 'gameplay-browser-'));
  await startServer();
  const chromePath = [process.env.CHROME_PATH,
    path.join(ROOT, '.browser-cache/chromium_headless_shell-1161/chrome-linux/headless_shell'),
    '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean).find(existsSync);
  browser = await chromium.launch({ ...(chromePath ? { executablePath: chromePath } : {}), headless: true });
  await scenario(materialFixture(), page => promotionScenario(page, 'first title', true));
  await scenario(readyForPromotionFixture(), page => promotionScenario(page, 'reloaded paper', false));
  for (const storyId of ['reviewer_printer', 'stamp_maze', 'faculty_cat']) {
    await scenario(storyFixture(storyId), page => storyScenario(page, storyId, storyId === 'reviewer_printer'));
  }
  for (const talent of ['archivist', 'connector', 'tinkerer']) {
    for (const used of [false, true]) await scenario(legacyTalentFixture(talent, used), page => legacyTalentScenario(page, talent, used));
  }
  assert.deepEqual(errors, [], 'no browser JavaScript errors');
  assert.deepEqual(externalRequests, [], 'all app resources stay on the isolated localhost server');
  await fs.writeFile(path.join(ARTIFACTS, 'gameplay-browser-report.json'), JSON.stringify({ passed: true, checks, screenshots: SHOTS }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, screenshots: SHOTS }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit').catch(() => {});
    server.kill();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
  }
  if (saveDir) {
    const actual = await fs.realpath(saveDir);
    assert.equal(path.dirname(actual), await fs.realpath(ARTIFACTS), 'only remove this test’s isolated fixture directory');
    await fs.rm(actual, { recursive: true, force: true });
  }
}
