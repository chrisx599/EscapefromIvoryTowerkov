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
import { actProbabilityRaid, probabilityRaidView } from '../src/probability-raid.js';

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
  for (const id of ['dataset', 'src_code', 'compute', 'compute', 'compute', 'compute']) action(career, `buy:${id}`);
  return career;
}

function readyForPromotionFixture() {
  const career = materialFixture();
  action(career, 'research:start:replicate');
  while (career.profile.research.project.runs < 2
    || career.profile.research.project.quality < careerView(career).research.project.target) action(career, 'research:experiment');
  for (const id of ['submit', 'review', 'publish']) action(career, `research:${id}`);
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

function activeTalentFixture(id) {
  const promoted = readyForPromotionFixture();
  action(promoted, 'research:promote');
  action(promoted, `research:talent:${id}`);
  // This scenario isolates the active ability's explicit network prerequisite.
  // The rank and paper are genuinely earned; the two test network points are not.
  if (id === 'connector') promoted.profile.network = 2;
  for (let seed = 1; seed <= 300; seed += 1) {
    const career = structuredClone(promoted);
    assert.equal(deployProbability(career, { seed: seed * 7919, difficulty: 'easy' }).ok, true);
    for (let step = 0; step < 25 && career.run.status === 'playing'; step += 1) {
      const view = probabilityRaidView(career.run);
      if (view.pendingLoot.length) { raidAction(career.run, 'take:available'); continue; }
      if (id === 'connector' && view.event?.actions.some(row => row.id === 'event:talent-negotiate' && !row.disabled)) return career;
      if (id !== 'connector' && !view.event && view.bag.length >= 2 && view.talent?.actions.some(row => !row.disabled)) return career;
      if (view.event) {
        const choice = view.event.actions.find(row => row.id === 'event:story-decline')
          || view.event.actions.filter(row => !row.disabled && !row.endsRaid).sort((a, b) => Number(b.probability) - Number(a.probability))[0];
        if (!choice) break;
        raidAction(career.run, choice.id);
      } else if (view.stats.will >= 2) raidAction(career.run, 'search:cautious');
      else break;
    }
  }
  throw new Error(`No natural ability fixture for ${id}`);
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

async function promotionScenario(page, talent, completePaper) {
  await workspace(page, 'research');
  if (completePaper) {
    await clickAction(page, 'research:start:replicate');
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const current = await state(page);
      const project = current.hub.research.project;
      if (!project) break;
      const next = project.status === 'ready' ? 'publish' : project.status === 'submitted' ? 'review'
        : project.runs >= 2 && project.quality >= project.target ? 'submit' : 'experiment';
      await clickAction(page, `research:${next}`);
    }
  }
  const before = await state(page);
  assert.equal(before.hub.research.papers.length, 1, 'promotion starts from a genuinely accepted paper');
  let promoted = await clickAction(page, 'research:promote');
  assert.equal(promoted.hub.research.stage, 1);
  assert.equal(promoted.hub.funding, before.hub.funding + 180);
  assert.equal(await page.locator('#promotion-celebration').isVisible(), true);
  assert.match(await page.locator('#promotion-celebration').innerText(), /180/);
  assert.equal(await page.locator('#career-talent-choice').isVisible(), true);
  if (completePaper) await captureLayouts(page, '#promotion-celebration', 'ui-v4-promotion');
  promoted = await reloadUnchanged(page, promoted, `${talent} promotion before choice`);
  await workspace(page, 'research');
  const selected = await clickAction(page, `research:talent:${talent}`);
  assert.equal(selected.hub.research.talent.id, talent);
  assert.equal(selected.hub.funding, promoted.hub.funding, 'choosing a role does not replay the promotion grant');
  await reloadUnchanged(page, selected, `${talent} chosen specialization`);
  await workspace(page, 'research');
  const acknowledged = await clickAction(page, 'research:milestone:ack');
  assert.equal(acknowledged.hub.research.lastMilestone.acknowledged, true);
  assert.equal(acknowledged.hub.funding, promoted.hub.funding);
  await reloadUnchanged(page, acknowledged, `${talent} acknowledged promotion`);
  await fits(page, `${talent}-chosen`);
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

async function activeTalentScenario(page, id) {
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await state(page);
  assert.equal(before.view.talent.id, id);
  assert.equal(before.view.talent.used, false);
  assert.equal(await page.locator('#field-talent').count(), 0, 'talent prose must not recreate a status panel');
  let command;
  let selectedIndex;
  if (id === 'connector') {
    command = 'event:talent-negotiate';
    if (before.view.event.encounterVersion === 2) assert.match(await page.locator(`[data-action="${command}"]`).innerText(), /人脉\s*1/,
      'the special earned ability must reveal its real resource fee before the user chooses it');
  }
  else {
    const available = before.view.talent.actions.find(row => !row.disabled);
    assert.ok(available);
    command = available.id;
    selectedIndex = Number(command.split(':').at(-1));
    assert.equal(await page.locator('#raid-bag-details').evaluate(element => element.tagName), 'SECTION');
    assert.equal(await page.locator('#raid-bag').isVisible(), true, 'active abilities act on the always-visible real bag');
    const cell = page.locator('button.item-cell[data-item-zone="bag"]').nth(selectedIndex);
    await cell.click();
    assert.equal(await cell.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator(`#bag-item-detail [data-action="${command}"]`).isEnabled(), true);
  }
  let receipt;
  const capture = request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/expedition/action') {
      const body = request.postDataJSON();
      if (body?.action === command) receipt = body;
    }
  };
  page.on('request', capture);
  let after;
  try { after = await clickAction(page, command, false); }
  finally { page.off('request', capture); }
  assert.ok(receipt?.requestId, 'the clicked ability must use the regular durable mutation receipt');
  assert.equal(after.view.talent.used, true, 'the real one-use talent budget is spent');
  assert.equal(after.hub.funding, before.hub.funding, 'using a talent cannot replay the promotion grant');
  const idsBefore = before.view.bag.map(row => row.id);
  const idsAfter = after.view.bag.map(row => row.id);
  if (id === 'archivist') {
    assert.deepEqual(idsAfter, idsBefore);
    assert.equal(after.view.bag[selectedIndex].protection, 'talent');
    assert.equal(after.view.bag.filter(row => row.protection === 'talent').length, 1);
  } else if (id === 'tinkerer') {
    const expected = [...idsBefore];
    expected.splice(selectedIndex, 1);
    expected.push('compute');
    assert.deepEqual(idsAfter, expected, 'UI conversion consumes exactly the selected input for one compute card');
  } else {
    assert.equal(after.view.stats.network, before.view.stats.network - 1,
      'the explicit one-use connector ability spends exactly its displayed one-network fee');
    assert.equal(after.view.event, null);
  }
  after = await reloadUnchanged(page, after, `${id} used active ability`);
  assert.equal(after.view.talent.used, true, 'the real one-use talent budget is spent');
  assert.equal(await page.locator('#field-talent [data-open-talent-bag]').count(), 0);
  assert.ok(after.view.talent.actions.every(row => row.disabled), 'remaining material actions must obey the spent once-per-raid budget');
  const replayResponse = await page.request.post('/api/expedition/action', { data: receipt });
  const replayed = await replayResponse.json();
  assert.equal(replayed.ok, true);
  assert.equal(replayed.replayed, true);
  const afterReplay = await state(page);
  assert.deepEqual(afterReplay.view, after.view, 'retrying the exact UI request cannot use the ability twice');
  assert.deepEqual(afterReplay.hub, after.hub, 'retrying the exact UI request cannot grant research money or another reward');
  await fits(page, `${id}-active-ability`);
}

try {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  saveDir = await fs.mkdtemp(path.join(ARTIFACTS, 'gameplay-browser-'));
  await startServer();
  const chromePath = [process.env.CHROME_PATH,
    path.join(ROOT, '.browser-cache/chromium_headless_shell-1161/chrome-linux/headless_shell'),
    '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean).find(existsSync);
  browser = await chromium.launch({ ...(chromePath ? { executablePath: chromePath } : {}), headless: true });
  await scenario(materialFixture(), page => promotionScenario(page, 'archivist', true));
  for (const talent of ['connector', 'tinkerer']) await scenario(readyForPromotionFixture(), page => promotionScenario(page, talent, false));
  for (const storyId of ['reviewer_printer', 'stamp_maze', 'faculty_cat']) {
    await scenario(storyFixture(storyId), page => storyScenario(page, storyId, storyId === 'reviewer_printer'));
  }
  for (const talent of ['archivist', 'connector', 'tinkerer']) {
    await scenario(activeTalentFixture(talent), page => activeTalentScenario(page, talent));
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
