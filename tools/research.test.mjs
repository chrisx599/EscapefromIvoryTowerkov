import test from 'node:test';
import assert from 'node:assert/strict';
import { createCareer, careerView, hubAct, migrateCareer, deployProbability } from '../src/career.js';
import { STAGES } from '../src/research.js';
import { finishPaper } from './research-qa.mjs';

const action = (career, verb) => hubAct(career, `research:${verb}`);
function supplied(seed = 123456789) {
  const career = createCareer(seed);
  Object.assign(career.profile.stash, { dataset: 3, src_code: 3, wind: 3, compute: 6 });
  career.profile.funding = 50000;
  return career;
}
function accepted(career, type = 'evaluate') {
  return finishPaper(career.profile, { start: type, act: verb => action(career, verb),
    onExperiment: project => { career.profile.stash.compute = Math.max(career.profile.stash.compute || 0, 1 + project.scope); } });
}

test('project prerequisites and payments are atomic, including missing equipment', () => {
  const career = createCareer(1);
  let before = JSON.stringify(career);
  assert.equal(action(career, 'start:replicate').ok, false);
  assert.equal(JSON.stringify(career), before);
  Object.assign(career.profile.stash, { dataset: 1, src_code: 1 });
  career.profile.funding = 29;
  before = JSON.stringify(career);
  assert.equal(action(career, 'start:replicate').ok, false);
  assert.equal(JSON.stringify(career), before);
  career.profile.funding = 100;
  hubAct(career, 'unequip:device');
  before = JSON.stringify(career);
  assert.equal(action(career, 'start:replicate').ok, false);
  assert.equal(JSON.stringify(career), before);
  hubAct(career, 'equip:lightweight_laptop');
  assert.equal(action(career, 'start:replicate').ok, true);
  assert.equal(career.profile.stash.dataset, undefined);
  assert.equal(career.profile.stash.src_code, undefined);
  assert.equal(career.profile.funding, 70);
  assert.equal(action(career, 'start:evaluate').ok, false);
});

test('experiments consume compute, reload deterministically, and reward publication only once', () => {
  const career = supplied();
  action(career, 'start:replicate');
  assert.equal(action(career, 'publish').ok, false);
  assert.equal(action(career, 'submit').ok, false);
  assert.equal(action(career, 'experiment').ok, true);
  assert.equal(career.profile.stash.compute, 5);
  assert.equal(career.profile.achievement, 0);
  const restored = migrateCareer(JSON.stringify(career));
  action(career, 'experiment'); action(restored, 'experiment');
  assert.deepEqual(restored.profile.research, career.profile.research);
  while (career.profile.research.project.quality < 100 || career.profile.research.project.evidence < 100) {
    career.profile.stash.compute = 1;
    assert.equal(action(career, 'experiment').ok, true);
    assert.ok(career.profile.research.project.runs < 30, 'full evidence must remain reachable');
  }
  action(career, 'submit');
  assert.equal(career.profile.achievement, 0);
  action(career, 'review');
  assert.equal(career.profile.achievement, 0);
  const funds = career.profile.funding;
  assert.equal(action(career, 'publish').ok, true);
  assert.equal(career.profile.achievement, 30);
  assert.equal(career.profile.funding, funds + 80);
  assert.equal(career.profile.research.papers.length, 1);
  const snapshot = JSON.stringify(career);
  assert.equal(action(career, 'publish').ok, false);
  assert.equal(JSON.stringify(career), snapshot);
});

test('rejections require new experiments before resubmission and cannot farm expression', () => {
  const career = supplied();
  action(career, 'start:evaluate'); action(career, 'experiment'); action(career, 'experiment');
  career.profile.research.project.quality = 25;
  action(career, 'submit'); action(career, 'review');
  assert.equal(career.profile.research.project.status, 'rejected');
  const snapshot = JSON.stringify(career);
  assert.equal(action(career, 'submit').ok, false);
  assert.equal(action(career, 'review').ok, false);
  assert.equal(JSON.stringify(career), snapshot);
  action(career, 'experiment');
  assert.equal(action(career, 'submit').ok, true);
});

test('research equipment improves experiments and finetuning requires rank and a capable device', () => {
  const plain = supplied();
  const geared = supplied();
  Object.assign(geared.profile.stash, { experiment_tracker: 1, literature_assistant: 1 });
  hubAct(geared, 'equip:experiment_tracker'); hubAct(geared, 'equip:literature_assistant');
  action(plain, 'start:replicate'); action(geared, 'start:replicate');
  assert.equal(geared.profile.research.project.quality - plain.profile.research.project.quality, 8);
  action(plain, 'experiment'); action(geared, 'experiment');
  assert.ok(geared.profile.research.project.quality > plain.profile.research.project.quality, 'equipped experiment tool makes a real quality difference');
  assert.equal(action(geared, 'direction:robotics').ok, false);
  action(geared, 'abandon');
  assert.equal(action(geared, 'direction:robotics').ok, true);
  assert.equal(action(geared, 'start:finetune').ok, false);
  assert.equal(hubAct(geared, 'buy:gpu_workstation').ok, false);
  geared.profile.research.stage = 1;
  hubAct(geared, 'buy:gpu_workstation'); hubAct(geared, 'equip:gpu_workstation');
  geared.profile.research.skills.engineering = 3;
  geared.profile.research.skills.research = 3;
  assert.equal(action(geared, 'start:finetune').ok, true);
});

test('material preparation replaces one held material and cannot duplicate it', () => {
  const career = createCareer(9);
  career.profile.stash.unpublished = 1;
  assert.equal(action(career, 'prepare:unpublished').ok, true);
  assert.equal(career.profile.stash.unpublished, undefined);
  assert.equal(career.profile.stash.dataset, 1);
  assert.equal(action(career, 'prepare:unpublished').ok, false);
  assert.equal(career.profile.stash.dataset, 1);
});

test('unknown research and venue identifiers fail without changing the profile', () => {
  const career = supplied();
  const snapshot = JSON.stringify(career);
  for (const id of ['__proto__', 'constructor', 'missing']) {
    for (const verb of ['start', 'direction', 'prepare']) assert.equal(action(career, `${verb}:${id}`).ok, false);
    assert.equal(hubAct(career, `venue:${id}`).ok, false);
  }
  assert.equal(JSON.stringify(career), snapshot);
});

test('saved achievement credits survive profile migration without manufacturing papers or promotion', () => {
  const old = createCareer(27);
  delete old.profile.research; delete old.profile.venue; delete old.profile.loadout.device;
  old.profile.achievement = 999;
  const career = migrateCareer(old);
  assert.equal(career.profile.achievement, 999);
  assert.equal(career.profile.research.papers.length, 0);
  assert.equal(career.profile.loadout.device, null);
  assert.equal(action(career, 'promote').ok, false);
  assert.equal(career.profile.research.stage, 0);
  assert.equal(migrateCareer({ ...old, profile: { ...old.profile, research: null } }).profile.research.stage, 0);
});

test('paper milestones can unlock all career stages and additional raid scenes', () => {
  const career = supplied(987654321);
  action(career, 'direction:multimodal');
  assert.equal(hubAct(career, 'venue:visit').ok, false);
  for (let paper = 0; paper < 55 && career.profile.research.stage < STAGES.length - 1; paper++) {
    Object.assign(career.profile.stash, { dataset: 3, src_code: 3, wind: 3, compute: 24 });
    if (career.profile.research.stage >= 3) {
      career.profile.stash.remote_terminal = 1; hubAct(career, 'equip:remote_terminal');
    } else if (career.profile.research.stage >= 1) {
      career.profile.stash.gpu_workstation = 1; hubAct(career, 'equip:gpu_workstation');
    }
    accepted(career, paper % 2 ? 'replicate' : 'evaluate');
    while (action(career, 'promote').ok) { /* earned milestones */ }
  }
  assert.equal(career.profile.research.stage, STAGES.length - 1);
  assert.equal(hubAct(career, 'venue:visit').ok, true);
  assert.equal(hubAct(career, 'venue:industry').ok, true);
  assert.equal(deployProbability(career, { seed: 400, venue: 'industry', difficulty: 'normal' }).ok, true);
  assert.equal(career.run.venueId, 'industry');
  assert.equal(action(career, 'start:replicate').ok, false);
});


test('an old six-run rejected project can recover without surrendering its prior work', () => {
  const old = supplied(61728);
  action(old, 'start:replicate');
  Object.assign(old.profile.research.project, { quality: 15, runs: 6, submittedRuns: 6, reviews: 2, status: 'rejected' });
  for (const key of ['evidence', 'successfulRuns', 'setbacks', 'lastOutcome', 'preparation']) delete old.profile.research.project[key];
  const career = migrateCareer(JSON.stringify(old));
  const before = structuredClone(career.profile.research.project);
  assert.equal(before.runs, 6);
  assert.equal(before.status, 'rejected');
  assert.equal(career.profile.funding, old.profile.funding);
  assert.equal(action(career, 'submit').ok, false);
  const progress = finishPaper(career.profile, {
    act: verb => action(career, verb),
    onExperiment: project => { career.profile.stash.compute = Math.max(career.profile.stash.compute || 0, 1 + project.scope); },
  });
  assert.ok(progress.runs > 0 && progress.runs <= 17, 'old progress has a finite paid recovery even beyond six runs');
  assert.equal(career.profile.research.papers[0].id, before.id, 'the existing project is repaired, not silently abandoned or replaced');
  assert.equal(career.profile.achievement, 30);
  assert.equal(career.profile.research.project, null);
});
