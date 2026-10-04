// One vocabulary for live previews, setup, events, and saved-game presentation.
// These functions are deliberately pure: presentation never consumes a raid roll.
export function likelihoodLabel(value) {
  const probability = Math.max(0, Math.min(100, Number(value) || 0));
  return probability >= 90 ? '把握很大' : probability >= 70 ? '较有把握'
    : probability >= 45 ? '尚有机会' : probability >= 20 ? '不太容易'
      : probability > 0 ? '希望渺茫' : '暂无机会';
}

export function riskLabel(value) {
  const risk = Math.max(0, Math.min(100, Number(value) || 0));
  return risk < 25 ? '从容' : risk < 50 ? '需留心' : risk < 75 ? '紧张' : '险峻';
}

export function encounterLabel(value) {
  const chance = Math.max(0, Math.min(100, Number(value) || 0));
  return chance === 0 ? '暂时平静' : chance >= 80 ? '动静频繁' : chance >= 45 ? '容易遇事' : '偶有动静';
}
