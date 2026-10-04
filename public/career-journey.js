const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list = value => Array.isArray(value) ? value : [];

export function renderCareerMilestone(research, button) {
  const milestone = research.lastMilestone;
  const celebrate = milestone && !milestone.acknowledged;
  const choosing = research.canChooseTalent === true;
  const talent = research.talent;
  const reward = celebrate ? `<section id="promotion-celebration" class="career-milestone" aria-labelledby="promotion-title"><span class="promotion-seal" aria-hidden="true">晋</span><div><span class="journey-kicker">新的研究身份</span><h3 id="promotion-title">你已晋升为${esc(milestone.stageName)}</h3><p class="promotion-grant">支持经费 <b>+${esc(milestone.grant)}</b> <small>已到账</small></p><details class="milestone-benefits" data-research-detail="milestone"><summary>本次解锁</summary><ul>${list(milestone.benefits).filter(line => !line.includes('（一次性）')).map(line=>`<li>${esc(line)}</li>`).join('')}</ul></details>${!choosing ? button('research:milestone:ack', '带着新本事继续', false) : ''}</div></section>` : '';
  const choices = choosing ? `<section id="career-talent-choice" class="talent-choice" aria-labelledby="talent-choice-title"><div class="talent-choice-heading"><span class="journey-kicker">选择你的拿手本事</span><h3 id="talent-choice-title">以后遇事，你有自己的办法</h3><p>三选一，选定后会保留在这份生涯中。每次远征都能使用。</p></div><div class="talent-cards">${list(research.talents).map((row,i)=>`<article class="talent-card" data-talent-card="${esc(row.id)}"><span class="talent-glyph" aria-hidden="true">${['档','谈','造'][i] || '研'}</span><h4>${esc(row.name)}</h4><p>${esc(row.description)}</p>${list(row.perks).length ? `<ul>${row.perks.map(perk=>`<li>${esc(perk)}</li>`).join('')}</ul>` : ''}${button(row.actionId, `选择${row.name}`, row.disabled, row.reason)}</article>`).join('')}</div></section>` : talent ? `<details class="talent-owned" data-research-detail="talent"><summary><span>${esc(talent.name)}</span><small>你的常驻专长 · ${esc(talent.rank || 1)} 阶</small></summary><p>${esc(talent.description)}</p>${list(talent.perks).length ? `<ul>${talent.perks.map(perk=>`<li>${esc(perk)}</li>`).join('')}</ul>` : ''}</details>` : '';
  return reward + choices;
}

export function renderPromotionPreview(preview) {
  if (!preview) return '';
  return `<div class="promotion-preview"><span>晋升后获得</span><b>+${esc(preview.grant)} 经费</b>${list(preview.benefits).filter(line => !line.includes('（一次性）')).map(line=>`<small>${esc(line)}</small>`).join('')}</div>`;
}

export function renderStoryEntries(entries, heading = '这次选择留下了什么') {
  const rows = list(entries);
  if (!rows.length) return '';
  return `<div class="story-ledger"><span class="journey-kicker">${esc(heading)}</span>${rows.map(row=>`<article><strong>${esc(row.title || row.name)}</strong><p>${esc(row.text || row.summary)}</p>${row.next ? `<small>${esc(row.next)}</small>` : ''}</article>`).join('')}</div>`;
}
