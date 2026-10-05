// New encounters are prepared once with the raid's RNG, then saved verbatim.
// Views never draw randomness and the public action contract omits these rules.
const ORDINARY = {
  'v2-prof-audit': ['温教授翻到了你的评测记录。', ['翻开记录', '聊聊方法']],
  'v2-peer-collab': ['周同学把笔记本推了过来。', ['说说想法', '看看样例', '问问近况']],
  'v2-engineer-credit': ['秦工程师正在收拾演示台。', ['聊聊项目', '打个招呼']],
  'v2-resource-data-swap': ['交换台上摊着几份样本。', ['翻翻目录', '看看样本']],
  'v2-resource-compute-demo': ['试用柜台的屏幕亮了起来。', ['看看屏幕', '问问工作人员']],
  'v2-resource-code-share': ['分享会刚散场，维护者还没走。', ['翻翻手册', '聊聊复现']],
  'v2-tech-terminal': ['终端突然停在了同一行。', ['看看机箱', '翻翻日志']],
  'v2-tech-data-corruption': ['样本索引里多出了一行空白。', ['看看样本', '翻翻脚本', '查看索引']],
  'v2-tech-access-conflict': ['两份源码都指向同一个文件。', ['看看文件', '问问维护者', '查看目录']],
  'v2-route-crowd': ['走廊另一头挤满了人。', ['看看路牌', '问问值班员', '靠边看看']],
  'v2-route-shuttle': ['接驳车停在门口，车门还开着。', ['走近车门', '问问司机']],
  'v2-route-badge-check': ['出口值班员向你招了招手。', ['递上参会证', '聊聊来意']],
  'v2-npc-replication-clinic': ['沈师姐指了指复现笔记。', ['翻翻笔记', '看看样本', '聊聊实验']],
  'v2-npc-collaboration-invite': ['许同学给你留了个座位。', ['坐下聊聊', '看看海报']],
  'v2-npc-review-challenge': ['林教授在你的海报前停下了。', ['指指图表', '聊聊结论']],
  'v2-resource-demo-sample': ['样例台上的盒子没有合上。', ['看看盒子', '翻翻说明']],
  'v2-resource-source-code': ['贡献台上摆着一张留言纸。', ['看看留言', '翻翻目录', '问问维护者']],
  'v2-resource-credit-broker': ['额度服务台的叫号灯闪了闪。', ['看看屏幕', '走到柜台']],
  'v2-technical-missing-driver': ['演示设备弹出了一条提示。', ['看看版本', '查看设备']],
  'v2-technical-data-leak': ['样本表里出现了熟悉的记录。', ['看看记录', '翻翻批次', '查看划分']],
  'v2-technical-cache-error': ['缓存窗口反复闪着同一行字。', ['看看缓存', '问问维护者', '查看日志']],
  'v2-route-crowd-pressure': ['海报区的队伍拐进了走廊。', ['看看侧廊', '问问会务', '看看队尾']],
  'v2-route-shuttle-delay': ['广播里响起了接驳车的名字。', ['看看站牌', '问问会务']],
  'v2-route-badge-inspection': ['值班员正在翻访客名册。', ['递上参会证', '聊聊安排']],
};

const STORY_PROMPTS = {
  reviewer_printer: ['打印机吐出一张写着「大修」的纸。', '打印机又响了，这次它认出了你。'],
  stamp_maze: ['盖章机要你先证明这枚章是真的。', '盖章机亮起了你上次的号码。'],
  faculty_cat: ['一只戴会务绳的猫占住了评审席。', '院长猫又出现了，尾巴朝你晃了晃。'],
};
const STORY_CHOICES = {
  'printer-evidence': ['看看样本', '你把展台样本递过去，打印机夹好了复现记录。'],
  'printer-rebuttal': ['写张纸条', '你写下结论边界，打印机开始逐字阅读。'],
  'printer-reproduce': ['核对日志', '日志对上了，打印机交出了复现源码。'],
  'printer-boundary': ['翻翻附页', '附页说明了验证边界，你带走了一条方向线索。'],
  'printer-limit': ['聊聊局限', '打印机收起追加实验清单，留给你一条线索。'],
  'printer-appeal': ['敲敲机盖', '机盖弹开，打印机吐出了撤回通知和源码。'],
  'stamp-record': ['翻翻存根', '你给存根排好页码，窗口留下了回执。'],
  'stamp-sponsor': ['问问熟人', '熟人认出了这枚章，在担保栏签了字。'],
  'stamp-file': ['整理存根', '存根接成了完整记录，窗口交来通行说明。'],
  'stamp-window': ['看看窗口', '人工窗口开了，工作人员递来一份公开样本。'],
  'stamp-honor-boundary': ['翻出回执', '窗口认出了约定，交来样本和通行说明。'],
  'stamp-close-boundary': ['看看新表', '新表还是旧问题，窗口按约定收回了它。'],
  'stamp-repay': ['看看回执', '你理顺了回执，熟人留下了一份合作意向。'],
  'stamp-repay-intel': ['问问近况', '对方找到了处理回执的线索，也说明了出口登记。'],
  'cat-feed': ['看看食碗', '你帮志愿者摆好猫粮，猫把一张路线图压在爪下。'],
  'cat-chair': ['搬把椅子', '猫跳上旁听席，没有再碰你的署名栏。'],
  'cat-side-door': ['跟着尾巴', '猫打开侧门，你回到了靠近出口的位置。'],
  'cat-sort-samples': ['看看爪印', '爪印下面是一份可用样本，你把猫写进了致谢。'],
  'cat-honor-route': ['指指门口', '猫认出了约定，带你回到靠近出口的位置。'],
  'cat-honor-contact': ['看看纸条', '猫拨来的纸条写着合作线索。'],
  'cat-acknowledge': ['看看模板', '你改好了真实致谢，猫拨来一份合作线索。'],
  'cat-honest': ['挠挠椅背', '猫团起错误的署名模板，继续安静旁听。'],
};
const STORY_FAILURES = {
  reviewer_printer: ['打印机卡纸了。你留下纸条，折腾了一阵才脱身。', '打印机又卡纸了，这次没有拿到资料。'],
  stamp_maze: ['窗口突然关了。你留着号码纸，在走廊白等了一阵。', '窗口提前关了，这次没有办成。'],
  faculty_cat: ['猫钻进了桌底。你追了半圈，只找到一串爪印。', '猫叼着材料跑远了，你没能追上。'],
};
const SUCCESS_TEXT = {
  npc: ['话题意外地聊开了。', '对方想起了一个有用的细节。', '你们正好说到了同一件事。'],
  resource: ['资料里夹着一张有用的便签。', '工作人员翻出了留在这里的资料。', '这份记录正好能用上。'],
  technical: ['几行记录对上了，问题解开了。', '设备重新亮了起来。', '你找到了漏掉的那一步。'],
  route: ['拐角后面恰好空着。', '值班员认出了去接应区的路。', '门开了，你顺着通道走了过去。'],
};
const FAILURE_TEXT = {
  npc: ['话题越扯越远，你费了些心力才结束。', '对方没听清，来回解释耽搁了一阵。', '人群围了过来，这场对话没能谈下去。'],
  resource: ['资料已经发完，你白等了一阵。', '翻出的记录缺了关键几页。', '工作人员临时离开，这趟没拿到东西。'],
  technical: ['提示又跳了出来，排查没有进展。', '设备重启了，刚才的工夫白费了。', '记录对不上，只能先结束排查。'],
  route: ['转角仍在排队，你只好又绕回来。', '门后堆满箱子，你原路折返。', '值班员也不清楚，你多走了一段路。'],
};
const pick = (values, random) => values[Math.floor(random() * values.length)];
const successEffect = choice => choice.onSuccess || choice.success || {};

function storyChoice(event, choice) {
  const [label, text] = STORY_CHOICES[choice.key] || [choice.name, successEffect(choice).text];
  const success = { ...successEffect(choice), text };
  if (choice.key === 'cat-feed') success.story = { branch: 'shared_meal' };
  if (choice.key === 'talent-negotiate') {
    success.text = event.story.chapter === 1
      ? event.story.id === 'faculty_cat' ? '猫按下爪印，同意只旁听、不署名。' : '窗口写下约定：这次只补一轮材料。'
      : success.text;
  }
  const chapterIndex = event.story.chapter - 1;
  const failure = { text: STORY_FAILURES[event.story.id][chapterIndex],
    story: chapterIndex === 0 ? { branch: 'interrupted' } : { outcome: 'setback' } };
  return { label: choice.key === 'talent-negotiate' ? '聊聊约定' : label, success, failure };
}

/** Called only while creating a fresh encounter, never from a read-only view. */
export function prepareSurpriseEncounter(run, source, random) {
  if (run.encounterVersion !== 2 || !source || source.encounterVersion === 2) return source;
  const event = structuredClone(source);
  const ordinary = ORDINARY[event.id];
  event.encounterVersion = 2;
  event.prompt = event.story ? STORY_PROMPTS[event.story.id][event.story.chapter - 1]
    : ordinary?.[0] || '眼前有了一点动静。';
  if (event.story?.chapter === 2 && event.story.priorChoice?.includes('纸条')) event.prompt = '打印机旁还夹着你上次留下的纸条。';
  if (event.story?.chapter === 2 && event.story.priorChoice?.includes('未盖章')) event.prompt = '窗口重新亮灯，你的号码还在屏幕上。';
  if (event.story?.chapter === 2 && event.story.priorChoice?.includes('桌底')) event.prompt = '那串爪印又出现了，桌布轻轻动了一下。';
  event.text = event.prompt;
  // All ordinary responses are available without a fee. The exit stays separate;
  // the previous always-safe decline no longer dominates the story's choices.
  let responses = event.choices.filter(choice => choice.key !== 'story-decline');
  if (responses.length > 4) responses = [...responses.slice(0, 2), ...responses.slice(-2)];
  event.choices = responses.map((choice, index) => {
    const originalSuccess = successEffect(choice);
    const isEcho = choice.key === 'story-echo';
    const story = event.story ? storyChoice(event, choice) : null;
    // A purchased identity ability keeps its explicit fee and once-only safe
    // resolution. It is distinct from the ordinary, fee-free responses.
    if (choice.talentUse) return { key: choice.key, name: '联络（人脉1）', label: '联络（人脉1）',
      requiresTalent: choice.requiresTalent, talentUse: true, cost: { network: 1 },
      onSuccess: { ...(story?.success || originalSuccess), brief: '这次的合作边界说清了' } };
    const label = story?.label || (isEcho ? '提起那件旧事' : ordinary?.[1]?.[index]) || ['看看记录', '问问情况', '走近看看'][index % 3];
    // Favorability is shuffled independently of wording and position, so no
    // option is a stable "safe" answer. Skills still make a bounded difference.
    const check = { base: 50 + Math.floor(random() * 22), skill: choice.check?.skill || ({
      npc: 'expression', resource: 'research', technical: 'engineering', route: 'expression',
    })[event.type], perLevel: 1.5, cap: 10, riskFactor: 0.03,
      ...(choice.check?.gear ? { gear: choice.check.gear } : {}),
      ...(choice.check?.communication ? { communication: Math.min(5, choice.check.communication) } : {}) };
    const relief = 2 + Math.floor(random() * 5);
    const pressure = 4 + Math.floor(random() * 5);
    const strain = 1 + Math.floor(random() * 2);
    const success = story?.success || {
      text: pick(SUCCESS_TEXT[event.type] || SUCCESS_TEXT.npc, random),
      ...(originalSuccess.rewardId ? { rewardId: originalSuccess.rewardId } : {}),
      ...(originalSuccess.support ? { support: 8 } : {}),
      ...(originalSuccess.routeDepth != null ? { routeDepth: originalSuccess.routeDepth } : {}),
      ...(originalSuccess.networkDelta ? { networkDelta: Math.max(0, Math.min(1, originalSuccess.networkDelta)) } : {}),
      ...(originalSuccess.trustDelta ? { trustDelta: Math.max(0, Math.min(1, originalSuccess.trustDelta)) } : {}),
    };
    // Echoes carry the remembered relationship, not another chapter reward.
    if (isEcho) {
      success.text = originalSuccess.text.replace(/^你花时间/, '你');
      delete success.rewardId;
    }
    success.riskDelta = -relief;
    // A good ordinary conversation can make one usable contact. This is earned
    // on resolution, never a permanent penalty or a hidden fee on failure.
    if (event.type === 'npc' && !isEcho && random() < 0.35) success.networkDelta = 1;
    if (story) success.brief = event.story.chapter === 1
      ? ({ reviewer_printer: '打印机收起了这次的记录', stamp_maze: '窗口留下了新的回执', faculty_cat: '院长猫记住了这次相遇' })[event.story.id]
      : success.text.split(/[，。]/)[0];
    if (random() < 0.25) success.willDelta = 1;
    const failure = { ...(story?.failure || { text: pick(FAILURE_TEXT[event.type] || FAILURE_TEXT.npc, random) }),
      riskDelta: pressure, willDelta: -strain };
    return { key: choice.key, name: label, label, cost: {}, check,
      ...(choice.requiresTalent ? { requiresTalent: choice.requiresTalent, talentUse: choice.talentUse } : {}),
      ...(choice.xp === false ? { xp: false } : {}), onSuccess: success, onFailure: failure };
  });
  // Fisher–Yates at encounter creation, persisted with the active event.
  for (let index = event.choices.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [event.choices[index], event.choices[other]] = [event.choices[other], event.choices[index]];
  }
  return event;
}
