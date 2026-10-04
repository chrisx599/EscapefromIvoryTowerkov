// Bounded, pure mechanics. These are internal outcome inputs, never forecasts in
// the player view. A saved RNG draw is supplied by the state-changing action.
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export const bounded = (value, min, max) => Math.max(min, Math.min(max, finite(value)));

export function researchFactors(input = {}) {
  return {
    quality: bounded(input.quality, 0, 100), evidence: bounded(input.evidence, 0, 100),
    engineering: bounded(input.engineering, 1, 10), research: bounded(input.research, 1, 10),
    expression: bounded(input.expression, 1, 10), preparation: bounded(input.preparation, 0, 2),
    equipment: bounded(input.equipment, 0, 12), headroom: bounded(input.headroom, 0, 2),
    experience: bounded(input.experience, 0, 30), topicFit: input.topicFit === true,
    scope: bounded(input.scope, 0, 2), support: bounded(input.support, 0, 6),
  };
}

export function experimentOutcome(input, draw) {
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

export function reviewOutcome(input, draw, type = 'replicate') {
  const f = researchFactors(input);
  const threshold = ({ replicate: 66, evaluate: 69, finetune: 73 }[type] || 66) + f.scope * 3;
  const assessment = f.quality * 0.62 + f.evidence * 0.23
    + Math.min(8, f.expression * 1.5) + Math.min(7, f.experience * 0.25)
    + f.preparation * 2 + Number(f.topicFit) * 3 + (bounded(draw, 0, 1) * 12 - 6);
  const status = assessment >= threshold ? 'ready' : assessment >= threshold - 15 ? 'revision' : 'rejected';
  // Explain actual evidence gaps only after a review. It is never a numerical
  // promise about a future submission; another run is required before retrying.
  const issue = f.evidence < 65 ? '对照证据还不充分' : f.quality < 80 ? '实验结论仍需核实' : '方法说明需要补充';
  return { status, issue: status === 'ready' ? null : issue };
}
