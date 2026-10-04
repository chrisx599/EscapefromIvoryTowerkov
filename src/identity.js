const SURNAMES = ['周', '林', '许', '沈', '赵', '顾', '章', '陆', '程', '叶', '秦', '何'];
const GIVEN = ['屿', '一鸣', '知远', '砚', 'времен', '禾', '沐', '行舟', '渠', '泠', '昭', '临'];
const SCHOOLS = [
  { name: '某 985', tier: '强', note: '牌子硬，但你在这个组里什么都不是。' },
  { name: '某 211', tier: '中', note: '不好不坏。简历上能写，饭桌上不好说。' },
  { name: '某双非一本', tier: '弱', note: '你自己不说，别人一般也不会问。' },
  { name: '某二本院校', tier: '弱', note: '实验室的服务器还是上一届师兄攒的。' },
];
const MAJORS = ['人工智能', '计算机', '数据科学', '自动化', '软件工程', '智能科学与技术', '机器人'];
const PERSONALITIES = [
  { id: 'i', name: 'i 人', note: '每次主动搭话，都要在开口前先在心里演练一遍。' },
  { id: 'e', name: 'e 人', note: '你能跟任何人聊起来，但聊完之后常常很累。' },
  { id: 'serious', name: '较真', note: '你很难对一句错的话保持沉默。' },
];

function nextRandom(state) {
  state.value = (state.value + 0x6D2B79F5) >>> 0;
  const t = state.value;
  let result = Math.imul(t ^ (t >>> 15), 1 | t);
  result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
  return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
}

function pick(state, values) {
  return values[Math.floor(nextRandom(state) * values.length)];
}

/** Generate the same deterministic player identity as the former run setup. */
export function createIdentity(seed = Date.now() >>> 0) {
  const state = { value: Number(seed) >>> 0 };
  return {
    name: pick(state, SURNAMES) + pick(state, GIVEN),
    school: pick(state, SCHOOLS),
    major: pick(state, MAJORS),
    trait: pick(state, PERSONALITIES),
  };
}
