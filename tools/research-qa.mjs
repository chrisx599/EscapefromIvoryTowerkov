import assert from 'node:assert/strict';
import { researchAct } from '../src/research.js';

// Exercise the public loop, including real returned reviews. Never make a
// publication fixture by assigning status, quality, accepted papers or rewards.
export function nextResearchAction(research) {
  const project = research.project;
  if (!project) return null;
  if (project.status === 'ready') return 'publish';
  if (project.status === 'submitted') return 'review';
  assert.ok(['experiment', 'revision', 'rejected'].includes(project.status));
  const minimumRuns = project.minimumRuns ?? (project.balanceVersion >= 2 ? 3 + (project.scope || 0) : 2);
  return project.runs >= minimumRuns && project.runs > (project.submittedRuns || 0) ? 'submit' : 'experiment';
}

export function finishPaper(profile, { start = null, act = action => researchAct(profile, action), onExperiment = null } = {}) {
  const checked = action => {
    const result = act(action);
    assert.equal(result.ok, true, `${action}: ${result.reason || ''}`);
  };
  if (start) checked(`start:${start}`);
  const before = profile.research.papers.length;
  let steps = 0;
  let runs = 0;
  let returns = 0;
  while (profile.research.project) {
    assert.ok(steps < 72, 'a paid project must recover to publication in a finite number of real actions');
    const next = nextResearchAction(profile.research);
    if (next === 'experiment') { onExperiment?.(profile.research.project); runs += 1; }
    checked(next);
    if (next === 'review' && profile.research.project.status !== 'ready') returns += 1;
    steps += 1;
  }
  assert.equal(profile.research.papers.length, before + 1);
  return { steps, runs, returns };
}
