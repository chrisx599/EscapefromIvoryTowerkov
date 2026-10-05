// Internal, pure probability mechanics. Outcomes consume one persisted RNG draw
// in researchAct; none of these forecasts or inputs are sent to the UI.
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export const bounded = (value, min, max) => Math.max(min, Math.min(max, finite(value)));
const diminishing = (value, scale) => value / (value + scale);
const skill = value => diminishing(Math.max(0, value - 1), 4);

export function researchFactors(input = {}) {
  return {
    quality: bounded(input.quality, 0, 100), evidence: bounded(input.evidence, 0, 100),
    engineering: bounded(input.engineering, 1, 10), research: bounded(input.research, 1, 10),
    expression: bounded(input.expression, 1, 10), preparation: bounded(input.preparation, 0, 2),
    equipment: bounded(input.equipment, 0, 12), headroom: bounded(input.headroom, 0, 2),
    experience: bounded(input.experience, 0, 30), topicFit: input.topicFit === true,
    scope: bounded(input.scope, 0, 2), support: bounded(input.support, 0, 6),
    stage: bounded(input.stage, 0, 8), runs: bounded(input.runs, 0, 100000),
    reviewFailures: bounded(input.reviewFailures, 0, 100000), repair: input.repair === true,
  };
}

export function experimentProbability(input = {}) {
  const f = researchFactors(input);
  return bounded(0.435 + 0.075 * skill(f.engineering) + 0.065 * skill(f.research)
    + 0.07 * diminishing(f.equipment, 5) + 0.03 * f.headroom / 2
    + 0.05 * f.preparation / 2 + 0.035 * Number(f.topicFit)
    + 0.075 * diminishing(f.experience, 10) + 0.045 * f.quality / 100
    + 0.035 * f.evidence / 100 + 0.02 * f.support / 6
    - 0.035 * f.scope - 0.004 * f.stage, 0.30, 0.85);
}

export function experimentOutcome(input, draw) {
  const f = researchFactors(input);
  const success = bounded(draw, 0, 1) < experimentProbability(f);
  let qualityGain = success ? 13 + Math.floor(3 * skill(f.engineering) + 3 * skill(f.research)
    + 5 * diminishing(f.equipment, 5) + f.preparation * 2 + Number(f.topicFit) * 2
    + 2 * diminishing(f.experience, 10) + f.support)
    : 8 + Math.floor(1.5 * skill(f.engineering) + 1.5 * skill(f.research) + f.preparation + f.support / 2);
  let evidenceGain = success ? 14 + Math.floor(5 * skill(f.research)
    + 3 * diminishing(f.equipment, 5) + f.preparation * 2 + 3 * diminishing(f.experience, 10))
    : 6 + Math.floor(2 * skill(f.research) + f.preparation);
  // After five genuinely paid runs, institutional support reuses this project's
  // own data. Repair advances evidence but does not manufacture a success/XP.
  if (f.repair) { qualityGain = Math.max(15, qualityGain); evidenceGain = Math.max(20, evidenceGain); }
  return { success, qualityGain, evidenceGain };
}

export function reviewProbability(input = {}, type = 'replicate') {
  const f = researchFactors(input);
  if (f.quality < 60 + f.scope * 5 || f.evidence < 40 + f.scope * 10) return 0;
  const difficulty = { replicate: 0, evaluate: 0.02, finetune: 0.04 }[type] ?? 0;
  return bounded(0.20 + 0.24 * f.quality / 100 + 0.23 * f.evidence / 100
    + 0.08 * skill(f.expression) + 0.045 * f.preparation / 2 + 0.035 * Number(f.topicFit)
    + 0.06 * diminishing(f.experience, 10) + 0.025 * diminishing(f.equipment, 5)
    + 0.025 * skill(f.research) - 0.035 * f.scope - 0.004 * f.stage - difficulty, 0.20, 0.90);
}

export function reviewOutcome(input, draw, type = 'replicate') {
  const f = researchFactors(input);
  // This is an explicit finite supported-review exception, not an inflated
  // probability. It requires actual revised work and four previous failures.
  const supported = f.reviewFailures >= 4 && f.runs >= 6 && f.quality >= 80 && f.evidence >= 65;
  const accepted = supported || bounded(draw, 0, 1) < reviewProbability(f, type);
  const status = accepted ? 'ready' : f.quality < 60 || f.evidence < 45 ? 'rejected' : 'revision';
  const issue = f.evidence < 65 ? '对照证据还不充分' : f.quality < 80 ? '实验结论仍需核实' : '对照结论尚未获审稿认可';
  return { status, issue: accepted ? null : issue, supported };
}

export function promotionProbability(input = {}) {
  const stage = bounded(input.stage, 1, 8);
  const paperSurplus = bounded(input.paperSurplus, 0, 1000);
  const creditSurplus = bounded(input.creditSurplus, 0, 100);
  const skillSurplus = bounded(input.skillSurplus, 0, 9);
  return bounded(0.53 + 0.06 * diminishing(paperSurplus, 3)
    + 0.05 * diminishing(creditSurplus, 1) + 0.045 * diminishing(skillSurplus, 3)
    + 0.04 * bounded(input.representative, 0, 1) + 0.035 * bounded(input.practice, 0, 1)
    - 0.006 * stage + 0.04 * bounded(input.failures, 0, 2), 0.48, 0.82);
}

// Grandfather only projects that were already in progress before balance v2.
// Their saved readiness, investment, and original acceptance contract survive.
export function legacyExperimentOutcome(input, draw) {
  const f = researchFactors(input);
  const readiness = bounded(0.42 + f.engineering * 0.023 + f.research * 0.017
    + f.equipment * 0.016 + f.headroom * 0.035 + f.preparation * 0.045
    + Number(f.topicFit) * 0.07 + f.quality * 0.0012 + f.experience * 0.006
    + f.evidence * 0.0005 - f.scope * 0.035, 0.3, 0.95);
  const success = bounded(draw, 0, 1) < readiness;
  const knowledge = Math.min(8, f.engineering + f.research);
  const qualityGain = Math.floor((success ? 14 + knowledge + f.equipment + Number(f.topicFit) * 3
    : 7 + Math.min(4, Math.floor(knowledge / 2))) + f.preparation * 2
    + Math.floor(f.experience / 6) + f.support);
  const evidenceGain = Math.floor((success ? 18 + f.research + Math.floor(f.equipment / 2)
    : 6 + Math.floor(f.research / 2)) + f.preparation * 2 + Math.floor(f.experience / 8));
  return { success, qualityGain, evidenceGain };
}

export function legacyReviewOutcome(input, draw, type = 'replicate') {
  const f = researchFactors(input);
  const threshold = ({ replicate: 66, evaluate: 69, finetune: 73 }[type] || 66) + f.scope * 3;
  const assessment = f.quality * 0.62 + f.evidence * 0.23
    + Math.min(8, f.expression * 1.5) + Math.min(7, f.experience * 0.25)
    + f.preparation * 2 + Number(f.topicFit) * 3 + (bounded(draw, 0, 1) * 12 - 6);
  const status = assessment >= threshold ? 'ready' : assessment >= threshold - 15 ? 'revision' : 'rejected';
  const issue = f.evidence < 65 ? '对照证据还不充分' : f.quality < 80 ? '实验结论仍需核实' : '方法说明需要补充';
  return { status, issue: status === 'ready' ? null : issue, supported: false };
}
