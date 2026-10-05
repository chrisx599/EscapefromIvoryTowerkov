/** Versioned, pure probability rules. All values are percentage points; no RNG
 * or game-state mutation belongs here. v3 raid calculations remain in their
 * original branches in probability-raid.js until those raids are settled. */
export const RAID_BALANCE_VERSION = 4;

export const RAID_DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ name: '新手', description: '轻松探索，熟悉现场。',
    acquisitionModifier: 6, riskModifier: -3, eventModifier: 7, extraDropModifier: 0, failModifier: -2, partialModifier: -1 }),
  normal: Object.freeze({ name: '标准', description: '常规远征。',
    acquisitionModifier: 0, riskModifier: 0, eventModifier: 0, extraDropModifier: 0, failModifier: 0, partialModifier: 0 }),
  hard: Object.freeze({ name: '挑战', description: '深入险境。',
    acquisitionModifier: -8, riskModifier: 4, eventModifier: -9, extraDropModifier: 18, failModifier: 4, partialModifier: 3 }),
});

const bound = (value, low, high) => Math.min(high, Math.max(low, Number(value) || 0));
const round = value => Math.round(value * 10) / 10;
const difficulty = value => Object.hasOwn(RAID_DIFFICULTIES, value) ? RAID_DIFFICULTIES[value] : RAID_DIFFICULTIES.normal;

/** Gains diminish at every level, rather than reaching a linear immunity cap. */
export function raidDiminishingSkill(level, scale = 1) {
  const trained = Math.floor(bound(level, 1, 10)) - 1;
  return bound(scale, 0, 100) * trained / (trained + 3);
}

function pressure(input) {
  const risk = bound(input.risk, 0, 100);
  const depth = bound(input.depth, 0, 4);
  const searches = Math.floor(bound(input.searches, 0, 40));
  const willRatio = bound(bound(input.will ?? input.willMax ?? 10, 0, 100) / bound(input.willMax ?? 10, 1, 100), 0, 1);
  const loadRatio = bound(bound(input.load, 0, 1000) / bound(input.capacity ?? 6, 1, 1000), 0, 1);
  const loadPressure = bound((loadRatio - 0.6) / 0.4, 0, 1);
  const fatiguePressure = bound((0.35 - willRatio) / 0.35, 0, 1);
  const familiarity = Math.min(bound(input.stage, 0, 7), bound(input.venueMinStage, 0, 7));
  return { risk, depth, searches, willRatio, loadRatio, loadPressure, fatiguePressure, familiarity };
}

export function raidSearchProbability(input = {}) {
  const p = pressure(input);
  const parts = {
    base: 56,
    researchBonus: raidDiminishingSkill(input.research, 24),
    gear: bound(input.searchGear, 0, 4),
    familiarity: 0.5 * p.familiarity,
    acquisitionModifier: difficulty(input.difficulty).acquisitionModifier,
    difficulty: bound(input.venueDifficulty, 0, 30),
    context: bound(input.contextAcquisition, -25, 25),
    riskPenalty: 0.1 * p.risk,
    depthPenalty: 2 * p.depth,
    durationPenalty: 1.2 * Math.max(0, p.searches - 2),
    fatiguePenalty: Math.max(0, 0.5 - p.willRatio) * 10,
    loadPenalty: Math.max(0, p.loadRatio - 0.65) * 6,
  };
  const chance = round(bound(parts.base + parts.researchBonus + parts.gear + parts.familiarity
    + parts.acquisitionModifier - parts.difficulty + parts.context - parts.riskPenalty
    - parts.depthPenalty - parts.durationPenalty - parts.fatiguePenalty - parts.loadPenalty, 12, 84));
  return { chance, ...parts };
}

export function raidRiskAfterSearch(input = {}) {
  const p = pressure(input);
  const growth = Math.max(1, bound(input.venueGrowth, 0, 30) + difficulty(input.difficulty).riskModifier
    + bound(input.contextRisk, -10, 10) + 0.7 * p.depth + 0.25 * Math.max(0, p.searches - 3)
    - raidDiminishingSkill(input.engineering, 2));
  return round(bound(p.risk + growth, 0, 100));
}

export function raidExtractionProbabilities(input = {}) {
  const p = pressure(input);
  const d = difficulty(input.difficulty);
  const engineeringBonus = raidDiminishingSkill(input.engineering, 3.5);
  const expressionBonus = raidDiminishingSkill(input.expression, 3.5);
  const storageBonus = bound(input.storageBonus, 0, 3);
  const support = bound(input.support, 0, 8);
  const contextFail = bound(input.contextFail, -5, 5);
  const contextPartial = bound(input.contextPartial, -8, 8);
  const baseRisk = bound(input.venueBaseRisk, 0, 30);
  const loadPenalty = 5 * p.loadPressure;
  const durationPenalty = 0.45 * Math.max(0, p.searches - 2);
  const fatiguePenalty = 3 * p.fatiguePressure;
  const fail = round(bound(4 + 0.25 * baseRisk + 0.18 * p.risk + 0.0012 * p.risk ** 2
    + 1.4 * p.depth + durationPenalty + loadPenalty + fatiguePenalty + d.failModifier + contextFail
    - engineeringBonus - storageBonus - 0.25 * p.familiarity, 3, 42));
  const partial = round(bound(9 + 0.18 * p.risk + 0.65 * p.depth + 0.3 * Math.max(0, p.searches - 2)
    + 3 * p.loadPressure + 2 * p.fatiguePressure + d.partialModifier + contextPartial
    - expressionBonus - support, 6, 36));
  const full = round(100 - fail - partial);
  return { full, partial, fail, parts: {
    baseRisk, risk: p.risk, loadPenalty: round(loadPenalty), engineeringBonus: round(engineeringBonus),
    storageBonus, expressionBonus: round(expressionBonus), support,
    contextFail, contextPartial, depth: p.depth, durationPenalty: round(durationPenalty),
    fatiguePenalty: round(fatiguePenalty), difficultyFail: d.failModifier,
    difficultyPartial: d.partialModifier, familiarity: round(0.25 * p.familiarity),
    sum: round(full + partial + fail),
  } };
}

export function raidEventProbability(input = {}) {
  if (input.unchecked) return 100;
  const p = pressure(input);
  // Neutral encounters already persist a seeded base and shuffled options.
  // Preserve that variation, but use the same bounded pressure/ability model.
  const base = bound(input.base, 0, 100) - (input.neutral ? 5 : 0);
  const ability = input.hasSkill ? raidDiminishingSkill(input.skillLevel, input.neutral ? 18 : bound(input.skillCap, 0, 24)) : 0;
  const evidence = bound(input.evidenceBonus, 0, 12);
  const gear = bound(input.gearBonus, 0, 8);
  const communication = bound(input.communicationBonus, 0, 5);
  const trust = bound(input.trustBonus, -6, 6);
  const penalty = 0.08 * p.risk + 0.8 * p.depth + 3 * p.fatiguePressure + 1.5 * p.loadPressure;
  return round(bound(base + ability + evidence + gear + communication + trust
    + difficulty(input.difficulty).eventModifier + bound(input.contextCheck, -12, 12)
    + 0.25 * p.familiarity - penalty - bound(input.eventDifficulty, 0, 25), 18, 88));
}

export function raidExtraDropChance(input = {}) {
  return round(bound(bound(input.baseExtraDrop, 0, 100) + difficulty(input.difficulty).extraDropModifier
    + bound(input.contextExtraDrop, -15, 20), 0, 75));
}
