// Original two-act campus stories. Persist only canonical choices, never supplied
// reward numbers or prose. Factories and views are pure; the raid owns seeded RNG.
const DEFINITIONS = {
  reviewer_printer: {
    title: '审稿打印机觉醒', type: 'technical', name: '审稿人二号打印机',
    image: '/assets/generated/research-desk.png',
    branches: { evidence: '交出了真实样本', rebuttal: '写了有礼貌的反驳', interrupted: '打印机卡住了，你留下了待核对的纸条' },
    outcomes: { reproducible: '打印机学会了复现', boundaries: '拒稿意见终于有了边界',
      rebuttal_win: '打印机撤回了无限实验要求', rebuttal_loss: '机器坚持大修，你保住了结论边界', setback: '打印机又卡纸了，这次没有拿到资料', declined: '你拒绝为打印机无限加班' },
  },
  stamp_maze: {
    title: '公章证明它自己', type: 'route', name: '会务处自助盖章机',
    image: '/assets/generated/poster-board.png',
    branches: { record: '留下了可追溯的盖章存根', sponsor: '请熟人替你作了担保', negotiated: '约定了只补一轮材料', interrupted: '窗口暂时关了，你留着一张未盖章的号码纸' },
    outcomes: { filed: '循环证明被装订成了有限页', shortcut: '你带着样本走了人工窗口', repaid: '你还清了这一笔人情',
      negotiated: '窗口遵守了事先约定', setback: '窗口提前关了，这次没有办成', declined: '你退出了公章的自我证明' },
  },
  faculty_cat: {
    title: '院长猫的署名要求', type: 'npc', name: '院长猫',
    image: '/assets/generated/scholar.png',
    branches: { fed: '用咖啡券换了猫粮', shared_meal: '帮志愿者摆好了猫粮', respected: '给猫留了一把空椅子', negotiated: '约定猫只旁听、不署名', interrupted: '猫躲进了桌底，只留下一串爪印' },
    outcomes: { side_door: '猫带你走了无须答辩的侧门', acknowledged: '猫被写进了致谢',
      honest: '你没有让猫替实验背书', negotiated: '猫履行了旁听协议', setback: '猫叼着材料跑远了，你没能追上', declined: '你婉拒了猫的行政任命' },
  },
};
export const ACADEMIC_STORY_IDS = Object.freeze(Object.keys(DEFINITIONS));
const owns = (obj, key) => !!obj && Object.hasOwn(obj, key);
const validId = (value, dictionary) => typeof value === 'string' && owns(dictionary, value);

export function normalizeStories(value) {
  const chains = {};
  for (const id of ACADEMIC_STORY_IDS) {
    const raw = value?.chains?.[id];
    const definition = DEFINITIONS[id];
    const branch = validId(raw?.branch, definition.branches) ? raw.branch : null;
    const outcome = validId(raw?.outcome, definition.outcomes) ? raw.outcome : null;
    const chapter = raw?.chapter === 2 && outcome ? 2 : raw?.chapter === 1 && branch ? 1 : 0;
    chains[id] = { chapter, branch: chapter ? branch : null, outcome: chapter === 2 ? outcome : null };
  }
  return { version: 1, chains };
}

export function academicStoriesEnabled(run) {
  return run?.storyEnabled === true && !!run.stories;
}

export function storyResolutionAllowed(run, event) {
  if (!event?.story) return true;
  if (!academicStoriesEnabled(run) || !ACADEMIC_STORY_IDS.includes(event.story.id)) return false;
  const state = normalizeStories(run.stories).chains[event.story.id];
  return state.chapter === event.story.chapter - 1;
}

export function recordAcademicStory(run, event, choice, success) {
  if (!event?.story || !storyResolutionAllowed(run, event) || choice.exit) return;
  const effect = success ? choice.onSuccess : choice.onFailure;
  if (!effect?.story) return;
  const stories = normalizeStories(run.stories);
  const state = stories.chains[event.story.id];
  if (effect.story.branch) state.branch = effect.story.branch;
  if (effect.story.outcome) {
    state.chapter = 2;
    state.outcome = effect.story.outcome;
  } else state.chapter = 1;
  run.stories = normalizeStories(stories);
}

function decline(id) {
  return { key: 'story-decline', name: '婉拒这桩差事，继续自己的探索', skipMomentum: true, xp: false,
    onSuccess: { text: `${DEFINITIONS[id].outcomes.declined}。这条奇遇到此结束，不消耗资源，也没有奖励。`, story: { outcome: 'declined' } } };
}
function setupChoice(key, name, branch, cost, text, other = {}) {
  return { key, name, cost, ...other, onSuccess: { ...other.onSuccess, text, story: { branch } } };
}
function finalChoice(key, name, outcome, effect, other = {}) {
  return { key, name, ...other, onSuccess: { ...effect, story: { outcome } } };
}
function negotiation(branch, text, outcome = null, effect = {}) {
  return { key: 'talent-negotiate', name: '联络派：先把合作边界说清', requiresTalent: 'connector', talentUse: true,
    cost: { network: 1 }, onSuccess: { riskDelta: -4, ...effect, text,
      story: outcome ? { outcome } : { branch } } };
}

function reviewerChapter(chapter, branch) {
  if (chapter === 1) return {
    title: '打印机要求你补做「没有打印机」的消融实验',
    text: '会场打印机忽然自称审稿人二号。它吐出一张大修通知：「请证明，把本文从世界上移除以后，世界仍然存在。」你可以给它证据，也可以先约束问题。',
    choices: [
      setupChoice('printer-evidence', '交一份真实样本，让它先学会复现', 'evidence', { items: { dataset: 1 } },
        '打印机吞下样本，承诺稍后交还一份可复现记录。你失去这份数据，换来一条讲证据的后续。', { requires: { dataset: 1 }, onSuccess: { riskDelta: -2 } }),
      setupChoice('printer-rebuttal', '花心力写一封「感谢审稿人」', 'rebuttal', { will: 1 },
        '你写道：「感谢这个重要问题，但它超出了本文范围。」打印机开始研读礼貌，下一轮会追问你的结论边界。', { onSuccess: { riskDelta: 3 } }),
      decline('reviewer_printer'),
    ],
  };
  if (branch === 'evidence') return {
    title: '打印机把你给的样本跑通了',
    text: '你之前交出的真实样本没有白费。打印机兴奋地吐出日志：「原来结果是要跑出来的！」它愿意交还源码，但要求你核对一次；也可以只把正确的验证边界带走。',
    choices: [
      finalChoice('printer-reproduce', '核对日志，收下复现源码', 'reproducible', { riskDelta: -6, support: 8, rewardId: 'src_code', text: '你核对了日志。打印机正式撤回「证明世界存在」的要求，交出一份源码。' }, { cost: { will: 1 } }),
      finalChoice('printer-boundary', '不加实验，把验证边界带走', 'boundaries', { riskDelta: -3, rewardId: 'wind', text: '你没有继续加班，只带走经过说明的研究方向。打印机第一次把「未来工作」留给了未来。' }),
      decline('reviewer_printer'),
    ],
  };
  return {
    title: '打印机学会了礼貌，但还没学会停止',
    text: '打印机记住了你的反驳信，连吐三十页「感谢作者」。它仍想追加实验，你可以明确承认论文局限，或花心力据理力争，争取那份源码。',
    choices: [
      finalChoice('printer-limit', '明确局限，带走一条可靠线索', 'boundaries', { riskDelta: -5, rewardId: 'wind', text: '你把结论缩回证据范围。打印机终于接受「不知道」也可以写进论文。' }, { cost: { will: 1 } }),
      finalChoice('printer-appeal', '据理力争，要求撤回追加实验', 'rebuttal_win', { riskDelta: -6, rewardId: 'src_code', text: '申诉奏效，打印机退回无限实验清单，还交出了自己的实现。' }, {
        cost: { will: 1 }, check: { base: 60, skill: 'expression', perLevel: 5, cap: 25, riskFactor: 0.03 },
        onFailure: { riskDelta: 6, text: '打印机坚持大修。你结束申诉，没有拿到源码，也没有承诺无限加班。', story: { outcome: 'rebuttal_loss' } },
      }),
      decline('reviewer_printer'),
    ],
  };
}

function stampChapter(chapter, branch, talent) {
  if (chapter === 1) return {
    title: '请先证明这枚公章有资格证明你',
    text: '自助盖章机拒绝盖章：「缺少一份证明本机可以出具证明的证明。」窗口正在把循环打印成实体。你可以留存证据，也可以请熟人帮忙收口。',
    choices: [
      setupChoice('stamp-record', '花心力留下每个窗口的存根', 'record', { will: 1 }, '你把循环流程逐页编号。稍后可以拿存根要求结案，也可能选择人工窗口。', { onSuccess: { riskDelta: 1 } }),
      setupChoice('stamp-sponsor', '消耗人脉，请熟人担保这枚章', 'sponsor', { network: 1 }, '熟人替公章作了担保，机器终于放行。代价是稍后要帮对方处理一件小事。', { onSuccess: { riskDelta: -2 } }),
      ...(talent === 'connector' ? [negotiation('negotiated', '你用一笔人情换来明确约定：只补一轮材料，不允许无限加章。窗口把约定写进了回执。')] : []),
      decline('stamp_maze'),
    ],
  };
  if (branch === 'record') return {
    title: '公章来抽查自己的出生证明',
    text: '盖章机追了上来，要求你补交「已提交补充材料的证明」。幸好你之前留下了存根。花心力装订可以彻底结案；人工窗口也肯给一份样本，但会把你记进临时核查名单。',
    choices: [
      finalChoice('stamp-file', '装订存根，把循环流程结案', 'filed', { riskDelta: -6, support: 8, rewardId: 'wind', text: '存根连成完整链条，公章终于没有下一页可盖。你拿到了方向线索和返程通行说明。' }, { cost: { will: 1 } }),
      finalChoice('stamp-window', '走人工窗口拿样本，接受后续核查', 'shortcut', { riskDelta: 7, rewardId: 'dataset', text: '人工窗口递出样本，也把你的名字列入核查名单。这份收获会让本次返程更紧张。' }),
      decline('stamp_maze'),
    ],
  };
  if (branch === 'negotiated') return {
    title: '盖章机试图追加第二轮材料',
    text: '机器又伸出一个新表格，但你翻出了先前约定的「只补一轮」。它的进纸口犹豫了。现在只需核对回执，或者就此终止流程。',
    choices: [
      finalChoice('stamp-honor-boundary', '核对约定，领取样本和通行说明', 'negotiated', { riskDelta: -5, support: 8, rewardId: 'dataset', text: '窗口遵守了约定。你只补了一轮材料，就领到了样本，流程没有重新长出来。' }, { cost: { will: 1 } }),
      finalChoice('stamp-close-boundary', '按约定终止流程，节省心力', 'negotiated', { riskDelta: -5, text: '你引用终止条款，机器收回了新表格。没有额外样本，但也没有新的义务。' }),
      decline('stamp_maze'),
    ],
  };
  return {
    title: '担保公章的熟人来请你帮忙了',
    text: '先前替你担保的熟人抱着一摞空白回执出现：「既然公章认得你，能帮我把它们排个序吗？」你的人情没有消失，而是变成了一项明确、有限的小任务。',
    choices: [
      finalChoice('stamp-repay', '花心力整理回执，还清人情', 'repaid', { riskDelta: -3, rewardId: 'coop', text: '你整理好回执，双方确认这笔人情已经还清。熟人留下了一份真正有边界的合作意向。' }, { cost: { will: 1 } }),
      finalChoice('stamp-repay-intel', '交出一条方向情报，换对方自行处理', 'repaid', { riskDelta: -4, support: 8, text: '对方收下线索，同意自行处理回执，并替你说明了出口登记。人情债到此结清。' }, { requires: { wind: 1 }, cost: { items: { wind: 1 } } }),
      decline('stamp_maze'),
    ],
  };
}

function catChapter(chapter, branch, talent) {
  if (chapter === 1) return {
    title: '院长猫宣布空椅子也要考核',
    text: '一只戴着会务绳的猫占据了评审席。它拍了拍空碗，又拍了拍你的署名栏。你可以用咖啡券向食堂换猫粮，或者先给它一个不用承担科研责任的位置。',
    choices: [
      setupChoice('cat-feed', '用一张咖啡券换猫粮', 'fed', { items: { coffee_ticket: 1 } }, '食堂收下咖啡券，给了你一份合适的猫粮。院长猫吃完，把一张侧门路线图压在爪下。你少了一次恢复心力的机会。', { requires: { coffee_ticket: 1 }, onSuccess: { riskDelta: -2 } }),
      setupChoice('cat-chair', '花心力给猫安排旁听席', 'respected', { will: 1 }, '你为猫腾出一把椅子，没有许诺署名。它似乎认可这份尊重，决定之后检查一下你的致谢。'),
      ...(talent === 'connector' ? [negotiation('negotiated', '你认真跟猫约定：可以旁听，也可以拿致谢，但不当论文作者。猫在空白处按了一枚爪印。')] : []),
      decline('faculty_cat'),
    ],
  };
  if (branch === 'fed' || branch === 'shared_meal') return {
    title: '吃过猫粮的院长来兑现路线图',
    text: `院长猫认出了${branch === 'shared_meal' ? '帮它摆好猫粮' : '给它换猫粮'}的人，用尾巴指向侧门，又按住一份数据样例。跟它离开可以把返程路走短；帮它整理样例则能带回材料，却要多花心力。`,
    choices: [
      finalChoice('cat-side-door', '跟猫走侧门，放弃它爪下的样例', 'side_door', { riskDelta: -8, support: 8, routeDepth: 0, text: '猫刷脸打开侧门。你回到靠近出口的位置，返程更稳妥；它爪下的样例留在了会场。' }),
      finalChoice('cat-sort-samples', '整理爪印样例，把猫写进致谢', 'acknowledged', { riskDelta: -2, rewardId: 'dataset', text: '样例整理完成。你把猫写进致谢，带走了可用的数据，没有给它虚假的作者身份。' }, { cost: { will: 1 } }),
      decline('faculty_cat'),
    ],
  };
  if (branch === 'negotiated') return {
    title: '猫带着先前的旁听协议回来了',
    text: '有人想把院长猫挂成共同一作，猫却把你们写过的旁听协议推了过去。边界已经说清，现在可以让它引路，也可以接受它带来的合作线索。',
    choices: [
      finalChoice('cat-honor-route', '请猫履行引路约定', 'negotiated', { riskDelta: -7, support: 8, routeDepth: 0, text: '猫履行了协议，带你回到靠近出口的位置。没有新署名，也没有新的人情债。' }),
      finalChoice('cat-honor-contact', '整理它带来的合作线索', 'negotiated', { rewardId: 'coop', riskDelta: -2, text: '你核对了合作边界，接过一份合作意向。猫继续旁听，没有被挂到论文上。' }, { cost: { will: 1 } }),
      decline('faculty_cat'),
    ],
  };
  return {
    title: '坐过旁听席的猫来核查致谢',
    text: '院长猫记得你给它留过椅子。它拖来一份致谢模板，模板竟把它写成了「负责全部实验」。你可以花心力改成真实贡献，或者直接说明没有它的实验结果。',
    choices: [
      finalChoice('cat-acknowledge', '据实改写致谢，收下合作线索', 'acknowledged', { riskDelta: -3, rewardId: 'coop', text: '你写下「感谢院长猫维持会场秩序」。猫似乎很满意，留下了一份合作线索。' }, { cost: { will: 1 } }),
      finalChoice('cat-honest', '说明猫没有做实验，请它继续旁听', 'honest', { riskDelta: -5, text: '你没有给猫编造贡献。它把模板团成纸球，继续安静旁听，本次探索少了一件麻烦。' }),
      decline('faculty_cat'),
    ],
  };
}

// A setback in the first encounter is remembered as unfinished business, never
// as a favor that succeeded. These callbacks also work across saved expeditions.
function interruptedChapter(id) {
  const content = {
    reviewer_printer: { title: '打印机又吐出那张纸条', text: '打印机旁边放着你上次留下的纸条。', choices: [
      finalChoice('printer-retry', '看看纸条', 'reproducible', { rewardId: 'src_code', text: '你找到了卡纸处，打印机交出了复现源码。' }),
      finalChoice('printer-discuss', '敲敲机盖', 'boundaries', { rewardId: 'wind', text: '纸条写清了验证边界，你带走一条线索。' }),
    ] },
    stamp_maze: { title: '未盖章的号码纸', text: '窗口重新亮灯，你的号码还在屏幕上。', choices: [
      finalChoice('stamp-return', '递上号码纸', 'filed', { rewardId: 'wind', text: '窗口装订好记录，交来通行说明。' }),
      finalChoice('stamp-inquire', '问问窗口', 'shortcut', { rewardId: 'dataset', text: '工作人员翻出一份留给你的公开样本。' }),
    ] },
    faculty_cat: { title: '桌底传来猫叫', text: '那串爪印又出现了，桌布轻轻动了一下。', choices: [
      finalChoice('cat-look-under', '掀起桌布', 'acknowledged', { rewardId: 'dataset', text: '你整理好猫拨来的样本，把它写进了致谢。' }),
      finalChoice('cat-wait-near', '蹲在桌边', 'honest', { rewardId: 'wind', text: '猫从桌底拖出一张写着研究方向的纸。' }),
    ] },
  };
  return content[id];
}

export function academicStoryCandidates(run) {
  if (!academicStoriesEnabled(run)) return [];
  const stories = normalizeStories(run.stories);
  const selected = run.storyRun?.id;
  // A pending callback can cross expedition boundaries. Only one chain occupies
  // this expedition; after it concludes, the ordinary event deck takes over.
  let ids = selected && ACADEMIC_STORY_IDS.includes(selected) ? [selected]
    : ACADEMIC_STORY_IDS.filter(id => stories.chains[id].chapter === 1);
  if (!ids.length && !selected) ids = ACADEMIC_STORY_IDS.filter(id => stories.chains[id].chapter === 0);
  return ids.filter(id => stories.chains[id].chapter < 2).map(id => {
    const state = stories.chains[id];
    const definition = DEFINITIONS[id];
    const chapter = state.chapter + 1;
    const talent = typeof run.talent === 'string' ? run.talent : run.talent?.id;
    const content = chapter === 2 && state.branch === 'interrupted' ? interruptedChapter(id)
      : id === 'reviewer_printer' ? reviewerChapter(chapter, state.branch)
      : id === 'stamp_maze' ? stampChapter(chapter, state.branch, talent)
        : catChapter(chapter, state.branch, talent);
    return { id: `story-${id}-${chapter}`, name: definition.name, type: definition.type,
      tone: 'opportunity', image: definition.image, difficulty: 0, ...content,
      story: { id, chapter, title: definition.title, priorChoice: definition.branches[state.branch] || null } };
  }).filter(event => !(run.usedEventIds || []).includes(event.id));
}

export function academicStoryWeight(run, event) {
  let weight = 1;
  const id = event.story.id;
  if (id === 'reviewer_printer' && (run.venueId === 'industry' || run.expedition?.conditionId === 'lab')) weight += 4;
  if (id === 'stamp_maze' && (run.venueId === 'visit' || run.expedition?.conditionId === 'checkpoint')) weight += 3;
  if (id === 'faculty_cat' && run.venueId === 'conference') weight += 1;
  if (id === 'reviewer_printer' && (run.bag || []).includes('dataset')) weight += 1;
  if (id === 'faculty_cat' && (run.bag || []).includes('coffee_ticket')) weight += 2;
  return weight;
}

export function academicStoryCallbackReady(run) {
  return academicStoryCandidates(run).some(event => event.story.chapter === 2);
}

export function storyJournal(value) {
  const stories = normalizeStories(value);
  const chapters = ACADEMIC_STORY_IDS.map(id => {
    const state = stories.chains[id];
    const definition = DEFINITIONS[id];
    return { id, title: definition.title, chapter: state.chapter,
      status: state.chapter === 2 ? '已结局' : state.chapter === 1 ? '待续' : '未遇见',
      state: state.chapter === 2 ? 'finished' : state.chapter === 1 ? 'pending' : 'unseen',
      summary: definition.outcomes[state.outcome] || definition.branches[state.branch] || '尚未遇见这桩奇遇',
      priorChoice: definition.branches[state.branch] || null,
      outcome: definition.outcomes[state.outcome] || null };
  });
  return { chapters, completed: chapters.filter(row => row.chapter === 2).length };
}

export function academicStoriesView(run) {
  const { chapters, completed } = storyJournal(run?.stories);
  const current = run?.event?.story ? chapters.find(row => row.id === run.event.story.id)
    : chapters.find(row => row.id === run?.storyRun?.id) || chapters.find(row => row.chapter === 1) || null;
  const recent = current && current.chapter > (run?.storyRun?.initialChapter ?? current.chapter)
    ? [{ title: current.title, text: current.outcome || current.priorChoice,
      next: current.chapter === 1 ? '继续探索会遇到后续；现在撤离，也能在下次远征续上。' : '这条奇遇已结束，选择和结局会被保留。' }] : [];
  return { recent, enabled: academicStoriesEnabled(run), current, chapters, completed,
    summary: current ? current.outcome || `${current.title}：${current.priorChoice || '第一幕'}，后续会记住这次选择。`
      : completed === ACADEMIC_STORY_IDS.length ? '三桩校园奇遇已经落幕；现场仍有新的普通事件。' : '校园里有三桩怪事。你的选择会在后续探索中得到回应。' };
}

// Endings keep mattering after all three stories finish. A familiar option costs
// time or a material and never grants another copy of a story's unique reward.
export function withAcademicStoryEcho(run, event) {
  if (!academicStoriesEnabled(run) || event.story) return event;
  const states = normalizeStories(run.stories).chains;
  const printer = states.reviewer_printer;
  const stamp = states.stamp_maze;
  const cat = states.faculty_cat;
  let echo;
  let choice;
  if (event.type === 'technical' && printer.chapter === 2 && !['declined', 'setback'].includes(printer.outcome)) {
    const hasMethod = printer.outcome === 'reproducible' || printer.outcome === 'rebuttal_win';
    echo = hasMethod ? '审稿打印机留下的复现规程，这次正好派上用场。' : '你记得那台打印机：先明确问题边界，再决定要不要返工。';
    choice = { key: 'story-echo', name: hasMethod ? '按打印机的复现规程处理' : '按旧约定隔离问题，不无限返工',
      cost: { will: 1 }, ...(hasMethod ? { requires: { src_code: 1 } } : {}),
      onSuccess: { riskDelta: hasMethod ? -7 : -3, text: hasMethod ? '你用留存的规程核对源码，问题稳定解决。打印机这次没有再吐出大修通知。' : '你隔离了有问题的部分，把工作限制在可验证的范围。' } };
  } else if (event.type === 'route' && stamp.chapter === 2 && !['declined', 'setback'].includes(stamp.outcome)) {
    const shortcut = stamp.outcome === 'shortcut';
    echo = shortcut ? '人工窗口还记得你，这次需要补一份可核验的线索。' : '先前结束的公章流程留下了有效回执。';
    choice = { key: 'story-echo', name: shortcut ? '交一条线索，补完人工窗口核查' : '出示旧回执，按有限流程通行',
      cost: shortcut ? { items: { wind: 1 } } : { will: 1 },
      onSuccess: { riskDelta: -5, support: 8, text: shortcut ? '人工窗口核对了线索，登记顺利结束。' : '工作人员核对旧回执，没有再要求你证明公章的资格。' } };
  } else if (cat.chapter === 2 && !['declined', 'setback'].includes(cat.outcome) && (event.type === 'npc' || event.type === 'route')) {
    const route = event.type === 'route' && ['side_door', 'negotiated'].includes(cat.outcome);
    echo = route ? '院长猫留下的侧门路线仍然可用。' : '你和院长猫说清贡献边界的事，已经成了会场里的一个小故事。';
    choice = { key: 'story-echo', name: route ? '沿院长猫的旧路线回到出口旁' : '讲清院长猫的真实贡献，重谈边界',
      cost: { will: 1 }, onSuccess: { riskDelta: -4, ...(route ? { routeDepth: 0 } : {}),
        text: route ? '你花时间绕回熟悉的侧门，重新靠近出口。' : '你引用猫的例子，把这次交流的要求说到了能兑现的范围内。' } };
  }
  return choice ? { ...event, storyEcho: echo, text: `${event.text} ${echo}`, choices: [...event.choices, choice] } : event;
}
