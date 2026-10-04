import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actProbabilityRaid,
  createProbabilityRaid,
  probabilityRaidView,
} from '../src/probability-raid.js';
import {
  careerView,
  createCareer,
  deployProbability,
  migrateCareer,
  probabilitySetup,
  settle,
} from '../src/career.js';

function rngFirst(seed) {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 4294967296;
}

function rngSequence(seed, count) {
  const values = [];
  let value = seed >>> 0;
  for (let index = 0; index < count; index += 1) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    value = (value >>> 0) || 1;
    values.push(value / 4294967296);
  }
  return values;
}

function seedForRange(low, high) {
  for (let seed = 1; seed < 500_000; seed += 1) {
    const value = rngFirst(seed) * 100;
    if (value >= low && value < high) return seed;
  }
  throw new Error(`could not find PRNG seed for ${low}..${high}`);
}

function makeRun(options = {}) {
  return createProbabilityRaid({ probabilityVersion: 3, seed: 123, ...options });
}

function makeNaturalRun(options = {}) {
  return makeRun(options);
}

function setEvent(run, overrides = {}) {
  run.event = {
    id: 'prof-review', npcId: 'prof-wen', name: '温教授', title: '评测结果追问',
    text: '教授希望确认评测依据。', type: 'npc', tone: 'social', difficulty: 0,
    image: '/assets/generated/scholar.png', choices: [{
      key: 'show-evidence', name: '展示研究依据', requiresAny: ['dataset', 'src_code'], cost: { will: 1 },
      check: { base: 55, skill: 'research', perLevel: 4, cap: 20, evidenceBonus: 20, riskFactor: 0 },
      onSuccess: { riskDelta: -10, support: 8, rewardId: 'wind', trustDelta: 1, text: '教授认可了可核验的依据。' },
      onFailure: { riskDelta: 8, willDelta: -1, trustDelta: -1, text: '依据仍不够完整，交流增加了压力。' },
    }],
    ...overrides,
  };
  run.eventCount = Math.max(1, run.eventCount || 0);
  run.usedEventIds ||= [];
  if (!run.usedEventIds.includes(run.event.id)) run.usedEventIds.push(run.event.id);
}

function clearPendingLoot(run) {
  if (run.pendingLoot.length) assert.equal(actProbabilityRaid(run, 'take:available').ok, true);
}

function runToEventWithinTwoSearches(seed) {
  const run = makeRun({ seed, venue: 'conference', difficulty: 'normal' });
  actProbabilityRaid(run, 'search');
  clearPendingLoot(run);
  if (!run.event) actProbabilityRaid(run, 'search');
  return run;
}

test('current view is pure and exposes difficulty, natural materials, and search cost before action', () => {
  const run = makeRun({ venue: 'visit', difficulty: 'normal',
    skills: { research: 1, engineering: 1, expression: 1 } });
  const before = JSON.stringify(run);
  const view = probabilityRaidView(run);
  assert.equal(JSON.stringify(run), before);
  assert.equal(view.mode, 'probability');
  assert.equal(view.probabilityVersion, 3);
  assert.equal(view.difficulty.id, 'normal');
  assert.equal(view.probabilities.acquisition, 57);
  assert.equal(view.target, undefined);
  assert.equal(view.strategy, undefined);
  assert.deepEqual(view.probabilities.materials.map(item => item.id), ['dataset', 'src_code', 'compute', 'wind']);
  assert.equal(view.probabilities.materials.reduce((sum, item) => sum + item.conditionalProbability, 0), 100);
  assert.ok(view.probabilities.materials.every(item => item.hitProbability <= view.probabilities.acquisition));
  assert.equal(view.probabilities.encounter, 28);
  assert.equal(view.probabilities.full + view.probabilities.partial + view.probabilities.fail, 100);
  assert.equal(view.event, null);

  const search = view.actions.find(action => action.id === 'search');
  assert.equal(search.cost, '心力 −1；风险 +12');
  assert.equal(search.riskDelta, 12);
  assert.equal(search.searchPreview.acquisition, 57);
  assert.equal(view.actions.find(action => action.id === 'extract').disabled, false);
});

test('missed search still costs will and raises risk; the post-event cooldown suppresses exactly one search', () => {
  const run = makeRun({ venue: 'visit', seed: 5 });
  run.encounterCooldown = true;
  run.rngState = seedForRange(65, 100);
  const beforeRng = run.rngState;
  const result = actProbabilityRaid(run, 'search');
  assert.equal(result.ok, true);
  assert.equal(result.found, false);
  assert.equal(run.stats.will, 9);
  assert.equal(run.stats.risk, 12);
  assert.equal(run.event, null);
  assert.equal(run.encounterCooldown, false);
  assert.notEqual(run.rngState, beforeRng);
  assert.equal(run.history.length, 1);
  assert.equal(probabilityRaidView(run).probabilities.encounter, 34);
});

test('natural material weights and venue extra drops use separate visible probabilities', () => {
  const run = makeRun({ venue: 'visit', difficulty: 'normal', seed: 10 });
  const preview = probabilityRaidView(run).probabilities;
  assert.equal(preview.acquisition, 57);
  assert.equal(preview.extraDrop, 25);
  assert.ok(preview.materials.some(item => item.id === 'dataset' && item.weight === 5));
  assert.ok(preview.materials.some(item => item.id === 'wind' && item.weight === 2));
  assert.ok(preview.materials.every(item => item.hitProbability > 0 && item.hitProbability <= preview.acquisition));
});

test('new probability runs use v3 natural material weights and expose no selected target or strategy', () => {
  const run = createProbabilityRaid({ seed: 77 });
  const view = probabilityRaidView(run);
  assert.equal(run.probabilityVersion, 3);
  assert.equal(Object.hasOwn(run, 'targetId'), false);
  assert.equal(Object.hasOwn(run, 'strategyId'), false);
  assert.equal(Object.hasOwn(view, 'target'), false);
  assert.equal(Object.hasOwn(view, 'strategy'), false);
  assert.equal(view.probabilities.target, undefined);
  assert.deepEqual(view.probabilities.materials.map(row => row.id), ['dataset', 'src_code', 'compute', 'wind']);
  assert.equal(view.probabilities.materials.reduce((sum, row) => sum + row.conditionalProbability, 0), 100);
  assert.ok(view.probabilities.materials.every(row => row.hitProbability >= 0 && row.hitProbability <= view.probabilities.acquisition));

  const setup = careerView(createCareer(42)).probabilitySetup;
  assert.deepEqual(setup.difficulties.map(row => row.id), ['easy', 'normal', 'hard']);
  assert.equal(setup.targets, undefined);
  assert.equal(setup.strategies, undefined);
  const venue = setup.venues.find(row => row.id === 'conference');
  assert.ok(venue.pool.materials.some(row => row.id === 'compute'));
  assert.deepEqual(venue.difficultyPreviews.map(row => row.difficultyId), ['easy', 'normal', 'hard']);
  assert.ok(venue.difficultyPreviews.every(row => row.materials.length === 4));
  assert.equal(probabilitySetup({ research: { stage: 0 } }).venues[0].difficultyPreviews[1].acquisition, 65,
    'partial profiles without saved skills still produce a safe default preview');

  const equipped = createCareer(43);
  equipped.profile.stash.citation_scanner = 1;
  equipped.profile.loadout.tool = 'citation_scanner';
  equipped.profile.research.skills.research = 9;
  const equippedSetup = careerView(equipped).probabilitySetup;
  const normalPreview = equippedSetup.venues.find(row => row.id === 'conference')
    .difficultyPreviews.find(row => row.difficultyId === 'normal');
  assert.equal(normalPreview.acquisition, 77, 'setup preview uses the same research skill level as deployment');
  assert.equal(normalPreview.materials.find(row => row.id === 'wind').weight, 1.1);
  assert.equal(deployProbability(equipped, { seed: 43, venue: 'conference', difficulty: 'normal' }).ok, true);
  const deployedView = probabilityRaidView(equipped.run);
  assert.equal(deployedView.probabilities.acquisition, normalPreview.acquisition);
  assert.deepEqual(deployedView.probabilities.materials, normalPreview.materials);
});

test('v3 difficulty changes acquisition, risk, checks, and extra drops in opposite directions', () => {
  const easy = makeNaturalRun({ venue: 'visit', difficulty: 'easy' });
  const normal = makeNaturalRun({ venue: 'visit', difficulty: 'normal' });
  const hard = makeNaturalRun({ venue: 'visit', difficulty: 'hard' });
  const e = probabilityRaidView(easy);
  const n = probabilityRaidView(normal);
  const h = probabilityRaidView(hard);
  assert.equal(e.probabilities.acquisition, 52);
  assert.equal(n.probabilities.acquisition, 57);
  assert.equal(h.probabilities.acquisition, 65);
  assert.equal(e.actions.find(row => row.id === 'search').riskDelta, 9);
  assert.equal(n.actions.find(row => row.id === 'search').riskDelta, 12);
  assert.equal(h.actions.find(row => row.id === 'search').riskDelta, 16);
  assert.equal(e.probabilities.extraDrop, 25);
  assert.equal(n.probabilities.extraDrop, 25);
  assert.equal(h.probabilities.extraDrop, 40);
  assert.ok(h.probabilities.materials[0].hitProbability > n.probabilities.materials[0].hitProbability,
    'hard gets both the acquisition increase and the independent extra-drop benefit');

  function checkedEvent(difficulty) {
    const raid = makeNaturalRun({ venue: 'conference', difficulty });
    setEvent(raid, { difficulty: 0, choices: [{ key: 'answer', name: '回答问题',
      check: { base: 55, riskFactor: 0 }, onSuccess: { text: '通过。' }, onFailure: { text: '未通过。' } }] });
    return probabilityRaidView(raid).event.actions.find(row => row.id === 'event:answer').probability;
  }
  assert.equal(checkedEvent('easy'), 65);
  assert.equal(checkedEvent('normal'), 55);
  assert.equal(checkedEvent('hard'), 45);
});

test('collection equipment biases its natural material share without changing total acquisition', () => {
  const plain = makeNaturalRun({ venue: 'conference' });
  const scanner = makeNaturalRun({ venue: 'conference', loadout: ['citation_scanner'] });
  const plainView = probabilityRaidView(plain);
  const scannerView = probabilityRaidView(scanner);
  const plainWind = plainView.probabilities.materials.find(row => row.id === 'wind');
  const scannerWind = scannerView.probabilities.materials.find(row => row.id === 'wind');
  assert.equal(scannerView.probabilities.acquisition, plainView.probabilities.acquisition);
  assert.equal(scannerWind.weight, 1.1);
  assert.equal(scannerWind.weightBonus, 10);
  assert.ok(scannerWind.conditionalProbability > plainWind.conditionalProbability);
  assert.ok(scannerWind.hitProbability > plainWind.hitProbability);

  const biasSeed = Array.from({ length: 100_000 }, (_, index) => index + 1)
    .find(seed => {
      const [acquisitionRoll, materialRoll] = rngSequence(seed, 2);
      return acquisitionRoll < 0.65 && materialRoll >= 1 - 1.1 / 10.1 && materialRoll < 0.9;
    });
  assert.ok(biasSeed);
  for (const raid of [plain, scanner]) {
    raid.rngState = biasSeed;
    raid.encounterCooldown = true;
    assert.equal(actProbabilityRaid(raid, 'search').ok, true);
  }
  assert.equal(plain.bag[0], 'compute');
  assert.equal(scanner.bag[0], 'wind', 'the equipped scanner changes the actual weighted loot roll');

});

test('invalid actions do not spend resources, advance RNG, or increment revision', () => {
  const run = makeRun({ supplies: ['coffee_ticket'] });
  const before = JSON.stringify(run);
  assert.equal(actProbabilityRaid(run, 'event:show-evidence').ok, false);
  assert.equal(actProbabilityRaid(run, 'backup:99').ok, false);
  assert.equal(actProbabilityRaid(run, 'use:99').ok, false);
  assert.equal(JSON.stringify(run), before);

  run.bag = ['dataset', 'src_code', 'wind', 'compute', 'dataset', 'src_code', 'compute'];
  run.pendingLoot = ['wind'];
  const fullBefore = JSON.stringify(run);
  assert.equal(actProbabilityRaid(run, 'take:all').ok, false);
  assert.equal(JSON.stringify(run), fullBefore);
  assert.equal(actProbabilityRaid(run, 'take:available').ok, true);
  assert.deepEqual(run.pendingLoot, []);
});

test('a current evidence choice makes one bounded check, adds reward and trust, and grants exit support', () => {
  const run = makeRun({ seed: 1, skills: { research: 10, engineering: 1, expression: 1 } });
  run.bag = ['dataset'];
  run.stats.risk = 20;
  run.rngState = 1;
  setEvent(run);
  const action = probabilityRaidView(run).event.actions.find(option => option.id === 'event:show-evidence');
  assert.equal(action.disabled, false);
  assert.equal(action.probability, 95);

  const revision = run.revision;
  const result = actProbabilityRaid(run, 'event:show-evidence');
  assert.equal(result.ok, true);
  assert.equal(result.eventSuccess, true);
  assert.equal(run.revision, revision + 1);
  assert.equal(run.stats.will, 9);
  assert.equal(run.stats.risk, 10);
  assert.equal(run.support, 8);
  assert.deepEqual(run.pendingLoot, []);
  assert.deepEqual(run.bag, ['dataset', 'wind']);
  assert.equal(run.event, null);
  assert.equal(run.encounterCooldown, true);
  assert.equal(run.contactUpdates['prof-wen'].trustDelta, 1);
  assert.equal(run.history.length, 1);
  assert.deepEqual(run.rewardedEventIds, ['prof-review']);
  const rngAfterResponse = run.rngState;
  const revisionAfterResponse = run.revision;
  assert.equal(actProbabilityRaid(run, 'event:show-evidence').ok, false);
  assert.equal(run.rngState, rngAfterResponse);
  assert.equal(run.revision, revisionAfterResponse);

  assert.equal(probabilityRaidView(run).probabilities.encounter, 0);
  assert.match(probabilityRaidView(run).probabilities.encounterReason, /免交涉/);
});

test('a failed current event response applies its declared and failure heart costs plus risk', () => {
  const run = makeRun({ venue: 'conference', difficulty: 'normal', seed: seedForRange(45, 100), skills: { research: 1, engineering: 1, expression: 1 } });
  run.stats.will = 8;
  setEvent(run, { id: 'prof-resources', npcId: 'prof-lin', name: '林教授', choices: [{
    key: 'explain', name: '解释实验方法', cost: { will: 1 },
    check: { base: 45, riskFactor: 0 },
    onSuccess: { riskDelta: -3, trustDelta: 1, text: '实验方法得到认可。' },
    onFailure: { riskDelta: 8, willDelta: -1, trustDelta: -1, text: '还需要补充实验依据。' },
  }] });
  const action = probabilityRaidView(run).event.actions.find(option => option.id === 'event:explain');
  assert.equal(action.probability, 45);
  assert.equal(actProbabilityRaid(run, 'event:explain').eventSuccess, false);
  assert.equal(run.stats.will, 6);
  assert.equal(run.stats.risk, 8);
  assert.equal(run.support, 0);
  assert.equal(run.contactUpdates['prof-lin'].trustDelta, -1);
});

test('leaving a current event has no interaction XP and applies the shown risk before one exit roll', () => {
  const run = makeRun({ seed: 1, venue: 'industry', difficulty: 'normal' });
  run.stats.risk = 30;
  run.history = [];
  setEvent(run);
  const leave = probabilityRaidView(run).event.actions.find(action => action.id === 'event:leave');
  assert.equal(leave.probability, undefined, 'leaving the conversation must not promise guaranteed extraction');
  const exitTotal = leave.exitProbabilities.full + leave.exitProbabilities.partial + leave.exitProbabilities.fail;
  assert.ok(Math.abs(exitTotal - 100) < 0.2, 'one-decimal display odds should total 100% within rounding');
  assert.equal(actProbabilityRaid(run, 'event:leave').ok, true);
  assert.equal(run.history.length, 0);
  assert.equal(run.stats.risk, 34);
  assert.equal(run.status, 'ended');
  assert.equal(run.result.probabilities.parts.extraction.risk, 34);
  assert.deepEqual(leave.exitProbabilities, {
    full: run.result.probabilities.full, partial: run.result.probabilities.partial, fail: run.result.probabilities.fail,
  }, 'the pre-click exit distribution must be the one actually used after the declared risk cost');
  assert.equal(actProbabilityRaid(run, 'extract').ok, false);
});

test('exit outcome probabilities are exclusive; failure protects one chosen material and cannot be rerolled', () => {
  const run = makeRun({ venue: 'industry', seed: 1, loadout: ['backup_device'] });
  run.stats.risk = 100;
  run.bag = ['dataset', 'src_code', 'wind'];
  run.protectedIndex = 0;
  run.rngState = 1;
  const view = probabilityRaidView(run);
  assert.equal(view.probabilities.fail, 23);
  assert.equal(view.probabilities.partial, 28);
  assert.equal(view.probabilities.full, 49);
  assert.equal(view.probabilities.fail + view.probabilities.partial + view.probabilities.full, 100);

  assert.equal(actProbabilityRaid(run, 'extract').ok, true);
  assert.equal(run.result.kind, 'scatter');
  assert.deepEqual(run.result.archivedIds, ['dataset']);
  assert.deepEqual(run.result.carriedIds, []);
  assert.deepEqual(run.result.lostIds, ['src_code', 'wind']);
  assert.deepEqual(run.result.returnedLoadoutIds, ['backup_device']);
  assert.deepEqual(probabilityRaidView(run).result.returned.map(item => [item.id, item.protected]), [['dataset', true]]);
  assert.deepEqual(probabilityRaidView(run).result.lost.map(item => item.id), ['src_code', 'wind']);
  const rngAfter = run.rngState;
  const revisionAfter = run.revision;
  assert.equal(actProbabilityRaid(run, 'extract').ok, false);
  assert.equal(run.rngState, rngAfter);
  assert.equal(run.revision, revisionAfter);
});

test('partial exit deterministically loses the lowest-value unprotected research material', () => {
  const run = makeRun({ venue: 'industry', loadout: ['backup_device'] });
  run.stats.risk = 100;
  run.bag = ['dataset', 'src_code', 'wind'];
  run.protectedIndex = 0;
  run.rngState = seedForRange(23, 51);
  assert.equal(actProbabilityRaid(run, 'extract').ok, true);
  assert.equal(run.result.kind, 'messy');
  assert.deepEqual(run.result.archivedIds, ['dataset']);
  assert.deepEqual(run.result.lostIds, ['wind']);
  assert.deepEqual(run.result.carriedIds, ['src_code']);
});

test('partial exit with no exposed research material preserves the whole carried bag', () => {
  const run = makeRun({ venue: 'industry' });
  run.stats.risk = 100;
  run.bag = ['coffee_ticket'];
  run.rngState = seedForRange(23, 51);
  assert.equal(actProbabilityRaid(run, 'extract').ok, true);
  assert.equal(run.result.kind, 'messy');
  assert.equal(run.result.noMaterialLoss, true);
  assert.deepEqual(run.result.carriedIds, ['coffee_ticket']);
  assert.deepEqual(run.result.lostIds, []);
});

test('last-heart search suppresses an event and automatically extracts after carrying any in-capacity loot', () => {
  const run = makeRun({ seed: 1, venue: 'conference' });
  run.stats.will = 1;
  run.rngState = 1;
  const view = probabilityRaidView(run);
  assert.equal(view.probabilities.encounter, 0);
  assert.match(view.probabilities.encounterReason, /用尽心力/);
  assert.equal(actProbabilityRaid(run, 'search').ok, true);
  assert.equal(run.event, null);
  assert.equal(run.pendingLoot.length, 0);
  assert.equal(run.pendingAutoExtract, false);
  assert.equal(run.status, 'ended');
  assert.equal(run.result.automatic, true);
});

test('the four-event per-raid limit removes the next event chance with an explicit reason', () => {
  const run = makeRun({ venue: 'industry' });
  run.eventCount = 4;
  run.stats.risk = 100;
  const view = probabilityRaidView(run);
  assert.equal(view.probabilities.encounter, 0);
  assert.match(view.probabilities.encounterReason, /4 次上限/);
  run.rngState = 1;
  assert.equal(actProbabilityRaid(run, 'search').ok, true);
  assert.equal(run.event, null);
  assert.equal(run.eventCount, 4);
});

test('current pacing guarantees a real event by the second eligible search, then honors cooldown without counting a miss', () => {
  let run;
  for (let seed = 1; seed < 5000; seed += 1) {
    const candidate = makeRun({ venue: 'conference', seed });
    assert.equal(probabilityRaidView(candidate).probabilities.encounter, 19);
    assert.equal(actProbabilityRaid(candidate, 'search').ok, true);
    if (!candidate.event) {
      run = candidate;
      break;
    }
  }
  assert.ok(run, 'find a seed whose first eligible search misses the displayed 19% roll');
  let view = probabilityRaidView(run);
  assert.equal(view.encounterPacing.eligibleSearches, 1);
  assert.equal(view.encounterPacing.noEventStreak, 1);
  assert.equal(view.encounterPacing.searchesUntilGuaranteed, 1);
  assert.equal(view.probabilities.encounter, 100);
  assert.match(view.probabilities.encounterReason, /100%/);

  assert.equal(actProbabilityRaid(run, 'search').ok, true);
  assert.ok(run.event, 'the guarantee triggers an actual event, not just a displayed rate');
  view = probabilityRaidView(run);
  assert.equal(view.encounterPacing.eligibleSearches, 2);
  assert.equal(view.encounterPacing.noEventStreak, 0);
  assert.equal(view.encounterPacing.eventsUsed, 1);
  assert.ok(view.event.typeLabel);
  assert.ok(['opportunity', 'danger', 'social'].includes(view.event.tone));
  assert.match(view.event.image, /^\/assets\/generated\/(scholar|research-desk|locker|poster-board|taxi)\.png$/);
  assert.ok(view.event.actions.length >= 3 && view.event.actions.length <= 4);
  assert.equal(view.event.actions.filter(action => action.endsRaid).length, 1);
  assert.ok(view.event.actions.find(action => action.endsRaid).id === 'event:leave');
  for (const action of view.event.actions) {
    assert.equal(typeof action.cost, 'string');
    assert.equal(typeof action.success, 'string');
    assert.equal(typeof action.failure, 'string');
    if (action.endsRaid) {
      assert.equal(action.probability, undefined, 'terminal choices show the exit distribution instead of a meaningless response-check rate');
      assert.ok(action.exitProbabilities);
    } else {
      assert.ok(action.probability >= 0 && action.probability <= 100);
    }
  }

  const response = view.event.actions.find(action => !action.disabled && !action.endsRaid);
  assert.ok(response, 'the event includes an affordable response so leaving is not compulsory');
  assert.equal(actProbabilityRaid(run, response.id).ok, true);
  clearPendingLoot(run);
  assert.equal(run.encounterCooldown, true);
  const eligibleBeforeCooldown = run.encounterPacing.eligibleSearches;
  const missesBeforeCooldown = run.encounterPacing.dryStreak;
  assert.equal(probabilityRaidView(run).probabilities.encounter, 0);
  assert.equal(actProbabilityRaid(run, 'search').ok, true);
  assert.equal(run.encounterPacing.eligibleSearches, eligibleBeforeCooldown);
  assert.equal(run.encounterPacing.dryStreak, missesBeforeCooldown);
  assert.equal(run.encounterCooldown, false);
});

test('current action previews use normalized outcomes, costs, clamped effects, and real support probabilities', () => {
  const run = makeRun({ seed: 6 });
  run.stats.risk = 99;
  run.stats.will = 3;
  run.stats.network = 1;
  run.bag = ['compute'];
  setEvent(run, {
    choices: [{
      key: 'repair', name: '修复终端', cost: { will: 1, network: 1, items: { compute: 1 } },
      check: { base: 20, riskFactor: 0 },
      onSuccess: { riskDelta: -10, support: 8, rewardId: 'wind', text: '终端修复完成。' },
      onFailure: { riskDelta: 12, willDelta: -1, text: '故障扩大。' },
    }],
  });
  const action = probabilityRaidView(run).event.actions.find(row => row.id === 'event:repair');
  assert.equal(action.probability, 20);
  assert.match(action.cost, /心力 −1/);
  assert.match(action.cost, /人脉 −1/);
  assert.match(action.cost, /算力卡 ×1/);
  assert.match(action.success, /风险 -10/);
  assert.match(action.success, /接应支持 \+8/);
  assert.match(action.success, /部分带回率 \d+(?:\.\d+)?%→\d+(?:\.\d+)?%/);
  assert.match(action.success, /获得方向风向/);
  assert.match(action.failure, /风险 \+1/);
  assert.match(action.failure, /心力 -1/);
  assert.doesNotMatch(action.failure, /风险 \+12/);

  run.rngState = seedForRange(20, 100);
  const result = actProbabilityRaid(run, 'event:repair');
  assert.equal(result.ok, true);
  assert.equal(result.eventSuccess, false);
  assert.equal(run.stats.risk, 100, 'failure risk clamps at 100');
  assert.equal(run.stats.will, 1, 'one action heart plus one failure heart are both paid');
  assert.equal(run.stats.network, 0);
  assert.deepEqual(run.bag, []);
  assert.equal(run.lastAction.riskDelta, 1);
  assert.equal(run.lastAction.willDelta, -2);
  assert.equal(run.lastAction.networkDelta, -1);

  const successRun = makeRun({ seed: 1 });
  successRun.stats.risk = 30;
  setEvent(successRun, {
    type: 'resource',
    choices: [{ key: 'claim', name: '领取样例',
      onSuccess: { riskDelta: -10, support: 8, rewardId: 'wind', text: '样例核验完成。' } }],
  });
  const successAction = probabilityRaidView(successRun).event.actions.find(row => row.id === 'event:claim');
  assert.equal(successAction.probability, 100);
  assert.match(successAction.failure, /无检定/);
  assert.equal(actProbabilityRaid(successRun, 'event:claim').eventSuccess, true);
  assert.equal(successRun.stats.risk, 20);
  assert.equal(successRun.support, 8);
  assert.deepEqual(successRun.bag, ['wind']);
  assert.match(successRun.lastAction.text, /部分带回率/);
  assert.equal(successRun.lastAction.itemsAdded[0].id, 'wind');
});

test('event leave previews only the risk actually added after the 100 cap', () => {
  const run = makeRun({ seed: 7 });
  run.stats.risk = 97;
  setEvent(run, { choices: [] });
  const leave = probabilityRaidView(run).event.actions.find(row => row.id === 'event:leave');
  assert.equal(leave.cost, '风险 +3 后立即撤离');
  const afterRisk = probabilityRaidView({
    ...run, event: null, stats: { ...run.stats, risk: 100 },
  });
  assert.deepEqual(leave.exitProbabilities, {
    full: afterRisk.probabilities.full,
    partial: afterRisk.probabilities.partial,
    fail: afterRisk.probabilities.fail,
  });
  assert.equal(actProbabilityRaid(run, 'event:leave').ok, true);
  assert.equal(run.stats.risk, 100);
  assert.equal(run.lastAction.riskDelta, 3);
  assert.deepEqual(leave.exitProbabilities, {
    full: run.result.probabilities.full,
    partial: run.result.probabilities.partial,
    fail: run.result.probabilities.fail,
  });
});

test('event exit is blocked while found loot is pending, then previews the settled bag accurately', () => {
  const run = makeRun({ seed: 11 });
  run.stats.risk = 40;
  run.pendingLoot = ['compute'];
  setEvent(run, { choices: [] });
  const leave = probabilityRaidView(run).event.actions.find(row => row.id === 'event:leave');
  assert.equal(leave.disabled, true);
  assert.match(leave.reason, /先整理本轮发现/);
  const beforeInvalid = JSON.stringify(run);
  assert.equal(actProbabilityRaid(run, 'event:leave').ok, false);
  assert.equal(JSON.stringify(run), beforeInvalid, 'rejected exit leaves state and RNG untouched');

  assert.equal(actProbabilityRaid(run, 'take:all').ok, true);
  assert.deepEqual(run.bag, ['compute']);
  const readyView = probabilityRaidView(run);
  const readyLeave = readyView.event.actions.find(row => row.id === 'event:leave');
  assert.equal(readyLeave.disabled, false);
  const projected = probabilityRaidView({
    ...run, event: null, stats: { ...run.stats, risk: 44 },
  }).probabilities;
  assert.deepEqual(readyLeave.exitProbabilities, {
    full: projected.full, partial: projected.partial, fail: projected.fail,
  });
  assert.equal(actProbabilityRaid(run, 'event:leave').ok, true);
  assert.deepEqual(readyLeave.exitProbabilities, {
    full: run.result.probabilities.full,
    partial: run.result.probabilities.partial,
    fail: run.result.probabilities.fail,
  });
});

test('current pity reaches 100% after three tracked misses and that roll creates an event', () => {
  const run = makeRun({ venue: 'conference', seed: 99 });
  run.stats.will = 20;
  run.stats.willMax = 20;
  run.encounterPacing = { eligibleSearches: 0, dryStreak: 0, firstEventSeen: true };
  run.eventCount = 1;
  run.usedEventIds = ['current-already-resolved'];

  function seedThatMisses(current) {
    for (let seed = 1; seed < 100_000; seed += 1) {
      const trial = structuredClone(current);
      trial.rngState = seed;
      const result = actProbabilityRaid(trial, 'search');
      if (result.ok && !trial.event && trial.encounterPacing.dryStreak === current.encounterPacing.dryStreak + 1) return seed;
    }
    throw new Error('could not find a deterministic no-event roll');
  }

  for (let miss = 1; miss <= 3; miss += 1) {
    const view = probabilityRaidView(run);
    assert.equal(view.probabilities.encounter === 100, false);
    assert.equal(view.encounterPacing.searchesUntilGuaranteed, 4 - miss + 1);
    run.rngState = seedThatMisses(run);
    assert.equal(actProbabilityRaid(run, 'search').ok, true);
    assert.equal(run.event, null);
    while (run.pendingLoot.length) actProbabilityRaid(run, 'take:skip');
    while (run.bag.length) actProbabilityRaid(run, `drop:${run.bag.length - 1}`);
    assert.equal(run.encounterPacing.dryStreak, miss);
  }

  const guaranteed = probabilityRaidView(run);
  assert.equal(guaranteed.probabilities.encounter, 100);
  assert.match(guaranteed.probabilities.encounterReason, /连续 3 次/);
  run.rngState = 123;
  assert.equal(actProbabilityRaid(run, 'search').ok, true);
  assert.ok(run.event, 'the pity guarantee must be reflected by an actual event');
  assert.equal(run.encounterPacing.firstEventSeen, true);
  assert.equal(run.encounterPacing.dryStreak, 0);
});

test('fixed current seeds expose four event categories and produce readable actions; short runs report real return outcomes', () => {
  const ids = new Set();
  const types = new Set();
  for (let seed = 1; seed <= 800; seed += 1) {
    const run = runToEventWithinTwoSearches(seed);
    assert.ok(run.event, `seed ${seed} must trigger by the second eligible search`);
    ids.add(run.event.id);
    types.add(run.event.type);
    const event = probabilityRaidView(run).event;
    assert.ok(event.actions.length >= 3 && event.actions.length <= 4);
    assert.equal(event.actions.filter(row => row.endsRaid).length, 1);
    assert.ok(event.actions.some(row => !row.endsRaid && !row.disabled), `${event.id} should offer a workable response`);
  assert.ok(event.actions.filter(row => !row.endsRaid).every(row => typeof row.success === 'string' && typeof row.failure === 'string'));
  }
  assert.ok(ids.size >= 12, `sampled ${ids.size} unique templates`);
  assert.deepEqual([...types].sort(), ['npc', 'resource', 'route', 'technical']);

  function simulate(seed, searchLimit) {
    const run = makeRun({ seed, venue: 'conference', difficulty: 'normal' });
    let searches = 0;
    const encounteredTypes = [];
    while (run.status === 'playing') {
      if (run.pendingLoot.length) {
        assert.equal(actProbabilityRaid(run, 'take:available').ok, true);
        continue;
      }
      if (run.event) {
        const choices = probabilityRaidView(run).event.actions
          .filter(action => !action.disabled && !action.endsRaid)
          .sort((a, b) => b.probability - a.probability);
        assert.ok(choices.length);
        assert.equal(actProbabilityRaid(run, choices[0].id).ok, true);
        continue;
      }
      if (searches >= searchLimit) break;
      assert.equal(actProbabilityRaid(run, 'search').ok, true);
      searches += 1;
      if (run.event) encounteredTypes.push(run.event.type);
    }
    while (run.status === 'playing' && run.pendingLoot.length) actProbabilityRaid(run, 'take:available');
    if (run.status === 'playing' && !run.event) actProbabilityRaid(run, 'extract');
    return { searches, result: run.result, encounteredTypes };
  }

  const summary = [];
  for (const searchLimit of [2, 4, 6]) {
    let withEvent = 0;
    let totalEvents = 0;
    let clean = 0;
    const typeCounts = { npc: 0, resource: 0, technical: 0, route: 0 };
    const sampleCount = 120;
    for (let seed = 20_000 + searchLimit * 1000; seed < 20_000 + searchLimit * 1000 + sampleCount; seed += 1) {
      const simulation = simulate(seed, searchLimit);
      if (simulation.encounteredTypes.length) withEvent += 1;
      totalEvents += simulation.encounteredTypes.length;
      for (const type of simulation.encounteredTypes) typeCounts[type] += 1;
      if (simulation.result?.kind === 'clean') clean += 1;
    }
    const row = {
      searches: searchLimit,
      encounterRate: Math.round(withEvent * 1000 / sampleCount) / 10,
      eventsPerRun: Math.round(totalEvents * 100 / sampleCount) / 100,
      cleanReturnRate: Math.round(clean * 1000 / sampleCount) / 10,
      typeCounts,
    };
    summary.push(row);
    assert.equal(row.encounterRate, 100, 'all completed first-two-search runs see at least one event');
    assert.ok(row.cleanReturnRate >= 0 && row.cleanReturnRate <= 100);
  }
  console.log('current short-run fixed-seed sample:', JSON.stringify(summary));
});

test('a finite supply restores will without changing risk, time, or equipment', () => {
  const run = makeRun({ supplies: ['coffee_ticket'], loadout: ['canvas_pack'] });
  run.stats.will = 4;
  run.stats.risk = 21;
  const beforeLoadout = [...run.loadout];
  assert.equal(probabilityRaidView(run).actions.find(action => action.id === 'use:0').disabled, false);
  assert.equal(actProbabilityRaid(run, 'use:0').ok, true);
  assert.equal(run.stats.will, 5);
  assert.equal(run.stats.risk, 21);
  assert.deepEqual(run.loadout, beforeLoadout);
  assert.deepEqual(run.bag, []);
});

test('v3 career deploy deducts venue fee and supplies but only references permanent equipment', () => {
  const career = createCareer(12);
  career.profile.funding = 200;
  career.profile.research.stage = 4;
  career.profile.network = 2;
  career.profile.supplies = ['coffee_ticket'];
  const gearCounts = Object.fromEntries(Object.values(career.profile.loadout).filter(Boolean).map(id => [id, career.profile.stash[id]]));
  const result = deployProbability(career, { seed: 55, venue: 'industry', difficulty: 'hard' });
  assert.equal(result.ok, true);
  assert.equal(career.profile.funding, 120);
  assert.equal(career.profile.stash.coffee_ticket, 1);
  assert.equal(career.profile.supplies.length, 0);
  assert.equal(career.run.mode, 'probability');
  assert.equal(career.run.probabilityVersion, 3);
  assert.equal(career.run.difficultyId, 'hard');
  assert.equal(career.run.targetId, undefined);
  assert.equal(career.run.strategyId, undefined);
  assert.equal(career.run.clock, undefined);
  assert.equal(career.run.npcs, undefined);
  assert.deepEqual(career.run.loadout, Object.values(career.profile.loadout).filter(Boolean));
  for (const [id, count] of Object.entries(gearCounts)) assert.equal(career.profile.stash[id], count);
  assert.equal(career.run.stats.network, 2);
  assert.deepEqual(careerView(career).probabilitySetup.venues.map(row => row.minStage), [0, 2, 4]);
  assert.ok(careerView(career).probabilitySetup.gearHints.citation_scanner.effects.length);
});

test('settlement applies only network delta, keeps equipment, never refunds fee, and grants one event result once', () => {
  const career = createCareer(13);
  career.profile.funding = 200;
  career.profile.research.stage = 4;
  career.profile.network = 2;
  career.profile.supplies = ['coffee_ticket'];
  const gearCounts = Object.fromEntries(Object.values(career.profile.loadout).filter(Boolean).map(id => [id, career.profile.stash[id]]));
  assert.equal(deployProbability(career, { seed: 15, venue: 'industry' }).ok, true);
  const run = career.run;
  run.stats.will = 8;
  run.event = { id: 'peer-collab', npcId: 'peer-zhou', name: '周同学', title: '合作边界协商',
    text: '确认合作边界。', type: 'npc', tone: 'opportunity', image: '/assets/generated/scholar.png', difficulty: 0,
    choices: [{ key: 'negotiate', name: '协商合作条件', cost: { network: 1 },
      onSuccess: { riskDelta: -2, rewardId: 'coop', trustDelta: 1, text: '合作边界已经确认。' } }] };
  run.eventCount = 1;
  run.usedEventIds.push('peer-collab');
  run.rngState = 1;
  assert.equal(actProbabilityRaid(run, 'use:0').ok, true);
  assert.equal(run.stats.will, 9);
  assert.equal(actProbabilityRaid(run, 'event:negotiate').ok, true);
  assert.equal(run.stats.network, 1);
  assert.equal(run.bag.includes('coop'), true);
  assert.equal(run.pendingLoot.length, 0);

  const exitProbs = probabilityRaidView(run).probabilities;
  run.rngState = seedForRange(exitProbs.fail + exitProbs.partial, 100);
  assert.equal(actProbabilityRaid(run, 'extract').ok, true);
  assert.equal(run.result.kind, 'clean');
  const fundingAfterDeparture = career.profile.funding;
  const ticketCountAfterDeparture = career.profile.stash.coffee_ticket;
  assert.equal(settle(career), true);
  assert.equal(career.profile.funding, fundingAfterDeparture);
  assert.equal(career.profile.stash.coffee_ticket, ticketCountAfterDeparture, 'used supply is not refunded');
  assert.equal(career.profile.network, 1);
  assert.equal(career.profile.contacts['peer-zhou'].trust, 1);
  assert.equal(career.profile.contacts['peer-zhou'].meetings, 1);
  assert.equal(career.profile.stash.coop, 1);
  for (const [id, count] of Object.entries(gearCounts)) assert.equal(career.profile.stash[id], count);
  assert.equal(career.profile.lastReport.loadoutLost, 0);
  assert.equal(career.profile.research.skills.expression, 1);
  assert.equal(settle(career), false);
  assert.equal(career.profile.network, 1);
  assert.equal(career.profile.stash.coop, 1);
});

test('v3 deployment rejects stale target/strategy fields and invalid difficulty without mutating career state', () => {
  for (const stale of [{ target: null }, { strategy: null }, { target: 'dataset', strategy: 'balanced' }]) {
    const career = createCareer(61);
    const before = JSON.stringify(career);
    const result = deployProbability(career, { seed: 3, ...stale });
    assert.equal(result.ok, false);
    assert.match(result.reason, /改为选择难度.*刷新/);
    assert.equal(JSON.stringify(career), before);
  }
  for (const difficulty of [null, 3, {}, 'nightmare']) {
    const career = createCareer(62);
    const before = JSON.stringify(career);
    const result = deployProbability(career, { seed: 3, difficulty });
    assert.equal(result.ok, false);
    assert.match(result.reason, /难度无效/);
    assert.equal(JSON.stringify(career), before);
  }
});

test('failed probability raid returns all permanent gear and only protected material, without funding refund', () => {
  const career = createCareer(14);
  career.profile.funding = 99;
  career.profile.loadout.storage = 'backup_device';
  career.profile.stash.backup_device = 1;
  const ids = Object.values(career.profile.loadout).filter(Boolean);
  const countsBefore = Object.fromEntries(ids.map(id => [id, career.profile.stash[id]]));
  const run = createProbabilityRaid({ seed: 1, raidId: 'raid-fail', venue: 'industry', loadout: ids,
    network: career.profile.network, skills: { engineering: 1, research: 1, expression: 1 } });
  run.bag = ['dataset', 'src_code'];
  run.protectedIndex = 0;
  run.stats.risk = 100;
  run.initialNetwork = career.profile.network;
  career.run = run;
  assert.equal(actProbabilityRaid(run, 'extract').ok, true);
  assert.equal(run.result.kind, 'scatter');
  assert.equal(settle(career), true);
  assert.equal(career.profile.funding, 99);
  assert.equal(career.profile.stash.dataset, 1);
  assert.equal(career.profile.stash.src_code, undefined);
  for (const [id, count] of Object.entries(countsBefore)) assert.equal(career.profile.stash[id], count);
  assert.equal(career.profile.loadout.storage, 'backup_device');
  assert.equal(career.profile.lastReport.loadoutLost, 0);
});

test('current probability save restore keeps RNG and step exact without a realtime clock or NPCs', () => {
  const career = createCareer(16);
  career.profile.research.stage = 4;
  assert.equal(deployProbability(career, { seed: 1234, venue: 'industry' }).ok, true);
  const restored = migrateCareer(JSON.stringify(career));
  assert.equal(restored.run.mode, 'probability');
  assert.equal(restored.run.clock, undefined);
  assert.equal(restored.run.npcs, undefined);
  assert.equal(actProbabilityRaid(career.run, 'search').ok, true);
  assert.equal(actProbabilityRaid(restored.run, 'search').ok, true);
  assert.deepEqual(probabilityRaidView(restored.run), probabilityRaidView(career.run));
  assert.equal(restored.run.rngState, career.run.rngState);

});
