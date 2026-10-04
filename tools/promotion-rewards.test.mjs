import test from 'node:test';
import assert from 'node:assert/strict';
import { createCareer, migrateCareer, careerView, hubAct } from '../src/career.js';
import { normalizeResearch, researchView, researchAct, PROMOTION_GRANTS, STAGES } from '../src/research.js';
import { CAREER_TALENTS, talentRankForStage, normalizeCareerTalent } from '../public/career-talents.js';

const act = (career, action) => hubAct(career, `research:${action}`);
function eligible(career, stage) {
  const requirement = STAGES[stage];
  const research = career.profile.research;
  research.papers = Array.from({ length: requirement.papers }, (_, index) => ({ id: `paper-${index + 1}`,
    type: 'replicate', title: `研究 ${index + 1}`, quality: 80, credit: 30, day: index }));
  career.profile.achievement = requirement.credit;
  research.skills = { engineering: (requirement.skill - 1) * 3, research: (requirement.skill - 1) * 3,
    expression: Math.max(0, requirement.skill - 2) * 3 };
}
function researchProfile(stage, talent = null) {
  const profile = createCareer(91234).profile;
  profile.research = normalizeResearch({ stage, talent, skills: { engineering: 27, research: 27, expression: 27 } }, 91234);
  profile.funding = 10000;
  Object.assign(profile.stash, { dataset: 10, src_code: 10, wind: 10, compute: 30, remote_terminal: 1 });
  profile.loadout.device = 'remote_terminal';
  return profile;
}
function publish(profile) {
  const checked = action => {
    const result = researchAct(profile, action);
    assert.equal(result.ok, true, result.reason);
  };
  checked('start:replicate');
  while (profile.research.project.runs < 2 || profile.research.project.quality < researchView(profile).project.target) checked('experiment');
  checked('submit'); checked('review'); checked('publish');
}
function noProbabilityProse(value) {
  if (typeof value === 'string') assert.doesNotMatch(value, /\d(?:\.\d+)?\s*[%％]|百分点/);
  else if (Array.isArray(value)) value.forEach(noProbabilityProse);
  else if (value && typeof value === 'object') Object.values(value).forEach(noProbabilityProse);
}

test('the existing first-paper path reaches promotion and pays immediately without extra grind', () => {
  const career = createCareer(91234);
  Object.assign(career.profile.stash, { dataset: 1, src_code: 1, compute: 6 });
  publish(career.profile);
  assert.equal(career.profile.research.papers.length, 1);
  assert.equal(career.profile.achievement, 30);
  assert.deepEqual(careerView(career).research.promotionReasons, []);
  const before = career.profile.funding;
  const stash = structuredClone(career.profile.stash);
  assert.equal(act(career, 'promote').ok, true);
  assert.equal(career.profile.research.stage, 1);
  assert.equal(career.profile.funding, before + 180);
  assert.deepEqual(career.profile.stash, stash);
  const view = careerView(career).research;
  assert.equal(view.canChooseTalent, true);
  assert.equal(view.talents.length, 3);
  assert.ok(view.talents.every(row => !row.disabled));
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

test('all talents are permanent choices, with no reward or resource farming through reselects', () => {
  for (const id of Object.keys(CAREER_TALENTS)) {
    const career = createCareer(23);
    const beforePromotion = JSON.stringify(career);
    assert.equal(act(career, `talent:${id}`).ok, false);
    assert.equal(JSON.stringify(career), beforePromotion);
    eligible(career, 1);
    act(career, 'promote');
    const funds = career.profile.funding;
    const inventory = structuredClone(career.profile.stash);
    assert.equal(act(career, `talent:${id}`).ok, true);
    assert.deepEqual(career.profile.research.talent, { id, rank: 1 });
    assert.equal(career.profile.funding, funds);
    assert.deepEqual(career.profile.stash, inventory);
    const chosen = JSON.stringify(career);
    for (const next of [...Object.keys(CAREER_TALENTS), 'missing', '__proto__', 'constructor', `${id}:again`]) {
      assert.equal(act(career, `talent:${next}`).ok, false);
      assert.equal(JSON.stringify(career), chosen);
    }
    const view = careerView(career).research;
    assert.equal(view.canChooseTalent, false);
    assert.equal(view.talents.filter(row => row.selected).length, 1);
    assert.ok(view.talents.every(row => row.disabled));
    const restored = migrateCareer(chosen);
    assert.deepEqual(restored.profile.research.talent, { id, rank: 1 });
    assert.equal(act(restored, `talent:${id}`).ok, false);
  }
});

test('old saves choose once at their earned rank without retroactive grants or invented milestones', () => {
  for (let stage = 0; stage < STAGES.length; stage++) {
    const old = createCareer(71);
    eligible(old, stage);
    old.profile.research.stage = stage;
    delete old.profile.research.talent;
    delete old.profile.research.rewardedStage;
    delete old.profile.research.lastMilestone;
    const restored = migrateCareer(JSON.stringify(old));
    assert.equal(restored.profile.funding, old.profile.funding);
    assert.equal(restored.profile.research.rewardedStage, stage);
    assert.equal(restored.profile.research.lastMilestone, null);
    assert.equal(restored.profile.research.talent, null);
    assert.equal(careerView(restored).research.canChooseTalent, stage > 0);
    assert.equal(act(restored, 'talent:archivist').ok, stage > 0);
    if (stage > 0) assert.deepEqual(restored.profile.research.talent, { id: 'archivist', rank: talentRankForStage(stage) });
    assert.equal(restored.profile.funding, old.profile.funding);
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

test('normalization is idempotent, distrusts saved talent rank, and keeps invalid identities neutral', () => {
  for (let stage = 0; stage < STAGES.length; stage++) for (const id of Object.keys(CAREER_TALENTS)) {
    const normalized = normalizeResearch({ stage, talent: { id, rank: 999 }, rewardedStage: -5,
      lastMilestone: { stage, grant: 999999, acknowledged: true } });
    assert.deepEqual(normalizeResearch(normalized), normalized);
    assert.deepEqual(normalized.talent, stage ? { id, rank: talentRankForStage(stage) } : null);
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
  // A higher recorded reward mark is never moved backwards or paid a second time.
  const profile = researchProfile(1, 'archivist');
  profile.research.rewardedStage = 2;
  const career = { profile };
  eligible(career, 2);
  const funds = profile.funding;
  assert.equal(researchAct(profile, 'promote').ok, true);
  assert.equal(profile.funding, funds);
  assert.equal(profile.research.lastMilestone.grant, 0);
});

test('promotion ranks have real bounded research effects for every identity', () => {
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
    assert.equal(tinkerer.research.project.quality - base.research.project.quality, rank);
    const plainPublication = researchProfile(stage);
    const connector = researchProfile(stage, 'connector');
    publish(plainPublication); publish(connector);
    assert.equal(connector.funding - plainPublication.funding, 10 * rank);
    const funded = JSON.stringify(connector);
    assert.equal(researchAct(connector, 'publish').ok, false);
    assert.equal(JSON.stringify(connector), funded);
  }
});

test('chosen identity improves only at earned milestones and survives every later promotion', () => {
  for (const id of Object.keys(CAREER_TALENTS)) {
    const career = createCareer(87);
    for (let stage = 1; stage < STAGES.length; stage++) {
      eligible(career, stage);
      assert.equal(act(career, 'promote').ok, true);
      if (stage === 1) assert.equal(act(career, `talent:${id}`).ok, true);
      assert.deepEqual(career.profile.research.talent, { id, rank: talentRankForStage(stage) });
      assert.deepEqual(migrateCareer(JSON.stringify(career)).profile.research.talent, career.profile.research.talent);
      const view = careerView(career).research;
      assert.equal(view.talent.rank, talentRankForStage(stage));
      assert.ok(view.talent.perks.length >= 2);
      if (stage === 3 || stage === 6) assert.ok(view.lastMilestone.benefits.some(text => text.includes(`升至 ${talentRankForStage(stage)} 级`)));
      if (stage === 2) assert.ok(view.lastMilestone.benefits.includes('新地点：AI 实验室访学'));
      if (stage === 4) assert.ok(view.lastMilestone.benefits.includes('新地点：企业联合研究'));
    }
  }
});

test('progression views stay pure and use clear qualitative active-ability language', () => {
  for (let stage = 0; stage < STAGES.length; stage++) {
    const profile = researchProfile(stage, stage ? 'tinkerer' : null);
    const before = JSON.stringify(profile);
    const first = researchView(profile);
    assert.deepEqual(researchView(profile), first);
    assert.equal(JSON.stringify(profile), before);
    for (const item of [first.talent, first.talents, first.promotionPreview, first.lastMilestone]) noProbabilityProse(item);
    for (const row of first.talents) {
      assert.ok(row.description && row.activeName && row.activeDescription && row.researchPerk);
      assert.ok(row.activeDescription.includes('每次远征'));
      assert.match(row.actionId, /^research:talent:(archivist|connector|tinkerer)$/);
    }
  }
});

test('failed promotions, unknown identities, and unknown milestone operations are atomic', () => {
  const career = createCareer(981);
  const initial = JSON.stringify(career);
  for (const action of ['promote', 'talent:missing', 'talent:__proto__', 'milestone:ack', 'milestone:claim', 'milestone:ack:again']) {
    assert.equal(act(career, action).ok, false);
    assert.equal(JSON.stringify(career), initial);
  }
  eligible(career, 1);
  Object.assign(career.profile.stash, { dataset: 1, src_code: 1 });
  assert.equal(act(career, 'start:replicate').ok, true);
  const activeProject = JSON.stringify(career);
  assert.equal(act(career, 'promote').ok, false);
  assert.equal(JSON.stringify(career), activeProject);
  assert.ok(careerView(career).research.promotionPreview);
});
