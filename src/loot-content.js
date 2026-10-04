// Equipment and shop catalogue.

export const GEAR = {
  canvas_pack: {
    id: 'canvas_pack', name: '加厚学术帆布包', cat: '装备', value: 90, weight: 0.8, risk: 0,
    gear: true, rarity: 'common', slot: 'bag', bonus: { bagCap: 1 },
    desc: '会议赠品的升级版。肩带宽了一点，能多塞一份资料。',
  },
  foam_earplugs: {
    id: 'foam_earplugs', name: '降噪耳塞', cat: '装备', value: 65, weight: 0.1, risk: 0,
    gear: true, rarity: 'common', slot: 'focus', bonus: { searchWill: 0.05 },
    desc: '隔开会场杂音，每格搜索少消耗 0.05 心力。',
  },
  coffee_thermos: {
    id: 'coffee_thermos', name: '实验室保温杯', cat: '装备', value: 75, weight: 0.4, risk: 0,
    gear: true, rarity: 'common', slot: 'tool', bonus: { willMax: 0.5 },
    desc: '杯盖拧得很紧，额外提供 0.5 点心力上限。',
  },
  badge_wallet: {
    id: 'badge_wallet', name: '证件收纳夹', cat: '装备', value: 85, weight: 0.2, risk: 0,
    gear: true, rarity: 'common', slot: 'bag', bonus: { bagCap: 0.5 },
    desc: '把名片、房卡和会议证分开收好，背包容量增加 0.5。',
  },
  noise_headphones: {
    id: 'noise_headphones', name: '降噪耳机', cat: '装备', value: 160, weight: 0.4, risk: 0,
    gear: true, rarity: 'uncommon', slot: 'focus', bonus: { searchWill: 0.1 },
    desc: '耳罩隔开人群声，每格搜索少消耗 0.1 心力。',
  },
  field_recorder: {
    id: 'field_recorder', name: '便携记录仪', cat: '装备', value: 180, weight: 0.5, risk: 0,
    gear: true, rarity: 'uncommon', slot: 'tool', bonus: { willMax: 1 },
    desc: '能把讲座要点录清楚，额外提供 1 点心力上限。',
  },
  padded_case: {
    id: 'padded_case', name: '加厚仪器收纳包', cat: '装备', value: 190, weight: 0.7, risk: 0,
    gear: true, rarity: 'uncommon', slot: 'bag', bonus: { bagCap: 1.5 },
    desc: '夹层结实，装几份打印稿和小设备都不怕压坏，容量增加 1.5。',
  },
  citation_scanner: {
    id: 'citation_scanner', name: '文献扫描笔', cat: '装备', value: 300, weight: 0.3, risk: 0,
    gear: true, rarity: 'rare', slot: 'tool', bonus: { searchWill: 0.15 },
    desc: '扫过纸面就能存下引文和页码，每格搜索少消耗 0.15 心力。',
  },
  digital_notebook: {
    id: 'digital_notebook', name: '电子实验记录本', cat: '装备', value: 340, weight: 0.5, risk: 0,
    gear: true, rarity: 'rare', slot: 'focus', bonus: { willMax: 1, searchWill: 0.1 },
    desc: '会议笔记、实验记录和待办事项都能放在一处，心力上限 +1，每格搜索少消耗 0.1。',
  },
  custom_lab_pack: {
    id: 'custom_lab_pack', name: '课题组定制登山包', cat: '装备', value: 520, weight: 1, risk: 0,
    gear: true, rarity: 'epic', slot: 'bag', bonus: { bagCap: 3, willMax: 1 },
    desc: '师兄留下的耐用背包，容量 +3、心力上限 +1。',
  },
  lightweight_laptop: {
    id: 'lightweight_laptop', name: '轻薄研究本', cat: '装备', value: 90, weight: 0.8, risk: 0,
    gear: true, rarity: 'common', slot: 'device', bonus: { computeCapacity: 1 },
    desc: '连接基础计算环境，支持复现与评测；运行实验仍需消耗算力卡。',
  },
  gpu_workstation: {
    id: 'gpu_workstation', name: 'GPU 工作站终端', cat: '装备', value: 160, weight: 1, risk: 0,
    gear: true, rarity: 'uncommon', slot: 'device', minStage: 1, bonus: { computeCapacity: 2, experiment: 2 },
    desc: '硕士阶段解锁。二级实验能力，可以运行微调，实验质量 +2。',
  },
  remote_terminal: {
    id: 'remote_terminal', name: '集群远程终端', cat: '装备', value: 300, weight: 0.6, risk: 0,
    gear: true, rarity: 'rare', slot: 'device', minStage: 3, bonus: { computeCapacity: 3, experiment: 4 },
    desc: '博士后阶段解锁。三级实验能力，支持前沿课题，实验质量 +4。',
  },
  literature_assistant: {
    id: 'literature_assistant', name: '文献助手终端', cat: '装备', value: 130, weight: 0.3, risk: 0,
    gear: true, rarity: 'uncommon', slot: 'focus', bonus: { literature: 8, searchWill: 0.1 },
    desc: '创建项目时初始质量 +8，每格搜索节省 0.1 心力。',
  },
  experiment_tracker: {
    id: 'experiment_tracker', name: '实验追踪器', cat: '装备', value: 160, weight: 0.3, risk: 0,
    gear: true, rarity: 'uncommon', slot: 'tool', bonus: { experiment: 5 },
    desc: '保存参数与实验日志，每轮实验质量 +5。',
  },
  data_cleaner: {
    id: 'data_cleaner', name: '数据清洗工具', cat: '装备', value: 250, weight: 0.3, risk: 0,
    gear: true, rarity: 'rare', slot: 'tool', minStage: 2, bonus: { experiment: 8 },
    desc: '博士阶段解锁。清理重复和异常样本，每轮实验质量 +8。',
  },
  portable_ssd: {
    id: 'portable_ssd', name: '移动数据盘', cat: '装备', value: 100, weight: 0.2, risk: 0,
    gear: true, rarity: 'uncommon', slot: 'storage', bonus: { bagCap: 1 },
    desc: '额外提供 1 点携带容量，适合收集更多研究材料。',
  },
  encrypted_ssd: {
    id: 'encrypted_ssd', name: '加密 SSD', cat: '装备', value: 180, weight: 0.2, risk: 0,
    gear: true, rarity: 'rare', slot: 'storage', bonus: { bagCap: 0.5, riskReduction: 0.06 },
    desc: '携带容量 +0.5，撤离风险检查概率降低 6 个百分点。',
  },
  backup_device: {
    id: 'backup_device', name: '研究备份设备', cat: '装备', value: 200, weight: 0.3, risk: 0,
    gear: true, rarity: 'rare', slot: 'storage', bonus: { backup: 1 },
    desc: '指定保护一份研究材料；无论完整、部分或失败撤离，保护材料都会保留。',
  },
};

// Career mode can import this catalogue without depending on the simulation engine.
export const SHOP_ITEMS = Object.values(GEAR).map((item) => ({
  id: item.id,
  price: Math.max(120, item.value * 5),
}));
