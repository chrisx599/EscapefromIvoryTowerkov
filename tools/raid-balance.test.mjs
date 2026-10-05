import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { raidDiminishingSkill, raidSearchProbability, raidRiskAfterSearch,
  raidExtractionProbabilities, raidEventProbability, raidExtraDropChance } from '../src/raid-balance.js';
import * as raid from '../src/probability-raid.js';
import { skillLevels } from '../src/research.js';

const { createProbabilityRaid, probabilityRaidView, actProbabilityRaid } = raid;
const base = { difficulty: 'normal', research: 1, engineering: 1, expression: 1,
  risk: 0, depth: 0, searches: 0, will: 10, willMax: 10, load: 0, capacity: 6,
  venueDifficulty: 0, venueMinStage: 0, venueBaseRisk: 5, venueGrowth: 8, stage: 0 };
const percent = seed => {
  let value = seed >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return (value >>> 0) / 4294967296 * 100;
};
const seedBetween = (low, high) => {
  for (let seed = 1; seed < 100000; seed++) if (percent(seed) >= low && percent(seed) < high) return seed;
  throw new Error('No seed in requested interval');
};
const checked = (run, action) => {
  const result = actProbabilityRaid(run, action);
  assert.equal(result.ok, true, result.reason);
  return result;
};

test('new raids persist v4 and preview the same stage, skills and equipment rules', () => {
  const profile = { research: { stage: 4, skills: { engineering: 9, research: 9, expression: 9 } },
    loadout: { device: 'gpu_workstation' } };
  const setup = raid.probabilitySetup(profile);
  const newRun = createProbabilityRaid({ stage: 4, venue: 'industry', skills: skillLevels(profile.research),
    loadout: ['gpu_workstation'] });
  assert.equal(newRun.probabilityVersion, 4);
  assert.equal(newRun.stage, 4);
  const preview = setup.venues.find(row => row.id === 'industry').difficultyPreviews.find(row => row.difficultyId === 'normal');
  assert.equal(preview.acquisition, probabilityRaidView(newRun).probabilities.acquisition);
  assert.equal(probabilityRaidView(newRun).probabilityVersion, 4);
  assert.equal(createProbabilityRaid({ probabilityVersion: 3 }).probabilityVersion, 4, 'clients cannot opt back into easier retired rules');
});

test('skill gains diminish at every tier; same-venue novice and expert remain uncertain', () => {
  const increments = [];
  for (let level = 2; level <= 10; level++) {
    increments.push(raidDiminishingSkill(level, 24) - raidDiminishingSkill(level - 1, 24));
  }
  for (let i = 1; i < increments.length; i++) assert.ok(increments[i] > 0 && increments[i] < increments[i - 1]);
  assert.equal(raidSearchProbability(base).chance, 56);
  assert.equal(raidSearchProbability({ ...base, research: 4 }).chance, 68);
  assert.equal(raidSearchProbability({ ...base, research: 10 }).chance, 74);
  assert.equal(raidSearchProbability({ ...base, research: 999 }).chance, 74);
  assert.equal(raidSearchProbability({ ...base, research: -999 }).chance, 56);
});

test('difficulty reduces acquisition and event success while increasing actual exposure and extraction risk', () => {
  const rows = ['easy', 'normal', 'hard'].map(difficulty => {
    const input = { ...base, difficulty, risk: 25, depth: 1, searches: 3 };
    return { search: raidSearchProbability(input).chance, risk: raidRiskAfterSearch(input),
      exit: raidExtractionProbabilities(input), extra: raidExtraDropChance({ ...input, baseExtraDrop: 25 }),
      event: raidEventProbability({ ...input, base: 60, neutral: true, hasSkill: true, skillLevel: 4 }) };
  });
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].search < rows[i - 1].search);
    assert.ok(rows[i].event < rows[i - 1].event);
    assert.ok(rows[i].risk > rows[i - 1].risk);
    assert.ok(rows[i].exit.fail > rows[i - 1].exit.fail);
    assert.ok(rows[i].exit.full < rows[i - 1].exit.full);
  }
  assert.equal(rows[2].extra, 43, 'a larger conditional second drop does not reverse harder acquisition');
});

test('depth, duration, danger, fatigue and load have monotonic consequences', () => {
  const neutral = { ...base, risk: 25, depth: 1, searches: 3 };
  const event = input => raidEventProbability({ ...input, base: 60, neutral: true, hasSkill: true, skillLevel: 4 });
  for (const change of [{ risk: 70 }, { depth: 3 }, { searches: 8 }, { will: 1 }, { load: 6 }]) {
    const harder = { ...neutral, ...change };
    assert.ok(raidSearchProbability(harder).chance < raidSearchProbability(neutral).chance, JSON.stringify(change));
    assert.ok(raidExtractionProbabilities(harder).fail > raidExtractionProbabilities(neutral).fail, JSON.stringify(change));
    if (!Object.hasOwn(change, 'searches')) assert.ok(event(harder) < event(neutral), JSON.stringify(change));
  }
  assert.ok(raidSearchProbability({ ...neutral, contextAcquisition: 8 }).chance > raidSearchProbability(neutral).chance);
  assert.ok(raidExtractionProbabilities({ ...neutral, contextFail: -2 }).fail < raidExtractionProbabilities(neutral).fail);
  assert.ok(event({ ...neutral, contextCheck: 5 }) > event(neutral));
});

test('equipment tiers, stage familiarity and preparation help without immunity', () => {
  const tiers = [[], ['lightweight_laptop'], ['gpu_workstation'], ['remote_terminal']].map(loadout =>
    probabilityRaidView(createProbabilityRaid({ loadout })).probabilities);
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(tiers[i].acquisition > tiers[i - 1].acquisition);
    assert.ok(tiers[i].materials.find(row => row.id === 'compute').conditionalProbability
      > tiers[i - 1].materials.find(row => row.id === 'compute').conditionalProbability);
  }
  const visit = { ...base, venueDifficulty: 8, venueMinStage: 2 };
  assert.equal(raidSearchProbability({ ...visit, stage: 2 }).chance - raidSearchProbability(visit).chance, 1);
  const pressure = { ...base, risk: 75, depth: 3, searches: 7, will: 2, load: 6 };
  const prepared = { ...pressure, engineering: 10, expression: 10, storageBonus: 3, support: 8 };
  assert.ok(raidExtractionProbabilities(prepared).fail < raidExtractionProbabilities(pressure).fail);
  assert.ok(raidExtractionProbabilities(prepared).fail > 20);
  assert.ok(raidExtractionProbabilities(prepared).partial < raidExtractionProbabilities(pressure).partial);
  const event = { ...pressure, base: 60, neutral: true, hasSkill: true, skillLevel: 4 };
  assert.equal(raidEventProbability({ ...event, evidenceBonus: 3 }) - raidEventProbability(event), 3);
  assert.equal(raidEventProbability({ ...event, gearBonus: 5 }) - raidEventProbability(event), 5);
});

test('normal one-search retreat is risky but long overextension is materially worse', () => {
  const run = createProbabilityRaid({ seed: 33332 });
  run.encounterCooldown = true;
  checked(run, 'search');
  assert.equal(run.expedition.depth, 0.5, 'ordinary UI searches now accumulate distance');
  const quick = probabilityRaidView(run).probabilities;
  assert.ok(quick.fail >= 6 && quick.fail <= 10);
  const late = raidExtractionProbabilities({ ...base, risk: 80, depth: 4, searches: 8, will: 1, load: 6 });
  assert.ok(late.fail >= quick.fail + 20 && late.fail <= 42);
  assert.ok(late.full >= 22);
});

test('search and event thresholds control real seeded outcomes; views do not roll', () => {
  const seed = seedBetween(58, 59);
  const plain = createProbabilityRaid({ seed });
  const geared = createProbabilityRaid({ seed, loadout: ['remote_terminal'] });
  for (const run of [plain, geared]) {
    run.encounterCooldown = true;
    const before = structuredClone(run);
    for (let i = 0; i < 4; i++) probabilityRaidView(run);
    assert.deepEqual(run, before);
  }
  assert.equal(checked(plain, 'search').found, false);
  assert.equal(checked(geared, 'search').found, true);

  const eventSeed = seedBetween(51, 52);
  const resolve = skills => {
    const run = createProbabilityRaid({ seed: eventSeed, skills, surprise: true });
    run.event = { id: 'balance-check', type: 'technical', encounterVersion: 2, name: '终端', prompt: '屏幕亮了。',
      choices: [{ key: 'inspect', name: '看看记录', cost: {},
        check: { base: 55, skill: 'engineering', perLevel: 1.5, cap: 10, riskFactor: 0.03 },
        onSuccess: { rewardId: 'compute', text: '恢复了。' }, onFailure: { willDelta: -1, text: '停住了。' } }] };
    const before = structuredClone(run);
    assert.equal(probabilityRaidView(run).event.actions[0].probability, undefined, 'neutral choices do not reveal odds');
    assert.deepEqual(run, before);
    const result = checked(run, 'event:inspect');
    const after = structuredClone(run);
    assert.equal(actProbabilityRaid(run, 'event:inspect').ok, false);
    assert.deepEqual(run, after, 'repeated event action cannot reroll or reward twice');
    return result.eventSuccess;
  };
  assert.equal(resolve({ engineering: 1 }), false);
  assert.equal(resolve({ engineering: 10 }), true);
});

test('selected difficulty and relevant packed evidence affect the actual neutral roll', () => {
  const seed = seedBetween(52, 53);
  const searchResults = ['easy', 'normal', 'hard'].map(difficulty => {
    const run = createProbabilityRaid({ seed, difficulty });
    run.encounterCooldown = true;
    return checked(run, 'search').found;
  });
  assert.deepEqual(searchResults, [true, true, false]);
  const resolve = ({ bag = [], loadout = [], difficulty = 'normal' } = {}) => {
    const run = createProbabilityRaid({ seed, loadout, difficulty, surprise: true });
    run.bag = [...bag];
    run.event = { id: 'prepared-resource', type: 'resource', encounterVersion: 2, name: '样本台', prompt: '目录摊开了。',
      choices: [{ key: 'inspect', name: '看看目录', cost: {},
        check: { base: 55, skill: 'research', gear: 'evidence' },
        onSuccess: { rewardId: 'wind', text: '找到了。' }, onFailure: { willDelta: -1, text: '没有找到。' } }] };
    return checked(run, 'event:inspect').eventSuccess;
  };
  assert.equal(resolve(), false);
  assert.equal(resolve({ bag: ['dataset'] }), true, 'relevant carried material contributes preparation');
  assert.equal(resolve({ bag: ['wind'] }), false, 'unrelated material does not provide a universal bonus');
  assert.equal(resolve({ loadout: ['digital_notebook'] }), true, 'equipment changes the resolved check');
  assert.equal(resolve({ difficulty: 'easy' }), true);
  assert.equal(resolve({ difficulty: 'hard', bag: ['dataset'], loadout: ['digital_notebook'] }), false);
});

test('v4 formulas stay finite, bounded and normalized across extreme profiles', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) for (const level of [1, 4, 10, Infinity])
  for (const risk of [0, 35, 70, 100, Infinity]) for (const depth of [0, 2, 4])
  for (const load of [0, 6, 900]) for (const will of [0, 2, 10]) {
    const input = { ...base, difficulty, research: level, engineering: level, expression: level,
      risk, depth, load, will, searches: 12, searchGear: 999, storageBonus: 999, support: 999,
      contextAcquisition: 999, contextFail: -999, contextPartial: -999 };
    const acquisition = raidSearchProbability(input).chance;
    const extra = raidExtraDropChance({ ...input, baseExtraDrop: 999 });
    const exit = raidExtractionProbabilities(input);
    const event = raidEventProbability({ ...input, base: 99, neutral: true, hasSkill: true, skillLevel: level, evidenceBonus: 999, gearBonus: 999 });
    for (const value of [acquisition, extra, exit.full, exit.partial, exit.fail, event, raidRiskAfterSearch(input)]) assert.ok(Number.isFinite(value));
    assert.ok(acquisition >= 12 && acquisition <= 84);
    assert.ok(extra >= 0 && extra <= 75);
    assert.ok(exit.fail >= 3 && exit.fail <= 42);
    assert.ok(exit.partial >= 6 && exit.partial <= 36);
    assert.ok(exit.full >= 22);
    assert.ok(Math.abs(exit.full + exit.partial + exit.fail - 100) < 1e-9);
    assert.ok(event >= 18 && event <= 88);
  }
});

function legacyTranscript() {
  const all = [];
  for (const surprise of [false, true]) for (const seed of [1, 14221, 948321]) for (const difficulty of ['easy', 'normal', 'hard']) {
    const run = createProbabilityRaid({ seed, venue: 'visit', difficulty, surprise,
      skills: { research: 6, engineering: 5, expression: 4 }, stories: {},
      loadout: ['custom_lab_pack', 'literature_assistant', 'citation_scanner', 'remote_terminal', 'encrypted_ssd'],
      supplies: ['coffee_ticket'], network: 2 });
    run.probabilityVersion = 3;
    delete run.stage;
    const frames = [];
    for (let i = 0; i < 24 && run.status === 'playing'; i++) {
      const view = probabilityRaidView(run);
      const actions = view.actions.filter(row => !row.disabled);
      const action = run.event ? (actions.find(row => row.id.startsWith('event:') && row.id !== 'event:leave')?.id || 'event:leave')
        : run.pendingLoot.length ? 'take:available' : i >= 12 ? 'extract' : ['search', 'search:deep', 'search:cautious'][i % 3];
      frames.push({ view, action, result: actProbabilityRaid(run, action) });
    }
    all.push({ frames, run });
  }
  return createHash('sha256').update(JSON.stringify(all)).digest('hex');
}

test('active v3 raids reproduce the baseline full action/view/RNG transcript exactly', () => {
  // Generated against immutable baseline10541b7, for both old explicit choices
  // and saved neutral encounters. Includes context transitions and extraction.
  assert.equal(legacyTranscript(), '8712d7de1d7d6cfcd31977ddcc9379082a5e36bc6006cf405573a109d3ad5e29');
});

test('saved neutral events keep their generated rules and replay deterministically across versions', () => {
  for (const version of [3, 4]) {
    const run = createProbabilityRaid({ seed: 194283, surprise: true, stories: {}, network: 2 });
    run.probabilityVersion = version;
    for (let i = 0; i < 2 && !run.event; i++) {
      checked(run, 'search');
      if (run.pendingLoot.length) checked(run, 'take:available');
    }
    assert.ok(run.event);
    const saved = JSON.stringify(run);
    for (let i = 0; i < 3; i++) probabilityRaidView(run);
    assert.equal(JSON.stringify(run), saved);
    const restored = JSON.parse(saved);
    const choice = probabilityRaidView(run).event.actions.find(row => !row.disabled && !row.endsRaid).id;
    assert.deepEqual(checked(run, choice), checked(restored, choice));
    assert.deepEqual(run, restored);
    assert.equal(run.probabilityVersion, version);
  }
});
