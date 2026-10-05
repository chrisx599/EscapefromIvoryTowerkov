import test from 'node:test';
import assert from 'node:assert/strict';
import { createProbabilityRaid, probabilityRaidView, actProbabilityRaid, probabilitySetup } from '../src/probability-raid.js';
import { createCareer, migrateCareer } from '../src/career.js';
import { likelihoodLabel, riskLabel, encounterLabel } from '../public/expedition-language.js';

const conditions = ['arrival', 'exchange', 'sidepath', 'lab', 'checkpoint', 'archive'];
const effects = ['contact', 'scrutiny', 'lead', 'interference', 'repaired', 'clear', 'detour'];
const actions = ['search:cautious', 'search', 'search:deep'];
// Saved-v3 context regression fixtures keep their original numerical rules.
const make = (options = {}) => { const run = createProbabilityRaid({ seed: 234567, ...options }); run.probabilityVersion = 3; delete run.stage; return run; };
const view = probabilityRaidView;
const round = value => Math.round(value * 10) / 10;
function withoutEvents(options) {
  const run = make(options);
  run.eventCount = 4;
  run.bagCap = 1000;
  run.stats.will = 30;
  run.stats.willMax = 30;
  return run;
}
function checked(run, id) {
  const result = actProbabilityRaid(run, id);
  assert.equal(result.ok, true, result.reason);
  return result;
}
function firstPercent(seed) {
  let value = seed >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return (value >>> 0) / 4294967296 * 100;
}
function seedBetween(low, high) {
  for (let seed = 1; seed < 100000; seed++) if (firstPercent(seed) >= low && firstPercent(seed) < high) return seed;
  throw new Error('Missing seed');
}
function fakeEvent(run, type, success = true) {
  run.event = { id: `context-${type}`, type, name: '现场人员', title: '现场变化', text: '处理当前情况。',
    choices: [{ key: 'respond', name: '处理', cost: {}, ...(success ? {} : { check: { base: 20 } }),
      onSuccess: { text: '处理顺利。' }, onFailure: { text: '处理受阻。' } }] };
  if (!success) run.rngState = seedBetween(95, 100);
}
function assertNoProbabilityProse(value, path = '') {
  if (typeof value === 'string') assert.doesNotMatch(value, /\d(?:\.\d+)?\s*[%％]|百分点/, path);
  else if (Array.isArray(value)) value.forEach((item, index) => assertNoProbabilityProse(item, `${path}[${index}]`));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertNoProbabilityProse(item, `${path}.${key}`);
  }
}

test('shared qualitative vocabulary has stable boundary labels, including no false guarantee', () => {
  assert.deepEqual([0, 1, 19, 20, 44.9, 45, 69.9, 70, 89.9, 90, 100].map(likelihoodLabel),
    ['暂无机会', '希望渺茫', '希望渺茫', '不太容易', '不太容易', '尚有机会', '尚有机会', '较有把握', '较有把握', '把握很大', '把握很大']);
  assert.deepEqual([-1, 0, 24.9, 25, 49.9, 50, 74.9, 75, 101].map(riskLabel),
    ['从容', '从容', '从容', '需留心', '需留心', '紧张', '紧张', '险峻', '险峻']);
  assert.deepEqual([0, 5, 45, 80, 100].map(encounterLabel), ['暂时平静', '偶有动静', '容易遇事', '动静频繁', '动静频繁']);
});

test('atomic search variants expose consistent pure previews and meaningful tradeoffs', () => {
  const run = make({ venue: 'visit' });
  const before = JSON.stringify(run);
  const current = view(run);
  assert.equal(JSON.stringify(run), before);
  assert.equal(current.expedition.condition.id, 'arrival');
  assert.equal(current.expedition.depthLabel, '靠近出口');
  const rows = current.expedition.approaches;
  assert.deepEqual(rows.map(row => row.actionId), actions);
  assert.ok(rows[0].searchPreview.acquisition < rows[1].searchPreview.acquisition);
  assert.ok(rows[1].searchPreview.acquisition < rows[2].searchPreview.acquisition);
  assert.ok(rows[0].searchPreview.encounter < rows[1].searchPreview.encounter);
  assert.ok(rows[1].searchPreview.encounter < rows[2].searchPreview.encounter);
  assert.ok(rows[0].searchPreview.riskDelta < rows[1].searchPreview.riskDelta);
  assert.ok(rows[1].searchPreview.riskDelta < rows[2].searchPreview.riskDelta);
  assert.ok(rows[0].searchPreview.extraDrop < rows[1].searchPreview.extraDrop);
  assert.ok(rows[1].searchPreview.extraDrop < rows[2].searchPreview.extraDrop);
  for (const row of rows) {
    assert.equal(row.outlook.acquisition, likelihoodLabel(row.searchPreview.acquisition));
    assert.equal(row.outlook.risk, riskLabel(row.searchPreview.riskAfter));
    assert.equal(current.actions.find(action => action.id === row.actionId).probability, row.searchPreview.acquisition);
    for (let index = 0; index < 3; index++) view(run);
    assert.equal(JSON.stringify(run), before, 'all approach previews must leave RNG and state untouched');
  }
});

test('approach choice causes real acquisition and risk differences with the same seeded roll', () => {
  for (const [low, high, expected] of [[55, 65, [false, true, true]], [65, 75, [false, false, true]]]) {
    const seed = seedBetween(low, high);
    const results = actions.map(id => {
      const run = withoutEvents({ seed });
      const preview = view(run).actions.find(action => action.id === id).searchPreview;
      const result = checked(run, id);
      assert.equal(run.stats.will, 29);
      assert.equal(run.stats.risk, preview.riskAfter);
      assert.equal(result.found, firstPercent(seed) < preview.acquisition);
      return result.found;
    });
    assert.deepEqual(results, expected);
  }
});

test('approach choice also changes actual encounter rolls rather than merely their labels', () => {
  let proved = false;
  for (let seed = 10000; seed < 13000 && !proved; seed++) {
    const cautious = make({ seed });
    const deep = make({ seed });
    checked(cautious, 'search:cautious');
    checked(deep, 'search:deep');
    if (!cautious.event && deep.event) proved = true;
  }
  assert.ok(proved, 'a shared seed produces a quiet cautious search and an eventful deep search');
});

test('search action validation is atomic in every blocked state and rejects unknown variants', () => {
  for (const blocked of ['event', 'loot', 'exhausted', 'automatic', 'ended']) {
    for (const id of actions) {
      const run = make();
      if (blocked === 'event') fakeEvent(run, 'npc');
      if (blocked === 'loot') run.pendingLoot = ['dataset'];
      if (blocked === 'exhausted') run.stats.will = 0;
      if (blocked === 'automatic') run.pendingAutoExtract = true;
      if (blocked === 'ended') run.status = 'ended';
      const before = JSON.stringify(run);
      assert.equal(actProbabilityRaid(run, id).ok, false, `${blocked}:${id}`);
      assert.equal(JSON.stringify(run), before);
      if (blocked !== 'ended') assert.equal(view(run).actions.find(row => row.id === id).disabled, true);
    }
  }
  const run = make();
  const before = JSON.stringify(run);
  for (const id of ['search:unknown', 'search:__proto__', 'approach:cautious']) assert.equal(actProbabilityRaid(run, id).ok, false);
  assert.equal(JSON.stringify(run), before);
});

test('return distance is accumulated by searches, bounded, persistent, and cannot be freely toggled', () => {
  const run = withoutEvents();
  checked(run, 'search:deep');
  assert.equal(run.expedition.depth, 1);
  const atDepth = view(run).probabilities;
  const atExit = view({ ...run, expedition: { ...run.expedition, depth: 0 } }).probabilities;
  assert.equal(round(atDepth.fail - atExit.fail), 1.3);
  assert.equal(round(atDepth.partial - atExit.partial), 2);
  assert.ok(atDepth.full < atExit.full);
  const before = JSON.stringify(run);
  assert.equal(actProbabilityRaid(run, 'approach:cautious').ok, false);
  assert.equal(JSON.stringify(run), before);
  checked(run, 'search:cautious');
  assert.equal(run.expedition.depth, 0);
  for (let index = 0; index < 8; index++) checked(run, 'search:deep');
  assert.equal(run.expedition.depth, 4);
  assert.equal(view(run).expedition.depthLabel, '深入腹地');
  for (let index = 0; index < 6; index++) checked(run, 'search:cautious');
  assert.equal(run.expedition.depth, 0);
});

test('field conditions persist for two searches, do not age on reads/items, and vary across seeds', () => {
  const observed = new Set();
  for (let seed = 1; seed <= 120; seed++) {
    const run = withoutEvents({ seed });
    checked(run, 'search');
    assert.equal(run.expedition.conditionId, 'arrival');
    checked(run, 'search');
    const condition = run.expedition.conditionId;
    assert.notEqual(condition, 'arrival');
    observed.add(condition);
    const context = JSON.stringify(run.expedition);
    for (let index = 0; index < 5; index++) view(run);
    if (run.bag.length) checked(run, 'drop:0');
    assert.equal(JSON.stringify(run.expedition), context);
    checked(run, 'search');
    assert.equal(run.expedition.conditionId, condition);
    checked(run, 'search');
    assert.notEqual(run.expedition.conditionId, condition);
  }
  assert.deepEqual([...observed].sort(), conditions.filter(id => id !== 'arrival').sort());
});

test('field descriptions correspond to correlated acquisition, material, encounter, and exit changes', () => {
  const run = make({ venue: 'visit' });
  run.stats.risk = 40;
  const baseline = view(run).probabilities;
  const changes = {};
  for (const conditionId of conditions) {
    const other = structuredClone(run);
    other.expedition.conditionId = conditionId;
    changes[conditionId] = view(other).probabilities;
  }
  assert.ok(changes.exchange.acquisition > baseline.acquisition && changes.exchange.encounter > baseline.encounter);
  assert.ok(changes.sidepath.acquisition < baseline.acquisition && changes.sidepath.encounter < baseline.encounter);
  assert.ok(changes.sidepath.full > baseline.full);
  assert.ok(changes.lab.materials.find(row => row.id === 'compute').conditionalProbability > baseline.materials.find(row => row.id === 'compute').conditionalProbability);
  assert.ok(changes.checkpoint.full < baseline.full && changes.checkpoint.acquisition < baseline.acquisition);
  assert.ok(changes.archive.materials.find(row => row.id === 'dataset').conditionalProbability > baseline.materials.find(row => row.id === 'dataset').conditionalProbability);
});

test('field condition biases the type of real events toward its described situation', () => {
  const counts = { arrival: 0, lab: 0 };
  for (let seed = 1; seed <= 500; seed++) {
    for (const conditionId of ['arrival', 'lab']) {
      const run = make({ seed: seed * 7919 });
      run.expedition.conditionId = conditionId;
      run.encounterPacing.dryStreak = 1;
      checked(run, 'search');
      assert.ok(run.event);
      if (run.event.type === 'technical') counts[conditionId]++;
    }
  }
  assert.ok(counts.lab > counts.arrival * 1.3, JSON.stringify(counts));
});

test('event success and setback leave visible bounded effects that expire after exactly two searches', () => {
  for (const [type, success, expected] of [
    ['npc', true, 'contact'], ['npc', false, 'scrutiny'], ['resource', true, 'lead'],
    ['resource', false, 'interference'], ['technical', true, 'repaired'], ['technical', false, 'interference'],
    ['route', true, 'clear'], ['route', false, 'detour'],
  ]) {
    const run = withoutEvents();
    fakeEvent(run, type, success);
    const action = view(run).event.actions[0];
    assert.match(success ? action.success : action.failure, /后续两次搜索/);
    const result = checked(run, 'event:respond');
    assert.equal(result.eventSuccess, success);
    assert.deepEqual(run.expedition.effect, { id: expected, remainingSearches: 2 });
    assert.equal(view(run).expedition.recentEffect.remainingSearches, 2);
    const withEffect = view(run).probabilities;
    const noEffect = view({ ...run, expedition: { ...run.expedition, effect: null } }).probabilities;
    assert.notDeepEqual(withEffect, noEffect, `${expected} must affect real calculations`);
    const saved = JSON.stringify(run.expedition);
    view(run); view(run);
    assert.equal(JSON.stringify(run.expedition), saved);
    checked(run, 'search');
    assert.equal(run.expedition.effect.remainingSearches, 1);
    checked(run, 'search');
    assert.equal(run.expedition.effect, null);
    assert.equal(view(run).expedition.recentEffect, null);
  }
});

test('new event effects replace old effects without stacking and leave does not invent a modifier', () => {
  const run = withoutEvents();
  fakeEvent(run, 'resource');
  checked(run, 'event:respond');
  fakeEvent(run, 'route');
  checked(run, 'event:respond');
  assert.deepEqual(run.expedition.effect, { id: 'clear', remainingSearches: 2 });
  const other = make();
  fakeEvent(other, 'route');
  const exitPreview = view(other).event.actions.find(row => row.endsRaid).exitProbabilities;
  checked(other, 'event:leave');
  assert.equal(other.expedition.effect, null);
  assert.deepEqual(exitPreview, { full: other.result.probabilities.full, partial: other.result.probabilities.partial, fail: other.result.probabilities.fail });
});

test('extreme contexts remain finite, bounded, and preserve exclusive extraction outcomes', () => {
  for (const conditionId of conditions) for (const effectId of [null, ...effects]) {
    for (const difficulty of ['easy', 'normal', 'hard']) for (const extreme of [false, true]) {
      const run = make({ venue: extreme ? 'industry' : 'conference', difficulty,
        skills: { research: extreme ? 10 : 1, engineering: extreme ? 10 : 1, expression: extreme ? 10 : 1 } });
      run.expedition = { conditionId, depth: extreme ? 4 : 0, effect: effectId ? { id: effectId, remainingSearches: 2 } : null };
      run.stats.risk = extreme ? 100 : 0;
      run.bag = extreme ? ['compute', 'compute', 'compute', 'compute'] : [];
      const current = view(run);
      for (const key of ['acquisition', 'encounter', 'extraDrop', 'full', 'partial', 'fail']) {
        assert.ok(Number.isFinite(current.probabilities[key]));
        assert.ok(current.probabilities[key] >= 0 && current.probabilities[key] <= 100);
      }
      assert.equal(round(current.probabilities.full + current.probabilities.partial + current.probabilities.fail), 100);
      assert.ok(current.probabilities.fail >= 1 && current.probabilities.fail <= 25);
      assert.ok(current.probabilities.partial >= 5 && current.probabilities.partial <= 35);
      for (const approach of current.expedition.approaches) {
        const p = approach.searchPreview;
        assert.ok(p.acquisition >= 30 && p.acquisition <= 95);
        assert.ok(p.encounter >= 0 && p.encounter <= 100);
        assert.ok(p.riskAfter >= 0 && p.riskAfter <= 100 && p.riskAfter >= run.stats.risk);
        assert.ok(p.extraDrop >= 0 && p.extraDrop <= 100);
      }
      for (const material of current.probabilities.materials) assert.ok(material.hitProbability >= 0 && material.hitProbability <= current.probabilities.acquisition);
    }
  }
});

test('missing and unknown saved context fields safely default without changing state or RNG on read', () => {
  const baseline = make();
  const old = structuredClone(baseline);
  delete old.expedition;
  delete old.encounterPacing;
  const before = JSON.stringify(old);
  assert.deepEqual(view(old).probabilities, view(baseline).probabilities);
  assert.equal(JSON.stringify(old), before);
  assert.equal(view(old).expedition.condition.id, 'arrival');
  assert.doesNotThrow(() => checked(old, 'search:deep'));
  const unknown = make();
  unknown.expedition = { conditionId: 'missing', lastApproach: 'unknown', depth: -500,
    searchesInCondition: 'not-a-number', effect: { id: '__proto__', remainingSearches: 999 } };
  const snapshot = JSON.stringify(unknown);
  assert.deepEqual(view(unknown).probabilities, view(baseline).probabilities);
  assert.equal(JSON.stringify(unknown), snapshot);
  checked(unknown, 'search');
  assert.equal(unknown.expedition.conditionId, 'arrival');
  assert.equal(unknown.expedition.effect, null);
});

test('save/restore replays routes, approach choices, effects, event costs, and final extraction exactly', () => {
  for (const seed of [1, 42, 357, 234567, 0xffffffff]) {
    const career = createCareer(seed);
    career.run = make({ seed, venue: 'visit', network: 2 });
    checked(career.run, 'search:deep');
    const restored = migrateCareer(JSON.stringify(career));
    assert.deepEqual(view(restored.run), view(career.run));
    let searches = 1;
    for (let step = 0; step < 35 && career.run.status === 'playing'; step++) {
      const current = view(career.run);
      let id;
      if (current.pendingLoot.length) id = 'take:available';
      else if (current.event) id = current.event.actions.find(action => !action.disabled && !action.endsRaid)?.id || 'event:leave';
      else if (searches >= 6) id = 'extract';
      else { id = actions[searches % actions.length]; searches++; }
      assert.deepEqual(actProbabilityRaid(restored.run, id), actProbabilityRaid(career.run, id));
      assert.deepEqual(view(restored.run), view(career.run));
      assert.deepEqual(restored.run.expedition, career.run.expedition);
      assert.equal(restored.run.rngState, career.run.rngState);
    }
    assert.equal(career.run.status, 'ended');
  }
});

test('new player-facing setup, preview, event, search, and extraction prose contains no numerical probability', () => {
  assertNoProbabilityProse(probabilitySetup());
  for (const seed of [1, 55, 400, 234567]) {
    const run = make({ seed, network: 2 });
    let searches = 0;
    for (let step = 0; step < 30 && run.status === 'playing'; step++) {
      const current = view(run);
      assertNoProbabilityProse(current.expedition);
      assertNoProbabilityProse(current.actions);
      assertNoProbabilityProse(current.event);
      assertNoProbabilityProse(current.log);
      assertNoProbabilityProse(current.lastAction);
      assertNoProbabilityProse(current.probabilities.encounterReason);
      if (current.pendingLoot.length) checked(run, 'take:available');
      else if (current.event) checked(run, current.event.actions.find(row => !row.disabled && !row.endsRaid)?.id || 'event:leave');
      else if (searches >= 4) checked(run, 'extract');
      else checked(run, actions[searches++ % 3]);
    }
    assert.equal(run.status, 'ended');
    assertNoProbabilityProse(view(run).result);
    assertNoProbabilityProse(view(run).log);
  }
});


test('search approach carries into subsequent event checks and cannot be changed during that event', () => {
  const checks = actions.map(id => {
    const run = withoutEvents();
    checked(run, id);
    fakeEvent(run, 'technical', false);
    run.event.choices[0].check = { base: 55, riskFactor: 0 };
    const current = view(run);
    const before = JSON.stringify(run);
    assert.equal(actProbabilityRaid(run, 'search:cautious').ok, false);
    assert.equal(JSON.stringify(run), before);
    return current.event.actions[0].probability;
  });
  assert.deepEqual(checks, [58, 55, 52]);
});
