const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SCENES = {
  arrival: '/assets/generated/poster-board.png', exchange: '/assets/generated/scholar.png',
  sidepath: '/assets/generated/taxi.png', lab: '/assets/generated/research-desk.png',
  checkpoint: '/assets/generated/locker.png', archive: '/assets/generated/locker.png',
};
const EVENT_IMAGES = new Set(Object.values(SCENES));
export function fieldSceneModel(current) {
  const condition = current.expedition?.condition || { id: 'arrival', name: '初到现场' };
  return { condition, art: EVENT_IMAGES.has(current.event?.image) ? current.event.image : SCENES[condition.id] || SCENES.arrival,
    event: !!current.event, tired: Number(current.stats?.will) < Number(current.stats?.willMax) / 3 };
}
export function renderFieldScene(current, { scene, status }) {
  const model = fieldSceneModel(current);
  scene.dataset.condition = model.condition.id;
  scene.classList.toggle('has-encounter', model.event);
  scene.innerHTML = `<strong class="scene-place">${escape(model.condition.name)}</strong><div class="scene-floor" aria-hidden="true"></div><div class="scene-player player-avatar" aria-hidden="true"></div><img class="scene-object" src="${escape(model.art)}" alt="" aria-hidden="true">${model.event ? '<span class="scene-alert" aria-hidden="true">!</span>' : ''}`;
  const will = Math.max(0, Number(current.stats?.will) || 0), max = Math.max(1, Number(current.stats?.willMax) || 1);
  status.innerHTML = `<div class="raid-heart${model.tired ? ' is-low' : ''}" data-vital="will"><span aria-hidden="true">♥</span><progress max="${max}" value="${will}" aria-label="心力" aria-valuenow="${will}" aria-valuemax="${max}" aria-valuemin="0"></progress><b>${will}<small>/${max}</small></b></div>`;
  return model;
}
