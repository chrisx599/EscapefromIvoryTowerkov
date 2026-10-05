import assert from 'node:assert/strict';
import test from 'node:test';
import { createCareer, careerView, deployProbability, hubAct, migrateCareer, settle } from '../src/career.js';
import { actProbabilityRaid, createProbabilityRaid, probabilityRaidView } from '../src/probability-raid.js';
import { PROJECTS, STAGES } from '../src/research.js';
import { ACADEMIC_STORY_IDS, academicStoryCandidates, normalizeStories } from '../src/academic-stories.js';
import { finishPaper } from './research-qa.mjs';

const TALENTS = ['archivist', 'connector', 'tinkerer'];
const checkedHub = (career, action) => {
  const result = hubAct(career, action);
  assert.equal(result.ok, true, `${action}: ${result.reason || ''}`);
  return result;
};
const checkedRaid = (run, action) => {
  const result = actProbabilityRaid(run, action);
  assert.equal(result.ok, true, `${action}: ${result.reason || ''}`);
  return result;
};

/** Earn a paper using only available funds, purchases, and public game actions. */
function earnPaper(career, type = 'replicate') {
  let actions = 0;
  let bought = 0;
  const act = action => { actions += 1; return checkedHub(career, action); };
  for (const [id, required] of Object.entries(PROJECTS[type].materials)) {
    while ((career.profile.stash[id] || 0) < required) { act(`buy:${id}`); bought += 1; }
  }
  const progress = finishPaper(career.profile, { start: type,
    act: id => { actions += 1; return hubAct(career, `research:${id}`); },
    onExperiment: project => {
      const needed = project.balanceVersion >= 2 ? (project.runs >= 5 ? 0 : 1) : 1 + project.scope;
      while ((career.profile.stash.compute || 0) < needed) { act('buy:compute'); bought += 1; }
    } });
  return { actions, runs: progress.runs, bought, returns: progress.returns };
}

/** A modest new player's outing: four cautious searches, no synthetic rewards. */
function playStarterRaid(career, seed, events = new Set()) {
  checkedDeployment(career, { seed, difficulty: 'easy' });
  let actions = 0;
  let searches = 0;
  while (career.run.status === 'playing') {
    assert.ok(actions < 40, 'an outing must have a reachable terminal state');
    const view = probabilityRaidView(career.run);
    let action;
    if (view.pendingLoot.length) action = 'take:available';
    else if (view.event) {
      events.add(view.event.id);
      action = view.event.actions.filter(row => !row.disabled && !row.endsRaid)
        .sort((a, b) => Number(b.probability) - Number(a.probability))[0]?.id || 'event:leave';
    } else if (searches >= 4 || view.stats.will < 3) action = 'extract';
    else { action = 'search:cautious'; searches += 1; }
    checkedRaid(career.run, action);
    actions += 1;
  }
  assert.equal(settle(career), true);
  return { actions, searches, kind: career.run.result.kind };
}

function checkedDeployment(career, options) {
  const result = deployProbability(career, options);
  assert.equal(result.ok, true, result.reason);
  return career.run;
}

test('512 genuine first-paper paths earn probabilistic promotion review from the starter budget across all identity backgrounds', t => {
  const metrics = { careers: 0, minRuns: Infinity, maxRuns: 0, minFundingBeforePromotion: Infinity, maxActions: 0 };
  const backgrounds = new Set();
  for (let seed = 1; seed <= 256; seed += 1) {
    for (const type of ['replicate', 'evaluate']) {
      const career = createCareer(seed * 7919);
      const progress = earnPaper(career, type);
      const prePromotionFunding = career.profile.funding;
      const accepted = structuredClone(career.profile.research.papers);
      assert.equal(accepted.length, 1);
      assert.ok(prePromotionFunding >= 90, `seed ${seed}/${type}: first paper should retain one basic experiment of funding before the title grant`);
      const promotion = careerView(career).research.actions.find(row => row.id === 'research:promote');
      assert.equal(promotion.disabled, false, promotion.reason);
      const review = checkedHub(career, 'research:promote');
      assert.equal(career.profile.research.stage, Number(review.promoted));
      assert.deepEqual(career.profile.research.papers, accepted, 'promotion must preserve the earned paper');
      assert.equal(career.profile.funding, prePromotionFunding + (review.promoted ? 180 : 0), 'only an awarded title grants funding');
      const promoted = JSON.stringify(career);
      assert.equal(hubAct(career, 'research:promote').ok, false, 'one paper does not permit claiming a second promotion');
      assert.equal(JSON.stringify(career), promoted);
      backgrounds.add(`${career.profile.identity.school.name}/${career.profile.identity.trait.id}`);
      metrics.careers += 1;
      metrics.minRuns = Math.min(metrics.minRuns, progress.runs);
      metrics.maxRuns = Math.max(metrics.maxRuns, progress.runs);
      metrics.minFundingBeforePromotion = Math.min(metrics.minFundingBeforePromotion, prePromotionFunding);
      metrics.maxActions = Math.max(metrics.maxActions, progress.actions + 1); // Promotion is the only step after publication.
    }
  }
  assert.equal(backgrounds.size, 12, 'cover every school/personality combination');
  assert.ok(metrics.maxRuns <= 7, 'seeded setbacks must have a short finite recovery');
  assert.ok(metrics.maxActions <= 35);
  t.diagnostic(JSON.stringify(metrics));
});

test('128 starter outings lead to a real first paper even after imperfect extraction', t => {
  const events = new Set();
  const metrics = { careers: 0, clean: 0, messy: 0, scatter: 0, minFundingBeforePromotion: Infinity, maxActions: 0 };
  for (let seed = 1; seed <= 128; seed += 1) {
    const career = createCareer(seed * 7919);
    const outing = playStarterRaid(career, seed * 7919, events);
    const persisted = migrateCareer(JSON.stringify(career));
    assert.deepEqual(persisted.profile.stash, career.profile.stash);
    assert.deepEqual(persisted.profile.research, career.profile.research);
    const beforeRepeatedSettlement = JSON.stringify(persisted.profile);
    assert.equal(settle(persisted), false);
    assert.equal(JSON.stringify(persisted.profile), beforeRepeatedSettlement);
    const paper = earnPaper(persisted);
    const funds = persisted.profile.funding;
    const review = checkedHub(persisted, 'research:promote');
    assert.equal(persisted.profile.research.stage, Number(review.promoted));
    assert.equal(persisted.profile.funding, funds + (review.promoted ? 180 : 0));
    assert.ok(funds >= 90, `seed ${seed}: a short opening expedition must not make promotion unaffordable`);
    metrics.careers += 1;
    metrics[outing.kind] += 1;
    metrics.minFundingBeforePromotion = Math.min(metrics.minFundingBeforePromotion, funds);
    metrics.maxActions = Math.max(metrics.maxActions, outing.actions + paper.actions + 1);
  }
  assert.ok(metrics.clean + metrics.messy >= 110, 'new-player short outings should usually bring discoveries home');
  assert.ok(events.size >= 3, 'opening seeds must not all show one story');
  assert.ok(metrics.maxActions <= 45, 'the short expedition → paper → promotion loop should not require grinding');
  t.diagnostic(JSON.stringify({ ...metrics, distinctOpeningEvents: events.size }));
});

test('a successful promotion review grants an earned title with no faction choice, durable and guarded during raids', () => {
  const career = createCareer(7919);
  earnPaper(career);
  career.profile.research.rng = 1; // Controlled passing draw for post-promotion guard regressions.
  checkedHub(career, 'research:promote');
  assert.equal(career.profile.research.stage, 1);
  for (const talent of [...TALENTS, '__proto__', 'constructor', 'missing']) {
    const before = JSON.stringify(career);
    assert.equal(hubAct(career, `research:talent:${talent}`).ok, false);
    assert.equal(JSON.stringify(career), before, 'retired choices cannot grant rewards or alter progress');
  }
  assert.equal(migrateCareer(JSON.stringify(career)).profile.research.talent, null);
  const funding = career.profile.funding;
  checkedDeployment(career, { seed: 10000, difficulty: 'easy' });
  assert.equal(career.run.talent, null);
  const deployed = JSON.stringify(career);
  assert.equal(hubAct(career, 'research:milestone:ack').ok, false);
  assert.equal(hubAct(career, 'research:promote').ok, false);
  assert.equal(JSON.stringify(career), deployed, 'hub title actions cannot change a live expedition');
  checkedRaid(career.run, 'extract');
  assert.equal(settle(career), true);
  assert.equal(career.profile.funding, funding);
  assert.equal(migrateCareer(JSON.stringify(career)).profile.research.stage, 1);
});

test('old promoted saves preserve earned assets without retroactive grants or forged talent ranks', () => {
  for (let stage = 0; stage < STAGES.length; stage += 1) {
    const career = createCareer(stage + 123);
    career.profile.research.stage = stage;
    career.profile.funding = 1234;
    delete career.profile.research.rewardedStage;
    delete career.profile.research.lastMilestone;
    delete career.profile.research.talent;
    const restored = migrateCareer(JSON.stringify(career));
    assert.equal(restored.profile.funding, 1234);
    assert.equal(restored.profile.research.stage, stage);
    assert.equal(restored.profile.research.rewardedStage, stage);
    assert.equal(restored.profile.research.talent, null);
    assert.equal(restored.profile.research.lastMilestone, null);
    for (let reload = 0; reload < 3; reload += 1) {
      const again = migrateCareer(JSON.stringify(restored));
      assert.equal(again.profile.funding, 1234);
      assert.deepEqual(again.profile.research, restored.profile.research);
    }
    career.profile.research.talent = { id: 'archivist', rank: 999 };
    const converted = migrateCareer(JSON.stringify(career)).profile.research;
    assert.equal(converted.talent, null);
    assert.equal(converted.legacySupport.initialQuality, stage === 0 ? 0 : 3 * (stage >= 6 ? 3 : stage >= 3 ? 2 : 1));
  }
});

const settlePendingLoot = run => {
  if (run.pendingLoot.length) checkedRaid(run, 'take:available');
};

function reachFirstStory(career, seed) {
  checkedDeployment(career, { seed, difficulty: 'easy' });
  for (let search = 0; search < 2 && !career.run.event; search += 1) {
    checkedRaid(career.run, 'search:cautious');
    settlePendingLoot(career.run);
  }
  assert.ok(career.run.event?.story, 'new careers encounter an authored story by their second search');
  return career.run.event;
}

function availableBranch(run) {
  return probabilityRaidView(run).event.actions.find(row => !row.disabled && !row.endsRaid && row.id !== 'event:story-decline');
}

function reachCallback(run) {
  settlePendingLoot(run);
  checkedRaid(run, 'search:cautious');
  settlePendingLoot(run);
  assert.equal(run.event, null, 'the one-search event cooldown remains real');
  checkedRaid(run, 'search:cautious');
  settlePendingLoot(run);
  assert.equal(run.event?.story?.chapter, 2, 'the next eligible search must continue the earlier choice');
  return run.event;
}

test('96 naturally generated story choices survive every interruption, affect the callback, and settle exactly once', t => {
  const stories = new Set();
  const outcomes = new Set();
  for (let seed = 1; seed <= 96; seed += 1) {
    let career = createCareer(seed * 7919);
    const setup = reachFirstStory(career, seed * 7919);
    const id = setup.story.id;
    stories.add(id);
    const beforeRead = JSON.stringify(career);
    for (let read = 0; read < 4; read += 1) { careerView(career); probabilityRaidView(career.run); }
    assert.equal(JSON.stringify(career), beforeRead, 'story prose and previews do not commit a choice or reroll');
    assert.deepEqual(migrateCareer(JSON.stringify(career)).run, career.run, 'opening story survives a saved-game reload');
    const choice = availableBranch(career.run);
    assert.ok(choice);
    checkedRaid(career.run, choice.id);
    const branch = career.run.stories.chains[id].branch;
    assert.ok(branch);
    const chosen = structuredClone(career.run);
    career = migrateCareer(JSON.stringify(career));
    assert.deepEqual(career.run, chosen);
    const callback = reachCallback(career.run);
    assert.equal(callback.story.id, id);
    assert.ok(callback.story.priorChoice);
    const callbackSave = JSON.stringify(career);
    const resumed = migrateCareer(callbackSave);
    assert.deepEqual(resumed.run, career.run);
    const finish = availableBranch(career.run);
    assert.ok(finish);
    checkedRaid(career.run, finish.id);
    checkedRaid(resumed.run, finish.id);
    assert.deepEqual(resumed.run, career.run, 'a resumed callback resolves with exactly the original random sequence');
    assert.equal(career.run.stories.chains[id].chapter, 2);
    assert.equal(career.run.stories.chains[id].branch, branch, 'the ending preserves the first choice');
    outcomes.add(`${id}:${career.run.stories.chains[id].outcome}`);
    settlePendingLoot(career.run);
    const finalStories = structuredClone(career.run.stories);
    // Exercise unsuccessful extraction too: story memory is not physical loot.
    if (seed % 2 === 0) { career.run.rngState = 1; career.run.stats.risk = 100; }
    checkedRaid(career.run, 'extract');
    if (seed % 2 === 0) assert.equal(career.run.result.kind, 'scatter');
    assert.equal(settle(career), true);
    assert.deepEqual(career.profile.stories, finalStories);
    const settled = structuredClone(career.profile);
    assert.equal(settle(career), false);
    assert.deepEqual(career.profile, settled);
    career = migrateCareer(JSON.stringify(career));
    career.run.settled = false; // A stale flag must not defeat the durable raid receipt.
    assert.equal(settle(career), false);
    assert.deepEqual(career.profile, settled);
    checkedDeployment(career, { seed: seed * 7919 + 1, difficulty: 'easy' });
    assert.deepEqual(career.run.stories, finalStories);
    assert.ok(academicStoryCandidates(career.run).every(row => row.story.id !== id), 'completed chains cannot be farmed next raid');
  }
  assert.deepEqual([...stories].sort(), [...ACADEMIC_STORY_IDS].sort());
  assert.ok(outcomes.size >= 4, 'natural starting inventory makes a meaningful difference to reachable branches');
  t.diagnostic(JSON.stringify({ naturalStorySeeds: 96, storyFamilies: stories.size, outcomes: [...outcomes].sort() }));
});

test('leaving an unresolved callback defers the exact prior branch into a later expedition', () => {
  const covered = new Set();
  for (let seed = 1; seed <= 120 && covered.size < ACADEMIC_STORY_IDS.length; seed += 1) {
    let career = createCareer(seed * 7919);
    const opening = reachFirstStory(career, seed * 7919);
    const id = opening.story.id;
    if (covered.has(id)) continue;
    checkedRaid(career.run, availableBranch(career.run).id);
    reachCallback(career.run);
    const callbackText = career.run.event.text;
    const prior = structuredClone(career.run.stories.chains[id]);
    checkedRaid(career.run, 'event:leave');
    assert.equal(career.run.status, 'ended');
    assert.equal(settle(career), true);
    assert.deepEqual(career.profile.stories.chains[id], prior);
    career = migrateCareer(JSON.stringify(career));
    const callback = reachFirstStory(career, seed * 7919 + 1);
    assert.equal(callback.story.id, id);
    assert.equal(callback.story.chapter, 2);
    assert.equal(callback.text, callbackText);
    assert.deepEqual(career.run.stories.chains[id], prior);
    covered.add(id);
  }
  assert.equal(covered.size, ACADEMIC_STORY_IDS.length);
});

function isolatedStoryRun(id, talent = null) {
  const stories = normalizeStories();
  for (const other of ACADEMIC_STORY_IDS.filter(other => other !== id)) {
    stories.chains[other] = { chapter: 2, branch: null, outcome: 'declined' };
  }
  const run = createProbabilityRaid({ seed: 1029384756, stories, talent, network: 2, difficulty: 'easy' });
  run.bag = ['dataset', 'wind', 'coffee_ticket'];
  run.stats.risk = 20;
  run.expedition.depth = 2;
  run.event = academicStoryCandidates(run)[0];
  return run;
}

test('authored story choices produce different real costs, rewards and return risks rather than cosmetic endings', t => {
  const differences = {};
  for (const id of ACADEMIC_STORY_IDS) {
    const signatures = new Set();
    const endings = new Set();
    for (const talent of [null, { id: 'connector', rank: 1 }]) {
      const initial = isolatedStoryRun(id, talent);
      for (const setup of probabilityRaidView(initial).event.actions.filter(row => !row.disabled && !row.endsRaid && row.id !== 'event:story-decline')) {
        const branched = structuredClone(initial);
        checkedRaid(branched, setup.id);
        branched.event = academicStoryCandidates(branched)[0];
        assert.equal(branched.event.story.chapter, 2);
        for (const finish of probabilityRaidView(branched).event.actions.filter(row => !row.disabled && !row.endsRaid && row.id !== 'event:story-decline')) {
          const completed = structuredClone(branched);
          checkedRaid(completed, finish.id);
          signatures.add(JSON.stringify({ bag: completed.bag, stats: completed.stats, support: completed.support, depth: completed.expedition.depth }));
          endings.add(completed.stories.chains[id].outcome);
        }
      }
    }
    assert.ok(signatures.size >= 3, `${id} should present at least three mechanically different outcomes`);
    assert.ok(endings.size >= 3, `${id} should have distinct consequences to remember`);
    differences[id] = { mechanicalOutcomes: signatures.size, rememberedEndings: endings.size };
  }
  t.diagnostic(JSON.stringify(differences));
});

test('a zero-network connector retains an affordable normal story path', () => {
  for (const id of ACADEMIC_STORY_IDS) {
    const run = isolatedStoryRun(id, { id: 'connector', rank: 1 });
    run.bag = [];
    run.stats.network = 0;
    const choices = probabilityRaidView(run).event.actions;
    assert.ok(choices.some(row => !row.disabled && !row.endsRaid && !['event:story-decline', 'event:talent-negotiate'].includes(row.id)),
      `${id}: choosing a permanent talent must not remove an affordable ordinary branch`);
  }
});

test('all three legacy active raids preserve used budgets and consequences, while later raids have no faction ability', () => {
  for (const id of TALENTS) {
    let career = createCareer(7919);
    earnPaper(career);
    checkedHub(career, 'research:promote');
    // This serialized run models an already-started v5 expedition. New careers
    // cannot select or deploy with a faction; only its saved consequences persist.
    career.profile.research.talent = { id, rank: 1 };
    career.run = createProbabilityRaid({ seed: 7919, difficulty: 'easy', talent: { id, rank: 1 } });
    career = migrateCareer(JSON.stringify(career));
    assert.deepEqual(career.run.talent, { id, rank: 1 });
    assert.equal(career.profile.research.talent, null);
    // Isolate an eligible ability state. Promotion and deployment above are real.
    career.run.bag = ['dataset', 'src_code', 'wind'];
    career.run.stats.network = 2;
    const ordinaryEvent = { id: 'talent-budget-npc', type: 'npc', name: '同学', title: '合作边界', text: '商议合作。', choices: [] };
    if (id === 'connector') career.run.event = structuredClone(ordinaryEvent);
    const command = id === 'connector' ? 'event:talent-negotiate' : `talent:${id === 'archivist' ? 'archive' : 'convert'}:0`;
    const rng = career.run.rngState;
    checkedRaid(career.run, command);
    assert.equal(career.run.talentState.used, true);
    assert.equal(career.run.rngState, rng, 'deterministic talent actions must not change the random sequence');
    if (id === 'archivist') assert.equal(career.run.talentState.protectedIndex, 0);
    if (id === 'connector') assert.equal(career.run.stats.network, 1);
    if (id === 'tinkerer') {
      assert.deepEqual(career.run.bag, ['src_code', 'wind', 'compute']);
      assert.equal(career.run.bag.length, 3, 'conversion consumes its input rather than minting extra items');
    }
    const save = structuredClone(career.run);
    career = migrateCareer(JSON.stringify(career));
    assert.deepEqual(career.run, save);
    if (id === 'connector') career.run.event = structuredClone(ordinaryEvent);
    const spent = JSON.stringify(career.run);
    for (let retry = 0; retry < 3; retry += 1) {
      assert.equal(actProbabilityRaid(career.run, command).ok, false);
      assert.equal(JSON.stringify(career.run), spent, 'a rejected repeated ability cannot spend network, alter items or advance RNG');
    }
    career.run.event = null;
    career.run.stats.risk = 100;
    career.run.rngState = 1;
    checkedRaid(career.run, 'extract');
    assert.equal(career.run.result.kind, 'scatter');
    if (id === 'archivist') assert.deepEqual(career.run.result.archivedIds, ['dataset']);
    else assert.deepEqual(career.run.result.archivedIds, []);
    assert.equal(settle(career), true);
    const settled = structuredClone(career.profile);
    assert.equal(settle(career), false);
    assert.deepEqual(career.profile, settled);
    checkedDeployment(career, { seed: 7920, difficulty: 'easy' });
    assert.equal(career.run.talentState.used, false);
    assert.equal(career.run.talentState.protectedIndex, null);
    assert.equal(career.run.talent, null, 'a new expedition no longer offers the retired ability');
  }
});

test('archivist and equipped backup protect distinct actual items without duplicate settlement', () => {
  const career = createCareer(7123);
  career.run = createProbabilityRaid({ seed: 1, raidId: 'independent-double-protection',
    stories: {}, talent: { id: 'archivist', rank: 1 }, loadout: ['backup_device'] });
  career.run.bag = ['dataset', 'src_code', 'wind'];
  career.run.stats.risk = 100;
  checkedRaid(career.run, 'backup:1');
  checkedRaid(career.run, 'talent:archive:0');
  const restored = migrateCareer(JSON.stringify(career));
  checkedRaid(restored.run, 'extract');
  assert.equal(restored.run.result.kind, 'scatter');
  assert.deepEqual([...restored.run.result.archivedIds].sort(), ['dataset', 'src_code']);
  assert.deepEqual(restored.run.result.lostIds, ['wind']);
  assert.equal(settle(restored), true);
  assert.equal(restored.profile.stash.dataset, 1);
  assert.equal(restored.profile.stash.src_code, 1);
  assert.equal(restored.profile.stash.wind, undefined);
  const after = structuredClone(restored.profile);
  assert.equal(settle(restored), false);
  assert.deepEqual(restored.profile, after);
});
