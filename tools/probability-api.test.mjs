import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createCareer, careerView } from '../src/career.js';
import { actProbabilityRaid, createProbabilityRaid } from '../src/probability-raid.js';
import { ITEMS } from '../src/content.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, '.artifacts');

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

function mockCompletion(content) {
  return JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] });
}

async function startLocalModel() {
  const calls = [];
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    let body = {};
    try { body = JSON.parse(text); } catch { /* return a safe generic completion below */ }
    calls.push({ path: req.url, model: body.model });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(mockCompletion({ ok: true }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, calls, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

async function startGameServer({ port, saveDir, modelUrl, ai = true }) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      GAME_SAVE_DIR: saveDir,
      LLM_BASE_URL: ai ? modelUrl : '',
      LLM_API_KEY: ai ? 'probability-test-local-only' : '',
      LLM_MODEL: ai ? 'probability-local-mock' : '',
      LLM_JSON_MODE: 'true',
    },
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`isolated game server exited early: ${output.join('').slice(-4000)}`);
    }
    try {
      const response = await fetch(`${base}/api/meta`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return { child, base, output };
    } catch { /* wait for startup */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error(`isolated game server did not start: ${output.join('').slice(-4000)}`);
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

async function call(base, sid, route, method = 'GET', body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      Cookie: `sid=${sid}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* retain status and raw body for legacy guards */ }
  return { status: response.status, payload, text };
}

function requestId(label) {
  return `prob_${label}_${randomUUID()}`;
}

function freshProbabilityFixture(seed) {
  const career = createCareer(seed);
  const run = createProbabilityRaid({
    seed,
    raidId: `fixture-${seed}-${randomUUID()}`,
    probabilityVersion: 3,
    venue: 'conference',
    difficulty: 'normal',
    player: career.profile.identity,
    loadout: Object.values(career.profile.loadout).filter(Boolean),
    network: career.profile.network,
    contacts: career.profile.contacts,
  });
  run.probabilityVersion = 3;
  run.settled = false;
  run.campaign = true;
  career.run = run;
  return career;
}

async function seedCareer(saveDir, sid, career) {
  await fs.writeFile(path.join(saveDir, `${sid}.json`), JSON.stringify(career), 'utf8');
}

function fixtureAfterThreeDrySearches() {
  for (let seed = 1; seed <= 5000; seed += 1) {
    const career = freshProbabilityFixture(seed);
    const run = career.run;
    run.encounterPacing = { eligibleSearches: 0, dryStreak: 0, firstEventSeen: true };
    run.eventCount = 1;
    run.usedEventIds = ['fixture-prior-event'];
    run.stats.risk = 0;
    let completed = true;
    for (let index = 0; index < 3; index += 1) {
      const search = actProbabilityRaid(run, 'search');
      if (!search.ok || run.status !== 'playing' || run.event || run.encounterPacing.dryStreak !== index + 1) {
        completed = false;
        break;
      }
      if (run.pendingLoot.length) {
        const skipped = actProbabilityRaid(run, 'take:skip');
        if (!skipped.ok) { completed = false; break; }
      }
      while (run.bag.length) {
        const dropped = actProbabilityRaid(run, 'drop:0');
        if (!dropped.ok) { completed = false; break; }
      }
      if (!completed) break;
    }
    if (completed && run.status === 'playing' && run.encounterPacing.dryStreak === 3 && !run.event) return career;
  }
  throw new Error('could not construct a deterministic current three-dry-search fixture');
}

function assertJsonOk(result, message) {
  assert.ok(result.payload && typeof result.payload === 'object', `${message}: expected JSON (HTTP ${result.status})`);
  assert.equal(result.payload.ok, true, `${message}: ${result.payload.reason || result.text}`);
  return result.payload;
}

function assertJsonRejected(result, message) {
  assert.ok(result.payload && typeof result.payload === 'object', `${message}: expected a JSON rejection (HTTP ${result.status})`);
  assert.notEqual(result.payload.ok, true, `${message}: request unexpectedly succeeded`);
}

function assertPercentValues(value, label = 'probabilities', seen = new Set()) {
  if (value == null || typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      assert.ok(item >= 0 && item <= 100, `${label}.${key} must use a 0–100 percentage: ${item}`);
      count += 1;
    } else if (item && typeof item === 'object') count += assertPercentValues(item, `${label}.${key}`, seen);
  }
  return count;
}

function assertHub(payload) {
  assert.equal(payload.phase, 'hub');
  assert.ok(payload.hub && typeof payload.hub === 'object');
}

function assertWarehouseLedger(hub) {
  const rows = hub.items || [];
  const storedTotal = rows.reduce((sum, item) => {
    assert.equal(item.count, item.ownedCount, `${item.id} compatibility count should mean total owned`);
    assert.ok(Number.isInteger(item.ownedCount) && item.ownedCount >= 0);
    assert.ok(Number.isInteger(item.storedCount) && item.storedCount >= 0);
    assert.ok(Number.isInteger(item.equippedCount) && item.equippedCount >= 0 && item.equippedCount <= 1);
    assert.equal(item.storedCount + item.equippedCount, item.ownedCount,
      `${item.id} owned quantity should partition into stored and equipped copies`);
    const slot = Object.entries(hub.loadout || {}).find(([, id]) => id === item.id)?.[0];
    assert.equal(item.equippedCount, slot ? 1 : 0, `${item.id} should count as worn only while its slot references it`);
    return sum + item.storedCount;
  }, 0);
  assert.equal(hub.stashUsed, storedTotal, 'warehouse occupancy should count stored spare copies only');
  assert.equal(hub.stashCap, hub.storageUpgrade.currentCap, 'the visible warehouse cap should match its upgrade level');
  assert.ok(hub.stashUsed <= hub.stashCap);
  const storedRows = hub.stash || [];
  assert.ok(storedRows.every(item => item.count > 0 && item.count === item.storedCount),
    'the warehouse listing should include only stored copies with their physical stored count');
  for (const item of rows) {
    const stored = storedRows.find(row => row.id === item.id);
    assert.equal(Number(stored?.count || 0), item.storedCount, `${item.id} should appear in the warehouse only for spare copies`);
  }
  assert.equal(storedRows.reduce((sum, item) => sum + item.count, 0), hub.stashUsed);
}

function assertRaid(payload) {
  assert.equal(payload.phase, 'raid');
  assert.ok(payload.view && typeof payload.view === 'object');
  assert.equal(typeof payload.view.raidId, 'string');
  assert.ok(Number.isInteger(payload.view.revision));
  assert.equal(payload.view.clock, undefined, 'probability-mode runs must not acquire a real-time raid clock');
  assert.equal(payload.view.probabilityVersion, 3, 'new probability runs should use the difficulty-based material pool');
  assert.ok(payload.view.difficulty && ['easy', 'normal', 'hard'].includes(payload.view.difficulty.id));
  for (const field of ['acquisitionModifier', 'riskModifier', 'eventModifier', 'extraDropModifier']) {
    assert.ok(Number.isFinite(payload.view.difficulty[field]), `difficulty.${field} should be numeric`);
  }
  assert.equal(payload.view.target, undefined, 'new runs should not pin one material as the target');
  assert.equal(payload.view.strategy, undefined, 'new runs should not expose a separate strategy setting');
  assert.ok(Number.isFinite(payload.view.probabilities.acquisition));
  assert.ok(Array.isArray(payload.view.probabilities.materials) && payload.view.probabilities.materials.length >= 4);
  for (const item of payload.view.probabilities.materials) {
    assert.ok(typeof item.id === 'string' && item.id);
    assert.ok(Number.isFinite(item.weight) && item.weight >= 0);
    assert.ok(Number.isFinite(item.weightBonus));
    assert.ok(item.conditionalProbability >= 0 && item.conditionalProbability <= 100);
    assert.ok(item.hitProbability >= 0 && item.hitProbability <= 100);
  }
  const pacing = payload.view.encounterPacing;
  assert.ok(pacing && typeof pacing === 'object', 'the view should expose encounter pacing');
  assert.equal(pacing.eventsLimit, 4);
  for (const field of ['eventsUsed', 'eligibleSearches', 'noEventStreak']) assert.ok(Number.isInteger(pacing[field]), `${field} should be an integer`);
  assert.ok(pacing.searchesUntilGuaranteed === null || Number.isInteger(pacing.searchesUntilGuaranteed));
  assert.equal(typeof pacing.cooldown, 'boolean');
  assert.equal(typeof pacing.reason, 'string');
}

function sameCommittedView(view) {
  return {
    raidId: view.raidId,
    revision: view.revision,
    risk: view.stats?.risk,
    will: view.stats?.will,
    bag: (view.bag || []).map(item => item.id),
    pendingLoot: view.pendingLoot || [],
    eventId: view.event?.id || null,
    probabilityVersion: view.probabilityVersion,
    difficulty: view.difficulty,
    encounterPacing: view.encounterPacing,
    lastAction: view.lastAction,
    probabilities: view.probabilities,
    log: view.log || [],
  };
}

async function fieldAction(base, sid, view, action, label = action) {
  return call(base, sid, '/api/expedition/action', 'POST', {
    action, raidId: view.raidId, revision: view.revision, requestId: requestId(label),
  });
}

function isTerminalEventAction(action) {
  return Boolean(action?.endsRaid || action?.endsRun || action?.terminal || action?.settles)
    || /(?:leave|withdraw|extract|retreat|exit|end)/i.test(`${action?.id || ''} ${action?.kind || ''}`);
}

function chooseEventAction(actions = []) {
  const available = actions.filter(action => action && !action.disabled);
  const continuing = available.filter(action => !isTerminalEventAction(action));
  const choices = continuing.length ? continuing : available;
  return choices.sort((a, b) => Number(b.successProbability ?? b.probability ?? b.chance ?? 0)
    - Number(a.successProbability ?? a.probability ?? a.chance ?? 0))[0] || null;
}

function getSearchAction(view) {
  return view.actions?.find(action => action.id === 'search');
}

async function clearPendingLootAndEvent(base, sid, payload, label = 'resolve') {
  let current = payload;
  for (let guard = 0; guard < 12 && current.phase === 'raid'; guard += 1) {
    if (current.view.event?.id) {
      const choice = chooseEventAction(current.view.event.actions);
      assert.ok(choice?.id, 'the active event should expose at least one available server action');
      current = assertJsonOk(await fieldAction(base, sid, current.view, choice.id, `${label}-event-${guard}`),
        'a displayed event response should resolve the current event');
      continue;
    }
    if (current.view.pendingLoot?.length) {
      current = assertJsonOk(await fieldAction(base, sid, current.view, 'take:available', `${label}-take-${guard}`),
        'taking what fits should clear pending loot');
      continue;
    }
    return current;
  }
  return current;
}

async function verifiedSaveDirectory(dir) {
  const artifactRoot = await fs.realpath(ARTIFACTS);
  const actual = await fs.realpath(dir);
  assert.equal(path.dirname(actual), artifactRoot, 'test save directory must be an isolated direct child of .artifacts');
  return actual;
}

test('probability API validates deployments and commits replay-safe rule actions', { timeout: 90_000 }, async t => {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  const saveDir = await fs.mkdtemp(path.join(ARTIFACTS, 'probability-api-'));
  const model = await startLocalModel();
  const port = await freePort();
  let game;
  const mainSid = randomBytes(12).toString('hex');
  const activeReturnSid = randomBytes(12).toString('hex');

  try {
    game = await startGameServer({ port, saveDir, modelUrl: model.baseUrl });

    await t.test('a fresh session is a hub and locked venues do not spend funds', async () => {
      const initial = await call(game.base, mainSid, '/api/state');
      assert.equal(initial.status, 200);
      assertHub(initial.payload);
      assertWarehouseLedger(initial.payload.hub);
      const totalOwned = initial.payload.hub.items.reduce((sum, item) => sum + item.ownedCount, 0);
      const wornCount = initial.payload.hub.items.reduce((sum, item) => sum + item.equippedCount, 0);
      assert.ok(totalOwned > initial.payload.hub.stashUsed, 'equipped starter items should remain owned without occupying warehouse cells');
      assert.ok(wornCount > 0);
      const startingFunding = initial.payload.hub.funding;
      assert.ok(Number.isFinite(startingFunding));
      const conference = initial.payload.hub.probabilitySetup.venues.find(venue => venue.id === 'conference');
      assert.ok(conference, 'the free starting venue should be visible');
      assert.equal(conference.cost, 0);

      const badId = await call(game.base, mainSid, '/api/new', 'POST', {
        mode: 'probability', venue: 'conference', difficulty: 'normal', requestId: 'short',
      });
      assertJsonRejected(badId, 'requestId shorter than the contract minimum');
      assertHub((await call(game.base, mainSid, '/api/state')).payload);

      const locked = await call(game.base, mainSid, '/api/new', 'POST', {
        mode: 'probability', venue: 'visit', difficulty: 'normal', requestId: requestId('locked-visit'),
      });
      assertJsonRejected(locked, 'a new player must not deploy to a locked venue');
      assertHub(locked.payload);
      assert.equal(locked.payload.hub.funding, startingFunding, 'a rejected deployment cannot charge its entry fee');
      const lockedIndustry = await call(game.base, mainSid, '/api/new', 'POST', {
        mode: 'probability', venue: 'industry', difficulty: 'normal', requestId: requestId('locked-industry'),
      });
      assertJsonRejected(lockedIndustry, 'a new player must not deploy to the industry venue');
      assert.equal(lockedIndustry.payload.hub.funding, startingFunding);

      const obsoleteFields = await call(game.base, mainSid, '/api/new', 'POST', {
        mode: 'probability', venue: 'conference', difficulty: 'normal', target: 'dataset', strategy: 'balanced',
        requestId: requestId('obsolete-target-strategy'),
      });
      assertJsonRejected(obsoleteFields, 'new deployments should reject the removed target and strategy fields');
      assert.match(obsoleteFields.payload.reason || '', /刷新|refresh/i, 'the rejection should direct outdated callers to refresh');
      assertHub((await call(game.base, mainSid, '/api/state')).payload);

      const defaultDifficultySid = randomBytes(12).toString('hex');
      const defaultDifficulty = assertJsonOk(await call(game.base, defaultDifficultySid, '/api/new', 'POST', {
        mode: 'probability', venue: 'conference', requestId: requestId('default-difficulty'),
      }), 'deployment without an explicit difficulty');
      assertRaid(defaultDifficulty);
      assert.equal(defaultDifficulty.view.difficulty.id, 'normal', 'omitting difficulty should use the normal default');
    });

    await t.test('easy, normal, and hard alter the real search preview and material pool', async () => {
      const deployments = {};
      for (const difficulty of ['easy', 'normal', 'hard']) {
        const sid = randomBytes(12).toString('hex');
        const payload = assertJsonOk(await call(game.base, sid, '/api/new', 'POST', {
          mode: 'probability', venue: 'conference', difficulty, requestId: requestId(`difficulty-${difficulty}`),
        }), `${difficulty} difficulty deployment`);
        assertRaid(payload);
        assert.equal(payload.view.difficulty.id, difficulty);
        assert.equal(payload.view.target, undefined);
        assert.equal(payload.view.strategy, undefined);
        const materials = payload.view.probabilities.materials;
        assert.deepEqual(materials.map(item => item.id).sort(), ['compute', 'dataset', 'src_code', 'wind']);
        assert.ok(materials.every(item => item.weight > 0 && item.conditionalProbability > 0),
          'each ordinary material should remain discoverable in the natural pool');
        assert.ok(Math.abs(materials.reduce((sum, item) => sum + item.conditionalProbability, 0) - 100) <= 0.2,
          'conditional material weights should describe the full natural pool');
        const search = getSearchAction(payload.view);
        assert.equal(search.searchPreview.acquisition, payload.view.probabilities.acquisition,
          'the acquisition card and executable search should use the same probability');
        assert.equal(search.searchPreview.riskDelta,
          payload.view.probabilities.parts.acquisition.riskAfterSearch - payload.view.stats.risk,
          'the risk preview should match the actual risk-after-search calculation');
        assert.equal(typeof payload.view.probabilities.encounter, 'number');
        const serverPreview = payload.hub.probabilitySetup.venues.find(row => row.id === 'conference')
          .difficultyPreviews.find(row => row.difficultyId === difficulty);
        assert.equal(payload.view.probabilities.acquisition, serverPreview.acquisition);
        assert.equal(payload.view.probabilities.encounter, serverPreview.encounter);
        assert.equal(payload.view.probabilities.extraDrop, serverPreview.extraDrop);
        assert.equal(payload.view.probabilities.full, serverPreview.full);
        assert.equal(payload.view.probabilities.partial, serverPreview.partial);
        assert.equal(payload.view.probabilities.fail, serverPreview.fail);
        assert.equal(search.searchPreview.riskDelta, serverPreview.searchGrowth);
        assert.deepEqual(payload.view.probabilities.materials.map(row => [row.id, row.hitProbability]),
          serverPreview.materials.map(row => [row.id, row.hitProbability]));
        deployments[difficulty] = { sid, payload, search };
      }

      const { easy, normal, hard } = deployments;
      assert.equal(easy.payload.view.difficulty.acquisitionModifier, -5);
      assert.equal(easy.payload.view.difficulty.riskModifier, -3);
      assert.equal(easy.payload.view.difficulty.eventModifier, 10);
      assert.equal(easy.payload.view.difficulty.extraDropModifier, 0);
      assert.equal(normal.payload.view.difficulty.acquisitionModifier, 0);
      assert.equal(normal.payload.view.difficulty.extraDropModifier, 0);
      assert.equal(hard.payload.view.difficulty.acquisitionModifier, 8);
      assert.equal(hard.payload.view.difficulty.riskModifier, 4);
      assert.equal(hard.payload.view.difficulty.eventModifier, -10);
      assert.equal(hard.payload.view.difficulty.extraDropModifier, 15);
      assert.equal(easy.payload.view.probabilities.acquisition, normal.payload.view.probabilities.acquisition - 5);
      assert.equal(hard.payload.view.probabilities.acquisition, normal.payload.view.probabilities.acquisition + 8);
      assert.equal(easy.search.searchPreview.riskDelta, normal.search.searchPreview.riskDelta - 3);
      assert.equal(hard.search.searchPreview.riskDelta, normal.search.searchPreview.riskDelta + 4);

      const expectedEventCheck = { easy: 60, normal: 50, hard: 40 };
      for (const difficulty of ['easy', 'normal', 'hard']) {
        const sid = randomBytes(12).toString('hex');
        const career = freshProbabilityFixture(71000 + ['easy', 'normal', 'hard'].indexOf(difficulty));
        career.run.difficultyId = difficulty;
        career.run.eventCount = 1;
        career.run.usedEventIds = [`qa-${difficulty}-event-check`];
        career.run.event = {
          id: `qa-${difficulty}-event-check`, name: '评测审核员', title: '复现步骤核对', text: '请说明可复现步骤。',
          type: 'technical', tone: 'danger', difficulty: 0,
          choices: [{ key: 'explain', name: '说明复现流程', cost: {},
            check: { base: 50, riskFactor: 0 },
            onSuccess: { riskDelta: -1, text: '复现步骤清楚。' },
            onFailure: { riskDelta: 2, text: '还需要补充证据。' } }],
        };
        await seedCareer(saveDir, sid, career);
        const eventState = (await call(game.base, sid, '/api/state')).payload;
        assertRaid(eventState);
        assert.equal(eventState.view.difficulty.id, difficulty);
        assert.equal(eventState.view.event.actions.find(action => action.id === 'event:explain')?.probability,
          expectedEventCheck[difficulty], 'event difficulty should modify a real response check, not event spawn odds');
      }

      for (const difficulty of ['easy', 'normal', 'hard']) {
        const before = deployments[difficulty];
        const searched = assertJsonOk(await fieldAction(game.base, before.sid, before.payload.view, 'search', `difficulty-search-${difficulty}`),
          `${difficulty} search`);
        assert.equal(searched.view.difficulty.id, difficulty);
        assert.equal(searched.view.lastAction.riskDelta, before.search.searchPreview.riskDelta,
          'the search should apply the growth displayed by its chosen difficulty');
        assert.equal(typeof searched.actionResult.found, 'boolean');
        assert.ok(searched.view.lastAction.itemsAdded.every(item => before.payload.view.probabilities.materials.some(row => row.id === item.id)),
          'search results should come from the unpinned natural material pool');
      }
    });

    let deployed;
    let firstSearch;
    let firstSearchBody;
    await t.test('a current probability run exposes finite odds and persists reads without mutation', async () => {
      const start = await call(game.base, mainSid, '/api/new', 'POST', {
        mode: 'probability', venue: 'conference', difficulty: 'normal', requestId: requestId('deploy'),
      });
      deployed = assertJsonOk(start, 'conference deployment');
      assertRaid(deployed);
      assert.ok(deployed.view.probabilities && typeof deployed.view.probabilities === 'object', 'the run should expose its rule preview');
      const displayProbabilities = deployed.view.probabilities;
      assert.ok(assertPercentValues({
        acquisition: displayProbabilities.acquisition,
        encounter: displayProbabilities.encounter,
        full: displayProbabilities.full,
        partial: displayProbabilities.partial,
        fail: displayProbabilities.fail,
        materials: displayProbabilities.materials.map(({ conditionalProbability, hitProbability }) => ({ conditionalProbability, hitProbability })),
      }) > 0, 'all probability and per-material preview values should use 0–100 percentages');
      assert.equal(deployed.view.encounterPacing.eventsUsed, 0);
      assert.equal(deployed.view.encounterPacing.searchesUntilGuaranteed, 2,
        'a fresh run should show the two-search guarantee window');
      assert.equal(deployed.view.difficulty.id, 'normal');
      assert.equal(deployed.view.probabilities.acquisition,
        getSearchAction(deployed.view).searchPreview.acquisition,
      'the visible initial acquisition chance should match the actual search action preview');

      const beforeReads = {
        raidId: deployed.view.raidId,
        revision: deployed.view.revision,
        risk: deployed.view.stats.risk,
        will: deployed.view.stats.will,
        encounterPacing: deployed.view.encounterPacing,
        lastAction: deployed.view.lastAction,
        probabilities: deployed.view.probabilities,
      };
      for (let i = 0; i < 3; i += 1) {
        const read = await call(game.base, mainSid, '/api/state');
        assertRaid(read.payload);
        assert.deepEqual({
          raidId: read.payload.view.raidId,
          revision: read.payload.view.revision,
          risk: read.payload.view.stats.risk,
          will: read.payload.view.stats.will,
          encounterPacing: read.payload.view.encounterPacing,
          lastAction: read.payload.view.lastAction,
          probabilities: read.payload.view.probabilities,
        }, beforeReads, 'GET /api/state and page reload reads must not advance a probability simulation');
      }

      firstSearchBody = {
        action: 'search', raidId: deployed.view.raidId, revision: deployed.view.revision, requestId: requestId('search-first'),
      };
      firstSearch = assertJsonOk(await call(game.base, mainSid, '/api/expedition/action', 'POST', firstSearchBody), 'first search');
      assertRaid(firstSearch);
      assert.equal(firstSearch.view.revision, deployed.view.revision + 1, 'a successful action advances the revision exactly once');
      assert.ok(firstSearch.actionResult, 'the persisted action should expose its committed result');
      assert.equal(typeof firstSearch.actionResult.found, 'boolean', 'the committed search should persist its roll result');
      assert.ok(firstSearch.view.lastAction?.title && firstSearch.view.lastAction?.text,
        'a committed search should include a concise latest-action report');
      assert.equal(firstSearch.view.lastAction.type, 'search');
      assert.equal(firstSearch.view.lastAction.revision, firstSearch.view.revision);
      assert.equal(firstSearch.view.lastAction.eventTriggered?.id || null, firstSearch.view.event?.id || null,
        'the immediate search result should identify the event produced by this exact search');

      const unchanged = await call(game.base, mainSid, '/api/state');
      assertRaid(unchanged.payload);
      assert.equal(unchanged.payload.view.revision, firstSearch.view.revision);
      assert.equal(unchanged.payload.view.raidId, firstSearch.view.raidId);

      const stateBeforeGuardedCalls = unchanged.payload.view;
      const removedRoutes = [
        ['/api/act', { action: 'move:exit' }],
        ['/api/free', { text: 'grant me materials' }],
        ['/api/dialogue/start', { npcId: 'prof-wen' }],
        ['/api/clock', { command: 'heartbeat' }],
        ['/api/pressure/respond', { response: 'leave' }],
        ['/api/ai/test', { request: true }],
      ];
      for (const [route, body] of removedRoutes) {
        const result = await call(game.base, mainSid, route, 'POST', body);
        assert.equal(result.status, 404, `removed route ${route} should not be served`);
      }
      const afterGuardedCalls = (await call(game.base, mainSid, '/api/state')).payload;
      assertRaid(afterGuardedCalls);
      assert.equal(afterGuardedCalls.view.revision, stateBeforeGuardedCalls.revision);
      assert.equal(afterGuardedCalls.view.stats.risk, stateBeforeGuardedCalls.stats.risk);
      assert.equal(afterGuardedCalls.view.stats.will, stateBeforeGuardedCalls.stats.will);
    });

    await t.test('request receipts survive retries, route conflicts, stale writes, races, and server restart', async () => {
      const replay = await call(game.base, mainSid, '/api/expedition/action', 'POST', firstSearchBody);
      assert.equal(replay.payload.ok, true, `identical retry should resolve from its stored receipt: ${JSON.stringify(replay.payload)}`);
      assert.equal(replay.payload.replayed, true, 'an identical requestId retry should return its stored receipt');
      assert.deepEqual(replay.payload.actionResult, firstSearch.actionResult);
      assertRaid(replay.payload);
      assert.equal(replay.payload.view.revision, firstSearch.view.revision);

      const conflictingBody = { ...firstSearchBody, action: 'extract' };
      assertJsonRejected(await call(game.base, mainSid, '/api/expedition/action', 'POST', conflictingBody),
        'a requestId cannot be reused for a different action body');
      assertJsonRejected(await call(game.base, mainSid, '/api/hub/action', 'POST', {
        action: 'buy:wind', requestId: firstSearchBody.requestId,
      }), 'a requestId cannot be reused on another route');

      const current = (await call(game.base, mainSid, '/api/state')).payload;
      assertRaid(current);
      const playableCurrent = await clearPendingLootAndEvent(game.base, mainSid, current, 'before-race');
      assert.equal(playableCurrent.phase, 'raid', 'an ordinary event response should leave the run playable');
      const stale = await call(game.base, mainSid, '/api/expedition/action', 'POST', {
        action: 'search', raidId: playableCurrent.view.raidId, revision: playableCurrent.view.revision - 1, requestId: requestId('stale'),
      });
      assertJsonRejected(stale, 'a stale revision must be rejected');
      const wrongRaid = await call(game.base, mainSid, '/api/expedition/action', 'POST', {
        action: 'search', raidId: 'wrong-raid', revision: playableCurrent.view.revision, requestId: requestId('wrong-raid'),
      });
      assertJsonRejected(wrongRaid, 'a mismatched raidId must be rejected');

      const shared = {
        action: 'search', raidId: playableCurrent.view.raidId, revision: playableCurrent.view.revision, requestId: requestId('concurrent-same'),
      };
      const duplicates = await Promise.all([
        call(game.base, mainSid, '/api/expedition/action', 'POST', shared),
        call(game.base, mainSid, '/api/expedition/action', 'POST', shared),
      ]);
      assert.ok(duplicates.every(result => result.payload?.ok === true), 'concurrent duplicate clicks should share one committed result');
      assert.equal(duplicates.filter(result => result.payload.replayed === true).length, 1);
      assert.ok(duplicates.every(result => result.payload.actionResult), 'the replayed body should contain the committed action result');
      const afterDuplicate = (await call(game.base, mainSid, '/api/state')).payload;
      assertRaid(afterDuplicate);
      assert.equal(afterDuplicate.view.revision, playableCurrent.view.revision + 1, 'a simultaneous retry applies one state transition');
      const duplicateFinal = await clearPendingLootAndEvent(game.base, mainSid, afterDuplicate, 'after-duplicate');
      assert.equal(duplicateFinal.phase, 'raid');

      const raceRevision = duplicateFinal.view.revision;
      const raceBase = { raidId: duplicateFinal.view.raidId, revision: raceRevision };
      const raceBodies = [
        { ...raceBase, action: 'search', requestId: requestId('race-a') },
        { ...raceBase, action: 'search', requestId: requestId('race-b') },
      ];
      const raced = await Promise.all(raceBodies.map(body => call(game.base, mainSid, '/api/expedition/action', 'POST', body)));
      assert.equal(raced.filter(result => result.payload?.ok === true).length, 1, 'two different writes at one revision must not both commit');
      assert.equal(raced.filter(result => result.payload?.ok !== true).length, 1);
      const afterRace = (await call(game.base, mainSid, '/api/state')).payload;
      assertRaid(afterRace);
      assert.equal(afterRace.view.revision, raceRevision + 1);

      const successfulRaceIndex = raced.findIndex(result => result.payload?.ok === true);
      const stableReceipt = raced[successfulRaceIndex].payload;
      const stableRequest = raceBodies[successfulRaceIndex];
      const stableState = (await clearPendingLootAndEvent(game.base, mainSid, afterRace, 'after-race')).view;
      await stopChild(game.child);
      game = await startGameServer({ port, saveDir, modelUrl: model.baseUrl });
      const afterRestart = (await call(game.base, mainSid, '/api/state')).payload;
      assertRaid(afterRestart);
      assert.equal(afterRestart.view.raidId, stableState.raidId);
      assert.equal(afterRestart.view.revision, stableState.revision);
      assert.deepEqual(sameCommittedView(afterRestart.view), sameCommittedView(stableState), 'restart must preserve RNG-driven search state and result log');

      const retryAfterRestart = await call(game.base, mainSid, '/api/expedition/action', 'POST', stableRequest);
      assert.equal(retryAfterRestart.payload.ok, true);
      assert.equal(retryAfterRestart.payload.replayed, true);
      assert.deepEqual(retryAfterRestart.payload.actionResult, stableReceipt.actionResult);
      assert.equal(retryAfterRestart.payload.view.revision, stableState.revision, 'restart retry must not reroll or step backward');
    });

    await t.test('return is blocked during an active run and terminal extraction settles only once', async () => {
      const blockedReturn = await call(game.base, activeReturnSid, '/api/state');
      assertHub(blockedReturn.payload);
      const started = assertJsonOk(await call(game.base, activeReturnSid, '/api/new', 'POST', {
        mode: 'probability', venue: 'conference', difficulty: 'normal', requestId: requestId('return-deploy'),
      }), 'second probability deployment');
      assertRaid(started);
      assertJsonRejected(await call(game.base, activeReturnSid, '/api/hub/return', 'POST', { requestId: requestId('early-return') }),
        'hub return is unavailable while a raid is active');

      let current = (await call(game.base, mainSid, '/api/state')).payload;
      assert.equal(current.phase, 'raid');
      if (current.view.event?.id) {
        const choice = chooseEventAction(current.view.event.actions);
        assert.ok(choice?.id, 'the active event should expose an available terminal or continuing action');
        const resolved = assertJsonOk(await fieldAction(game.base, mainSid, current.view, choice.id, 'resolve-before-extraction'),
          'a displayed event action should resolve the event before terminal extraction');
        current = resolved.phase === 'raid' ? resolved : (await call(game.base, mainSid, '/api/state')).payload;
      }
      if (current.phase === 'raid') {
        const extracted = await call(game.base, mainSid, '/api/expedition/action', 'POST', {
          action: 'extract', raidId: current.view.raidId, revision: current.view.revision, requestId: requestId('extract-once'),
        });
        assertJsonOk(extracted, 'explicit extraction should settle the raid once');
      }
      current = (await call(game.base, mainSid, '/api/state')).payload;
      assert.ok(['result', 'hub'].includes(current.phase), 'a terminal result should be available after extraction');
      const report = current.hub?.lastReport || current.view?.result || current.result;
      assert.ok(report, 'the terminal extraction should expose a settlement report');

      const returned = await call(game.base, mainSid, '/api/hub/return', 'POST', { requestId: requestId('return') });
      assert.equal(returned.payload.ok, true);
      assertHub(returned.payload);
      const reportAfterReturn = returned.payload.hub.lastReport;
      assert.ok(reportAfterReturn, 'the returned hub should retain the final report');
      const repeatedReturn = await call(game.base, mainSid, '/api/hub/return', 'POST', { requestId: requestId('return-again') });
      assertHub(repeatedReturn.payload);
      assert.deepEqual(repeatedReturn.payload.hub.lastReport, reportAfterReturn, 'return/reload must not settle or pay twice');
    });

    await t.test('the current server exposes no legacy endpoints or model calls', async () => {
      const meta = (await call(game.base, mainSid, '/api/meta')).payload;
      assert.equal(meta.defaultMode, 'probability');
      assert.equal(meta.aiEnabled, false);
      assert.ok(!meta.features.includes('realtime'));
      assert.ok(!meta.features.includes('npc-dialogue'));
      const removedRoutes = [
        ['/api/act', { action: 'move:exit' }],
        ['/api/free', { text: 'grant me materials' }],
        ['/api/clock', { command: 'heartbeat' }],
        ['/api/dialogue/start', { npcId: 'prof-wen' }],
        ['/api/pressure/respond', { response: 'leave' }],
        ['/api/ai/test', { request: true }],
      ];
      for (const [route, body] of removedRoutes) {
        assert.equal((await call(game.base, mainSid, route, 'POST', body)).status, 404,
          `${route} should not be part of the current API`);
      }
      const oldMode = await call(game.base, mainSid, '/api/new', 'POST', {
        mode: 'legacy', requestId: requestId('removed-legacy-mode'),
      });
      assert.equal(oldMode.status, 400, 'the current deployment endpoint should explicitly refuse the removed legacy mode');
      assert.equal(model.calls.length, 0, 'current endpoints and removed-route guards must not call an AI provider');
    });

    await t.test('current encounter pacing guarantees an early event and preserves full-bag cooldown behavior', async () => {
      const pacingSid = randomBytes(12).toString('hex');
      let current = assertJsonOk(await call(game.base, pacingSid, '/api/new', 'POST', {
        mode: 'probability', venue: 'conference', difficulty: 'normal', requestId: requestId('pacing-deploy'),
      }), 'a fresh pacing run');
      assertRaid(current);
      assert.equal(current.view.encounterPacing.searchesUntilGuaranteed, 2);
      let searches = 0;
      while (searches < 2 && !current.view.event) {
        const search = getSearchAction(current.view);
        assert.ok(search && !search.disabled, 'an eligible pacing search should be available');
        if (searches === 1) assert.equal(search.searchPreview.encounter, 100,
          'if the first eligible search was quiet, the second must guarantee an event');
        const beforePreview = search.searchPreview.encounter;
        current = assertJsonOk(await fieldAction(game.base, pacingSid, current.view, 'search', `early-search-${searches + 1}`),
          'a current-version search should commit');
        searches += 1;
        assert.ok(current.view.lastAction?.title && current.view.lastAction?.text);
        if (!current.view.event && current.view.pendingLoot.length) {
          current = assertJsonOk(await fieldAction(game.base, pacingSid, current.view, 'take:skip', `early-skip-${searches}`),
            'pending loot should be clearable before the next guaranteed search');
        }
        if (!current.view.event && searches === 1) {
          assert.equal(current.view.lastAction.eventTriggered, null);
          assert.equal(current.view.encounterPacing.noEventStreak, 1);
          assert.equal(current.view.encounterPacing.searchesUntilGuaranteed, 1);
        }
      }
      assert.ok(current.view.event, 'at least one event should appear within the first two eligible searches');
      assert.equal(searches <= 2, true);
      assert.ok(['人物交涉', '资源机会', '技术故障', '路线状况'].includes(current.view.event.typeLabel));
      assert.ok(['opportunity', 'danger', 'social'].includes(current.view.event.tone));
      assert.ok(current.view.event.image);
      assert.ok(current.view.event.actions.some(action => action.id.startsWith('event:') && action.endsRaid === false),
        'current events should expose generic event:* continuation actions');
      const exit = current.view.event.actions.find(action => action.endsRaid === true);
      assert.ok(exit?.exitProbabilities && exit.id.startsWith('event:'), 'only explicitly terminal choices should carry their own exit distribution');
      for (const action of current.view.event.actions) {
        assert.equal(typeof action.cost, 'string');
        assert.equal(typeof action.success, 'string');
        assert.equal(typeof action.failure, 'string');
        if (action.endsRaid) {
          assert.equal(action.probability, undefined, 'terminal choices expose exit odds instead of a response-check rate');
          assert.ok(action.exitProbabilities);
        } else {
          assert.ok(Number.isFinite(action.probability) && action.probability >= 0 && action.probability <= 100);
        }
      }

      const afterSearchRead = (await call(game.base, pacingSid, '/api/state')).payload;
      assert.deepEqual(sameCommittedView(afterSearchRead.view), sameCommittedView(current.view),
        'GET after event generation must preserve the event, roll result, and pacing state');
      const choice = chooseEventAction(current.view.event.actions);
      assert.ok(choice && !choice.endsRaid, 'the generic test response should keep the raid active');
      const eventCountBefore = current.view.encounterPacing.eventsUsed;
      current = assertJsonOk(await fieldAction(game.base, pacingSid, current.view, choice.id, 'resolve-early-event'),
        'a server-listed event choice should resolve through the action API');
      assert.equal(current.view.event, null);
      assert.equal(current.view.encounterPacing.cooldown, true, 'resolving an event should arm one-search cooldown');
      assert.equal(current.view.encounterPacing.eventsUsed, eventCountBefore);
      if (current.view.pendingLoot.length) {
        current = assertJsonOk(await fieldAction(game.base, pacingSid, current.view, 'take:skip', 'skip-post-event-loot'),
          'pending loot can be resolved while the one-search cooldown remains armed');
        assert.equal(current.view.encounterPacing.cooldown, true);
      }
      const cooldownSearch = getSearchAction(current.view);
      const eligibleBeforeCooldown = current.view.encounterPacing.eligibleSearches;
      assert.equal(cooldownSearch.searchPreview.encounter, 0);
      current = assertJsonOk(await fieldAction(game.base, pacingSid, current.view, 'search', 'cooldown-search'),
        'the next search should consume the cooldown without triggering another event');
      assert.equal(current.view.lastAction.eventTriggered, null);
      assert.equal(current.view.event, null);
      assert.equal(current.view.encounterPacing.cooldown, false);
      assert.equal(current.view.encounterPacing.eligibleSearches, eligibleBeforeCooldown,
        'the cooldown search should not count toward the eligible-search pity streak');

      const drySid = randomBytes(12).toString('hex');
      const dryCareer = fixtureAfterThreeDrySearches();
      const dryRun = dryCareer.run;
      const windWeight = Number(ITEMS.wind?.weight);
      assert.ok(windWeight > 0, 'the deterministic full-bag fixture needs a weighted item');
      dryRun.rngState = 1;
      dryRun.bag = ['wind'];
      dryRun.bagCap = windWeight;
      dryRun.pendingLoot = [];
      dryRun.event = null;
      dryRun.stats.will = Math.max(4, dryRun.stats.will);
      dryRun.stats.willMax = Math.max(dryRun.stats.willMax, dryRun.stats.will);
      dryRun.encounterCooldown = false;
      await seedCareer(saveDir, drySid, dryCareer);
      const fullBefore = (await call(game.base, drySid, '/api/state')).payload;
      assertRaid(fullBefore);
      assert.equal(fullBefore.view.encounterPacing.noEventStreak, 3);
      assert.equal(fullBefore.view.encounterPacing.searchesUntilGuaranteed, 1);
      assert.ok(fullBefore.view.bagUsed >= fullBefore.view.bagCap);
      assert.equal(getSearchAction(fullBefore.view).searchPreview.encounter, 100);
      const fullSearch = assertJsonOk(await fieldAction(game.base, drySid, fullBefore.view, 'search', 'full-bag-event-search'),
        'a full-bag search should still process its guaranteed event roll');
      assert.ok(fullSearch.view.lastAction.eventTriggered, 'the guaranteed search should report its generated event in the action card');
      assert.ok(fullSearch.view.event, 'the guaranteed event should not be discarded because the bag is full');
      assert.ok(fullSearch.view.pendingLoot.length > 0, 'the full-bag search should retain its new finding as pending loot');
      assert.equal(fullSearch.view.lastAction.eventTriggered?.id, fullSearch.view.event.id);
      const blockedExit = fullSearch.view.event.actions.find(action => action.endsRaid === true);
      assert.equal(blockedExit?.disabled, true, 'terminal event exit must be blocked while pending loot can still change carried load');
      const rejectedExit = await call(game.base, drySid, '/api/expedition/action', 'POST', {
        action: blockedExit.id, raidId: fullSearch.view.raidId, revision: fullSearch.view.revision, requestId: requestId('blocked-pending-exit'),
      });
      assertJsonRejected(rejectedExit, 'event leave should not settle before the pending discovery is resolved');
      const unchangedAfterBlockedExit = (await call(game.base, drySid, '/api/state')).payload;
      assert.deepEqual(sameCommittedView(unchangedAfterBlockedExit.view), sameCommittedView(fullSearch.view),
        'a blocked event exit should preserve the event, pending loot, roll result, and revision');

      const fullChoice = chooseEventAction(fullSearch.view.event.actions);
      assert.ok(fullChoice && !fullChoice.endsRaid);
      const fullResolved = assertJsonOk(await fieldAction(game.base, drySid, fullSearch.view, fullChoice.id, 'resolve-event-with-full-bag'),
        'the event should remain actionable while the bag has pending overflow');
      assert.equal(fullResolved.view.event, null);
      assert.ok(fullResolved.view.pendingLoot.length > 0, 'resolving the event must not erase the pending full-bag find');
      assert.equal(fullResolved.view.encounterPacing.cooldown, true);
      const skippedFull = assertJsonOk(await fieldAction(game.base, drySid, fullResolved.view, 'take:skip', 'skip-full-bag-find'),
        'a player may explicitly decline the pending find');
      const fullCooldown = assertJsonOk(await fieldAction(game.base, drySid, skippedFull.view, 'search', 'full-bag-cooldown'),
        'the full-bag event should still arm its one-search cooldown');
      assert.equal(fullCooldown.view.lastAction.eventTriggered, null);
      assert.equal(fullCooldown.view.encounterPacing.cooldown, false);
    });

    await t.test('a terminal event exit stays blocked until loot is sorted, then settles at its previewed odds', async () => {
      const exitSid = randomBytes(12).toString('hex');
      const career = freshProbabilityFixture(6624);
      const run = career.run;
      const windWeight = Number(ITEMS.wind.weight);
      run.bag = ['wind'];
      run.bagCap = windWeight;
      run.pendingLoot = ['wind'];
      run.stats.risk = 24;
      run.eventCount = 1;
      run.usedEventIds = ['qa-exit-after-loot'];
      run.encounterPacing = { eligibleSearches: 2, dryStreak: 0, firstEventSeen: true };
      run.event = {
        id: 'qa-exit-after-loot', name: '接应人员', title: '路线确认', text: '先确认随身材料再决定是否离场。',
        type: 'route', tone: 'opportunity', image: '/assets/generated/taxi.png', difficulty: 0,
        choices: [{ key: 'confirm-route', name: '确认接应路线', cost: {},
          onSuccess: { riskDelta: -2, support: 4, text: '接应路线已确认。' } }],
      };
      await seedCareer(saveDir, exitSid, career);
      const initial = (await call(game.base, exitSid, '/api/state')).payload;
      assertRaid(initial);
      assert.equal(initial.view.pendingLoot.length, 1);
      const blocked = initial.view.event.actions.find(action => action.endsRaid === true);
      assert.equal(blocked?.disabled, true);
      const rejected = await call(game.base, exitSid, '/api/expedition/action', 'POST', {
        action: blocked.id, raidId: initial.view.raidId, revision: initial.view.revision, requestId: requestId('exit-blocked'),
      });
      assertJsonRejected(rejected, 'the event leave action must stay disabled while loot is pending');
      assert.deepEqual(sameCommittedView((await call(game.base, exitSid, '/api/state')).payload.view), sameCommittedView(initial.view),
        'a rejected early leave must not consume RNG or alter event/pending state');

      const dropped = assertJsonOk(await fieldAction(game.base, exitSid, initial.view, 'drop:0', 'tidy-before-event-exit'),
        'dropping a carried item should free space while keeping the event active');
      assert.ok(dropped.view.event);
      assert.equal(dropped.view.pendingLoot.length, 1);
      const carried = assertJsonOk(await fieldAction(game.base, exitSid, dropped.view, 'take:all', 'take-before-event-exit'),
        'sorting the pending item should restore the event exit choice');
      assert.equal(carried.view.pendingLoot.length, 0);
      assert.ok(carried.view.event);
      const exit = carried.view.event.actions.find(action => action.endsRaid === true);
      assert.ok(exit && !exit.disabled);
      const expectedOdds = exit.exitProbabilities;
      assert.ok(expectedOdds && ['full', 'partial', 'fail'].every(key => Number.isFinite(expectedOdds[key])));

      const settled = assertJsonOk(await fieldAction(game.base, exitSid, carried.view, exit.id, 'event-exit-after-tidy'),
        'the restored event exit should settle the raid');
      assert.equal(settled.phase, 'result');
      assert.equal(settled.actionResult.endsRaid, true);
      assert.equal(settled.view.stats.risk, carried.view.stats.risk + 4);
      assert.deepEqual({ full: settled.view.result.probabilities.full, partial: settled.view.result.probabilities.partial,
        fail: settled.view.result.probabilities.fail }, expectedOdds,
      'the completed exit should use the exact distribution shown after sorting loot');
    });

    await t.test('a resource event consumes its stated item and changes actual exit odds', async () => {
      const resourceSid = randomBytes(12).toString('hex');
      const career = freshProbabilityFixture(47631);
      const run = career.run;
      run.bag = ['wind'];
      run.stats.risk = 35;
      run.stats.will = Math.max(4, run.stats.will);
      run.encounterPacing = { eligibleSearches: 2, dryStreak: 0, firstEventSeen: true };
      run.eventCount = 1;
      run.usedEventIds = ['qa-resource-swap'];
      run.event = {
        id: 'qa-resource-swap', name: '公开样本交换台', title: '方向情报换数据',
        text: '将已收集的方向情报兑换为研究数据。', type: 'resource', tone: 'opportunity',
        image: '/assets/generated/locker.png', difficulty: 0,
        choices: [{
          key: 'trade-wind', name: '交出方向情报换数据', requires: { wind: 1 }, cost: { items: { wind: 1 } },
          onSuccess: { riskDelta: -4, support: 8, rewardId: 'dataset', text: '交换完成，风险下降并获得数据。' },
        }],
      };
      await seedCareer(saveDir, resourceSid, career);
      const before = (await call(game.base, resourceSid, '/api/state')).payload;
      assertRaid(before);
      assert.equal(before.view.event.typeLabel, '资源机会');
      const action = before.view.event.actions.find(choice => choice.id === 'event:trade-wind');
      assert.equal(action?.disabled, false);
      assert.equal(action?.probability, 100);
      assert.equal(action?.endsRaid, false);
      assert.ok(action.cost.includes(ITEMS.wind.name), `the visible exchange cost should use the real catalog item name: ${action.cost}`);
      const request = { action: action.id, raidId: before.view.raidId, revision: before.view.revision, requestId: requestId('resource-event') };
      const after = assertJsonOk(await call(game.base, resourceSid, '/api/expedition/action', 'POST', request), 'exchanging a real bag resource in an event');
      assert.equal(after.actionResult.eventSuccess, true);
      assert.equal(after.actionResult.endsRaid, false);
      assert.equal(after.view.event, null);
      assert.equal(after.view.stats.risk, before.view.stats.risk - 4);
      assert.equal(after.view.lastAction.riskDelta, -4);
      assert.equal(after.view.stats.network, before.view.stats.network);
      assert.ok(!after.view.bag.some(item => item.id === 'wind'), 'the action should consume its required direction-intel item');
      assert.ok(after.view.bag.some(item => item.id === 'dataset') || after.view.pendingLoot.some(item => item.id === 'dataset'),
        'the successful action should add its stated research-material reward');
      assert.equal(after.view.probabilities.parts.extraction.risk, before.view.probabilities.parts.extraction.risk - 4,
        'the event risk change should flow into the actual extraction calculation');
      assert.equal(after.view.probabilities.parts.extraction.support, 8,
        'event support should affect the live partial-extraction calculation');
      assert.ok(after.view.probabilities.full > before.view.probabilities.full,
        'lower risk and support should improve the actual full-return probability');
      const replay = await call(game.base, resourceSid, '/api/expedition/action', 'POST', request);
      assert.equal(replay.payload.replayed, true);
      assert.equal(replay.payload.view.stats.risk, after.view.stats.risk, 'retry should not apply the risk effect twice');
      assert.deepEqual(replay.payload.view.bag.map(item => item.id), after.view.bag.map(item => item.id), 'retry should not consume or award items twice');
    });

    await t.test('warehouse upgrades charge the level price once, persist, and stop at level four', async () => {
      const sid = randomBytes(12).toString('hex');
      const career = createCareer(667733);
      career.profile.funding = 6000;
      await seedCareer(saveDir, sid, career);
      const initial = (await call(game.base, sid, '/api/state')).payload;
      assertHub(initial);
      assertWarehouseLedger(initial.hub);
      assert.deepEqual({ level: initial.hub.storageUpgrade.level, max: initial.hub.storageUpgrade.maxLevel,
        currentCap: initial.hub.storageUpgrade.currentCap, nextCap: initial.hub.storageUpgrade.nextCap,
        cost: initial.hub.storageUpgrade.cost, action: initial.hub.storageUpgrade.action },
      { level: 0, max: 4, currentCap: 40, nextCap: 60, cost: 200, action: 'upgrade:warehouse' });
      assert.equal(initial.hub.storageUpgrade.disabled, false);

      const firstId = requestId('warehouse-first-upgrade');
      const firstBody = { action: 'upgrade:warehouse', requestId: firstId };
      const first = assertJsonOk(await call(game.base, sid, '/api/hub/action', 'POST', firstBody), 'warehouse level one');
      assertHub(first);
      assert.equal(first.hub.funding, initial.hub.funding - 200);
      assert.equal(first.hub.storageUpgrade.level, 1);
      assert.equal(first.hub.storageUpgrade.currentCap, 60);
      assert.equal(first.hub.storageUpgrade.nextCap, 80);
      assert.deepEqual({ level: first.actionResult.level, capacity: first.actionResult.capacity, spent: first.actionResult.spent },
        { level: 1, capacity: 60, spent: 200 });
      assert.equal(first.hub.stashUsed, initial.hub.stashUsed, 'capacity growth should not create or move owned items');
      assertWarehouseLedger(first.hub);

      const retry = await call(game.base, sid, '/api/hub/action', 'POST', firstBody);
      assert.equal(retry.payload.replayed, true, 'an upgrade retry should replay its stored receipt');
      assert.equal(retry.payload.hub.funding, first.hub.funding, 'a repeated upgrade request should charge only once');
      assert.equal(retry.payload.hub.storageUpgrade.currentCap, 60);
      await stopChild(game.child);
      game = await startGameServer({ port, saveDir, modelUrl: model.baseUrl });
      const restored = (await call(game.base, sid, '/api/state')).payload;
      assertHub(restored);
      assertWarehouseLedger(restored.hub);
      assert.equal(restored.hub.storageUpgrade.level, 1, 'warehouse level should persist across a server restart');
      assert.equal(restored.hub.funding, first.hub.funding);
      const restartRetry = await call(game.base, sid, '/api/hub/action', 'POST', firstBody);
      assert.equal(restartRetry.payload.replayed, true);
      assert.equal(restartRetry.payload.hub.funding, first.hub.funding, 'the persisted receipt should prevent a second charge after restart');

      const expectedCosts = [500, 1000, 1800];
      let current = restartRetry.payload;
      for (let index = 0; index < expectedCosts.length; index += 1) {
        const before = current.hub;
        assert.equal(before.storageUpgrade.cost, expectedCosts[index]);
        const upgraded = assertJsonOk(await call(game.base, sid, '/api/hub/action', 'POST', {
          action: 'upgrade:warehouse', requestId: requestId(`warehouse-upgrade-${before.storageUpgrade.level + 1}`),
        }), `warehouse level ${before.storageUpgrade.level + 1}`);
        assertHub(upgraded);
        assert.equal(upgraded.hub.storageUpgrade.level, before.storageUpgrade.level + 1);
        assert.equal(upgraded.hub.storageUpgrade.currentCap, before.storageUpgrade.currentCap + 20);
        assert.equal(upgraded.hub.funding, before.funding - expectedCosts[index]);
        assert.equal(upgraded.hub.stashUsed, before.stashUsed);
        assertWarehouseLedger(upgraded.hub);
        current = upgraded;
      }
      assert.equal(current.hub.storageUpgrade.currentCap, 120);
      assert.equal(current.hub.storageUpgrade.level, 4);
      assert.equal(current.hub.storageUpgrade.disabled, true);
      assert.equal(current.hub.storageUpgrade.nextCap, null);
      const maxed = await call(game.base, sid, '/api/hub/action', 'POST', {
        action: 'upgrade:warehouse', requestId: requestId('warehouse-maxed'),
      });
      assertJsonRejected(maxed, 'a fifth warehouse upgrade should be unavailable');
      assert.equal(maxed.payload.hub.storageUpgrade.currentCap, 120);

      const activeSid = randomBytes(12).toString('hex');
      const active = assertJsonOk(await call(game.base, activeSid, '/api/new', 'POST', {
        mode: 'probability', venue: 'conference', difficulty: 'normal', requestId: requestId('warehouse-active-guard'),
      }), 'new run for upgrade guard');
      assertRaid(active);
      const guardedUpgrade = await call(game.base, activeSid, '/api/hub/action', 'POST', {
        action: 'upgrade:warehouse', requestId: requestId('warehouse-active-raid'),
      });
      assertJsonRejected(guardedUpgrade, 'warehouse upgrades should be unavailable while a raid is active');
      const afterGuard = (await call(game.base, activeSid, '/api/state')).payload;
      assertRaid(afterGuard);
      assert.equal(afterGuard.view.revision, active.view.revision, 'an active-run upgrade request must not advance the raid');
      assert.equal(afterGuard.hub.storageUpgrade.level, 0, 'an active-run upgrade request must not change the profile');
    });

    await t.test('equipped copies do not count as storage, spare gear does, and full-warehouse transactions stay atomic', async () => {
      const duplicateSid = randomBytes(12).toString('hex');
      const duplicate = createCareer(12812);
      const wornBag = duplicate.profile.loadout.bag;
      duplicate.profile.stash[wornBag] = Number(duplicate.profile.stash[wornBag] || 0) + 1;
      await seedCareer(saveDir, duplicateSid, duplicate);
      const before = (await call(game.base, duplicateSid, '/api/state')).payload;
      assertHub(before);
      assertWarehouseLedger(before.hub);
      const bagRows = before.hub.items.find(item => item.id === wornBag);
      assert.equal(bagRows.ownedCount, 2);
      assert.equal(bagRows.equippedCount, 1);
      assert.equal(bagRows.storedCount, 1, 'a duplicate spare of the worn item should occupy one warehouse slot');

      const sold = assertJsonOk(await call(game.base, duplicateSid, '/api/hub/action', 'POST', {
        action: `sell:${wornBag}`, requestId: requestId('sell-spare-worn-gear'),
      }), 'selling one spare copy of currently worn gear');
      assert.equal(sold.hub.loadout.bag, wornBag, 'selling the stored spare must not remove the worn copy');
      const afterSold = sold.hub.items.find(item => item.id === wornBag);
      assert.equal(afterSold.ownedCount, 1);
      assert.equal(afterSold.equippedCount, 1);
      assert.equal(afterSold.storedCount, 0);
      assertWarehouseLedger(sold.hub);
      const rejectedCurrentSale = await call(game.base, duplicateSid, '/api/hub/action', 'POST', {
        action: `sell:${wornBag}`, requestId: requestId('sell-only-worn-gear'),
      });
      assertJsonRejected(rejectedCurrentSale, 'selling the sole equipped copy should be rejected');
      assert.equal(rejectedCurrentSale.payload.hub.loadout.bag, wornBag);

      const emptySid = randomBytes(12).toString('hex');
      const emptySlotCareer = createCareer(12813);
      emptySlotCareer.profile.loadout.storage = null;
      delete emptySlotCareer.profile.stash.portable_ssd;
      emptySlotCareer.profile.funding = 5000;
      const cap = careerView(emptySlotCareer).stashCap;
      const used = careerView(emptySlotCareer).stashUsed;
      emptySlotCareer.profile.stash.wind = Number(emptySlotCareer.profile.stash.wind || 0) + cap - used;
      await seedCareer(saveDir, emptySid, emptySlotCareer);
      const emptyBefore = (await call(game.base, emptySid, '/api/state')).payload;
      assertHub(emptyBefore);
      assertWarehouseLedger(emptyBefore.hub);
      assert.equal(emptyBefore.hub.stashUsed, emptyBefore.hub.stashCap);
      assert.equal(emptyBefore.hub.loadout.storage, null);
      const storageGear = emptyBefore.hub.shop.find(item => item.id === 'portable_ssd');
      assert.ok(storageGear);
      const equippedIntoFull = assertJsonOk(await call(game.base, emptySid, '/api/hub/action', 'POST', {
        action: 'buy-equip:portable_ssd', requestId: requestId('buy-wear-empty-storage-at-cap'),
      }), 'buying directly into an empty slot at warehouse capacity');
      assert.equal(equippedIntoFull.hub.loadout.storage, 'portable_ssd');
      assert.equal(equippedIntoFull.hub.stashUsed, emptyBefore.hub.stashUsed,
        'a gear copy worn immediately into an empty slot should use zero warehouse slots');
      assert.equal(equippedIntoFull.hub.items.find(item => item.id === 'portable_ssd').storedCount, 0);
      assert.equal(equippedIntoFull.hub.items.find(item => item.id === 'portable_ssd').equippedCount, 1);
      assertWarehouseLedger(equippedIntoFull.hub);

      const replacement = equippedIntoFull.hub.shop.find(item => item.slot === 'storage' && item.id !== 'portable_ssd'
        && !equippedIntoFull.hub.items.some(owned => owned.id === item.id && owned.ownedCount > 0)
        && item.price <= equippedIntoFull.hub.funding);
      assert.ok(replacement, 'the full-warehouse fixture should offer an affordable unowned storage replacement');
      const rejectedReplacement = await call(game.base, emptySid, '/api/hub/action', 'POST', {
        action: `buy-equip:${replacement.id}`, requestId: requestId('replace-worn-at-full-warehouse'),
      });
      assertJsonRejected(rejectedReplacement, 'replacing worn gear should reject if its old copy cannot return to the full warehouse');
      assert.equal(rejectedReplacement.payload.hub.loadout.storage, 'portable_ssd');
      assert.equal(rejectedReplacement.payload.hub.stashUsed, emptyBefore.hub.stashUsed);
      assertWarehouseLedger(rejectedReplacement.payload.hub);

      const spareSid = randomBytes(12).toString('hex');
      const spareCareer = createCareer(12814);
      spareCareer.profile.loadout.bag = 'canvas_pack';
      spareCareer.profile.stash.canvas_pack = Number(spareCareer.profile.stash.canvas_pack || 0) + 1;
      spareCareer.profile.stash.badge_wallet = 1;
      spareCareer.profile.funding = 5000;
      const spareCap = careerView(spareCareer).stashCap;
      const spareUsed = careerView(spareCareer).stashUsed;
      spareCareer.profile.stash.wind = Number(spareCareer.profile.stash.wind || 0) + spareCap - spareUsed;
      await seedCareer(saveDir, spareSid, spareCareer);
      const fullOwned = (await call(game.base, spareSid, '/api/state')).payload;
      assertHub(fullOwned);
      assertWarehouseLedger(fullOwned.hub);
      assert.equal(fullOwned.hub.stashUsed, fullOwned.hub.stashCap);
      const canvasStoredBefore = fullOwned.hub.items.find(item => item.id === 'canvas_pack').storedCount;
      const badgeStoredBefore = fullOwned.hub.items.find(item => item.id === 'badge_wallet').storedCount;
      const swapped = assertJsonOk(await call(game.base, spareSid, '/api/hub/action', 'POST', {
        action: 'equip:badge_wallet', requestId: requestId('swap-stored-gear-at-cap'),
      }), 'swapping a stored same-slot item at warehouse capacity');
      assert.equal(swapped.hub.loadout.bag, 'badge_wallet');
      assert.equal(swapped.hub.stashUsed, fullOwned.hub.stashUsed, 'a stored-to-worn replacement should return the old worn copy into the freed slot');
      assert.equal(swapped.hub.items.find(item => item.id === 'canvas_pack').storedCount, canvasStoredBefore + 1);
      assert.equal(swapped.hub.items.find(item => item.id === 'badge_wallet').storedCount, badgeStoredBefore - 1);
      assert.equal(swapped.hub.items.find(item => item.id === 'badge_wallet').equippedCount, 1);
      assertWarehouseLedger(swapped.hub);
    });

    await t.test('buy-equip is atomic, idempotent, and distinguishes owned gear from purchases', async () => {
      const pickerSid = randomBytes(12).toString('hex');
      const before = (await call(game.base, pickerSid, '/api/state')).payload;
      assertHub(before);
      assertWarehouseLedger(before.hub);
      const badgePrice = before.hub.shop.find(item => item.id === 'badge_wallet').price;
      const purchaseId = requestId('buy-equip-badge');
      const purchaseBody = { action: 'buy-equip:badge_wallet', requestId: purchaseId };
      const bought = assertJsonOk(await call(game.base, pickerSid, '/api/hub/action', 'POST', purchaseBody), 'atomic bag purchase and equip');
      assertHub(bought);
      assert.equal(bought.hub.funding, before.hub.funding - badgePrice);
      assert.equal(bought.hub.loadout.bag, 'badge_wallet');
      assert.equal(bought.hub.items.find(item => item.id === 'badge_wallet')?.count, 1);
      assert.equal(bought.hub.stashUsed, before.hub.stashUsed + 1, 'only the displaced old gear should enter the warehouse');
      assert.equal(bought.hub.items.find(item => item.id === 'badge_wallet')?.storedCount, 0);
      assert.equal(bought.hub.items.find(item => item.id === 'badge_wallet')?.equippedCount, 1);
      assert.equal(bought.hub.items.find(item => item.id === 'canvas_pack')?.storedCount, 1,
        'replacing a worn bag should store the old copy without charging it again');
      assertWarehouseLedger(bought.hub);

      const replay = await call(game.base, pickerSid, '/api/hub/action', 'POST', purchaseBody);
      assert.equal(replay.payload.ok, true);
      assert.equal(replay.payload.replayed, true);
      assert.deepEqual(replay.payload.actionResult, bought.actionResult);
      assert.equal(replay.payload.hub.funding, before.hub.funding - badgePrice, 'a retry must not charge twice');
      assert.equal(replay.payload.hub.items.find(item => item.id === 'badge_wallet')?.count, 1);

      await stopChild(game.child);
      game = await startGameServer({ port, saveDir, modelUrl: model.baseUrl });
      const restored = (await call(game.base, pickerSid, '/api/state')).payload;
      assertHub(restored);
      assert.equal(restored.hub.loadout.bag, 'badge_wallet');
      assert.equal(restored.hub.funding, before.hub.funding - badgePrice);
      assertWarehouseLedger(restored.hub);
      const afterRestartRetry = await call(game.base, pickerSid, '/api/hub/action', 'POST', purchaseBody);
      assert.equal(afterRestartRetry.payload.replayed, true);
      assert.equal(afterRestartRetry.payload.hub.funding, before.hub.funding - badgePrice);

      const ownedBefore = afterRestartRetry.payload.hub.funding;
      const equippedOwned = assertJsonOk(await call(game.base, pickerSid, '/api/hub/action', 'POST', {
        action: 'equip:canvas_pack', requestId: requestId('switch-owned-bag'),
      }), 'switching to an already-owned bag');
      assert.equal(equippedOwned.hub.loadout.bag, 'canvas_pack');
      assert.equal(equippedOwned.hub.funding, ownedBefore, 'equipping owned stock must not charge a purchase');
      assert.equal(equippedOwned.hub.items.find(item => item.id === 'badge_wallet')?.count, 1);
      assert.equal(equippedOwned.hub.stashUsed, bought.hub.stashUsed);
      assert.equal(equippedOwned.hub.items.find(item => item.id === 'badge_wallet')?.storedCount, 1);
      assert.equal(equippedOwned.hub.items.find(item => item.id === 'canvas_pack')?.equippedCount, 1);
      assertWarehouseLedger(equippedOwned.hub);
    });

    await t.test('buy-equip rejection for stage, funds, item type, and full storage leaves the profile unchanged', async () => {
      const checkRejectedWithoutMutation = async (sid, action, label) => {
        const before = (await call(game.base, sid, '/api/state')).payload;
        assertHub(before);
        assertWarehouseLedger(before.hub);
        const result = await call(game.base, sid, '/api/hub/action', 'POST', { action, requestId: requestId(label) });
        assertJsonRejected(result, `${label} should reject`);
        assertHub(result.payload);
        assert.equal(result.payload.hub.funding, before.hub.funding, `${label} must not spend funds`);
        assert.equal(result.payload.hub.stashUsed, before.hub.stashUsed, `${label} must not mutate storage`);
        assert.deepEqual(result.payload.hub.loadout, before.hub.loadout, `${label} must not change equipment`);
        assert.deepEqual(result.payload.hub.items.map(item => [item.id, item.count]), before.hub.items.map(item => [item.id, item.count]),
          `${label} must not create or remove inventory`);
        assertWarehouseLedger(result.payload.hub);
      };

      await checkRejectedWithoutMutation(randomBytes(12).toString('hex'), 'buy-equip:gpu_workstation', 'stage-locked-gear');
      await checkRejectedWithoutMutation(randomBytes(12).toString('hex'), 'buy-equip:padded_case', 'insufficient-funds-gear');
      await checkRejectedWithoutMutation(randomBytes(12).toString('hex'), 'buy-equip:dataset', 'non-gear-purchase');

      const fullSid = randomBytes(12).toString('hex');
      const full = createCareer(90210);
      const cap = careerView(full).stashCap;
      const used = careerView(full).stashUsed;
      full.profile.stash.wind = Number(full.profile.stash.wind || 0) + cap - used;
      full.profile.funding = 800;
      await fs.writeFile(path.join(saveDir, `${fullSid}.json`), JSON.stringify(full), 'utf8');
      const fullState = (await call(game.base, fullSid, '/api/state')).payload;
      assertHub(fullState);
      assert.equal(fullState.hub.stashUsed, cap);
      await checkRejectedWithoutMutation(fullSid, 'buy-equip:badge_wallet', 'full-storage-gear');
    });

    await t.test('retired saves migrate once with a preserved backup while current raids stay byte-for-byte active', async () => {
      const oldSid = randomBytes(12).toString('hex');
      const oldCareer = createCareer(77101);
      const oldRun = createProbabilityRaid({
        seed: 77101, raidId: 'api-retired-v2-77101', probabilityVersion: 2,
        venue: 'conference', target: 'dataset', strategy: 'balanced',
        loadout: Object.values(oldCareer.profile.loadout).filter(Boolean),
      });
      oldRun.probabilityVersion = 2;
      oldRun.status = 'playing';
      oldRun.settled = false;
      oldRun.bag = ['dataset'];
      oldRun.pendingLoot = ['dataset', 'dataset'];
      oldRun.archive = ['src_code'];
      oldRun.protectedIndex = 0;
      oldCareer.run = oldRun;
      const original = JSON.stringify(oldCareer);
      const oldPath = path.join(saveDir, `${oldSid}.json`);
      const backupPath = `${oldPath}.pre-current.bak`;
      await fs.writeFile(oldPath, original, 'utf8');

      const migrated = (await call(game.base, oldSid, '/api/state')).payload;
      assertHub(migrated);
      assert.equal(migrated.hub.migrationNotice?.kind, 'old-probability-recovered');
      assert.equal(migrated.hub.items.find(item => item.id === 'dataset')?.storedCount, 1,
        'only the one carried bag copy returns to owned inventory');
      assert.equal(migrated.hub.overflow.find(item => item.id === 'dataset')?.count, 2,
        'two unresolved discoveries remain separately available in overflow');
      assert.equal(migrated.hub.items.find(item => item.id === 'src_code')?.ownedCount || 0, 0,
        'old archive entries are not paid a second time during recovery');
      assert.equal(migrated.hub.loadout.bag, oldCareer.profile.loadout.bag,
        'profile equipment remains equipped without duplicating a gear copy');
      assert.equal(await fs.readFile(backupPath, 'utf8'), original, 'the first recovery preserves the exact pre-migration save');
      const firstSaved = JSON.parse(await fs.readFile(oldPath, 'utf8'));
      assert.equal(firstSaved.run, null);
      assert.ok(firstSaved.profile.migratedLegacyRunIds.includes(oldRun.raidId));

      const repeat = (await call(game.base, oldSid, '/api/state')).payload;
      assert.equal(repeat.hub.items.find(item => item.id === 'dataset')?.storedCount, 1);
      assert.equal(repeat.hub.overflow.find(item => item.id === 'dataset')?.count, 2);
      assert.equal(await fs.readFile(backupPath, 'utf8'), original, 'the one-time backup is never overwritten');

      const activeSid = randomBytes(12).toString('hex');
      const activeCareer = freshProbabilityFixture(77102);
      activeCareer.run.raidId = 'api-current-v3-77102';
      activeCareer.run.revision = 17;
      activeCareer.run.actionIndex = 16;
      activeCareer.run.rngState = 284921337;
      const activePath = path.join(saveDir, `${activeSid}.json`);
      await seedCareer(saveDir, activeSid, activeCareer);
      const before = JSON.parse(await fs.readFile(activePath, 'utf8')).run;
      const current = (await call(game.base, activeSid, '/api/state')).payload;
      assertRaid(current);
      assert.equal(current.view.raidId, before.raidId);
      assert.equal(current.view.revision, before.revision);
      assert.equal(current.view.difficulty.id, before.difficultyId);
      assert.equal(await fs.readFile(activePath, 'utf8'), JSON.stringify(activeCareer),
        'reading a valid v3 active save does not normalize or re-roll it');
      await assert.rejects(fs.access(`${activePath}.pre-current.bak`), { code: 'ENOENT' });

      await stopChild(game.child);
      game = await startGameServer({ port, saveDir, modelUrl: model.baseUrl });
      const oldAfterRestart = (await call(game.base, oldSid, '/api/state')).payload;
      assert.equal(oldAfterRestart.hub.items.find(item => item.id === 'dataset')?.storedCount, 1);
      assert.equal(oldAfterRestart.hub.overflow.find(item => item.id === 'dataset')?.count, 2);
      const activeAfterRestart = (await call(game.base, activeSid, '/api/state')).payload;
      assertRaid(activeAfterRestart);
      assert.equal(activeAfterRestart.view.revision, before.revision);
      assert.equal(JSON.parse(await fs.readFile(activePath, 'utf8')).run.rngState, before.rngState);
      await assert.rejects(fs.access(`${activePath}.pre-current.bak`), { code: 'ENOENT' });
    });
  } finally {
    if (game?.child) await stopChild(game.child);
    model.server.closeAllConnections?.();
    await new Promise(resolve => model.server.close(resolve));
    const safeDir = await verifiedSaveDirectory(saveDir);
    await fs.rm(safeDir, { recursive: true, force: true });
  }
});
