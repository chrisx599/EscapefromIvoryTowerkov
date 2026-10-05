import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS } from '../src/content.js';
import { createProbabilityRaid, actProbabilityRaid, probabilityRaidView } from '../src/probability-raid.js';

const make = seed => createProbabilityRaid({ seed, surprise: true, stories: {}, difficulty: 'normal' });
const act = (run, action) => {
  const result = actProbabilityRaid(run, action);
  assert.equal(result.ok, true, `${action}: ${result.reason || ''}`);
  return result;
};
const checkState = (run, label) => {
  const snapshot = JSON.stringify(run);
  const view = probabilityRaidView(run);
  assert.equal(JSON.stringify(run), snapshot, `${label}: viewing must not consume RNG or edit saved state`);
  assert.ok(view.stats.will >= 0 && view.stats.will <= view.stats.willMax, `${label}: heart bounds`);
  assert.ok(view.stats.risk >= 0 && view.stats.risk <= 100, `${label}: internal risk bounds`);
  assert.ok(view.stats.network >= 0, `${label}: no negative network`);
  const weight = run.bag.reduce((sum, id) => sum + ITEMS[id].weight, 0);
  assert.ok(weight <= run.bagCap + 0.001, `${label}: overflow may not overfill real bag`);
  assert.equal(view.bag.length, run.bag.length, `${label}: real bag projection`);
  assert.deepEqual(view.bag.map(row => row.id), run.bag, `${label}: immediate item order`);
  assert.deepEqual(view.pendingLoot.map(row => row.id), run.pendingLoot, `${label}: pending items remain separate`);
  return view;
};

// Independent black-box journey coverage. Tests choose among enabled labels only,
// without reading probabilities or expected success/failure projections.
test('neutral one-search journeys remain deterministic through every action and save checkpoint', () => {
  const observed = new Set();
  for (let index = 1; index <= 100; index++) {
    const run = make(index * 7919);
    let restored = JSON.parse(JSON.stringify(run));
    let searches = 0;
    for (let step = 0; step < 45 && run.status === 'playing'; step++) {
      const view = checkState(run, `${index}:${step}`);
      assert.deepEqual(view, checkState(restored, `${index}:${step}:restored`));
      let command;
      if (view.pendingLoot.length) command = 'take:available';
      else if (view.event) {
        observed.add(view.event.story?.id || view.event.type);
        const available = view.event.actions.filter(row => !row.disabled && !row.endsRaid && row.id !== 'event:story-decline');
        assert.ok(available.length, 'a natural encounter must offer an actionable nonterminal response');
        command = available[(index + step) % available.length].id;
      } else command = searches >= 6 || view.stats.will < 1 ? 'extract' : 'search';
      if (command === 'search') searches++;
      assert.deepEqual(act(run, command), act(restored, command), `seed ${index}, ${command}: replay result`);
      assert.deepEqual(run, restored, `seed ${index}, ${command}: replay state`);
      checkState(run, `${index}:${command}:after`);
      restored = JSON.parse(JSON.stringify(restored));
    }
    assert.equal(run.status, 'ended', `seed ${index}: bounded journey must reach extraction`);
    const before = JSON.stringify(run);
    assert.equal(actProbabilityRaid(run, 'search').ok, false, 'a ended expedition cannot search again');
    assert.equal(JSON.stringify(run), before, 'rejected repeated action is atomic');
    assert.equal(run.result.archivedIds.length + run.result.carriedIds.length + run.result.lostIds.length,
      run.bag.length, 'settlement accounts for every real carried item exactly once');
  }
  assert.ok(observed.size >= 3, 'the journey corpus must exercise multiple encounter families');
});

test('new neutral encounters expose short actionable labels without revealing probabilities or outcomes', () => {
  const prompts = new Set();
  const forbidden = ['probability', 'chance', 'success', 'failure', 'successSummary', 'failureSummary', 'outlook', 'costText', 'cost', 'exitProbabilities'];
  for (let index = 1; index <= 100; index++) {
    const run = make(index * 104729);
    for (let search = 0; search < 3 && !run.event; search++) {
      act(run, 'search');
      if (run.pendingLoot.length) act(run, 'take:available');
    }
    const view = checkState(run, `neutral-${index}`);
    assert.ok(view.event, 'natural fresh encounters are reachable');
    assert.equal(run.encounterVersion, 2);
    assert.equal(run.event.encounterVersion, 2);
    prompts.add(view.event.prompt || view.event.text);
    const options = view.event.actions.filter(row => !row.endsRaid && !row.disabled);
    assert.ok(options.length >= 2 && options.length <= 4, 'empty-bag player has two to four usable substantive choices');
    for (const option of view.event.actions) {
      for (const key of forbidden) assert.equal(Object.hasOwn(option, key), false, `neutral action must not expose ${key}`);
      const label = option.label || option.name;
      assert.ok(label && label.length <= 24, `short label: ${label}`);
      assert.doesNotMatch(label, /[%％]|把握|概率|可能的结果|成功率|失败率|收益/);
    }
    assert.ok(view.event.actions.some(row => row.id === 'event:leave'), 'neutrality preserves an explicit extraction action');
  }
  assert.ok(prompts.size >= 3, 'neutral encounters are not a single repeated prompt');
});

test('legacy search commands and pending saved encounter still resume without mutation or reroll', () => {
  const original = createProbabilityRaid({ seed: 528001, stories: {} });
  act(original, 'search:cautious');
  if (original.pendingLoot.length) act(original, 'take:available');
  if (!original.event) act(original, 'search:deep');
  const loaded = JSON.parse(JSON.stringify(original));
  const snapshot = JSON.stringify(loaded);
  for (let view = 0; view < 5; view++) probabilityRaidView(loaded);
  assert.equal(JSON.stringify(loaded), snapshot, 'opening a legacy save preserves the old pending event and RNG');
  assert.deepEqual(loaded, original);
  const view = probabilityRaidView(loaded);
  const command = view.pendingLoot.length ? 'take:available' : view.event
    ? view.event.actions.find(row => !row.disabled && !row.endsRaid).id : 'search';
  assert.deepEqual(act(original, command), act(loaded, command));
  assert.deepEqual(original, loaded, 'a legacy event resolves once with its original rules');
});
