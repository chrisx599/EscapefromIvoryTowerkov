import test from 'node:test';
import assert from 'node:assert/strict';
import { createCareer, migrateCareer, hubAct } from '../src/career.js';
import { researchAct, researchView, normalizeResearch, skillLevels, learnFromRaid,
  SKILL_THRESHOLDS, PAID_EXPERIMENT_LIMIT, PROMOTION_REVIEW_LIMIT, PROMOTION_GRANTS } from '../src/research.js';
import { experimentProbability, reviewProbability, promotionProbability,
  experimentOutcome, reviewOutcome, legacyExperimentOutcome, legacyReviewOutcome } from '../src/research-factors.js';

const act = (p, action) => { const result = researchAct(p, action); assert.equal(result.ok, true, `${action}: ${result.reason}`); return result; };
const reverseLeft = (value, shift) => { let x = value; for (let i = 0; i < 32; i++) x = value ^ (x << shift); return x >>> 0; };
const reverseRight = (value, shift) => { let x = value; for (let i = 0; i < 32; i++) x = value ^ (x >>> shift); return x >>> 0; };
const seedFor = draw => reverseLeft(reverseRight(reverseLeft(Math.floor(draw * 4294967296), 5), 17), 13);
const forceDraw = (p, draw = 0.999999) => { p.research.rng = seedFor(draw); };
function supplied(seed = 17003, stage = 0) {
  const p = createCareer(seed).profile;
  p.research = normalizeResearch({ balanceVersion: 2, stage, rng: seed,
    skills: stage ? { engineering: 50, research: 50, expression: 50 } : {} });
  p.funding = 100000;
  Object.assign(p.stash, { dataset: 200, src_code: 200, wind: 200, compute: 2000 });
  if (stage) p.loadout.device = 'remote_terminal';
  return p;
}
function finish(p, forceFailure = false) {
  let runs = 0, reviews = 0, supported = 0;
  while (p.research.project) {
    const view = researchView(p), project = view.project;
    assert.ok(runs < 20 && reviews < 20, 'finite repair bound');
    const action = view.nextActionId.replace('research:', '');
    if (forceFailure && ['experiment', 'review'].includes(action)) forceDraw(p);
    if (action === 'experiment') { runs++; supported += Number(project.supported); }
    if (action === 'review') reviews++;
    act(p, action);
  }
  return { runs, reviews, supported };
}
function qualified(seed = 17003) {
  const p = supplied(seed);
  act(p, 'start:replicate'); finish(p, true);
  assert.deepEqual(researchView(p).promotionReasons, []);
  return p;
}

test('probabilities have diminishing attributes, distinct stage/scope pressure and strict caps', () => {
  const novice = { engineering: 1, research: 1, expression: 1, quality: 25, evidence: 0, topicFit: true };
  assert.ok(experimentProbability(novice) >= 0.45 && experimentProbability(novice) <= 0.55);
  const mature = { ...novice, engineering: 4, research: 4, expression: 4, quality: 80, evidence: 70,
    equipment: 5, preparation: 1, experience: 12, stage: 3, scope: 1 };
  assert.ok(experimentProbability(mature) >= 0.60 && experimentProbability(mature) <= 0.80);
  for (const key of ['engineering', 'research']) {
    const p1 = experimentProbability({ ...novice, [key]: 1 });
    const p2 = experimentProbability({ ...novice, [key]: 2 });
    const p8 = experimentProbability({ ...novice, [key]: 8 });
    const p9 = experimentProbability({ ...novice, [key]: 9 });
    assert.ok(p2 - p1 > 3 * (p9 - p8), key);
  }
  assert.ok(experimentProbability({ ...mature, stage: 8 }) < experimentProbability(mature));
  assert.ok(experimentProbability({ ...mature, scope: 2 }) < experimentProbability(mature));
  const maximum = { engineering: 1e9, research: 1e9, expression: 1e9, quality: 1e9, evidence: 1e9,
    equipment: 1e9, headroom: 1e9, experience: 1e9, support: 1e9, preparation: 1e9, topicFit: true };
  assert.equal(experimentProbability(maximum), 0.85);
  assert.ok(reviewProbability(maximum) <= 0.90);
  assert.equal(experimentOutcome(maximum, 0.99).success, false);
  assert.notEqual(reviewOutcome(maximum, 0.99).status, 'ready', 'even perfect work has real review variance');
  assert.ok(promotionProbability({ stage: 1, representative: 1, practice: 1 }) >= 0.50);
  assert.ok(promotionProbability({ stage: 8, representative: 1, practice: 1 }) <= 0.70);
});

test('preparation, equipment, practice, fit and evidence remain independently meaningful', () => {
  const base = { engineering: 1, research: 1, expression: 1, quality: 70, evidence: 55 };
  for (const [key, value] of Object.entries({ engineering: 5, research: 5, quality: 90, evidence: 80,
    preparation: 2, equipment: 8, experience: 12, headroom: 2, topicFit: true, support: 3 })) {
    const enhanced = { ...base, [key]: value };
    const before = experimentProbability(base), after = experimentProbability(enhanced);
    assert.ok(after > before, key);
    assert.equal(experimentOutcome(base, (before + after) / 2).success, false);
    assert.equal(experimentOutcome(enhanced, (before + after) / 2).success, true);
  }
  for (const [key, value] of Object.entries({ expression: 5, research: 5, quality: 90, evidence: 80,
    preparation: 2, equipment: 8, experience: 12, topicFit: true })) {
    assert.ok(reviewProbability({ ...base, [key]: value }) > reviewProbability(base), key);
  }
  assert.equal(reviewProbability({ ...base, quality: 59 }), 0);
  assert.equal(reviewProbability({ ...base, evidence: 39 }), 0);
  assert.equal(reviewProbability({ ...base, scope: 2, evidence: 59 }), 0);
});

test('new first submissions need scope-sensitive real work; blocked clicks are atomic', () => {
  for (const [stage, scope] of [[0, 0], [3, 1], [6, 2]]) {
    const p = supplied(17003, stage); act(p, 'start:replicate');
    assert.equal(p.research.project.scope, scope);
    assert.equal(researchView(p).project.minimumRuns, 3 + scope);
    assert.deepEqual(researchView(p).project.experimentMaterials, { compute: 1 });
    assert.equal(researchView(p).project.experimentCost, 18 * (scope + 1));
    assert.match(researchView(p).actions.find(row => row.id === 'research:experiment').name, /1 张算力卡/);
    for (let i = 0; i < 3 + scope; i++) {
      const before = JSON.stringify(p);
      assert.equal(researchAct(p, 'submit').ok, false);
      assert.equal(JSON.stringify(p), before);
      act(p, 'experiment');
    }
    act(p, 'submit');
    const before = JSON.stringify(p);
    assert.equal(researchAct(p, 'submit').ok, false);
    assert.equal(JSON.stringify(p), before);
  }
});

test('worst-draw starter paper has finite support, costs only 510 all-shop, and never requires new equipment', () => {
  const career = createCareer(1), p = career.profile;
  for (const id of ['dataset', 'src_code']) assert.equal(hubAct(career, `buy:${id}`).ok, true);
  act(p, 'start:replicate');
  let paid = 0, runs = 0, firstSupport = null, beforePublish = null;
  while (p.research.project) {
    const view = researchView(p), action = view.nextActionId.replace('research:', '');
    if (action === 'experiment') {
      runs++;
      if (view.project.supported) {
        firstSupport ??= structuredClone(p.research.skills);
        assert.equal(view.project.experimentCost, 0);
        assert.deepEqual(view.project.experimentMaterials, {});
        p.loadout.device = null;
        assert.equal(researchView(p).actions.find(a => a.id === 'research:experiment').disabled, false);
      } else { paid++; assert.equal(hubAct(career, 'buy:compute').ok, true); }
      forceDraw(p);
    }
    if (action === 'review') forceDraw(p);
    if (action === 'publish') beforePublish = p.funding;
    act(p, action);
    if (firstSupport && p.research.project) assert.equal(p.research.skills.engineering, firstSupport.engineering);
    assert.ok(runs <= 7);
  }
  assert.equal(paid, PAID_EXPERIMENT_LIMIT);
  assert.equal(beforePublish, 800 - 510);
  assert.equal(p.funding, 370);
  assert.equal(p.research.papers.length, 1);
  assert.equal(p.research.skills.engineering, 5);
  assert.equal(p.research.methods.replicate, 5);
});

test('all project scopes and methods recover within bounded supported work under worst draws', () => {
  for (const stage of [0, 3, 6]) for (const type of ['replicate', 'evaluate', 'finetune']) {
    if (type === 'finetune' && stage === 0) continue;
    const p = supplied(17003, stage); act(p, `start:${type}`);
    const scope = p.research.project.scope;
    const result = finish(p, true);
    assert.ok(result.runs <= 7 + scope, `${type}/${scope}: ${result.runs}`);
    assert.ok(result.supported >= 1);
    assert.equal(p.research.papers.length, 1);
  }
});

test('free reanalysis and repeated submissions cannot farm skills or methods; basic projects cannot train past Lv4', () => {
  const p = supplied(); act(p, 'start:replicate');
  for (let i = 0; i < 5; i++) act(p, 'experiment');
  const methods = structuredClone(p.research.methods), skills = structuredClone(p.research.skills);
  for (let i = 0; i < 100; i++) act(p, 'experiment');
  assert.deepEqual(p.research.methods, methods);
  assert.deepEqual(p.research.skills, skills);
  assert.equal(p.research.project.learning.engineering, 5);
  act(p, 'abandon');
  for (let project = 0; project < 20; project++) {
    act(p, 'start:replicate'); for (let i = 0; i < 5; i++) act(p, 'experiment'); act(p, 'abandon');
  }
  assert.equal(p.research.skills.engineering, SKILL_THRESHOLDS[4] - 1);
  assert.equal(skillLevels(p.research).engineering, 4);
  assert.equal(p.research.methods.replicate, 10);
});

test('promotion reviews are random after eligibility, preserve earned work, and reject idle rerolls', () => {
  const p = qualified(); const successful = structuredClone(p);
  forceDraw(p); forceDraw(successful, 0.01);
  const title = p.research.stage, papers = structuredClone(p.research.papers), funds = p.funding;
  assert.equal(act(p, 'promote').promoted, false);
  assert.equal(act(successful, 'promote').promoted, true);
  assert.equal(p.research.stage, title); assert.deepEqual(p.research.papers, papers); assert.equal(p.funding, funds);
  assert.equal(researchView(p).promotionReview.retryReady, false);
  const before = JSON.stringify(p);
  for (let i = 0; i < 20; i++) {
    assert.equal(researchAct(p, 'promote').ok, false); researchView(p);
    assert.equal(JSON.stringify(p), before);
  }
  // Trivial exits and only two searches cannot provide retry credit.
  learnFromRaid(p, { history: [] });
  learnFromRaid(p, { history: ['container:search:1', 'container:search:2'] });
  assert.equal(researchAct(p, 'promote').ok, false);
});

test('every promotion retry requires fresh earned progress and the fourth real review is finite', () => {
  const p = qualified();
  const funds = p.funding;
  for (let attempt = 1; attempt <= PROMOTION_REVIEW_LIMIT; attempt++) {
    if (attempt > 1) learnFromRaid(p, { history: Array.from({ length: 3 }, (_, i) => `container:search:${i}`) });
    forceDraw(p);
    const result = act(p, 'promote');
    assert.equal(result.promoted, attempt === PROMOTION_REVIEW_LIMIT);
    if (attempt < PROMOTION_REVIEW_LIMIT) {
      assert.equal(p.research.promotion.attempts, attempt);
      assert.equal(p.research.promotion.failures, attempt);
      assert.equal(p.funding, funds);
      assert.deepEqual(normalizeResearch(p.research), p.research);
    }
  }
  assert.equal(p.research.stage, 1);
  assert.equal(p.funding, funds + PROMOTION_GRANTS[1]);
  const after = JSON.stringify(p); assert.equal(researchAct(p, 'promote').ok, false); assert.equal(JSON.stringify(p), after);
});

test('publishing new work unlocks retry, while abandoning work and submissions alone do not', () => {
  const p = qualified(); forceDraw(p); act(p, 'promote');
  act(p, 'start:replicate'); for (let i = 0; i < 4; i++) act(p, 'experiment'); act(p, 'abandon');
  assert.equal(researchView(p).promotionReview.retryReady, false);
  act(p, 'start:replicate'); finish(p, true);
  assert.equal(researchView(p).promotionReview.retryReady, true);
});

test('new learning curve is stable across reload and old earned levels, titles and ready projects are retained', () => {
  const modern = normalizeResearch({ balanceVersion: 2, skills: { engineering: 27, research: 27, expression: 27 } });
  assert.deepEqual(skillLevels(modern), { engineering: 4, research: 4, expression: 4 });
  assert.deepEqual(skillLevels(normalizeResearch(modern)), skillLevels(modern));
  const legacy = normalizeResearch({ stage: 6, skills: { engineering: 27, research: 12, expression: 6 },
    project: { id: 'paper-8', type: 'replicate', direction: 'robotics', status: 'ready', runs: 6, quality: 70 } });
  assert.equal(legacy.stage, 6); assert.equal(legacy.project.status, 'ready'); assert.equal(legacy.project.balanceVersion, 1);
  assert.deepEqual(legacy.skills, { engineering: 27, research: 12, expression: 6 });
  assert.deepEqual(skillLevels(legacy), { engineering: 10, research: 5, expression: 3 });
  assert.deepEqual(normalizeResearch(legacy), legacy);
});

test('legacy active projects keep the old outcome and cost contracts without resetting progress', () => {
  const p = supplied();
  p.research = normalizeResearch({ ...p.research, project: { id: 'paper-9', type: 'replicate', direction: 'robotics',
    quality: 25, evidence: 0, runs: 0, status: 'experiment' } });
  assert.equal(researchView(p).project.minimumRuns, 2);
  assert.equal(researchView(p).project.experimentCost, 30);
  forceDraw(p, 0.9);
  const expected = legacyExperimentOutcome({ engineering: 1, research: 1, quality: 25, topicFit: true }, 0.9);
  act(p, 'experiment');
  assert.equal(p.research.project.quality, 25 + expected.qualityGain);
  assert.equal(p.research.project.evidence, expected.evidenceGain);
  const oldAdvanced = supplied(17003, 3);
  oldAdvanced.research = normalizeResearch({ ...oldAdvanced.research, project: { id: 'paper-10', type: 'replicate',
    direction: 'robotics', quality: 25, evidence: 0, runs: 0, scope: 1, status: 'experiment' } });
  assert.deepEqual(researchView(oldAdvanced).project.experimentMaterials, { compute: 2 });
  assert.match(researchView(oldAdvanced).actions.find(row => row.id === 'research:experiment').name, /2 张算力卡/);
  const beforeCompute = oldAdvanced.stash.compute;
  act(oldAdvanced, 'experiment');
  assert.equal(oldAdvanced.stash.compute, beforeCompute - 2);
  assert.equal(legacyReviewOutcome({ quality: 100, evidence: 100 }, 1).status, 'ready');
  assert.notEqual(reviewOutcome({ quality: 100, evidence: 100 }, 1).status, 'ready');
});

test('save/restore preserves RNG, attempt gates and outcomes; views never leak internal draw state', () => {
  const career = createCareer(17003); Object.assign(career.profile.stash, { dataset: 1, src_code: 1, compute: 8 });
  act(career.profile, 'start:replicate'); act(career.profile, 'experiment');
  const restored = migrateCareer(JSON.stringify(career));
  assert.deepEqual(restored.profile.research, career.profile.research);
  for (const action of ['experiment', 'experiment', 'submit', 'review']) {
    act(career.profile, action); act(restored.profile, action);
    assert.deepEqual(restored.profile.research, career.profile.research);
  }
  const before = JSON.stringify(career.profile);
  for (let i = 0; i < 10; i++) {
    const view = researchView(career.profile);
    for (const hidden of ['rng', 'skillFloors', 'advancement', 'promotion', 'methods', 'prepared', 'legacySupport']) assert.equal(hidden in view, false, hidden);
    for (const hidden of ['balanceVersion', 'reviewFailures', 'learning', 'automaticFit', 'preparation']) assert.equal(hidden in view.project, false, hidden);
  }
  assert.equal(JSON.stringify(career.profile), before);
});
