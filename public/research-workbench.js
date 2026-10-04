import { itemIconHtml } from './item-art.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const number = value => count(value).toLocaleString('zh-CN');
const SHORT_NAMES = { dataset: '研究数据', src_code: '模型源码', compute: '算力卡', wind: '方向情报' };
const STATUS_NAMES = { experiment: '实验中', submitted: '等待审稿', revision: '需要返修', rejected: '需要补实验', ready: '审稿通过' };

function workspaceButton(workspace, label) {
  return `<button type="button" class="rw-link" data-open-workspace="${escapeHtml(workspace)}">${escapeHtml(label)}<span aria-hidden="true"> ↗︎</span></button>`;
}

function progressMeter(id, label, value, target, suffix = '') {
  const quality = id === 'research-quality';
  const max = quality ? 100 : Math.max(1, count(target));
  return `<div class="rw-meter"><div><label for="${id}">${escapeHtml(label)}</label><span><b>${number(value)}</b> / ${quality ? '目标 ' : ''}${number(target)}${escapeHtml(suffix)}</span></div><div class="rw-progress-track"><progress id="${id}" data-research-progress="${quality ? 'quality' : 'runs'}" data-target="${count(target)}" value="${Math.min(count(value), max)}" max="${max}" aria-valuenow="${Math.min(count(value), max)}" aria-valuemin="0" aria-valuemax="${max}" aria-valuetext="${number(value)}，${quality ? '目标' : '上限'} ${number(target)}${escapeHtml(suffix)}">${number(value)} / ${number(target)}</progress>${quality ? `<span class="rw-target-marker" style="left:${Math.min(count(target), 100)}%" aria-hidden="true"></span>` : ''}</div></div>`;
}

function workflow(project) {
  const index = !project ? 0 : project.status === 'ready' ? 3 : project.status === 'submitted' ? 2 : 1;
  const labels = ['准备立项', '开展实验', '投稿审稿', '确认录用'];
  return `<ol class="rw-workflow" aria-label="论文研究流程">${labels.map((label, i) => `<li class="${i < index ? 'is-complete' : i === index ? 'is-current' : ''}"${i === index ? ' aria-current="step"' : ''}><span aria-hidden="true">${i < index ? '✓' : i + 1}</span><b>${label}</b></li>`).join('')}</ol>`;
}

/**
 * A read-only projection of the hub's authoritative research actions.
 * `items` should be stashItems(); `catalog` should be itemCatalog() (a Map).
 * `button` is hubButton, so pending/uncertain request guards remain in the app.
 * The returned markup replaces #research-card's contents, not the outer card.
 */
export function renderResearchWorkbench({ hub = {}, items = hub.stash || [], catalog = new Map(), button } = {}) {
  if (typeof button !== 'function') throw new TypeError('renderResearchWorkbench requires the shared hubButton renderer');
  const research = hub.research || {};
  const project = research.project;
  const actions = research.actions || [];
  const templates = research.templates || [];
  const papers = research.papers || [];
  const directions = research.directions || {};
  const direction = directions[research.direction];
  const inventory = new Map(items.map(row => [row.id || row.item?.id, { ...row.item, ...row }]));
  const lookup = id => inventory.get(id) || catalog.get?.(id) || (hub.shop || []).find(item => item.id === id) || { id, name: SHORT_NAMES[id] || id };
  // The server pays from stored materials. Do not treat equipped gear as stock.
  const available = id => count(inventory.get(id)?.storedCount ?? inventory.get(id)?.count);
  const action = id => actions.find(row => row.id === `research:${id}`);
  const experiment = action('experiment');
  const submit = action('submit');
  const promotion = action('promote');
  const canPromote = Boolean(promotion && !promotion.disabled);
  const starter = templates.find(row => row.id === 'replicate' && !row.disabled) || templates.find(row => !row.disabled) || templates.find(row => row.id === 'replicate') || templates[0];
  const promotionGoal = !project && canPromote;
  const recentAcceptance = !project && papers.length > 0 && String(research.lastMessage || '').startsWith('论文录用');

  let next = null;
  let goal = '';
  let instruction = '';
  let status = '';
  let state = 'empty';
  if (project) {
    state = project.status || 'experiment';
    status = STATUS_NAMES[project.status] || '研究进行中';
    goal = project.title || '当前研究课题';
    if (project.status === 'ready') {
      next = action('publish');
      instruction = '审稿已通过，确认录用后计入论文与发表成果。';
    } else if (project.status === 'submitted') {
      next = action('review');
      instruction = '论文已经投稿，下一步查看审稿结果。';
    } else {
      const meetsTarget = count(project.quality) >= count(project.target);
      const exhausted = count(project.runs) >= 6;
      next = submit && !submit.disabled && (meetsTarget || exhausted) ? submit : experiment || submit;
      instruction = project.status === 'rejected' ? '本轮未通过审稿。补做实验提升质量后，可以重新投稿。'
        : project.status === 'revision' ? '审稿要求返修。完成新的实验后，再整理投稿。'
          : count(project.runs) < 2 ? '先完成至少两轮实验，再整理投稿。'
            : meetsTarget ? '质量已达到当前目标，可以整理实验结果并投稿。'
              : exhausted ? '实验轮数已用完，查看下方仍可执行的操作。'
                : '继续实验，把论文质量提升至目标后再投稿。';
    }
  } else if (promotionGoal) {
    state = 'promotion';
    status = '晋升条件已齐';
    goal = `晋升为${research.nextStage || '下一研究阶段'}`;
    instruction = '论文、发表成果与能力要求均已满足，可以申请晋升。';
    next = promotion;
  } else if (starter) {
    state = starter.disabled ? 'missing' : recentAcceptance ? 'accepted' : 'ready-to-start';
    status = starter.disabled ? '准备研究材料' : recentAcceptance ? '论文已录用' : '可以立项';
    goal = starter.name;
    instruction = '投入下方材料和经费，开始一项新课题。立项后还需要算力卡开展实验。';
    next = { id: `research:start:${starter.id}`, name: `创建课题 · ${number(starter.cost)} 经费`, disabled: starter.disabled, reason: starter.reason };
  } else {
    status = '研究工位';
    goal = '准备下一项研究';
    instruction = '当前没有可创建的课题，可先查看研究档案或准备探索材料。';
  }

  const currentMaterials = project && experiment && next?.id === experiment.id
    ? { compute: 1 + count(project.scope) }
    : !project && !promotionGoal ? starter?.materials || {} : {};
  const currentCost = project && next?.id === experiment?.id ? count(project.experimentCost) : !project && !promotionGoal && starter ? count(starter.cost) : null;
  const missingMaterials = Object.entries(currentMaterials).filter(([id, need]) => available(id) < count(need));
  const blocked = Boolean(next?.disabled);
  const actionReason = next?.reason || '';
  const renderAction = (row, primary = false, label = row?.name) => row ? `<div class="${primary ? 'rw-primary-action' : 'rw-secondary-action'}">${primary ? button(row.id, label, row.disabled, row.reason).replace('<button ', `<button data-research-primary="true"${row.disabled && row.reason ? ' aria-describedby="research-next-reason"' : ''} `) : button(row.id, label, row.disabled, row.reason)}</div>` : '';
  const alternateActions = project ? actions.filter(row => !['research:abandon', next?.id].includes(row.id)) : [];

  function materialsMarkup(materials, cost, compact = false) {
    const rows = Object.entries(materials || {}).map(([id, need]) => {
      const item = { ...lookup(id), id };
      const owned = available(id);
      const missing = Math.max(0, count(need) - owned);
      return `<li data-research-material="${escapeHtml(id)}" data-required="${count(need)}" data-available="${owned}" class="rw-material ${missing ? 'is-missing' : 'is-ready'}">${itemIconHtml(item, 'item-icon-small')}<div><strong title="${escapeHtml(item.name)}">${escapeHtml(SHORT_NAMES[id] || item.name)}</strong><small>现有 ${number(owned)} / 需要 ${number(need)}</small></div><span>${missing ? `缺 ${number(missing)}` : '已备齐'}</span></li>`;
    });
    if (cost != null) {
      const missing = Math.max(0, count(cost) - count(hub.funding));
      rows.push(`<li class="rw-material rw-funding ${missing ? 'is-missing' : 'is-ready'}"><span class="rw-currency" aria-hidden="true">¥</span><div><strong>研究经费</strong><small>现有 ${number(hub.funding)} / 消耗 ${number(cost)}</small></div><span>${missing ? `缺 ${number(missing)}` : '已备齐'}</span></li>`);
    }
    return rows.length ? `<ul class="rw-materials${compact ? ' is-compact' : ''}" aria-label="${compact ? '立项所需材料和经费' : '下一步所需材料和经费'}">${rows.join('')}</ul>` : '';
  }

  function templateMarkup(template) {
    return `<article class="rw-template"><div class="rw-template-heading"><h4>${escapeHtml(template.name)}</h4><span>录用成果 +${number(template.credit)}</span></div>${materialsMarkup(template.materials, template.cost, true)}${button(`research:start:${template.id}`, `创建课题 · ${number(template.cost)} 经费`, template.disabled, template.reason)}${template.reason ? `<p class="rw-reason">${escapeHtml(template.reason)}</p>` : ''}</article>`;
  }

  const prerequisites = blocked && actionReason ? `<p class="rw-reason" id="research-next-reason"><strong>暂时无法${next?.id?.includes(':start:') ? '立项' : '继续'}：</strong>${escapeHtml(actionReason)}</p>` : '';
  const needsEquipment = /计算设备/.test(actionReason);
  const materialHeading = project ? '这一步需要' : '立项准备';
  const sources = missingMaterials.length || needsEquipment || (currentCost != null && count(hub.funding) < currentCost)
    ? `<div class="rw-sources"><span>补齐准备</span>${missingMaterials.some(([id]) => (hub.shop || []).some(item => item.id === id)) || needsEquipment ? workspaceButton('shop', needsEquipment ? '查看设备与商店' : '去商店补齐') : ''}${workspaceButton('inventory', needsEquipment ? '查看仓库并装备' : '查看仓库')}${workspaceButton('prepare', '出发搜集材料')}</div>` : '';
  const resourceBlock = Object.keys(currentMaterials).length || currentCost != null
    ? `<section class="rw-supply-section" aria-labelledby="research-material-heading"><div class="rw-section-heading"><h3 id="research-material-heading">${materialHeading}</h3>${!sources ? workspaceButton('inventory', '查看仓库') : ''}</div>${materialsMarkup(currentMaterials, currentCost)}${sources}</section>` : '';
  const progress = project ? `<div class="rw-progress-grid">${progressMeter('research-quality', '论文质量', project.quality, project.target)}${progressMeter('research-runs', '实验轮数', project.runs, 6, ' 轮')}</div>` : '';
  const secondary = alternateActions.length ? `<div class="rw-other-actions">${alternateActions.map(row => `<div>${renderAction(row)}${row.reason ? `<small class="rw-reason">${escapeHtml(row.reason)}</small>` : ''}</div>`).join('')}</div>` : '';
  const primaryLabel = next?.name;
  const nextStep = `<div id="research-next-step" class="rw-next-step ${blocked ? 'is-blocked' : ''}"><div class="rw-next-copy"><span class="rw-kicker">下一步</span><strong>${escapeHtml(next?.id === 'research:experiment' && blocked ? '补齐实验准备，再继续实验' : next?.id?.startsWith('research:start:') && blocked ? '补齐立项条件' : next?.id === 'research:experiment' ? '继续开展实验' : next?.id === 'research:submit' ? '整理并投稿' : next?.id === 'research:review' ? '查看这篇论文的审稿结果' : next?.id === 'research:publish' ? '确认论文录用' : promotionGoal ? '申请研究阶段晋升' : next ? '创建这项课题' : '前往备战搜集材料')}</strong>${prerequisites}</div>${next ? renderAction(next, true, primaryLabel) : workspaceButton('prepare', '前往备战')}</div>`;

  const otherTemplates = promotionGoal ? templates : templates.filter(row => row.id !== starter?.id);
  const templateDetails = !project && otherTemplates.length ? `<details data-research-detail="templates" class="rw-details rw-template-details"><summary><span>${promotionGoal ? '开始新的课题' : '其他研究课题'}</span><small>${otherTemplates.length} 项可查看</small></summary><div class="rw-template-options">${otherTemplates.map(templateMarkup).join('')}</div></details>` : '';
  const availablePreparations = (research.preparations || []).filter(row => !row.disabled);
  const preparations = `<details data-research-detail="preparations" class="rw-details"${blocked && availablePreparations.some(row => missingMaterials.some(([id]) => lookup(id).name === row.outputName)) ? ' open' : ''}><summary><span>整理研究材料</span><small>${availablePreparations.length ? `${availablePreparations.length} 种可整理` : '把收获转成课题材料'}</small></summary><div id="research-preparations" class="rw-conversions">${(research.preparations || []).map(row => `<div><div><strong>${escapeHtml(row.inputName)}</strong><small>现有 ${number(available(row.id))} 份 → ${escapeHtml(row.outputName)}</small></div>${button(`research:prepare:${row.id}`, '整理 1 份', row.disabled, row.reason || (row.disabled ? '仓库没有这份材料' : ''))}</div>`).join('') || '<p class="rw-muted">目前没有可整理的材料。</p>'}</div></details>`;
  const profile = `<details data-research-detail="profile" class="rw-details"><summary><span>研究方向与能力</span><small>${escapeHtml(direction?.name || '查看研究档案')}</small></summary><div id="research-profile" class="rw-profile"><div class="rw-profile-facts"><span>工程 <b>Lv.${number(research.skills?.engineering ?? 1)}</b></span><span>研究 <b>Lv.${number(research.skills?.research ?? 1)}</b></span><span>表达 <b>Lv.${number(research.skills?.expression ?? 1)}</b></span><span>实验能力 <b>${number(research.capacity)}</b></span><span>研究日 <b>${number(research.day)}</b></span></div><p class="rw-muted">${project ? '当前课题结束后，可以更换研究方向。' : '选择研究方向，对应专长项目可获得实验质量加成。'}</p><div class="rw-directions">${Object.entries(directions).map(([id, row]) => button(`research:direction:${id}`, `${id === research.direction ? '✓ ' : ''}${row.name || id}`, Boolean(project) || id === research.direction, project ? '请先完成或放弃当前项目' : id === research.direction ? '当前研究方向' : '')).join('')}</div></div></details>`;
  const promotionReasons = research.promotionReasons || [];
  const promotionDetails = `<details data-research-detail="promotion" class="rw-details"><summary><span>${research.nextStage ? `晋升为${escapeHtml(research.nextStage)}` : '研究阶段'}</span><small>${!research.nextStage ? '已到最高阶段' : promotionReasons.length ? `${promotionReasons.length} 项条件待完成` : project ? '先完成当前课题' : '条件已齐'}</small></summary><div class="rw-promotion"><p class="rw-muted">当前${escapeHtml(research.stageName || '研究阶段')} · 已录用 ${papers.length} 篇 · 发表成果 ${number(hub.achievement)}</p>${promotionReasons.length ? `<ul>${promotionReasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : `<p>${research.nextStage ? '所有能力和成果条件均已满足。' : '你已达到最高研究阶段。'}</p>`}${project ? '<p class="rw-muted">需要先完成或放弃当前课题，才能申请晋升。</p>' : promotion && !promotionGoal ? renderAction(promotion) : ''}</div></details>`;
  const paperDetails = `<details data-research-detail="papers" class="rw-details"><summary><span>已录用论文</span><small>${papers.length} 篇</small></summary><div id="research-papers" class="rw-papers">${papers.length ? `<ul>${papers.slice().reverse().map(paper => `<li><strong>${escapeHtml(paper.title || paper.type || '研究论文')}</strong><span>质量 ${number(paper.quality)} · 发表成果 +${number(paper.credit)}</span></li>`).join('')}</ul>` : '<p class="rw-muted">完成实验、投稿与审稿后，录用的论文会保存在这里。</p>'}</div></details>`;
  const abandon = action('abandon');
  const danger = abandon ? `<details data-research-detail="abandon" class="rw-details rw-danger"><summary><span>放弃当前课题</span><small>已投入资源不返还</small></summary><div><p>放弃后，当前课题的实验进度将结束，已投入的材料与经费不会返还。个人能力会保留。</p>${renderAction(abandon)}</div></details>` : '';

  return `<div id="research-actions" class="research-workbench" data-research-state="${escapeHtml(state)}"><div class="rw-heading"><div><span class="rw-kicker">研究工位</span><h2>把发现写成论文</h2></div><span id="research-stage" class="rw-stage">${escapeHtml(research.stageName || '研究阶段')}${research.nextStage ? `<span aria-hidden="true"> → </span>${escapeHtml(research.nextStage)}` : ''}</span></div><div${!project ? ' id="research-templates"' : ''} class="rw-main"><section class="rw-current" aria-labelledby="research-current-goal"><div class="rw-current-heading"><div><span class="rw-status${blocked ? ' is-blocked' : ''}">${escapeHtml(status)}</span><h3 id="research-current-goal">${escapeHtml(goal)}</h3><p>${escapeHtml(instruction)}</p></div><img src="/assets/generated/research-desk.png" alt="" aria-hidden="true" decoding="async"></div>${promotionGoal ? '' : workflow(project)}${progress}${resourceBlock}${nextStep}${secondary}</section>${templateDetails}</div>${project ? '<div id="research-templates" hidden></div>' : ''}<div class="rw-support">${preparations}${profile}${promotionDetails}${paperDetails}${danger}</div></div>`;
}
