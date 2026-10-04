import test from 'node:test';
import assert from 'node:assert/strict';
import { createProbabilityRaid, actProbabilityRaid, probabilityRaidView } from '../src/probability-raid.js';
import { academicStoryCandidates, normalizeStories, ACADEMIC_STORY_IDS, withAcademicStoryEcho } from '../src/academic-stories.js';
import { prepareSurpriseEncounter } from '../src/encounter-surprises.js';

const make = (options = {}) => createProbabilityRaid({ seed: 67891, surprise: true, ...options });
const checked = (run, action) => {
  const result = actProbabilityRaid(run, action);
  assert.equal(result.ok, true, result.reason || action);
  return result;
};
function random(run) {
  let value = run.rngState >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  run.rngState = (value >>> 0) || 1;
  return run.rngState / 4294967296;
}
function install(run, source) {
  run.event = prepareSurpriseEncounter(run, source, () => random(run));
  run.eventCount++;
  run.usedEventIds.push(run.event.id);
  if (run.event.story) run.storyRun ||= { id: run.event.story.id, initialChapter: run.event.story.chapter - 1 };
  return run.event;
}
const fixture = () => ({ id: 'v2-resource-data-swap', type: 'resource', name: '交换台', title: '公开样本交换',
  text: '旧版会说明全部规则。', choices: [
    { key: 'trade-wind', name: '消耗情报换数据', requires: { wind: 1 }, cost: { items: { wind: 1 } },
      success: { rewardId: 'dataset', text: '交出情报，换回数据。' } },
    { key: 'inspect-sample', name: '检查样本', cost: { will: 1 }, check: { base: 60, skill: 'research' },
      onSuccess: { rewardId: 'dataset', text: '样本核验通过。' }, onFailure: { willDelta: -1, text: '没有通过。' } },
  ] });

test('one neutral choice genuinely varies across seeds, including reward, loss and order', () => {
  const successes = new Set(); const deltas = new Set(); const orders = new Set(); const chances = new Set();
  for (let index = 1; index <= 240; index++) {
    const run = make({ seed: index * 7919 });
    const event = install(run, fixture());
    const choice = event.choices.find(row => row.key === 'trade-wind');
    chances.add(choice.check.base);
    orders.add(event.choices.map(row => row.key).join(','));
    run.stats.risk = 30;
    const before = structuredClone(run.stats);
    const result = checked(run, 'event:trade-wind');
    successes.add(result.eventSuccess);
    deltas.add(`${run.stats.will - before.will}:${run.stats.risk - before.risk}`);
    assert.equal(run.bag.filter(id => id === 'dataset').length, Number(result.eventSuccess));
    assert.equal(run.stats.network, 0, 'no hidden upfront fee');
    assert.ok(result.eventSuccess ? run.stats.risk < before.risk : run.stats.will < before.will);
    assert.ok(Array.from(run.lastAction.brief).length <= 24);
  }
  assert.deepEqual([...successes].sort(), [false, true]);
  assert.equal(orders.size, 2);
  assert.ok(chances.size >= 18, 'hidden favorability is not a fixed property of the wording');
  assert.ok(deltas.size > 8);
});

test('natural empty-bag encounters offer two to four neutral normal choices with no forecasts', () => {
  const types = new Set(); const ids = new Set();
  for (let index = 1; index <= 400; index++) {
    const run = make({ seed: index * 7919, network: 0 });
    for (let search = 0; search < 2 && !run.event; search++) {
      if (run.pendingLoot.length) checked(run, 'take:skip');
      checked(run, 'search');
    }
    assert.ok(run.event);
    run.bag = [];
    run.pendingLoot = [];
    const snapshot = JSON.stringify(run);
    const view = probabilityRaidView(run);
    assert.equal(JSON.stringify(run), snapshot);
    assert.equal(view.encounterVersion, 2);
    assert.equal(view.event.encounterVersion, 2);
    assert.ok(Array.from(view.event.prompt).length <= 30);
    const choices = view.event.actions.filter(action => !action.endsRaid);
    assert.ok(choices.length >= 2 && choices.length <= 4);
    for (const action of choices) {
      assert.equal(action.disabled, false);
      assert.equal(action.label, action.name);
      assert.ok(Array.from(action.label).length <= 10, action.label);
      assert.doesNotMatch(action.label, /获得|消耗|风险|安全|保证|概率|奖励|较有把握/);
      for (const field of ['probability', 'cost', 'success', 'failure', 'outlook', 'exitProbabilities']) assert.equal(field in action, false, field);
    }
    assert.equal(view.event.actions.find(action => action.endsRaid).label, '撤离');
    types.add(view.event.kind); ids.add(view.event.id);
  }
  assert.equal(types.size, 4);
  assert.ok(ids.size >= 20);
});

test('saved hidden choices, probabilities, rolls and consequences resume exactly; reads consume nothing', () => {
  for (let index = 1; index <= 60; index++) {
    const run = make({ seed: index * 6133 });
    install(run, fixture());
    const saved = JSON.stringify(run);
    for (let count = 0; count < 4; count++) probabilityRaidView(run);
    assert.equal(JSON.stringify(run), saved);
    const restored = JSON.parse(saved);
    const id = `event:${run.event.choices[index % 2].key}`;
    assert.deepEqual(checked(run, id), checked(restored, id));
    assert.deepEqual(run, restored);
    assert.deepEqual(probabilityRaidView(run), probabilityRaidView(restored));
    const after = JSON.stringify(run);
    assert.equal(actProbabilityRaid(run, id).ok, false);
    assert.equal(JSON.stringify(run), after);
  }
});

test('consumed new encounters cannot be replayed for another reward, state delta or fee', () => {
  for (let index = 1; index <= 40; index++) {
    const run = make({ seed: index * 11717 });
    run.bag = ['wind'];
    const event = structuredClone(install(run, fixture()));
    checked(run, 'event:trade-wind');
    assert.ok(run.bag.includes('wind'), 'old exchange cost is not silently charged');
    run.event = event;
    const before = JSON.stringify(run);
    assert.equal(actProbabilityRaid(run, 'event:trade-wind').ok, false);
    assert.equal(JSON.stringify(run), before);
    assert.ok(run.rewardedEventIds.length <= 1);
  }
});

test('story failures advance only the actual interrupted branch and conclude without reward claims', () => {
  for (const id of ACADEMIC_STORY_IDS) {
    const outcomes = new Set();
    for (let index = 1; index <= 80; index++) {
      const run = make({ seed: index * 13007, stories: {} });
      install(run, academicStoryCandidates(run).find(event => event.story.id === id));
      const first = run.event.choices.find(choice => !choice.requiresTalent);
      const expectedBranch = first.onSuccess.story.branch;
      const result = checked(run, `event:${first.key}`);
      const state = run.stories.chains[id];
      assert.equal(state.chapter, 1);
      assert.equal(state.branch, result.eventSuccess ? expectedBranch : 'interrupted');
      assert.equal(state.outcome, null);
      if (!result.eventSuccess) {
        assert.equal(run.rewardedEventIds.length, 0);
        assert.match(run.lastAction.text, /卡纸|窗口突然关|桌底/);
      }
      const resumed = make({ seed: index * 9719, stories: JSON.parse(JSON.stringify(run.stories)) });
      const callback = install(resumed, academicStoryCandidates(resumed).find(event => event.story.id === id));
      const final = callback.choices[0];
      const expectedReward = final.onSuccess.rewardId;
      const ended = checked(resumed, `event:${final.key}`);
      outcomes.add(ended.eventSuccess);
      assert.equal(resumed.stories.chains[id].chapter, 2);
      if (!ended.eventSuccess) {
        assert.equal(resumed.stories.chains[id].outcome, 'setback');
        assert.equal(resumed.bag.length, 0);
        assert.equal(resumed.rewardedEventIds.length, 0);
        assert.doesNotMatch(resumed.lastAction.text, /获得|交出了|通过|履行|拿到了|认可/);
      } else assert.equal(resumed.rewardedEventIds.length, Number(!!expectedReward));
      resumed.event = callback;
      const before = JSON.stringify(resumed);
      assert.equal(actProbabilityRaid(resumed, `event:${final.key}`).ok, false);
      assert.equal(JSON.stringify(resumed), before);
      const next = make({ stories: resumed.stories });
      assert.equal(academicStoryCandidates(next).some(event => event.story.id === id), false);
    }
    assert.deepEqual([...outcomes].sort(), [false, true]);
  }
});

test('setback endings never claim a fulfilled favor in later ordinary story echoes', () => {
  for (const id of ACADEMIC_STORY_IDS) {
    const stories = normalizeStories();
    stories.chains[id] = { chapter: 2, branch: 'interrupted', outcome: 'setback' };
    const run = make({ stories });
    for (const type of ['npc', 'route', 'technical']) {
      const event = withAcademicStoryEcho(run, { ...fixture(), type });
      assert.equal(event.storyEcho, undefined);
      assert.equal(event.choices.some(choice => choice.key === 'story-echo'), false);
    }
  }
});

test('outcomes stay bounded and recovery from the final search cannot strand automatic extraction', () => {
  let recovered = false; let extracted = false;
  for (let index = 1; index <= 200; index++) {
    const run = make({ seed: index * 19391 });
    install(run, fixture());
    run.stats.risk = index % 2 ? 0 : 100;
    run.stats.will = 0;
    run.pendingAutoExtract = true;
    checked(run, 'event:inspect-sample');
    assert.ok(run.stats.risk >= 0 && run.stats.risk <= 100);
    assert.ok(run.stats.will >= 0 && run.stats.will <= run.stats.willMax);
    assert.ok(run.stats.network >= 0);
    assert.ok(run.support >= 0 && run.support <= 8);
    if (run.status === 'playing') {
      recovered = true;
      assert.ok(run.stats.will > 0);
      assert.equal(run.pendingAutoExtract, false);
      assert.equal(probabilityRaidView(run).actions.find(action => action.id === 'search').disabled, false);
    } else {
      extracted = true;
      assert.equal(run.status, 'ended');
      assert.equal(run.result.automatic, true);
    }
  }
  assert.equal(recovered, true); assert.equal(extracted, true);
});

test('legacy creation and already-pending events retain exact costs, probabilities and RNG behavior', () => {
  for (const newRunFlag of [false, true]) {
    const run = createProbabilityRaid({ seed: 33551, surprise: newRunFlag });
    const event = fixture();
    run.event = event;
    run.bag = ['wind'];
    const beforeRng = run.rngState;
    const old = probabilityRaidView(run).event.actions.find(action => action.id === 'event:trade-wind');
    assert.equal(old.probability, 100);
    assert.match(old.cost, /消耗.*×1/);
    checked(run, old.id);
    assert.equal(run.rngState, beforeRng);
    assert.deepEqual(run.bag, ['dataset']);
  }
  const legacy = createProbabilityRaid({ seed: 35 });
  assert.equal(legacy.encounterVersion, undefined);
  const source = fixture();
  let calls = 0;
  assert.equal(prepareSurpriseEncounter(legacy, source, () => { calls++; return 0.5; }), source);
  assert.equal(calls, 0);
});

test('connector keeps its explicit one-network identity ability beside enabled ordinary choices', () => {
  for (const id of ['faculty_cat', 'stamp_maze']) {
    for (const network of [0, 2]) {
      const run = make({ stories: {}, talent: 'connector', network });
      install(run, academicStoryCandidates(run).find(event => event.story.id === id));
      const actions = probabilityRaidView(run).event.actions;
      const talent = actions.find(action => action.id === 'event:talent-negotiate');
      assert.equal(talent.talent, true);
      assert.match(talent.label, /人脉1/);
      assert.equal(talent.disabled, network === 0);
      assert.ok(actions.filter(action => !action.endsRaid && !action.talent && !action.disabled).length >= 2);
      const before = JSON.stringify(run);
      if (!network) {
        assert.equal(actProbabilityRaid(run, talent.id).ok, false);
        assert.equal(JSON.stringify(run), before);
      } else {
        const rng = run.rngState;
        const result = checked(run, talent.id);
        assert.equal(result.eventSuccess, true);
        assert.equal(run.stats.network, network - 1);
        assert.equal(run.talentState.used, true);
        assert.equal(run.rngState, rng, 'earned safe resolution keeps its no-check contract');
        assert.equal(run.stories.chains[id].branch, 'negotiated');
        const callback = install(run, academicStoryCandidates(run).find(event => event.story.id === id));
        assert.ok(callback);
        const snapshot = JSON.stringify(run);
        assert.equal(actProbabilityRaid(run, 'event:talent-negotiate').ok, false);
        assert.equal(JSON.stringify(run), snapshot);
      }
    }
  }
});

test('successful conversations preserve contact progress and can earn bounded usable network', () => {
  let networkEarned = false; let contactRecorded = false;
  for (let index = 1; index <= 100; index++) {
    const run = make({ seed: index * 16691 });
    const source = fixture();
    source.type = 'npc'; source.npcId = 'peer';
    source.choices[0].success.trustDelta = 1;
    install(run, source);
    const result = checked(run, 'event:trade-wind');
    assert.ok(run.stats.network >= 0 && run.stats.network <= 1);
    if (run.stats.network) { networkEarned = true; assert.equal(result.eventSuccess, true); }
    if (run.contactUpdates.peer) {
      contactRecorded = true;
      assert.equal(result.eventSuccess, true);
      assert.equal(run.contactUpdates.peer.trustDelta, 1);
    } else assert.equal(result.eventSuccess, false);
  }
  assert.equal(networkEarned, true);
  assert.equal(contactRecorded, true);
});
