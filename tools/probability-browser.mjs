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
import { careerView, createCareer, deployProbability, hubAct } from '../src/career.js';
import { createProbabilityRaid, actProbabilityRaid, probabilityRaidView } from '../src/probability-raid.js';
import { ITEMS } from '../src/content.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, '.artifacts');
const DESKTOP_SHOT = path.join(ARTIFACTS, 'probability-final-desktop.png');
const MOBILE_SHOT = path.join(ARTIFACTS, 'probability-final-mobile.png');
const DIFFICULTY_DESKTOP_SHOT = path.join(ARTIFACTS, 'probability-difficulty-desktop.png');
const DIFFICULTY_MOBILE_SHOT = path.join(ARTIFACTS, 'probability-difficulty-mobile.png');
const WAREHOUSE_DESKTOP_SHOT = path.join(ARTIFACTS, 'probability-warehouse-desktop.png');
const WAREHOUSE_MOBILE_SHOT = path.join(ARTIFACTS, 'probability-warehouse-mobile.png');
const EVENT_DESKTOP_SHOT = path.join(ARTIFACTS, 'probability-event-desktop.png');
const EVENT_MOBILE_SHOT = path.join(ARTIFACTS, 'probability-event-mobile.png');
const RESEARCH_DESKTOP_SHOT = path.join(ARTIFACTS, 'ui-v3-research-desktop.png');
const RESEARCH_MOBILE_SHOT = path.join(ARTIFACTS, 'ui-v3-research-mobile.png');
const FIELD_DESKTOP_SHOT = path.join(ARTIFACTS, 'ui-v5-expedition-desktop.png');
const FIELD_MOBILE_SHOT = path.join(ARTIFACTS, 'ui-v5-expedition-mobile.png');
const FIELD_EVENT_DESKTOP_SHOT = path.join(ARTIFACTS, 'ui-v5-expedition-event-desktop.png');
const FIELD_EVENT_MOBILE_SHOT = path.join(ARTIFACTS, 'ui-v5-expedition-event-mobile.png');
const LOCAL_ORIGINS = new Set();
let eventShotsCaptured = false;
const firstScreenMetrics = [];
const journeyMetrics = [];

function watchScenarioPage(page, pageErrors, externalRequests, responses) {
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !LOCAL_ORIGINS.has(url.origin)) externalRequests.push(url.href);
  });
  page.on('response', response => {
    if (new URL(response.url()).pathname.toLowerCase().endsWith('.png')) responses.push({ url: response.url(), status: response.status() });
  });
}

async function assertFitsViewport(page, label) {
  const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(overflow.document <= overflow.width + 1, `${label} must fit horizontally: ${JSON.stringify(overflow)}`);
}

async function assertReloadPreservesState(page, before, label) {
  const actions = [];
  const observe = request => {
    if (request.method() === 'POST') actions.push(new URL(request.url()).pathname);
  };
  page.on('request', observe);
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.locator(before.phase === 'raid' ? '#raid-screen' : '#hub-screen').waitFor({ state: 'visible', timeout: 10_000 });
    const after = await readState(page);
    assert.equal(after.phase, before.phase, `${label}: reload must preserve the active phase`);
    if (before.phase === 'raid') {
      for (const key of ['raidId', 'revision', 'stats', 'bag', 'pendingLoot', 'event', 'lastAction', 'expedition']) {
        assert.deepEqual(after.view[key], before.view[key], `${label}: reload must not mutate ${key}`);
      }
    } else {
      assert.deepEqual(after.hub.research, before.hub.research, `${label}: reload must preserve research progress and its next action`);
      assert.equal(after.hub.funding, before.hub.funding, `${label}: reload must not charge funds`);
      assert.deepEqual(after.hub.items, before.hub.items, `${label}: reload must not spend material`);
    }
    assert.deepEqual(actions, [], `${label}: viewing a recovered save must not submit a game action`);
    return after;
  } finally {
    page.off('request', observe);
  }
}

function createResearchJourneyFixtures() {
  const supplied = createCareer(123456789);
  supplied.profile.funding = 5000;
  Object.assign(supplied.profile.stash, { dataset: 3, src_code: 3, wind: 3, compute: 12 });
  const act = (career, action) => {
    const result = hubAct(career, `research:${action}`);
    assert.equal(result.ok, true, `research fixture action ${action}: ${result.reason || ''}`);
  };
  const empty = createCareer(123456789);
  for (const id of ['dataset', 'src_code', 'wind', 'compute']) delete empty.profile.stash[id];
  const readyToStart = structuredClone(supplied);
  act(supplied, 'start:replicate');
  act(supplied, 'experiment');
  const experiment = structuredClone(supplied);
  const missing = structuredClone(supplied);
  delete missing.profile.stash.compute;
  while (supplied.profile.research.project.runs < 2 || supplied.profile.research.project.quality < careerView(supplied).research.project.target) {
    act(supplied, 'experiment');
  }
  const submit = structuredClone(supplied);
  act(supplied, 'submit');
  const review = structuredClone(supplied);
  act(supplied, 'review');
  const ready = structuredClone(supplied);
  act(supplied, 'publish');
  const promotion = structuredClone(supplied);
  assert.equal(careerView(promotion).research.actions.find(action => action.id === 'research:promote').disabled, false,
    'promotion fixture must earn all its real prerequisites');
  return [
    { name: 'empty', career: empty, action: null },
    { name: 'start', career: readyToStart, action: 'research:start:replicate' },
    { name: 'missing', career: missing, action: 'research:experiment', disabled: true },
    { name: 'experiment', career: experiment, action: 'research:experiment' },
    { name: 'submit', career: submit, action: 'research:submit' },
    { name: 'review', career: review, action: 'research:review' },
    { name: 'ready', career: ready, action: 'research:publish' },
    { name: 'promotion', career: promotion, action: 'research:promote' },
  ];
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startLocalModel() {
  const calls = [];
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    let body = {};
    try { body = JSON.parse(text); } catch { /* keep the mock response deterministic */ }
    calls.push({ path: req.url, model: body.model });
    const userContent = body.messages?.at(-1)?.content || '{}';
    let context = {};
    try { context = JSON.parse(userContent); } catch { /* no real user content leaves this test */ }
    const content = Array.isArray(context.npcs)
      ? { npcs: context.npcs.map(npc => ({ id: npc.id, topic: npc.topic || 'mock topic', personality: 'mock',
        goal: npc.goal || 'mock goal', question: 'mock question', rubric: 'mock rubric' })) }
      : { ok: true };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, calls, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

async function startGameServer(port, saveDir, modelUrl) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      GAME_SAVE_DIR: saveDir,
      LLM_BASE_URL: modelUrl,
      LLM_API_KEY: 'probability-browser-local-only',
      LLM_MODEL: 'probability-browser-mock',
      LLM_JSON_MODE: 'true',
    },
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`game server exited: ${output.join('').slice(-4000)}`);
    try {
      const response = await fetch(`${base}/api/meta`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return { child, base, output };
    } catch { /* wait for the listener */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error(`game server did not start: ${output.join('').slice(-4000)}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit').catch(() => {});
  child.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1500))]);
  }
}

async function readState(page) {
  const response = await page.evaluate(async () => {
    const result = await fetch('/api/state', { cache: 'no-store' });
    return { status: result.status, body: await result.json() };
  });
  assert.equal(response.status, 200);
  return response.body;
}

function waitForApi(page, pathname, method, predicate = () => true) {
  return page.waitForResponse(response => {
    const request = response.request();
    if (new URL(response.url()).pathname !== pathname || request.method() !== method) return false;
    let body;
    try { body = request.postDataJSON(); } catch { /* GET or malformed requests */ }
    return predicate(body);
  }, { timeout: 12_000 });
}

function requestId(label) {
  return `prob_browser_${label}_${randomBytes(8).toString('hex')}`;
}

async function assertBagVisible(page, state) {
  const bag = page.locator('#raid-bag');
  await bag.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#raid-bag-details').evaluate(element => element.tagName), 'SECTION',
    'the bag must be an always-open section, never a collapsed disclosure');
  assert.equal(await page.locator('#raid-bag-details summary').count(), 0);
  const cells = bag.locator('button.item-cell[data-item-zone="bag"]');
  assert.equal(await cells.count(), state.view.bag.length, 'every actual carried item must appear immediately in the bag');
  assert.deepEqual(await cells.evaluateAll(nodes => nodes.map(node => node.dataset.itemId)), state.view.bag.map(item => item.id),
    'bag icons must track the real item order after every action');
  assert.equal((await page.locator('#bag-capacity').innerText()).replace(/\s/g, ''), `${state.view.bagUsed}/${state.view.bagCap}`,
    'bag capacity must use the actual current weight and limit');
}

async function setDisclosure(page, selector, open = true) {
  const details = page.locator(selector);
  await details.waitFor({ state: 'visible', timeout: 7000 });
  assert.equal(await details.evaluate(element => element.tagName), 'DETAILS', `${selector} should be a native disclosure`);
  if (await details.evaluate(element => element.open) !== open) {
    await details.locator(':scope > summary').click();
  }
  assert.equal(await details.evaluate(element => element.open), open, `${selector} should be ${open ? 'expanded' : 'collapsed'}`);
}

async function openEquipmentDetails(page) {
  await activateWorkspace(page, 'prepare');
  await setDisclosure(page, '#equipment-details');
}

async function assertNoNumericProbabilities(page) {
  // textContent deliberately includes closed details and inactive workspaces.
  // Inspect accessibility text as well, but not CSS percentages or ordinary costs/counts.
  const leaks = await page.evaluate(() => {
    const numericChance = /(?:[+−-]?\d+(?:\.\d+)?\s*[%％]|\d+(?:\.\d+)?\s*(?:个)?百分点|百分之\s*[\d一二三四五六七八九十百零两]+)/;
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('script,style,noscript')) continue;
      if (numericChance.test(node.textContent)) found.push({ source: 'text', text: node.textContent.trim() });
    }
    for (const element of document.body.querySelectorAll('*')) {
      for (const name of ['title', 'aria-label', 'aria-description', 'aria-valuetext']) {
        const text = element.getAttribute(name);
        if (text && numericChance.test(text)) found.push({ source: name, text });
      }
    }
    return found;
  });
  assert.deepEqual(leaks, [], `numeric probabilities must not appear in visible, hidden, or accessibility copy: ${JSON.stringify(leaks)}`);
  assert.equal(await page.locator('#prob-partial, #prob-fail, #probability-parts, #setup-difficulty-numbers, #result-full, #result-partial, #result-fail').count(), 0,
    'retired numerical probability panels should be removed rather than merely hidden');
  assert.equal(await page.locator('.risk-meter[aria-valuenow]').count(), 0, 'a removed risk panel must not retain a numeric accessibility value');
}

async function assertFirstScreenIsConcise(page, phase) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const firstScreen = await page.evaluate(() => {
    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || node.parentElement?.closest('script,style,noscript')) continue;
      const element = node.parentElement;
      if (!element || getComputedStyle(element).visibility === 'hidden') continue;
      let hiddenInDisclosure = false;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.tagName === 'DETAILS' && !ancestor.open && !ancestor.querySelector(':scope > summary')?.contains(node)) {
          hiddenInDisclosure = true;
          break;
        }
      }
      if (hiddenInDisclosure) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()];
      if (rects.some(rect => rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0)) {
        texts.push(node.textContent.trim());
      }
    }
    return { width: innerWidth, text: texts.join(' ').replace(/\s+/g, ' ').trim() };
  });
  const limit = firstScreen.width <= 760 ? 460 : 700;
  firstScreenMetrics.push({ phase, width: firstScreen.width, visibleTextCharacters: firstScreen.text.length, limit });
  assert.ok(firstScreen.text.length <= limit,
    `${phase} first screen should stay concise (${firstScreen.text.length}/${limit} characters): ${firstScreen.text}`);
  const primary = phase === 'hub' ? '#hub-start-raid' : '#raid-actions [data-action="search"], #raid-actions [data-action="extract"]';
  const controls = await page.locator(primary).evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return { text: node.textContent.trim(), top: rect.top, bottom: rect.bottom, height: rect.height };
  }));
  const viewportHeight = page.viewportSize()?.height || 900;
  assert.ok(controls.length && controls.every(control => control.height > 0 && control.top >= 0 && control.bottom <= viewportHeight),
    `${phase} primary actions should be reachable in the first screen: ${JSON.stringify(controls)}`);
}

async function assertNoForecasts(page, state) {
  await assertNoNumericProbabilities(page);
  assert.equal(await page.locator('#search-approaches, [data-search-approach], #approach-hint, #prob-acquisition, #prob-encounter, #prob-full, #field-depth, #field-next-step, #raid-observations, #raid-journal, #raid-log, #raid-team, #raid-objective, #raid-material-probabilities, #encounter-pacing, #expedition-context, .decision-outcomes, [data-choice-detail]').count(), 0,
    'retired modes, forecasts, narrative/status panels and logs must be removed from DOM, including hidden copy');
  const leaks = await page.locator('body').evaluate(root => {
    const forecast = /把握很大|较有把握|尚有机会|不太容易|希望渺茫|暂无机会|暂时平静|动静频繁|容易遇事|偶有动静|可能的结果|完整带回.*把握|较难寻找|暂无线索/;
    const result = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode;
      if (!node.parentElement?.closest('script,style,noscript') && forecast.test(node.textContent)) result.push(node.textContent.trim());
    }
    for (const node of root.querySelectorAll('*')) for (const name of ['title', 'aria-label', 'aria-description', 'aria-valuetext']) {
      const text = node.getAttribute(name); if (text && forecast.test(text)) result.push(`${name}: ${text}`);
    }
    return result;
  });
  assert.deepEqual(leaks, [], `qualitative likelihoods and outcome forecasts must not leak in DOM or accessibility copy: ${JSON.stringify(leaks)}`);
  if (state?.phase === 'raid') await assertBagVisible(page, state);
}

async function assertFieldJourney(page, state, label = 'field') {
  await page.evaluate(() => window.scrollTo(0, 0));
  const cockpit = page.locator('#raid-cockpit');
  await cockpit.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await cockpit.locator('#field-scene').count(), 1, 'the compact field illustration belongs to the play surface');
  await assertBagVisible(page, state);
  const meter = page.locator('#raid-statusline [data-vital="will"][role="progressbar"], #raid-statusline [data-vital="will"] [role="progressbar"], #raid-statusline [data-vital="will"] progress');
  assert.equal(await meter.count(), 1, 'heart should have one accessible live meter');
  assert.equal(Number(await meter.getAttribute('aria-valuenow')), Number(state.view.stats.will));
  assert.equal(Number(await meter.getAttribute('aria-valuemax')), Number(state.view.stats.willMax));
  assert.equal(await meter.isVisible(), true);
  assert.equal(await page.locator('#raid-actions [data-action^="search"]').count(), 1, 'there must be exactly one search button');
  assert.equal(await page.locator('#raid-actions [data-action^="search"]').getAttribute('data-action'), 'search');
  const layout = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
    return { width:innerWidth, height:innerHeight, bag:rect('#raid-bag'), scene:rect('#field-scene'), search:rect('#raid-actions [data-action="search"]'), extract:rect('#raid-actions .extract-main') };
  });
  for (const [name, box] of [['bag',layout.bag], ['search',layout.search], ['extract',layout.extract]]) {
    assert.ok(box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= layout.height,
      `${label}: ${name} must be visible together in the first viewport: ${JSON.stringify(layout)}`);
  }
  assert.ok(layout.search.height >= 44 && layout.extract.height >= 44, `${label}: primary actions require 44px touch targets`);
  assert.ok(layout.bag.width * layout.bag.height >= layout.scene.width * layout.scene.height,
    `${label}: backpack should visually dominate the compact decorative field: ${JSON.stringify(layout)}`);
  if (state.view.lastAction && !state.view.event && !state.view.pendingLoot.length) {
    assert.equal(await cockpit.locator('#raid-turn-card').count(), 1, 'concise last-action feedback should stay in the live play surface');
  }
  const panels = await page.locator('#field-scene, #raid-bag-details, #raid-event-card, #pending-loot-card, #raid-turn-card, .raid-action-dock').evaluateAll(nodes => nodes.filter(node => {
    const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  }).map(node => { const r = node.getBoundingClientRect(); return { id:node.id || node.className,left:r.left,right:r.right,top:r.top,bottom:r.bottom }; }));
  for (let first = 0; first < panels.length; first++) for (let second = first + 1; second < panels.length; second++) {
    const a = panels[first], b = panels[second];
    const overlapX = Math.min(a.right,b.right) - Math.max(a.left,b.left);
    const overlapY = Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top);
    assert.ok(overlapX <= 1 || overlapY <= 1, `${label}: live bag, scene, event, pending loot, receipt and dock must not overlap: ${JSON.stringify([a,b])}`);
  }
  journeyMetrics.push({ label, ...layout });
  await assertFitsViewport(page, label);
}

async function assertImmediateEventAction(page, state) {
  if (!state.view.event && !state.view.pendingLoot?.length) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  const firstUsable = page.locator(state.view.pendingLoot?.length
    ? '#pending-loot-actions [data-action]:not(:disabled)'
    : '#event-choices [data-action]:not(:disabled)').first();
  const geometry = await firstUsable.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, top: rect.top, bottom: rect.bottom, label: element.innerText };
  });
  assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height,
    `the first usable pending-loot/event action must be visible immediately, without scrolling through unavailable choices or item details: ${JSON.stringify(geometry)}`);
}

async function assertSingleSearch(page, state) {
  assert.equal(await page.locator('[data-search-approach], #search-approaches, #approach-hint').count(), 0,
    'the UI must not offer or describe alternate search modes');
  const button = page.locator('#raid-actions [data-action^="search"]');
  assert.equal(await button.count(), 1);
  assert.equal(await button.getAttribute('data-action'), 'search');
  const serverAction = state.view.actions.find(row => row.id === 'search');
  assert.ok(serverAction);
  assert.equal(await button.isEnabled(), !serverAction.disabled);
  const before = structuredClone(state.view);
  await assertNoForecasts(page, state);
  assert.deepEqual((await readState(page)).view, before, 'inspecting the simplified interface must not roll or mutate the expedition');
}

function assertWarehouseLedgerView(hub) {
  const storedTotal = (hub.items || []).reduce((sum, item) => {
    assert.equal(item.count, item.ownedCount);
    assert.equal(item.storedCount + item.equippedCount, item.ownedCount);
    return sum + item.storedCount;
  }, 0);
  assert.equal(storedTotal, hub.stashUsed);
  assert.equal(hub.stashCap, hub.storageUpgrade.currentCap);
  assert.equal((hub.stash || []).reduce((sum, item) => sum + item.count, 0), hub.stashUsed);
  for (const item of hub.items || []) {
    assert.equal((hub.stash || []).find(row => row.id === item.id)?.count || 0, item.storedCount);
  }
}


async function activateWorkspace(page, workspace) {
  const tab = page.locator(`[data-workspace-tab="${workspace}"]`).first();
  if (!(await tab.count())) return;
  await tab.waitFor({ state: 'visible', timeout: 7000 });
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  await page.locator(`#workspace-panel-${workspace}`).waitFor({ state: 'visible', timeout: 5000 });
}

async function revealActionDetails(button) {
  // Secondary research controls remain user-operable after moving into native
  // disclosures. Open their actual enclosing summaries rather than mutating DOM.
  const parents = button.locator('xpath=ancestor::details');
  for (let index = 0; index < await parents.count(); index += 1) {
    const details = parents.nth(index);
    if (!(await details.evaluate(element => element.open))) await details.locator(':scope > summary').click();
  }
}

async function selectDifficulty(page, id) {
  const button = page.locator(`#setup-difficulty-options button[data-difficulty-choice="${id}"]`);
  await button.waitFor({ state: 'visible', timeout: 7000 });
  assert.equal(await button.isEnabled(), true, `${id} difficulty should be selectable`);
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await page.waitForFunction(value => document.querySelector(`#setup-difficulty-options [data-difficulty-choice="${value}"]`)?.getAttribute('aria-pressed') === 'true', id,
    { timeout: 5000 });
  return button;
}

const ITEM_DETAIL_IDS = {
  stash: '#stash-item-detail', shop: '#shop-item-detail', loadout: '#loadout-item-detail',
  supplies: '#supplies-item-detail', overflow: '#overflow-item-detail', bag: '#bag-item-detail',
  'equipment-owned': '#equipment-picker-detail', 'equipment-shop': '#equipment-picker-detail',
  pending: '#pending-item-detail', 'result-returned': '#result-item-detail', 'result-lost': '#result-item-detail',
};

async function selectItemCell(page, zone, key, { itemId = null, expectedName = null, expectedCost = null } = {}) {
  let selector = `button.item-cell[data-item-zone="${zone}"][data-item-key="${key}"]`;
  if (itemId) selector += `[data-item-id="${itemId}"]`;
  let cell = page.locator(selector).first();
  if (!(await cell.count()) && itemId) cell = page.locator(`button.item-cell[data-item-zone="${zone}"][data-item-id="${itemId}"]`).first();
  await cell.waitFor({ state: 'visible', timeout: 7000 });
  assert.equal(await cell.isEnabled(), true, `${zone} item cell should remain selectable`);
  await cell.click();
  assert.equal(await cell.getAttribute('aria-pressed'), 'true', `${zone} cell should become the selected detail target`);
  const detail = page.locator(ITEM_DETAIL_IDS[zone]);
  await detail.waitFor({ state: 'visible', timeout: 5000 });
  const detailText = await detail.innerText();
  if (expectedName) assert.ok(detailText.includes(expectedName), `${zone} detail should show ${expectedName}: ${detailText}`);
  if (expectedCost != null) assert.ok(detailText.includes(String(expectedCost)), `${zone} detail should show cost ${expectedCost}: ${detailText}`);
  return { cell, detail, detailText };
}

async function assertEqualCellGeometry(page, selector) {
  const geometry = await page.locator(selector).evaluateAll(cells => cells.map(cell => {
    const rect = cell.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  assert.ok(geometry.length >= 2, `expected a group of item cells: ${selector}`);
  const widths = geometry.map(rect => rect.width), heights = geometry.map(rect => rect.height);
  assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, `item cells should share a width: ${JSON.stringify(geometry)}`);
  assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, `item cells should share a height: ${JSON.stringify(geometry)}`);
  assert.ok(Math.max(...widths, ...heights) <= 124, `item cells should stay compact rather than stretch across the grid: ${JSON.stringify(geometry)}`);
  assert.ok(Math.abs(widths[0] - heights[0]) <= 2, `item cells should remain square: ${JSON.stringify(geometry[0])}`);
}

async function clickHubAction(page, action) {
  const [verb, ...parts] = action.split(':');
  const id = parts.join(':');
  let workspace = null;
  let zone = null;
  let detailScope = null;
  let itemId = null;
  let key = null;
  let info = null;
  let equipmentSlotAction = false;

  if (verb === 'buy') { workspace = 'shop'; zone = 'shop'; detailScope = '#shop-item-detail'; itemId = id; key = id; }
  else if (['sell', 'equip', 'pack'].includes(verb)) { workspace = 'inventory'; zone = 'stash'; detailScope = '#stash-item-detail'; itemId = id; key = id; }
  else if (verb === 'unequip') { workspace = 'prepare'; equipmentSlotAction = true; }
  else if (verb === 'unpack') { workspace = 'prepare'; zone = 'supplies'; detailScope = '#supplies-item-detail'; itemId = id; key = id; }
  else if (verb === 'store' || verb === 'sell-overflow') { workspace = 'inventory'; zone = 'overflow'; detailScope = '#overflow-item-detail'; itemId = id; key = id; }
  else if (verb === 'research') workspace = 'research';
  else if (verb === 'venue') workspace = 'prepare';

  if (workspace) await activateWorkspace(page, workspace);
  if (zone === 'supplies') await openEquipmentDetails(page);
  if (verb === 'venue') await setDisclosure(page, '#venue-details');
  if (equipmentSlotAction) {
    await openEquipmentPicker(page, id);
    detailScope = '#equipment-picker-detail';
  }
  if (zone) {
    const state = await readState(page);
    const catalog = zone === 'shop' ? state.hub.shop : zone === 'loadout' ? [] : state.hub.items;
    info = catalog?.find(item => item.id === itemId) || (zone === 'overflow' ? state.hub.overflow?.find(item => item.id === itemId)?.item : null);
    const selected = await selectItemCell(page, zone, key, {
      itemId, expectedName: info?.name,
      expectedCost: zone === 'shop' ? info?.price : null,
    });
    const detailButton = selected.detail.locator(`[data-hub-action="${action}"]`).first();
    await detailButton.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await detailButton.isEnabled(), true, `detail action ${action} should be enabled`);
  }

  let scope = '[data-hub-action]';
  if (zone) scope = detailScope;
  else if (equipmentSlotAction) scope = detailScope;
  else if (verb === 'upgrade') scope = '#hub-screen';
  else if (action.startsWith('research:start:')) scope = '#research-templates';
  else if (action.startsWith('research:')) scope = '#research-actions';
  if (action.startsWith('research:direction:') || action.startsWith('research:prepare:')) scope = '#research-card';
  const button = page.locator(`${scope} [data-hub-action="${action}"]`).first();
  if (verb === 'research') await revealActionDetails(button);
  await button.waitFor({ state: 'visible', timeout: 7000 });
  assert.equal(await button.isEnabled(), true, `hub action ${action} should be enabled`);
  const responseWait = waitForApi(page, '/api/hub/action', 'POST', body => body?.action === action);
  await button.click();
  const response = await responseWait;
  const payload = await response.json();
  await page.waitForFunction(() => !document.body.classList.contains('is-pending'), null, { timeout: 7000 });
  assert.equal(payload.ok, true, `hub action ${action} failed: ${payload.reason || 'no reason returned'}`);
  await assertNoNumericProbabilities(page);

  if (verb === 'buy' && zone === 'shop' && itemId) {
    assert.ok((await page.locator('#shop-item-detail').innerText()).includes(info?.name || itemId), 'shop selection should remain after purchase');
    assert.equal(await page.locator(`button.item-cell[data-item-zone="shop"][data-item-id="${itemId}"]`).getAttribute('aria-pressed'), 'true',
      'the purchased shop cell should remain selected after the API redraw');
  }
  if (verb === 'sell' && zone === 'stash' && itemId) {
    const after = await readState(page);
    if (!after.hub.items.some(item => item.id === itemId && Number(item.storedCount) > 0)) {
      assert.equal(await page.locator(`#hub-stash button.item-cell[data-item-zone="stash"][data-item-id="${itemId}"]`).count(), 0,
        'selling the last copy should remove its item cell');
      assert.match(await page.locator('#stash-item-detail').innerText(), /选择.{0,4}物品|暂无/,
        'selling out should clear stale stash details');
    }
  }
  return payload;
}

const EQUIPMENT_SLOT_LABELS = { bag: '背包', focus: '专注设备', tool: '研究工具', device: '计算设备', storage: '存储设备' };

async function openEquipmentPicker(page, slot) {
  await openEquipmentDetails(page);
  const state = await readState(page);
  const currentId = state.hub.loadout?.[slot] || null;
  const currentItem = currentId ? state.hub.items.find(item => item.id === currentId) : null;
  const cell = page.locator(`button.item-cell[data-item-zone="loadout"][data-item-key="${slot}"]`).first();
  await cell.waitFor({ state: 'visible', timeout: 7000 });
  assert.equal(await cell.isEnabled(), true, `${slot} loadout slot should be selectable`);
  await cell.click();
  const picker = page.locator('#equipment-picker');
  await picker.waitFor({ state: 'visible', timeout: 5000 });
  const title = await page.locator('#equipment-picker-title').innerText();
  assert.ok(title.includes(EQUIPMENT_SLOT_LABELS[slot]), `equipment picker title should identify ${slot}: ${title}`);
  const current = await page.locator('#equipment-picker-current').innerText();
  if (currentItem) assert.ok(current.includes(currentItem.name), 'picker should identify the currently equipped item');
  const ownedTab = page.locator('#equipment-picker [data-equipment-source="owned"]');
  await ownedTab.waitFor({ state: 'visible', timeout: 4000 });
  assert.equal(await ownedTab.getAttribute('aria-selected'), 'true', 'owned equipment should be the default picker source');
  return { currentId, currentItem, state };
}

async function selectEquipmentOption(page, source, id, info) {
  const tab = page.locator(`#equipment-picker [data-equipment-source="${source}"]`);
  await tab.waitFor({ state: 'visible', timeout: 5000 });
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  const zone = source === 'owned' ? 'equipment-owned' : 'equipment-shop';
  return selectItemCell(page, zone, id, {
    itemId: id,
    expectedName: info?.name,
    expectedCost: source === 'shop' ? info?.price : null,
  });
}

async function clickPickerAction(page, action) {
  const button = page.locator(`#equipment-picker-detail [data-hub-action="${action}"]`).first();
  await button.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await button.isEnabled(), true, `equipment picker action ${action} should be enabled`);
  const responseWait = waitForApi(page, '/api/hub/action', 'POST', body => body?.action === action);
  await button.click();
  const response = await responseWait;
  const payload = await response.json();
  await page.waitForFunction(() => !document.body.classList.contains('is-pending'), null, { timeout: 7000 });
  assert.equal(payload.ok, true, `equipment picker action ${action} failed: ${payload.reason || 'no reason returned'}`);
  await assertNoNumericProbabilities(page);
  return payload;
}

async function runEquipmentPickerScenario(browser, base, pageErrors, externalRequests, responses) {
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  let hubActionRequests = 0;
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !LOCAL_ORIGINS.has(url.origin)) externalRequests.push(url.href);
    if (url.pathname === '/api/hub/action' && request.method() === 'POST') hubActionRequests += 1;
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.toLowerCase().endsWith('.png')) responses.push({ url: response.url(), status: response.status() });
  });

  try {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.locator('#hub-screen').waitFor({ state: 'visible', timeout: 10_000 });
    const before = await readState(page);
    assert.equal(before.phase, 'hub');
    assertWarehouseLedgerView(before.hub);
    assertWarehouseLedgerView(before.hub);
    const wornCount = before.hub.items.reduce((sum, item) => sum + item.equippedCount, 0);
    assert.ok(wornCount > 0 && before.hub.stashUsed < before.hub.items.reduce((sum, item) => sum + item.ownedCount, 0),
      'worn copies should be owned but occupy no warehouse capacity');
    const starterBag = before.hub.loadout.bag;
    assert.ok(starterBag, 'fresh slot picker session should include an equipped starter bag');
    const badge = before.hub.shop.find(item => item.id === 'badge_wallet');
    const gpu = before.hub.shop.find(item => item.id === 'gpu_workstation');
    const padded = before.hub.shop.find(item => item.id === 'padded_case');
    const portable = before.hub.shop.find(item => item.id === 'portable_ssd');
    assert.ok(badge && gpu && padded && portable, 'picker test items should be in the real catalog');

    await activateWorkspace(page, 'inventory');
    const warehouseButton = page.locator('#warehouse-upgrade-button[data-hub-action="upgrade:warehouse"]');
    await warehouseButton.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await warehouseButton.isEnabled(), true, 'the first warehouse expansion should be available');
    assert.match(await warehouseButton.innerText(), /200/, 'the warehouse action should show its current catalog price');
    const warehouseBefore = before.hub.storageUpgrade;
    assert.equal(warehouseBefore.level, 0);
    assert.equal(warehouseBefore.currentCap, 40);
    assert.equal(warehouseBefore.nextCap, 60);
    assert.equal(warehouseBefore.cost, 200);
    const expanded = await clickHubAction(page, 'upgrade:warehouse');
    assert.equal(expanded.hub.funding, before.hub.funding - warehouseBefore.cost);
    assert.equal(expanded.hub.storageUpgrade.level, 1);
    assert.equal(expanded.hub.storageUpgrade.currentCap, warehouseBefore.currentCap + 20);
    assert.equal(expanded.hub.stashUsed, before.hub.stashUsed, 'capacity expansion should leave inventory counts alone');
    assertWarehouseLedgerView(expanded.hub);
    assert.ok((await page.locator('#warehouse-upgrade-summary').innerText()).includes(String(expanded.hub.storageUpgrade.currentCap)),
      'the visible warehouse summary should show the new real capacity');
    await page.screenshot({ path: WAREHOUSE_DESKTOP_SHOT, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
      'the warehouse expansion summary should fit on mobile');
    await page.screenshot({ path: WAREHOUSE_MOBILE_SHOT, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    const beforeBuy = await readState(page);
    assertWarehouseLedgerView(beforeBuy.hub);

    const beforeSlotSelection = hubActionRequests;
    await openEquipmentPicker(page, 'bag');
    assert.equal(hubActionRequests, beforeSlotSelection, 'opening an equipment slot should not change the warehouse or submit an API action');
    assert.equal(await page.locator('#equipment-picker-grid button.item-cell[data-item-zone="equipment-owned"][data-item-id="canvas_pack"]').count(), 1,
      'the owned tab should show starter equipment');
    const callsBeforePeek = hubActionRequests;
    await selectEquipmentOption(page, 'shop', 'badge_wallet', badge);
    assert.equal(hubActionRequests, callsBeforePeek, 'opening a shop item detail must not purchase it');
    const purchaseDetail = page.locator('#equipment-picker-detail');
    assert.ok((await purchaseDetail.innerText()).includes(String(badge.price)), 'picker detail should show the actual price');
    const purchaseButton = purchaseDetail.locator('[data-hub-action="buy-equip:badge_wallet"]');
    await purchaseButton.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await purchaseButton.isEnabled(), true);

    const bought = await clickPickerAction(page, 'buy-equip:badge_wallet');
    assert.equal(bought.hub.funding, beforeBuy.hub.funding - badge.price, 'one atomic buy-equip should charge exactly once');
    assert.equal(bought.hub.loadout.bag, 'badge_wallet');
    assert.equal(bought.hub.stashUsed, before.hub.stashUsed + 1, 'only the displaced old item should begin occupying storage');
    assert.equal(bought.hub.items.find(item => item.id === 'badge_wallet')?.storedCount, 0);
    assert.equal(bought.hub.items.find(item => item.id === 'badge_wallet')?.equippedCount, 1);
    assert.equal(bought.hub.items.find(item => item.id === starterBag)?.storedCount, 1, 'replacing the bag should return its old copy to storage');
    assertWarehouseLedgerView(bought.hub);
    assert.equal(await page.locator('#equipment-picker [data-equipment-source="owned"]').getAttribute('aria-selected'), 'true',
      'a successful purchase should switch the picker to owned gear');
    assert.ok((await page.locator('#equipment-picker-current').innerText()).includes(badge.name), 'the current slot should show the newly equipped gear');

    const ownedBag = await selectEquipmentOption(page, 'owned', starterBag, before.hub.items.find(item => item.id === starterBag));
    const freeSwitch = ownedBag.detail.locator(`[data-hub-action="equip:${starterBag}"]`);
    await freeSwitch.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await freeSwitch.isEnabled(), true, 'already-owned compatible equipment should be switchable');
    const switched = await clickPickerAction(page, `equip:${starterBag}`);
    assert.equal(switched.hub.funding, bought.hub.funding, 'switching to owned equipment must not spend funds');
    assert.equal(switched.hub.loadout.bag, starterBag);
    assert.equal(switched.hub.stashUsed, bought.hub.stashUsed, 'swapping owned copies should exchange worn and stored status without changing capacity');
    assert.equal(switched.hub.items.find(item => item.id === 'badge_wallet')?.storedCount, 1);
    assertWarehouseLedgerView(switched.hub);

    await openEquipmentPicker(page, 'device');
    await selectEquipmentOption(page, 'shop', 'gpu_workstation', gpu);
    const lockedGpu = page.locator('#equipment-picker-detail [data-hub-action="buy-equip:gpu_workstation"]');
    await lockedGpu.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await lockedGpu.isEnabled(), false, 'an identity-locked same-slot upgrade remains inspectable but disabled');
    const gpuDetail = await page.locator('#equipment-picker-detail').innerText();
    assert.match(gpuDetail, /需要.+当前为/, `locked detail should explain the identity gate: ${gpuDetail}`);

    await openEquipmentPicker(page, 'bag');
    await selectEquipmentOption(page, 'shop', 'padded_case', padded);
    const insufficient = page.locator('#equipment-picker-detail [data-hub-action="buy-equip:padded_case"]');
    await insufficient.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await insufficient.isEnabled(), false, 'an unaffordable same-slot upgrade remains inspectable but disabled');
    assert.match(await page.locator('#equipment-picker-detail').innerText(), /经费不足|需要/, 'locked detail should explain the funding gate');

    await openEquipmentPicker(page, 'storage');
    assert.ok((await page.locator('#equipment-picker-current').innerText()).length > 0, 'an empty storage slot should open its picker');
    await selectEquipmentOption(page, 'shop', 'portable_ssd', portable);
    assert.equal(await page.locator('#equipment-picker-detail [data-hub-action="buy-equip:portable_ssd"]').isEnabled(), false,
      'empty storage should show the correct slot catalog and funding restriction');

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile picker should not overflow horizontally');
    await openEquipmentPicker(page, 'storage');
    await selectEquipmentOption(page, 'shop', 'portable_ssd', portable);
    const detailBounds = await page.locator('#equipment-picker-detail').evaluate(element => element.getBoundingClientRect().toJSON());
    assert.ok(detailBounds.bottom > 0 && detailBounds.top < 844, 'mobile equipment details should be reachable beside the grid');
    await page.locator('#equipment-picker-close').click();
    await page.locator('#equipment-picker').waitFor({ state: 'hidden', timeout: 3000 });
    assert.equal(hubActionRequests, 3, 'only the warehouse upgrade, atomic purchase, and owned-gear switch should mutate the picker profile');
    return await readState(page);
  } finally {
    await context.close().catch(() => {});
  }
}

async function runFullWarehouseGearScenario(browser, base, saveDir, pageErrors, externalRequests, responses) {
  const sid = randomBytes(12).toString('hex');
  const career = createCareer(44217);
  const wornBag = career.profile.loadout.bag;
  assert.ok(wornBag);
  career.profile.funding = 5000;
  career.profile.stash.badge_wallet = Number(career.profile.stash.badge_wallet || 0) + 1;
  const capacity = careerView(career).stashCap;
  const used = careerView(career).stashUsed;
  career.profile.stash.wind = Number(career.profile.stash.wind || 0) + capacity - used;
  await fs.writeFile(path.join(saveDir, `${sid}.json`), JSON.stringify(career), 'utf8');

  const context = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  let hubActionRequests = 0;
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !LOCAL_ORIGINS.has(url.origin)) externalRequests.push(url.href);
    if (url.pathname === '/api/hub/action' && request.method() === 'POST') hubActionRequests += 1;
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.toLowerCase().endsWith('.png')) responses.push({ url: response.url(), status: response.status() });
  });

  try {
    await context.addCookies([{ name: 'sid', value: sid, url: base }]);
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.locator('#hub-screen').waitFor({ state: 'visible', timeout: 10_000 });
    const before = await readState(page);
    assertWarehouseLedgerView(before.hub);
    assert.equal(before.hub.stashUsed, before.hub.stashCap, 'the isolated loadout scenario should start at warehouse capacity');
    assert.equal(before.hub.loadout.bag, wornBag);
    const canvasStoredBefore = before.hub.items.find(item => item.id === wornBag)?.storedCount;
    const badgeStoredBefore = before.hub.items.find(item => item.id === 'badge_wallet')?.storedCount;
    const padded = before.hub.shop.find(item => item.id === 'padded_case');
    assert.ok(padded && padded.slot === 'bag' && before.hub.funding >= padded.price);

    const callsBeforeOpening = hubActionRequests;
    await openEquipmentPicker(page, 'bag');
    await selectEquipmentOption(page, 'owned', 'badge_wallet', before.hub.items.find(item => item.id === 'badge_wallet'));
    assert.equal(hubActionRequests, callsBeforeOpening,
      'opening the slot and selecting an already-owned spare should not change equipment until its action button is pressed');
    const equipSpare = page.locator('#equipment-picker-detail [data-hub-action="equip:badge_wallet"]');
    assert.equal(await equipSpare.isEnabled(), true, 'an existing same-slot spare should be an equal-capacity swap even when full');
    await clickPickerAction(page, 'equip:badge_wallet');
    const swapped = await readState(page);
    assert.equal(swapped.hub.loadout.bag, 'badge_wallet');
    assert.equal(swapped.hub.stashUsed, before.hub.stashUsed);
    assert.equal(swapped.hub.items.find(item => item.id === 'badge_wallet')?.storedCount, badgeStoredBefore - 1);
    assert.equal(swapped.hub.items.find(item => item.id === wornBag)?.storedCount, canvasStoredBefore + 1,
      'the displaced worn item should occupy exactly the slot freed by the spare');
    assertWarehouseLedgerView(swapped.hub);

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await openEquipmentPicker(page, 'bag');
    await selectEquipmentOption(page, 'owned', 'badge_wallet', swapped.hub.items.find(item => item.id === 'badge_wallet'));
    const unequip = page.locator('#equipment-picker-detail [data-hub-action="unequip:bag"]');
    assert.equal(await unequip.isEnabled(), false, 'unwearing at full warehouse capacity must be disabled');
    assert.match(await page.locator('#equipment-picker-detail').innerText(), /仓库已满/);
    const clickCountBeforeBlockedButtons = hubActionRequests;
    await selectEquipmentOption(page, 'shop', 'padded_case', padded);
    const replaceButton = page.locator('#equipment-picker-detail [data-hub-action="buy-equip:padded_case"]');
    assert.equal(await replaceButton.isEnabled(), false,
      'buying a replacement while full must be disabled if the old worn copy cannot be returned to storage');
    assert.match(await page.locator('#equipment-picker-detail').innerText(), /仓库已满/);
    assert.equal(hubActionRequests, clickCountBeforeBlockedButtons,
      'inspecting an unavailable unwear/upgrade choice must not submit a mutation');
    assert.equal((await readState(page)).hub.loadout.bag, 'badge_wallet');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
      'the full-warehouse equipment picker should remain usable on a narrow viewport');
  } finally {
    await context.close().catch(() => {});
  }
}

async function runUncertainMutationScenario(browser, base, pageErrors, externalRequests, responses) {
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  const attemptedBodies = [];
  let allowMutation = false;
  let forwardedMutations = 0;
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !LOCAL_ORIGINS.has(url.origin)) externalRequests.push(url.href);
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.toLowerCase().endsWith('.png')) responses.push({ url: response.url(), status: response.status() });
  });

  try {
    await page.route('**/api/hub/action', async route => {
      attemptedBodies.push(route.request().postDataJSON());
      if (!allowMutation) return route.abort();
      forwardedMutations += 1;
      return route.continue();
    });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.locator('#hub-screen').waitFor({ state: 'visible', timeout: 10_000 });
    const before = await readState(page);
    const wind = before.hub.shop.find(item => item.id === 'wind');
    assert.ok(wind, 'wind stock should be available for an isolated uncertain-request test');
    await activateWorkspace(page, 'shop');
    const selected = await selectItemCell(page, 'shop', 'wind', {
      itemId: 'wind', expectedName: wind.name, expectedCost: wind.price,
    });
    const purchase = selected.detail.locator('[data-hub-action="buy:wind"]');
    assert.equal(await purchase.isEnabled(), true, 'the isolated profile should be able to buy wind before injection');
    await purchase.click();
    await page.waitForFunction(() => {
      const action = document.querySelector('#shop-item-detail [data-hub-action="buy:wind"]');
      const feedback = document.querySelector('#hub-feedback')?.innerText || '';
      return action?.disabled && feedback.includes('同步进度');
    }, null, { timeout: 10_000 });
    assert.equal(attemptedBodies.length, 3, 'two submits plus the automatic reconciliation retry should be aborted');
    const originalRequestId = attemptedBodies[0]?.requestId;
    assert.ok(originalRequestId, 'the retried mutation should have a requestId');
    assert.ok(attemptedBodies.every(body => body?.requestId === originalRequestId && body.action === 'buy:wind'),
      'all retries must preserve the exact original action and requestId');
    const savedRequest = await page.evaluate(() => JSON.parse(sessionStorage.getItem('xuefa-pending-request') || 'null'));
    assert.equal(savedRequest?.path, '/api/hub/action');
    assert.equal(savedRequest?.body?.requestId, originalRequestId, 'the uncertain mutation should persist in sessionStorage');
    const unchanged = await readState(page);
    assert.equal(unchanged.hub.funding, before.hub.funding, 'GET success alone must not apply or unlock an aborted mutation');
    assert.equal(unchanged.hub.items.find(item => item.id === 'wind')?.count || 0,
      before.hub.items.find(item => item.id === 'wind')?.count || 0);
    assert.equal(await page.locator('#shop-item-detail [data-hub-action="buy:wind"]').isEnabled(), false,
      'the same mutating action must remain locked after a successful GET without a mutation receipt');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.locator('#hub-screen').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction(() => {
      const feedback = document.querySelector('#hub-feedback')?.innerText || '';
      return feedback.includes('同步进度') && !document.body.classList.contains('is-pending');
    }, null, { timeout: 10_000 });
    assert.ok(attemptedBodies.length >= 4, 'reloading should retry the persisted uncertain mutation with the same request');
    assert.ok(attemptedBodies.every(body => body?.requestId === originalRequestId && body.action === 'buy:wind'),
      'the pending request should retain its original ID and body across reload');
    const afterReload = await readState(page);
    assert.equal(afterReload.hub.funding, before.hub.funding, 'reloaded state reads must not mistake GET success for a mutation receipt');

    allowMutation = true;
    const replayWait = waitForApi(page, '/api/hub/action', 'POST', body => body?.requestId === originalRequestId);
    await page.locator('#hub-refresh-state').click();
    const replay = await (await replayWait).json();
    await page.waitForFunction(() => !document.body.classList.contains('is-pending'), null, { timeout: 8000 });
    assert.equal(replay.ok, true, 'manual sync should receive the original successful action receipt');
    assert.equal(forwardedMutations, 1, 'only the confirmed retry should reach the server');
    assert.equal(attemptedBodies.filter(body => body?.requestId === originalRequestId).length, forwardedMutations + 4,
      'the initial two attempts and reconciliation/reload retries should share the one committed mutation');
    const afterReplay = await readState(page);
    assert.equal(afterReplay.hub.funding, before.hub.funding - wind.price, 'a lost response followed by retry must charge exactly once');
    assert.equal(afterReplay.hub.items.find(item => item.id === 'wind')?.count,
      (before.hub.items.find(item => item.id === 'wind')?.count || 0) + 1, 'the retry should buy exactly one item');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('xuefa-pending-request')), null,
      'a confirmed replay should clear the persisted uncertain request');
  } finally {
    await context.close().catch(() => {});
  }
}

async function runSingleSearchCommitScenario(browser, base, saveDir, pageErrors, externalRequests, responses) {
  const sid = randomBytes(12).toString('hex');
  const career = createCareer(42687);
  career.run = createProbabilityRaid({ seed: 42687, raidId: `qa-single-search-${sid}`, venue: 'conference', difficulty: 'normal',
    player: career.profile.identity, loadout: Object.values(career.profile.loadout).filter(Boolean),
    network: career.profile.network, contacts: career.profile.contacts });
  // Atomic repeated searching is isolated from the separate event/overflow suite.
  career.run.eventCount = 4;
  career.run.bagCap = 100;
  await fs.writeFile(path.join(saveDir, `${sid}.json`), JSON.stringify(career), 'utf8');
  const context = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  watchScenarioPage(page, pageErrors, externalRequests, responses);
  try {
    await context.addCookies([{ name: 'sid', value: sid, url: base }]);
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.locator('#raid-screen').waitFor({ state: 'visible', timeout: 10_000 });
    let state = await readState(page);
    for (let turn = 0; turn < 3; turn++) {
      const before = state;
      const preview = before.view.searchPreview;
      await assertSingleSearch(page, before);
      state = await clickRaidAction(page, 'search');
      assert.equal(state.view.revision, before.view.revision + 1, 'each repeated search should commit exactly once');
      assert.equal(state.view.stats.will, before.view.stats.will - (preview?.willCost ?? 1),
        'the single search should charge its actual heart cost');
      assert.equal(state.view.event, null, 'the isolated search fixture should keep events out of the way');
      assert.equal(state.view.pendingLoot.length, 0, 'the isolated search fixture should have enough bag space');
      await assertTurnCardUi(page, state);
      await assertNoForecasts(page, state);
      await assertFieldJourney(page, state, `single-search-${turn}`);
      state = await assertReloadPreservesState(page, state, `search-${turn}-save`);
    }
    await clickRaidAction(page, 'extract');
    const returnWait = waitForApi(page, '/api/hub/return', 'POST');
    await page.locator('#result-return').click();
    await returnWait;
    await page.locator('#hub-screen').waitFor({ state: 'visible', timeout: 7000 });
    await activateWorkspace(page, 'prepare');
    const newWait = waitForApi(page, '/api/new', 'POST');
    await page.locator('#hub-start-raid').click();
    const fresh = await (await newWait).json();
    await page.waitForFunction(() => !document.body.classList.contains('is-pending'), null, { timeout: 7000 });
    assert.equal(fresh.phase, 'raid');
    assert.notEqual(fresh.view.raidId, state.view.raidId, 'returning and launching should create a new expedition');
    await assertSingleSearch(page, fresh);
    await assertBagVisible(page, fresh);
    await clickRaidAction(page, 'extract');
  } finally { await context.close().catch(() => {}); }
}

async function runLoadedBagEventScenario(browser, base, saveDir, pageErrors, externalRequests, responses) {
  let fixture;
  for (let seed = 1; seed <= 300 && !fixture; seed++) {
    const career = createCareer(seed * 7919);
    assert.equal(deployProbability(career, { seed: seed * 7919, difficulty: 'normal' }).ok, true);
    for (let step = 0; step < 24 && career.run.status === 'playing'; step++) {
      const view = probabilityRaidView(career.run);
      if (view.event && !view.pendingLoot.length && view.bag.length >= 4) { fixture = career; break; }
      const choice = view.event?.actions.find(row => !row.disabled && !row.endsRaid && row.id !== 'event:story-decline');
      const command = view.pendingLoot.length ? 'take:available' : view.event ? choice?.id : 'search';
      if (!command) break;
      const result = actProbabilityRaid(career.run, command);
      assert.equal(result.ok, true, `natural loaded-bag fixture: ${command}`);
    }
  }
  assert.ok(fixture, 'a real seeded expedition should naturally reach an event with at least four carried items');
  const sid = randomBytes(12).toString('hex');
  await fs.writeFile(path.join(saveDir, `${sid}.json`), JSON.stringify(fixture), 'utf8');
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  watchScenarioPage(page, pageErrors, externalRequests, responses);
  try {
    await context.addCookies([{ name: 'sid', value: sid, url: base }]);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#raid-screen').waitFor({ state: 'visible' });
    let current = await readState(page);
    assert.ok(current.view.bag.length >= 4);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await assertNoForecasts(page, current);
      await assertFieldJourney(page, current, `loaded-bag-event-${width}`);
      await assertEncounterUi(page, current);
      await assertImmediateEventAction(page, current);
      await verifyPngAssets(page);
      await page.screenshot({ path: path.join(ARTIFACTS, `ui-v5-loaded-bag-event-${width}.png`) });
    }
    current = await assertReloadPreservesState(page, current, 'loaded bag and unresolved event');
    const choice = current.view.event.actions.find(row => !row.disabled && !row.endsRaid);
    const after = await clickRaidAction(page, choice.id, '#event-choices');
    assert.equal(after.view.event, null, 'the neutral choice must resolve the real pending event');
    await assertBagVisible(page, after);
  } finally { await context.close().catch(() => {}); }
}

async function runFullBagEventUiScenario(browser, base, saveDir, pageErrors, externalRequests, responses) {
  const sid = randomBytes(12).toString('hex');
  const career = createCareer(31872);
  const run = createProbabilityRaid({
    seed: 31872,
    raidId: `qa-full-bag-${sid}`,
    probabilityVersion: 3,
    venue: 'conference',
    difficulty: 'normal',
    player: career.profile.identity,
    loadout: Object.values(career.profile.loadout).filter(Boolean),
    network: career.profile.network,
    contacts: career.profile.contacts,
  });
  const windWeight = Number(ITEMS.wind?.weight);
  assert.ok(windWeight > 0);
  run.probabilityVersion = 3;
  run.revision = 5;
  run.actionIndex = 5;
  run.stats.risk = 18;
  run.stats.will = 7;
  run.bag = ['wind'];
  run.bagCap = windWeight;
  run.pendingLoot = ['wind'];
  run.eventCount = 1;
  run.usedEventIds = ['qa-full-bag-terminal-event'];
  run.encounterCooldown = false;
  run.encounterPacing = { eligibleSearches: 2, dryStreak: 0, firstEventSeen: true };
  run.event = {
    id: 'qa-full-bag-terminal-event',
    name: '测试工程师',
    title: '终端散热异常',
    text: '测试终端温度异常，需要在继续采集前决定如何处理。',
    type: 'technical',
    tone: 'danger',
    image: '/assets/generated/research-desk.png',
    difficulty: 0,
    choices: [{
      key: 'reserve-help', name: '用人脉预约技术协助', cost: { network: 99 },
      onSuccess: { riskDelta: -3, text: '技术协助已预约。' },
    }, {
      key: 'show-code', name: '提供模型源码进行排查', requires: { src_code: 1 }, cost: {},
      onSuccess: { riskDelta: -3, text: '源码排查已完成。' },
    }, {
      key: 'stabilize', name: '隔离热源并继续记录', cost: {},
      onSuccess: { riskDelta: -3, support: 4, text: '散热恢复，现场记录已保存。' },
    }],
  };
  run.lastAction = {
    title: '搜索发现',
    text: '这次搜索发现一件方向情报，同时触发了终端异常。',
    riskDelta: 4,
    willDelta: -1,
    networkDelta: 0,
    itemsAdded: [{ ...ITEMS.wind, id: 'wind', protected: false, pending: true }],
    type: 'search',
    revision: run.revision,
    eventTriggered: {
      id: run.event.id, title: run.event.title, typeLabel: '技术故障', tone: 'danger', image: run.event.image,
    },
    description: 'full-bag event UI fixture',
  };
  career.run = run;
  await fs.writeFile(path.join(saveDir, `${sid}.json`), JSON.stringify(career), 'utf8');

  const context = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !LOCAL_ORIGINS.has(url.origin)) externalRequests.push(url.href);
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.toLowerCase().endsWith('.png')) responses.push({ url: response.url(), status: response.status() });
  });

  try {
    await context.addCookies([{ name: 'sid', value: sid, url: base }]);
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.locator('#raid-screen').waitFor({ state: 'visible', timeout: 10_000 });
    let state = await readState(page);
    assert.equal(state.phase, 'raid');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.locator('#raid-actions').isVisible(), true,
        'the persistent action dock should remain visible while decisions are pending');
      assert.equal(await page.locator('#raid-actions [data-action="search"]').isEnabled(), false,
        'search must be disabled until the pending event and loot are resolved');
      await assertNoForecasts(page, state);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(ARTIFACTS, `ui-v5-overflow-${width}.png`) });
      await assertFieldJourney(page, state, `event-and-overflow-${width}`);
      await assertImmediateEventAction(page, state);
      if (width !== 768) await page.screenshot({ path: path.join(ARTIFACTS, `ui-v5-overflow-${width}.png`) });
    }
    await page.setViewportSize({ width:390, height:844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(ARTIFACTS, 'ui-v5-overflow-390x844.png') });
    assert.equal(state.view.bagUsed, state.view.bagCap, 'the isolated UI fixture should fill the bag exactly');
    assert.equal(state.view.pendingLoot.length, 1);
    assert.ok(state.view.event, 'a full bag must coexist with its unresolved event');
    await assertTurnCardUi(page, state);
    await assertEncounterUi(page, state);
    state = await assertReloadPreservesState(page, state, 'unresolved event and full-bag discovery');
    await assertFieldJourney(page, state, 'recovered-event-and-overflow');
    let leaveButton = page.locator('#raid-actions [data-action="event:leave"]');
    await revealActionDetails(leaveButton);
    await leaveButton.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await leaveButton.isEnabled(), false, 'an event exit must be disabled while a fresh item is pending');
    assert.equal((await leaveButton.innerText()).replace('↗', '').trim(), '撤离', 'blocked extraction keeps a neutral label');
    await assertBagVisible(page, state);
    await assertNoNumericProbabilities(page);

    const firstBagCell = page.locator('#raid-bag button.item-cell').first();
    await firstBagCell.click();
    const closeItem = page.locator('#bag-item-detail [data-close-bag-item]');
    await closeItem.waitFor({ state:'visible' });
    for (const target of await page.locator('#bag-item-detail button').all()) {
      const box = await target.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `material detail controls and close need 44px touch targets: ${await target.innerText()} ${JSON.stringify(box)}`);
    }
    await closeItem.click();
    assert.equal(await page.locator('#bag-item-detail').isVisible(), false, 'closing material detail returns to the live bag');
    assert.deepEqual((await readState(page)).view, state.view, 'opening and closing a bag item cannot spend resources or commit an action');
    const dropped = await clickRaidAction(page, 'drop:0');
    assert.equal(dropped.view.bag.length, 0, 'dropping from the bag detail should free one slot without closing the event');
    assert.equal(dropped.view.pendingLoot.length, 1);
    assert.ok(dropped.view.event);
    assert.equal(dropped.view.encounterPacing.cooldown, false, 'inventory cleanup should not resolve the event cooldown early');
    const accepted = await clickRaidAction(page, 'take:all', '#pending-loot-actions');
    assert.equal(accepted.view.pendingLoot.length, 0);
    assert.equal(accepted.view.bag.length, 1, 'the pending item should fit after the carried item is dropped');
    assert.ok(accepted.view.event, 'sorting loot should leave the event open for a fresh decision');
    leaveButton = page.locator('#raid-actions [data-action="event:leave"]');
    assert.equal(await leaveButton.isEnabled(), true, 'the event exit should re-enable after pending loot is sorted');
    assert.doesNotMatch(await leaveButton.textContent(), /把握|概率|成功|风险上升|可能的结果/,
      'the event exit must not advertise an expected result');
    await assertNoNumericProbabilities(page);
    await assertFieldJourney(page, accepted, 'sorted-loot-event-remains');
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await assertImmediateEventAction(page, accepted);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    await clearEvent(page, accepted);
    state = await readState(page);
    assert.equal(state.view.event, null, 'the selected event action should resolve from its main decision button');
    assert.equal(state.view.pendingLoot.length, 0, 'the sorted item should remain carried after event resolution');
    assert.equal(state.view.encounterPacing.cooldown, true);

    const search = page.locator('#raid-actions [data-action="search"]');
    await search.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await search.isEnabled(), true, 'search should resume after the full-bag event and loot decision are resolved');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
      'the mobile event, pending item, result card, and action area must fit the viewport width');
    const cooldownSearch = await clickRaidAction(page, 'search');
    assert.equal(cooldownSearch.view.event, null, 'the next search after resolving the event should consume cooldown');
    assert.equal(cooldownSearch.view.encounterPacing.cooldown, false);
    assert.equal(cooldownSearch.view.lastAction.eventTriggered, null);
    await assertTurnCardUi(page, cooldownSearch);
  } finally {
    await context.close().catch(() => {});
  }
}

async function clickRaidAction(page, action, scope = '#raid-actions') {
  const itemAction = action.match(/^(drop|use|backup):(\d+)$/);
  let button;
  let beforeBag = null;
  let selectedBagKey = null;
  if (itemAction) {
    await assertBagVisible(page, await readState(page));
    const index = Number(itemAction[2]);
    const before = (await readState(page)).view;
    beforeBag = (before.bag || []).map(item => item.id);
    const item = before.bag?.[index];
    assert.ok(item, `bag item ${index} should exist before ${action}`);
    const cell = page.locator(`button.item-cell[data-item-zone="bag"][data-item-index="${index}"]`).first();
    await cell.waitFor({ state: 'visible', timeout: 7000 });
    selectedBagKey = await cell.getAttribute('data-item-key');
    await cell.click();
    const detail = page.locator('#bag-item-detail');
    await detail.waitFor({ state: 'visible', timeout: 5000 });
    assert.ok((await detail.innerText()).includes(item.name), 'bag detail should match the item currently at the selected index');
    button = detail.locator(`[data-action="${action}"]`).first();
  } else {
    button = page.locator(`${scope} [data-action="${action}"]`).first();
  }
  await button.waitFor({ state: 'visible', timeout: 7000 });
  assert.equal(await button.isEnabled(), true, `raid action ${action} should be enabled`);
  const responseWait = waitForApi(page, '/api/expedition/action', 'POST', body => body?.action === action);
  await button.click();
  const response = await responseWait;
  const payload = await response.json();
  await page.waitForFunction(() => !document.body.classList.contains('is-pending'), null, { timeout: 7000 });
  assert.equal(payload.ok, true, `raid action ${action} failed: ${payload.reason || 'no reason returned'}`);
  if (payload.phase === 'raid') await assertNoForecasts(page, payload);
  else await assertNoNumericProbabilities(page);
  if (itemAction?.[1] === 'drop') {
    const afterBag = (payload.view.bag || []).map(item => item.id);
    const index = Number(itemAction[2]);
    assert.equal(afterBag.length, beforeBag.length - 1, 'dropping through the selected item detail should remove one item');
    if (index < afterBag.length) {
      assert.equal(afterBag[index], beforeBag[index + 1], 'the next item should move into the dropped index without keeping a stale action');
    }
    assert.equal(await page.locator(`button.item-cell[data-item-zone="bag"][data-item-key="${selectedBagKey}"]`).count(), 0,
      'a revision change must retire the old bag-cell key');
    assert.equal(await page.locator('#bag-item-detail [data-action^="drop:"]').count(), 0,
      'dropping an item must clear its stale detail action');
  }
  return payload;
}

function imageFailures(responses) {
  return responses.filter(row => row.url.endsWith('.png') && (row.status < 200 || row.status >= 400));
}

async function verifyPngAssets(page) {
  const images = await page.evaluate(async () => {
    const elements = [...document.images].filter(image => new URL(image.src, location.href).pathname.toLowerCase().endsWith('.png'));
    await Promise.all(elements.map(image => {
      image.loading = 'eager';
      return image.decode().then(() => true, () => false);
    }));
    return elements.map(image => ({ src: image.currentSrc || image.src, loaded: image.complete && image.naturalWidth > 0 }));
  });
  assert.ok(images.length > 0, 'the hub should render existing PNG artwork');
  assert.ok(images.every(image => image.loaded), `PNG artwork must decode: ${JSON.stringify(images.filter(image => !image.loaded))}`);
}

async function inspectResultItemCells(page) {
  for (const zone of ['result-returned', 'result-lost']) {
    const cell = page.locator(`button.item-cell[data-item-zone="${zone}"]`).first();
    if (!(await cell.count())) continue;
    await cell.waitFor({ state: 'visible', timeout: 5000 });
    const name = await cell.locator('.cell-name').innerText();
    await cell.click();
    const detail = page.locator('#result-item-detail');
    await detail.waitFor({ state: 'visible', timeout: 5000 });
    assert.ok((await detail.innerText()).includes(name), `${zone} result cells should show a read-only detail for ${name}`);
    assert.equal(await cell.getAttribute('aria-pressed'), 'true');
  }
}

function isTerminalEventAction(action) {
  if (typeof action?.endsRaid === 'boolean') return action.endsRaid;
  return Boolean(action?.endsRun || action?.terminal || action?.settles)
    || /^(?:(?:event|respond):)?(?:leave|withdraw|extract|retreat|exit|end)$/i.test(action?.id || '');
}

function chooseEventAction(actions = []) {
  const available = actions.filter(action => action && !action.disabled);
  const continuing = available.filter(action => !isTerminalEventAction(action));
  const choices = continuing.length ? continuing : available;
  return choices.sort((a, b) => Number(b.successProbability ?? b.probability ?? b.chance ?? 0)
    - Number(a.successProbability ?? a.probability ?? a.chance ?? 0))[0] || null;
}

async function clearEvent(page, state) {
  await assertEncounterUi(page, state);
  if (!eventShotsCaptured) {
    const original = page.viewportSize() || { width: 1440, height: 900 };
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await assertFieldJourney(page, state, 'event-desktop');
      await assertImmediateEventAction(page, state);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: EVENT_DESKTOP_SHOT, fullPage: true });
      await page.screenshot({ path: FIELD_EVENT_DESKTOP_SHOT });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
        'the open event and immediate result card must not create mobile horizontal overflow');
      await page.screenshot({ path: EVENT_MOBILE_SHOT, fullPage: true });
      await assertFieldJourney(page, state, 'event-mobile');
      await assertImmediateEventAction(page, state);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: FIELD_EVENT_MOBILE_SHOT });
      await page.setViewportSize({ width: 320, height: 844 });
      await assertFieldJourney(page, state, 'event-320');
      await assertImmediateEventAction(page, state);
      await page.screenshot({ path: path.join(ARTIFACTS, 'ui-v5-expedition-event-320.png') });
      eventShotsCaptured = true;
    } finally {
      await page.setViewportSize(original);
    }
  }
  const choice = chooseEventAction(state.view.event?.actions);
  if (!choice && state.view.pendingLoot?.length) {
    const skip = page.locator('#pending-loot-actions [data-action="take:skip"]');
    await skip.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await skip.isEnabled(), true, 'pending loot should remain explicitly declinable if no event choice is currently available');
    const cleared = await clickRaidAction(page, 'take:skip', '#pending-loot-actions');
    assert.ok(cleared.view.event, 'declining a blocked overflow item should preserve its simultaneous event');
    return clearEvent(page, cleared);
  }
  assert.ok(choice?.id, 'an event without an available response should have pending loot that can be resolved first');
  const decorativeCost = page.locator('#event-choices .decision-option .decision-cost').first();
  if (await decorativeCost.count() && await decorativeCost.isVisible()) {
    const revisionBeforeDecorationClick = state.view.revision;
    await decorativeCost.click();
    const unchanged = await readState(page);
    assert.equal(unchanged.view.revision, revisionBeforeDecorationClick,
      'clicking a cost label should not submit an event action; only its main button is actionable');
    assert.equal(unchanged.view.event?.id, state.view.event.id, 'non-button event details should leave the event open');
  }
  const result = await clickRaidAction(page, choice.id, isTerminalEventAction(choice) ? '#raid-actions' : '#event-choices');
  if (!isTerminalEventAction(choice)) {
    await page.locator('#raid-event-card').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  return result;
}

async function assertTurnCardUi(page, state) {
  const card = page.locator('#raid-turn-card');
  if (state.view.event || state.view.pendingLoot.length) {
    assert.equal(await card.isVisible(), false, 'a pending decision should not stack an extra action-record panel');
    assert.equal((await card.textContent()).trim(), '', 'hidden feedback should be cleared, not retain narrative or forecast copy');
    await assertBagVisible(page, state);
    assert.deepEqual(await page.locator('#pending-loot-items button.item-cell').evaluateAll(nodes => nodes.map(node => node.dataset.itemId)),
      state.view.pendingLoot.map(item => item.id), 'pending discoveries must show their actual icons while the receipt is hidden');
    const actualIds = [...state.view.bag, ...state.view.pendingLoot].map(item => item.id);
    for (const item of state.view.lastAction?.itemsAdded || []) assert.ok(actualIds.includes(item.id), 'every reported discovery remains visible in the actual bag or pending items');
    return;
  }
  await card.waitFor({ state: 'visible', timeout: 5000 });
  assert.ok((await card.innerText()).trim(), 'an action must receive concise actual-result feedback');
  assert.ok((await card.innerText()).trim().length <= 160, 'latest-action feedback must remain a short receipt, not a narrative panel');
  const reportedItems = state.view.lastAction?.itemsAdded || [];
  assert.equal(await page.locator('#raid-turn-items .raid-mini-loot').count(), reportedItems.length,
    'the action receipt should list every item actually added by the last action');
  for (const item of reportedItems) assert.ok((await page.locator('#raid-turn-items .raid-mini-loot').evaluateAll(nodes => nodes.map(node => node.title))).some(title => title.includes(item.name || item.id)), 'each gained item icon must identify its actual item');
  await assertBagVisible(page, state);
  const boxes = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    return { card:rect('#raid-turn-card'), actions:rect('#raid-actions') };
  });
  const overlap = Math.min(boxes.card.right, boxes.actions.right) > Math.max(boxes.card.left, boxes.actions.left)
    && Math.min(boxes.card.bottom, boxes.actions.bottom) > Math.max(boxes.card.top, boxes.actions.top);
  assert.equal(overlap, false, `the receipt must not cover the primary action area: ${JSON.stringify(boxes)}`);
}

async function assertEncounterUi(page, state) {
  const event = state.view.event;
  assert.ok(event, 'the event UI assertion requires an active event');
  const eventCard = page.locator('#raid-event-card');
  await eventCard.waitFor({ state: 'visible', timeout: 5000 });
  const prompt = (await page.locator('#event-title').innerText()).trim();
  assert.ok(prompt.length > 0 && prompt.length <= 100, 'the event should pose one short prompt');
  const image = page.locator('#field-scene .scene-object');
  await image.waitFor({ state: 'visible', timeout: 5000 });
  await image.evaluate(element => element.decode());
  assert.ok(await image.evaluate(element => element.naturalWidth > 0), 'compact field artwork should load');
  assert.ok(event.actions?.length > 0, 'the active event should provide real server-listed choices');
  const buttons = page.locator('#event-choices [data-action]');
  const offered = event.actions.filter(choice => !choice.disabled && !isTerminalEventAction(choice));
  assert.equal(await buttons.count(), offered.length, 'every usable server event choice must remain available in the UI');
  for (const choice of offered) {
    const button = page.locator(`#event-choices [data-action="${choice.id}"]`);
    assert.equal(await button.isEnabled(), !choice.disabled, 'neutral choices must preserve actual availability');
    const text = (await button.innerText()).trim();
    assert.ok(text.length > 0 && text.length <= 24, `neutral event label should be brief: ${text}`);
    assert.doesNotMatch(text, /把握|概率|可能的结果|成功|失败|风险[升降]|收益/);
    assert.equal(await button.locator('small').count(), 0, 'no secondary likelihood or forecast label may sit inside a choice');
    assert.ok((await button.boundingBox()).height >= 44, 'event choices need 44px touch targets');
  }
  assert.equal(await page.locator('#event-choices details, #event-choices .decision-cost, #event-choices .decision-outcomes').count(), 0,
    'event options should expose neither costs nor expected-result disclosures');
  await assertNoForecasts(page, state);
}

async function assertResearchJourney(page, state, fixture) {
  const research = state.hub.research;
  const card = page.locator('#research-card');
  await card.waitFor({ state: 'visible', timeout: 5000 });
  assert.doesNotMatch(await card.innerText(), /\b(?:experiment|submitted|revision|rejected|ready)\b/,
    'research stages should use meaningful player-facing labels rather than internal state names');
  const primary = card.locator('[data-research-primary]');
  assert.equal(await primary.count(), 1, `${fixture.name}: one clearly marked next research step should lead the workbench`);
  assert.equal(await primary.isVisible(), true, `${fixture.name}: the next research step should not need a disclosure`);
  if (fixture.action) {
    assert.equal(await primary.getAttribute('data-hub-action'), fixture.action,
      `${fixture.name}: the prominent action must match the actual research stage`);
    assert.equal(await primary.isEnabled(), !fixture.disabled,
      `${fixture.name}: the prominent action must respect real prerequisites`);
  }
  if (research.project) {
    for (const [key, now, max] of [['runs', research.project.runs, 6], ['quality', research.project.quality, 100]]) {
      const meter = card.locator(`[data-research-progress="${key}"]`);
      assert.equal(await meter.count(), 1, `${key} needs one visual research progress indicator`);
      assert.equal(Number(await meter.getAttribute('aria-valuenow')), Number(now), `${key} must display the actual project value`);
      assert.equal(Number(await meter.getAttribute('aria-valuemax')), Number(max), `${key} must display the actual project limit or target`);
      if (key === 'quality') assert.equal(Number(await meter.getAttribute('data-target')), research.project.target,
        'the quality bar must mark the actual acceptance target separately from its 100-point scale');
    }
    if (fixture.action === 'research:experiment') {
      const action = research.actions.find(action => action.id === fixture.action);
      const actionsText = await page.locator('#research-actions').innerText();
      assert.ok(actionsText.includes(String(research.project.experimentCost)), 'the next experiment should show its real funding cost');
      assert.match(actionsText, /算力/, 'the experiment should show its consumed material before committing');
      if (action.disabled) {
        for (const reason of action.reason.split('；').filter(Boolean)) {
          assert.ok((await card.innerText()).includes(reason), `blocked experiment should expose its exact server prerequisite: ${reason}`);
        }
      }
    }
  } else if (fixture.name !== 'promotion') {
    const templates = page.locator('#research-templates');
    for (const template of research.templates) {
      const button = templates.locator(`[data-hub-action="research:start:${template.id}"]`);
      assert.equal(await button.isEnabled(), !template.disabled, 'project cards should obey server start requirements');
    }
  }
  const requiredMaterials = page.locator('#research-templates > .rw-current [data-research-material], .rw-main > .rw-current [data-research-material]');
  for (let index = 0; index < await requiredMaterials.count(); index += 1) {
    const row = requiredMaterials.nth(index);
    const id = await row.getAttribute('data-research-material');
    const stored = state.hub.items.find(item => item.id === id)?.storedCount || 0;
    assert.equal(Number(await row.getAttribute('data-available')), stored, 'material requirements must use actual stored copies');
    assert.ok(Number(await row.getAttribute('data-required')) > 0, 'material requirements must state a positive required quantity');
  }
  const geometry = await primary.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const card = document.querySelector('#research-card').getBoundingClientRect();
    return { width: innerWidth, primaryTop: rect.top - card.top, primaryBottom: rect.bottom - card.top, primaryHeight: rect.height };
  });
  assert.ok(geometry.primaryHeight >= 40 && geometry.primaryBottom <= 880,
    `${fixture.name}: the next research action should be prominent within the first workbench screen: ${JSON.stringify(geometry)}`);
  journeyMetrics.push({ label: `research-${fixture.name}`, ...geometry });
  await assertFitsViewport(page, `research ${fixture.name}`);
  await assertNoNumericProbabilities(page);
}

async function runResearchJourneyScenarios(browser, base, saveDir, pageErrors, externalRequests, responses) {
  for (const fixture of createResearchJourneyFixtures()) {
    const sid = randomBytes(12).toString('hex');
    await fs.writeFile(path.join(saveDir, `${sid}.json`), JSON.stringify(fixture.career), 'utf8');
    const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    watchScenarioPage(page, pageErrors, externalRequests, responses);
    try {
      await context.addCookies([{ name: 'sid', value: sid, url: base }]);
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.locator('#hub-screen').waitFor({ state: 'visible', timeout: 10_000 });
      let state = await readState(page);
      await activateWorkspace(page, 'research');
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
        await assertResearchJourney(page, state, fixture);
        if (fixture.name === 'missing') {
          await page.locator('#research-card').evaluate(element => element.scrollIntoView({ block: 'start' }));
          await page.screenshot({ path: width === 1440 ? RESEARCH_DESKTOP_SHOT : width === 390 ? RESEARCH_MOBILE_SHOT : path.join(ARTIFACTS, 'ui-v3-research-320.png') });
        }
      }
      state = await assertReloadPreservesState(page, state, `research ${fixture.name}`);
      await activateWorkspace(page, 'research');
      await assertResearchJourney(page, state, fixture);
      if (fixture.name === 'missing') {
        const openShop = page.locator('#research-card .rw-sources [data-open-workspace="shop"]');
        await openShop.click();
        await page.locator('#workspace-panel-shop').waitFor({ state: 'visible', timeout: 5000 });
        const afterBrowse = await readState(page);
        assert.deepEqual(afterBrowse.hub.research, state.hub.research, 'opening the recommended material source must not alter project progress');
        assert.equal(afterBrowse.hub.funding, state.hub.funding, 'the source shortcut must not automatically purchase materials');
        await activateWorkspace(page, 'research');
        await assertResearchJourney(page, state, fixture);
        const abandon = page.locator('#research-card [data-hub-action="research:abandon"]');
        await revealActionDetails(abandon);
        let confirmation = '';
        page.once('dialog', async dialog => { confirmation = dialog.message(); await dialog.dismiss(); });
        await abandon.click();
        assert.match(confirmation, /放弃|不返还/, 'abandonment should explain the permanent loss of invested project resources');
        const afterCancel = await readState(page);
        assert.deepEqual(afterCancel.hub.research, state.hub.research, 'canceling abandonment must preserve every part of the active research project');
        assert.equal(afterCancel.hub.funding, state.hub.funding, 'canceling abandonment must not change funding');
        page.once('dialog', async dialog => { await dialog.accept(); });
        const afterAbandon = await clickHubAction(page, 'research:abandon');
        assert.equal(afterAbandon.hub.research.project, null, 'confirmed abandonment should close the project');
        assert.equal(afterAbandon.hub.funding, state.hub.funding, 'abandonment must not invent a refund');
        assert.deepEqual(afterAbandon.hub.items, state.hub.items, 'abandonment must not return spent material');
        assert.deepEqual(afterAbandon.hub.research.skills, state.hub.research.skills, 'abandonment must preserve earned skills');
      } else if (fixture.name === 'experiment') {
        const after = await clickHubAction(page, fixture.action);
        assert.equal(after.hub.research.project.runs, state.hub.research.project.runs + 1, 'the primary experiment should add exactly one real run');
        assert.equal(after.hub.funding, state.hub.funding - state.hub.research.project.experimentCost, 'the primary experiment should charge its shown funding cost');
        assert.equal(after.hub.items.find(item => item.id === 'compute')?.storedCount,
          state.hub.items.find(item => item.id === 'compute')?.storedCount - 1, 'the primary experiment should consume exactly one real compute card');
        await assertReloadPreservesState(page, after, 'completed primary experiment');
      } else if (fixture.name === 'ready') {
        const after = await clickHubAction(page, fixture.action);
        assert.equal(after.hub.research.project, null, 'confirming acceptance should finish the current project');
        assert.equal(after.hub.research.papers.length, state.hub.research.papers.length + 1, 'confirming acceptance should add exactly one actual paper');
        await assertResearchJourney(page, after, { name: 'promotion', action: 'research:promote' });
        await assertReloadPreservesState(page, after, 'accepted paper and promotion eligibility');
      } else if (fixture.name === 'promotion') {
        const after = await clickHubAction(page, fixture.action);
        assert.equal(after.hub.research.stage, state.hub.research.stage + 1, 'the prominent promotion should advance exactly one earned stage');
        await assertReloadPreservesState(page, after, 'earned promotion');
      }
    } finally {
      await context.close().catch(() => {});
    }
  }
}

async function completeResearchThroughUi(page) {
  const before = await readState(page);
  assert.equal(before.phase, 'hub');
  assert.ok(before.hub.research, 'research workspace should be present in the real hub');
  const datasetBefore = Number(before.hub.items.find(item => item.id === 'dataset')?.storedCount || 0);

  await clickHubAction(page, 'unequip:device');
  await clickHubAction(page, 'equip:lightweight_laptop');
  await clickHubAction(page, 'buy:wind');
  await clickHubAction(page, 'sell:wind');
  await clickHubAction(page, 'research:direction:systems');

  await clickHubAction(page, 'buy:dataset');
  await clickHubAction(page, 'buy:dataset');
  await clickHubAction(page, 'buy:src_code');
  for (let i = 0; i < 4; i += 1) await clickHubAction(page, 'buy:compute');

  await activateWorkspace(page, 'inventory');
  const datasetCell = page.locator('#hub-stash button.item-cell[data-item-zone="stash"][data-item-id="dataset"]');
  await datasetCell.waitFor({ state: 'visible', timeout: 7000 });
  const datasetCount = datasetBefore + 2;
  assert.match(await datasetCell.locator('.cell-count').innerText(), new RegExp(`×\\s*${datasetCount}`),
    'same-kind stash items should aggregate into a visible count badge');
  await activateWorkspace(page, 'research');

  const template = page.locator('#research-templates [data-hub-action="research:start:replicate"]');
  await template.waitFor({ state: 'visible', timeout: 7000 });
  assert.equal(await template.isEnabled(), true, 'purchased, real stock materials should enable replication');
  const startWait = waitForApi(page, '/api/hub/action', 'POST', body => body?.action === 'research:start:replicate');
  await template.click();
  await startWait;
  await page.waitForFunction(() => !document.body.classList.contains('is-pending'), null, { timeout: 7000 });

  for (let attempt = 0; attempt < 18; attempt += 1) {
    const current = await readState(page);
    assert.equal(current.phase, 'hub');
    const research = current.hub.research;
    const project = research.project;
    if (!project) {
      if (research.papers?.length >= 1) break;
      throw new Error('research project disappeared before an accepted paper was published');
    }
    if (project.status === 'ready') {
      await clickHubAction(page, 'research:publish');
    } else if (project.status === 'submitted') {
      await clickHubAction(page, 'research:review');
    } else if (['experiment', 'revision', 'rejected'].includes(project.status)) {
      const canSubmit = project.runs >= 2 && project.runs > (project.submittedRuns || 0);
      await clickHubAction(page, canSubmit ? 'research:submit' : 'research:experiment');
    } else {
      throw new Error(`unexpected project status: ${project.status}`);
    }
  }

  let after = await readState(page);
  assert.equal(after.phase, 'hub');
  assert.ok(after.hub.research.papers.length >= 1, 'research workflow should publish a real paper');
  const promotion = page.locator('#research-actions [data-hub-action="research:promote"]');
  await promotion.waitFor({ state: 'visible', timeout: 7000 });
  assert.equal(await promotion.isEnabled(), true, `promotion requirements should be fulfilled: ${JSON.stringify(after.hub.research.promotionReasons)}`);
  const promotionWait = waitForApi(page, '/api/hub/action', 'POST', body => body?.action === 'research:promote');
  await promotion.click();
  await promotionWait;
  await page.waitForFunction(() => !document.body.classList.contains('is-pending'), null, { timeout: 7000 });
  after = await readState(page);
  assert.ok(after.hub.research.stage >= 1, 'the published paper should unlock the master stage');
  return after;
}

async function finishRaidThroughUi(page, initialState) {
  let current = initialState;
  for (let step = 0; step < 6 && current.phase === 'raid'; step += 1) {
    if (current.view.event?.id) {
      current = await clearEvent(page, current);
    } else if (current.view.pendingLoot?.length) {
      const action = page.locator('#pending-loot-actions [data-action^="take:"]:not(:disabled)').first();
      await action.waitFor({ state: 'visible', timeout: 6000 });
      await clickRaidAction(page, await action.getAttribute('data-action'), '#pending-loot-actions');
    } else {
      await clickRaidAction(page, 'extract');
    }
    current = await readState(page);
  }
  return current;
}

async function runSearchField(page, initialState) {
  let current = initialState;
  let sawEvent = false;
  let sawOverflowDecision = false;
  for (let turn = 0; turn < 10 && current.phase === 'raid'; turn += 1) {
    if (current.view.event?.id) {
      sawEvent = true;
      current = await clearEvent(page, current);
      if (current.phase !== 'raid') break;
    }

    if (current.view.pendingLoot?.length) {
      const takeAll = page.locator('#pending-loot-actions [data-action="take:all"]');
      if (await takeAll.count() && !(await takeAll.isEnabled())) {
        sawOverflowDecision = true;
        const dropAction = current.view.actions?.find(action => action.id.startsWith('drop:') && !action.disabled);
        if (dropAction) current = await clickRaidAction(page, dropAction.id);
      }
      const take = page.locator('#pending-loot-actions [data-action^="take:"]:not(:disabled)').first();
      if (!(await take.count())) break;
      current = await clickRaidAction(page, await take.getAttribute('data-action'), '#pending-loot-actions');
      continue;
    }

    if (sawOverflowDecision && !current.view.event?.id) {
      const serverSearch = current.view.actions.find(action => action.id === 'search');
      await page.waitForFunction(() => !document.body.classList.contains('is-pending'));
      assert.equal(await page.locator('#raid-actions [data-action="search"]').isEnabled(), !serverSearch.disabled,
        'after loot recovery, search availability should match the actual remaining heart and capacity');
    }
    const search = page.locator('#raid-actions [data-action="search"]');
    if (!(await search.count()) || !(await search.isEnabled())) break;
    const responseWait = waitForApi(page, '/api/expedition/action', 'POST', body => body?.action === 'search');
    await search.click();
    current = await (await responseWait).json();
    await page.waitForFunction(() => !document.body.classList.contains('is-pending'), null, { timeout: 7000 });
    assert.equal(current.ok, true, `search ${turn + 1} should commit: ${current.reason || 'no reason returned'}`);
    await assertTurnCardUi(page, current);
    await assertNoForecasts(page, current);
    if (current.view.event?.id) sawEvent = true;
  }

  if (current.phase === 'raid') current = await finishRaidThroughUi(page, current);
  return { state: current, sawEvent, sawOverflowDecision };
}

let browser, context, activePage, game, model;
let saveDir;
let finalState;
const pageErrors = [];
const externalRequests = [];
const responses = [];

try {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  saveDir = await fs.mkdtemp(path.join(ARTIFACTS, 'probability-browser-'));
  model = await startLocalModel();
  const port = await freePort();
  game = await startGameServer(port, saveDir, model.baseUrl);
  LOCAL_ORIGINS.add(game.base);

  const chromePath = [
    process.env.CHROME_PATH,
    path.join(ROOT, '.browser-cache/chromium_headless_shell-1161/chrome-linux/headless_shell'),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean).find(existsSync);
  browser = await chromium.launch({ ...(chromePath ? { executablePath: chromePath } : {}), headless: true });
  context = await browser.newContext({ baseURL: game.base, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  activePage = await context.newPage();
  activePage.on('pageerror', error => pageErrors.push(error.message));
  activePage.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !LOCAL_ORIGINS.has(url.origin)) externalRequests.push(url.href);
  });
  activePage.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.toLowerCase().endsWith('.png')) responses.push({ url: response.url(), status: response.status() });
  });

  await runResearchJourneyScenarios(browser, game.base, saveDir, pageErrors, externalRequests, responses);
  await activePage.goto(`${game.base}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await activePage.locator('#hub-screen').waitFor({ state: 'visible', timeout: 12_000 });
  const retiredPages = await activePage.evaluate(async () => Promise.all(['/legacy.html', '/redesign.html'].map(async route => {
    const response = await fetch(route, { cache: 'no-store' });
    return [route, response.status];
  })));
  assert.deepEqual(retiredPages, [['/legacy.html', 404], ['/redesign.html', 404]],
    'the retired gameplay and prototype pages should no longer be served');
  let state = await readState(activePage);
  assert.equal(state.phase, 'hub', 'the default page should start in the real preparation hub');
  assert.ok(state.hub.shop?.length > 0, 'the live shop should expose stock');
  assert.ok(state.hub.loadout && Object.values(state.hub.loadout).some(Boolean), 'the live hub should show equipped gear');
  assert.ok(state.hub.research?.templates?.length > 0, 'the real research workspace should list project templates');
  assert.ok((await activePage.locator('#hub-shop button.item-cell[data-item-zone="shop"]').count()) > 0, 'shop stock should render selectable item cells');
  assert.equal(await activePage.locator('#setup-venue').inputValue(), 'conference');
  assert.equal(await activePage.locator('#setup-target').count(), 0, 'new preparation UI should not pin a single target material');
  assert.equal(await activePage.locator('#setup-strategy').count(), 0, 'new preparation UI should use difficulty rather than a separate strategy');
  assert.deepEqual(state.hub.probabilitySetup.difficulties.map(row => row.id), ['easy', 'normal', 'hard']);
  const conferenceSetup = state.hub.probabilitySetup.venues.find(row => row.id === 'conference');
  assert.ok(conferenceSetup?.difficultyPreviews?.length === 3);
  assert.equal(await activePage.locator('#setup-difficulty-options [data-difficulty-choice]').count(), 3);
  assert.equal(await activePage.locator('#setup-difficulty-options [data-difficulty-choice="normal"]').getAttribute('aria-pressed'), 'true',
    'normal should be the default new-game difficulty');
  const materialPool = activePage.locator('#setup-material-pool [data-material-id]');
  assert.equal(await activePage.locator('#setup-difficulty-preview').count(), 0, 'setup forecast panels must be removed');
  for (const selector of ['#setup-detail-panel', '#equipment-details', '#venue-details']) {
    assert.equal(await activePage.locator(selector).evaluate(element => element.open), false,
      `${selector} should start collapsed so departure choices remain primary`);
  }
  assert.equal(await activePage.locator('#hub-stats .stat').count(), 2, 'the hub should show only funds and research stage');
  assert.equal(await activePage.locator('#career-stats').isVisible(), false, 'lifetime statistics belong in records');
  const normalPreviewData = conferenceSetup.difficultyPreviews.find(row => row.difficultyId === 'normal');
  await assertNoForecasts(activePage);
  await setDisclosure(activePage, '#setup-detail-panel');
  assert.equal(await activePage.locator('#setup-material-pool').isVisible(), true, 'the location material catalog should remain available on demand');
  const setupPoolRows = await materialPool.evaluateAll(rows => rows.map(row => ({
    id: row.dataset.materialId,
  })));
  assert.deepEqual(setupPoolRows.sort((a, b) => a.id.localeCompare(b.id)),
    normalPreviewData.materials.map(row => ({ id: row.id })).sort((a, b) => a.id.localeCompare(b.id)),
    'setup material icons must preserve the actual location material catalog without rates');
  await assertNoNumericProbabilities(activePage);
  await setDisclosure(activePage, '#setup-detail-panel', false);
  assert.equal(await materialPool.count(), 4, 'the live preparation panel should preview all naturally occurring material types');
  assert.deepEqual((await materialPool.evaluateAll(rows => rows.map(row => row.dataset.materialId))).sort(),
    ['compute', 'dataset', 'src_code', 'wind']);
  assert.equal(await activePage.locator('[data-workspace-tab]').count(), 5, 'the workshop should offer five distinct sections');
  assert.equal(await activePage.locator('[data-workspace-panel]:visible').count(), 1, 'only the current workspace should be expanded');
  assert.equal(await activePage.locator('[data-workspace-tab="prepare"]').getAttribute('aria-selected'), 'true');
  await activePage.locator('[data-workspace-tab="prepare"]').focus();
  await activePage.keyboard.press('ArrowRight');
  assert.equal(await activePage.locator('[data-workspace-tab="research"]').getAttribute('aria-selected'), 'true', 'keyboard navigation should open the research area');
  await activePage.keyboard.press('End');
  assert.equal(await activePage.locator('[data-workspace-tab="records"]').getAttribute('aria-selected'), 'true');
  await activePage.keyboard.press('Home');
  assert.equal(await activePage.locator('[data-workspace-tab="prepare"]').getAttribute('aria-selected'), 'true');
  const normalPreviewText = await activePage.locator('#setup-difficulty-description').innerText();
  await selectDifficulty(activePage, 'hard');
  const hardPreviewText = await activePage.locator('#setup-difficulty-description').innerText();
  assert.notEqual(hardPreviewText, normalPreviewText, 'choosing hard should update its neutral difficulty description');
  const hardDifficulty = state.hub.probabilitySetup.difficulties.find(row => row.id === 'hard');
  assert.equal(hardDifficulty.eventModifier, -10, 'the internal hard-mode response penalty should remain intact');
  await assertNoNumericProbabilities(activePage);
  await activateWorkspace(activePage, 'shop');
  await activateWorkspace(activePage, 'prepare');
  assert.equal(await activePage.locator('#setup-difficulty-options [data-difficulty-choice="hard"]').getAttribute('aria-pressed'), 'true',
    'difficulty selection should survive workspace rerenders');
  await activePage.evaluate(() => window.scrollTo(0, 0));
  await assertFirstScreenIsConcise(activePage, 'hub');
  await activePage.screenshot({ path: path.join(ARTIFACTS, 'ui-after-desktop-viewport.png') });
  await activePage.screenshot({ path: path.join(ARTIFACTS, 'ui-v2-prepare-desktop.png') });
  await activePage.screenshot({ path: DIFFICULTY_DESKTOP_SHOT, fullPage: true });
  await activePage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await activePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    'the new difficulty cards and natural material pool should not overflow on mobile');
  await activePage.evaluate(() => window.scrollTo(0, 0));
  await assertFirstScreenIsConcise(activePage, 'hub');
  await activePage.screenshot({ path: path.join(ARTIFACTS, 'ui-after-mobile-viewport.png') });
  await activePage.screenshot({ path: path.join(ARTIFACTS, 'ui-v2-prepare-mobile.png') });
  await activePage.screenshot({ path: DIFFICULTY_MOBILE_SHOT, fullPage: true });
  await activePage.setViewportSize({ width: 1440, height: 900 });
  await selectDifficulty(activePage, 'normal');
  await activateWorkspace(activePage, 'shop');
  await assertEqualCellGeometry(activePage, '#hub-shop button.item-cell');
  const lockedGear = state.hub.shop.find(item => item.id === 'gpu_workstation');
  assert.ok(lockedGear, 'locked advanced equipment should still appear in the shop');
  const lockedCell = await selectItemCell(activePage, 'shop', 'gpu_workstation', {
    itemId: 'gpu_workstation', expectedName: lockedGear.name, expectedCost: lockedGear.price,
  });
  const lockedBuy = lockedCell.detail.locator('[data-hub-action="buy:gpu_workstation"]');
  assert.equal(await lockedBuy.isEnabled(), false, 'a locked shop cell should be inspectable while purchase remains disabled');
  await activateWorkspace(activePage, 'prepare');
  await verifyPngAssets(activePage);

  // Invalid legacy data must leave a visible recovery path outside hidden screens.
  await activePage.route('**/api/state', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({ response, json: { ...payload, view: { mode: 'legacy', status: 'playing' } } });
  }, { times: 1 });
  await activePage.reload();
  await activePage.locator('#global-feedback').waitFor({ state: 'visible' });
  await activePage.waitForFunction(() => /无法读取.*同步进度/.test(document.querySelector('#global-feedback')?.innerText || ''), null, { timeout: 7000 });
  assert.match(await activePage.locator('#global-feedback').innerText(), /无法读取.*同步进度/);
  await activePage.locator('#hub-refresh-state').click();
  await activePage.locator('#hub-screen').waitFor({ state: 'visible' });

  // UI regression: keyboard dismissal and all narrow/intermediate workspaces.
  await activePage.emulateMedia({ reducedMotion: 'reduce' });
  await openEquipmentDetails(activePage);
  const bagSlot = activePage.locator('[data-item-zone="loadout"][data-item-key="bag"]');
  await bagSlot.focus();
  await bagSlot.press('Enter');
  assert.equal(await activePage.locator('#equipment-picker').evaluate(el => el === document.activeElement), true,
    'opening equipment by keyboard should move focus into the picker');
  await activePage.locator('#equipment-picker').press('Escape');
  assert.equal(await activePage.locator('#equipment-picker').isVisible(), false);
  assert.equal(await bagSlot.evaluate(el => el === document.activeElement), true, 'closing picker restores slot focus');
  for (const width of [320, 360, 701, 768, 900]) {
    await activePage.setViewportSize({ width, height: 900 });
    for (const workspace of ['prepare', 'research', 'inventory', 'shop', 'records']) {
      await activateWorkspace(activePage, workspace);
      assert.equal(await activePage.locator('#hub-start-raid').isVisible(), workspace === 'prepare',
        'the fixed departure bar must only appear on the prepare workspace');
      assert.equal(await activePage.locator('#hub-stats .stat:visible').count(), 2, 'only the two compact hub statistics remain visible');
      assert.equal(await activePage.locator('#career-stats').isVisible(), workspace === 'records',
        'career totals should be available in records without crowding other workspaces');
      await assertNoNumericProbabilities(activePage);
      assert.equal(await activePage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
        `${workspace} should fit the ${width}px viewport`);
    }
    await openEquipmentDetails(activePage);
    await bagSlot.click();
    assert.equal(await activePage.locator('.picker-browser').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1,
      'equipment picker should never nest two cramped columns');
    assert.equal(await activePage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
      `open equipment picker should fit the ${width}px viewport`);
    await activePage.locator('#equipment-picker-close').click();
  }
  await activePage.setViewportSize({ width: 1440, height: 900 });
  await activePage.evaluate(() => window.scrollTo(0, 0));
  await activePage.screenshot({ path: DESKTOP_SHOT, fullPage: true });
  await activePage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await activePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    'default mobile hub must not overflow horizontally');
  await activePage.screenshot({ path: MOBILE_SHOT, fullPage: true });
  await activateWorkspace(activePage, 'shop');
  const windInfo = state.hub.shop.find(item => item.id === 'wind');
  const mobileDetail = await selectItemCell(activePage, 'shop', 'wind', {
    itemId: 'wind', expectedName: windInfo.name, expectedCost: windInfo.price,
  });
  const detailBounds = await mobileDetail.detail.evaluate(element => element.getBoundingClientRect().toJSON());
  assert.ok(detailBounds.bottom > 0 && detailBounds.top < 844, 'mobile item details should scroll into view after cell selection');
  assert.equal(await activePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    'opening item details on mobile must not create horizontal overflow');
  await activateWorkspace(activePage, 'prepare');
  await activePage.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await activePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    'default desktop hub must not overflow horizontally');

  await clickHubAction(activePage, 'unequip:device');
  await clickHubAction(activePage, 'equip:lightweight_laptop');
  await clickHubAction(activePage, 'unequip:bag');
  await clickHubAction(activePage, 'buy:wind');
  let windCount = Number((await readState(activePage)).hub.items.find(item => item.id === 'wind')?.storedCount || 0);
  while (windCount > 0) {
    await clickHubAction(activePage, 'sell:wind');
    windCount = Number((await readState(activePage)).hub.items.find(item => item.id === 'wind')?.storedCount || 0);
  }
  await activePage.locator('[data-workspace-tab="prepare"]').click();
  await selectDifficulty(activePage, 'normal');

  let sawEvent = false;
  let sawOverflowDecision = false;
  for (let attempt = 0; attempt < 4 && !sawOverflowDecision; attempt += 1) {
    const deployButton = activePage.locator('#hub-start-raid');
    await deployButton.waitFor({ state: 'visible', timeout: 7000 });
    const deployResponseWait = waitForApi(activePage, '/api/new', 'POST', body => body?.mode === 'probability');
    await deployButton.click();
    const deployResponse = await deployResponseWait;
    const deployBody = deployResponse.request().postDataJSON();
    assert.equal(deployBody.difficulty, 'normal', 'the selected difficulty must be submitted for this new run');
    assert.equal(Object.hasOwn(deployBody, 'target'), false, 'new run requests must omit the removed target field');
    assert.equal(Object.hasOwn(deployBody, 'strategy'), false, 'new run requests must omit the removed strategy field');
    const deployed = await deployResponse.json();
    await activePage.waitForFunction(() => !document.body.classList.contains('is-pending'), null, { timeout: 7000 });
    assert.equal(deployed.ok, true, `probability deployment ${attempt + 1} failed: ${deployed.reason || 'no reason returned'}`);
    assert.equal(deployed.phase, 'raid');
    assert.equal(deployed.view.clock, undefined, 'probability mode must not acquire a realtime clock');
    if (attempt === 0) await activePage.setViewportSize({ width: 390, height: 844 });
    assert.equal(deployed.view.difficulty.id, 'normal');
    assert.equal(await activePage.locator('#prob-target').count(), 0, 'raid UI should not show a target-only probability');
    await assertNoForecasts(activePage, deployed);
    await assertBagVisible(activePage, deployed);
    await assertFirstScreenIsConcise(activePage, 'raid');
    await assertFieldJourney(activePage, deployed, 'fresh-expedition');
    if (attempt === 0) {
      await assertSingleSearch(activePage, deployed);
      await activePage.evaluate(() => window.scrollTo(0, 0));
      await activePage.screenshot({ path: path.join(ARTIFACTS, 'ui-v2-raid-mobile.png') });
      await activePage.screenshot({ path: FIELD_MOBILE_SHOT });
      await activePage.setViewportSize({ width: 1440, height: 900 });
      await assertFirstScreenIsConcise(activePage, 'raid');
      await activePage.screenshot({ path: path.join(ARTIFACTS, 'ui-v2-raid-desktop.png') });
      await assertFieldJourney(activePage, deployed, 'fresh-expedition-desktop');
      await activePage.screenshot({ path: FIELD_DESKTOP_SHOT });
      await activePage.setViewportSize({ width: 320, height: 844 });
      await assertFieldJourney(activePage, deployed, 'fresh-expedition-320');
      await activePage.screenshot({ path: path.join(ARTIFACTS, 'ui-v5-expedition-320.png') });
      await activePage.setViewportSize({ width: 390, height: 844 });
    }
    await assertNoForecasts(activePage, deployed);

    const expedition = await runSearchField(activePage, deployed);
    state = expedition.state;
    sawEvent ||= expedition.sawEvent;
    sawOverflowDecision ||= expedition.sawOverflowDecision;
    if (!sawOverflowDecision && state.phase === 'result' && attempt < 3) {
      const returnButton = activePage.locator('#result-return');
      await returnButton.waitFor({ state: 'visible', timeout: 7000 });
      const returnWait = waitForApi(activePage, '/api/hub/return', 'POST');
      await returnButton.click();
      await returnWait;
      await activePage.waitForFunction(() => !document.body.classList.contains('is-pending'), null, { timeout: 7000 });
      state = await readState(activePage);
      assert.equal(state.phase, 'hub');
    }
  }
  assert.ok(['result', 'hub'].includes(state.phase), 'the visible extraction flow should reach a terminal result');
  finalState = state;
  await activePage.locator(state.phase === 'result' ? '#result-screen' : '#hub-screen')
    .waitFor({ state: 'visible', timeout: 7000 });
  if (state.phase === 'result') {
    await inspectResultItemCells(activePage);
    await assertNoNumericProbabilities(activePage);
  }
  assert.ok(sawEvent, 'the browser path should expose and resolve at least one proposal event');

  if (state.phase === 'result') {
    const returnButton = activePage.locator('#result-return');
    await returnButton.waitFor({ state: 'visible', timeout: 7000 });
      const returnWait = waitForApi(activePage, '/api/hub/return', 'POST');
      await returnButton.click();
      await returnWait;
      await activePage.waitForFunction(() => !document.body.classList.contains('is-pending'), null, { timeout: 7000 });
  }
  state = await readState(activePage);
  assert.equal(state.phase, 'hub');
  assert.ok(state.hub.lastReport, 'settlement should be visible after returning to the workshop');
  await activePage.setViewportSize({ width: 1440, height: 900 });

  state = await completeResearchThroughUi(activePage);
  assert.ok(state.hub.research.papers.length >= 1);
  assert.ok(state.hub.research.stage >= 1, 'a real accepted paper should promote the researcher to the master stage');

  await runLoadedBagEventScenario(browser, game.base, saveDir, pageErrors, externalRequests, responses);
  await runSingleSearchCommitScenario(browser, game.base, saveDir, pageErrors, externalRequests, responses);
  await runFullBagEventUiScenario(browser, game.base, saveDir, pageErrors, externalRequests, responses);
  await runUncertainMutationScenario(browser, game.base, pageErrors, externalRequests, responses);
  await runEquipmentPickerScenario(browser, game.base, pageErrors, externalRequests, responses);
  await runFullWarehouseGearScenario(browser, game.base, saveDir, pageErrors, externalRequests, responses);

  await activePage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await activePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    'the promoted mobile workshop must not overflow horizontally');
  await activePage.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await activePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    'the promoted desktop workshop must not overflow horizontally');
  await verifyPngAssets(activePage);

  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join('; ')}`);
  assert.deepEqual(externalRequests, [], 'browser resources must remain on the isolated local server');
  assert.deepEqual(imageFailures(responses), [], 'existing PNG image assets should load successfully');
  assert.equal(model.calls.length, 0, 'the probability UI and research loop must not call the AI provider');
  await fs.writeFile(path.join(ARTIFACTS, 'ui-v2-metrics.json'), JSON.stringify(firstScreenMetrics, null, 2) + '\n');
  await fs.writeFile(path.join(ARTIFACTS, 'ui-v3-journey-metrics.json'), JSON.stringify(journeyMetrics, null, 2) + '\n');
  console.log('First-screen text: ' + JSON.stringify(firstScreenMetrics));
  console.log('Probability browser passed: single search, dominant live backpack, hidden probabilities, neutral event choices, concise receipts, accurate resource meters, eight research journey states, reload preservation, progressive disclosure, warehouse capacity/ownership, equipment swaps, uncertain-mutation replay, manual raids and events, paper review/acceptance/promotion, 320px/desktop/mobile, and local asset loading.');
  console.log(`Screenshots: ${path.relative(ROOT, DESKTOP_SHOT)}, ${path.relative(ROOT, MOBILE_SHOT)}, ${path.relative(ROOT, DIFFICULTY_DESKTOP_SHOT)}, ${path.relative(ROOT, DIFFICULTY_MOBILE_SHOT)}, ${path.relative(ROOT, WAREHOUSE_DESKTOP_SHOT)}, ${path.relative(ROOT, WAREHOUSE_MOBILE_SHOT)}, ${path.relative(ROOT, EVENT_DESKTOP_SHOT)}, ${path.relative(ROOT, EVENT_MOBILE_SHOT)}`);
  console.log(`Intuitive-interface screenshots: ${[RESEARCH_DESKTOP_SHOT, RESEARCH_MOBILE_SHOT, FIELD_DESKTOP_SHOT, FIELD_MOBILE_SHOT, FIELD_EVENT_DESKTOP_SHOT, FIELD_EVENT_MOBILE_SHOT].map(file => path.relative(ROOT, file)).join(', ')}`);
} catch (error) {
  console.error(`[probability-browser] ${error.stack || error.message}`);
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: path.join(ARTIFACTS, 'probability-browser-failure.png'), fullPage: true }).catch(() => {});
  }
  if (game?.output?.length) console.error(`[probability-browser] server output: ${game.output.join('').slice(-6000)}`);
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await stopChild(game?.child).catch(() => {});
  model?.server.closeAllConnections?.();
  if (model?.server.listening) await new Promise(resolve => model.server.close(resolve));
  if (saveDir) {
    const artifactRoot = await fs.realpath(ARTIFACTS);
    const actual = await fs.realpath(saveDir).catch(() => null);
    if (actual && path.dirname(actual) === artifactRoot) await fs.rm(actual, { recursive: true, force: true });
  }
}
