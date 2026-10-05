import test from 'node:test';
import assert from 'node:assert/strict';
import { createCareer, hubAct, migrateCareer } from '../src/career.js';
import { DIRECTIONS, PROJECTS, STAGES, normalizeResearch, researchAct, researchView } from '../src/research.js';
import { experimentOutcome, reviewOutcome, legacyExperimentOutcome, legacyReviewOutcome } from '../src/research-factors.js';
import { finishPaper } from './research-qa.mjs';

const checked = (profile, action) => {
  const result = researchAct(profile, action);
  assert.equal(result.ok, true, `${action}: ${result.reason || ''}`);
  return result;
};
function supplied(seed = 8464) {
  const profile = createCareer(seed).profile;
  profile.funding = 10000;
  Object.assign(profile.stash, { dataset: 4, wind: 4, src_code: 4, compute: 20 });
  return profile;
}
function unchanged(profile, action) {
  const before = JSON.stringify(profile);
  assert.equal(researchAct(profile, action).ok, false, action);
  assert.equal(JSON.stringify(profile), before, `${action} must not charge, consume, learn, or reroll`);
}
const template = (profile, type) => researchView(profile).templates.find(row => row.id === type);
const firstDraw = seed => {
  let value = seed;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return (value >>> 0) / 4294967296;
};

for (const [raw, output, type] of [['unpublished', 'dataset', 'replicate'], ['preprint', 'wind', 'evaluate'],
  ['inside', 'wind', 'evaluate'], ['funding_tip', 'wind', 'evaluate']]) {
  test(`${raw} automatically supplies missing ${output} only on a successful ${type} start`, () => {
    const p = supplied();
    delete p.stash[output]; p.stash[raw] = 2;
    const view = template(p, type), before = structuredClone(p.stash), funds = p.funding;
    assert.equal(view.disabled, false, view.reason);
    assert.equal(view.materialCounts[output], 2);
    assert.equal(view.materialSources[output].find(source => source.id === raw).count, 1);
    assert.equal(view.materialPlan[output], undefined);
    assert.equal(view.materialPlan[raw], 1);
    checked(p, `start:${type}`);
    for (const [id, count] of Object.entries(view.materialPlan)) {
      before[id] -= count;
      if (!before[id]) delete before[id];
    }
    assert.deepEqual(p.stash, before, 'the visible consumption plan is exhaustive');
    assert.equal(p.funding, funds - view.cost);
    assert.equal(p.stash[output], undefined, 'no intermediate converted stock is created');
    assert.equal(p.research.project.preparation, 1);
    assert.equal(p.research.project.quality, 29);
    assert.equal(p.research.project.evidence, 5);
    assert.deepEqual(p.research.prepared, { dataset: 0, wind: 0 }, 'automatic work belongs to this project, not reusable notes');
    assert.equal(p.research.day, 1, 'no additional preparation day is hidden in start');
  });
}

test('canonical inputs are always preferred and unused raw inventory keeps its saleable identity', () => {
  const p = supplied();
  Object.assign(p.stash, { unpublished: 2, preprint: 2, inside: 2, funding_tip: 2 });
  const view = template(p, 'evaluate');
  assert.deepEqual(view.materialPlan, { dataset: 1, wind: 1 });
  assert.deepEqual(view.materialCounts, { dataset: 6, wind: 10 });
  assert.ok(Object.values(view.materialSources).flat().filter(row => row.automatic).every(row => row.count === 0));
  checked(p, 'start:evaluate');
  for (const raw of ['unpublished', 'preprint', 'inside', 'funding_tip']) assert.equal(p.stash[raw], 2);
  assert.equal(p.research.project.preparation, 0);
  assert.equal(p.research.project.quality, 25);
  assert.equal(p.research.project.evidence, 0);
});

test('equivalent sources fill only deficits in a stable order with exact truthful availability', () => {
  const p = supplied();
  delete p.stash.dataset; delete p.stash.wind;
  Object.assign(p.stash, { unpublished: 3, preprint: 1, inside: 2, funding_tip: 3 });
  const before = JSON.stringify(p);
  for (let reads = 0; reads < 5; reads++) {
    const view = researchView(p), t = view.templates.find(row => row.id === 'evaluate');
    assert.deepEqual(t.materialPlan, { unpublished: 1, preprint: 1 });
    assert.deepEqual(t.materialCounts, { dataset: 3, wind: 6 });
    assert.equal(view.materialCounts.dataset, 3); assert.equal(view.materialCounts.wind, 6);
    assert.equal(view.materialCounts.compute, 20);
    assert.deepEqual(view.directions, {}); assert.deepEqual(view.preparations, []);
    for (const [material, required] of Object.entries(t.materials)) {
      assert.equal(t.materialSources[material].reduce((sum, source) => sum + source.available, 0), t.materialCounts[material]);
      assert.equal(t.materialSources[material].reduce((sum, source) => sum + source.count, 0), required);
      for (const source of t.materialSources[material]) assert.ok(source.count <= source.available);
    }
  }
  assert.equal(JSON.stringify(p), before, 'views cannot convert stock, consume notes, or advance RNG');
  checked(p, 'start:evaluate');
  assert.equal(p.stash.preprint, undefined); assert.equal(p.stash.inside, 2); assert.equal(p.stash.funding_tip, 3);
  assert.equal(p.research.project.preparation, 2);
  checked(p, 'abandon');
  assert.deepEqual(template(p, 'evaluate').materialPlan, { unpublished: 1, inside: 1 });
});

test('incomplete input, fee, equipment and ability checks remain atomic with automatic inputs', () => {
  for (const mutate of [p => { delete p.stash.src_code; }, p => { p.funding = 29; },
    p => { p.loadout.device = null; }]) {
    const p = supplied(); delete p.stash.dataset; p.stash.unpublished = 2;
    p.research.prepared.dataset = 8;
    mutate(p);
    assert.equal(template(p, 'replicate').disabled, true);
    unchanged(p, 'start:replicate');
  }
  const p = supplied(); delete p.stash.dataset; p.stash.unpublished = 2;
  unchanged(p, 'start:finetune');
  assert.equal(template(p, 'finetune').disabled, true);
  checked(p, 'start:replicate');
  delete p.stash.compute;
  unchanged(p, 'experiment');
  assert.equal(p.stash.unpublished, 1, 'raw input is never an undisclosed substitute for compute');
});

test('view plans are advisory snapshots and a later inventory loss is revalidated before charging', () => {
  const p = supplied(); delete p.stash.dataset; p.stash.unpublished = 1;
  assert.equal(template(p, 'replicate').disabled, false);
  delete p.stash.unpublished;
  const t = template(p, 'replicate');
  assert.equal(t.disabled, true); assert.equal(t.materialCounts.dataset, 0);
  assert.ok(t.materialSources.dataset.every(source => source.count === 0));
  unchanged(p, 'start:replicate');
});

test('retired preparation and direction writes are rejected without changes both idle and active', () => {
  const p = supplied(); Object.assign(p.stash, { unpublished: 1, preprint: 1, inside: 1, funding_tip: 1 });
  p.research.prepared = { dataset: 3, wind: 2 };
  for (const active of [false, true]) {
    if (active) checked(p, 'start:replicate');
    for (const action of ['prepare:unpublished', 'prepare:preprint', 'prepare:inside', 'prepare:funding_tip',
      'direction:llm', 'direction:multimodal', 'direction:robotics', 'direction:systems',
      'prepare', 'direction', 'prepare:constructor', 'direction:__proto__', 'prepare:unpublished:extra', 'direction:llm:extra']) {
      unchanged(p, action);
    }
  }
});

test('legacy notes are kept through inactive migration and used once only by matching project inputs', () => {
  const career = createCareer(9);
  Object.assign(career.profile.stash, { dataset: 3, src_code: 3, wind: 3, unpublished: 2, preprint: 2 });
  career.profile.research.prepared = { dataset: 1, wind: 1 };
  const stash = structuredClone(career.profile.stash);
  const restored = migrateCareer(JSON.stringify(career));
  assert.deepEqual(restored.profile.stash, stash, 'migration never bulk-converts valuable inventory');
  assert.deepEqual(restored.profile.research.prepared, { dataset: 1, wind: 1 });
  checked(restored.profile, 'start:replicate');
  assert.equal(restored.profile.research.project.preparation, 1);
  assert.deepEqual(restored.profile.research.prepared, { dataset: 0, wind: 1 });
  checked(restored.profile, 'abandon');
  checked(restored.profile, 'start:evaluate');
  assert.equal(restored.profile.research.project.preparation, 1);
  assert.deepEqual(restored.profile.research.prepared, { dataset: 0, wind: 0 });
  checked(restored.profile, 'abandon'); checked(restored.profile, 'start:evaluate');
  assert.equal(restored.profile.research.project.preparation, 0);
  assert.equal(restored.profile.stash.unpublished, 2); assert.equal(restored.profile.stash.preprint, 2);
});

test('raw preparation preserves legacy notes for later canonical inputs without double credit or exceeding the cap', () => {
  const p = supplied(); delete p.stash.dataset; delete p.stash.wind;
  p.stash.unpublished = 1; p.stash.funding_tip = 1;
  p.research = normalizeResearch({ ...p.research, prepared: { dataset: 999, wind: 999 } });
  assert.deepEqual(p.research.prepared, { dataset: 8, wind: 8 });
  checked(p, 'start:evaluate');
  assert.equal(p.research.project.preparation, 2);
  assert.equal(p.research.project.quality, 33); assert.equal(p.research.project.evidence, 10);
  assert.deepEqual(p.research.prepared, { dataset: 8, wind: 8 }, 'already-covered raw inputs do not waste saved notes');
  assert.deepEqual(normalizeResearch(p.research), p.research);
  checked(p, 'abandon');
  Object.assign(p.stash, { dataset: 1, wind: 1 });
  checked(p, 'start:evaluate');
  assert.equal(p.research.project.preparation, 2);
  assert.equal(p.research.project.quality, 33); assert.equal(p.research.project.evidence, 10);
  assert.deepEqual(p.research.prepared, { dataset: 7, wind: 7 }, 'the next canonical project consumes one note per covered input');
  assert.deepEqual(normalizeResearch(p.research), p.research);
});

test('mixed raw and canonical inputs consume only the notes that add real preparation', () => {
  const p = supplied(); delete p.stash.dataset; p.stash.unpublished = 1;
  p.research.prepared = { dataset: 1, wind: 1 };
  checked(p, 'start:evaluate');
  assert.equal(p.research.project.preparation, 2);
  assert.deepEqual(p.research.prepared, { dataset: 1, wind: 0 });
  checked(p, 'abandon');
  p.stash.dataset = 2;
  checked(p, 'start:replicate');
  assert.equal(p.research.project.preparation, 1);
  assert.deepEqual(p.research.prepared, { dataset: 0, wind: 0 });
  checked(p, 'abandon'); checked(p, 'start:replicate');
  assert.equal(p.research.project.preparation, 0, 'the preserved note can only be used once');
});

test('active legacy progress, earned preparation and fixed scope survive without consuming banked notes', () => {
  for (const status of ['experiment', 'revision', 'rejected', 'submitted', 'ready']) {
    const career = createCareer(911);
    Object.assign(career.profile.stash, { dataset: 2, wind: 2, unpublished: 2, preprint: 2, compute: 2 });
    career.profile.research = normalizeResearch({ ...career.profile.research, stage: 6, prepared: { dataset: 4, wind: 3 },
      project: { id: 'paper-7', type: 'evaluate', direction: 'multimodal', title: '已投入的旧课题', scope: 0,
        quality: 77, evidence: 69, preparation: 2, runs: 6, successfulRuns: 3, setbacks: 3,
        reviews: 2, submittedRuns: 5, status, lastOutcome: '已有结果' } });
    const snapshot = structuredClone(career.profile);
    const restored = migrateCareer(JSON.stringify(career));
    assert.deepEqual(restored.profile.research.project, snapshot.research.project);
    assert.deepEqual(restored.profile.research.prepared, snapshot.research.prepared);
    assert.deepEqual(restored.profile.stash, snapshot.stash);
    assert.equal(restored.profile.research.project.automaticFit, false);
    assert.equal(researchView(restored.profile).project.experimentCost, PROJECTS.evaluate.cost);
    assert.deepEqual(migrateCareer(JSON.stringify(restored)).profile.research, restored.profile.research);
    if (['experiment', 'revision', 'rejected'].includes(status)) {
      checked(restored.profile, 'experiment');
      assert.equal(restored.profile.research.project.scope, 0);
      assert.equal(restored.profile.research.project.preparation, 2);
      assert.deepEqual(restored.profile.research.prepared, snapshot.research.prepared);
    }
  }
});

test('every new method gets the former topic-fit benefit automatically regardless of saved direction', () => {
  for (const type of Object.keys(PROJECTS)) {
    const outcomes = [];
    for (const direction of Object.keys(DIRECTIONS)) {
      const p = supplied();
      p.research.direction = direction;
      p.research.stage = 1;
      p.research.skills = { engineering: 3, research: 3, expression: 3 };
      p.stash.gpu_workstation = 1; p.loadout.device = 'gpu_workstation';
      checked(p, `start:${type}`);
      assert.equal(p.research.project.automaticFit, true);
      assert.equal(p.research.project.direction, direction, 'historical metadata is not rewritten');
      assert.equal(p.research.project.title, `基础${PROJECTS[type].name} #1`);
      assert.equal(normalizeResearch(p.research).project.automaticFit, true);
      checked(p, 'experiment');
      outcomes.push([p.research.project.quality, p.research.project.evidence, p.research.project.successfulRuns]);
    }
    for (const result of outcomes) assert.deepEqual(result, outcomes[0]);
  }
});

test('old direction matches retain their exact experiment and review effects on an active project', () => {
  const seed = 8464, draw = firstDraw(seed);
  for (const direction of Object.keys(DIRECTIONS)) {
    const p = supplied(seed);
    const topicFit = DIRECTIONS[direction].specialty === 'replicate';
    const oldProject = { id: 'paper-1', type: 'replicate', direction, scope: 0, quality: 25, evidence: 0,
      preparation: 0, runs: 0, status: 'experiment', reviews: 0, submittedRuns: 0 };
    p.research = normalizeResearch({ ...p.research, project: oldProject });
    const expected = legacyExperimentOutcome({ quality: 25, evidence: 0, engineering: 1, research: 1,
      expression: 1, preparation: 0, equipment: 0, headroom: 0, experience: 0, topicFit, scope: 0, support: 0 }, draw);
    checked(p, 'experiment');
    assert.equal(p.research.project.quality, 25 + expected.qualityGain);
    assert.equal(p.research.project.evidence, expected.evidenceGain);
    assert.equal(p.research.project.successfulRuns, Number(expected.success));

    p.research = normalizeResearch({ ...p.research, rng: seed, methods: { replicate: 0 }, skills: {},
      project: { ...oldProject, quality: 76, evidence: 65, runs: 2, submittedRuns: 2, status: 'submitted' } });
    const review = legacyReviewOutcome({ quality: 76, evidence: 65, expression: 1, experience: 0, topicFit }, draw, 'replicate');
    checked(p, 'review');
    assert.equal(p.research.project.status, review.status);
    assert.equal(p.research.project.status, topicFit ? 'ready' : 'revision');
  }
});

test('new automatic-fit projects preserve deterministic experiment and review results after reload', () => {
  const career = createCareer(8464);
  Object.assign(career.profile.stash, { unpublished: 1, funding_tip: 1, compute: 8 });
  checked(career.profile, 'start:evaluate');
  const restored = migrateCareer(JSON.stringify(career));
  assert.deepEqual(restored.profile.research, career.profile.research);
  for (const action of ['experiment', 'experiment', 'experiment', 'submit', 'review']) {
    checked(career.profile, action); checked(restored.profile, action);
    assert.deepEqual(restored.profile.research, career.profile.research);
    assert.deepEqual(restored.profile.stash, career.profile.stash);
    assert.equal(restored.profile.funding, career.profile.funding);
  }
});

test('default new careers publish and earn their first promotion review within the starter budget without setup menus', () => {
  for (let seed = 1; seed <= 128; seed++) {
    const career = createCareer(seed * 7919);
    for (const id of ['dataset', 'src_code']) assert.equal(hubAct(career, `buy:${id}`).ok, true);
    const progress = finishPaper(career.profile, { start: 'replicate',
      act: action => hubAct(career, `research:${action}`),
      onExperiment: project => { if (project.runs < 5) assert.equal(hubAct(career, 'buy:compute').ok, true, `seed ${seed}`); } });
    assert.ok(progress.runs <= 7, `seed ${seed} must have finite affordable repair`);
    assert.ok(career.profile.funding >= 90);
    const beforeReview = career.profile.funding;
    const review = hubAct(career, 'research:promote');
    assert.equal(review.ok, true);
    assert.equal(career.profile.research.stage, Number(review.promoted));
    assert.equal(career.profile.funding, beforeReview + (review.promoted ? 180 : 0));
    assert.deepEqual(researchView(career.profile).directions, {});
    assert.deepEqual(researchView(career.profile).preparations, []);
  }
});

test('automatic raw-material projects still reach every title through finite real experiments and publication', () => {
  const p = supplied(7919); p.funding = 100000;
  for (let paper = 0; paper < 55 && p.research.stage < STAGES.length - 1; paper++) {
    delete p.stash.dataset; delete p.stash.wind;
    Object.assign(p.stash, { unpublished: 1, preprint: 1, src_code: 1, compute: 50 });
    if (p.research.stage >= 3) { p.stash.remote_terminal = 1; p.loadout.device = 'remote_terminal'; }
    else if (p.research.stage >= 1) { p.stash.gpu_workstation = 1; p.loadout.device = 'gpu_workstation'; }
    const progress = finishPaper(p, { start: paper % 2 ? 'replicate' : 'evaluate' });
    assert.ok(progress.runs <= 17);
    while (researchAct(p, 'promote').ok) { /* Claim only earned milestones. */ }
  }
  assert.equal(p.research.stage, STAGES.length - 1);
  assert.ok(p.research.papers.length >= 20);
  assert.ok(p.achievement >= STAGES.at(-1).credit);
});
