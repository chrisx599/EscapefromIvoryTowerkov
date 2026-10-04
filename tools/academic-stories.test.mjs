import test from 'node:test';
import assert from 'node:assert/strict';
import { createProbabilityRaid, actProbabilityRaid, probabilityRaidView } from '../src/probability-raid.js';
import { ACADEMIC_STORY_IDS, normalizeStories, academicStoryCandidates, academicStoryWeight,
  academicStoriesView, storyJournal, withAcademicStoryEcho } from '../src/academic-stories.js';

const make = (options = {}) => createProbabilityRaid({ seed: 97843, stories: {}, ...options });
const checked = (run, action) => {
  const result = actProbabilityRaid(run, action);
  assert.equal(result.ok, true, result.reason || action);
  return result;
};
const settleLoot = run => { if (run.pendingLoot.length) checked(run, 'take:available'); };
function injectStory(run, id) {
  const event = academicStoryCandidates(run).find(row => row.story.id === id);
  assert.ok(event, `expected ${id} story candidate`);
  run.event = event;
  run.storyRun ||= { id, initialChapter: event.story.chapter - 1 };
  run.usedEventIds.push(event.id);
  run.eventCount++;
  return event;
}
function stateFor(id, branch, outcome = null) {
  const state = normalizeStories();
  state.chains[id] = { chapter: outcome ? 2 : 1, branch, outcome };
  return state;
}
function nextEvent(run) {
  for (let index = 0; index < 3 && !run.event && run.status === 'playing'; index++) {
    settleLoot(run);
    checked(run, 'search');
  }
  assert.ok(run.event);
  return run.event;
}
function npc(run) {
  run.event = { id: `plain-${run.actionIndex}`, type: 'npc', name: '评审', title: '合作边界', text: '确认这次安排。',
    choices: [{ key: 'ordinary', name: '正常回应', cost: { will: 1 }, onSuccess: { text: '回应完毕。' } }] };
}

const routes = [
  ['reviewer_printer', 'printer-evidence', 'evidence', 'printer-reproduce', 'reproducible', 'src_code'],
  ['reviewer_printer', 'printer-evidence', 'evidence', 'printer-boundary', 'boundaries', 'wind'],
  ['reviewer_printer', 'printer-rebuttal', 'rebuttal', 'printer-limit', 'boundaries', 'wind'],
  ['reviewer_printer', 'printer-rebuttal', 'rebuttal', 'printer-appeal', 'rebuttal_win', 'src_code'],
  ['stamp_maze', 'stamp-record', 'record', 'stamp-file', 'filed', 'wind'],
  ['stamp_maze', 'stamp-record', 'record', 'stamp-window', 'shortcut', 'dataset'],
  ['stamp_maze', 'stamp-sponsor', 'sponsor', 'stamp-repay', 'repaid', 'coop'],
  ['stamp_maze', 'stamp-sponsor', 'sponsor', 'stamp-repay-intel', 'repaid', null],
  ['stamp_maze', 'talent-negotiate', 'negotiated', 'stamp-honor-boundary', 'negotiated', 'dataset'],
  ['stamp_maze', 'talent-negotiate', 'negotiated', 'stamp-close-boundary', 'negotiated', null],
  ['faculty_cat', 'cat-feed', 'fed', 'cat-side-door', 'side_door', null],
  ['faculty_cat', 'cat-feed', 'fed', 'cat-sort-samples', 'acknowledged', 'dataset'],
  ['faculty_cat', 'cat-chair', 'respected', 'cat-acknowledge', 'acknowledged', 'coop'],
  ['faculty_cat', 'cat-chair', 'respected', 'cat-honest', 'honest', null],
  ['faculty_cat', 'talent-negotiate', 'negotiated', 'cat-honor-route', 'negotiated', null],
  ['faculty_cat', 'talent-negotiate', 'negotiated', 'cat-honor-contact', 'negotiated', 'coop'],
];

test('normalization is pure, bounded, canonical and drops client-authored reward rules', () => {
  const raw = { version: 999, chains: {
    reviewer_printer: { chapter: 1, branch: 'evidence', outcome: 'reproducible', reward: 90000 },
    stamp_maze: { chapter: 2, branch: 'record', outcome: 'filed', rewardId: 'compute' },
    faculty_cat: { chapter: 1, branch: '__proto__', outcome: null },
    injected: { chapter: 2 },
  } };
  const snapshot = JSON.stringify(raw);
  const normalized = normalizeStories(raw);
  assert.equal(JSON.stringify(raw), snapshot);
  assert.equal(normalized.version, 1);
  assert.deepEqual(Object.keys(normalized.chains), ACADEMIC_STORY_IDS);
  assert.deepEqual(normalized.chains.reviewer_printer, { chapter: 1, branch: 'evidence', outcome: null });
  assert.deepEqual(normalized.chains.stamp_maze, { chapter: 2, branch: 'record', outcome: 'filed' });
  assert.deepEqual(normalized.chains.faculty_cat, { chapter: 0, branch: null, outcome: null });
  for (const value of [null, false, [], '__proto__', { chains: { stamp_maze: { chapter: Infinity, branch: 'record' } } }]) {
    assert.deepEqual(normalizeStories(value), normalizeStories());
  }
  normalized.chains.stamp_maze.outcome = 'declined';
  assert.equal(raw.chains.stamp_maze.outcome, 'filed');
});

test('a first story is guaranteed by the second eligible search with seeded variety and pure previews', () => {
  const observed = new Set();
  for (let index = 1; index <= 300; index++) {
    const run = make({ seed: index * 7919 });
    const before = JSON.stringify(run);
    probabilityRaidView(run); probabilityRaidView(run);
    assert.equal(JSON.stringify(run), before);
    checked(run, 'search');
    if (!run.event) { settleLoot(run); checked(run, 'search'); }
    assert.ok(run.event?.story, `seed ${index}`);
    observed.add(run.event.story.id);
    assert.equal(run.event.story.chapter, 1);
    assert.ok(run.event.choices.some(choice => choice.key === 'story-decline'));
  }
  assert.deepEqual([...observed].sort(), [...ACADEMIC_STORY_IDS].sort());
});

test('location and inventory change story weights without making callbacks location-gated', () => {
  const run = make();
  const printer = academicStoryCandidates(run).find(row => row.story.id === 'reviewer_printer');
  const cat = academicStoryCandidates(run).find(row => row.story.id === 'faculty_cat');
  assert.ok(academicStoryWeight({ ...run, venueId: 'industry' }, printer) > academicStoryWeight(run, printer));
  assert.ok(academicStoryWeight({ ...run, bag: ['coffee_ticket'] }, cat) > academicStoryWeight(run, cat));
  for (const venue of ['conference', 'visit', 'industry']) {
    const continuation = make({ venue, stories: stateFor('faculty_cat', 'fed') });
    assert.deepEqual(academicStoryCandidates(continuation).map(row => row.story.id), ['faculty_cat']);
    assert.equal(probabilityRaidView(continuation).probabilities.encounter, 100);
  }
});

test('setups honor one breathing-room search then guarantee the chosen callback; one chain per expedition', () => {
  const run = make();
  injectStory(run, 'stamp_maze');
  checked(run, 'event:stamp-record');
  assert.equal(run.stories.chains.stamp_maze.chapter, 1);
  assert.equal(probabilityRaidView(run).probabilities.encounter, 0);
  checked(run, 'search');
  assert.equal(run.event, null);
  settleLoot(run);
  assert.equal(probabilityRaidView(run).probabilities.encounter, 100);
  checked(run, 'search');
  assert.equal(run.event.story.id, 'stamp_maze');
  assert.equal(run.event.story.chapter, 2);
  assert.match(run.event.text, /存根/);
  settleLoot(run);
  checked(run, 'event:stamp-file');
  assert.equal(academicStoryCandidates(run).length, 0);
  const journal = academicStoriesView(run);
  assert.equal(journal.completed, 1);
  assert.equal(journal.recent.length, 1);
  assert.equal(journal.recent[0].text, '循环证明被装订成了有限页');
});

test('all substantive setup branches produce distinct canonical callbacks and bounded final rewards', () => {
  for (const [id, first, branch, last, outcome, reward] of routes) {
    const run = make({ network: 3, talent: { id: 'connector', rank: 3 }, supplies: ['coffee_ticket'] });
    run.bag.push('dataset', 'src_code', 'wind');
    run.bagCap = 10;
    run.stats.risk = 35;
    injectStory(run, id);
    checked(run, `event:${first}`);
    assert.deepEqual(run.stories.chains[id], { chapter: 1, branch, outcome: null }, `${id}:${first}`);
    const stored = structuredClone(run.stories);
    const continuation = make({ seed: 1, stories: stored, network: 1, talent: { id: 'connector', rank: 3 } });
    continuation.bag = ['wind'];
    continuation.expedition.depth = 4;
    injectStory(continuation, id);
    const before = continuation.bag.length;
    checked(continuation, `event:${last}`);
    assert.equal(continuation.stories.chains[id].outcome, outcome, `${id}:${last}`);
    assert.equal(continuation.stories.chains[id].chapter, 2);
    assert.equal(continuation.rewardedEventIds.length, reward ? 1 : 0);
    assert.ok(continuation.bag.length <= before + 1);
    if (reward) assert.ok(continuation.bag.includes(reward));
    assert.ok(continuation.stats.risk >= 0 && continuation.stats.risk <= 100);
    assert.ok(continuation.stats.will >= 0 && continuation.stats.will <= continuation.stats.willMax);
    assert.ok(continuation.support <= 8);
    if (last.includes('route') || last === 'cat-side-door') assert.equal(continuation.expedition.depth, 0);
    assert.deepEqual(stored, run.stories, 'a later run must not mutate its input state');
  }
});

test('failed rebuttal is a terminal consequence and cannot reroll the same chapter', () => {
  const run = make({ stories: stateFor('reviewer_printer', 'rebuttal'), seed: 10000 });
  const event = injectStory(run, 'reviewer_printer');
  let seed = 1;
  for (; seed < 100000; seed++) {
    let x = seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    if ((x >>> 0) / 4294967296 > 0.96) break;
  }
  run.rngState = seed;
  const result = checked(run, 'event:printer-appeal');
  assert.equal(result.eventSuccess, false);
  assert.equal(run.stories.chains.reviewer_printer.outcome, 'rebuttal_loss');
  assert.equal(run.rewardedEventIds.length, 0);
  run.event = event;
  const before = JSON.stringify(run);
  assert.equal(actProbabilityRaid(run, 'event:printer-appeal').ok, false);
  assert.equal(JSON.stringify(run), before);
});

test('inventory and specialization costs are checked atomically, and connector keeps ordinary choices', () => {
  const run = make({ talent: { id: 'connector', rank: 1 }, network: 0 });
  injectStory(run, 'faculty_cat');
  const actions = probabilityRaidView(run).event.actions;
  assert.equal(actions.find(row => row.id === 'event:cat-feed').disabled, true);
  assert.equal(actions.find(row => row.id === 'event:talent-negotiate').disabled, true);
  assert.equal(actions.find(row => row.id === 'event:cat-chair').disabled, false);
  for (const action of ['event:cat-feed', 'event:talent-negotiate']) {
    const before = JSON.stringify(run);
    assert.equal(actProbabilityRaid(run, action).ok, false);
    assert.equal(JSON.stringify(run), before);
  }
  const printer = make();
  injectStory(printer, 'reviewer_printer');
  assert.equal(probabilityRaidView(printer).event.actions.find(row => row.id === 'event:printer-evidence').disabled, true);
  printer.bag = ['dataset'];
  checked(printer, 'event:printer-evidence');
  assert.equal(printer.bag.length, 0);
});

test('safe opt-out is free, closes the chapter and creates no automatic beneficial momentum', () => {
  for (const id of ACADEMIC_STORY_IDS) {
    const run = make();
    injectStory(run, id);
    const before = structuredClone({ stats: run.stats, bag: run.bag, rngState: run.rngState, support: run.support });
    checked(run, 'event:story-decline');
    assert.deepEqual({ stats: run.stats, bag: run.bag, rngState: run.rngState, support: run.support }, before);
    assert.equal(run.expedition.effect, null);
    assert.equal(run.stories.chains[id].outcome, 'declined');
    assert.equal(run.rewardedEventIds.length, 0);
    const next = make({ stories: run.stories });
    assert.equal(academicStoryCandidates(next).some(event => event.story.id === id), false);
  }
});

test('unique rewards cannot repeat on event replay or later expeditions', () => {
  const run = make({ stories: stateFor('reviewer_printer', 'evidence') });
  const event = injectStory(run, 'reviewer_printer');
  checked(run, 'event:printer-reproduce');
  const bag = [...run.bag];
  run.event = structuredClone(event);
  const before = JSON.stringify(run);
  assert.equal(actProbabilityRaid(run, 'event:printer-reproduce').ok, false);
  assert.equal(JSON.stringify(run), before);
  assert.deepEqual(run.bag, bag);
  const next = make({ stories: JSON.parse(JSON.stringify(run.stories)) });
  assert.equal(academicStoryCandidates(next).some(row => row.story.id === 'reviewer_printer'), false);
});

test('leave defers an unresolved callback across expeditions, including failed extraction', () => {
  const run = make({ stories: stateFor('faculty_cat', 'fed'), seed: 1 });
  injectStory(run, 'faculty_cat');
  checked(run, 'event:leave');
  assert.equal(run.status, 'ended');
  assert.equal(run.result.kind, 'scatter');
  assert.equal(run.stories.chains.faculty_cat.chapter, 1);
  const next = make({ stories: run.stories, venue: 'industry' });
  assert.equal(nextEvent(next).story.id, 'faculty_cat');
  assert.equal(next.event.story.chapter, 2);
});

test('completed story flags change later regular choices without farming chapter rewards', () => {
  for (const [id, branch, outcome, type, bag] of [
    ['reviewer_printer', 'evidence', 'reproducible', 'technical', ['src_code']],
    ['reviewer_printer', 'rebuttal', 'boundaries', 'technical', []],
    ['stamp_maze', 'record', 'filed', 'route', []],
    ['stamp_maze', 'record', 'shortcut', 'route', ['wind']],
    ['faculty_cat', 'fed', 'side_door', 'route', []],
    ['faculty_cat', 'respected', 'honest', 'npc', []],
  ]) {
    const run = make({ stories: stateFor(id, branch, outcome) });
    run.bag = bag;
    const base = { id: `regular-${type}`, type, name: '会务', text: '现场有了新情况。', title: '现场变化', choices: [] };
    const unchanged = JSON.stringify(base);
    run.event = withAcademicStoryEcho(run, base);
    assert.equal(JSON.stringify(base), unchanged);
    assert.ok(run.event.storyEcho);
    assert.equal(run.event.choices.length, 1);
    const before = normalizeStories(run.stories);
    checked(run, 'event:story-echo');
    assert.deepEqual(run.stories, before);
    assert.equal(run.rewardedEventIds.length, 0);
    assert.equal(run.pendingLoot.length, 0);
  }
});

test('archivist protects one material alongside equipment; duplicate coverage never duplicates items', () => {
  for (const shared of [false, true]) {
    const run = make({ talent: { id: 'archivist', rank: 1 }, loadout: ['backup_device'], seed: 1 });
    run.bag = ['dataset', 'src_code', 'wind'];
    checked(run, 'talent:archive:1');
    checked(run, `backup:${shared ? 1 : 0}`);
    const view = probabilityRaidView(run);
    assert.equal(view.bag[1].protection, shared ? 'both' : 'talent');
    if (!shared) assert.equal(view.bag[0].protection, 'equipment');
    checked(run, 'extract');
    assert.equal(run.result.kind, 'scatter');
    assert.deepEqual(run.result.archivedIds, shared ? ['src_code'] : ['dataset', 'src_code']);
    assert.equal(run.result.archivedIds.length + run.result.lostIds.length, 3);
  }
});

test('archive indexes follow consumed/dropped items and the once-only budget cannot be retargeted', () => {
  const run = make({ talent: 'archivist', supplies: ['coffee_ticket'] });
  run.bag.push('dataset', 'src_code');
  checked(run, 'talent:archive:2');
  run.stats.will = 8;
  checked(run, 'use:0');
  assert.equal(run.talentState.protectedIndex, 1);
  checked(run, 'drop:0');
  assert.equal(run.talentState.protectedIndex, 0);
  assert.equal(probabilityRaidView(run).bag[0].protection, 'talent');
  checked(run, 'drop:0');
  assert.equal(run.talentState.protectedIndex, null);
  run.bag.push('dataset');
  const before = JSON.stringify(run);
  assert.equal(actProbabilityRaid(run, 'talent:archive:0').ok, false);
  assert.equal(JSON.stringify(run), before);
});

test('tinkerer transforms one real item once, handles overflow and never advances RNG', () => {
  const run = make({ talent: { id: 'tinkerer', rank: 3 } });
  run.bag = ['compute', 'compute', 'compute', 'compute', 'compute', 'wind', 'wind'];
  const rng = run.rngState;
  checked(run, 'talent:convert:5');
  assert.equal(run.rngState, rng);
  assert.equal(run.bag.filter(id => id === 'wind').length, 1);
  assert.deepEqual(run.pendingLoot, ['compute']);
  assert.equal(run.talentState.used, true);
  const before = JSON.stringify(run);
  for (const action of ['talent:convert:6', 'talent:convert:0', 'talent:archive:0', 'talent:convert:-1']) {
    assert.equal(actProbabilityRaid(run, action).ok, false);
    assert.equal(JSON.stringify(run), before);
  }
  checked(run, 'take:skip');
  assert.equal(run.talentState.used, true);
});

test('connector safely resolves an ordinary NPC once and keeps a story negotiation as a real branch', () => {
  const run = make({ talent: 'connector', network: 2 });
  npc(run);
  const rng = run.rngState;
  checked(run, 'event:talent-negotiate');
  assert.equal(run.rngState, rng);
  assert.equal(run.stats.network, 1);
  assert.equal(run.support, 8);
  npc(run);
  const before = JSON.stringify(run);
  assert.equal(actProbabilityRaid(run, 'event:talent-negotiate').ok, false);
  assert.equal(JSON.stringify(run), before);
  const story = make({ talent: 'connector', network: 1 });
  injectStory(story, 'faculty_cat');
  checked(story, 'event:talent-negotiate');
  assert.equal(story.stories.chains.faculty_cat.branch, 'negotiated');
  assert.equal(story.stories.chains.faculty_cat.chapter, 1);
  assert.equal(story.talentState.used, true);
  assert.match(academicStoryCandidates(story)[0].text, /协议/);
});

test('same seeds and save checkpoints replay story choices, active budgets, rewards and extraction exactly', () => {
  for (const seed of [1, 37, 54321, 0xffffffff]) {
    const run = make({ seed, talent: 'tinkerer', network: 2, supplies: ['coffee_ticket'] });
    const restored = JSON.parse(JSON.stringify(run));
    for (let step = 0; step < 35 && run.status === 'playing'; step++) {
      const view = probabilityRaidView(run);
      const searches = run.history.filter(row => row === 'container:search:probability').length;
      const action = view.pendingLoot.length ? 'take:available'
        : view.event ? view.event.actions.find(row => !row.disabled && !row.endsRaid && row.id !== 'event:story-decline').id
          : view.talent.actions.find(row => !row.disabled)?.id || (searches >= 5 ? 'extract' : 'search');
      assert.deepEqual(checked(run, action), checked(restored, action));
      assert.deepEqual(run, restored);
      assert.deepEqual(probabilityRaidView(run), probabilityRaidView(restored));
    }
    assert.equal(run.status, 'ended');
  }
});

test('legacy active v3 saves remain neutral and all story/talent/journal views are pure', () => {
  const legacy = createProbabilityRaid({ seed: 91234 });
  for (const key of ['stories', 'storyRun', 'storyEnabled', 'talent', 'talentState']) delete legacy[key];
  const before = JSON.stringify(legacy);
  const view = probabilityRaidView(legacy);
  assert.equal(view.talent, null);
  assert.equal(view.stories.enabled, false);
  assert.deepEqual(academicStoryCandidates(legacy), []);
  assert.equal(JSON.stringify(legacy), before);
  checked(legacy, 'search');
  const current = make({ stories: stateFor('stamp_maze', 'record'), talent: 'archivist' });
  current.bag = ['dataset'];
  const snapshot = JSON.stringify(current);
  for (let index = 0; index < 5; index++) {
    probabilityRaidView(current); academicStoriesView(current); storyJournal(current.stories); academicStoryCandidates(current);
  }
  assert.equal(JSON.stringify(current), snapshot);
  assert.doesNotMatch(JSON.stringify({ stories: view.stories, talent: probabilityRaidView(current).talent }), /\d+(?:\.\d+)?[%％]/);
});
