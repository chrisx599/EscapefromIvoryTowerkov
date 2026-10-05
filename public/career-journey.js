const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list = value => Array.isArray(value) ? value : [];
// Ignore retired style rewards even if a cached/legacy milestone reaches the UI.
const visibleBenefits = benefits => list(benefits).filter(line => !/（一次性）|流派|专长|主动能力|档案派|联络派|巧匠派/.test(line));

export function renderCareerMilestone(research, button) {
  const milestone = research.lastMilestone;
  if (!milestone || milestone.acknowledged) return '';
  const benefits = visibleBenefits(milestone.benefits);
  return `<section id="promotion-celebration" class="career-milestone" aria-labelledby="promotion-title"><span class="promotion-seal" aria-hidden="true">晋</span><div class="milestone-copy"><span class="journey-kicker">职称升级</span><h3 id="promotion-title">${esc(milestone.stageName)}</h3><p class="promotion-grant">支持经费 <b>+${esc(milestone.grant)}</b> <small>已到账</small></p>${benefits.length ? `<details class="milestone-benefits" data-research-detail="milestone"><summary>本次解锁</summary><ul>${benefits.map(line => `<li>${esc(line)}</li>`).join('')}</ul></details>` : ''}</div>${button('research:milestone:ack', '继续研究', false)}</section>`;
}

export function renderPromotionPreview(preview) {
  if (!preview) return '';
  return `<div class="promotion-preview"><span>晋升支持</span><b>+${esc(preview.grant)} 经费</b>${visibleBenefits(preview.benefits).map(line => `<small>${esc(line)}</small>`).join('')}</div>`;
}

export function renderStoryEntries(entries, heading = '这次选择留下了什么') {
  const rows = list(entries);
  if (!rows.length) return '';
  return `<div class="story-ledger"><span class="journey-kicker">${esc(heading)}</span>${rows.map(row=>`<article><strong>${esc(row.title || row.name)}</strong><p>${esc(row.text || row.summary)}</p>${row.next ? `<small>${esc(row.next)}</small>` : ''}</article>`).join('')}</div>`;
}
