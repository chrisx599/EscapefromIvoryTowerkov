// Shared, deterministic identity definitions. Rank follows earned career stage;
// a save cannot buy a stronger identity by storing a larger rank value.
export const CAREER_TALENTS = {
  archivist: {
    id: 'archivist', name: '档案派', description: '先把关键证据留住，再从已有资料里找到起点。',
    activeName: '封存关键材料',
    activeDescription: '每次远征可封存背包中的一件研究材料；任何撤离结果都能保留，与备份设备可各保护一件。',
    researchDescription: '新课题的初始质量随专长等级提高。',
  },
  connector: {
    id: 'connector', name: '联络派', description: '说清合作边界，让一次偶遇变成可以延续的合作。',
    activeName: '约定合作边界',
    activeDescription: '每次远征可消耗 1 点人脉，稳妥解决一次人物交涉；奇遇中的协商会留下对应后续。',
    researchDescription: '每篇录用论文获得额外支持经费。',
  },
  tinkerer: {
    id: 'tinkerer', name: '巧匠派', description: '设备未必趁手，但总能让有限材料多派上点用场。',
    activeName: '临时算力改装',
    activeDescription: '每次远征可消耗一份数据、源码或方向情报，改装成一张算力卡。',
    researchDescription: '每轮实验的质量增长获得稳定加成。',
  },
};

export function talentRankForStage(stage) {
  const value = Number(stage);
  if (!Number.isFinite(value) || value < 1) return 0;
  return value >= 6 ? 3 : value >= 3 ? 2 : 1;
}

export function normalizeCareerTalent(value, stage) {
  const id = typeof value === 'string' ? value : value?.id;
  const rank = talentRankForStage(stage);
  return rank && Object.hasOwn(CAREER_TALENTS, id) ? { id, rank } : null;
}

export function careerTalentBenefits(talent) {
  const id = talent?.id;
  if (!Object.hasOwn(CAREER_TALENTS, id)) return null;
  const rank = Math.max(1, Math.min(3, Math.floor(Number(talent.rank) || 1)));
  return {
    initialQuality: id === 'archivist' ? 3 * rank : 0,
    publicationGrant: id === 'connector' ? 10 * rank : 0,
    experimentQuality: id === 'tinkerer' ? rank : 0,
  };
}
