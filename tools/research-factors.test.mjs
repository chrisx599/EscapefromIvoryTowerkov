import test from 'node:test';
import assert from 'node:assert/strict';
import { createCareer, migrateCareer } from '../src/career.js';
import { normalizeResearch, researchAct, researchView, researchScope, PROJECTS, PROMOTION_GRANTS } from '../src/research.js';
import { researchFactors, experimentOutcome, reviewOutcome } from '../src/research-factors.js';

function supplied(seed = 2463534242, stage = 0) {
  const p = createCareer(seed).profile;
  p.research = normalizeResearch({ stage, rng: seed, skills: stage ? { engineering: 27, research: 27, expression: 27 } : {} });
  p.funding = 10000;
  Object.assign(p.stash, { dataset: 30, src_code: 30, wind: 30, compute: 100, remote_terminal: 1 });
  if (stage) p.loadout.device = 'remote_terminal';
  return p;
}
const checked = (p, a) => { const result = researchAct(p, a); assert.equal(result.ok, true, `${a}: ${result.reason}`); return result; };
function finish(p) {
  for (let actions = 0; actions < 60; actions++) {
    const project = p.research.project;
    if (project.status === 'ready') return checked(p, 'publish');
    if (project.status === 'submitted') { checked(p, 'review'); continue; }
    checked(p, 'experiment');
    if (project.runs >= 2) checked(p, 'submit');
  }
  assert.fail('Research did not reach publication within the repair bound');
}
const draws = Array.from({ length: 1001 }, (_, index) => index / 1000);

test('every experiment factor independently changes the seeded outcome, without weakening progress', () => {
  const base = { quality: 25, evidence: 0, engineering: 1, research: 1, expression: 1 };
  for (const [key, value] of Object.entries({ engineering: 5, research: 5, equipment: 8, headroom: 2,
    preparation: 2, topicFit: true, experience: 12, quality: 80, evidence: 70 })) {
    const enhanced = { ...base, [key]: value };
    const separatingDraw = draws.find(draw => !experimentOutcome(base, draw).success && experimentOutcome(enhanced, draw).success);
    assert.notEqual(separatingDraw, undefined, `${key} must affect success for a controlled equal draw`);
    for (const draw of [0, separatingDraw, 1]) {
      const a = experimentOutcome(base, draw), b = experimentOutcome(enhanced, draw);
      assert.ok(b.qualityGain >= a.qualityGain, key);
      assert.ok(b.evidenceGain >= a.evidenceGain, key);
    }
  }
});

test('review decisions combine work quality, evidence, preparation, expression, topic fit and method practice', () => {
  const base = { quality: 85, evidence: 65, expression: 1, experience: 6 };
  for (const [key, value] of Object.entries({ quality: 100, evidence: 100, preparation: 2, expression: 6, experience: 30, topicFit: true })) {
    const improved = { ...base, [key]: value };
    assert.ok(draws.some(draw => reviewOutcome(base, draw, 'evaluate').status !== 'ready'
      && reviewOutcome(improved, draw, 'evaluate').status === 'ready'), `${key} must change a controlled review`);
  }
  assert.notEqual(reviewOutcome({ quality: 100, evidence: 0 }, 1, 'finetune').status, 'ready', 'quality alone does not manufacture evidence');
});

test('factors remain bounded and ordinary repair guarantees acceptance even under worst draws', () => {
  for (const type of Object.keys(PROJECTS)) for (let scope = 0; scope <= 2; scope++) {
    const f = { quality: 0, evidence: 0, engineering: 1, research: 1, expression: 1, scope };
    for (let run = 0; run < 17; run++) {
      const outcome = experimentOutcome(f, 1);
      assert.ok(outcome.qualityGain >= 8 && outcome.qualityGain <= 50);
      assert.ok(outcome.evidenceGain >= 6 && outcome.evidenceGain <= 50);
      f.quality = Math.min(100, f.quality + outcome.qualityGain);
      f.evidence = Math.min(100, f.evidence + outcome.evidenceGain);
    }
    assert.equal(f.quality, 100); assert.equal(f.evidence, 100);
    assert.equal(reviewOutcome(f, 0, type).status, 'ready');
  }
  const extreme = researchFactors(Object.fromEntries(['quality', 'evidence', 'engineering', 'research', 'expression', 'preparation', 'equipment', 'headroom', 'experience', 'scope', 'support'].map(key => [key, 1e9])));
  assert.deepEqual(extreme, { quality: 100, evidence: 100, engineering: 10, research: 10, expression: 10, preparation: 2,
    equipment: 12, headroom: 2, experience: 30, topicFit: false, scope: 2, support: 6 });
  for (const invalid of [NaN, Infinity, -Infinity, 'bad', null]) {
    const result = experimentOutcome({ quality: invalid, evidence: invalid, engineering: invalid }, invalid);
    assert.ok(Number.isFinite(result.qualityGain) && Number.isFinite(result.evidenceGain));
  }
});

test('a fresh all-shop first paper fits 800 funding even with every experimental and review setback', () => {
  const f = { quality: 25, evidence: 0, engineering: 1, research: 1, expression: 1, experience: 0 };
  for (let run = 1; run <= 7; run++) {
    const outcome = experimentOutcome(f, 1);
    f.quality = Math.min(100, f.quality + outcome.qualityGain);
    f.evidence = Math.min(100, f.evidence + outcome.evidenceGain);
    f.experience += 1;
    f.engineering = f.research = Math.min(10, 1 + Math.floor(run * 2 / 3));
  }
  // No repeated submissions or extra expression XP is necessary for this bound.
  assert.equal(reviewOutcome(f, 0, 'replicate').status, 'ready');
  assert.equal(40 + 50 + 30 + 7 * (60 + 30), 750);
});

test('legacy material notes improve the real next project once and never consume undisclosed stock', () => {
  const plain = supplied(5000), prepared = structuredClone(plain);
  prepared.research.prepared = { dataset: 1, wind: 1 };
  prepared.stash.unpublished = 1;
  prepared.stash.preprint = 1;
  assert.deepEqual(prepared.research.prepared, { dataset: 1, wind: 1 });
  const snapshot = structuredClone(prepared.stash), funds = prepared.funding;
  checked(plain, 'start:evaluate'); checked(prepared, 'start:evaluate');
  assert.equal(prepared.research.project.preparation, 2);
  assert.equal(prepared.research.project.quality - plain.research.project.quality, 8);
  assert.equal(prepared.research.project.evidence, 10);
  assert.deepEqual(prepared.research.prepared, { dataset: 0, wind: 0 });
  snapshot.dataset -= 1; snapshot.wind -= 1;
  assert.deepEqual(prepared.stash, snapshot);
  assert.equal(prepared.funding, funds - 40);
  checked(prepared, 'abandon'); checked(prepared, 'start:evaluate');
  assert.equal(prepared.research.project.preparation, 0);
});

test('blocked and malformed research actions are atomic, including RNG, learning and preparation', () => {
  const p = supplied(); p.stash.unpublished = 1;
  const same = action => { const before = JSON.stringify(p); assert.equal(researchAct(p, action).ok, false, action); assert.equal(JSON.stringify(p), before, action); };
  for (const action of ['talent:archivist', 'start:replicate:extra', 'prepare:unpublished:extra', 'promote:x', 'review:x', 'start:constructor']) same(action);
  p.funding = 0; same('start:replicate');
  p.funding = 1000; checked(p, 'start:replicate');
  p.stash.compute = 0; same('experiment');
  p.stash.compute = 5; p.funding = 0; same('experiment');
  p.funding = 1000; same('submit'); same('review'); same('publish');
  checked(p, 'experiment'); checked(p, 'experiment'); checked(p, 'submit');
  same('experiment'); same('submit');
  checked(p, 'review'); same('review');
  if (p.research.project.status !== 'ready') same('submit');
});

test('saved RNG resumes the same experiment and review without view-driven rerolls', () => {
  const p = supplied(); checked(p, 'start:evaluate'); checked(p, 'experiment');
  const restored = migrateCareer({ version: 2, profile: p, run: null }).profile;
  assert.deepEqual(restored.research, p.research);
  const before = JSON.stringify(p.research);
  for (let read = 0; read < 10; read++) researchView(p);
  assert.equal(JSON.stringify(p.research), before);
  for (const action of ['experiment', 'submit', 'review']) {
    checked(p, action); checked(restored, action);
    assert.deepEqual(restored.research, p.research, action);
  }
  assert.equal(Object.hasOwn(researchView(p).project, 'target'), false);
});

test('learning survives abandonment and rejected legacy projects recover beyond six runs', () => {
  const p = supplied(); checked(p, 'start:replicate'); checked(p, 'experiment');
  const learned = p.research.methods.replicate;
  const skills = structuredClone(p.research.skills);
  checked(p, 'abandon');
  assert.equal(p.research.methods.replicate, learned); assert.deepEqual(p.research.skills, skills);
  p.research = normalizeResearch({ ...p.research, project: { id: 'paper-40', type: 'replicate', direction: 'llm', scope: 0,
    quality: 0, runs: 6, reviews: 4, submittedRuns: 6, status: 'rejected' } });
  assert.equal(p.research.project.runs, 6); assert.equal(p.research.project.status, 'rejected');
  assert.equal(p.research.sequence, 40);
  checked(p, 'experiment'); assert.equal(p.research.project.runs, 7);
  finish(p);
  assert.equal(p.research.papers.at(-1).id, 'paper-40');
  assert.ok(p.research.methods.replicate > learned);
});

test('every former faction migrates at its earned rank with no reset, compounded benefit or reward', () => {
  for (const [stage, rank] of [[1, 1], [3, 2], [6, 3]]) for (const id of ['archivist', 'connector', 'tinkerer']) {
    const p = supplied(88, stage);
    const raw = { ...p.research, talent: { id, rank: 999 }, project: { id: 'paper-4', type: 'replicate', direction: 'llm',
      quality: 67, runs: 6, reviews: 3, submittedRuns: 6, scope: 0, status: 'ready' } };
    delete raw.legacySupport;
    const expected = { initialQuality: id === 'archivist' ? rank * 3 : 0,
      experimentQuality: id === 'tinkerer' ? rank : 0, publicationGrant: id === 'connector' ? rank * 10 : 0 };
    p.research = normalizeResearch(raw);
    assert.deepEqual(p.research.legacySupport, expected);
    assert.equal(p.research.stage, stage); assert.equal(p.research.rewardedStage, stage);
    assert.equal(p.research.talent, null); assert.equal(p.research.project.status, 'ready');
    const before = JSON.stringify(p.research);
    assert.equal(researchAct(p, `talent:${id}`).ok, false); assert.equal(JSON.stringify(p.research), before);
    for (let reload = 0; reload < 3; reload++) assert.deepEqual(normalizeResearch(p.research), p.research);
    const funds = p.funding;
    checked(p, 'publish');
    assert.equal(p.funding, funds + PROJECTS.replicate.grant + expected.publicationGrant);
    assert.equal(p.research.papers.length, 1);
    const after = JSON.stringify(p);
    assert.equal(researchAct(p, 'publish').ok, false); assert.equal(JSON.stringify(p), after);
    assert.deepEqual(p.research.legacySupport, expected);
    assert.deepEqual(researchView(p).talents, []);
    assert.equal(researchView(p).canChooseTalent, false);
  }
});

test('portfolio promotion accepts either representative evidence or practice and pays exactly once', () => {
  for (const route of ['paper', 'practice']) {
    const p = supplied();
    p.research.skills = { engineering: 3, research: 3, expression: 0 };
    p.achievement = 30;
    p.research.papers = [{ id: 'paper-1', type: 'replicate', quality: 60, evidence: 60, title: '已录用', credit: 30, day: 0 }];
    const before = JSON.stringify(p);
    assert.match(researchView(p).promotionReasons.join(''), /代表作/);
    assert.equal(researchAct(p, 'promote').ok, false); assert.equal(JSON.stringify(p), before);
    if (route === 'paper') { p.research.papers[0].quality = 80; p.research.papers[0].evidence = 65; }
    else p.research.methods.replicate = 2;
    const funds = p.funding;
    checked(p, 'promote');
    assert.equal(p.funding, funds + PROMOTION_GRANTS[1]);
    assert.equal(p.research.rewardedStage, 1); assert.equal(p.research.stage, 1);
    const promoted = JSON.stringify(p);
    assert.equal(researchAct(p, 'promote').ok, false); assert.equal(JSON.stringify(p), promoted);
    p.research = normalizeResearch(p.research);
    assert.equal(p.funding, funds + PROMOTION_GRANTS[1]);
  }
  const p = supplied(); checked(p, 'start:replicate'); finish(p);
  assert.deepEqual(researchView(p).promotionReasons, []);
  checked(p, 'promote');
});

test('titles unlock stronger automatic scope without making existing equipment obsolete', () => {
  const p = supplied(5, 6);
  p.loadout.device = 'lightweight_laptop';
  assert.equal(researchScope(p, 'replicate'), 0);
  const template = researchView(p).templates.find(row => row.id === 'replicate');
  assert.equal(template.scope, 0); assert.equal(template.cost, 30); assert.equal(template.disabled, false);
  checked(p, 'start:replicate'); assert.equal(p.research.project.scope, 0);
  p.loadout.device = 'remote_terminal'; checked(p, 'experiment');
  assert.equal(p.research.project.scope, 0, 'active scope and costs are fixed');
  checked(p, 'abandon');
  assert.equal(researchScope(p, 'replicate'), 2);
  checked(p, 'start:replicate'); assert.equal(p.research.project.scope, 2);
});

test('actual seeded actions independently react to materials, equipment, skills, fit, work and experience', () => {
  const cases = {
    preparation: p => { delete p.stash.dataset; p.stash.unpublished = 1; },
    equipment: p => { p.loadout.tool = 'experiment_tracker'; },
    device: p => { p.loadout.device = 'gpu_workstation'; },
    engineering: p => { p.research.skills.engineering = 12; },
    research: p => { p.research.skills.research = 12; },
    experience: p => { p.research.methods.replicate = 12; },
    work: null,
    legacyFit: null,
  };
  for (const [name, improve] of Object.entries(cases)) {
    let found = false;
    for (let seed = 1; seed <= 512 && !found; seed++) {
      const base = supplied(seed * 7919), enhanced = structuredClone(base);
      if (improve) improve(enhanced);
      checked(base, 'start:replicate'); checked(enhanced, 'start:replicate');
      if (name === 'work') enhanced.research.project.quality = 80;
      if (name === 'legacyFit') {
        base.research.project.automaticFit = false;
        base.research.project.direction = 'llm';
        enhanced.research.project.automaticFit = false;
        enhanced.research.project.direction = 'robotics';
      }
      checked(base, 'experiment'); checked(enhanced, 'experiment');
      if (!base.research.project.successfulRuns && enhanced.research.project.successfulRuns) {
        assert.equal(base.research.rng, enhanced.research.rng, name);
        assert.equal(base.research.methods.replicate, 1, 'a setback still teaches');
        found = true;
      }
    }
    assert.equal(found, true, `${name} must change a real outcome under an identical seeded draw`);
  }
});

test('the three compact skill explanations correspond to real effects and promotion requirements', () => {
  const f = { quality: 75, evidence: 65, engineering: 1, research: 1, expression: 1 };
  const basic = experimentOutcome(f, 0);
  const engineering = experimentOutcome({ ...f, engineering: 5 }, 0);
  const research = experimentOutcome({ ...f, research: 5 }, 0);
  assert.ok(engineering.qualityGain > basic.qualityGain, 'engineering improves execution quality');
  assert.ok(research.qualityGain > basic.qualityGain && research.evidenceGain > basic.evidenceGain,
    'research improves experiment quality and evidence');
  assert.deepEqual(experimentOutcome({ ...f, expression: 5 }, 0), basic,
    'expression must not be misrepresented as improving experiments');
  assert.ok(draws.some(draw => reviewOutcome(f, draw).status !== 'ready'
    && reviewOutcome({ ...f, expression: 5 }, draw).status === 'ready'), 'expression affects actual review decisions');
  for (const key of ['engineering', 'research', 'expression']) {
    const p = supplied(99, 2);
    p.research.papers = Array.from({ length: 4 }, (_, index) => ({ id: `paper-${index}`, type: 'replicate',
      quality: 100, evidence: 100, title: '已录用论文', credit: 60, day: 1 }));
    p.achievement = 240; p.research.methods.replicate = 30;
    p.research.skills = { engineering: 27, research: 27, expression: 27 };
    p.research.skills[key] = 0;
    assert.equal(researchAct(p, 'promote').ok, false, `${key} gates promotion`);
    p.research.skills[key] = 27;
    assert.equal(researchAct(p, 'promote').ok, true, `${key} is the remaining promotion requirement`);
  }
});

test('legacy practice is recovered conservatively once and saved methods remain authoritative', () => {
  const legacy = { stage: 2, completed: { replicate: 2 }, papers: [
    { id: 'paper-1', type: 'evaluate', quality: 72, title: '旧论文', credit: 45, day: 1 },
  ], project: { id: 'paper-8', type: 'replicate', direction: 'robotics', quality: 40, runs: 6,
    reviews: 2, submittedRuns: 6, status: 'rejected' } };
  const migrated = normalizeResearch(legacy);
  assert.deepEqual(migrated.methods, { replicate: 10, evaluate: 2, finetune: 0 });
  assert.deepEqual(normalizeResearch(migrated), migrated);
  migrated.methods.replicate = 3;
  assert.equal(normalizeResearch(migrated).methods.replicate, 3, 'never re-add inferred experience');
  assert.equal(migrated.stage, 2); assert.equal(migrated.papers.length, 1);
  assert.equal(migrated.lastMilestone, null);
  assert.equal(migrated.rewardedStage, 2);
});
