import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createCareer, careerView, deployProbability, hubAct } from '../src/career.js';
import { nextResearchAction, finishPaper } from './research-qa.mjs';

// All saves, requests and browser profiles are synthetic and local to this run.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, '.artifacts');
const screenshots = [], checks = [], errors = [], externalRequests = [];
let browser, server, saveDir, base;
const act = (career, action) => {
  const result = hubAct(career, `research:${action}`);
  assert.equal(result.ok, true, `${action}: ${result.reason || ''}`);
  return result;
};
const supplied = seed => {
  const career = createCareer(seed);
  career.profile.funding = 20000;
  Object.assign(career.profile.stash, { dataset: 20, src_code: 20, wind: 20, compute: 100 });
  return career;
};
function fixtures() {
  const found = {};
  for (let seed = 1; seed <= 256 && Object.keys(found).length < 5; seed++) {
    const career = supplied(seed * 7919);
    act(career, 'start:replicate');
    for (let step = 0; career.profile.research.project && step < 72; step++) {
      const before = structuredClone(career);
      const current = career.profile.research.project;
      const next = nextResearchAction(career.profile.research);
      if (next === 'experiment' && careerView(career).research.project.supported && !found.supported) {
        before.profile.funding = 0;
        delete before.profile.stash.compute;
        found.supported = before;
      }
      act(career, next);
      const after = career.profile.research.project;
      if (next === 'experiment' && after.successfulRuns === before.profile.research.project.successfulRuns && !found.experimentFailure) found.experimentFailure = before;
      if (next === 'review' && after.status !== 'ready' && !found.reviewFailure) found.reviewFailure = before;
      if (next === 'review' && after.status === 'ready' && !found.ready) found.ready = structuredClone(career);
      if (next === 'publish') {
        const eligible = structuredClone(career);
        const result = act(career, 'promote');
        if (result.promoted === false && !found.promotionFailure) found.promotionFailure = eligible;
      }
    }
  }
  for (const key of ['experimentFailure', 'reviewFailure', 'supported', 'ready', 'promotionFailure']) assert.ok(found[key], `natural deterministic fixture: ${key}`);
  const legacyReady = structuredClone(found.ready);
  delete legacyReady.profile.research.balanceVersion;
  delete legacyReady.profile.research.project.balanceVersion;
  found.legacyReady = legacyReady;
  const earned = structuredClone(found.promotionFailure);
  for (let attempt = 0; earned.profile.research.stage === 0 && attempt < 4; attempt++) {
    if (attempt) finishPaper(earned.profile, { start: 'replicate' });
    act(earned, 'promote');
  }
  assert.equal(earned.profile.research.stage, 1);
  delete earned.profile.research.balanceVersion;
  delete earned.profile.research.rewardedStage;
  delete earned.profile.research.lastMilestone;
  found.earned = earned;
  return found;
}
async function startServer() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), GAME_SAVE_DIR: saveDir, LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: '' } });
  let output = '';
  server.stderr.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`QA server exited: ${output}`);
    try { if ((await fetch(`${base}/api/meta`, { signal: AbortSignal.timeout(300) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`QA server did not start: ${output}`);
}
async function state(page) {
  const response = await page.request.get('/api/state');
  assert.equal(response.status(), 200);
  return response.json();
}
async function scenario(career, width, run) {
  const sid = randomBytes(12).toString('hex');
  const filename = path.join(saveDir, `${sid}.json`);
  await fs.writeFile(filename, JSON.stringify(career));
  const context = await browser.newContext({ baseURL: base, viewport: { width, height: width === 1440 ? 1000 : 844 }, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'sid', value: sid, url: base }]);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = new URL(request.url()); if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) externalRequests.push(url.href); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator(career.run ? '#raid-screen' : '#hub-screen').waitFor({ state: 'visible' });
    await run(page, () => fs.readFile(filename, 'utf8').then(JSON.parse));
  } finally { await context.close(); }
}
async function workspace(page, name = 'research') {
  await page.locator(`[data-workspace-tab="${name}"]`).click();
  await page.locator(`#workspace-panel-${name}`).waitFor({ state: 'visible' });
}
async function click(page, action, hub = true) {
  const attr = hub ? 'data-hub-action' : 'data-action';
  const route = hub ? '/api/hub/action' : '/api/expedition/action';
  const button = page.locator(`[${attr}="${action}"]`).first();
  const disclosures = button.locator('xpath=ancestor::details');
  for (let index = 0; index < await disclosures.count(); index++) {
    const disclosure = disclosures.nth(index);
    if (!(await disclosure.evaluate(node => node.open))) await disclosure.locator(':scope > summary').click();
  }
  assert.equal(await button.isEnabled(), true, `${action} enabled`);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === route && r.request().method() === 'POST' && r.request().postDataJSON()?.action === action);
  await button.click();
  const received = await response;
  const body = await received.json();
  assert.equal(body.ok, true, `${action}: ${body.reason || ''}`);
  await page.waitForFunction(() => !document.body.classList.contains('is-pending'));
  return { state: await state(page), receipt: received.request().postDataJSON(), body };
}
async function replay(page, route, receipt, expected) {
  assert.ok(receipt.requestId, 'mutation uses an idempotent request identity');
  const result = await (await page.request.post(route, { data: receipt })).json();
  assert.equal(result.replayed, true);
  assert.deepEqual(await state(page), expected, 'receipt replay does not spend, advance RNG, grant or loot twice');
}
async function reload(page, before, readSave, label) {
  const saved = await readSave(), posts = [];
  const watch = request => { if (request.method() === 'POST') posts.push(request.url()); };
  page.on('request', watch);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator(before.phase === 'raid' ? '#raid-screen' : before.phase === 'result' ? '#result-screen' : '#hub-screen').waitFor({ state: 'visible' });
    assert.deepEqual(await state(page), before, `${label}: read/reload preserves full public state`);
    assert.deepEqual(await readSave(), saved, `${label}: read/reload preserves persisted random state and ledger`);
    assert.deepEqual(posts, [], `${label}: read/reload sends no action`);
  } finally { page.off('request', watch); }
}
async function clean(page, label) {
  const violations = await page.evaluate(() => {
    const forbidden = /\d+(?:\.\d+)?\s*[%％]|百分点|百分之|把握很大|较有把握|尚有机会|不太容易|希望渺茫|暂无机会|暂时平静|动静频繁|容易遇事|偶有动静|可能的结果|成功率|录用率|预测|预计/;
    const found = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) if (!walk.currentNode.parentElement?.closest('script,style,noscript') && forbidden.test(walk.currentNode.textContent)) found.push(walk.currentNode.textContent.trim());
    for (const node of document.body.querySelectorAll('*')) for (const key of ['title', 'aria-label', 'aria-description', 'aria-valuetext']) {
      const value = node.getAttribute(key); if (value && forbidden.test(value)) found.push(value);
    }
    return { found, width: innerWidth, scrollWidth: document.documentElement.scrollWidth };
  });
  assert.deepEqual(violations.found, [], `${label}: no hidden/visible/accessibility odds or forecasts`);
  assert.ok(violations.scrollWidth <= violations.width + 1, `${label}: fits viewport ${JSON.stringify(violations)}`);
  assert.equal(await page.locator('#search-approaches,[data-search-approach],#approach-hint,#prob-acquisition,#prob-encounter,#prob-full,#field-depth,#field-next-step,#raid-observations,#raid-journal,#raid-log,#raid-team,#raid-objective,#raid-material-probabilities,#encounter-pacing,#expedition-context,.decision-outcomes,[data-choice-detail]').count(), 0);
  checks.push(label);
}
async function capture(page, name, surface = '#research-card') {
  await page.locator(surface).scrollIntoViewIfNeeded();
  await clean(page, name);
  const file = path.join(ARTIFACTS, `${name}-${page.viewportSize().width}.png`);
  await page.screenshot({ path: file }); screenshots.push(file);
}
function itemCount(current, id) { return current.hub.items.find(item => item.id === id)?.storedCount || 0; }
async function experiment(page, supported = false) {
  const before = await state(page), project = before.hub.research.project;
  const materials = project.experimentMaterials;
  assert.ok(materials && typeof materials === 'object', 'server exposes actual experiment materials');
  assert.equal(project.supported, supported);
  const shown = page.locator('#research-card .rw-current .rw-funding');
  assert.match(await shown.innerText(), new RegExp(`消耗\\s*${project.experimentCost}(?:\\D|$)`));
  for (const [id, amount] of Object.entries(materials)) assert.equal(Number(await page.locator(`#research-card .rw-current [data-research-material="${id}"]`).getAttribute('data-required')), amount);
  if (supported) {
    assert.equal(project.experimentCost, 0); assert.equal(materials.compute || 0, 0);
    assert.equal(await page.locator('#research-card .rw-current [data-research-material="compute"]').count(), 0, 'free reanalysis must not falsely require a compute card');
  }
  const result = await click(page, 'research:experiment');
  assert.equal(result.state.hub.funding, before.hub.funding - project.experimentCost);
  assert.equal(itemCount(result.state, 'compute'), itemCount(before, 'compute') - (materials.compute || 0));
  assert.equal(result.state.hub.research.project.runs, project.runs + 1);
  await replay(page, '/api/hub/action', result.receipt, result.state);
  return result.state;
}
async function completePaper(page) {
  await click(page, 'research:start:replicate');
  for (let step = 0; step < 72; step++) {
    const current = await state(page);
    if (!current.hub.research.project) return current;
    await click(page, `research:${nextResearchAction(current.hub.research)}`);
  }
  assert.fail('actual browser paper loop did not terminate');
}
async function assertBag(page, current) {
  assert.equal(await page.locator('#raid-bag-details').evaluate(node => node.tagName), 'SECTION');
  const cells = page.locator('#raid-bag [data-item-zone="bag"]');
  assert.deepEqual(await cells.evaluateAll(nodes => nodes.map(node => node.dataset.itemId)), current.view.bag.map(item => item.id));
  await page.evaluate(() => window.scrollTo(0, 0));
  const rects = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    return { height: innerHeight, bag: rect('#raid-bag'), scene: rect('#field-scene'), search: rect('#raid-actions [data-action="search"]'), extract: rect('#raid-actions .extract-main') };
  });
  for (const item of [rects.bag, rects.search, rects.extract]) assert.ok(item.height > 0 && item.top >= 0 && item.bottom <= rects.height, JSON.stringify(rects));
  assert.ok(rects.search.height >= 44 && rects.extract.height >= 44);
  assert.ok(rects.bag.width * rects.bag.height >= rects.scene.width * rects.scene.height, 'backpack remains more prominent than decoration');
  assert.equal(await page.locator('#raid-actions [data-action^="search"]').count(), 1);
}

try {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  saveDir = await fs.mkdtemp(path.join(ARTIFACTS, 'balance-browser-'));
  const fixture = fixtures();
  await startServer();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ['--no-sandbox'] });
  for (const width of [1440, 390, 320]) {
    await scenario(fixture.experimentFailure, width, async (page, readSave) => {
      await workspace(page); const before = await state(page);
      const after = await experiment(page);
      assert.equal(after.hub.research.project.successfulRuns, before.hub.research.project.successfulRuns);
      assert.equal(after.hub.research.project.setbacks, before.hub.research.project.setbacks + 1);
      await capture(page, 'balance-experiment-failure'); await reload(page, after, readSave, 'experiment failure');
    });
    await scenario(fixture.reviewFailure, width, async (page, readSave) => {
      await workspace(page); const result = await click(page, 'research:review');
      assert.notEqual(result.state.hub.research.project.status, 'ready');
      await capture(page, 'balance-review-failure');
      await replay(page, '/api/hub/action', result.receipt, result.state);
      await reload(page, result.state, readSave, 'review failure');
    });
    await scenario(fixture.supported, width, async (page, readSave) => {
      await workspace(page); await capture(page, 'balance-supported-repair');
      const before = await readSave(), after = await experiment(page, true);
      const savedAfter = await readSave();
      assert.deepEqual(savedAfter.profile.research.skills, before.profile.research.skills, 'supported repair cannot farm raw skill XP');
      assert.deepEqual(savedAfter.profile.research.methods, before.profile.research.methods, 'supported repair cannot farm methods');
      await reload(page, after, readSave, 'free supported repair');
    });
    await scenario(fixture.promotionFailure, width, async (page, readSave) => {
      await workspace(page); const before = await state(page);
      const failed = await click(page, 'research:promote');
      assert.equal(failed.state.hub.research.stage, before.hub.research.stage);
      assert.equal(failed.state.hub.funding, before.hub.funding);
      const saved = await readSave();
      const blocked = await (await page.request.post('/api/hub/action', { data: { action: 'research:promote', requestId: `blocked_${randomBytes(12).toString('hex')}` } })).json();
      assert.equal(blocked.ok, false);
      const afterBlocked = (await readSave()).profile;
      const { requestReceipts: beforeReceipts, ...beforeProfile } = saved.profile;
      const { requestReceipts: afterReceipts, ...afterProfile } = afterBlocked;
      assert.deepEqual(afterProfile, beforeProfile, 'blocked immediate retry cannot reroll or pay a grant');
      assert.equal(afterReceipts.length, beforeReceipts.length + 1, 'the denied request only adds its replay-safe receipt');
      await replay(page, '/api/hub/action', failed.receipt, failed.state);
      await capture(page, 'balance-promotion-failure'); await reload(page, failed.state, readSave, 'failed promotion');
      await workspace(page);
      let promoted;
      for (let attempt = 0; attempt < 3; attempt++) {
        const earned = await completePaper(page);
        assert.equal(earned.hub.research.actions.find(action => action.id === 'research:promote').disabled, false, 'a genuinely new paper earns one retry');
        const result = await click(page, 'research:promote');
        if (result.state.hub.research.stage === 1) {
          assert.equal(result.state.hub.funding, earned.hub.funding + 180);
          promoted = result; break;
        }
      }
      assert.ok(promoted, 'qualified fourth attempt eventually advances');
      assert.equal(await page.locator('#promotion-celebration').isVisible(), true);
      await replay(page, '/api/hub/action', promoted.receipt, promoted.state);
      await capture(page, 'balance-promotion-earned'); await reload(page, promoted.state, readSave, 'earned one-time promotion');
    });
    await scenario(fixture.legacyReady, width, async (page, readSave) => {
      await workspace(page); const before = await state(page);
      assert.equal(before.hub.research.project.status, 'ready');
      await reload(page, before, readSave, 'legacy ready paper'); await workspace(page);
      const published = await click(page, 'research:publish');
      assert.equal(published.state.hub.research.papers.length, before.hub.research.papers.length + 1);
      await replay(page, '/api/hub/action', published.receipt, published.state);
      await capture(page, 'balance-legacy-ready-published');
    });
    await scenario(fixture.earned, width, async (page, readSave) => {
      await workspace(page); const before = await state(page);
      assert.equal(before.hub.research.stage, 1);
      assert.equal(before.hub.funding, fixture.earned.profile.funding);
      assert.equal(before.hub.research.lastMilestone, null, 'old earned stages never manufacture an unclaimed bonus');
      await reload(page, before, readSave, 'legacy earned stage');
      await capture(page, 'balance-legacy-stage');
    });
    for (const difficulty of ['easy', 'normal', 'hard']) {
      const career = createCareer(7919);
      assert.equal(deployProbability(career, { seed: 7919, difficulty }).ok, true);
      await scenario(career, width, async (page, readSave) => {
        let current = await state(page);
        assert.equal(current.view.probabilityVersion, 4);
        await assertBag(page, current); await clean(page, `${difficulty}-new-raid`);
        for (let count = 0; count < 3 && current.phase === 'raid'; count++) {
          if (current.view.pendingLoot.length) current = (await click(page, 'take:available', false)).state;
          if (current.view.event) {
            const choice = current.view.event.actions.find(row => !row.disabled && !row.endsRaid && row.id !== 'event:leave');
            assert.ok(choice); current = (await click(page, choice.id, false)).state;
          } else {
            const result = await click(page, 'search', false); current = result.state;
            await replay(page, '/api/expedition/action', result.receipt, current);
          }
          if (current.phase === 'raid') { await assertBag(page, current); await clean(page, `${difficulty}-search-${count}`); }
        }
        await capture(page, `balance-raid-${difficulty}`, '#raid-cockpit');
        await reload(page, current, readSave, `${difficulty} live raid`);
        if (current.view.pendingLoot.length) current = (await click(page, 'take:available', false)).state;
        if (current.view.event) current = (await click(page, 'event:leave', false)).state;
        else current = (await click(page, 'extract', false)).state;
        assert.equal(current.phase, 'result');
        await reload(page, current, readSave, `${difficulty} settled raid`);
        await capture(page, `balance-extraction-${difficulty}`, '#result-screen');
      });
    }
    const legacyRaid = createCareer(17473);
    assert.equal(deployProbability(legacyRaid, { seed: 17473, difficulty: 'normal' }).ok, true);
    legacyRaid.run.probabilityVersion = 3; delete legacyRaid.run.stage;
    await scenario(legacyRaid, width, async (page, readSave) => {
      const current = await state(page);
      assert.equal(current.view.probabilityVersion, 3);
      await reload(page, current, readSave, 'active legacy v3');
      const result = await click(page, 'search', false);
      await replay(page, '/api/expedition/action', result.receipt, result.state);
      await assertBag(page, result.state); await capture(page, 'balance-legacy-v3', '#raid-cockpit');
    });
  }
  await scenario(fixture.promotionFailure, 390, async (page, readSave) => {
    await workspace(page);
    const failed = await click(page, 'research:promote');
    assert.equal(failed.state.hub.research.stage, 0);
    assert.equal(failed.state.hub.research.promotionReview.retryReady, false);
    const before = await readSave();
    await workspace(page, 'prepare');
    const deployment = page.waitForResponse(response => new URL(response.url()).pathname === '/api/new' && response.request().method() === 'POST');
    await page.locator('#hub-start-raid').click();
    assert.equal((await (await deployment).json()).ok, true);
    let current = await state(page), searches = 0;
    while (searches < 3) {
      if (current.view.pendingLoot.length) current = (await click(page, 'take:available', false)).state;
      else if (current.view.event) {
        const choice = current.view.event.actions.find(row => !row.disabled && !row.endsRaid && row.id !== 'event:leave');
        assert.ok(choice); current = (await click(page, choice.id, false)).state;
      } else { current = (await click(page, 'search', false)).state; searches++; }
      assert.equal(current.phase, 'raid');
    }
    assert.equal(current.hub.research.promotionReview.retryReady, false, 'searches must settle before they earn a retry');
    if (current.view.pendingLoot.length) current = (await click(page, 'take:available', false)).state;
    current = (await click(page, current.view.event ? 'event:leave' : 'extract', false)).state;
    assert.equal(current.phase, 'result');
    assert.equal(current.hub.research.promotionReview.retryReady, true, 'a settled three-search expedition earns one retry');
    const saved = await readSave();
    assert.equal(saved.profile.research.advancement, before.profile.research.advancement + 2);
    await reload(page, current, readSave, 'qualified expedition cannot grant a second retry on reload');
    const returning = page.waitForResponse(response => new URL(response.url()).pathname === '/api/hub/return' && response.request().method() === 'POST');
    await page.locator('#result-return').click();
    assert.equal((await (await returning).json()).ok, true);
    await workspace(page);
    current = await state(page);
    assert.equal(current.hub.research.papers.length, failed.state.hub.research.papers.length);
    assert.equal(current.hub.research.actions.find(action => action.id === 'research:promote').disabled, false);
    await capture(page, 'balance-expedition-earned-retry');
    await reload(page, current, readSave, 'earned retry survives return to the workbench');
  });
  assert.deepEqual(errors, [], 'no browser runtime errors');
  assert.deepEqual(externalRequests, [], 'no synthetic profile leaves the local server');
  await fs.writeFile(path.join(ARTIFACTS, 'balance-browser-report.json'), JSON.stringify({ checks, screenshots, errors, externalRequests }, null, 2));
  console.log(JSON.stringify({ ok: true, checks: checks.length, screenshots, errors, externalRequests }, null, 2));
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
  if (saveDir) await fs.rm(saveDir, { recursive: true, force: true });
}
