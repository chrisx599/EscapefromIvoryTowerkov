import test from 'node:test';
import assert from 'node:assert/strict';
import { createCareer, careerView, migrateCareer } from '../src/career.js';
import { renderResearchWorkbench } from '../public/research-workbench.js';
import { finishPaper } from './research-qa.mjs';

const button = (id, label, disabled) => `<button data-hub-action="${id}"${disabled ? ' disabled' : ''}>${label}</button>`;
const escapeHtml = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function fixture(paperCount) {
  const career = createCareer(123456789);
  career.profile.funding = 100000;
  Object.assign(career.profile.stash, { dataset: 20, src_code: 20, compute: 100 });
  for (let index = 0; index < paperCount; index++) finishPaper(career.profile, { start: 'replicate' });
  // Distinctive metadata catches title leaks even when a historic title contains markup.
  for (const [index, paper] of career.profile.research.papers.entries()) paper.title = `私有论文标题-${index + 1}-<特别研究&证据>`;
  return career;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function assertSummary(career, expectedCount) {
  const savedBefore = structuredClone(career);
  const hub = careerView(career);
  const hubBefore = structuredClone(hub);
  freeze(hub);
  const html = renderResearchWorkbench({ hub, items: hub.items, button });
  const summary = html.match(/<div id="research-papers"[^>]*>[\s\S]*?<\/div>/)?.[0];
  assert.ok(summary, 'accepted papers have one always-visible summary');
  assert.equal((html.match(/id="research-papers"/g) || []).length, 1);
  assert.match(summary, /已录用论文/);
  assert.match(summary, new RegExp(`data-paper-count="${expectedCount}"`));
  assert.match(summary, new RegExp(`>${expectedCount.toLocaleString('zh-CN')}\\s*<small>篇<\\/small>`));
  assert.doesNotMatch(summary, /<(?:details|summary|ul|ol|li|button)\b|质量|发表成果/);
  assert.doesNotMatch(html, /data-research-detail="papers"/);
  for (const paper of hub.research.papers || []) {
    assert.equal(html.includes(paper.title), false, 'the old title list cannot survive elsewhere in hidden markup');
    assert.equal(html.includes(escapeHtml(paper.title)), false, 'escaping a title is not hiding its now-unwanted detail');
  }
  assert.equal(renderResearchWorkbench({ hub, items: hub.items, button }), html, 'repeat rendering is deterministic');
  assert.deepEqual(hub, hubBefore, 'rendering is read-only even with deeply frozen source records');
  assert.deepEqual(career, savedBefore, 'the complete saved career, paper records, rewards and random state are retained');
  assert.equal((html.match(/data-research-primary="true"/g) || []).length, 1, 'the actual next research action remains prominent');
  const primaryAction = expectedCount ? 'research:promote' : 'research:start:replicate';
  assert.match(html, new RegExp(`<button[^>]*data-research-primary="true"[^>]*data-hub-action="${primaryAction}"`));
}

for (const paperCount of [0, 1, 12]) {
  test(`${paperCount} accepted papers render only their total without changing their records or next action`, () => {
    assertSummary(fixture(paperCount), paperCount);
  });
}

test('legacy accepted papers retain their historic titles and earned fields while rendering only their total', () => {
  const old = fixture(3);
  for (const paper of old.profile.research.papers) delete paper.evidence;
  const historicalPapers = structuredClone(old.profile.research.papers);
  const migrated = migrateCareer(JSON.stringify(old));
  assert.equal(migrated.profile.research.papers.length, historicalPapers.length);
  for (const [index, paper] of migrated.profile.research.papers.entries()) {
    for (const [key, value] of Object.entries(historicalPapers[index])) assert.deepEqual(paper[key], value);
    assert.equal(paper.evidence, paper.quality, 'existing migration still recovers the legacy evidence value');
  }
  assertSummary(migrated, 3);
  assert.deepEqual(migrateCareer(JSON.stringify(migrated)).profile.research, migrated.profile.research);
});

test('an omitted historical paper collection renders zero without manufacturing records', () => {
  const hub = careerView(fixture(0));
  delete hub.research.papers;
  const before = structuredClone(hub);
  const html = renderResearchWorkbench({ hub: freeze(hub), items: hub.items, button });
  assert.match(html, /id="research-papers"[^>]*>[\s\S]*?data-paper-count="0"/);
  assert.deepEqual(hub, before);
  assert.equal(Object.hasOwn(hub.research, 'papers'), false);
});
