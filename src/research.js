import { ITEMS } from './content.js';
import { talentRankForStage, normalizeCareerTalent, careerTalentBenefits } from '../public/career-talents.js';

import { experimentOutcome, reviewOutcome } from './research-factors.js';

export const EQUIPMENT_SLOTS = ['bag', 'focus', 'tool', 'device', 'storage'];
export const DIRECTIONS = {
  llm: { name: '大模型', specialty: 'finetune', topic: '轻量语言模型' },
  multimodal: { name: '多模态', specialty: 'evaluate', topic: '图文理解模型' },
  robotics: { name: '机器人', specialty: 'replicate', topic: '机器人策略模型' },
  systems: { name: 'AI 系统', specialty: 'replicate', topic: '推理优化系统' },
};
export const PROJECTS = {
  replicate: { name: '复现研究', minStage: 0, engineering: 1, research: 1, capacity: 1, materials: { dataset: 1, src_code: 1 }, cost: 30, credit: 30, grant: 80 },
  evaluate: { name: '模型评测', minStage: 0, engineering: 1, research: 1, capacity: 1, materials: { dataset: 1, wind: 1 }, cost: 40, credit: 45, grant: 100 },
  finetune: { name: '微调实验', minStage: 1, engineering: 2, research: 2, capacity: 2, materials: { dataset: 1, src_code: 1 }, cost: 80, credit: 80, grant: 180 },
};
const PREPARATIONS = { unpublished: 'dataset', preprint: 'wind', inside: 'wind', funding_tip: 'wind' };
export const STAGES = [
  { name: '本科生', papers: 0, credit: 0, skill: 1 },
  { name: '硕士生', papers: 1, credit: 30, skill: 2 },
  { name: '博士生', papers: 2, credit: 75, skill: 2 },
  { name: '博士后', papers: 4, credit: 180, skill: 3 },
  { name: '讲师', papers: 6, credit: 300, skill: 3 },
  { name: '副教授', papers: 9, credit: 550, skill: 4 },
  { name: '教授', papers: 12, credit: 850, skill: 4 },
  { name: '杰青', papers: 16, credit: 1200, skill: 5 },
  { name: '院士', papers: 20, credit: 1700, skill: 5 },
];
// Funds go straight into the wallet: a full warehouse never swallows a milestone.
// These are one-time earned rewards, not claims that can be refreshed or retried.
export const PROMOTION_GRANTS = [0, 180, 220, 280, 340, 400, 460, 520, 600];
const PROMOTION_GRANT_NAMES = ['', '自主研究启动金', '访学启动金', '独立工位基金', '联合研究启动金',
  '课题组周转金', '前沿研究支持', '跨组探索支持', '长期研究支持'];
export const VENUES = {
  conference: { name: 'AI 学术会议', minStage: 0, desc: '自然搜集数据、源码、算力与合作资源', risk: 0 },
  visit: { name: 'AI 实验室访学', minStage: 2, desc: '数据与源码机会较多的访学地点', risk: 0.03 },
  industry: { name: '企业联合研究', minStage: 4, desc: '算力机会较多的联合研究地点', risk: 0.06 },
};
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : fallback;
const skillLevel = xp => Math.min(10, 1 + Math.floor(number(xp) / 3));

const METHOD_CAP = 30;
const PORTFOLIO = [null, [1, 2], [1, 4], [2, 7], [2, 10], [3, 14], [4, 18], [5, 24], [6, 30]];
const emptySupport = () => ({ initialQuality: 0, experimentQuality: 0, publicationGrant: 0 });

function normalizeLegacySupport(value, talent, stage) {
  // Preserve exactly the already-earned perk. Old identities stop here: no
  // future choice, automatic re-roll, rank inflation, or raid ability survives.
  const earned = careerTalentBenefits(normalizeCareerTalent(talent, stage));
  const source = value && typeof value === 'object' ? value : emptySupport();
  return { initialQuality: Math.min(9, Math.max(number(source.initialQuality), number(earned?.initialQuality))),
    experimentQuality: Math.min(3, Math.max(number(source.experimentQuality), number(earned?.experimentQuality))),
    publicationGrant: Math.min(30, Math.max(number(source.publicationGrant), number(earned?.publicationGrant))) };
}

function titleSupport(stage) {
  const rank = talentRankForStage(stage);
  return { rank, initialQuality: rank * 2, experimentQuality: rank };
}

export function normalizeResearch(value = {}, seed = 1) {
  if (!value || typeof value !== 'object') value = {};
  const papers = Array.isArray(value.papers) ? value.papers.filter(p => p && Object.hasOwn(PROJECTS, p.type) && typeof p.id === 'string').map(p => ({
    id: p.id, type: p.type, title: String(p.title || PROJECTS[p.type].name), quality: Math.min(100, number(p.quality)),
    evidence: Math.min(100, number(p.evidence, number(p.quality))), credit: number(p.credit), day: number(p.day),
  })) : [];
  const raw = value.project;
  const project = raw && Object.hasOwn(PROJECTS, raw.type) && Object.hasOwn(DIRECTIONS, raw.direction) && typeof raw.id === 'string' ? {
    id: raw.id, type: raw.type, direction: raw.direction, title: String(raw.title || PROJECTS[raw.type].name),
    scope: Math.min(2, number(raw.scope)), quality: Math.min(100, number(raw.quality)), runs: number(raw.runs),
    // Old experiments really happened. Recover conservative evidence without
    // inventing successful runs, rewards, or advancing their current status.
    evidence: Math.min(100, number(raw.evidence, Math.min(100, number(raw.runs) * 12))),
    preparation: Math.min(2, number(raw.preparation)), successfulRuns: Math.min(number(raw.runs), number(raw.successfulRuns)),
    setbacks: Math.min(number(raw.runs), number(raw.setbacks)), lastOutcome: String(raw.lastOutcome || ''),
    status: ['experiment', 'submitted', 'revision', 'ready', 'rejected'].includes(raw.status) ? raw.status : 'experiment',
    reviews: number(raw.reviews), submittedRuns: number(raw.submittedRuns),
  } : null;
  const stage = Math.min(STAGES.length - 1, number(value.stage));
  // A legacy stage is already earned; migration never grants its rewards again.
  const rewardedStage = Math.min(STAGES.length - 1, Math.max(stage, number(value.rewardedStage, stage)));
  const milestoneStage = number(value.lastMilestone?.stage);
  const lastMilestone = milestoneStage > 0 && milestoneStage <= stage ? {
    stage: milestoneStage, grant: number(value.lastMilestone.grant) > 0 ? PROMOTION_GRANTS[milestoneStage] : 0,
    acknowledged: value.lastMilestone.acknowledged === true,
  } : null;
  return {
    direction: Object.hasOwn(DIRECTIONS, value.direction) ? value.direction : 'llm',
    skills: Object.fromEntries(['engineering', 'research', 'expression'].map(key => [key, number(value.skills?.[key])])),
    stage, day: number(value.day), rewardedStage, talent: null,
    legacySupport: normalizeLegacySupport(value.legacySupport, value.talent, stage), lastMilestone,
    methods: Object.fromEntries(Object.keys(PROJECTS).map(key => {
      const hasMethods = value.methods && typeof value.methods === 'object' && !Array.isArray(value.methods);
      const knownPapers = Math.max(papers.filter(paper => paper.type === key).length, number(value.completed?.[key]));
      const recordedPractice = knownPapers * 2 + (project?.type === key ? project.runs : 0);
      return [key, Math.min(METHOD_CAP, hasMethods ? number(value.methods[key]) : recordedPractice)];
    })),
    // Preparation notes are knowledge from actually sorting materials. They
    // remain useful if the physical item is sold, and are used by one project.
    prepared: Object.fromEntries(['dataset', 'wind'].map(key => [key, Math.min(8, number(value.prepared?.[key]))])),
    rng: (number(value.rng, seed) >>> 0) || 1,
    sequence: Math.max(number(value.sequence), ...papers.map(p => number(p.id.split('-').at(-1))), number(project?.id.split('-').at(-1))), papers,
    completed: Object.fromEntries(Object.keys(PROJECTS).map(key => [key, number(value.completed?.[key])])),
    project, lastMessage: /科研流派|档案派|联络派|巧匠派/.test(String(value.lastMessage || ''))
      ? '职称与已有研究支持已保留，可以继续研究。' : String(value.lastMessage || '带回研究材料，在这里开始第一个项目。'),
  };
}

function milestoneView(research, stage, grant = PROMOTION_GRANTS[stage]) {
  const support = titleSupport(stage);
  const benefits = [`${PROMOTION_GRANT_NAMES[stage]} +${grant} 经费（一次性）`];
  if (stage === 1) benefits.push('微调实验与 GPU 工作站终端开放');
  if (stage === 2) benefits.push('新地点：AI 实验室访学', '数据清洗工具开放购买与装备');
  if (stage === 3) benefits.push('进阶课题与集群远程终端开放');
  if (stage === 4) benefits.push('新地点：企业联合研究');
  if (stage === 6) benefits.push('前沿课题开放');
  if (support.rank > titleSupport(stage - 1).rank) benefits.push('研究支持提升，自动用于新课题与实验');
  if (stage === STAGES.length - 1) benefits.push('全部生涯阶段已达成，可以继续自己的课题与远征');
  return { stage, stageName: STAGES[stage].name, grant, grantName: PROMOTION_GRANT_NAMES[stage], benefits };
}

function progressionView(research) {
  return {
    talent: null, canChooseTalent: false, talents: [], support: titleSupport(research.stage),
    promotionPreview: STAGES[research.stage + 1] ? milestoneView(research, research.stage + 1) : null,
    lastMilestone: research.lastMilestone ? { ...milestoneView(research, research.lastMilestone.stage, research.lastMilestone.grant),
      acknowledged: research.lastMilestone.acknowledged === true } : null,
  };
}

export function skillLevels(research) {
  return Object.fromEntries(Object.entries(research.skills).map(([key, xp]) => [key, skillLevel(xp)]));
}

function gearBonus(profile, key) {
  return Object.values(profile.loadout || {}).reduce((sum, id) => sum + (Number(ITEMS[id]?.bonus?.[key]) || 0), 0);
}
function capacity(profile) {
  return Number(ITEMS[profile.loadout?.device]?.bonus?.computeCapacity) || 0;
}
export function researchScope(profile, type) {
  const t = PROJECTS[type];
  if (!t) return 0;
  const levels = skillLevels(profile.research);
  let scope = Math.min(2, Math.floor(profile.research.stage / 3));
  while (scope > 0 && (levels.engineering < t.engineering + scope || levels.research < t.research + scope
    || capacity(profile) < Math.min(3, t.capacity + scope))) scope -= 1;
  return scope;
}
function requirements(profile, type, scope = researchScope(profile, type)) {
  const template = PROJECTS[type];
  const skills = skillLevels(profile.research);
  const reasons = [];
  if (profile.research.stage < template.minStage) reasons.push(`需要${STAGES[template.minStage].name}身份`);
  if (skills.engineering < template.engineering + scope) reasons.push(`工程能力需要 ${template.engineering + scope} 级`);
  if (skills.research < template.research + scope) reasons.push(`研究能力需要 ${template.research + scope} 级`);
  if (capacity(profile) < Math.min(3, template.capacity + scope)) reasons.push(`计算设备需要 ${Math.min(3, template.capacity + scope)} 级实验能力`);
  return reasons;
}
function materialReasons(profile, materials) {
  return Object.entries(materials).filter(([id, count]) => number(profile.stash[id]) < count).map(([id, count]) => `需要${ITEMS[id].name} ×${count}`);
}
function pay(profile, cost, materials) {
  if (profile.funding < cost) return '研究经费不足。';
  const reasons = materialReasons(profile, materials);
  if (reasons.length) return reasons.join('；');
  profile.funding -= cost;
  for (const [id, count] of Object.entries(materials)) {
    profile.stash[id] -= count;
    if (!profile.stash[id]) delete profile.stash[id];
  }
  return null;
}
function random(research) {
  let value = research.rng;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  research.rng = value >>> 0;
  return research.rng / 4294967296;
}
function portfolioView(research) {
  const [requiredPapers, requiredPractice] = PORTFOLIO[research.stage + 1] || [0, 0];
  const strongPapers = research.papers.filter(p => p.quality >= 80 && number(p.evidence, p.quality) >= 65).length;
  const practice = Math.max(0, ...Object.values(research.methods || {}).map(value => number(value)));
  return { strongPapers, requiredPapers, practice, requiredPractice,
    ready: strongPapers >= requiredPapers || practice >= requiredPractice,
    summary: `代表作 ${strongPapers}/${requiredPapers} 或方法积累 ${practice}/${requiredPractice}` };
}

function promotionReasons(profile) {
  const research = profile.research;
  const next = STAGES[research.stage + 1];
  if (!next) return ['已达到最高生涯阶段'];
  const levels = skillLevels(research);
  const portfolio = portfolioView(research);
  return [research.papers.length < next.papers ? `录用论文 ${research.papers.length}/${next.papers}` : '',
    profile.achievement < next.credit ? `发表成果 ${profile.achievement}/${next.credit}` : '',
    levels.engineering < next.skill ? `工程 ${levels.engineering}/${next.skill} 级` : '',
    levels.research < next.skill ? `研究 ${levels.research}/${next.skill} 级` : '',
    levels.expression < Math.max(1, next.skill - 1) ? `表达 ${levels.expression}/${Math.max(1, next.skill - 1)} 级` : '',
    portfolio.ready ? '' : portfolio.summary,
  ].filter(Boolean);
}

function factorInputs(profile, project) {
  const research = profile.research;
  return { ...skillLevels(research), quality: project.quality, evidence: project.evidence,
    preparation: project.preparation, equipment: gearBonus(profile, 'experiment'),
    headroom: capacity(profile) - Math.min(3, PROJECTS[project.type].capacity + project.scope),
    experience: research.methods?.[project.type] || 0, topicFit: DIRECTIONS[project.direction].specialty === project.type,
    scope: project.scope, support: titleSupport(research.stage).experimentQuality + (research.legacySupport?.experimentQuality || 0) };
}

export function researchView(profile) {
  const research = profile.research;
  const project = research.project;
  const actions = [];
  const preparations = Object.entries(PREPARATIONS).map(([id, output]) => ({ id, inputName: ITEMS[id].name, outputName: ITEMS[output].name, disabled: !number(profile.stash[id]) }));
  const add = (id, name, reasons = []) => actions.push({ id: `research:${id}`, name, disabled: reasons.length > 0, reason: reasons.join('；') });
  const common = { ...structuredClone(research), ...progressionView(research), skills: skillLevels(research), skillXp: { ...research.skills },
    stageName: STAGES[research.stage].name, capacity: capacity(profile), directions: DIRECTIONS, preparations,
    nextStage: STAGES[research.stage + 1]?.name || null, promotionReasons: promotionReasons(profile), portfolio: portfolioView(research) };
  if (project) {
    const t = PROJECTS[project.type];
    const cost = t.cost * (project.scope + 1);
    if (['experiment', 'revision', 'rejected'].includes(project.status)) {
      const reasons = [...requirements(profile, project.type, project.scope), ...materialReasons(profile, { compute: 1 + project.scope })];
      if (profile.funding < cost) reasons.push(`需要 ${cost} 经费`);
      add('experiment', `${project.status === 'experiment' ? '运行实验' : '补实验'} · ${1 + project.scope} 张算力卡 / ${cost} 经费`, reasons);
      add('submit', '整理并投稿', project.runs < 2 ? ['至少完成两轮实验'] : project.runs <= (project.submittedRuns || 0) ? ['补实验后才能重新投稿'] : []);
    }
    if (project.status === 'submitted') add('review', '查看审稿结果');
    if (project.status === 'ready') add('publish', '确认录用 · 发表成果');
    const nextActionId = project.status === 'ready' ? 'research:publish' : project.status === 'submitted' ? 'research:review'
      : actions.find(action => action.id === 'research:submit' && !action.disabled)?.id || 'research:experiment';
    add('abandon', '放弃项目 · 已投入资源不返还');
    return { ...common, project: { ...project, experimentCost: cost,
      evidenceSummary: `已完成 ${project.runs} 轮实验 · ${project.successfulRuns || 0} 次稳定复现` }, templates: [], actions, nextActionId };
  }
  add('promote', '申请晋升', common.promotionReasons);
  return { ...common, actions, nextActionId: common.promotionReasons.length ? null : 'research:promote',
    templates: Object.entries(PROJECTS).map(([type, t]) => {
      const scope = researchScope(profile, type);
      const reasons = [...requirements(profile, type, scope), ...materialReasons(profile, t.materials)];
      if (profile.funding < t.cost * (scope + 1)) reasons.push('启动经费不足');
      return { id: type, scope, name: `${['基础', '进阶', '前沿'][scope]}${t.name}`, materials: t.materials, cost: t.cost * (scope + 1),
        credit: t.credit * (scope + 1), disabled: reasons.length > 0, reason: reasons.join('；') };
    }) };
}

export function researchAct(profile, action) {
  const research = profile.research;
  const [verb, id, ...extra] = String(action || '').split(':');
  const fail = reason => ({ ok: false, reason });
  const done = message => { research.lastMessage = message; return { ok: true, message }; };
  const withId = ['prepare', 'direction', 'start'];
  if (verb === 'talent') return fail('科研支持已随职称自动生效，无需选择流派。');
  if (extra.length || (withId.includes(verb) ? !id : verb !== 'milestone' && id !== undefined)) return fail('未知的研究操作。');
  if (verb === 'milestone') {
    if (id !== 'ack' || extra.length || !research.lastMilestone) return fail('没有待收好的晋升记录。');
    if (research.lastMilestone.acknowledged) return { ok: true, message: '晋升记录已收好。' };
    research.lastMilestone.acknowledged = true;
    return done('晋升记录已收好；支持经费已到账，解锁的能力与地点会一直保留。');
  }
  if (verb === 'prepare') {
    const output = PREPARATIONS[id];
    if (!Object.hasOwn(PREPARATIONS, id) || !number(profile.stash[id])) return fail('仓库里没有可整理的这份研究材料。');
    profile.stash[id] -= 1;
    if (!profile.stash[id]) delete profile.stash[id];
    profile.stash[output] = number(profile.stash[output]) + 1;
    research.prepared[output] = Math.min(8, number(research.prepared[output]) + 1);
    research.day += 1;
    return done(`已将一份${ITEMS[id].name}整理为${ITEMS[output].name}，整理笔记已留存。`);
  }
  if (verb === 'direction') {
    if (!Object.hasOwn(DIRECTIONS, id)) return fail('没有这个研究方向。');
    if (research.project) return fail('请先完成或放弃当前项目，再切换研究方向。');
    research.direction = id;
    return done(`研究方向设为${DIRECTIONS[id].name}。`);
  }
  if (verb === 'start') {
    if (!Object.hasOwn(PROJECTS, id)) return fail('没有这个研究项目。');
    if (research.project) return fail('当前项目尚未结束。');
    const scope = researchScope(profile, id);
    const reasons = requirements(profile, id, scope);
    if (reasons.length) return fail(reasons.join('；'));
    const error = pay(profile, PROJECTS[id].cost * (scope + 1), PROJECTS[id].materials);
    if (error) return fail(error);
    const preparation = Object.entries(PROJECTS[id].materials).reduce((total, [material, count]) => {
      const used = Math.min(count, number(research.prepared[material]));
      if (Object.hasOwn(research.prepared, material)) research.prepared[material] -= used;
      return total + used;
    }, 0);
    research.sequence += 1;
    research.day += 1;
    research.project = { id: `paper-${research.sequence}`, type: id, direction: research.direction, scope,
      title: `${DIRECTIONS[research.direction].topic} · ${['基础', '进阶', '前沿'][scope]}${PROJECTS[id].name} #${research.sequence}`,
      quality: Math.min(100, 25 + Math.min(8, gearBonus(profile, 'literature')) + preparation * 4
        + titleSupport(research.stage).initialQuality + (research.legacySupport?.initialQuality || 0)),
      evidence: preparation * 5, preparation, successfulRuns: 0, setbacks: 0, lastOutcome: '',
      runs: 0, reviews: 0, submittedRuns: 0, status: 'experiment' };
    return done('课题已建立，数据与研究材料已投入。下一步需要算力卡运行实验。');
  }
  if (verb === 'promote') {
    if (research.project) return fail('先完成或放弃当前项目。');
    const reasons = promotionReasons(profile);
    if (reasons.length) return fail(reasons.join('；'));
    const stage = research.stage + 1;
    const rewardedStage = Math.max(research.stage, number(research.rewardedStage, research.stage));
    const grant = stage > rewardedStage ? PROMOTION_GRANTS[stage] : 0;
    // Validate first, then move the stage and reward ledger in the same action.
    research.stage = stage;
    research.rewardedStage = Math.max(stage, rewardedStage);
    research.talent = null;
    profile.funding += grant;
    research.lastMilestone = { stage, grant, acknowledged: false };
    const milestone = milestoneView(research, stage, grant);
    return done(`晋升为${milestone.stageName}！+${grant} 经费已到账。`);
  }
  const project = research.project;
  if (!project) return fail('请先创建研究项目。');
  const t = PROJECTS[project.type];
  if (verb === 'abandon') {
    research.project = null;
    return done('项目已放弃，个人能力保留，已消耗的材料和算力不会返还。');
  }
  if (verb === 'experiment') {
    if (!['experiment', 'revision', 'rejected'].includes(project.status)) return fail('当前项目不能继续实验。');
    const reasons = requirements(profile, project.type, project.scope);
    if (reasons.length) return fail(reasons.join('；'));
    const error = pay(profile, t.cost * (project.scope + 1), { compute: 1 + project.scope });
    if (error) return fail(error);
    const outcome = experimentOutcome(factorInputs(profile, project), random(research));
    const oldQuality = project.quality;
    const oldEvidence = project.evidence;
    project.quality = Math.min(100, oldQuality + outcome.qualityGain);
    project.evidence = Math.min(100, oldEvidence + outcome.evidenceGain);
    project.runs += 1;
    project.successfulRuns += Number(outcome.success);
    project.setbacks += Number(!outcome.success);
    project.status = 'experiment';
    research.methods[project.type] = Math.min(METHOD_CAP, number(research.methods[project.type]) + 1);
    research.skills.engineering += 2;
    research.skills.research += 2;
    research.day += 1;
    project.lastOutcome = `${outcome.success ? '实验已稳定复现' : '结果出现波动，已记录排查方法'}；质量 +${project.quality - oldQuality}，证据 +${project.evidence - oldEvidence}`;
    return done(`${project.lastOutcome}。`);
  }
  if (verb === 'submit') {
    if (!['experiment', 'revision', 'rejected'].includes(project.status) || project.runs < 2) return fail('至少完成两轮实验，才能投稿。');
    if (project.runs <= project.submittedRuns) return fail('补实验后才能重新投稿。');
    project.status = 'submitted';
    project.submittedRuns = project.runs;
    research.skills.expression += 1;
    research.day += 1;
    return done('论文已投稿，等待查看审稿结果。投稿尚不增加发表成果。');
  }
  if (verb === 'review') {
    if (project.status !== 'submitted') return fail('当前没有待审稿的论文。');
    const outcome = reviewOutcome(factorInputs(profile, project), random(research), project.type);
    project.reviews += 1;
    research.day += 1;
    project.status = outcome.status;
    project.lastOutcome = outcome.status === 'ready' ? '审稿通过，实验结论与对照证据已获认可'
      : `${outcome.status === 'revision' ? '论文需要返修' : '论文暂未录用'}：${outcome.issue}，补实验后重新投稿`;
    return done(`${project.lastOutcome}。`);
  }
  if (verb === 'publish') {
    if (project.status !== 'ready') return fail('论文尚未通过审稿。');
    const credit = t.credit * (project.scope + 1);
    const grant = t.grant * (project.scope + 1) + (research.legacySupport?.publicationGrant || 0);
    research.papers.push({ id: project.id, type: project.type, title: project.title, quality: project.quality, evidence: project.evidence, credit, day: research.day });
    research.completed[project.type] += 1;
    profile.achievement += credit;
    profile.funding += grant;
    research.skills.research += 2;
    research.skills.expression += 2;
    research.project = null;
    return done(`论文录用，发表成果 +${credit}，研究支持经费 +${grant}。`);
  }
  return fail('未知的研究操作。');
}

export function learnFromRaid(profile, run) {
  const history = run.history || [];
  profile.research.skills.research += Math.min(3, history.filter(id => id.startsWith('container:search:')).length);
  profile.research.skills.expression += Math.min(3, history.filter(id => id.startsWith('npc:reply:')).length);
}
