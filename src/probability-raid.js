import { ITEMS } from './content.js';
import { GEAR } from './loot-content.js';
import { DIRECTIONS, skillLevels } from './research.js';
import { likelihoodLabel, riskLabel, encounterLabel } from '../public/expedition-language.js';
import { CAREER_TALENTS } from '../public/career-talents.js';
import { prepareSurpriseEncounter } from './encounter-surprises.js';
import { normalizeStories, academicStoriesView, academicStoryCandidates, academicStoryWeight,
  academicStoryCallbackReady, storyResolutionAllowed, recordAcademicStory, withAcademicStoryEcho } from './academic-stories.js';
export { normalizeStories } from './academic-stories.js';

export const PROBABILITY_MODE = 'probability';
export const PROBABILITY_BASE_WILL = 10;
export const PROBABILITY_BASE_BAG_CAP = 6;
export const PROBABILITY_MAX_SUPPLIES = 3;

const MATERIAL_IDS = ['dataset', 'src_code', 'compute', 'wind'];
const RESEARCH_MATERIALS = new Set(MATERIAL_IDS);
const VENUES = {
  conference: {
    name: '学术交流', minStage: 0, cost: 0, baseRisk: 5, growth: 8, difficulty: 0, extraDrop: 0,
    weights: { dataset: 4, src_code: 3, compute: 2, wind: 1 },
    desc: '免费基础地点，适合补齐常见研究材料。',
  },
  visit: {
    name: '实验室访学', minStage: 2, cost: 40, baseRisk: 12, growth: 12, difficulty: 8, extraDrop: 0.25,
    weights: { dataset: 5, src_code: 4, compute: 1, wind: 2 },
    desc: '数据与源码机会较多；成功搜获后有额外掉落机会。',
  },
  industry: {
    name: '企业联合研究', minStage: 4, cost: 80, baseRisk: 20, growth: 16, difficulty: 16, extraDrop: 0.5,
    weights: { dataset: 2, src_code: 3, compute: 6, wind: 2 },
    desc: '算力机会较多，风险与出行费也更高。',
  },
};

const DIFFICULTIES = {
  easy: { name: '新手', description: '适合新手；材料获取率略低，风险增长放缓，事件更容易应对。', acquisitionModifier: -5, riskModifier: -3, eventModifier: 10, extraDropModifier: 0 },
  normal: { name: '标准', description: '按地点和角色能力正常结算。', acquisitionModifier: 0, riskModifier: 0, eventModifier: 0, extraDropModifier: 0 },
  hard: { name: '挑战', description: '材料与额外发现机会更高，但风险增长更快，事件检定更严格。', acquisitionModifier: 8, riskModifier: 4, eventModifier: -10, extraDropModifier: 15 },
};
const MAX_MATERIAL_WEIGHT_BONUS = 50;

export function isProbabilityDifficulty(value) {
  return typeof value === 'string' && Object.hasOwn(DIFFICULTIES, value);
}

const GEAR_HINTS = {
  canvas_pack: { description: '加厚学术帆布包', effects: ['背包容量 +1 格。'] },
  foam_earplugs: { description: '降噪耳塞', effects: ['交谈时更容易集中注意；与降噪耳机不叠加。'] },
  coffee_thermos: { description: '实验室保温杯', effects: ['心力上限 +0.5。'] },
  badge_wallet: { description: '证件收纳夹', effects: ['容量加成 +0.5 格；合计后四舍五入。'] },
  noise_headphones: { description: '降噪耳机', effects: ['交谈时更容易集中注意；与降噪耳塞不叠加。'] },
  field_recorder: { description: '便携记录仪', effects: ['心力上限 +1；解释方案更有把握。'] },
  padded_case: { description: '加厚仪器收纳包', effects: ['容量加成 +1.5 格；合计后四舍五入。'] },
  citation_scanner: { description: '文献扫描笔', effects: ['更容易留意到方向情报。'] },
  digital_notebook: { description: '电子实验记录本', effects: ['心力上限 +1；展示依据更有把握。'] },
  custom_lab_pack: { description: '课题组定制登山包', effects: ['背包容量 +3 格；心力上限 +1。'] },
  lightweight_laptop: { description: '轻薄研究本', effects: ['稍容易找到算力卡。'] },
  gpu_workstation: { description: 'GPU 工作站终端', effects: ['更容易找到算力卡。'] },
  remote_terminal: { description: '集群远程终端', effects: ['寻找算力卡时更得心应手。'] },
  literature_assistant: { description: '文献助手终端', effects: ['更容易找到数据包；展示依据更有把握。'] },
  experiment_tracker: { description: '实验追踪器', effects: ['更容易找到源码；展示依据更有把握。'] },
  data_cleaner: { description: '数据清洗工具', effects: ['更容易找到可用数据包。'] },
  portable_ssd: { description: '移动数据盘', effects: ['背包容量 +1 格。'] },
  encrypted_ssd: { description: '加密 SSD', effects: ['容量加成 +0.5 格，合计后四舍五入；撤离时更稳妥。'] },
  backup_device: { description: '研究备份设备', effects: ['可指定 1 件研究材料保护；任何撤离结果都能保留。'] },
};

// Conditions last for a short stretch of the expedition, rather than rerolling
// independent bonuses on every view/search. IDs, never client-supplied numbers,
// select the bounded rules. Absent or unknown legacy fields remain neutral.
const FIELD_CONDITIONS = {
  arrival: { name: '公开交流区', description: '先熟悉现场，沿常规路线寻找材料。',
    acquisition: 0, encounter: 0, risk: 0, partial: 0, fail: 0 },
  exchange: { name: '热闹交换区', description: '材料与合作机会不少，人多也更容易引起注意。',
    acquisition: 6, encounter: 10, risk: 2, partial: 2, fail: 0,
    materials: { dataset: 1.2, src_code: 1.15 }, events: { npc: 2, resource: 2 } },
  sidepath: { name: '安静侧廊', description: '资料较零散，绕行却能避开人群，返程更从容。',
    acquisition: -4, encounter: -10, risk: -2, partial: -2, fail: -1,
    materials: { wind: 1.4 }, events: { npc: 0.8, resource: 0.7, route: 2 } },
  lab: { name: '开放演示间', description: '算力和源码线索丰富，繁忙终端偶尔会出故障。',
    acquisition: 8, encounter: 5, risk: 2, partial: 0, fail: 2,
    materials: { compute: 1.4, src_code: 1.2 }, events: { technical: 2.5, resource: 1.5 } },
  checkpoint: { name: '临时核查区', description: '进出登记变严，搜寻和返程都需要更谨慎。',
    acquisition: -5, encounter: 12, risk: 3, partial: 4, fail: 1,
    events: { route: 2.5, npc: 1.5 } },
  archive: { name: '资料整理区', description: '数据与源码集中在这里，仔细核验才能安心带走。',
    acquisition: 5, encounter: -4, risk: 1, partial: -1, fail: 0,
    materials: { dataset: 1.3, src_code: 1.3 }, events: { technical: 1.8, resource: 1.5 } },
};
const APPROACHES = {
  cautious: { name: '谨慎摸排', hint: '收获少些，遇事更从容，也更靠近出口。',
    acquisition: -10, encounter: -8, risk: -3, extra: -5, depth: -1, check: 3 },
  steady: { name: '常规搜索', hint: '兼顾收获和返程，按当前路线探索。',
    acquisition: 0, encounter: 0, risk: 0, extra: 0, depth: 0, check: 0 },
  deep: { name: '深入搜寻', hint: '机会更多，处理波折和返程也更吃力。',
    acquisition: 10, encounter: 10, risk: 4, extra: 10, depth: 1, check: -3 },
};
const MOMENTUM = {
  contact: { name: '熟人指路', description: '有人帮你辨认线索，搜寻与返程更顺利。', acquisition: 6, encounter: -4, risk: -1, partial: -2 },
  scrutiny: { name: '受到关注', description: '刚才的交流引来注意，接下来更容易遇到追问。', encounter: 6, risk: 3, check: -4 },
  lead: { name: '新线索', description: '刚得到的线索让接下来的搜寻更有收获。', acquisition: 8, extra: 5 },
  interference: { name: '线索受阻', description: '现场问题尚未解决，接下来的搜寻会更费力。', acquisition: -6, risk: 3, check: -3 },
  repaired: { name: '终端恢复', description: '设备恢复工作，搜寻和技术处理都更顺手。', acquisition: 5, risk: -2, check: 5 },
  clear: { name: '返程畅通', description: '刚打通的路线让这段探索与返程更稳妥。', risk: -2, partial: -4, fail: -2 },
  detour: { name: '被迫绕行', description: '出口附近仍有阻碍，返程需要多留余地。', risk: 2, partial: 4, fail: 2 },
};

const EQUIPMENT_SLOTS = ['bag', 'focus', 'tool', 'device', 'storage'];
const clamp = (value, low, high) => Math.min(high, Math.max(low, Number(value) || 0));
const round1 = value => Math.round((Number(value) || 0) * 10) / 10;
const clone = value => structuredClone(value);
const canonicalItem = id => typeof id === 'string' && Object.hasOwn(ITEMS, id);
const itemWeight = id => Math.max(0, Number(ITEMS[id]?.weight) || 0);
const itemValue = id => Math.max(0, Number(ITEMS[id]?.value) || 0);
const itemName = id => ITEMS[id]?.name || id;

const EVENT_TYPE_LABELS = { npc: '人物交涉', resource: '资源机会', technical: '技术故障', route: '路线状况' };
// Template IDs are persistent save keys; their spelling does not select a rule version.
const EVENT_TEMPLATES = [
  { id: 'v2-prof-audit', npcId: 'prof-wen', name: '温教授', type: 'npc', tone: 'social',
    image: '/assets/generated/scholar.png', title: '评测依据核对', text: '温教授想确认你手里的评测结果是否有可追溯依据。', difficulty: 0,
    choices: [
      { key: 'show-record', name: '展示数据或源码', requiresAny: ['dataset', 'src_code'], cost: { will: 1 },
        check: { base: 55, skill: 'research', perLevel: 4, cap: 20, evidenceBonus: 20, gear: 'evidence', riskFactor: 0.04 },
        success: { riskDelta: -10, support: 8, rewardId: 'wind', trustDelta: 1, text: '教授认可了可核验的依据。' },
        failure: { riskDelta: 8, willDelta: -1, trustDelta: -1, text: '依据仍不够完整，交流增加了压力。' } },
      { key: 'explain-method', name: '解释验证方法', cost: { will: 1 },
        check: { base: 55, skill: 'expression', perLevel: 5, cap: 25, gear: 'explain', communication: 5, riskFactor: 0.04 },
        success: { riskDelta: -6, support: 8, trustDelta: 1, text: '教授接受了你的说明。' },
        failure: { riskDelta: 7, willDelta: -1, trustDelta: -1, text: '教授继续追问，讨论没有说服对方。' } },
    ] },
  { id: 'v2-peer-collab', npcId: 'peer-zhou', name: '周同学', type: 'npc', tone: 'opportunity',
    image: '/assets/generated/scholar.png', title: '共享数据合作', text: '周同学愿意交换研究线索，正在确认双方的投入边界。', difficulty: 0,
    choices: [
      { key: 'outline-boundary', name: '谈清合作边界', cost: { network: 1 },
        check: { base: 55, skill: 'expression', perLevel: 5, cap: 25, riskFactor: 0.03 },
        success: { riskDelta: -6, support: 8, rewardId: 'coop', trustDelta: 1, text: '双方确认了合作边界。' },
        failure: { riskDelta: 8, trustDelta: -1, text: '合作条件没有谈拢，人情已经用出。' } },
      { key: 'show-dataset', name: '拿数据样例交换方向', requires: { dataset: 1 }, cost: { will: 1 },
        check: { base: 55, skill: 'research', perLevel: 4, cap: 20, evidenceBonus: 10, riskFactor: 0.03 },
        success: { riskDelta: -4, support: 8, rewardId: 'wind', trustDelta: 1, text: '周同学分享了一条研究方向。' },
        failure: { riskDelta: 7, willDelta: -1, trustDelta: -1, text: '交换没有形成对等合作。' } },
      { key: 'clarify-scope', name: '花心力重新说明合作边界', cost: { will: 1 },
        check: { base: 55, skill: 'expression', perLevel: 5, cap: 25, communication: 5, riskFactor: 0.03 },
        success: { riskDelta: -2, text: '双方同意先从小范围合作开始。' },
        failure: { riskDelta: 7, willDelta: -1, text: '合作边界仍未谈拢，反复沟通消耗了心力。' } },
    ] },
  { id: 'v2-engineer-credit', npcId: 'engineer-qin', name: '秦工程师', type: 'npc', tone: 'opportunity',
    image: '/assets/generated/research-desk.png', title: '算力试用申请', text: '工程师手里有一张试用算力卡，想先了解你的验证计划。', difficulty: 1,
    choices: [
      { key: 'present-plan', name: '说明验证计划', cost: { will: 1 },
        check: { base: 55, skill: 'engineering', perLevel: 4, cap: 20, gear: 'explain', riskFactor: 0.03 },
        success: { riskDelta: -4, rewardId: 'compute', text: '工程师批准了一张算力试用卡。' },
        failure: { riskDelta: 7, willDelta: -1, text: '试用申请需要补充具体参数。' } },
      { key: 'spend-network', name: '用人脉担保领取', cost: { network: 1 },
        success: { riskDelta: 2, rewardId: 'compute', text: '担保通过，拿到一张算力卡。' },
        failure: { riskDelta: 0, text: '人脉已用于担保，工程师保留了算力卡。' } },
    ] },
  { id: 'v2-resource-data-swap', name: '数据交换台', type: 'resource', tone: 'opportunity',
    image: '/assets/generated/locker.png', title: '公开样本交换', text: '交换台允许研究者用一条方向情报换取一份整理过的数据样本。', difficulty: 0,
    choices: [
      { key: 'trade-wind', name: '交出方向情报换数据', requires: { wind: 1 }, cost: { items: { wind: 1 } },
        success: { riskDelta: -3, rewardId: 'dataset', text: '你交出一条情报，换回一份数据包。' } },
      { key: 'inspect-sample', name: '抽样核验数据质量', cost: { will: 1 },
        check: { base: 55, skill: 'research', perLevel: 4, cap: 20, gear: 'evidence', riskFactor: 0.02 },
        success: { riskDelta: -2, rewardId: 'dataset', text: '抽样结果可信，工作人员交付了数据包。' },
        failure: { riskDelta: 5, willDelta: -1, text: '样本质量不明，核验消耗了时间与心力。' } },
    ] },
  { id: 'v2-resource-compute-demo', name: '算力试用柜台', type: 'resource', tone: 'opportunity',
    image: '/assets/generated/research-desk.png', title: '试用额度交换', text: '柜台可以把一份已有数据转换成短期算力额度。', difficulty: 1,
    choices: [
      { key: 'exchange-dataset', name: '提交数据换算力', requires: { dataset: 1 }, cost: { items: { dataset: 1 } },
        success: { support: 8, rewardId: 'compute', text: '数据通过核验，换回一张算力卡。' } },
      { key: 'pitch-project', name: '说明项目用途申请试用', cost: { will: 1 },
        check: { base: 55, skill: 'expression', perLevel: 5, cap: 25, gear: 'explain', communication: 5, riskFactor: 0.03 },
        success: { riskDelta: -4, support: 8, rewardId: 'compute', text: '试用申请通过，拿到一张算力卡。' },
        failure: { riskDelta: 6, willDelta: -1, text: '试用名额留给了更明确的项目。' } },
    ] },
  { id: 'v2-resource-code-share', name: '开源项目分享会', type: 'resource', tone: 'opportunity',
    image: '/assets/generated/poster-board.png', title: '源码访问机会', text: '项目维护者可以提供一份源码副本，但需要交换公开情报或验证复现能力。', difficulty: 1,
    choices: [
      { key: 'trade-wind-code', name: '用方向情报交换源码', requires: { wind: 1 }, cost: { items: { wind: 1 } },
        success: { riskDelta: 1, rewardId: 'src_code', text: '你交出情报，获得了源码副本。' } },
      { key: 'replication-check', name: '说明复现检查方法', cost: { will: 1 },
        check: { base: 55, skill: 'engineering', perLevel: 4, cap: 20, evidenceBonus: 10, riskFactor: 0.03 },
        success: { riskDelta: -4, rewardId: 'src_code', text: '维护者认可你的复现计划，开放了源码。' },
        failure: { riskDelta: 8, willDelta: -1, text: '复现方案还缺少关键步骤。' } },
    ] },
  { id: 'v2-tech-terminal', name: '故障终端', type: 'technical', tone: 'danger',
    image: '/assets/generated/research-desk.png', title: '终端过热', text: '展区终端过热并中断演示，继续操作可能损坏手头记录。', difficulty: 1,
    choices: [
      { key: 'repair-terminal', name: '排查散热故障', cost: { will: 1 },
        check: { base: 55, skill: 'engineering', perLevel: 4, cap: 20, gear: 'explain', riskFactor: 0.05 },
        success: { riskDelta: -10, support: 8, text: '散热恢复，终端重新上线。' },
        failure: { riskDelta: 12, willDelta: -1, text: '故障扩大，现场注意到了这次中断。' } },
      { key: 'use-compute-buffer', name: '消耗算力卡保存日志', requires: { compute: 1 }, cost: { items: { compute: 1 } },
        success: { riskDelta: -5, text: '缓存保存了日志，终端可以稍后维修。' } },
    ] },
  { id: 'v2-tech-data-corruption', name: '损坏的样本索引', type: 'technical', tone: 'danger',
    image: '/assets/generated/locker.png', title: '样本索引损坏', text: '一份数据包的索引不完整，错误处理可能让后续复现结果失真。', difficulty: 2,
    choices: [
      { key: 'validate-split', name: '重新核对数据划分', requires: { dataset: 1 }, cost: { will: 1 },
        check: { base: 55, skill: 'research', perLevel: 4, cap: 20, gear: 'evidence', riskFactor: 0.05 },
        success: { riskDelta: -8, rewardId: 'wind', text: '划分核验完成，留下了一条可靠线索。' },
        failure: { riskDelta: 10, willDelta: -1, text: '索引仍无法确认，额外排查提高了暴露。' } },
      { key: 'use-code-to-rebuild', name: '用源码脚本重建索引', requires: { src_code: 1 }, cost: { items: { src_code: 1 } },
        success: { riskDelta: -5, rewardId: 'dataset', text: '重建脚本修复了索引，并整理出可用样本。' } },
      { key: 'quarantine-index', name: '花心力隔离损坏索引', cost: { will: 1 },
        check: { base: 55, skill: 'engineering', perLevel: 4, cap: 20, riskFactor: 0.05 },
        success: { riskDelta: -3, text: '损坏索引已隔离，避免影响其他样本。' },
        failure: { riskDelta: 8, willDelta: -1, text: '隔离未完成，额外排查增加了暴露。' } },
    ] },
  { id: 'v2-tech-access-conflict', name: '访问权限冲突', type: 'technical', tone: 'danger',
    image: '/assets/generated/poster-board.png', title: '源码访问冲突', text: '两份演示源码的访问权限冲突，错误覆盖会破坏本地缓存。', difficulty: 2,
    choices: [
      { key: 'patch-from-code', name: '用现有实现修补缓存', requires: { src_code: 1 }, cost: { will: 1 },
        check: { base: 55, skill: 'engineering', perLevel: 4, cap: 20, evidenceBonus: 10, riskFactor: 0.05 },
        success: { riskDelta: -8, support: 8, text: '缓存恢复，保住了当前资料。' },
        failure: { riskDelta: 10, willDelta: -1, text: '权限仍冲突，系统记录了异常请求。' } },
      { key: 'ask-maintainer', name: '消耗人脉请维护者解锁', cost: { network: 1 },
        success: { riskDelta: -4, rewardId: 'src_code', trustDelta: 1, text: '维护者给出一份授权源码。' },
        failure: { riskDelta: 5, trustDelta: -1, text: '维护者没有及时回复。' } },
      { key: 'retry-readonly', name: '花心力切换只读访问', cost: { will: 1 },
        check: { base: 55, skill: 'engineering', perLevel: 4, cap: 20, gear: 'explain', riskFactor: 0.04 },
        success: { riskDelta: -3, text: '只读副本打开，缓存没有被覆盖。' },
        failure: { riskDelta: 8, willDelta: -1, text: '访问冲突仍在，继续排查消耗了心力。' } },
    ] },
  { id: 'v2-route-crowd', name: '拥挤的走廊', type: 'route', tone: 'danger',
    image: '/assets/generated/taxi.png', title: '通道拥堵', text: '通往接应区的走廊临时拥堵，熟悉路线的人可以帮你避开人群。', difficulty: 1,
    choices: [
      { key: 'follow-intel', name: '按方向情报绕行', requires: { wind: 1 }, cost: { will: 1 },
        check: { base: 55, skill: 'expression', perLevel: 5, cap: 25, communication: 5, riskFactor: 0.04 },
        success: { riskDelta: -8, support: 8, text: '你避开了拥堵，接应路线保持畅通。' },
        failure: { riskDelta: 8, willDelta: -1, text: '路线信息过时，你被迫回到人群中。' } },
      { key: 'spend-network-route', name: '消耗人脉联系工作人员', cost: { network: 1 },
        success: { riskDelta: -4, support: 8, text: '工作人员为你打开了侧门。' },
        failure: { riskDelta: 5, text: '工作人员没有及时赶到。' } },
      { key: 'wait-for-gap', name: '花心力观察人流间隙', cost: { will: 1 },
        check: { base: 55, skill: 'expression', perLevel: 5, cap: 25, communication: 5, riskFactor: 0.04 },
        success: { riskDelta: -2, support: 8, text: '你等到人流变稀，接应路线重新畅通。' },
        failure: { riskDelta: 7, willDelta: -1, text: '人流没有缓和，等待也增加了心力消耗。' } },
    ] },
  { id: 'v2-route-shuttle', name: '临时接驳车', type: 'route', tone: 'opportunity',
    image: '/assets/generated/taxi.png', title: '接驳车加停一站', text: '会务接驳车愿意临时加停，但需要一位熟人确认名单。', difficulty: 0,
    choices: [
      { key: 'reserve-shuttle', name: '消耗人脉确认座位', cost: { network: 1 },
        success: { riskDelta: -3, support: 8, text: '座位确认，接应支持已安排。' },
        failure: { riskDelta: 3, text: '名单确认失败，联络没有带来额外保护。' } },
      { key: 'explain-project', name: '向工作人员说明项目', cost: { will: 1 },
        check: { base: 55, skill: 'expression', perLevel: 5, cap: 25, gear: 'explain', communication: 5, riskFactor: 0.03 },
        success: { riskDelta: -2, support: 8, text: '工作人员同意为你留出接驳位置。' },
        failure: { riskDelta: 5, willDelta: -1, text: '车辆已经满员，解释没有改变安排。' } },
    ] },
  { id: 'v2-route-badge-check', name: '出入口证件核查', type: 'route', tone: 'danger',
    image: '/assets/generated/taxi.png', title: '临时证件核查', text: '出口开始核对参会证和访客名单，手头的研究材料也可能被抽查。', difficulty: 2,
    choices: [
      { key: 'present-card', name: '提交方向情报完成登记', requires: { wind: 1 }, cost: { items: { wind: 1 } },
        success: { riskDelta: -6, support: 8, text: '你提交了方向情报，工作人员完成登记并放你通过。' } },
      { key: 'explain-visit', name: '解释访学安排', cost: { will: 1 },
        check: { base: 55, skill: 'expression', perLevel: 5, cap: 25, communication: 5, riskFactor: 0.05 },
        success: { riskDelta: -5, support: 8, text: '访学安排核验通过。' },
        failure: { riskDelta: 9, willDelta: -1, text: '核验员要求进一步登记。' } },
    ] },
];

EVENT_TEMPLATES.push(
  { id: 'v2-npc-replication-clinic', npcId: 'phd-shen', name: '沈师姐', type: 'npc', tone: 'opportunity',
    image: '/assets/generated/scholar.png', title: '复现经验交流', text: '沈师姐愿意讲一次复现踩坑经验，但想先知道你手头的材料。', difficulty: 0,
    choices: [
      { key: 'compare-source', name: '对照源码讨论差异', requiresAny: ['src_code'], cost: { will: 1 },
        check: { base: 58, skill: 'research', perLevel: 4, cap: 20, evidenceBonus: 15, gear: 'evidence', riskFactor: 0.03 },
        onSuccess: { riskDelta: -7, support: 8, rewardId: 'wind', trustDelta: 1, text: '你们找到了值得记录的复现线索。' },
        onFailure: { riskDelta: 7, willDelta: -1, trustDelta: -1, text: '差异来源仍不明确。' } },
      { key: 'share-dataset', name: '分享一份数据样本', requires: { dataset: 1 }, cost: { items: { dataset: 1 } },
        onSuccess: { riskDelta: -4, support: 8, rewardId: 'src_code', trustDelta: 1, text: '沈师姐用源码副本换取了你的数据样本。' } },
      { key: 'describe-replication', name: '花心力说明复现计划', cost: { will: 1 },
        check: { base: 55, skill: 'engineering', perLevel: 4, cap: 20, riskFactor: 0.03 },
        onSuccess: { riskDelta: -2, text: '复现步骤说明清楚，沈师姐给了你一个核对建议。' },
        onFailure: { riskDelta: 6, willDelta: -1, text: '计划细节仍不完整，补充说明消耗了心力。' } },
    ] },
  { id: 'v2-npc-collaboration-invite', npcId: 'peer-xu', name: '许同学', type: 'npc', tone: 'opportunity',
    image: '/assets/generated/scholar.png', title: '联合评测邀请', text: '许同学邀请你一起做一组小型评测，愿意先交换公开材料。', difficulty: 0,
    choices: [
      { key: 'agree-small-study', name: '从小规模评测开始', cost: { will: 1 },
        check: { base: 55, skill: 'expression', perLevel: 5, cap: 25, communication: 5, riskFactor: 0.03 },
        onSuccess: { riskDelta: -5, support: 8, rewardId: 'dataset', trustDelta: 1, text: '双方确认了一个可控的小型评测。' },
        onFailure: { riskDelta: 6, willDelta: -1, trustDelta: -1, text: '双方暂时没能确定分工。' } },
      { key: 'trade-direction-for-coop', name: '用方向情报换合作意向', requires: { wind: 1 }, cost: { items: { wind: 1 } },
        onSuccess: { riskDelta: 1, support: 8, rewardId: 'coop', trustDelta: 1, text: '许同学留下了一份合作意向。' } },
    ] },
  { id: 'v2-npc-review-challenge', npcId: 'prof-lin', name: '林教授', type: 'npc', tone: 'danger',
    image: '/assets/generated/scholar.png', title: '公开质疑', text: '林教授质疑你对照实验是否公平，周围听众都在等回应。', difficulty: 2,
    choices: [
      { key: 'show-controls', name: '说明对照与数据划分', requiresAny: ['dataset', 'src_code'], cost: { will: 1 },
        check: { base: 54, skill: 'research', perLevel: 4, cap: 20, evidenceBonus: 20, gear: 'evidence', riskFactor: 0.05 },
        onSuccess: { riskDelta: -8, support: 8, trustDelta: 1, text: '对照条件经得起核对，质疑平息了。' },
        onFailure: { riskDelta: 10, willDelta: -1, trustDelta: -1, text: '公开质疑扩大了讨论压力。' } },
      { key: 'concede-and-clarify', name: '承认缺口并限定结论', cost: { will: 1 },
        check: { base: 62, skill: 'expression', perLevel: 5, cap: 25, communication: 5, riskFactor: 0.04 },
        onSuccess: { riskDelta: -4, support: 8, text: '你明确了结论边界，讨论回到建设性方向。' },
        onFailure: { riskDelta: 7, willDelta: -1, text: '措辞没能解除现场质疑。' } },
    ] },
  { id: 'v2-resource-demo-sample', name: '多模态样例台', type: 'resource', tone: 'opportunity',
    image: '/assets/generated/locker.png', title: '公开样例领取', text: '展台提供少量公开样例，可直接领取，也可以先核验数据格式。', difficulty: 0,
    choices: [
      { key: 'take-open-sample', name: '领取公开数据样例', onSuccess: { riskDelta: 2, rewardId: 'dataset', text: '你领取了一份公开样例。' } },
      { key: 'check-schema', name: '检查字段与划分', cost: { will: 1 },
        check: { base: 55, skill: 'research', perLevel: 4, cap: 20, gear: 'evidence', riskFactor: 0.02 },
        onSuccess: { riskDelta: -2, support: 8, rewardId: 'dataset', text: '字段说明清楚，领取了适配的数据包。' },
        onFailure: { riskDelta: 5, willDelta: -1, text: '字段不匹配，这次没有领取样例。' } },
    ] },
  { id: 'v2-resource-source-code', name: '开源贡献台', type: 'resource', tone: 'opportunity',
    image: '/assets/generated/poster-board.png', title: '源码贡献奖励', text: '维护者准备为有效的复现记录发放一份源码访问副本。', difficulty: 1,
    choices: [
      { key: 'submit-reproduction-note', name: '提交复现记录', requiresAny: ['dataset'], cost: { will: 1 },
        check: { base: 55, skill: 'engineering', perLevel: 4, cap: 20, evidenceBonus: 15, riskFactor: 0.03 },
        onSuccess: { riskDelta: -4, rewardId: 'src_code', trustDelta: 1, text: '复现记录通过检查，源码访问已开放。' },
        onFailure: { riskDelta: 7, willDelta: -1, text: '记录缺少关键运行细节。' } },
      { key: 'trade-wind-for-source', name: '用方向情报兑换副本', requires: { wind: 1 }, cost: { items: { wind: 1 } },
        onSuccess: { riskDelta: 2, rewardId: 'src_code', text: '你交换到了一份源码副本。' } },
      { key: 'explain-public-method', name: '花心力解释公开复现方法', cost: { will: 1 },
        check: { base: 55, skill: 'engineering', perLevel: 4, cap: 20, riskFactor: 0.03 },
        onSuccess: { riskDelta: -2, rewardId: 'src_code', text: '维护者认可公开复现流程，开放了源码副本。' },
        onFailure: { riskDelta: 7, willDelta: -1, text: '复现记录缺少必要细节，维护者暂不开放源码。' } },
    ] },
  { id: 'v2-resource-credit-broker', name: '算力额度服务台', type: 'resource', tone: 'opportunity',
    image: '/assets/generated/research-desk.png', title: '额度补充', text: '服务台有一份闲置算力额度，需用研究计划或资料交换。', difficulty: 1,
    choices: [
      { key: 'verify-compute-plan', name: '核对设备与实验计划', cost: { will: 1 },
        check: { base: 55, skill: 'engineering', perLevel: 4, cap: 20, riskFactor: 0.03 },
        onSuccess: { riskDelta: -3, rewardId: 'compute', text: '计划核验通过，拿到一张算力卡。' },
        onFailure: { riskDelta: 6, willDelta: -1, text: '计划与设备级别不匹配。' } },
      { key: 'trade-source-for-compute', name: '交出源码换算力', requires: { src_code: 1 }, cost: { items: { src_code: 1 } },
        onSuccess: { support: 8, rewardId: 'compute', text: '服务台收下源码凭据，补给一张算力卡。' } },
    ] },
  { id: 'v2-technical-missing-driver', name: '驱动版本冲突', type: 'technical', tone: 'danger',
    image: '/assets/generated/research-desk.png', title: '设备驱动冲突', text: '试用设备的驱动版本不一致，继续读取可能污染实验记录。', difficulty: 2,
    choices: [
      { key: 'isolate-driver', name: '工程排查并隔离版本', cost: { will: 1 },
        check: { base: 55, skill: 'engineering', perLevel: 4, cap: 20, gear: 'explain', riskFactor: 0.05 },
        onSuccess: { riskDelta: -8, support: 8, text: '冲突设备已隔离，记录保持完整。' },
        onFailure: { riskDelta: 12, willDelta: -1, text: '驱动冲突造成返工和额外暴露。' } },
      { key: 'spend-compute-isolate', name: '消耗算力卡转入备用机', requires: { compute: 1 }, cost: { items: { compute: 1 } },
        onSuccess: { riskDelta: -5, text: '备用机接管了这次任务。' } },
    ] },
  { id: 'v2-technical-data-leak', name: '样本划分泄漏', type: 'technical', tone: 'danger',
    image: '/assets/generated/locker.png', title: '评测集疑似泄漏', text: '你发现样本划分可能重复，继续使用会让结果失去可信度。', difficulty: 2,
    choices: [
      { key: 'audit-split', name: '抽样检查重复记录', requires: { dataset: 1 }, cost: { will: 1 },
        check: { base: 55, skill: 'research', perLevel: 4, cap: 20, evidenceBonus: 15, gear: 'evidence', riskFactor: 0.05 },
        onSuccess: { riskDelta: -8, support: 8, rewardId: 'wind', text: '划分问题已定位，保留了一条修正线索。' },
        onFailure: { riskDelta: 10, willDelta: -1, text: '泄漏点未能定位，继续搜索变得更显眼。' } },
      { key: 'discard-suspect-batch', name: '丢弃可疑数据批次', requires: { dataset: 1 }, cost: { items: { dataset: 1 } },
        onSuccess: { riskDelta: -4, text: '你丢弃了可疑批次，避免把错误带回去。' } },
      { key: 'isolate-split', name: '花心力隔离可疑划分', cost: { will: 1 },
        check: { base: 55, skill: 'research', perLevel: 4, cap: 20, gear: 'evidence', riskFactor: 0.04 },
        onSuccess: { riskDelta: -3, text: '可疑划分被隔离，避免了错误结果扩大。' },
        onFailure: { riskDelta: 8, willDelta: -1, text: '隔离范围没能确认，排查又消耗了心力。' } },
    ] },
  { id: 'v2-technical-cache-error', name: '缓存校验失败', type: 'technical', tone: 'danger',
    image: '/assets/generated/research-desk.png', title: '缓存校验失败', text: '本地缓存的校验码不一致，可能影响源码复现。', difficulty: 1,
    choices: [
      { key: 'rebuild-cache', name: '用工程流程重建缓存', requires: { src_code: 1 }, cost: { will: 1 },
        check: { base: 55, skill: 'engineering', perLevel: 4, cap: 20, evidenceBonus: 10, riskFactor: 0.04 },
        onSuccess: { riskDelta: -7, support: 8, text: '缓存校验恢复，源码保持可用。' },
        onFailure: { riskDelta: 9, willDelta: -1, text: '缓存仍不稳定，额外操作引起注意。' } },
      { key: 'trade-wind-for-recovery', name: '用线索请维护者协助', requires: { wind: 1 }, cost: { items: { wind: 1 } },
        onSuccess: { riskDelta: -4, text: '维护者协助恢复了缓存。' } },
      { key: 'run-integrity-check', name: '花心力执行完整性检查', cost: { will: 1 },
        check: { base: 55, skill: 'engineering', perLevel: 4, cap: 20, gear: 'explain', riskFactor: 0.04 },
        onSuccess: { riskDelta: -3, text: '只读完整性检查完成，缓存问题被隔离。' },
        onFailure: { riskDelta: 8, willDelta: -1, text: '校验仍未通过，重复检查增加了心力消耗。' } },
    ] },
  { id: 'v2-route-crowd-pressure', name: '海报区人流拥堵', type: 'route', tone: 'danger',
    image: '/assets/generated/taxi.png', title: '撤离通道拥堵', text: '出口方向突然排起长队，接应人员只能等你确认一条替代路线。', difficulty: 1,
    choices: [
      { key: 'use-wind-detour', name: '按路线情报绕行', requires: { wind: 1 }, cost: { will: 1 },
        check: { base: 55, skill: 'expression', perLevel: 5, cap: 25, communication: 5, riskFactor: 0.04 },
        onSuccess: { riskDelta: -8, support: 8, text: '你找到了替代通道，接应路线畅通。' },
        onFailure: { riskDelta: 8, willDelta: -1, text: '替代路线失效，人流压力增加。' } },
      { key: 'ask-staff-detour', name: '消耗人脉请求工作人员引路', cost: { network: 1 },
        onSuccess: { riskDelta: -4, support: 8, text: '工作人员带你绕开了人群。' },
        onFailure: { riskDelta: 5, text: '工作人员未能赶到，联系成本已消耗。' } },
      { key: 'wait-for-gap-route', name: '花心力等候人流间隙', cost: { will: 1 },
        check: { base: 55, skill: 'expression', perLevel: 5, cap: 25, communication: 5, riskFactor: 0.04 },
        onSuccess: { riskDelta: -2, support: 8, text: '你等到人流变稀，接应路线恢复畅通。' },
        onFailure: { riskDelta: 7, willDelta: -1, text: '拥堵没有缓解，等待额外消耗了心力。' } },
    ] },
  { id: 'v2-route-shuttle-delay', name: '接驳车延迟', type: 'route', tone: 'opportunity',
    image: '/assets/generated/taxi.png', title: '额外接驳车', text: '会务临时增加一趟接驳车，但座位需要提前确认。', difficulty: 0,
    choices: [
      { key: 'reserve-extra-seat', name: '消耗人脉预留座位', cost: { network: 1 },
        onSuccess: { riskDelta: -2, support: 8, text: '接驳座位已预留，接应支持提高。' } },
      { key: 'explain-project-to-staff', name: '说明研究安排争取优先位', cost: { will: 1 },
        check: { base: 55, skill: 'expression', perLevel: 5, cap: 25, communication: 5, riskFactor: 0.02 },
        onSuccess: { riskDelta: -3, support: 8, text: '工作人员为你留出一个座位。' },
        onFailure: { riskDelta: 5, willDelta: -1, text: '车辆已经满员，接驳安排未能改变。' } },
    ] },
  { id: 'v2-route-badge-inspection', name: '访客证抽查', type: 'route', tone: 'danger',
    image: '/assets/generated/taxi.png', title: '出口证件核查', text: '工作人员临时核验访客名单，并抽查手里的研究材料。', difficulty: 2,
    choices: [
      { key: 'present-card-for-registration', name: '提交方向情报完成登记', requires: { wind: 1 }, cost: { items: { wind: 1 } },
        onSuccess: { riskDelta: -6, support: 8, text: '你提交了方向情报，工作人员完成登记并放你通过。' } },
      { key: 'explain-visit-purpose', name: '解释访学安排', cost: { will: 1 },
        check: { base: 55, skill: 'expression', perLevel: 5, cap: 25, communication: 5, riskFactor: 0.05 },
        onSuccess: { riskDelta: -5, support: 8, text: '访学安排核验通过。' },
        onFailure: { riskDelta: 9, willDelta: -1, text: '核验员要求补充登记。' } },
    ] },
);

const CONNECTOR_CHOICE = {
  key: 'talent-negotiate', name: '联络派：约定合作边界', requiresTalent: 'connector', talentUse: true,
  cost: { network: 1 }, onSuccess: { riskDelta: -4, support: 8,
    text: '你用一笔人情把本次要求谈到了能兑现的范围。双方同意结束追问，返程接应也有了安排。' },
};

function normalizeRaidTalent(value) {
  const id = typeof value === 'string' ? value : value?.id;
  if (typeof id !== 'string' || !Object.hasOwn(CAREER_TALENTS, id)) return null;
  return { id, rank: Math.floor(clamp(value?.rank || 1, 1, 3)) };
}

function talentProtectedIndex(run) {
  const index = run.talentState?.protectedIndex;
  return normalizeRaidTalent(run.talent)?.id === 'archivist' && run.talentState?.used === true
    && Number.isInteger(index) && index >= 0 && RESEARCH_MATERIALS.has(run.bag?.[index]) ? index : null;
}

function talentActions(run) {
  const talent = normalizeRaidTalent(run.talent);
  if (!talent || talent.id === 'connector' || run.status !== 'playing') return [];
  const blocked = run.talentState?.used ? '本次远征已经使用过专长。'
    : run.pendingAutoExtract ? '心力已耗尽，正在自动撤离。'
      : run.event ? '先处理眼前事件。' : run.pendingLoot?.length ? '先整理刚发现的物品。' : '';
  return (run.bag || []).flatMap((id, index) => {
    const archive = talent.id === 'archivist';
    if (!(archive ? RESEARCH_MATERIALS.has(id) : ['dataset', 'src_code', 'wind'].includes(id))) return [];
    const reason = blocked || (archive && hasGear(run, 'backup_device') && run.protectedIndex === index
      ? '这件材料已有备份保护，可以封存另一件。' : '');
    return [{ id: `talent:${archive ? 'archive' : 'convert'}:${index}`, kind: 'talent',
      name: `${archive ? '封存' : '改装成算力卡'}：${itemName(id)}`, disabled: !!reason, reason,
      cost: archive ? '使用本次远征的一次封存机会' : `消耗${itemName(id)} ×1；使用本次远征的一次改装机会`,
      success: archive ? '即使行动失败，这件材料也能保留；丢弃或消耗它会失去保护。'
        : '原材料被消耗，获得一张算力卡；放不下时可以整理背包。' }];
  });
}

function talentView(run) {
  const talent = normalizeRaidTalent(run.talent);
  if (!talent) return null;
  const definition = CAREER_TALENTS[talent.id];
  const actions = talent.id === 'connector' && run.event
    ? eventActionSpecs(run).filter(row => row.id === 'event:talent-negotiate').map(row => ({ ...row, kind: 'talent' }))
    : talentActions(run);
  return { ...talent, name: definition.name, activeName: definition.activeName,
    description: definition.activeDescription, used: run.talentState?.used === true,
    protectedIndex: talentProtectedIndex(run), actions,
    hint: run.talentState?.used ? '本次专长已使用，下次远征恢复。'
      : talent.id === 'connector' ? '遇到人物交涉或可以协商的奇遇时，可用人脉稳妥收口。'
        : actions.length ? '选择一件材料，立即使用本次专长。' : '先找到一件可用的研究材料，再使用专长。' };
}

function performTalentAction(run, id, before) {
  const action = talentActions(run).find(row => row.id === id);
  if (!action) return responseFailure('没有这个专长行动或可用材料。');
  if (action.disabled) return responseFailure(action.reason);
  const [, verb, position] = id.split(':');
  const index = Number(position);
  const material = run.bag[index];
  run.talentState = { ...(run.talentState || {}), used: true };
  if (verb === 'archive') {
    run.talentState.protectedIndex = index;
    return commitAction(run, `封存了${itemName(material)}，任何撤离结果都能保留。`, 'talent', before,
      { title: '封存关键材料', text: `已封存${itemName(material)}；这次机会已用完，丢弃或消耗材料会失去保护。` });
  }
  removeBagItem(run, index);
  const itemsAdded = placeLoot(run, ['compute']);
  return commitAction(run, `消耗${itemName(material)}，改装出一张算力卡。`, 'talent', before,
    { title: '临时算力改装', text: `用${itemName(material)}改装出一张算力卡。本次改装机会已用完。`, itemsAdded });
}

function skill(run, id) {
  return Math.max(1, Math.min(10, Math.floor(Number(run.skills?.[id]) || 1)));
}

function skillBonus(level, perLevel, maximum) {
  return Math.min(maximum, perLevel * Math.max(0, level - 1));
}

function loadoutSet(run) {
  return new Set(Array.isArray(run.loadout) ? run.loadout : []);
}

function hasGear(run, id) {
  return loadoutSet(run).has(id);
}

function loadoutCapacityBonus(loadout) {
  const sum = (Array.isArray(loadout) ? loadout : []).reduce((value, id) => value + (Number(ITEMS[id]?.bonus?.bagCap) || 0), 0);
  return Math.max(0, Math.round(sum));
}

function loadoutWillBonus(loadout) {
  return (Array.isArray(loadout) ? loadout : []).reduce((value, id) => value + (Number(ITEMS[id]?.bonus?.willMax) || 0), 0);
}

function normalizeLoadout(value) {
  const ids = [];
  const usedSlots = new Set();
  for (const id of Array.isArray(value) ? value : []) {
    const gear = GEAR[id];
    const slot = gear?.slot;
    if (!gear || !gear.gear || !EQUIPMENT_SLOTS.includes(slot) || usedSlots.has(slot)) continue;
    usedSlots.add(slot);
    ids.push(id);
  }
  return ids;
}

function normalizeSupplies(value) {
  const out = [];
  for (const id of Array.isArray(value) ? value : []) {
    const item = ITEMS[id];
    if (out.length >= PROBABILITY_MAX_SUPPLIES) break;
    if (item?.use && !item.gear) out.push(id);
  }
  return out;
}

function venueFor(run) {
  return VENUES[run.venueId] || VENUES.conference;
}

function difficultyFor(run) {
  return DIFFICULTIES[run?.difficultyId] || DIFFICULTIES.normal;
}

function capacityFor(run) {
  return PROBABILITY_BASE_BAG_CAP + loadoutCapacityBonus(run.loadout);
}

function bagWeight(run) {
  return (run.bag || []).reduce((sum, id) => sum + itemWeight(id), 0);
}

function placeLoot(run, ids) {
  const placed = [];
  for (const id of ids || []) {
    if (bagWeight(run) + itemWeight(id) <= run.bagCap + 0.001) {
      run.bag.push(id);
      placed.push({ id, pending: false });
    } else {
      run.pendingLoot.push(id);
      placed.push({ id, pending: true });
    }
  }
  return placed;
}

function loadBonuses(run) {
  const set = loadoutSet(run);
  const collection = {};
  const event = {};
  for (const id of set) {
    const mapped = {
      citation_scanner: { collection: { wind: 10 } },
      lightweight_laptop: { collection: { compute: 4 } },
      gpu_workstation: { collection: { compute: 8 } },
      remote_terminal: { collection: { compute: 12 } },
      literature_assistant: { collection: { dataset: 8 }, event: { evidence: 5 } },
      experiment_tracker: { collection: { src_code: 8 }, event: { evidence: 5 } },
      data_cleaner: { collection: { dataset: 8 } },
      field_recorder: { event: { explain: 5 } },
      digital_notebook: { event: { evidence: 5 } },
    }[id];
    for (const [target, value] of Object.entries(mapped?.collection || {})) collection[target] = (collection[target] || 0) + value;
    for (const [action, value] of Object.entries(mapped?.event || {})) event[action] = (event[action] || 0) + value;
  }
  return {
    collection,
    event,
    communication: set.has('foam_earplugs') || set.has('noise_headphones') ? 5 : 0,
    storage: set.has('encrypted_ssd') ? 4 : 0,
    backup: set.has('backup_device'),
  };
}

function materialWeights(run) {
  const base = venueFor(run).weights;
  const bonuses = loadBonuses(run).collection;
  return Object.fromEntries(MATERIAL_IDS.map(id => {
    const bonus = clamp(bonuses[id] || 0, 0, MAX_MATERIAL_WEIGHT_BONUS);
    return [id, Math.max(0, Number(base[id]) || 0) * (1 + bonus / 100) * (contextModifiers(run).condition.materials?.[id] || 1)];
  }));
}

function materialWeightBonus(run, id) {
  return round1(clamp(loadBonuses(run).collection[id] || 0, 0, MAX_MATERIAL_WEIGHT_BONUS));
}

function extraDropChance(run, approachId = 'steady') {
  const base = Math.max(0, Number(venueFor(run).extraDrop) || 0) * 100;
  return round1(clamp(base + difficultyFor(run).extraDropModifier + contextModifiers(run, approachId).extra, 0, 100));
}

function evidenceSet(run) {
  return new Set((run.bag || []).filter(id => RESEARCH_MATERIALS.has(id)));
}

function hasMatchingEvidence(run, event) {
  const held = evidenceSet(run);
  return !!event?.requires?.some(id => held.has(id));
}

function eventTrust(run, event) {
  const trust = (Number(run.contacts?.[event?.npcId]?.trust) || 0)
    + (Number(run.contactUpdates?.[event?.npcId]?.trustDelta) || 0);
  return Math.max(-3, Math.min(3, trust));
}

function eventPool(run) {
  const used = new Set(run.usedEventIds || []);
  return EVENT_TEMPLATES.filter(event => !used.has(event.id));
}

function encounterStatus(run, riskAfter, approachId = 'steady') {
  if (run.event) return { chance: 0, reason: '先处理当前人物事件。' };
  if (Number(run.stats?.will) <= 1) return { chance: 0, reason: '这次搜索会用尽心力，之后自动撤离。' };
  const eventsLimit = 4;
  if ((run.eventCount || 0) >= eventsLimit) return { chance: 0, reason: `本局事件已达 ${eventsLimit} 次上限。` };
  if (run.encounterCooldown) return { chance: 0, reason: '上次交涉后的下一次搜索免交涉。' };
  if (!eventPool(run).length) return { chance: 0, reason: '本局可触发的人物事件已用完。' };
  if (academicStoryCallbackReady(run)) {
    return { chance: 100, reason: '先前的选择有了回音。再探索一次，就会遇到这桩奇遇的后续。', guaranteed: true };
  }
  const base = 10 + venueFor(run).baseRisk + 0.5 * riskAfter + contextModifiers(run, approachId).encounter;
  const pacing = run.encounterPacing || { dryStreak: 0, firstEventSeen: false };
  const dryStreak = Math.max(0, Number(pacing.dryStreak) || 0);
  const firstEventSeen = pacing.firstEventSeen === true;
  if (!firstEventSeen && dryStreak >= 1) {
    return { chance: 100, reason: '附近传来动静，继续搜索就会遇到一个新情况。', guaranteed: true };
  }
  if (firstEventSeen && dryStreak >= 3) {
    return { chance: 100, reason: '已连续 3 次搜索没有事件，前方的新情况已无法避开。', guaranteed: true };
  }
  const pacingBonus = firstEventSeen ? dryStreak * 15 : 0;
  const upper = 80;
  return { chance: round1(clamp(base + pacingBonus, 5, upper)),
    reason: firstEventSeen ? (dryStreak ? '平静了一阵，周围的动静正在增多。' : '留意周围的交流与现场变化。') : '刚进入现场，接下来的探索会遇到新的情况。',
    pacingBonus, guaranteed: false };
}

function acquisitionChance(run, approachId = 'steady') {
  const difficulty = difficultyFor(run);
  const researchBonus = 4 * (skill(run, 'research') - 1);
  const context = contextModifiers(run, approachId).acquisition;
  const base = 65 + researchBonus + difficulty.acquisitionModifier - venueFor(run).difficulty + context;
  return {
    chance: round1(clamp(base, 30, 95)),
    gear: 0,
    context,
    researchBonus,
    acquisitionModifier: difficulty.acquisitionModifier,
    difficulty: venueFor(run).difficulty,
  };
}

function searchRiskAfter(run, approachId = 'steady') {
  const growth = Math.max(1, venueFor(run).growth + difficultyFor(run).riskModifier + contextModifiers(run, approachId).risk);
  const result = Number(run.stats?.risk) + growth;
  return round1(clamp(result, 0, 100));
}

function exitProbabilities(run) {
  const v = venueFor(run);
  const risk = clamp(run.stats?.risk, 0, 100);
  const skillEngineering = skillBonus(skill(run, 'engineering'), 2, 8);
  const skillExpression = skillBonus(skill(run, 'expression'), 2, 8);
  const loadPenalty = bagWeight(run) >= capacityFor(run) * 0.8 ? 4 : 0;
  const gear = loadBonuses(run);
  const context = contextModifiers(run);
  const fail = round1(clamp(0.4 * v.baseRisk + 0.15 * risk + loadPenalty - skillEngineering - gear.storage + context.fail, 1, 25));
  const partial = round1(clamp(8 + 0.2 * risk - skillExpression - (run.support || 0) + context.partial, 5, 35));
  const full = round1(100 - fail - partial);
  return {
    full, partial, fail,
    parts: {
      baseRisk: v.baseRisk,
      risk,
      loadPenalty,
      engineeringBonus: skillEngineering,
      storageBonus: gear.storage,
      expressionBonus: skillExpression,
      support: run.support || 0,
      contextFail: context.fail,
      contextPartial: context.partial,
      depth: context.state.depth,
      sum: round1(full + partial + fail),
    },
  };
}

function materialProbabilities(run, acquisition, approachId = 'steady') {
  const weights = materialWeights(run);
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const extra = extraDropChance(run, approachId) / 100;
  return MATERIAL_IDS.map(id => {
    const weight = Math.max(0, Number(weights[id]) || 0);
    const conditional = total > 0 ? weight / total : 0;
    const atLeastOne = conditional + extra * conditional * (1 - conditional);
    return {
      id,
      name: itemName(id),
      weight: round1(weight),
      weightBonus: materialWeightBonus(run, id),
      conditionalProbability: round1(conditional * 100),
      hitProbability: round1(acquisition * atLeastOne * 100),
    };
  });
}

function computeProbabilities(run, approachId = 'steady') {
  const acquisition = acquisitionChance(run, approachId);
  const riskAfterSearch = searchRiskAfter(run, approachId);
  const encounter = encounterStatus(run, riskAfterSearch, approachId);
  const materials = materialProbabilities(run, acquisition.chance / 100, approachId);
  const extraction = exitProbabilities(run);
  const extraDrop = extraDropChance(run, approachId);
  const v = venueFor(run);
  const d = difficultyFor(run);
  return {
    acquisition: acquisition.chance,
    materials,
    encounter: encounter.chance,
    extraDrop,
    full: extraction.full,
    partial: extraction.partial,
    fail: extraction.fail,
    encounterReason: encounter.reason,
    parts: {
      acquisition: {
        base: 65,
        researchBonus: acquisition.researchBonus,
        contextModifier: acquisition.context,
        difficultyModifier: d.acquisitionModifier,
        venueDifficulty: v.difficulty,
        riskAfterSearch,
      },
      materials: { baseWeights: v.weights, weights: materialWeights(run), extraDrop },
      encounter: {
        base: 10 + venueFor(run).baseRisk,
        riskAfterSearch,
        riskContribution: round1(riskAfterSearch * 0.5),
        difficultyModifier: difficultyFor(run).eventModifier,
        pacingBonus: encounter.pacingBonus || 0,
        contextModifier: contextModifiers(run, approachId).encounter,
        guaranteed: encounter.guaranteed === true,
        reason: encounter.reason,
      },
      extraction: extraction.parts,
    },
  };
}

function nextRandom(run) {
  let value = run.rngState >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  run.rngState = (value >>> 0) || 1;
  return run.rngState / 4294967296;
}

function weightedItem(run) {
  const weights = materialWeights(run);
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (!total) return null;
  let roll = nextRandom(run) * total;
  for (const id of MATERIAL_IDS) {
    roll -= weights[id] || 0;
    if (roll < 0) return id;
  }
  return MATERIAL_IDS.find(id => weights[id] > 0) || null;
}

function log(run, type, text) {
  run.log.push({ type, text: String(text || '').slice(0, 500) });
  if (run.log.length > 80) run.log.splice(0, run.log.length - 80);
}

function safeId(value, allowed, fallback) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

function expeditionState(run) {
  const state = run.expedition || {};
  const effectId = safeId(state.effect?.id, Object.keys(MOMENTUM), null);
  const remainingSearches = Math.floor(clamp(state.effect?.remainingSearches, 0, 2));
  return {
    conditionId: safeId(state.conditionId, Object.keys(FIELD_CONDITIONS), 'arrival'),
    searchesInCondition: Math.floor(clamp(state.searchesInCondition, 0, 1)),
    depth: Math.floor(clamp(state.depth, 0, 4)),
    lastApproach: safeId(state.lastApproach, Object.keys(APPROACHES), 'steady'),
    effect: effectId && remainingSearches > 0 ? { id: effectId, remainingSearches } : null,
  };
}

function contextModifiers(run, approachId = 'steady') {
  const state = expeditionState(run);
  const condition = FIELD_CONDITIONS[state.conditionId];
  const effect = state.effect ? MOMENTUM[state.effect.id] : {};
  const approach = APPROACHES[safeId(approachId, Object.keys(APPROACHES), 'steady')];
  const total = key => (condition[key] || 0) + (effect[key] || 0) + (approach[key] || 0);
  return { state, condition, effect, approach, acquisition: total('acquisition'), encounter: total('encounter'),
    risk: total('risk'), extra: total('extra'), check: total('check'),
    partial: (condition.partial || 0) + (effect.partial || 0) + state.depth * 2,
    fail: (condition.fail || 0) + (effect.fail || 0) + state.depth * 1.25 };
}

function outlookFor(probabilities, risk = probabilities.parts?.acquisition?.riskAfterSearch) {
  return { acquisition: likelihoodLabel(probabilities.acquisition), encounter: encounterLabel(probabilities.encounter),
    extraction: likelihoodLabel(probabilities.full), risk: riskLabel(risk) };
}

function eventMomentum(event, success, choice = null) {
  if (choice?.skipMomentum) return null;
  return ({ npc: ['scrutiny', 'contact'], resource: ['interference', 'lead'],
    technical: ['interference', 'repaired'], route: ['detour', 'clear'] })[event.type]?.[Number(success)] || null;
}

function advanceExpedition(run, approachId) {
  const state = expeditionState(run);
  state.lastApproach = approachId;
  state.depth = clamp(state.depth + APPROACHES[approachId].depth, 0, 4);
  if (state.effect && --state.effect.remainingSearches <= 0) state.effect = null;
  state.searchesInCondition += 1;
  if (state.searchesInCondition >= 2) {
    const candidates = Object.keys(FIELD_CONDITIONS).filter(id => id !== 'arrival' && id !== state.conditionId);
    // A single seeded transition per completed stretch. Read-only previews never
    // advance it, and the next stretch cannot silently repeat the previous one.
    state.conditionId = candidates[Math.floor(nextRandom(run) * candidates.length)];
    state.searchesInCondition = 0;
    log(run, 'route', `来到${FIELD_CONDITIONS[state.conditionId].name}。${FIELD_CONDITIONS[state.conditionId].description}`);
  }
  run.expedition = state;
}

function expeditionView(run) {
  const state = expeditionState(run);
  const condition = FIELD_CONDITIONS[state.conditionId];
  const blocked = run.status !== 'playing' || !!run.event || !!run.pendingLoot?.length || !!run.pendingAutoExtract || Number(run.stats?.will) < 1;
  const reason = run.status !== 'playing' ? '本次远征已经结束。' : run.event ? '先处理当前事件。'
    : run.pendingLoot?.length ? '先整理刚发现的物品。' : blocked ? '心力不足，不能继续搜索。' : '';
  return {
    condition: { id: state.conditionId, name: condition.name, description: condition.description },
    depthLabel: state.depth === 0 ? '靠近出口' : state.depth <= 2 ? '已入内场' : '深入腹地',
    recentEffect: state.effect ? { name: MOMENTUM[state.effect.id].name, description: MOMENTUM[state.effect.id].description,
      remainingSearches: state.effect.remainingSearches } : null,
    approaches: Object.entries(APPROACHES).map(([id, approach]) => {
      const probabilities = computeProbabilities(run, id);
      const riskAfter = probabilities.parts.acquisition.riskAfterSearch;
      return { id, actionId: id === 'steady' ? 'search' : `search:${id}`, name: approach.name, hint: approach.hint,
        disabled: blocked, reason, outlook: outlookFor(probabilities),
        searchPreview: { willCost: 1, riskBefore: round1(run.stats?.risk), riskAfter,
          riskDelta: round1(riskAfter - (Number(run.stats?.risk) || 0)), acquisition: probabilities.acquisition,
          encounter: probabilities.encounter, extraDrop: probabilities.extraDrop } };
    }),
  };
}

export function createProbabilityRaid(options = {}) {
  const seed = (Number(options.seed) >>> 0) || 1;
  const venueId = safeId(options.venue, Object.keys(VENUES), 'conference');
  const difficultyId = safeId(options.difficulty, Object.keys(DIFFICULTIES), 'normal');
  const loadout = normalizeLoadout(options.loadout);
  const bagCap = PROBABILITY_BASE_BAG_CAP + loadoutCapacityBonus(loadout);
  const supplies = normalizeSupplies(options.supplies);
  const bag = [];
  for (const id of supplies) {
    if (bagWeight({ bag: [...bag, id] }) <= bagCap + 0.001) bag.push(id);
  }
  const willMax = PROBABILITY_BASE_WILL + loadoutWillBonus(loadout);
  const run = {
    mode: PROBABILITY_MODE,
    raidId: typeof options.raidId === 'string' ? options.raidId : `prob-${seed.toString(36)}`,
    seed,
    rngState: seed,
    actionIndex: 0,
    revision: 0,
    status: 'playing',
    settled: false,
    campaign: true,
    player: options.player && typeof options.player === 'object' ? clone(options.player) : { name: '研究者' },
    skills: Object.fromEntries(['engineering', 'research', 'expression'].map(id => [id, Math.max(1, Math.min(10, Math.floor(Number(options.skills?.[id]) || 1)))])),
    direction: Object.hasOwn(DIRECTIONS, options.direction) ? options.direction : 'llm',
    venueId,
    difficultyId,
    loadout,
    bagCap,
    bag,
    pendingLoot: [],
    pendingAutoExtract: false,
    protectedIndex: null,
    stories: normalizeStories(options.stories),
    storyEnabled: Object.hasOwn(options, 'stories'),
    storyRun: null,
    talent: normalizeRaidTalent(options.talent),
    talentState: { used: false, protectedIndex: null },
    contacts: options.contacts && typeof options.contacts === 'object' ? clone(options.contacts) : {},
    contactUpdates: {},
    stats: { will: willMax, willMax, network: Math.max(0, Math.floor(Number(options.network) || 0)), risk: 0 },
    initialNetwork: Math.max(0, Math.floor(Number(options.network) || 0)),
    support: 0,
    event: null,
    eventCount: 0,
    usedEventIds: [],
    rewardedEventIds: [],
    encounterCooldown: false,
    history: [],
    log: [],
    result: null,
    probabilityVersion: 3,
    ...(options.surprise === true ? { encounterVersion: 2, resolvedEventIds: [] } : {}),
    encounterPacing: { eligibleSearches: 0, dryStreak: 0, firstEventSeen: false },
    lastAction: null,
    expedition: { conditionId: 'arrival', searchesInCondition: 0, depth: 0, lastApproach: 'steady', effect: null },
  };
  const startText = `开始${VENUES[venueId].name}远征，${DIFFICULTIES[difficultyId].name}难度；材料按地点自然分布。`;
  log(run, 'system', `${startText}出行费已在出发时扣除。`);
  return run;
}

export function probabilitySetup(profile = null) {
  const stage = Math.max(0, Math.floor(Number(profile?.research?.stage) || 0));
  const loadout = normalizeLoadout(Object.values(profile?.loadout || {}));
  const research = profile?.research || {};
  const skills = skillLevels({ ...research, skills: research.skills || {} });
  const difficultyRows = Object.entries(DIFFICULTIES).map(([id, difficulty]) => ({
    id,
    name: difficulty.name,
    description: difficulty.description,
    acquisitionModifier: difficulty.acquisitionModifier,
    riskModifier: difficulty.riskModifier,
    eventModifier: difficulty.eventModifier,
    extraDropModifier: difficulty.extraDropModifier,
  }));
  const venues = Object.entries(VENUES).map(([id, venue]) => {
    const difficultyPreviews = difficultyRows.map(difficulty => {
      const previewRun = createProbabilityRaid({ seed: 1, venue: id,
        difficulty: difficulty.id, skills, loadout });
      const probabilities = computeProbabilities(previewRun);
      return {
        difficultyId: difficulty.id,
        acquisition: probabilities.acquisition,
        searchGrowth: round1(searchRiskAfter(previewRun) - previewRun.stats.risk),
        encounter: probabilities.encounter,
        extraDrop: probabilities.extraDrop,
        full: probabilities.full,
        partial: probabilities.partial,
        fail: probabilities.fail,
        materials: clone(probabilities.materials),
      };
    });
    const normalPreview = difficultyPreviews.find(row => row.difficultyId === 'normal');
    const poolMaterials = normalPreview.materials.map(({ id: itemId, name, weight, weightBonus, conditionalProbability, hitProbability }) => ({
      id: itemId, name, weight, weightBonus, conditionalProbability, hitProbability,
    }));
    return {
      id,
      name: venue.name,
      minStage: venue.minStage,
      cost: venue.cost,
      disabled: stage < venue.minStage,
      ...(stage < venue.minStage ? { reason: `需要${venue.minStage === 2 ? '博士生' : '讲师'}身份。` } : {}),
      desc: venue.desc,
      pool: { totalWeight: round1(poolMaterials.reduce((sum, row) => sum + row.weight, 0)), materials: poolMaterials },
      difficultyPreviews,
    };
  });
  return {
    venues,
    difficulties: difficultyRows,
    gearHints: clone(GEAR_HINTS),
    baseWill: PROBABILITY_BASE_WILL,
    baseBagCap: PROBABILITY_BASE_BAG_CAP,
    maxSupplies: PROBABILITY_MAX_SUPPLIES,
  };
}

function eventDifficulty(run) {
  return ({ conference: 0, visit: 5, industry: 10 })[run.venueId] ?? 0;
}

const EVENT_LEAVE_CHOICE = {
  key: 'leave', name: '结束机会并撤离', exit: true,
  cost: {}, check: null,
  onSuccess: { riskDelta: 4, text: '你放弃当前机会，带着现有收获撤离。' },
};
const SURPRISE_LEAVE_CHOICE = { key: 'leave', name: '撤离', label: '撤离', exit: true,
  cost: {}, onSuccess: { text: '你结束交谈，转身撤离。' } };
const eventLeaveChoice = run => run.event?.encounterVersion === 2 ? SURPRISE_LEAVE_CHOICE : EVENT_LEAVE_CHOICE;

function countBagItem(run, id) {
  return (run.bag || []).reduce((count, itemId) => count + Number(itemId === id), 0);
}

function requirementsReason(run, choice) {
  if (choice.requiresTalent && normalizeRaidTalent(run.talent)?.id !== choice.requiresTalent) return '需要对应的生涯专长。';
  if (choice.talentUse && run.talentState?.used) return '本次远征已经使用过专长。';
  if (choice.requiresAny?.length && !choice.requiresAny.some(id => countBagItem(run, id) > 0)) {
    return `需要背包里有${choice.requiresAny.map(itemName).join('或')}。`;
  }
  const requirements = choice.requires || {};
  for (const [id, amount] of Object.entries(requirements)) {
    if (countBagItem(run, id) < amount) return `需要背包里有${itemName(id)} ×${amount}。`;
  }
  for (const [id, amount] of Object.entries(choice.cost?.items || {})) {
    if (countBagItem(run, id) < amount) return `需要消耗${itemName(id)} ×${amount}。`;
  }
  if (Number(run.stats?.will) < (Number(choice.cost?.will) || 0)) return `需要 ${choice.cost.will} 点心力。`;
  if (Number(run.stats?.network) < (Number(choice.cost?.network) || 0)) return `需要 ${choice.cost.network} 点人脉。`;
  return '';
}

function choiceEvidenceAvailable(run, choice) {
  const held = new Set(run.bag || []);
  if (choice.requiresAny?.some(id => held.has(id))) return true;
  return hasMatchingEvidence(run, run.event);
}

function eventChoiceProbability(run, choice) {
  if (!choice.check) return 100;
  const check = choice.check;
  const skillLevel = check.skill ? skill(run, check.skill) : 1;
  const ability = check.skill ? skillBonus(skillLevel, check.perLevel || 0, check.cap || 0) : 0;
  const evidenceBonus = check.evidenceBonus && choiceEvidenceAvailable(run, choice) ? check.evidenceBonus : 0;
  const gear = check.gear ? (loadBonuses(run).event[check.gear] || 0) : 0;
  const communication = check.communication ? Math.min(check.communication, loadBonuses(run).communication) : 0;
  const trust = check.trustPerPoint ? eventTrust(run, run.event) * check.trustPerPoint : 0;
  const riskPenalty = (Number(run.stats?.risk) || 0) * (Number(check.riskFactor) || 0);
  const difficulty = eventDifficulty(run) + (Number(run.event?.difficulty) || 0) + (Number(check.difficulty) || 0);
  const difficultyModifier = difficultyFor(run).eventModifier;
  return round1(clamp((Number(check.base) || 0) + ability + evidenceBonus + gear + communication + trust
    + difficultyModifier + contextModifiers(run, expeditionState(run).lastApproach).check - riskPenalty - difficulty, 20, 95));
}

function choiceEffect(choice, outcome) {
  if (outcome === "success") return choice.onSuccess || choice.success || {};
  return choice.onFailure || choice.failure || {};
}

function stateAfterChoiceCost(run, choice) {
  const projected = {
    ...run,
    stats: { ...(run.stats || {}) },
    bag: [...(run.bag || [])],
    pendingLoot: [...(run.pendingLoot || [])],
    support: Number(run.support) || 0,
  };
  const cost = choice.cost || {};
  projected.stats.will = round1(Math.max(0, (Number(projected.stats.will) || 0) - (Number(cost.will) || 0)));
  projected.stats.network = Math.max(0, (Number(projected.stats.network) || 0) - (Number(cost.network) || 0));
  for (const [id, amount] of Object.entries(cost.items || {})) {
    for (let count = 0; count < Math.max(0, Math.floor(Number(amount) || 0)); count += 1) {
      const index = projected.bag.indexOf(id);
      if (index < 0) break;
      projected.bag.splice(index, 1);
    }
  }
  return projected;
}

function effectSummary(run, event, choice, effect = {}, fallback = "") {
  const projected = stateAfterChoiceCost(run, choice);
  const beforeEffect = {
    risk: clamp(projected.stats.risk, 0, 100),
    will: clamp(projected.stats.will, 0, projected.stats.willMax),
    network: Math.max(0, Number(projected.stats.network) || 0),
  };
  projected.stats.risk = round1(clamp(beforeEffect.risk + (Number(effect.riskDelta) || 0), 0, 100));
  projected.stats.will = round1(clamp(beforeEffect.will + (Number(effect.willDelta) || 0), 0, projected.stats.willMax));
  projected.stats.network = Math.max(0, beforeEffect.network + (Number(effect.networkDelta) || 0));
  const actuals = [];
  const riskDelta = round1(projected.stats.risk - beforeEffect.risk);
  const willDelta = round1(projected.stats.will - beforeEffect.will);
  const networkDelta = round1(projected.stats.network - beforeEffect.network);
  if (riskDelta) actuals.push("风险 " + (riskDelta > 0 ? "+" : "") + riskDelta);
  if (willDelta) actuals.push("心力 " + (willDelta > 0 ? "+" : "") + willDelta);
  if (networkDelta) actuals.push("人脉 " + (networkDelta > 0 ? "+" : "") + networkDelta);

  const supportBefore = Number(projected.support) || 0;
  const supportAfter = effect.support == null ? supportBefore : Math.max(supportBefore, Number(effect.support) >= 8 ? 8 : 0);
  if (supportAfter > supportBefore) {
    actuals.push("接应就绪，返程更稳妥");
  }
  projected.support = supportAfter;

  const rewardAvailable = canonicalItem(effect.rewardId)
    && !(run.rewardedEventIds || []).includes(event.id);
  if (rewardAvailable) {
    const fits = bagWeight(projected) + itemWeight(effect.rewardId) <= Number(projected.bagCap) + 0.001;
    if (fits) projected.bag.push(effect.rewardId);
    actuals.push("获得" + itemName(effect.rewardId) + (fits ? "" : "（待整理）"));
  }
  const trustDelta = Number(effect.trustDelta) || 0;
  if (event.type === "npc" && trustDelta) actuals.push("人物信任 " + (trustDelta > 0 ? "+" : "") + round1(trustDelta));
  if (Number.isInteger(effect.routeDepth) && effect.routeDepth < expeditionState(run).depth) actuals.push('回到靠近出口的位置');
  const story = effect.text || fallback || "行动已结算。";
  return actuals.length ? story + " 实际后果：" + actuals.join("；") + "。" : story;
}

function choiceCostText(choice) {
  const costs = [];
  if (Number(choice.cost?.will) > 0) costs.push(`心力 −${choice.cost.will}`);
  if (Number(choice.cost?.network) > 0) costs.push(`人脉 −${choice.cost.network}`);
  for (const [id, count] of Object.entries(choice.cost?.items || {})) costs.push(`${itemName(id)} ×${count}`);
  return costs.length ? `消耗 ${costs.join('、')}` : '不消耗资源';
}

function eventAction(run, choice) {
  const reason = choice.exit && run.pendingLoot?.length ? '先整理本轮发现，再选择撤离。' : requirementsReason(run, choice);
  if (run.event.encounterVersion === 2) return {
    id: `event:${choice.key}`, name: choice.label || choice.name, label: choice.label || choice.name,
    disabled: !!reason, reason, endsRaid: choice.exit === true,
    ...(choice.talentUse ? { talent: true } : {}),
  };
  const probability = eventChoiceProbability(run, choice);
  const event = run.event;
  const successMomentum = !choice.exit && eventMomentum(event, true, choice);
  const failureMomentum = !choice.exit && eventMomentum(event, false, choice);
  const success = effectSummary(run, event, choice, choiceEffect(choice, 'success'), '行动成功。')
    + (successMomentum ? ` 后续两次搜索：${MOMENTUM[successMomentum].name}。${MOMENTUM[successMomentum].description}` : '');
  const failure = choice.check
    ? effectSummary(run, event, choice, choiceEffect(choice, 'failure'), '检定未通过。')
      + (failureMomentum ? ` 后续两次搜索：${MOMENTUM[failureMomentum].name}。${MOMENTUM[failureMomentum].description}` : '')
    : '无需检定，满足条件即可完成。';
  const exitRiskDelta = round1(clamp((Number(run.stats?.risk) || 0) + (Number(choiceEffect(choice, 'success').riskDelta) || 0), 0, 100) - clamp(run.stats?.risk, 0, 100));
  const action = {
    id: `event:${choice.key}`,
    name: choice.name,
    disabled: !!reason,
    reason,
    ...(!choice.exit ? { probability, outlook: likelihoodLabel(probability) } : {}),
    cost: choice.exit ? `风险 +${exitRiskDelta} 后立即撤离` : choiceCostText(choice),
    success,
    failure,
    endsRaid: choice.exit === true,
  };
  if (choice.exit) {
    const exitEffect = choiceEffect(choice, 'success');
    const risk = clamp((Number(run.stats?.risk) || 0) + (Number(exitEffect.riskDelta) || 0), 0, 100);
    const rawSupport = Number(exitEffect.support) || 0;
    const support = Math.max(Number(run.support) || 0, rawSupport >= 8 ? 8 : 0);
    const after = exitProbabilities({ ...run, stats: { ...run.stats, risk }, support });
    action.exitProbabilities = { full: after.full, partial: after.partial, fail: after.fail };
    action.outlook = likelihoodLabel(after.full);
  }
  return action;
}

function eventActionSpecs(run) {
  const event = run.event;
  if (!event) return [];
  const choices = [...event.choices];
  if (event.encounterVersion !== 2 && !event.story && event.type === 'npc' && normalizeRaidTalent(run.talent)?.id === 'connector') choices.push(CONNECTOR_CHOICE);
  choices.push(eventLeaveChoice(run));
  return choices.map(choice => eventAction(run, choice));
}

function removeItemCount(run, id, amount) {
  const removed = [];
  for (let count = 0; count < amount; count += 1) {
    const index = run.bag.indexOf(id);
    if (index < 0) return null;
    removed.push(removeBagItem(run, index));
  }
  return removed;
}

function applyEventCost(run, choice) {
  if (choice.talentUse) run.talentState = { ...(run.talentState || {}), used: true };
  const cost = choice.cost || {};
  run.stats.will = round1(Math.max(0, run.stats.will - (Number(cost.will) || 0)));
  run.stats.network = Math.max(0, run.stats.network - (Number(cost.network) || 0));
  const consumed = [];
  for (const [id, rawCount] of Object.entries(cost.items || {})) {
    const removed = removeItemCount(run, id, Math.max(0, Math.floor(Number(rawCount) || 0)));
    if (removed) consumed.push(...removed);
  }
  return consumed;
}

function recordEventContact(run, event, delta, outcome, impression) {
  if (!event.npcId || !delta) return;
  run.contactUpdates ||= {};
  const contact = run.contactUpdates[event.npcId] || { name: event.name, trustDelta: 0, meetings: 0 };
  contact.name = event.name;
  contact.trustDelta += delta;
  contact.meetings += 1;
  contact.lastImpression = impression || '';
  contact.outcome = outcome;
  run.contactUpdates[event.npcId] = contact;
}

function applyEventEffect(run, event, effect = {}, outcome = 'success') {
  const before = { risk: Number(run.stats.risk) || 0, will: Number(run.stats.will) || 0 };
  run.stats.risk = round1(clamp(before.risk + (Number(effect.riskDelta) || 0), 0, 100));
  run.stats.will = round1(clamp(before.will + (Number(effect.willDelta) || 0), 0, run.stats.willMax));
  if (Number.isInteger(effect.routeDepth)) {
    run.expedition = expeditionState(run);
    run.expedition.depth = Math.floor(clamp(effect.routeDepth, 0, 4));
  }
  if (effect.support != null) run.support = Math.max(Number(run.support) || 0, Number(effect.support) >= 8 ? 8 : 0);
  if (Number(effect.networkDelta)) run.stats.network = Math.max(0, Number(run.stats.network) + Number(effect.networkDelta));
  const added = [];
  if (effect.rewardId && canonicalItem(effect.rewardId)) {
    run.rewardedEventIds ||= [];
    if (!run.rewardedEventIds.includes(event.id)) {
      added.push(...placeLoot(run, [effect.rewardId]));
      run.rewardedEventIds.push(event.id);
    }
  }
  if (event.type === 'npc' && effect.trustDelta) {
    recordEventContact(run, event, effect.trustDelta, outcome, effect.text);
  }
  return { before, added };
}

function resolveEvent(run, id) {
  const event = run.event;
  const actionId = id.slice('event:'.length);
  if (event.encounterVersion === 2 && (run.resolvedEventIds || []).includes(event.id)) return responseFailure('这个事件已经结算。');
  if (!storyResolutionAllowed(run, event)) return responseFailure('这段奇遇已经结算，不能重复领取结果。');
  const choice = actionId === 'leave' ? eventLeaveChoice(run)
    : actionId === CONNECTOR_CHOICE.key && event.encounterVersion !== 2 && !event.story && event.type === 'npc' && normalizeRaidTalent(run.talent)?.id === 'connector'
      ? CONNECTOR_CHOICE : event.choices.find(row => row.key === actionId);
  if (!choice) return responseFailure('当前事件没有这个处理方案。');
  const publicAction = eventAction(run, choice);
  if (publicAction.disabled) return responseFailure(publicAction.reason || '当前条件不足。');
  const probability = eventChoiceProbability(run, choice);
  if (event.encounterVersion === 2) {
    run.resolvedEventIds ||= [];
    run.resolvedEventIds.push(event.id);
  }
  const consumed = applyEventCost(run, choice);
  if (choice.exit) {
    const effect = choiceEffect(choice, 'success');
    const result = applyEventEffect(run, event, effect, 'leave');
    run.event = null;
    run.encounterCooldown = true;
    run.pendingAutoExtract = true;
    log(run, 'event', `${effect.text || publicAction.success}${event.encounterVersion === 2 ? '' : ` 风险增加到 ${run.stats.risk}。`}${consumed.length ? `消耗了${consumed.map(itemName).join('、')}。` : ''}`);
    if (!run.pendingLoot.length) finishExtraction(run, true);
    return { ok: true, eventSuccess: null, itemsAdded: result.added, endsRaid: true,
      text: event.encounterVersion === 2 ? run.result?.summary || effect.text : publicAction.success };
  }

  const success = choice.check ? rollPercent(run, probability) : true;
  const effect = choiceEffect(choice, success ? 'success' : 'failure');
  const description = event.encounterVersion === 2 ? effectSummary(run, event, { ...choice, cost: {} }, effect)
    : success ? publicAction.success : publicAction.failure;
  const result = applyEventEffect(run, event, effect, success ? 'success' : 'setback');
  if (event.type === 'npc' && choice.xp !== false) run.history.push(`npc:reply:${event.id}`);
  run.event = null;
  run.encounterCooldown = true;
  recordAcademicStory(run, event, choice, success);
  const momentumId = eventMomentum(event, success, choice);
  run.expedition = expeditionState(run);
  if (momentumId) run.expedition.effect = { id: momentumId, remainingSearches: 2 };
  log(run, 'event', `${description}${consumed.length ? ` 消耗了${consumed.map(itemName).join('、')}。` : ''}`);
  if (event.encounterVersion === 2 && run.stats.will > 0) run.pendingAutoExtract = false;
  if (run.stats.will <= 0) {
    run.pendingAutoExtract = true;
    if (!run.pendingLoot.length) finishExtraction(run, true);
  }
  return { ok: true, eventSuccess: success, itemsAdded: result.added, endsRaid: false, text: description,
    ...(event.encounterVersion === 2 ? { brief: effect.brief || effect.text?.split(/[，。]/)[0] } : {}) };
}

function eventView(run) {
  const event = run.event;
  if (!event) return null;
  return {
    id: event.id,
    name: event.name,
    title: event.title,
    text: event.text,
    ...(event.encounterVersion === 2 ? { encounterVersion: 2, prompt: event.prompt } : {}),
    kind: event.type,
    ...(event.story ? { story: clone(event.story) } : {}),
    ...(event.storyEcho ? { storyEcho: event.storyEcho } : {}),
    typeLabel: EVENT_TYPE_LABELS[event.type] || '人物事件',
    tone: event.tone || 'social',
    image: event.image || '/assets/generated/scholar.png',
    actions: eventActionSpecs(run).map(action => ({ ...action })),
  };
}

function publicItem(id, index, protectedIndex) {
  const definition = ITEMS[id] || { id, name: id, weight: 0, value: 0 };
  return { ...definition, id, index, protected: index === protectedIndex };
}

function eventPacingView(run, probabilities) {
  const pacing = run.encounterPacing || { eligibleSearches: 0, dryStreak: 0, firstEventSeen: false };
  const eventsUsed = Math.max(0, Number(run.eventCount) || 0);
  const eventsLimit = 4;
  let searchesUntilGuaranteed = null;
  if (eventsUsed < eventsLimit && Number(run.stats?.will) > 1 && eventPool(run).length) {
    searchesUntilGuaranteed = pacing.firstEventSeen === true
      ? Math.max(1, 4 - Math.max(0, Number(pacing.dryStreak) || 0))
      : Math.max(1, 2 - Math.max(0, Number(pacing.dryStreak) || 0));
  }
  if (searchesUntilGuaranteed !== null && academicStoryCallbackReady(run)) searchesUntilGuaranteed = 1;
  return {
    searchesUntilGuaranteed,
    eventsUsed,
    eventsLimit,
    cooldown: run.encounterCooldown === true,
    reason: probabilities.encounterReason,
    eligibleSearches: Math.max(0, Number(pacing.eligibleSearches) || 0),
    noEventStreak: Math.max(0, Number(pacing.dryStreak) || 0),
  };
}

function addAction(actions, id, name, disabled = false, reason = '', kind = 'run') {
  actions.push({ id, name, disabled: !!disabled, reason: reason || '', kind });
}

function actionView(run) {
  if (run.status !== 'playing') return [];
  const actions = [];
  const hasPending = run.pendingLoot?.length > 0;
  const pending = !!run.event;
  const auto = run.pendingAutoExtract === true;
  const searchDisabled = pending || hasPending || auto || Number(run.stats?.will) < 1;
  const searchReason = pending ? '先处理当前人物事件。' : hasPending ? '先决定如何处理刚发现的物品。'
    : auto ? '心力已耗尽，正在自动撤离。' : Number(run.stats?.will) < 1 ? '心力不足，不能继续搜索。' : '';
  addAction(actions, 'search', '搜索一次', searchDisabled, searchReason, 'search');
  const searchAction = actions.at(-1);
  const next = computeProbabilities(run);
  searchAction.probability = next.acquisition;
  searchAction.riskDelta = round1(next.parts.acquisition.riskAfterSearch - (Number(run.stats?.risk) || 0));
  searchAction.cost = `心力 −1；风险 +${searchAction.riskDelta}`;
  searchAction.searchPreview = {
    willCost: 1,
    riskBefore: round1(run.stats?.risk),
    riskAfter: next.parts.acquisition.riskAfterSearch,
    riskDelta: searchAction.riskDelta,
    acquisition: next.acquisition,
    encounter: next.encounter,
    extraDrop: next.extraDrop,
  };
  searchAction.outlook = outlookFor(next);
  for (const approach of expeditionView(run).approaches.filter(row => row.id !== 'steady')) {
    actions.push({ id: approach.actionId, name: approach.name, kind: 'search', disabled: searchDisabled, reason: searchReason,
      probability: approach.searchPreview.acquisition, riskDelta: approach.searchPreview.riskDelta,
      cost: `心力 −1；风险 +${approach.searchPreview.riskDelta}`, outlook: approach.outlook, searchPreview: approach.searchPreview });
  }
  const extractDisabled = pending || hasPending || auto;
  const extractReason = pending ? '先回应人物事件，或选择结束交流并撤离。'
    : hasPending ? '先处理刚发现的物品。' : auto ? '心力已耗尽，正在自动撤离。' : '';
  addAction(actions, 'extract', '撤离', extractDisabled, extractReason, 'extract');

  if (pending) {
    for (const action of eventActionSpecs(run)) {
      addAction(actions, action.id, action.name, action.disabled, action.reason, 'event');
    }
  }
  if (hasPending) {
    const allWeight = bagWeight(run) + run.pendingLoot.reduce((sum, id) => sum + itemWeight(id), 0);
    addAction(actions, 'take:all', '全部带走', allWeight > run.bagCap + 0.001,
      allWeight > run.bagCap + 0.001 ? '背包放不下全部物品；先丢弃一件或选“带走能装下的”。' : '', 'loot');
    addAction(actions, 'take:available', '带走能装下的', false, '', 'loot');
    addAction(actions, 'take:skip', '全部放弃', false, '', 'loot');
  }
  for (let index = 0; index < (run.bag || []).length; index += 1) {
    addAction(actions, `drop:${index}`, `丢弃：${itemName(run.bag[index])}`, false, '', 'inventory');
    const item = ITEMS[run.bag[index]];
    if (item?.use && !item.gear) {
      const amount = Number(item.use.will) || 0;
      const noBenefit = amount <= 0 || Number(run.stats.will) >= Number(run.stats.willMax) - 0.001;
      const disabled = auto || noBenefit;
      addAction(actions, `use:${index}`, `使用：${item.name}`, disabled,
        auto ? '心力已耗尽，正在自动撤离。' : noBenefit ? '使用后不会恢复心力。' : `恢复最多 ${amount} 点心力；不推进搜索、不改变风险。`, 'supply');
    }
  }
  const backupReady = hasGear(run, 'backup_device');
  const noProtectedMaterial = run.protectedIndex === null || run.protectedIndex === undefined;
  addAction(actions, 'backup:none', '取消材料保护', noProtectedMaterial,
    noProtectedMaterial ? '当前没有已指定的备份材料。' : '', 'backup');
  if (backupReady) {
    (run.bag || []).forEach((id, index) => {
      if (RESEARCH_MATERIALS.has(id)) addAction(actions, `backup:${index}`, `保护：${itemName(id)}`, false, '', 'backup');
    });
  }
  actions.push(...talentActions(run));
  return actions;
}

export function probabilityRaidView(run) {
  if (!run || typeof run !== 'object') return null;
  const probabilities = run.status === 'ended' && run.result?.probabilities
    ? clone(run.result.probabilities)
    : computeProbabilities(run);
  const protectedIndex = hasGear(run, 'backup_device') && Number.isInteger(run.protectedIndex)
    && run.protectedIndex >= 0 && run.protectedIndex < (run.bag || []).length ? run.protectedIndex : null;
  let result = run.result ? clone(run.result) : null;
  if (result) {
    result.returned = [
      ...result.archivedIds.map(id => ({ ...ITEMS[id], id, protected: true })),
      ...result.carriedIds.map(id => ({ ...ITEMS[id], id, protected: false })),
    ];
    result.lost = result.lostIds.map(id => ({ ...ITEMS[id], id, protected: false }));
    result.carried = result.returned;
    result.carriedItems = result.returned;
  }
  return {
    mode: PROBABILITY_MODE,
    probabilityVersion: 3,
    ...(run.encounterVersion === 2 ? { encounterVersion: 2 } : {}),
    raidId: run.raidId,
    revision: Math.max(0, Number(run.revision) || 0),
    status: run.status,
    player: clone(run.player || {}),
    venue: { id: run.venueId, name: venueFor(run).name },
    difficulty: {
      id: difficultyFor(run) === DIFFICULTIES[run.difficultyId] ? run.difficultyId : 'normal',
      name: difficultyFor(run).name,
      description: difficultyFor(run).description,
      acquisitionModifier: difficultyFor(run).acquisitionModifier,
      riskModifier: difficultyFor(run).riskModifier,
      eventModifier: difficultyFor(run).eventModifier,
      extraDropModifier: difficultyFor(run).extraDropModifier,
    },
    stats: {
      will: round1(run.stats?.will), willMax: round1(run.stats?.willMax),
      network: Math.max(0, Math.floor(Number(run.stats?.network) || 0)),
      risk: round1(run.stats?.risk),
    },
    bag: (run.bag || []).map((id, index) => ({ ...publicItem(id, index, protectedIndex),
      protected: index === protectedIndex || index === talentProtectedIndex(run),
      protection: index === protectedIndex && index === talentProtectedIndex(run) ? 'both'
        : index === protectedIndex ? 'equipment' : index === talentProtectedIndex(run) ? 'talent' : null })),
    bagCap: Math.max(0, Number(run.bagCap) || PROBABILITY_BASE_BAG_CAP),
    bagUsed: round1(bagWeight(run)),
    probabilities,
    outlook: outlookFor(probabilities, run.stats?.risk),
    expedition: expeditionView(run),
    stories: academicStoriesView(run),
    talent: talentView(run),
    encounterPacing: eventPacingView(run, probabilities),
    lastAction: run.lastAction ? clone(run.lastAction) : null,
    event: eventView(run),
    pendingLoot: (run.pendingLoot || []).map((id, index) => ({ ...ITEMS[id], id, pendingIndex: index })),
    actions: actionView(run),
    result,
    log: clone((run.log || []).slice(-80)),
  };
}

function actionId(action) {
  if (typeof action === 'string') return action;
  return action && typeof action.id === 'string' ? action.id : '';
}

function responseFailure(reason) {
  return { ok: false, reason };
}

function commitAction(run, text, type = 'action', before = null, details = {}) {
  run.actionIndex = (Number(run.actionIndex) || 0) + 1;
  run.revision = (Number(run.revision) || 0) + 1;
  if (text) log(run, type, text);
  const stateBefore = before || { risk: run.stats.risk, will: run.stats.will, network: run.stats.network };
  const itemsAdded = (Array.isArray(details.itemsAdded) ? details.itemsAdded : []).map(value => {
    const id = typeof value === 'string' ? value : value?.id;
    return {
      ...(ITEMS[id] || { id, name: itemName(id) }), id, protected: false,
      ...(typeof value === 'object' && value?.pending ? { pending: true } : {}),
    };
  });
  run.lastAction = {
    title: details.title || ({ search: '搜索结果', event: '事件处理', result: '撤离结算', loot: '物品整理', inventory: '背包整理', backup: '材料保护', supply: '补给使用' }[type] || '行动结果'),
    text: details.text || text || '行动已结算。',
    ...(run.encounterVersion === 2 ? { brief: Array.from(details.brief || details.text?.split(/[。]/)[0]
      || text?.split(/[。]/)[0] || '行动已结算').slice(0, 24).join('') } : {}),
    riskDelta: round1((Number(run.stats.risk) || 0) - (Number(stateBefore.risk) || 0)),
    willDelta: round1((Number(run.stats.will) || 0) - (Number(stateBefore.will) || 0)),
    networkDelta: round1((Number(run.stats.network) || 0) - (Number(stateBefore.network) || 0)),
    itemsAdded,
    type,
    revision: run.revision,
    eventTriggered: details.eventTriggered ? clone(details.eventTriggered) : null,
    description: details.description || details.text || text || '',
  };
  return { ok: true, revision: run.revision };
}

function rollPercent(run, percent) {
  return nextRandom(run) * 100 < clamp(percent, 0, 100);
}

function chooseEvent(run) {
  const stories = academicStoryCandidates(run);
  if (stories.length) {
    const total = stories.reduce((sum, event) => sum + academicStoryWeight(run, event), 0);
    let draw = nextRandom(run) * total;
    const event = stories.find(candidate => { draw -= academicStoryWeight(run, candidate); return draw < 0; }) || stories.at(-1);
    if (!run.storyRun) run.storyRun = { id: event.story.id, initialChapter: event.story.chapter - 1 };
    return prepareSurpriseEncounter(run, event, () => nextRandom(run));
  }
  const pool = eventPool(run);
  if (!pool.length) return null;
  const weights = contextModifiers(run).condition.events || {};
  const total = pool.reduce((sum, event) => sum + (weights[event.type] || 1), 0);
  let draw = nextRandom(run) * total;
  const event = pool.find(candidate => { draw -= weights[candidate.type] || 1; return draw < 0; }) || pool.at(-1);
  const contact = run.contacts?.[event.npcId] || {};
  const chosen = {
    ...event,
    name: typeof contact.name === 'string' && contact.name ? contact.name : event.name,
    trust: Number(contact.trust) || 0,
    text: event.text,
  };
  chosen.choices = clone(event.choices || []);
  if (run.encounterVersion === 2 && event.type === 'npc' && normalizeRaidTalent(run.talent)?.id === 'connector') chosen.choices.push(CONNECTOR_CHOICE);
  chosen.typeLabel = EVENT_TYPE_LABELS[event.type] || '人物事件';
  return prepareSurpriseEncounter(run, withAcademicStoryEcho(run, chosen), () => nextRandom(run));
}

function validProtectedItem(run) {
  if (!hasGear(run, 'backup_device') || !Number.isInteger(run.protectedIndex)) return null;
  const id = run.bag?.[run.protectedIndex];
  return RESEARCH_MATERIALS.has(id) ? { index: run.protectedIndex, id } : null;
}

function finishExtraction(run, automatic = false) {
  if (run.status !== 'playing') return false;
  const probabilities = computeProbabilities(run);
  const draw = nextRandom(run) * 100;
  const kind = draw < probabilities.fail ? 'scatter'
    : draw < probabilities.fail + probabilities.partial ? 'messy' : 'clean';
  const protectedItem = validProtectedItem(run);
  const archivedIndexes = new Set([protectedItem?.index, talentProtectedIndex(run)].filter(index => Number.isInteger(index) && index >= 0));
  const protectedId = protectedItem?.id || run.bag?.[talentProtectedIndex(run)] || null;
  const bag = [...(run.bag || [])];
  let lostIndex = -1;
  if (kind === 'scatter') {
    // Failure loses all unprotected carried items, including unused supplies.
  } else if (kind === 'messy') {
    const candidates = bag.map((id, index) => ({ id, index }))
      .filter(item => !archivedIndexes.has(item.index) && RESEARCH_MATERIALS.has(item.id))
      .sort((a, b) => itemValue(a.id) - itemValue(b.id) || a.index - b.index);
    if (candidates.length) lostIndex = candidates[0].index;
  }

  const archivedIds = [...archivedIndexes].map(index => bag[index]);
  const carriedIds = kind === 'scatter' ? [] : bag.filter((id, index) => !archivedIndexes.has(index) && index !== lostIndex);
  const lostIds = kind === 'scatter'
    ? bag.filter((_, index) => !archivedIndexes.has(index))
    : lostIndex >= 0 ? [bag[lostIndex]] : [];
  const noMaterialLoss = kind === 'messy' && lostIndex < 0;
  run.result = {
    kind,
    archivedIds,
    carriedIds,
    lostIds,
    returnedLoadoutIds: [...(run.loadout || [])],
    converted: {},
    probabilities: clone(probabilities),
    probabilityRoll: round1(draw),
    automatic: !!automatic,
    protectedId,
    noMaterialLoss,
    summary: kind === 'clean' ? '完整带回：背包物品全部保留。'
      : kind === 'messy' ? noMaterialLoss ? '部分带回：没有未保护的研究材料需要损失。' : `部分带回：仅损失 1 份未保护材料${lostIds[0] ? `「${itemName(lostIds[0])}」` : ''}。`
        : `行动失败：未保护物品损失${archivedIds.length ? `；${archivedIds.map(id => `「${itemName(id)}」`).join('、')}已由备份或封存保护` : ''}。`,
  };
  run.status = 'ended';
  run.pendingLoot = [];
  run.pendingAutoExtract = false;
  run.event = null;
  log(run, 'result', run.result.summary);
  return true;
}

function finishIfAutomatic(run) {
  if (!run.pendingAutoExtract || run.pendingLoot.length || run.event || run.status !== 'playing') return false;
  return finishExtraction(run, true);
}

function removeBagItem(run, index) {
  const [id] = run.bag.splice(index, 1);
  if (run.protectedIndex === index) run.protectedIndex = null;
  else if (Number.isInteger(run.protectedIndex) && run.protectedIndex > index) run.protectedIndex -= 1;
  if (run.talentState?.protectedIndex === index) run.talentState.protectedIndex = null;
  else if (Number.isInteger(run.talentState?.protectedIndex) && run.talentState.protectedIndex > index) run.talentState.protectedIndex -= 1;
  return id;
}

function performSearch(run, approachId = 'steady') {
  const preview = computeProbabilities(run, approachId);
  run.encounterPacing ||= { eligibleSearches: 0, dryStreak: 0, firstEventSeen: (Number(run.eventCount) || 0) > 0 };
  const riskBefore = Number(run.stats.risk) || 0;
  const willBefore = Number(run.stats.will);
  run.stats.will = round1(Math.max(0, willBefore - 1));
  run.stats.risk = searchRiskAfter(run, approachId);
  run.history.push('container:search:probability');

  const found = rollPercent(run, preview.acquisition);
  const loot = [];
  if (found) {
    const first = weightedItem(run);
    if (first) loot.push(first);
    const extraChance = extraDropChance(run, approachId);
    if (first && extraChance > 0 && rollPercent(run, extraChance)) {
      const extra = weightedItem(run);
      if (extra) loot.push(extra);
    }
  }
  run.pendingLoot = [];
  const itemsAdded = placeLoot(run, loot);

  // A just-resolved event protects precisely this next search from another event.
  const hadCooldown = run.encounterCooldown === true;
  const encounterChance = hadCooldown ? 0 : preview.encounter;
  const encounterEligible = encounterChance > 0;
  run.encounterCooldown = false;
  let eventText = '';
  let eventTriggered = null;
  if (encounterChance > 0 && rollPercent(run, encounterChance)) {
    const event = chooseEvent(run);
    if (event) {
      run.event = event;
      run.eventCount += 1;
      run.usedEventIds.push(event.id);
      eventText = ` 遇到${event.name}：${event.title}。`;
      eventTriggered = { id: event.id, title: event.title,
        typeLabel: EVENT_TYPE_LABELS[event.type] || '人物事件', tone: event.tone || 'social', image: event.image || null };
    }
  }

  if (encounterEligible) {
    run.encounterPacing.eligibleSearches += 1;
    if (eventTriggered) {
      run.encounterPacing.firstEventSeen = true;
      run.encounterPacing.dryStreak = 0;
    } else {
      run.encounterPacing.dryStreak += 1;
    }
  }

  const resultText = found
    ? `搜索成功，发现${loot.map(itemName).join('、') || '研究材料'}。`
    : '这次没有找到材料。';
  const cooldownText = hadCooldown ? ' 本次搜索享受一次交涉冷却。' : '';
  log(run, 'search', `${APPROACHES[approachId].name}：${resultText} 心力 −1，处境${riskLabel(run.stats.risk)}。${eventText}${cooldownText}`);
  advanceExpedition(run, approachId);
  if (run.stats.will <= 0) {
    run.pendingAutoExtract = true;
    if (!run.pendingLoot.length && !run.event) finishExtraction(run, true);
  }
  return { found, loot, encounterChance, eventTriggered,
    itemsAdded, text: `${resultText}${eventText || ''}`, riskBefore, riskAfter: run.stats.risk };
}

export function actProbabilityRaid(run, action) {
  if (!run || run.mode !== PROBABILITY_MODE) return responseFailure('这不是概率远征。');
  if (run.status !== 'playing') return responseFailure('本次远征已经结束。');
  const id = actionId(action);
  if (!id) return responseFailure('无效的行动。');
  const before = { risk: Number(run.stats?.risk) || 0, will: Number(run.stats?.will) || 0, network: Number(run.stats?.network) || 0 };

  if (id.startsWith('talent:')) return performTalentAction(run, id, before);

  if (id.startsWith('event:')) {
    if (!run.event || !Array.isArray(run.event.choices)) return responseFailure('当前没有可处理的规则事件。');
    const result = resolveEvent(run, id);
    if (!result.ok) return result;
    const type = result.endsRaid || run.status === 'ended' ? 'result' : 'event';
    const committed = commitAction(run, '', type, before, {
      title: result.endsRaid ? '事件离场' : '事件处理',
      text: result.text,
      brief: result.brief,
      itemsAdded: result.itemsAdded || [],
      eventTriggered: null,
    });
    return { ...committed, eventSuccess: result.eventSuccess, endsRaid: result.endsRaid, automatic: run.status === 'ended' };
  }

  if (id === 'search' || id === 'search:cautious' || id === 'search:deep') {
    if (run.event) return responseFailure('先处理当前人物事件。');
    if (run.pendingLoot.length) return responseFailure('先决定如何处理刚发现的物品。');
    if (run.pendingAutoExtract) return responseFailure('心力已耗尽，正在自动撤离。');
    if (run.stats.will < 1) return responseFailure('心力不足，不能继续搜索。');
    const approachId = id === 'search' ? 'steady' : id.slice('search:'.length);
    const outcome = performSearch(run, approachId);
    const committed = commitAction(run, '', 'search', before, {
      title: outcome.found ? '搜索发现' : '搜索结果',
      text: outcome.text,
      itemsAdded: outcome.itemsAdded,
      eventTriggered: outcome.eventTriggered,
    });
    return { ...committed, found: outcome.found, encounter: !!run.event, automatic: run.status === 'ended' };
  }

  if (id === 'extract') {
    if (run.event) return responseFailure('先处理当前人物事件，或选择结束交流并撤离。');
    if (run.pendingLoot.length) return responseFailure('先处理刚发现的物品。');
    if (run.pendingAutoExtract) return responseFailure('心力已耗尽，正在自动撤离。');
    finishExtraction(run, false);
    return commitAction(run, '', 'result', before, { title: '撤离结算', text: run.result?.summary });
  }

  if (id === 'take:all' || id === 'take:available' || id === 'take:skip') {
    if (!run.pendingLoot.length) return responseFailure('当前没有待处理的发现物品。');
    let acceptedItems = [];
    if (id === 'take:all') {
      const addedWeight = run.pendingLoot.reduce((sum, item) => sum + itemWeight(item), 0);
      if (bagWeight(run) + addedWeight > run.bagCap + 0.001) return responseFailure('背包容量不足；请丢弃物品或带走能装下的部分。');
      acceptedItems = [...run.pendingLoot];
      run.bag.push(...run.pendingLoot);
      log(run, 'loot', `全部带走：${run.pendingLoot.map(itemName).join('、')}。`);
    } else if (id === 'take:available') {
      const accepted = [];
      const skipped = [];
      for (const item of run.pendingLoot) {
        if (bagWeight(run) + itemWeight(item) <= run.bagCap + 0.001) {
          run.bag.push(item);
          accepted.push(item);
        } else skipped.push(item);
      }
      acceptedItems = accepted;
      log(run, 'loot', `带走 ${accepted.length ? accepted.map(itemName).join('、') : '0 件物品'}${skipped.length ? `；放弃 ${skipped.map(itemName).join('、')}` : ''}。`);
    } else {
      log(run, 'loot', `你放弃了${run.pendingLoot.map(itemName).join('、')}。`);
    }
    run.pendingLoot = [];
    finishIfAutomatic(run);
    const actionText = acceptedItems.length ? `带回${acceptedItems.map(itemName).join('、')}。` : '你放弃了待处理的物品。';
    return { ...commitAction(run, '', run.status === 'ended' ? 'result' : 'loot', before, {
      title: '物品整理', text: actionText, itemsAdded: acceptedItems,
    }), automatic: run.status === 'ended' };
  }

  if (id.startsWith('drop:')) {
    if (run.pendingAutoExtract && !run.pendingLoot.length) return responseFailure('心力已耗尽，正在自动撤离。');
    const rawIndex = id.slice('drop:'.length);
    if (!/^\d+$/.test(rawIndex)) return responseFailure('物品位置无效。');
    const index = Number(rawIndex);
    if (index < 0 || index >= run.bag.length) return responseFailure('背包里没有这个位置的物品。');
    const removed = removeBagItem(run, index);
    log(run, 'loot', `你丢弃了${itemName(removed)}；风险不变。`);
    finishIfAutomatic(run);
    return { ...commitAction(run, '', run.status === 'ended' ? 'result' : 'inventory', before, {
      title: '丢弃物品', text: `丢弃${itemName(removed)}。`,
    }), automatic: run.status === 'ended' };
  }

  if (id === 'backup:none') {
    if (run.protectedIndex === null || run.protectedIndex === undefined) return responseFailure('当前没有已指定的备份材料。');
    run.protectedIndex = null;
    return commitAction(run, '取消了研究材料保护指定。', 'backup', before);
  }
  if (id.startsWith('backup:')) {
    if (!hasGear(run, 'backup_device')) return responseFailure('需要装备研究备份设备才能指定保护材料。');
    const rawIndex = id.slice('backup:'.length);
    if (!/^\d+$/.test(rawIndex)) return responseFailure('物品位置无效。');
    const index = Number(rawIndex);
    if (index < 0 || index >= run.bag.length || !RESEARCH_MATERIALS.has(run.bag[index])) return responseFailure('备份设备只能保护背包里的研究材料。');
    if (run.protectedIndex === index) return responseFailure('这件材料已经受到保护。');
    run.protectedIndex = index;
    log(run, 'backup', `备份设备已指定保护${itemName(run.bag[index])}。`);
    return commitAction(run, '', 'backup', before, {
      title: '材料备份', text: `已保护${itemName(run.bag[index])}。`,
    });
  }

  if (id.startsWith('use:')) {
    if (run.pendingAutoExtract) return responseFailure('心力已耗尽，正在自动撤离。');
    const rawIndex = id.slice('use:'.length);
    if (!/^\d+$/.test(rawIndex)) return responseFailure('物品位置无效。');
    const index = Number(rawIndex);
    const itemId = run.bag[index];
    const item = ITEMS[itemId];
    if (!item?.use || item.gear) return responseFailure('该物品不能作为补给使用。');
    const recovery = Math.max(0, Number(item.use.will) || 0);
    if (!recovery || run.stats.will >= run.stats.willMax - 0.001) return responseFailure('使用后不会恢复心力。');
    const previousWill = run.stats.will;
    run.stats.will = round1(Math.min(run.stats.willMax, run.stats.will + recovery));
    const used = removeBagItem(run, index);
    log(run, 'supply', `使用${itemName(used)}，心力恢复 ${round1(run.stats.will - previousWill)}；不改变风险。`);
    return commitAction(run, '', 'supply', before, {
      title: '使用补给', text: `使用${itemName(used)}，心力恢复 ${round1(run.stats.will - previousWill)}。`,
    });
  }

  return responseFailure('未知的行动。');
}
