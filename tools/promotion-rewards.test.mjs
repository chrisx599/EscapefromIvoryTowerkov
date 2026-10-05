import test from 'node:test';
import assert from 'node:assert/strict';
import { createCareer, migrateCareer, careerView, hubAct } from '../src/career.js';
import { normalizeResearch, researchView, researchAct, PROMOTION_GRANTS, STAGES, SKILL_THRESHOLDS } from '../src/research.js';
import { CAREER_TALENTS, talentRankForStage, normalizeCareerTalent, careerTalentBenefits } from '../public/career-talents.js';
import { finishPaper } from './research-qa.mjs';

const act = (career, action) => hubAct(career, `research:${action}`);
function eligible(career, stage) {
  const requirement = STAGES[stage];
  const research = career.profile.research;
  research.rng = 1; // Controlled passing review: this suite tests rewards, not probability frequency.
  research.papers = Array.from({ length: requirement.papers }, (_, index) => ({ id: `paper-${index + 1}`,
    type: index % 2 ? 'evaluate' : 'replicate', title: `研究 ${index + 1}`, quality: 100, evidence: 100, credit: 100, day: index }));
  career.profile.achievement = requirement.credit;
  research.methods = { replicate: 30, evaluate: 30, finetune: 30 };
  research.skills = { engineering: SKILL_THRESHOLDS[requirement.skill - 1], research: SKILL_THRESHOLDS[requirement.skill - 1],
    expression: SKILL_THRESHOLDS[Math.max(0, requirement.skill - 2)] };
}
function researchProfile(stage, talent = null) {
  const profile = createCareer(91234).profile;
  profile.research = normalizeResearch({ stage, talent, skills: { engineering: 27, research: 27, expression: 27 } }, 91234);
  profile.funding = 10000;
  Object.assign(profile.stash, { dataset: 10, src_code: 10, wind: 10, compute: 30, remote_terminal: 1 });
  profile.loadout.device = 'remote_terminal';
  return profile;
}
function noForecastProse(value) {
  if (typeof value === 'string') assert.doesNotMatch(value, /\d(?:\.\d+)?\s*[%％]|百分点|胜算|把握|预测|成功率|录用率|流派|专长选择/);
  else if (Array.isArray(value)) value.forEach(noForecastProse);
  else if (value && typeof value === 'object') Object.values(value).forEach(noForecastProse);
}

test('the genuine first-paper loop earns an eligible title review and an immediate one-time grant', () => {
  const career = createCareer(91234);
  Object.assign(career.profile.stash, { dataset: 1, src_code: 1, compute: 20 });
  finishPaper(career.profile, { start: 'replicate' });
  assert.equal(career.profile.research.papers.length, 1);
  assert.equal(career.profile.achievement, 30);
  assert.deepEqual(careerView(career).research.promotionReasons, []);
  const before = career.profile.funding;
  const stash = structuredClone(career.profile.stash);
  career.profile.research.rng = 1; // Explicit successful review draw after a genuinely earned paper.
  assert.equal(act(career, 'promote').promoted, true);
  assert.equal(career.profile.research.stage, 1);
  assert.equal(career.profile.funding, before + 180);
  assert.deepEqual(career.profile.stash, stash);
  const view = careerView(career).research;
  assert.equal(view.canChooseTalent, false);
  assert.deepEqual(view.talents, []);
  assert.equal(view.talent, null);
  assert.equal(view.lastMilestone.grant, 180);
  assert.equal(view.lastMilestone.acknowledged, false);
  assert.match(view.lastMessage, /经费已到账/);
});

test('every earned stage pays its exact bounded grant once, even with a full warehouse', () => {
  const career = createCareer(88);
  career.profile.stash.dataset = 40;
  const initialStash = structuredClone(career.profile.stash);
  const initialFunds = career.profile.funding;
  let total = 0;
  for (let stage = 1; stage < STAGES.length; stage++) {
    eligible(career, stage);
    const view = careerView(career).research;
    assert.equal(view.promotionPreview.stage, stage);
    assert.equal(view.promotionPreview.grant, PROMOTION_GRANTS[stage]);
    assert.ok(view.promotionPreview.benefits.length >= 1);
    assert.equal(act(career, 'promote').ok, true);
    total += PROMOTION_GRANTS[stage];
    assert.equal(career.profile.funding, initialFunds + total);
    assert.equal(career.profile.research.rewardedStage, stage);
    assert.deepEqual(career.profile.stash, initialStash);
    assert.deepEqual(career.profile.overflow, []);
    const beforeRetry = JSON.stringify(career);
    assert.equal(act(career, 'promote').ok, false);
    assert.equal(JSON.stringify(career), beforeRetry);
    assert.ok(PROMOTION_GRANTS[stage] > 0 && PROMOTION_GRANTS[stage] <= 600);
    assert.equal(act(career, 'milestone:ack').ok, true);
    const acknowledged = JSON.stringify(career);
    assert.equal(act(career, 'milestone:ack').ok, true);
    assert.equal(JSON.stringify(career), acknowledged);
    const restored = migrateCareer(JSON.stringify(career));
    assert.equal(restored.profile.funding, career.profile.funding);
    assert.deepEqual(restored.profile.research, normalizeResearch(career.profile.research));
    assert.equal(restored.profile.research.lastMilestone.acknowledged, true);
  }
  assert.equal(careerView(career).research.promotionPreview, null);
});

test('retired faction actions never spend, grant or mutate anything at any title', () => {
  for (let stage = 0; stage < STAGES.length; stage++) {
    const career = createCareer(23);
    career.profile.research.stage = stage;
    const before = JSON.stringify(career);
    for (const next of [...Object.keys(CAREER_TALENTS), 'missing', '__proto__', 'constructor', 'archivist:again']) {
      assert.equal(act(career, `talent:${next}`).ok, false);
      assert.equal(JSON.stringify(career), before);
    }
    const view = careerView(career).research;
    assert.equal(view.canChooseTalent, false);
    assert.deepEqual(view.talents, []);
    assert.equal(view.talent, null);
  }
});

test('old saves retain earned titles, money and papers without retroactive grants or invented milestones', () => {
  for (let stage = 0; stage < STAGES.length; stage++) {
    const old = createCareer(71);
    eligible(old, stage);
    old.profile.research.stage = stage;
    delete old.profile.research.talent;
    delete old.profile.research.rewardedStage;
    delete old.profile.research.lastMilestone;
    const restored = migrateCareer(JSON.stringify(old));
    assert.equal(restored.profile.funding, old.profile.funding);
    assert.equal(restored.profile.research.stage, stage);
    assert.equal(restored.profile.research.papers.length, old.profile.research.papers.length);
    assert.equal(restored.profile.research.rewardedStage, stage);
    assert.equal(restored.profile.research.lastMilestone, null);
    assert.equal(restored.profile.research.talent, null);
    assert.equal(careerView(restored).research.canChooseTalent, false);
    for (let read = 0; read < 3; read++) {
      const saved = JSON.stringify(restored);
      careerView(restored);
      assert.equal(JSON.stringify(restored), saved);
      assert.deepEqual(migrateCareer(saved), migrateCareer(JSON.stringify(migrateCareer(saved))));
    }
    if (stage < STAGES.length - 1) {
      eligible(restored, stage + 1);
      assert.equal(act(restored, 'promote').ok, true);
      assert.equal(restored.profile.funding, old.profile.funding + PROMOTION_GRANTS[stage + 1]);
    }
  }
});

test('all three old factions convert their earned research benefits exactly once, with forged ranks bounded', () => {
  for (let stage = 0; stage < STAGES.length; stage++) for (const id of Object.keys(CAREER_TALENTS)) {
    const normalized = normalizeResearch({ stage, talent: { id, rank: 999 }, rewardedStage: -5,
      lastMilestone: { stage, grant: 999999, acknowledged: true } });
    assert.deepEqual(normalizeResearch(normalized), normalized);
    assert.equal(normalized.talent, null);
    const oldBenefit = careerTalentBenefits(normalizeCareerTalent({ id, rank: 999 }, stage));
    for (const key of ['initialQuality', 'experimentQuality', 'publicationGrant']) {
      assert.equal(normalized.legacySupport?.[key] || 0, oldBenefit?.[key] || 0, `${id}/${stage}/${key}`);
    }
    assert.equal(normalized.rewardedStage, stage);
    assert.equal(normalized.lastMilestone?.grant ?? 0, PROMOTION_GRANTS[stage]);
  }
  for (const talent of [null, {}, [], 'missing', '__proto__', 'constructor', { id: 'missing', rank: 999 }]) {
    const normalized = normalizeResearch({ stage: 5, talent, lastMilestone: { stage: 99, grant: 9999 } });
    assert.equal(normalized.talent, null);
    assert.equal(normalized.lastMilestone, null);
    assert.deepEqual(normalizeResearch(normalized), normalized);
  }
  assert.equal(normalizeCareerTalent('archivist', 0), null);
  assert.equal(talentRankForStage(Infinity), 0);
  const profile = researchProfile(1, 'archivist');
  profile.research.rewardedStage = 2;
  eligible({ profile }, 2);
  const funds = profile.funding;
  assert.equal(researchAct(profile, 'promote').ok, true);
  assert.equal(profile.funding, funds);
  assert.equal(profile.research.lastMilestone.grant, 0);
});

test('converted research support has real effects and never requires a new faction choice', () => {
  for (const [stage, rank] of [[1, 1], [3, 2], [6, 3]]) {
    const base = researchProfile(stage);
    const archive = researchProfile(stage, 'archivist');
    assert.equal(researchAct(base, 'start:replicate').ok, true);
    assert.equal(researchAct(archive, 'start:replicate').ok, true);
    assert.equal(archive.research.project.quality - base.research.project.quality, 3 * rank);
    const tinkerer = researchProfile(stage, 'tinkerer');
    researchAct(tinkerer, 'start:replicate');
    assert.equal(researchAct(base, 'experiment').ok, true);
    assert.equal(researchAct(tinkerer, 'experiment').ok, true);
    assert.ok(tinkerer.research.project.quality > base.research.project.quality, 'converted support has a real bounded benefit under the same seeded experiment');
    const plainPublication = researchProfile(stage);
    const connector = researchProfile(stage, 'connector');
    finishPaper(plainPublication, { start: 'replicate' }); finishPaper(connector, { start: 'replicate' });
    assert.equal(connector.funding - plainPublication.funding, 10 * rank);
    const funded = JSON.stringify(connector);
    assert.equal(researchAct(connector, 'publish').ok, false);
    assert.equal(JSON.stringify(connector), funded);
  }
});

test('converted benefits survive every later promotion without growing from retired faction ranks', () => {
  for (const id of Object.keys(CAREER_TALENTS)) {
    const career = createCareer(87);
    career.profile.research = normalizeResearch({ stage: 1, talent: { id, rank: 1 } });
    const support = structuredClone(career.profile.research.legacySupport);
    for (let stage = 2; stage < STAGES.length; stage++) {
      eligible(career, stage);
      assert.equal(act(career, 'promote').ok, true);
      assert.equal(career.profile.research.talent, null);
      assert.deepEqual(career.profile.research.legacySupport, support);
      assert.deepEqual(migrateCareer(JSON.stringify(career)).profile.research.legacySupport, support);
      const view = careerView(career).research;
      assert.deepEqual(view.talents, []);
      if (stage === 2) assert.ok(view.lastMilestone.benefits.includes('新地点：AI 实验室访学'));
      if (stage === 4) assert.ok(view.lastMilestone.benefits.includes('新地点：企业联合研究'));
    }
  }
});

test('progression views are pure, factual and contain no faction selection or outcome predictions', () => {
  for (let stage = 0; stage < STAGES.length; stage++) {
    const profile = researchProfile(stage, stage ? 'tinkerer' : null);
    const before = JSON.stringify(profile);
    const first = researchView(profile);
    assert.deepEqual(researchView(profile), first);
    assert.equal(JSON.stringify(profile), before);
    for (const item of [first.promotionPreview, first.lastMilestone]) noForecastProse(item);
    assert.equal(first.talent, null);
    assert.deepEqual(first.talents, []);
    assert.equal(first.canChooseTalent, false);
  }
});
