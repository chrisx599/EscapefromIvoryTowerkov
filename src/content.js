// Shared inventory items used by exploration, research and warehouse.
import { GEAR } from './loot-content.js';

const CORE_ITEMS = {
  // 数据
  unpublished: { id: 'unpublished', name: '未发表结果', cat: '数据', value: 30, weight: 1, risk: 0, desc: '一行关键的对比数字。还在你电脑里，也还在你脑子里。' },
  dataset: { id: 'dataset', name: 'AI 训练与评测数据包', cat: '数据', value: 25, weight: 1, risk: 0, desc: '已整理的训练样本与评测数据。带回后可以投入复现、微调或评测项目。' },
  preprint: { id: 'preprint', name: '预印本草稿', cat: '数据', value: 20, weight: 1, risk: 0, desc: '写到一半。摘要和结论都还是占位符。' },
  src_code: { id: 'src_code', name: '模型研究源码', cat: '数据', value: 45, weight: 1, risk: 3, desc: '附有访问限制的模型实现与实验脚本。可以投入复现或微调项目，携带时仍有风险。' },

  // 情报
  wind: { id: 'wind', name: '方向风向', cat: '情报', value: 15, weight: 0.5, risk: 0, desc: '「这个方向快做完了，明年开始大家都要转。」' },
  funding_tip: { id: 'funding_tip', name: '基金重点', cat: '情报', value: 22, weight: 0.5, risk: 0, desc: '评审组今年想看到的东西。写本子的人都在打听这个。' },
  inside: { id: 'inside', name: '内幕消息', cat: '情报', value: 35, weight: 0.5, risk: 1, desc: '「他明年要走了。」这种事应该不会有人告诉你。' },

  // 人脉
  card: { id: 'card', name: '一张名片', cat: '人脉', value: 8, weight: 0.2, risk: 0, desc: '印着别人的名字和一个你不会打的电话。' },
  wechat: { id: 'wechat', name: '大佬的微信', cat: '人脉', value: 60, weight: 0.1, risk: 0, desc: '扫了码，加上了。备注是他自己改的：「某某-某某大学」。' },
  coop: { id: 'coop', name: '合作意向', cat: '人脉', value: 45, weight: 1, risk: 0, desc: '「回去让你导师跟我联系。」——这句话值多少，取决于你导师接不接电话。' },
  promise: { id: 'promise', name: '口头承诺', cat: '人脉', value: 12, weight: 0, risk: 0, desc: '说过，但没写下来。你记得，他不一定。' },

  // 资源
  compute: { id: 'compute', name: '算力卡', cat: '资源', value: 50, weight: 1, risk: 0, desc: '一份可消耗的计算额度。基础实验消耗一张，进阶和前沿实验分别消耗两张、三张；需要对应计算设备。' },
  reagent: { id: 'reagent', name: '传感器试用套件', cat: '资源', value: 20, weight: 1, risk: 1, desc: '展商提供的机器人感知样品。可以保留或出售筹集研究经费。' },
  receipt: { id: 'receipt', name: '差旅报销单', cat: '资源', value: 30, weight: 0.5, risk: 2, desc: '空白报销单。你知道该怎么填，也知道被查到会怎样。' },
  coffee_ticket: { id: 'coffee_ticket', name: '咖啡券', cat: '保命', value: 5, weight: 0.1, risk: 0, desc: '会场发的。可以让人精神一点。', use: { will: 1, consumeInBag: true } },
  stomach_pill: { id: 'stomach_pill', name: '胃药', cat: '保命', value: 6, weight: 0.1, risk: 0, desc: '你带了，但一直在想什么时候才舍得吃。', use: { will: 1.5, consumeInBag: true } },
};

export const ITEMS = { ...CORE_ITEMS, ...GEAR };
