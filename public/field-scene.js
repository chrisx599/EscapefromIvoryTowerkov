import { riskLabel } from './expedition-language.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SCENES = {
  arrival: ['/assets/generated/poster-board.png', '交流展示板'],
  exchange: ['/assets/generated/scholar.png', '交流中的研究者'],
  sidepath: ['/assets/generated/taxi.png', '出口接应'],
  lab: ['/assets/generated/research-desk.png', '演示终端'],
  checkpoint: ['/assets/generated/locker.png', '核查登记台'],
  archive: ['/assets/generated/locker.png', '资料储物柜'],
};
const EVENT_IMAGES = new Set(Object.values(SCENES).map(([src]) => src));
export function fieldSceneModel(current) {
  const expedition = current.expedition || {};
  const condition = expedition.condition || { id:'arrival', name:'初到现场', description:'先熟悉环境，再开始探索。' };
  const event = current.event;
  const loot = current.pendingLoot?.length > 0;
  const depth = ['靠近出口','已入内场','深入腹地'].indexOf(expedition.depthLabel);
  const danger = riskLabel(current.stats?.risk);
  const [sceneArt, sceneAlt] = SCENES[condition.id] || SCENES.arrival;
  return { condition, event, loot, depth: Math.max(0, depth), depthLabel: expedition.depthLabel || '靠近出口', danger,
    art: event && EVENT_IMAGES.has(event.image) ? event.image : sceneArt,
    artAlt: event ? event.title || event.name : sceneAlt,
    mood: event?.tone || (danger === '险峻' || danger === '紧张' ? 'danger' : 'calm'),
    cue: loot ? '先整理发现' : event ? '处理眼前状况' : '选择你的下一步',
    target: loot ? '发现待整理' : event ? event.title || event.name : '可以继续探索',
    effect: expedition.recentEffect || null,
  };
}
export function renderFieldScene(current, { scene, depth, status, next }) {
  const model = fieldSceneModel(current);
  scene.dataset.condition = model.condition.id;
  scene.dataset.mood = model.mood;
  scene.innerHTML = `<div class="scene-caption"><span>当前区域</span><strong>${escape(model.condition.name)}</strong><small>${escape(model.condition.description)}</small></div>
    <div class="scene-stage" aria-hidden="true"><div class="scene-ground"></div><div class="scene-player player-avatar"></div><span class="scene-you">你</span><img class="scene-object" src="${escape(model.art)}" alt=""><span class="scene-target">${escape(model.target)}</span></div>
    ${model.effect ? `<div class="scene-effect"><span>临时影响</span><b>${escape(model.effect.name)}</b><small>${escape(model.effect.description)}</small></div>` : ''}`;
  depth.dataset.depthLabel = model.depthLabel;
  depth.innerHTML = `<span class="depth-caption">深入程度</span><div class="depth-levels">${['靠近出口','已入内场','深入腹地'].map((label,index)=>`<span class="depth-level ${index === model.depth ? 'is-current' : ''}" ${index === model.depth ? 'aria-current="true"' : ''}>${label}</span>`).join('')}</div>`;
  const stats = current.stats || {};
  const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '0';
  const meter = (key,label,value,max) => {
    const used = Math.max(0,Number(value)||0), limit=Math.max(0,Number(max)||0);
    const fill = limit > 0 ? Math.min(100, used/limit*100) : 0;
    return `<div class="field-vital" data-vital="${key}"><div><span>${label}</span><b>${count(used)}<small> / ${count(limit)}</small></b></div><div class="vital-track" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${used}"><i style="width:${fill}%"></i></div></div>`;
  };
  status.innerHTML = meter('will','心力',stats.will,stats.willMax)+meter('bag','背包',current.bagUsed,current.bagCap)+`<div class="field-danger" data-danger="${escape(model.danger)}"><span>形势</span><b><i aria-hidden="true"></i>${escape(model.danger)}</b></div>`;
  next.innerHTML = `<span class="next-step-dot" aria-hidden="true">${model.event || model.loot ? '!' : '→'}</span><div><small>现在做什么</small><h2>${escape(model.cue)}</h2></div>`;
  return model;
}
