import { itemIconHtml } from './item-art.js';
import { renderCareerMilestone, renderPromotionPreview } from './career-journey.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const number = value => count(value).toLocaleString('zh-CN');
const SHORT_NAMES = { dataset: '研究数据', src_code: '模型源码', compute: '算力卡', wind: '方向情报' };
const STATUS_NAMES = { experiment: '实验进行中', submitted: '已投稿', revision: '待返修', rejected: '待补实验', ready: '审稿通过' };
const STAGE_NAMES = ['本科生', '硕士生', '博士生', '博士后', '讲师', '副教授', '教授', '杰青', '院士'];

function workspaceButton(workspace, label) {
  return `<button type="button" class="rw-link" data-open-workspace="${escapeHtml(workspace)}">${escapeHtml(label)}<span aria-hidden="true"> ↗</span></button>`;
}

function actualProgress(project) {
  const quality = Math.min(100, count(project.quality));
  return `<div class="rw-progress-grid"><div class="rw-meter"><div><label for="research-quality">当前质量</label><span><b>${number(project.quality)}</b> / 100</span></div><progress id="research-quality" data-research-progress="quality" value="${quality}" max="100" aria-valuenow="${quality}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="当前质量 ${number(project.quality)}，满分 100">${number(project.quality)} / 100</progress></div><div class="rw-run-fact"><span>已完成实验</span><strong id="research-runs" data-research-progress="runs" data-completed-runs="${count(project.runs)}">${number(project.runs)} <small>轮</small></strong></div></div>`;
}

/**
 * Read-only projection of the hub's authoritative research state and actions.
 * All mutations use the shared hubButton renderer, including pending/retry guards.
 * The returned markup replaces #research-card's contents, not its outer card.
 */
export function renderResearchWorkbench({ hub = {}, items = hub.stash || [], catalog = new Map(), button } = {}) {
  if (typeof button !== 'function') throw new TypeError('renderResearchWorkbench requires the shared hubButton renderer');
  const research = hub.research || {};
  const project = research.project;
  const actions = research.actions || [];
  const templates = research.templates || [];
  const papers = research.papers || [];
  const inventory = new Map((Array.isArray(items) ? items : []).map(row => [row.id || row.item?.id, { ...row.item, ...row }]));
  const lookup = id => inventory.get(id) || catalog.get?.(id) || (hub.shop || []).find(item => item.id === id) || { id, name: SHORT_NAMES[id] || id };
  // Equipped gear is not available to spend as a stored research material.
  const available = id => count(inventory.get(id)?.storedCount ?? inventory.get(id)?.count);
  const action = id => actions.find(row => row.id === `research:${id}`);
  const experiment = action('experiment');
  const submit = action('submit');
  const promotion = action('promote');
  const promotionGoal = !project && Boolean(promotion && !promotion.disabled);
  const promotionRetry = !project && Boolean(research.promotionReview?.lastOutcome && !research.promotionReview.retryReady);
  const promotionFocus = promotionGoal || promotionRetry;
  const promotionReasons = research.promotionReasons || [];
  const starter = templates.find(row => row.id === 'replicate' && !row.disabled) || templates.find(row => !row.disabled) || templates.find(row => row.id === 'replicate') || templates[0];

  let next = null;
  let goal = '';
  let status = '';
  let state = 'empty';
  if (project) {
    state = project.status || 'experiment';
    status = STATUS_NAMES[project.status] || '研究进行中';
    goal = project.title || '当前研究课题';
    // The server can nominate the next action. The fallback only uses actual
    // action availability, never a quality threshold or a predicted review result.
    next = actions.find(row => row.id === research.nextActionId)
      || (project.status === 'ready' ? action('publish')
        : project.status === 'submitted' ? action('review')
          : submit && !submit.disabled ? submit : experiment || submit);
  } else if (promotionFocus) {
    state = promotionRetry ? 'promotion-retry' : 'promotion';
    status = promotionRetry ? '晋升待复评' : '可以申请晋升';
    goal = `晋升为${research.nextStage || '下一职称'}`;
    next = promotion;
  } else if (starter) {
    state = starter.disabled ? 'missing' : 'ready-to-start';
    status = starter.disabled ? '准备立项' : '可以立项';
    goal = starter.name;
    next = { id: `research:start:${starter.id}`, name: '创建课题', disabled: starter.disabled, reason: starter.reason };
  } else {
    status = '研究工位';
    goal = '准备下一项研究';
  }

  const isExperiment = next?.id === 'research:experiment';
  const currentMaterials = project && isExperiment ? project.experimentMaterials || { compute: 1 + count(project.scope) } : !project && !promotionFocus ? starter?.materials || {} : {};
  const currentCost = project && isExperiment ? count(project.experimentCost) : !project && !promotionFocus && starter ? count(starter.cost) : null;
  const currentTemplate = !project && !promotionFocus ? starter : null;
  const materialAvailable = (id, template) => template?.materialCounts && Object.hasOwn(template.materialCounts, id) ? count(template.materialCounts[id]) : available(id);
  const missingMaterials = Object.entries(currentMaterials).filter(([id, need]) => materialAvailable(id, currentTemplate) < count(need));
  const blocked = Boolean(next?.disabled);
  const actionReason = next?.reason || '';
  const actionLabel = row => ({ 'research:experiment': project?.experimentLabel || (['revision', 'rejected'].includes(project?.status) ? '补做实验' : '开展实验'), 'research:submit': '整理并投稿', 'research:review': '查看审稿结果', 'research:publish': '确认录用', 'research:promote': '申请晋升' })[row?.id] || row?.name;
  const renderAction = (row, primary = false) => row ? `<div class="${primary ? 'rw-primary-action' : 'rw-secondary-action'}">${button(row.id, primary ? actionLabel(row) : row.name, row.disabled, row.reason).replace('<button ', `<button${primary ? ` data-research-primary="true"${row.disabled && row.reason ? ' aria-describedby="research-next-reason"' : ''}` : ''} `)}</div>` : '';

  function materialsMarkup(materials, cost, compact = false, template = null) {
    const rows = Object.entries(materials || {}).map(([id, need]) => {
      const item = { ...lookup(id), id };
      const owned = materialAvailable(id, template);
      const automatic = (template?.materialSources?.[id] || []).filter(row => row.automatic && count(row.count) > 0);
      const sourceText = automatic.length ? `<small class="rw-auto-material">使用 ${automatic.map(row => `${escapeHtml(row.name || lookup(row.id).name)} ×${number(row.count)}`).join("、")}</small>` : "";
      const missing = Math.max(0, count(need) - owned);
      return `<li data-research-material="${escapeHtml(id)}" data-required="${count(need)}" data-available="${owned}" class="rw-material ${missing ? 'is-missing' : 'is-ready'}">${itemIconHtml(item, 'item-icon-small')}<div><strong title="${escapeHtml(item.name)}">${escapeHtml(SHORT_NAMES[id] || item.name)}</strong><small>可用 ${number(owned)} / 消耗 ${number(need)}</small>${sourceText}</div><span>${missing ? `缺 ${number(missing)}` : '已齐'}</span></li>`;
    });
    if (cost != null) {
      const missing = Math.max(0, count(cost) - count(hub.funding));
      rows.push(`<li class="rw-material rw-funding ${missing ? 'is-missing' : 'is-ready'}"><span class="rw-currency" aria-hidden="true">¥</span><div><strong>经费</strong><small>现有 ${number(hub.funding)} / 消耗 ${number(cost)}</small></div><span>${missing ? `缺 ${number(missing)}` : '已齐'}</span></li>`);
    }
    return rows.length ? `<ul class="rw-materials${compact ? ' is-compact' : ''}" aria-label="${compact ? '立项所需材料和经费' : '下一步所需材料和经费'}">${rows.join('')}</ul>` : '';
  }

  function templateMarkup(template) {
    return `<article class="rw-template"><div class="rw-template-heading"><h4>${escapeHtml(template.name)}</h4><span>发表成果 +${number(template.credit)}</span></div>${materialsMarkup(template.materials, template.cost, true, template)}${button(`research:start:${template.id}`, '创建课题', template.disabled, template.reason)}${template.reason ? `<p class="rw-reason">${escapeHtml(template.reason)}</p>` : ''}</article>`;
  }

  const prerequisites = blocked && actionReason ? `<p class="rw-reason" id="research-next-reason">${escapeHtml(actionReason)}</p>` : '';
  const needsEquipment = /计算设备/.test(actionReason);
  const sources = missingMaterials.length || needsEquipment || (currentCost != null && count(hub.funding) < currentCost)
    ? `<div class="rw-sources">${missingMaterials.some(([id]) => (hub.shop || []).some(item => item.id === id)) || needsEquipment ? workspaceButton('shop', needsEquipment ? '补齐实验设备' : '补齐材料') : ''}${needsEquipment ? workspaceButton('inventory', '查看已有设备') : ''}${workspaceButton('prepare', '出发搜集')}</div>` : '';
  const resourceBlock = Object.keys(currentMaterials).length || currentCost != null
    ? `<section class="rw-supply-section" aria-label="${project ? '本轮消耗' : '立项所需'}">${materialsMarkup(currentMaterials, currentCost, false, currentTemplate)}${sources}</section>` : '';
  const nextText = promotionRetry ? '带回一段新的经历'
    : blocked ? isExperiment ? '先补齐实验准备' : '先补齐立项准备'
    : next?.id === 'research:experiment' ? project?.supported ? '继续复核实验记录' : ['revision', 'rejected'].includes(project?.status) ? '补做一轮，再次投稿' : count(project?.runs) ? '继续当前实验' : '开始第一轮实验'
      : next?.id === 'research:submit' ? '实验记录已可投稿'
        : next?.id === 'research:review' ? '查看这次审稿'
          : next?.id === 'research:publish' ? '把这篇成果收入档案'
            : promotionGoal ? '提交本次晋升评审' : next ? '开始这项研究' : '带回材料，再开课题';
  const nextStep = `<div id="research-next-step" class="rw-next-step ${blocked ? 'is-blocked' : ''}"><div class="rw-next-copy"><span class="rw-kicker">下一步</span><strong>${escapeHtml(nextText)}</strong>${prerequisites}</div>${promotionRetry ? workspaceButton('prepare', '出发搜集') : next ? renderAction(next, true) : workspaceButton('prepare', '前往备战')}</div>`;

  const gapText = !research.nextStage ? '已达到最高职称' : promotionRetry ? '待补充研究经历' : promotionReasons.length ? `${promotionReasons[0]}${promotionReasons.length > 1 ? ` · 另 ${promotionReasons.length - 1} 项` : ''}` : project ? '完成当前课题后可申请晋升' : '晋升条件已齐';
  const titleProgress = `<div class="rw-heading"><div class="rw-title-path" aria-label="职称晋升"><div><span class="rw-kicker">当前职称</span><h2 id="research-stage">${escapeHtml(research.stageName || '本科生')}</h2></div>${research.nextStage ? `<span class="rw-title-arrow" aria-hidden="true">→</span><div class="rw-next-title"><span class="rw-kicker">下一职称</span><strong>${escapeHtml(research.nextStage)}</strong></div>` : '<span class="rw-career-complete">全职称达成</span>'}</div><p class="rw-career-gap">${escapeHtml(gapText)}</p></div>`;
  const lastOutcome = typeof project?.lastOutcome === 'string' ? project.lastOutcome : research.promotionReview?.lastOutcome ? '本次晋升评审未通过' : '';
  const outcome = lastOutcome ? `<p class="rw-last-outcome" data-research-outcome><span>上次结果</span>${escapeHtml(lastOutcome)}</p>` : '';
  const alternateActions = project ? actions.filter(row => !['research:abandon', next?.id].includes(row.id)) : [];
  const projectDetails = project ? `<details data-research-detail="project" class="rw-details rw-project-details"><summary><span>实验记录与操作</span><small>${number(project.runs)} 轮 · ${number(project.reviews)} 次审稿</small></summary><div>${project.evidenceSummary ? `<p class="rw-muted" data-research-evidence>${escapeHtml(project.evidenceSummary)}</p>` : ''}${alternateActions.length ? `<div class="rw-other-actions">${alternateActions.map(row => `<div>${renderAction(row)}${row.reason ? `<small class="rw-reason">${escapeHtml(row.reason)}</small>` : ''}</div>`).join('')}</div>` : '<p class="rw-muted">当前课题正在等待下一步。</p>'}</div></details>` : '';
  const otherTemplates = promotionFocus ? templates : templates.filter(row => row.id !== starter?.id);
  const templateDetails = !project && otherTemplates.length ? `<details data-research-detail="templates" class="rw-details rw-template-details"><summary><span>${promotionFocus ? '开始新课题' : '其他课题'}</span><small>${otherTemplates.length} 项</small></summary><div class="rw-template-options">${otherTemplates.map(templateMarkup).join('')}</div></details>` : '';
  const attributes = `<dl class="rw-attributes" aria-label="研究属性"><div data-research-attribute="engineering" title="工程等级影响实验结果、课题门槛与晋升"><dt>工程 <b>Lv.${number(research.skills?.engineering ?? 1)}</b></dt><dd>实验执行</dd></div><div data-research-attribute="research" title="研究等级影响实验质量、证据积累与晋升"><dt>研究 <b>Lv.${number(research.skills?.research ?? 1)}</b></dt><dd>质量与证据</dd></div><div data-research-attribute="expression" title="表达等级影响审稿结果与晋升"><dt>表达 <b>Lv.${number(research.skills?.expression ?? 1)}</b></dt><dd>审稿与晋升</dd></div></dl>`;
  const ladder = `<ol class="rw-title-ladder" aria-label="完整职称进度">${STAGE_NAMES.map((name, i) => `<li class="${i < count(research.stage) ? 'is-complete' : i === count(research.stage) ? 'is-current' : ''}"${i === count(research.stage) ? ' aria-current="step"' : ''}>${escapeHtml(name)}</li>`).join('')}</ol>`;
  const promotionDetails = `<details data-research-detail="promotion" class="rw-details"><summary><span>晋升条件</span><small>${!research.nextStage ? '全部达成' : promotionReasons.length ? `${promotionReasons.length} 项待完成` : project ? '待课题完成' : '已齐'}</small></summary><div class="rw-promotion">${ladder}<p class="rw-muted">已录用 ${papers.length} 篇 · 发表成果 ${number(hub.achievement)}</p>${promotionReasons.length ? `<ul>${promotionReasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : `<p class="rw-muted">${research.nextStage ? project ? '完成当前课题后可申请晋升。' : '晋升条件已齐。' : '你已达到最高职称。'}</p>`}${!promotionGoal ? renderPromotionPreview(research.promotionPreview) : ''}${!project && promotion && !promotionGoal ? renderAction(promotion) : ''}</div></details>`;
  const paperDetails = `<div id="research-papers" class="rw-paper-total" aria-label="已录用论文总数"><span>已录用论文</span><strong data-paper-count="${papers.length}">${number(papers.length)} <small>篇</small></strong></div>`;
  const abandon = action('abandon');
  const danger = abandon ? `<details data-research-detail="abandon" class="rw-details rw-danger"><summary><span>放弃课题</span><small>投入不返还</small></summary><div><p>结束当前课题，投入的材料与经费不返还。个人积累保留。</p>${renderAction(abandon)}</div></details>` : '';

  return `<div id="research-actions" class="research-workbench" data-research-state="${escapeHtml(state)}">${titleProgress}${attributes}${renderCareerMilestone(research, button)}<div${!project ? ' id="research-templates"' : ''} class="rw-main"><section class="rw-current" aria-labelledby="research-current-goal"><div class="rw-current-heading"><div><span class="rw-status${blocked ? ' is-blocked' : ''}">${escapeHtml(status)}</span><h3 id="research-current-goal">${escapeHtml(goal)}</h3></div><img src="/assets/generated/research-desk.png" alt="" aria-hidden="true" decoding="async"></div>${project ? actualProgress(project) : ''}${outcome}${resourceBlock}${promotionGoal ? renderPromotionPreview(research.promotionPreview) : ''}${nextStep}</section>${projectDetails}${templateDetails}</div>${project ? '<div id="research-templates" hidden></div>' : ''}<div class="rw-support">${promotionDetails}${paperDetails}${danger}</div></div>`;
}
