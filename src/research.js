import { ITEMS } from './content.js';
import { CAREER_TALENTS, talentRankForStage, normalizeCareerTalent, careerTalentBenefits } from '../public/career-talents.js';

export const EQUIPMENT_SLOTS = ['bag', 'focus', 'tool', 'device', 'storage'];
export const DIRECTIONS = {
  llm: { name: '大模型', specialty: 'finetune', topic: '轻量语言模型' },
  multimodal: { name: '多模态', specialty: 'evaluate', topic: '图文理解模型' },
  robotics: { name: '机器人', specialty: 'replicate', topic: '机器人策略模型' },
  systems: { name: 'AI 系统', specialty: 'replicate', topic: '推理优化系统' },
};
export const PROJECTS = {
  replicate: { name: '复现研究', minStage: 0, engineering: 1, research: 1, capacity: 1, materials: { dataset: 1, src_code: 1 }, cost: 30, target: 65, credit: 30, grant: 80 },
  evaluate: { name: '模型评测', minStage: 0, engineering: 1, research: 1, capacity: 1, materials: { dataset: 1, wind: 1 }, cost: 40, target: 70, credit: 45, grant: 100 },
  finetune: { name: '微调实验', minStage: 1, engineering: 2, research: 2, capacity: 2, materials: { dataset: 1, src_code: 1 }, cost: 80, target: 78, credit: 80, grant: 180 },
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

export function normalizeResearch(value = {}, seed = 1) {
  if (!value || typeof value !== 'object') value = {};
  const papers = Array.isArray(value.papers) ? value.papers.filter(p => p && Object.hasOwn(PROJECTS, p.type) && typeof p.id === 'string').map(p => ({
    id: p.id, type: p.type, title: String(p.title || PROJECTS[p.type].name), quality: Math.min(100, number(p.quality)), credit: number(p.credit), day: number(p.day),
  })) : [];
  const raw = value.project;
  const project = raw && Object.hasOwn(PROJECTS, raw.type) && Object.hasOwn(DIRECTIONS, raw.direction) && typeof raw.id === 'string' ? {
    id: raw.id, type: raw.type, direction: raw.direction, title: String(raw.title || PROJECTS[raw.type].name),
    scope: Math.min(2, number(raw.scope)), quality: Math.min(100, number(raw.quality)), runs: Math.min(6, number(raw.runs)),
    status: ['experiment', 'submitted', 'revision', 'ready', 'rejected'].includes(raw.status) ? raw.status : 'experiment',
    reviews: number(raw.reviews), submittedRuns: number(raw.submittedRuns),
  } : null;
  const stage = Math.min(STAGES.length - 1, number(value.stage));
  // A legacy stage is already earned; migration never grants its rewards again.
  // Keep a higher high-water mark if a damaged save moved the stage backwards.
  const rewardedStage = Math.min(STAGES.length - 1, Math.max(stage, number(value.rewardedStage, stage)));
  const milestoneStage = number(value.lastMilestone?.stage);
  const lastMilestone = milestoneStage > 0 && milestoneStage <= stage ? {
    stage: milestoneStage,
    grant: number(value.lastMilestone.grant) > 0 ? PROMOTION_GRANTS[milestoneStage] : 0,
    acknowledged: value.lastMilestone.acknowledged === true,
  } : null;
  return {
    direction: Object.hasOwn(DIRECTIONS, value.direction) ? value.direction : 'llm',
    skills: Object.fromEntries(['engineering', 'research', 'expression'].map(key => [key, number(value.skills?.[key])])),
    stage, day: number(value.day), rewardedStage,
    talent: normalizeCareerTalent(value.talent, stage), lastMilestone,
    rng: (number(value.rng, seed) >>> 0) || 1, sequence: Math.max(number(value.sequence), ...papers.map(p => number(p.id.split('-').at(-1)))), papers,
    completed: Object.fromEntries(Object.keys(PROJECTS).map(key => [key, number(value.completed?.[key])])),
    project, lastMessage: String(value.lastMessage || '带回研究材料，在这里开始第一个项目。'),
  };
}

function talentView(research, stage = research.stage) {
  const talent = normalizeCareerTalent(research.talent, stage);
  if (!talent) return null;
  const definition = CAREER_TALENTS[talent.id];
  const benefits = careerTalentBenefits(talent);
  const researchPerk = talent.id === 'archivist' ? `新课题初始质量 +${benefits.initialQuality}`
    : talent.id === 'connector' ? `每篇录用论文额外支持经费 +${benefits.publicationGrant}`
      : `每轮实验质量额外 +${benefits.experimentQuality}`;
  return { ...definition, ...talent, perks: [definition.activeDescription, researchPerk], researchPerk };
}

function milestoneView(research, stage, grant = PROMOTION_GRANTS[stage]) {
  const rank = talentRankForStage(stage);
  const previousRank = talentRankForStage(stage - 1);
  const benefits = [`${PROMOTION_GRANT_NAMES[stage]} +${grant} 经费（一次性）`];
  if (stage === 1) benefits.push('选择一种永久科研流派，解锁自己的远征主动能力与研究专长', '微调实验与 GPU 工作站终端开放，仍需满足课题设备和能力条件');
  if (stage === 2) benefits.push('新地点：AI 实验室访学', '数据清洗工具开放购买与装备');
  if (stage === 3) benefits.push('进阶课题：成果与基础论文支持经费翻倍，实验算力与经费消耗同步提高', '集群远程终端开放购买与装备');
  if (stage === 4) benefits.push('新地点：企业联合研究');
  if (stage === 6) benefits.push('前沿课题：成果与基础论文支持经费为基础的三倍，实验算力与经费消耗同步提高');
  if (rank > previousRank && stage > 1) {
    const talent = talentView(research, stage);
    benefits.push(talent ? `${talent.name}升至 ${rank} 级：${talent.researchPerk}` : `科研流派专长升至 ${rank} 级；选择后立即生效`);
  }
  if (stage === STAGES.length - 1) benefits.push('全部生涯阶段已达成，可以继续自己的课题与远征');
  return { stage, stageName: STAGES[stage].name, grant, grantName: PROMOTION_GRANT_NAMES[stage],
    talentRank: rank, benefits };
}

function progressionView(research) {
  const talent = talentView(research);
  const canChooseTalent = research.stage >= 1 && !talent;
  return {
    talent, canChooseTalent,
    talents: Object.values(CAREER_TALENTS).map(row => {
      const selected = talent?.id === row.id;
      const example = talentView({ ...research, talent: row.id }, Math.max(1, research.stage));
      return { ...example, actionId: `research:talent:${row.id}`, selected,
        disabled: !canChooseTalent,
        reason: selected ? '这是你的永久科研流派' : talent ? '科研流派已确定，晋升会提升现有专长' : research.stage < 1 ? '首次晋升后可选择' : '' };
    }),
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
function requirements(profile, type, scope = Math.min(2, Math.floor(profile.research.stage / 3))) {
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
function promotionReasons(profile) {
  const research = profile.research;
  const next = STAGES[research.stage + 1];
  if (!next) return ['已达到最高生涯阶段'];
  const levels = skillLevels(research);
  return [research.papers.length < next.papers ? `录用论文 ${research.papers.length}/${next.papers}` : '',
    profile.achievement < next.credit ? `发表成果 ${profile.achievement}/${next.credit}` : '',
    levels.engineering < next.skill ? `工程 ${levels.engineering}/${next.skill} 级` : '',
    levels.research < next.skill ? `研究 ${levels.research}/${next.skill} 级` : '',
    levels.expression < Math.max(1, next.skill - 1) ? `表达 ${levels.expression}/${Math.max(1, next.skill - 1)} 级` : '',
  ].filter(Boolean);
}

export function researchView(profile) {
  const research = profile.research;
  const scope = Math.min(2, Math.floor(research.stage / 3));
  const project = research.project;
  const actions = [];
  const preparations = Object.entries(PREPARATIONS).map(([id, output]) => ({ id, inputName: ITEMS[id].name, outputName: ITEMS[output].name, disabled: !number(profile.stash[id]) }));
  const add = (id, name, reasons = []) => actions.push({ id: `research:${id}`, name, disabled: reasons.length > 0, reason: reasons.join('；') });
  if (project) {
    const t = PROJECTS[project.type];
    const cost = t.cost * (project.scope + 1);
    const target = Math.min(95, t.target + project.scope * 5);
    if (['experiment', 'revision', 'rejected'].includes(project.status)) {
      const reasons = [...requirements(profile, project.type, project.scope), ...materialReasons(profile, { compute: 1 + project.scope })];
      if (profile.funding < cost) reasons.push(`需要 ${cost} 经费`);
      if (project.runs >= 6) reasons.push('已达六轮实验上限，可投稿或放弃');
      add('experiment', `运行实验 · ${1 + project.scope} 张算力卡 / ${cost} 经费`, reasons);
    }
    if (['experiment', 'revision', 'rejected'].includes(project.status)) add('submit', '整理并投稿', project.runs < 2 ? ['至少完成两轮实验'] : project.runs <= (project.submittedRuns || 0) ? ['补实验后才能重新投稿'] : []);
    if (project.status === 'submitted') add('review', '查看审稿结果');
    if (project.status === 'ready') add('publish', '确认录用 · 发表成果');
    add('abandon', '放弃项目 · 已投入资源不返还');
    return { ...structuredClone(research), ...progressionView(research), skills: skillLevels(research), skillXp: { ...research.skills }, stageName: STAGES[research.stage].name,
      capacity: capacity(profile), directions: DIRECTIONS, preparations, project: { ...project, target, experimentCost: cost }, templates: [], actions, nextStage: STAGES[research.stage + 1]?.name || null, promotionReasons: promotionReasons(profile) };
  }
  add('promote', '申请晋升', promotionReasons(profile));
  return { ...structuredClone(research), ...progressionView(research), skills: skillLevels(research), skillXp: { ...research.skills }, stageName: STAGES[research.stage].name,
    capacity: capacity(profile), directions: DIRECTIONS, preparations, actions, nextStage: STAGES[research.stage + 1]?.name || null, promotionReasons: promotionReasons(profile),
    templates: Object.entries(PROJECTS).map(([type, t]) => {
      const reasons = [...requirements(profile, type, scope), ...materialReasons(profile, t.materials)];
      if (profile.funding < t.cost * (scope + 1)) reasons.push('启动经费不足');
      return { id: type, name: `${['基础', '进阶', '前沿'][scope]}${t.name}`, materials: t.materials, cost: t.cost * (scope + 1),
        credit: t.credit * (scope + 1), disabled: reasons.length > 0, reason: reasons.join('；') };
    }) };
}

export function researchAct(profile, action) {
  const research = profile.research;
  const [verb, id, ...extra] = String(action || '').split(':');
  const fail = reason => ({ ok: false, reason });
  const done = message => { research.lastMessage = message; return { ok: true, message }; };
  if (verb === 'talent') {
    if (extra.length || !Object.hasOwn(CAREER_TALENTS, id)) return fail('没有这个科研流派。');
    if (research.stage < 1) return fail('完成首次晋升后，才能选择科研流派。');
    if (normalizeCareerTalent(research.talent, research.stage)) return fail('科研流派已确定，后续晋升会提升现有专长，不能重新选择。');
    research.talent = normalizeCareerTalent(id, research.stage);
    const talent = talentView(research);
    return done(`选择了${talent.name}：${talent.activeDescription}${talent.researchPerk}。流派永久保留，博士后与教授阶段会提升专长。`);
  }
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
    research.day += 1;
    return done(`已将一份${ITEMS[id].name}整理为${ITEMS[output].name}，可以投入课题。`);
  }
  if (verb === 'direction') {
    if (!Object.hasOwn(DIRECTIONS, id)) return fail('没有这个研究方向。');
    if (research.project) return fail('请先完成或放弃当前项目，再切换研究方向。');
    research.direction = id;
    return done(`研究方向设为${DIRECTIONS[id].name}，对应专长项目的实验质量 +4。`);
  }
  if (verb === 'start') {
    if (!Object.hasOwn(PROJECTS, id)) return fail('没有这个研究项目。');
    if (research.project) return fail('当前项目尚未结束。');
    const scope = Math.min(2, Math.floor(research.stage / 3));
    const reasons = requirements(profile, id, scope);
    if (reasons.length) return fail(reasons.join('；'));
    const error = pay(profile, PROJECTS[id].cost * (scope + 1), PROJECTS[id].materials);
    if (error) return fail(error);
    research.sequence += 1;
    research.day += 1;
    research.project = { id: `paper-${research.sequence}`, type: id, direction: research.direction, scope,
      title: `${DIRECTIONS[research.direction].topic} · ${['基础', '进阶', '前沿'][scope]}${PROJECTS[id].name} #${research.sequence}`,
      quality: 25 + Math.min(8, gearBonus(profile, 'literature')) + (careerTalentBenefits(normalizeCareerTalent(research.talent, research.stage))?.initialQuality || 0),
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
    research.talent = normalizeCareerTalent(research.talent, stage);
    profile.funding += grant;
    research.lastMilestone = { stage, grant, acknowledged: false };
    const milestone = milestoneView(research, stage, grant);
    return done(`晋升为${milestone.stageName}！${milestone.grantName} +${grant} 经费已到账。${stage === 1 ? '现在可以选择你的永久科研流派。' : milestone.benefits.slice(1).join('；') || '这笔经费可以自由投入课题、设备或下一次远征。'}`);
  }
  const project = research.project;
  if (!project) return fail('请先创建研究项目。');
  const t = PROJECTS[project.type];
  const target = Math.min(95, t.target + project.scope * 5);
  if (verb === 'abandon') {
    research.project = null;
    return done('项目已放弃，个人能力保留，已消耗的材料和算力不会返还。');
  }
  if (verb === 'experiment') {
    if (!['experiment', 'revision', 'rejected'].includes(project.status) || project.runs >= 6) return fail('当前项目不能继续实验。');
    const reasons = requirements(profile, project.type, project.scope);
    if (reasons.length) return fail(reasons.join('；'));
    const error = pay(profile, t.cost * (project.scope + 1), { compute: 1 + project.scope });
    if (error) return fail(error);
    const levels = skillLevels(research);
    const setback = random(research) < 0.2 && project.runs < 2;
    const gain = (setback ? 6 : 16) + Math.min(10, levels.engineering + levels.research) + gearBonus(profile, 'experiment')
      + (DIRECTIONS[project.direction].specialty === project.type ? 4 : 0)
      + (careerTalentBenefits(normalizeCareerTalent(research.talent, research.stage))?.experimentQuality || 0);
    project.quality = Math.min(100, project.quality + gain);
    project.runs += 1;
    project.status = 'experiment';
    research.skills.engineering += 2;
    research.skills.research += 2;
    research.day += 1;
    return done(`${setback ? '实验遇到波动，保留了排查记录' : '实验完成'}，质量 +${gain}；工程与研究各获得 2 点经验。`);
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
    project.reviews += 1;
    research.day += 1;
    // Repeated submissions alone cannot improve quality or manufacture acceptance.
    project.status = project.quality >= target ? 'ready' : project.quality >= target - 20 ? 'revision' : 'rejected';
    return done(project.status === 'ready' ? '审稿通过，可以确认录用。' : `${project.status === 'revision' ? '需要补实验返修' : '论文被拒稿'}：质量 ${project.quality}/${target}，补实验后可重新投稿。`);
  }
  if (verb === 'publish') {
    if (project.status !== 'ready') return fail('论文尚未通过审稿。');
    const credit = t.credit * (project.scope + 1);
    const grant = t.grant * (project.scope + 1) + (careerTalentBenefits(normalizeCareerTalent(research.talent, research.stage))?.publicationGrant || 0);
    research.papers.push({ id: project.id, type: project.type, title: project.title, quality: project.quality, credit, day: research.day });
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
