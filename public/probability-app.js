import { itemIconHtml } from './item-art.js';
import { likelihoodLabel, riskLabel } from './expedition-language.js';
import { renderFieldScene } from './field-scene.js';
import { renderResearchWorkbench } from './research-workbench.js';
import { renderStoryEntries } from './career-journey.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => plainOutcome(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
const attr = value => esc(value).replace(/'/g, '&#39;');
const number = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—';
const scrollBehavior = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
const SLOT_LABELS = { bag: '背包', focus: '专注设备', tool: '研究工具', device: '计算设备', storage: '存储设备' };
const VENUE_SCENE_ART = {
  conference: ['/assets/generated/poster-board.png', '学术交流展示板'],
  visit: ['/assets/generated/locker.png', '实验室储物柜'],
  industry: ['/assets/generated/research-desk.png', '企业研发工位'],
};
const EVENT_ART = new Set(['scholar', 'research-desk', 'locker', 'poster-board', 'taxi'].map(name => '/assets/generated/' + name + '.png'));
const MATERIAL_LABELS = { dataset: '数据', src_code: '源码', compute: '算力', wind: '情报' };
let hub = null, view = null, phase = 'loading', pending = false, uncertainMutation = false;
let busyRequests = 0;
let uncertainRequest = null;
const MUTATION_PATHS = new Set(['/api/new', '/api/hub/action', '/api/hub/return', '/api/expedition/action']);
// Keep storage keys stable across title changes so pending requests and navigation survive.
try {
  const saved = JSON.parse(sessionStorage.getItem('xuefa-pending-request') || 'null');
  if (MUTATION_PATHS.has(saved?.path) && typeof saved?.body?.requestId === 'string') {
    uncertainRequest = saved;
    uncertainMutation = true;
  }
} catch { /* In-memory retry protection remains available without storage. */ }
let setupSelection = { venue: '', difficulty: '' };
let renderedRaidId = null;
let requestSequence = 0;
const WORKSPACES = {
  prepare: { title: '出发准备', description: '选地点和难度、配好装备，再开始探索。' },
  research: { title: '研究与晋升', description: '把带回的材料投入课题，完成实验与论文。' },
  inventory: { title: '材料仓库', description: '保留课题需要的材料，整理补给和多余收获。' },
  shop: { title: '补给商店', description: '补齐材料与算力，为下一次远征升级设备。' },
  records: { title: '生涯档案', description: '回顾远征收获与已经完成的研究。' },
};
let activeWorkspace = 'prepare';
let renderedGamePhase = null;
const itemZones = new Map();
const selectedItems = new Map();
let stashSort = false, stashBatch = false, shopCategory = "all";
const batchItems = new Set();
const categoryOf = item => item.slot ? "equipment" : item.use ? "supplies" : "materials";
const QUALITY_NAMES = { common: '普通', uncommon: '精良', rare: '稀有', epic: '史诗', standard: '研究物资' };
let equipmentPickerSlot = null;
let equipmentPickerSource = 'owned';
const STAGE_LABELS = ['本科生', '硕士生', '博士生', '博士后', '讲师', '副教授', '教授', '杰青', '院士'];

function equipmentStageReason(item) {
  return Number(item.minStage || 0) > Number(hub?.research?.stage || 0)
    ? '需要' + (STAGE_LABELS[item.minStage] || '更高研究身份') + '，当前为' + (hub?.research?.stageName || '本科生') : '';
}
function openEquipmentPicker(slot) {
  if (!hub || view || !Object.hasOwn(SLOT_LABELS, slot)) return;
  const changed = equipmentPickerSlot !== slot;
  equipmentPickerSlot = slot;
  equipmentPickerSource = 'owned';
  if (changed) { selectedItems.delete('equipment-owned'); selectedItems.delete('equipment-shop'); }
  $('#equipment-picker-feedback')?.classList.add('hidden');
  renderEquipmentPicker();
  $('#equipment-picker')?.focus({ preventScroll: true });
  $('#equipment-picker')?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
}
function closeEquipmentPicker() {
  const slot = equipmentPickerSlot;
  equipmentPickerSlot = null;
  renderEquipmentPicker();
  $$('[data-item-zone="loadout"]').find(cell => cell.dataset.itemKey === slot)?.focus({ preventScroll: true });
}
function renderEquipmentPicker() {
  const picker = $('#equipment-picker');
  if (!picker) return;
  const open = Boolean(equipmentPickerSlot && hub && !view);
  picker.hidden = !open;
  picker.classList.toggle('hidden', !open);
  $$('[data-item-zone="loadout"]').forEach(cell => {
    const expanded = open && cell.dataset.itemKey === equipmentPickerSlot;
    cell.classList.toggle('is-picker-open', expanded);
    cell.setAttribute('aria-expanded', String(expanded));
    cell.setAttribute('aria-controls', 'equipment-picker');
  });
  if (!open) return;
  const slot = equipmentPickerSlot;
  const equippedId = hub.loadout?.[slot];
  const equipped = itemCatalog().get(equippedId);
  const owned = stashItems().filter(item => item.slot === slot && Number(item.count) > 0);
  const waiting = (hub.overflow || []).filter(row => (row.item || itemCatalog().get(row.id))?.slot === slot && Number(row.count) > 0);
  const currentText = equipped ? equipped.name + ' · ' + bonusText(equipped) : '尚未装备';
  $('#equipment-picker-title').textContent = '选择' + SLOT_LABELS[slot];
  $('#equipment-picker-current').textContent = '当前' + SLOT_LABELS[slot] + '：' + currentText + (waiting.length ? '。另有同类装备待整理，请先到仓库存入后再装备。' : '');
  $$('[data-equipment-source]').forEach(button => {
    const selected = button.dataset.equipmentSource === equipmentPickerSource;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    button.classList.toggle('is-active', selected);
  });
  $('#equipment-picker-content')?.setAttribute('aria-labelledby', 'equipment-source-' + equipmentPickerSource);
  const compare = '<div class="equipment-comparison"><strong>当前装备</strong><p>' + esc(currentText) + '</p><strong>选中装备</strong><p>';
  const zone = equipmentPickerSource === 'owned' ? 'equipment-owned' : 'equipment-shop';
  const source = equipmentPickerSource === 'owned' ? owned : (hub.shop || []).filter(item => item.slot === slot);
  const entries = source.map(item => {
    const current = item.id === equippedId;
    const ownedItem = owned.find(row => row.id === item.id);
    const waitingItem = waiting.find(row => row.id === item.id);
    const lockedReason = equipmentStageReason(item);
    const full = Number(hub.stashUsed) >= Number(hub.stashCap);
    const replacementBlocked = full && Boolean(equippedId) && !current && !ownedItem;
    const expensive = Number(hub.funding) < Number(item.price || 0);
    let actions, reason = lockedReason;
    if (equipmentPickerSource === 'owned') {
      actions = hubButton('equip:' + item.id, current ? '当前已装备' : '装备这件' + SLOT_LABELS[slot], current || Boolean(reason), reason || '当前正在使用这件装备');
      if (current) actions += hubButton('unequip:' + slot, '卸下当前装备', full, '仓库已满，请先腾出一个位置或扩容，再卸下装备。');
      if (current && full) reason ||= '仓库已满，请先腾出一个位置或扩容，再卸下装备。';
    } else {
      reason ||= ownedItem ? '已经拥有这件装备，可直接装备，无需重复购买。' : waitingItem ? '已有待整理的这件装备，请先到仓库存入后装备，无需再次购买。' : replacementBlocked ? '仓库已满，换下的旧装备需要一个位置；请先腾出空间或扩容。' : expensive ? '经费不足，需要 ' + number(item.price) + '。' : '';
      if (ownedItem && !current) actions = hubButton('equip:' + item.id, '装备仓库已有 · 无需购买', Boolean(lockedReason), lockedReason);
      else actions = '';
      actions += hubButton('buy-equip:' + item.id, current ? '当前已装备' : ownedItem ? '仓库已有 · 无需购买' : '购买并装备 · ' + number(item.price) + ' 经费', Boolean(reason), reason);
    }
    return { key: item.id, item, count: Number(ownedItem?.count || 0), price: equipmentPickerSource === 'shop' ? item.price : null,
      state: current ? '当前装备' : lockedReason ? '未解锁' : ownedItem ? '已有备用' : waitingItem ? '已有待整理' : replacementBlocked && equipmentPickerSource === 'shop' ? '仓库已满' : expensive && equipmentPickerSource === 'shop' ? '经费不足' : '可购买', reason,
      description: bonusText(item), extra: compare + esc(bonusText(item)) + '</p></div>', actions };
  });
  const existingSelection = selectedItems.get(zone);
  if (!entries.some(entry => entry.key === existingSelection)) {
    const initial = entries.find(entry => entry.key === equippedId) || entries[0];
    if (initial) selectedItems.set(zone, initial.key); else selectedItems.delete(zone);
  }
  renderItemZone(zone, '#equipment-picker-grid', '#equipment-picker-detail', entries,
    equipmentPickerSource === 'owned' ? '仓库里还没有可用的' + SLOT_LABELS[slot] + '，可切换“购买新的”查看。' : '商店暂时没有这类装备。');
}

function renderItemZone(zone, containerSelector, detailSelector, entries, emptyText = '暂无物品。') {
  const container = $(containerSelector);
  if (!container) return;
  itemZones.set(zone, { entries, detailSelector });
  const selected = selectedItems.get(zone);
  if (selected && !entries.some(entry => String(entry.key) === selected)) selectedItems.delete(zone);
  container.classList.add('item-grid');
  container.innerHTML = entries.map(entry => {
    const item = entry.item || {};
    const quality = Object.hasOwn(QUALITY_NAMES, item.rarity) ? item.rarity : 'standard';
    const chosen = zone === 'stash' && stashBatch ? batchItems.has(String(entry.key)) : String(entry.key) === selectedItems.get(zone);
    const name = item.name || entry.name || '空槽';
    const count = entry.count == null ? 1 : entry.count;
    const label = [name, entry.empty ? '空槽' : '数量 ' + count, QUALITY_NAMES[quality], entry.state || '', entry.reason || ''].filter(Boolean).join('，');
    return '<button type="button" class="item-cell quality-' + quality + (chosen ? ' is-selected' : '') + (entry.empty ? ' empty-cell' : '')
      + '" data-item-zone="' + attr(zone) + '" data-item-key="' + attr(entry.key) + '" data-item-id="' + attr(item.id || '') + '"'
      + (zone === 'stash' && stashBatch && item.unitPacked ? ' disabled' : '')
      + (entry.index == null ? '' : ' data-item-index="' + attr(entry.index) + '"') + ' aria-pressed="' + chosen + '" aria-label="' + attr(label) + '" title="' + attr(label) + '">'
      + (entry.empty ? '<span class="empty-slot-symbol" aria-hidden="true">＋</span>' : itemIconHtml(item, 'item-icon-large'))
      + '<span class="cell-name">' + esc(zone === 'bag' || zone === 'pending' ? ({dataset:'数据包',src_code:'源码',compute:'算力卡',wind:'情报',coffee_ticket:'咖啡券',stomach_pill:'胃药',coop:'合作意向'}[item.id] || name) : name) + '</span>'
      + (entry.empty || zone === 'stash' ? '' : '<span class="cell-count">' + (zone === 'shop' || zone === 'equipment-shop' ? '持有 ' : '×') + number(count) + '</span>')
      + (entry.state ? '<span class="cell-state">' + esc(entry.state) + '</span>' : '')
      + (entry.price == null ? '' : '<span class="cell-price">' + number(entry.price) + '</span>') + '</button>';
  }).join('') || '<div class="empty item-grid-empty">' + esc(emptyText) + '</div>';
  renderItemDetail(zone);
}
function renderItemDetail(zone) {
  const context = itemZones.get(zone);
  const detail = context && $(context.detailSelector);
  if (!detail) return;
  const entry = context.entries.find(row => String(row.key) === selectedItems.get(zone));
  if (!entry) {
    if (zone === 'bag' || zone === 'pending' || zone === 'stash') { detail.replaceChildren(); detail.hidden = true; return; }
    detail.innerHTML = '<div class="item-detail-placeholder"><strong>选择一个物品</strong><p>点击格子查看用途和可用操作。</p></div>';
    return;
  }
  const item = entry.item || {};
  detail.hidden = false;
  if (zone === 'bag') {
    detail.hidden = false;
    detail.innerHTML = '<div class="bag-selected-heading"><div><strong>'+esc(item.name || item.id)+'</strong> <small>'+number(item.weight || 0)+' 格</small></div><button type="button" data-close-bag-item aria-label="收起物品">×</button></div><div class="bag-selected-actions">'+(entry.actions || '')+'</div>';
    return;
  }
  const quality = Object.hasOwn(QUALITY_NAMES, item.rarity) ? item.rarity : 'standard';
  const name = item.name || entry.name || '空槽';
  const facts = entry.empty ? [] : [
    [zone === 'shop' || zone === 'equipment-shop' ? '已持有' : '数量', number(entry.count ?? 1)], ['单件重量', number(item.weight ?? 0)],
    ['物品价值', number(item.value ?? 0)], ...(entry.price == null ? [] : [['购买价格', number(entry.price) + ' 经费']]),
    ...(quality === 'standard' ? [] : [['品质', QUALITY_NAMES[quality]]]),
    ...(item.slot && item.storedCount != null ? [['仓库存放', number(item.storedCount)], ['已穿戴', number(item.equippedCount || 0)]] : []),
  ];
  detail.innerHTML = '<div class="item-detail-heading">' + (entry.empty ? '' : itemIconHtml(item, 'item-icon-large'))
    + '<div><span class="item-detail-quality">' + esc(entry.empty ? '装备槽' : item.cat || QUALITY_NAMES[quality]) + '</span><h3>' + esc(name) + '</h3></div></div>'
    + (entry.state ? '<p class="item-detail-state">' + esc(entry.state) + '</p>' : '')
    + '<p class="item-detail-description">' + esc(entry.description || (entry.empty ? '这个装备槽还空着，可以从仓库中选择适合的设备。' : bonusText(item))) + '</p>'
    + (entry.extra || '')
    + '<dl class="item-detail-facts">' + facts.map(([label, value]) => '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>').join('') + '</dl>'
    + (entry.reason ? '<p class="disabled-reason">' + esc(entry.reason) + '</p>' : '')
    + '<div class="item-detail-actions">' + (entry.actions || '<span class="tiny">仅查看物品详情</span>') + '</div>';
  detail.querySelectorAll('[data-hub-action],[data-action]').forEach(button => {
    button.disabled = pending || uncertainMutation || button.dataset.serverDisabled === 'true';
  });
}
function selectItemCell(button) {
  const zone = button.dataset.itemZone;
  const context = itemZones.get(zone);
  if (!context?.entries.some(entry => String(entry.key) === button.dataset.itemKey)) return;
  if (zone === 'stash' && stashBatch) {
    const key = button.dataset.itemKey;
    if (batchItems.has(key)) batchItems.delete(key); else batchItems.add(key);
    renderInventory(); return;
  }
  // The result sides share one inspection panel.
  if (zone.startsWith('result-')) {
    selectedItems.delete('result-returned'); selectedItems.delete('result-lost');
  }
  selectedItems.set(zone, button.dataset.itemKey);
  $$('[data-item-zone]').filter(cell => cell.dataset.itemZone === zone || zone.startsWith('result-') && cell.dataset.itemZone.startsWith('result-')).forEach(cell => {
    const active = selectedItems.get(cell.dataset.itemZone) === cell.dataset.itemKey;
    cell.classList.toggle('is-selected', active);
    cell.setAttribute('aria-pressed', String(active));
  });
  renderItemDetail(zone);
  if (zone === 'loadout') { openEquipmentPicker(button.dataset.itemKey); return; }
  const detail = $(context.detailSelector);
  if (detail && innerWidth <= 760) detail.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
}
try {
  const saved = sessionStorage.getItem('xuefa-workspace');
  if (Object.hasOwn(WORKSPACES, saved)) activeWorkspace = saved;
} catch { /* Workspace navigation also works without browser storage. */ }

function updateAreaHeading(title, description) {
  for (const [selector, value] of [['#game-area-title', title], ['#game-area-description', description]]) {
    const element = $(selector);
    if (element && element.textContent !== value) element.textContent = value;
  }
}
function renderWorkspaceNavigation() {
  $$('[data-workspace-tab]').forEach(button => {
    const selected = button.dataset.workspaceTab === activeWorkspace;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  $$('[data-workspace-panel]').forEach(panel => {
    const selected = panel.dataset.workspacePanel === activeWorkspace;
    panel.hidden = !selected;
    panel.classList.toggle('hidden', !selected);
  });
  updateAreaHeading(WORKSPACES[activeWorkspace].title, WORKSPACES[activeWorkspace].description);
}
function selectWorkspace(key, focus = false) {
  if (!Object.hasOwn(WORKSPACES, key) || view || !hub) return;
  activeWorkspace = key;
  try { sessionStorage.setItem('xuefa-workspace', key); } catch { /* Optional UI memory. */ }
  renderWorkspaceNavigation();
  const panel = $$('[data-workspace-panel]').find(element => element.dataset.workspacePanel === key);
  const navigation = $('#workspace-nav');
  if (panel && navigation && panel.getBoundingClientRect().top < navigation.getBoundingClientRect().bottom) panel.scrollIntoView({ block: 'start' });
  if (focus) $$('[data-workspace-tab]').find(button => button.dataset.workspaceTab === key)?.focus();
}
function isProbabilityRaidView(candidate) {
  return Boolean(candidate && candidate.mode === 'probability'
    && candidate.difficulty && typeof candidate.difficulty === 'object'
    && Array.isArray(candidate.probabilities?.materials)
    && Object.hasOwn(candidate, 'lastAction')
    && candidate.encounterPacing && typeof candidate.encounterPacing === 'object');
}

function renderPhaseNavigation() {
  const current = view ? view.status === 'ended' ? 'result' : 'raid' : 'hub';
  if (current !== 'hub') equipmentPickerSlot = null;
  if (renderedGamePhase && renderedGamePhase !== current) window.scrollTo({ top: 0 });
  renderedGamePhase = current;
  document.body.dataset.gamePhase = current;
  const steps = ['hub', 'raid', 'result'];
  $$('#game-phase-nav [data-game-phase]').forEach(step => {
    const selected = step.dataset.gamePhase === current;
    step.classList.toggle('is-current', selected);
    step.classList.toggle('is-complete', steps.indexOf(step.dataset.gamePhase) < steps.indexOf(current));
    if (selected) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
  });
  if (view && !isProbabilityRaidView(view)) updateAreaHeading('远征状态无法读取', '请点击同步进度重试。');
  else if (current === 'raid') updateAreaHeading('远征', '');
  else if (current === 'result') updateAreaHeading('远征结算', '查看带回与损失，再决定下一步的准备。');
  else if (!hub) updateAreaHeading('正在读取工位', '正在找回你的材料和研究进度。');
}
function restoreActionFocus(origin) {
  if (!origin || document.activeElement && document.activeElement !== document.body) return;
  if (origin.dataset.itemZone) {
    const cell = $$('[data-item-zone]').find(button => button.dataset.itemZone === origin.dataset.itemZone && button.dataset.itemKey === origin.dataset.itemKey);
    if (cell && cell.offsetParent !== null) { cell.focus({ preventScroll: true }); return; }
  }
  const candidates = $$('button[data-hub-action],button[data-action]');
  const matching = candidates.find(button => !button.disabled && button.offsetParent !== null
    && (origin.dataset.hubAction ? button.dataset.hubAction === origin.dataset.hubAction : origin.dataset.action && button.dataset.action === origin.dataset.action));
  const fallback = uncertainMutation ? $('#hub-refresh-state') : $('#game-area-title');
  (matching || fallback)?.focus({ preventScroll: true });
}

function requestId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  requestSequence += 1;
  return Date.now().toString(36) + '-' + requestSequence.toString(36);
}
async function api(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('服务器响应无法读取（HTTP ' + response.status + '）'); }
  if (!response.ok) {
    const error = new Error(payload.reason || '请求失败（HTTP ' + response.status + '）');
    error.definitive = response.status >= 400 && response.status < 500;
    throw error;
  }
  return payload;
}
function rememberRequest(request) {
  uncertainRequest = request;
  try {
    if (request) sessionStorage.setItem('xuefa-pending-request', JSON.stringify(request));
    else sessionStorage.removeItem('xuefa-pending-request');
  } catch { /* The same request can still be retried during this page session. */ }
}
function notice(text, kind) {
  const active = view && isProbabilityRaidView(view) && view.status !== 'ended' ? '#raid-feedback' : hub && !view ? '#hub-feedback' : '#global-feedback';
  for (const selector of ['#global-feedback', '#hub-feedback', '#raid-feedback']) {
    const box = $(selector);
    if (!box) continue;
    const visibleText = selector === active ? text : '';
    box.textContent = plainOutcome(visibleText || '');
    box.className = 'message' + (visibleText ? '' : ' hidden') + (kind ? ' ' + kind : '');
  }
}
function toggleBusy(value, message) {
  busyRequests = Math.max(0, busyRequests + (value ? 1 : -1));
  pending = busyRequests > 0;
  document.body.classList.toggle('is-pending', pending);
  $$('button[data-action],button[data-hub-action],#hub-start-raid,#result-return,#refresh-state,#hub-refresh-state').forEach(button => {
    const isRefresh = button.id === 'refresh-state' || button.id === 'hub-refresh-state';
    button.disabled = (pending && !isRefresh) || (uncertainMutation && !isRefresh) || button.dataset.serverDisabled === 'true';
  });
  if (value && message) notice(message);
}
function asOptions(value, fallback = []) {
  if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? { id: item, name: item } : item).filter(item => item && item.id != null);
  if (value && typeof value === 'object') return Object.entries(value).map(([id, item]) => typeof item === 'string' ? { id, name: item } : Object.assign({ id }, item));
  return fallback;
}
function itemCatalog() {
  const map = new Map();
  (hub && hub.items || []).forEach(item => map.set(item.id, item));
  (hub && hub.shop || []).forEach(item => { if (!map.has(item.id)) map.set(item.id, item); });
  (hub && hub.overflow || []).forEach(row => { if (!map.has(row.id)) map.set(row.id, Object.assign({ id: row.id }, row.item)); });
  (hub && hub.supplies || []).forEach(row => { if (!map.has(row.id)) map.set(row.id, Object.assign({ id: row.id }, row.item)); });
  return map;
}
function stashItems() {
  if (Array.isArray(hub && hub.items)) return hub.items;
  return (hub && hub.stash || []).map(row => Object.assign({}, row.item, row, { id: row.id || row.item && row.item.id }));
}
function storedItems() {
  return (hub?.stash || []).map(row => Object.assign({}, row.item, row, { id: row.id || row.item?.id })).filter(item => Number(item.count) > 0);
}
function bonusText(item) {
  const b = item.bonus || {};
  const researchEffects = [
    b.computeCapacity ? '研究实验能力 +' + b.computeCapacity : '',
    b.experiment ? '实验质量 +' + b.experiment : '',
    b.literature ? '文献质量 +' + b.literature : '',
  ].filter(Boolean);
  if (item.slot) {
    const hint = hub?.probabilitySetup?.gearHints?.[item.id];
    const modeEffects = Array.isArray(hint?.effects) ? hint.effects : [];
    return effectLabel([...modeEffects, ...researchEffects].join(' · ')) || '暂无新版远征效果配置';
  }
  return [...researchEffects, item.desc || item.cat || ''].filter(Boolean).join(' · ');
}
function effectLabel(value) {
  return String(value).replaceAll('src_code', '源码').replaceAll('dataset', '数据包').replaceAll('compute', '算力卡').replaceAll('wind', '方向情报');
}
function hubButton(action, label, disabled, reason) {
  return '<button type="button" class="button small" data-hub-action="' + attr(action) + '" data-server-disabled="' + (disabled ? 'true' : 'false') + '" ' + (disabled || pending || uncertainMutation ? 'disabled' : '') + (reason ? ' title="' + attr(reason) + '"' : '') + '>' + esc(label) + '</button>';
}
function actionButton(action, label, disabled, reason, detail) {
  return '<button type="button" class="button ' + ((action === 'search' || action === 'extract') ? 'primary' : '') + '" data-action="' + attr(action) + '" data-server-disabled="' + (disabled ? 'true' : 'false') + '" ' + (disabled || pending || uncertainMutation ? 'disabled' : '') + (reason ? ' title="' + attr(reason) + '"' : '') + '>' + esc(label) + (detail ? '<small>' + esc(detail) + '</small>' : '') + '</button>';
}
function renderStats() {
  const identity = hub.identity || {};
  const school = typeof identity.school === 'object' ? identity.school.name : identity.school;
  const research = hub.research || {};
  const render = rows => rows.map(([label, value, help]) => '<div class="stat"><label>' + esc(label) + '</label><strong>' + esc(value) + '</strong>' + (help ? '<small>' + esc(help) + '</small>' : '') + '</div>').join('');
  $('#hub-stats').innerHTML = render([['经费', number(hub.funding)], ['阶段', research.stageName || '本科生']]);
  $('#career-stats').innerHTML = render([
    ['研究者', identity.name || '新研究者', [school, identity.major].filter(Boolean).join(' · ')],
    ['仓库', number(hub.stashUsed) + ' / ' + number(hub.stashCap) + ' 格'],
    ['远征', number(hub.raids) + ' 次'], ['成功撤离', number(hub.extracted) + ' 次'],
  ]);
}

function researchPreparationText() {
  const available = new Map(stashItems().map(item => [item.id, Math.max(0, Number(item.count || 0) - Number(item.packedCount || 0))]));
  const research = hub.research || {};
  if (research.project) {
    const experiment = (research.actions || []).find(action => action.id === 'research:experiment');
    return '当前课题：' + (research.project.title || '研究项目') + '。' + (experiment?.disabled && experiment.reason ? '实验准备：' + experiment.reason : '带回材料后可在研究区继续实验。');
  }
  const template = (research.templates || []).find(item => item.id === 'replicate') || (research.templates || [])[0];
  const catalog = itemCatalog();
  const needs = Object.entries(template?.materials || {}).map(([id, need]) => ({ id, missing: Math.max(0, Number(need) - Number(available.get(id) || 0)) })).filter(item => item.missing);
  const lines = needs.length ? ['复现缺口：' + needs.map(item => (catalog.get(item.id)?.name || item.id) + ' ×' + item.missing).join('、')] : [];
  if (Number(available.get('compute') || 0) < 2) lines.push('实验准备：算力卡 ' + number(available.get('compute') || 0) + '/2');
  return lines.join('；') || '研究材料已齐，可在研究区创建课题；也可搜集下一轮所需材料。';
}
function selectedVenueName(venues, id) {
  const venue = venues.find(item => item.id === id);
  return venue && (venue.name || venue.label) || id;
}
function renderSetup() {
  const setup = hub.probabilitySetup || {};
  const venues = asOptions(setup.venues);
  const difficulties = asOptions(setup.difficulties);
  if (!venues.some(option => option.id === setupSelection.venue && !option.disabled)) setupSelection.venue = (venues.find(option => option.id === hub.venue && !option.disabled) || venues.find(option => !option.disabled) || venues[0] || {}).id || '';
  if (!difficulties.some(option => option.id === setupSelection.difficulty)) setupSelection.difficulty = (difficulties.find(option => option.id === 'normal') || difficulties[0] || {}).id || '';
  function options(items, selected, showCost) {
    if (!items.length) return '<option value="">服务器尚未提供新版配置</option>';
    return items.map(option => {
      const cost = showCost && option.cost != null ? ' · ' + number(option.cost) + ' 经费' : '';
      const reason = option.reason || (option.disabled ? '当前不可用' : '');
      return '<option value="' + attr(option.id) + '" ' + (option.id === selected ? 'selected' : '') + (option.disabled ? ' disabled' : '') + (reason ? ' title="' + attr(reason) + '"' : '') + '>' + esc(option.name || option.label || option.id) + cost + (option.disabled && reason ? ' · ' + esc(reason) : '') + '</option>';
    }).join('');
  }
  $('#setup-venue').innerHTML = options(venues, setupSelection.venue, true);
  renderDifficultySetup(venues, difficulties);
  const hints = setup.gearHints || {};
  const equipped = new Set(Object.values(hub.loadout || {}).filter(Boolean));
  const gearMarkup = Object.entries(hints).filter(([id]) => equipped.has(id)).map(([id, hint]) => {
    const item = itemCatalog().get(id);
    const effect = effectLabel(Array.isArray(hint && hint.effects) && hint.effects.length ? hint.effects.join(' ') : hint && hint.description || '此装备效果由服务器配置。');
    const icon = itemIconHtml(item || { id: id }, 'item-icon-small');
    return '<div class="gear-hint">' + icon + '<div><b>' + esc(item && item.name || hint && hint.description || id) + (equipped.has(id) ? ' · 已装备' : '') + '</b><div>' + esc(effect) + '</div></div></div>';
  }).join('');
  $('#setup-gear-hints').innerHTML = gearMarkup || '<div class="gear-hint">出发使用工位已装备设备和预留补给；具体效果由服务器检定。</div>';
  const sceneArt = VENUE_SCENE_ART[setupSelection.venue];
  if (sceneArt) {
    $('#setup-venue-art').src = sceneArt[0];
    $('#setup-venue-art').alt = sceneArt[1];
    $('#setup-venue-scene-name').textContent = selectedVenueName(venues, setupSelection.venue);
  }
  const selected = venues.find(item => item.id === setupSelection.venue);
  const difficulty = difficulties.find(item => item.id === setupSelection.difficulty);
  $('#setup-venue-caption').textContent = selected?.desc || '寻找下一份研究材料';
  $('#launch-summary').textContent = (selected?.name || '未选择地点') + ' · ' + (difficulty?.name || '未选择难度') + ' · 出行费 ' + number(selected?.cost || 0);
  const blocked = !selected || selected.disabled || !difficulties.some(item => item.id === setupSelection.difficulty && !item.disabled);
  const poor = selected && Number(hub.funding) < Number(selected.cost || 0);
  $('#hub-start-raid').disabled = pending || uncertainMutation || blocked || poor;
  $('#setup-reason').textContent = selected && selected.reason || (poor ? '经费不足；学术交流免费开放。' : !difficulties.length ? '难度配置尚未加载，请同步进度。' : '');
}

function materialProbabilityHtml(materials) {
  return (materials || []).map(item => '<div data-material-id="' + attr(item.id) + '">' + itemIconHtml(item, 'item-icon-small') + '<span>' + esc(MATERIAL_LABELS[item.id] || item.name) + '</span></div>').join('');
}

function renderDifficultySetup(venues, difficulties) {
  const venue = venues.find(item => item.id === setupSelection.venue);
  const difficulty = difficulties.find(item => item.id === setupSelection.difficulty);
  const preview = venue?.difficultyPreviews?.find(item => item.difficultyId === setupSelection.difficulty);
  $('#setup-difficulty-options').innerHTML = difficulties.map(item => '<button type="button" data-difficulty-choice="' + attr(item.id) + '" aria-pressed="' + (item.id === setupSelection.difficulty) + '" ' + (item.disabled ? 'disabled' : '') + '><strong>' + esc(item.name) + '</strong></button>').join('');
  const description = difficulty?.id === 'easy' ? '从容一点，收获也少一些' : difficulty?.id === 'hard' ? '更多发现，也更考验临场应对' : '适合稳步探索';
  $('#setup-difficulty-description').textContent = description;
  $('#setup-material-pool').innerHTML = materialProbabilityHtml(preview?.materials || venue?.pool?.materials, true);
}

function renderResearch() {
  const root = $('#research-card');
  const opened = new Set([...root.querySelectorAll('details[open]')].map(detail => detail.dataset.researchDetail));
  root.innerHTML = renderResearchWorkbench({ hub, items: stashItems(), catalog: itemCatalog(), button: hubButton });
  for (const detail of root.querySelectorAll('details[data-research-detail]')) {
    if (opened.has(detail.dataset.researchDetail)) detail.open = true;
  }
  const research = hub.research || {};
  const project = research.project;
  const starter = (research.templates || []).find(row => row.id === 'replicate') || research.templates?.[0];
  const inventory = new Map(stashItems().map(item => [item.id, item]));
  const experiment = (research.actions || []).find(action => action.id === 'research:experiment');
  const targetNeeds = { ...(starter?.materials || {}), compute: Math.max(2 * (1 + Number(starter?.scope || 0)), Number(starter?.materials?.compute) || 0) };
  const targetMissing = Object.entries(targetNeeds).map(([id, count]) => {
    const item = inventory.get(id);
    const owned = starter?.materialCounts && Object.hasOwn(starter.materialCounts, id) ? Number(starter.materialCounts[id]) : Math.max(0, Number(item?.count || 0) - Number(item?.packedCount || 0));
    const missing = Math.max(0, count - owned);
    return missing ? (MATERIAL_LABELS[id] || item?.name || id) + ' ×' + missing : '';
  }).filter(Boolean);
  $('#setup-gap').textContent = (research.actions || []).some(row => row.id === 'research:promote' && !row.disabled) ? '晋升条件已齐，前往研究工位领取晋升奖励'
    : project?.status === 'submitted' ? '论文已投稿，可以返回研究工位查看审稿'
    : project?.status === 'ready' ? '审稿通过，可以返回研究工位确认录用'
    : project ? (experiment?.disabled && experiment.reason ? '实验准备：' + experiment.reason : '材料就绪，可以继续实验')
    : targetMissing.length ? '需要：' + targetMissing.join(' · ') : '材料就绪，可以开始研究';
}

function renderInventory() {
  const catalog = itemCatalog();
  const items = storedItems();
  if (stashSort) items.sort((a,b) => categoryOf(a).localeCompare(categoryOf(b)) || String(a.name).localeCompare(String(b.name), "zh"));
  const loadout = hub.loadout || {};
  const slots = ['bag', 'focus', 'tool', 'device', 'storage'];
  $('#loadout-count').textContent = Object.values(loadout).filter(Boolean).length + ' / ' + slots.length + ' 槽';
  const loadoutEntries = slots.map(slot => {
    const id = loadout[slot], item = id ? catalog.get(id) : null;
    return { key: slot, item: item || { name: SLOT_LABELS[slot] }, empty: !item, state: SLOT_LABELS[slot],
      reason: item && Number(hub.stashUsed) >= Number(hub.stashCap) ? '仓库已满，卸下装备前需要腾出一个位置或扩容。' : '',
      description: item ? bonusText(item) : '这个装备槽还空着。在仓库中选择对应设备即可装备。',
      actions: item ? hubButton('unequip:' + slot, '卸下装备', Number(hub.stashUsed) >= Number(hub.stashCap), '仓库已满，请先腾出一个位置或扩容。') : '<button class="button small" type="button" data-open-workspace="inventory">前往仓库选择装备</button>' };
  });
  renderItemZone('loadout', '#hub-loadout', '#loadout-item-detail', loadoutEntries);

  const supplies = hub.supplies || [];
  const supplyCount = supplies.reduce((total, row) => total + Number(row.count || 0), 0);
  $('#supply-count').textContent = supplyCount + ' / 3 件';
  $('#equipment-summary').textContent = Object.values(loadout).filter(Boolean).length + ' 件装备 · ' + supplyCount + ' 件补给';
  renderItemZone('supplies', '#hub-supplies', '#supplies-item-detail', supplies.map(row => {
    const item = row.item || catalog.get(row.id) || { id: row.id, name: row.id };
    return { key: row.id, item, count: row.count, state: '已预留', actions: hubButton('unpack:' + row.id, '卸下一件补给') };
  }), '没有预留补给，可从仓库中带入。');

  $('#stash-count').textContent = number(hub.stashUsed) + ' / ' + number(hub.stashCap) + ' 格';
  renderWarehouseUpgrade();
  const units = items.flatMap(item => Array.from({length: Number(item.count)}, (_, index) => ({...item, count: 1, unitIndex: index, unitPacked: index < Number(item.packedCount || 0)})));
  const validKeys = new Set(units.map(item => item.id + ':' + item.unitIndex));
  for (const key of batchItems) if (!validKeys.has(key)) batchItems.delete(key);
  $('#stash-batch').textContent = stashBatch ? '完成' : '批量';
  $('#stash-bulk-sell').hidden = !stashBatch;
  $('#stash-select-all').hidden = !stashBatch;
  $('#stash-bulk-sell').textContent = '出售所选 ' + batchItems.size;
  $('#stash-bulk-sell').disabled = !batchItems.size || pending || uncertainMutation;
  renderItemZone('stash', '#hub-stash', '#stash-item-detail', units.map(item => {
    const equipped = Boolean(item.equipped || item.equippedSlots && item.equippedSlots.length);
    const packed = Number(item.unitPacked);
    let actions = '';
    if (item.slot) actions += hubButton('equip:' + item.id, equipped ? '已装备' : '装备到' + (SLOT_LABELS[item.slot] || item.slot), equipped, equipped ? '已经装备' : '');
    if (item.use) {
      const packDisabled = supplyCount >= 3 || Number(item.count || 0) <= packed;
      const packReason = supplyCount >= 3 ? '每次最多预留3件补给' : Number(item.count || 0) <= packed ? '没有未预留库存' : '';
      actions += hubButton('pack:' + item.id, '预留一件补给', packDisabled, packReason);
    }
    const sellDisabled = Number(item.count || 0) <= packed;
    const sellReason = sellDisabled ? '预留补给不能出售' : '';
    actions += hubButton('sell:' + item.id, '出售 +' + number(item.sellPrice ?? item.value ?? 0), sellDisabled, sellReason);
    return { key: item.id + ':' + item.unitIndex, item, count: 1, state: packed ? '预留' : '',
      description: bonusText(item) + (packed ? ' 其中 ' + packed + ' 件已预留，不能出售或再次预留。' : ''), actions };
  }), '仓库为空。');

  renderItemZone('shop', '#hub-shop', '#shop-item-detail', (hub.shop || []).filter(item => shopCategory === 'all' || categoryOf(item) === shopCategory).map(item => {
    const stageLocked = Number(item.minStage || 0) > Number(hub.research?.stage || 0);
    const tooExpensive = Number(hub.funding || 0) < Number(item.price || 0);
    const reason = stageLocked ? equipmentStageReason(item) : tooExpensive ? '经费不足，需要 ' + number(item.price) : '';
    return { key: item.id, item, count: item.count || 0, price: item.price,
      state: stageLocked ? '未解锁' : tooExpensive ? '经费不足' : '', reason,
      actions: hubButton('buy:' + item.id, '购买一件 · ' + number(item.price) + ' 经费', stageLocked || tooExpensive, reason) };
  }), '当前没有可购买的商品。');

  const overflow = hub.overflow || [];
  $('#overflow-card').classList.toggle('hidden', !overflow.length);
  renderItemZone('overflow', '#hub-overflow', '#overflow-item-detail', overflow.map(row => {
    const item = row.item || catalog.get(row.id) || { id: row.id, name: row.id };
    return { key: row.id, item, count: row.count, state: '待入库',
      actions: hubButton('store:' + row.id, '存入仓库', Number(hub.stashUsed) >= Number(hub.stashCap), '仓库已满') + hubButton('sell-overflow:' + row.id, '出售 +' + number(item.sellPrice ?? item.value ?? 0)) };
  }));
  $('#hub-venues').innerHTML = asOptions(hub.probabilitySetup?.venues).map(venue => '<article class="item-card venue-entry' + (venue.disabled ? ' is-locked' : '') + '"><span class="venue-index" aria-hidden="true">' + (venue.disabled ? '◇' : '◎') + '</span><div class="item-copy"><div class="item-title">' + esc(venue.name) + '</div><div class="meta">' + esc(venue.desc || '') + ' · ' + number(venue.cost) + ' 经费</div><div class="meta">' + esc(venue.reason || '已解锁，可在远征准备中选择') + '</div></div></article>').join('') || '<div class="empty">服务端暂无地点配置。</div>';
  const report = hub.lastReport;
  $('#hub-last-report').textContent = report
    ? (({ clean: '完整撤离', partial: '部分撤离', fail: '行动失败', scatter: '散场失败' })[report.kind] || '远征结算')
      + ' · 带回 ' + number(report.returnedCount) + ' 件 · 经费 +' + number(report.fundsReturned) + ' · 装备保留 ' + number(report.loadoutReturned) + ' 件'
    : '还没有远征记录。';
  renderEquipmentPicker();
}

function renderWarehouseUpgrade() {
  const upgrade = hub?.storageUpgrade;
  const button = $('#warehouse-upgrade-button');
  if (!button) return;
  const maximum = upgrade && Number(upgrade.level) >= Number(upgrade.maxLevel);
  const disabled = !upgrade || maximum || Boolean(upgrade.disabled);
  button.dataset.serverDisabled = String(disabled);
  button.disabled = disabled || pending || uncertainMutation;
  button.textContent = maximum ? '已满级' : upgrade ? '扩容 +20 · ' + number(upgrade.cost) + ' 经费' : '加载中';
  $('#warehouse-upgrade-summary').textContent = upgrade && !maximum ? number(upgrade.currentCap) + ' → ' + number(upgrade.nextCap) + ' 格' : '';
  $('#warehouse-upgrade-reason').textContent = upgrade?.disabled && !maximum ? '经费不足' : '';

}

function exitAction(action) { return action.endsRaid === true || action.id === 'event:leave' || action.id === 'respond:leave'; }

function plainOutcome(value) {
  // Legacy saves may contain numeric odds in persisted logs; present them qualitatively too.
  return String(value == null ? '' : value)
    .replaceAll('实际后果：', '结果：').replaceAll('检定未通过。', '这次没能解决问题。')
    .replaceAll('无检定；该方案按 100% 成功结算。', '按所列消耗执行，不会额外失败。')
    .replace(/接应支持\s*\+[\d.]+（[^）]*）/g, '接应更可靠')
    .replace(/([\d.]+)%\s*[→⇒]\s*([\d.]+)%/g, (_, from, to) => Number(to) > Number(from) ? '有所提高' : Number(to) < Number(from) ? '有所降低' : '保持不变')
    .replace(/([+-]?[\d.]+)\s*(?:%|％|个百分点|百分点)/g, (_, value) => value.startsWith('-') ? '有所降低' : value.startsWith('+') ? '有所提升' : likelihoodLabel(value))
    .replace(/风险(?:增加到|降低到|降至|升至)\s*([\d.]+)/g, (_, value) => '形势' + riskLabel(value))
    .replace(/风险\s*[+＋]([\d.]+)/g, '风险上升').replace(/风险\s*[−-]([\d.]+)/g, '风险减轻');
}

function renderGenericActions(target, actions) {
  const names = { 'take:all': '全部装入', 'take:available': '能装多少装多少', 'take:skip': '放下' };
  target.innerHTML = actions.map(action => actionButton(action.id, names[action.id] || action.name, action.disabled, action.disabled ? '背包装不下' : '', '')).join('');
}
function compactChoice(action) {
  if (action.label) return action.label;
  if (action.id === 'event:story-decline') return '去旁边看看';
  return String(action.name || '试试看').replace(/^(?:花心力|消耗人脉)[，,：:]?/, '').replace(/[，,；;].*$/, '').slice(0, 14);
}
function renderEventChoices(actions) {
  $('#event-choices').innerHTML = (actions || []).filter(action => !exitAction(action) && !action.disabled && !action.talent && action.id !== 'event:talent-negotiate').map(action => '<div class="decision-option"><button type="button" class="neutral-choice" data-action="' + attr(action.id) + '" data-server-disabled="false" ' + (pending || uncertainMutation ? 'disabled' : '') + '>' + esc(compactChoice(action)) + '</button></div>').join('');
}
function shortResult(action) {
  if (action.brief) return action.brief;
  if (action.type === 'search') return action.itemsAdded?.length ? '找到了点东西' : '这里翻过了';
  if (action.type === 'loot') return action.itemsAdded?.length ? '装好了' : '继续走';
  if (action.type === 'talent') return action.title || '处理好了';
  return String(action.text || '').split(/[。！]/)[0].replace(/(?:风险|成功率|把握)[^，；]*[，；]?/g, '').slice(0, 28) || '继续走';
}
function renderTurnResult(current) {
  const action = current.lastAction;
  // While an encounter or overflow needs a click, the live bag and that prompt
  // are enough feedback. Don't stack the previous receipt beneath them.
  const show = Boolean(action && !current.event && !current.pendingLoot?.length);
  $('#raid-turn-card').classList.toggle('hidden', !show);
  if (!show) {
    $('#raid-turn-text').textContent = '';
    $('#raid-turn-changes').replaceChildren();
    $('#raid-turn-items').replaceChildren();
    return;
  }
  $('#raid-turn-text').textContent = shortResult(action);
  $('#raid-turn-changes').innerHTML = [['♥',action.willDelta],['☷',action.networkDelta]].filter(([,v])=>Number.isFinite(v)&&v!==0).map(([label,value])=>'<span class="raid-delta'+(value<0?' negative':'')+'">'+label+' '+(value>0?'+':'−')+number(Math.abs(value))+'</span>').join('');
  $('#raid-turn-items').innerHTML = (action.itemsAdded || []).map(item => '<span class="raid-mini-loot" title="'+attr(item.name || item.id)+(item.pending?' · 待装入':'')+'">'+itemIconHtml(item,'item-icon-small')+(item.pending?'待装入':'+1')+'</span>').join('');
}
function renderRaid(current) {
  if (current.raidId !== renderedRaidId) { renderedRaidId = current.raidId; selectedItems.delete('bag'); }
  $('#raid-heading').textContent = current.venue?.name || '远征';
  renderFieldScene(current, { scene: $('#field-scene'), status: $('#raid-statusline') });
  $('#bag-capacity').textContent = number(current.bagUsed) + ' / ' + number(current.bagCap);
  const actions = current.actions || [];
  const bagActions = actions.filter(action => /^(drop|use|backup):/.test(action.id));
  const bagEntries = (current.bag || []).map((item,index) => {
    const applicable = bagActions.filter(action => action.id.endsWith(':'+index));
    const controls = applicable.map(action => {
      const verb = action.id.split(':')[0];
      const name = verb === 'drop' ? '放下' : verb === 'use' ? '使用' : '备份';
      return actionButton(action.id,name,action.disabled,action.disabled?action.reason:'','');
    }).join('');
    return { key: current.raidId+':'+current.revision+':'+index+':'+item.id, item,index,count:1,
      state: item.protection==='talent'?'封存':item.protected?'保护':'',actions:controls };
  });
  const cancelBackup=actions.find(action=>action.id==='backup:none');
  if(cancelBackup) bagEntries.filter(entry=>entry.item.protected && entry.item.protection!=='talent').forEach(entry=>{
    entry.actions+=actionButton(cancelBackup.id,'取消备份',cancelBackup.disabled,cancelBackup.reason,'');
  });
  renderItemZone('bag','#raid-bag','#bag-item-detail',bagEntries,'还空着');
  const event=current.event;
  $('#raid-event-card').classList.toggle('hidden',!event);
  $('#event-title').textContent=event ? event.prompt || String(event.title || event.name || '碰到一件怪事').slice(0,28) : '';
  renderEventChoices(event?.actions);
  const pendingLoot=current.pendingLoot || [];
  $('#pending-loot-card').classList.toggle('hidden',!pendingLoot.length);
  renderItemZone('pending','#pending-loot-items','#pending-item-detail',pendingLoot.map((item,index)=>({key:current.raidId+':'+current.revision+':'+index,item,index,count:1})), '');
  renderGenericActions($('#pending-loot-actions'), actions.filter(action=>action.id.startsWith('take:')));
  const search=actions.find(action=>action.id==='search');
  const exit=event ? event.actions?.find(exitAction) : actions.find(action=>action.id==='extract');
  const dockButton=(action,name,cls,symbol)=>'<button type="button" class="button '+cls+'" data-action="'+attr(action?.id || (cls==='search-main'?'search':'extract'))+'" data-server-disabled="'+Boolean(!action || action.disabled)+'" '+(action?.disabled && action.reason?'title="'+attr(action.reason)+'" ':'')+(!action || action.disabled || pending || uncertainMutation?'disabled':'')+'><span class="action-symbol" aria-hidden="true">'+symbol+'</span>'+name+'</button>';
  $('#raid-actions').innerHTML=dockButton(search,'搜索','search-main','⌕')+dockButton(exit,'撤离','extract-main','↗');
  renderTurnResult(current);
  renderResult(current);
}

function animateBagChanges(previous, current) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || previous?.raidId !== current.raidId) return;
  const counts = items => (items || []).reduce((out,item)=>{out[item.id]=(out[item.id]||0)+1;return out;},{});
  const before=counts(previous.bag), after=counts(current.bag);
  for (const [id,count] of Object.entries(after)) {
    let added=count-(before[id]||0);
    if(added<=0) continue;
    const cells=$$('#raid-bag [data-item-id]').filter(cell=>cell.dataset.itemId===id).reverse();
    for (const cell of cells.slice(0,added)) cell.classList.add('loot-flash');
  }
}

function renderResult(current) {
  const result = current.result || {};
  const ended = current.status === 'ended';
  $('#result-screen').classList.toggle('hidden', !ended);
  if (!ended) return;
  const labels = { clean: '完整撤离', messy: '部分撤离', scatter: '行动失败', complete: '完整撤离', partial: '部分撤离', fail: '行动失败' };
  $('#result-title').textContent = labels[result.kind] || result.title || '本局结算';
  $('#result-summary').textContent = plainOutcome(result.summary || result.text || '');
  $('#result-stories').innerHTML = renderStoryEntries(current.stories?.recent);
  const returned = result.returned || result.returnedItems || [...(result.archivedIds || []), ...(result.carriedIds || [])];
  const lost = result.lost || result.lostItems || result.lostIds || [];
  const catalog = itemCatalog();
  function resultEntries(items, type, zone) {
    return items.map((value, index) => {
      const item = typeof value === 'string' ? catalog.get(value) || { id: value, name: value } : value;
      return { key: current.raidId + ':' + zone + ':' + index, item, index, state: item.protected ? '备份保全' : type,
        description: bonusText(item), actions: '<span class="tiny">' + esc(type) + '，此处仅查看结算记录。</span>' };
    });
  }
  renderItemZone('result-returned', '#result-items', '#result-item-detail', resultEntries(returned, '带回仓库', 'returned'), '没有带回材料。');
  renderItemZone('result-lost', '#result-lost-items', '#result-item-detail', resultEntries(lost, '本次遗失', 'lost'), '没有损失物品。');
  if (selectedItems.has('result-returned')) renderItemDetail('result-returned');
  const returnedGear = result.returnedLoadoutIds || [];
  $('#result-gear').textContent = '长期能力、已发表论文和局外装备留在档案。' + (returnedGear.length ? '本次带回装备：' + returnedGear.map(id => catalog.get(id)?.name || id).join('、') : '');
  $('#result-feedback').classList.toggle('hidden', !result.noMaterialLoss);
  $('#result-feedback').textContent = result.noMaterialLoss ? '当前没有未保护材料；这次结果没有额外损失物品。' : '';
}

function renderHub() {
  if (!hub) return;
  renderStats();
  renderSetup();
  renderResearch();
  renderInventory();
  $('#career-stories').innerHTML = renderStoryEntries(hub.stories?.chapters?.filter(row => row.state !== 'unseen'), '校园奇遇档案');
  renderWorkspaceNavigation();
}

function render() {
  renderPhaseNavigation();
  for (const id of ['hub-screen', 'raid-screen', 'result-screen']) $('#' + id).classList.add('hidden');
  if (view && !isProbabilityRaidView(view)) {
    notice('当前远征状态无法读取，请点击同步进度重试。', 'error');
    return;
  }
  if (view) {
    renderRaid(view);
    if (view.status === 'ended' || phase === 'result') $('#result-screen').classList.remove('hidden');
    else $('#raid-screen').classList.remove('hidden');
    return;
  }
  if (hub) { renderHub(); $('#hub-screen').classList.remove('hidden'); }
}

async function readState() {
  let succeeded = false;
  toggleBusy(true, '正在读取服务器存档……');
  try {
    if (uncertainMutation && uncertainRequest) {
      const request = uncertainRequest;
      try {
        await api(request.path, request.body);
        rememberRequest(null);
        uncertainMutation = false;
      } catch (error) {
        if (error.definitive) { rememberRequest(null); uncertainMutation = false; }
      }
    }
    const payload = await api('/api/state');
    if (payload.hub) hub = payload.hub;
    view = payload.view || null;
    phase = payload.phase || (view ? 'raid' : 'hub');
    succeeded = !uncertainMutation && (!view || isProbabilityRaidView(view));
    render();
    notice(uncertainMutation ? '已读取存档，但上次操作尚未收到回执。请点击“同步进度”重试同一笔操作。'
      : view && !isProbabilityRaidView(view) ? '当前远征状态无法读取，请点击同步进度重试。' : hub?.migrationNotice?.text || '', uncertainMutation ? 'error' : '');
  } catch (error) { notice(error.message, 'error'); }
  finally { toggleBusy(false); render(); }
  return succeeded;
}

async function submitApi(path, body, label) {
  if (pending) return;
  if (uncertainMutation) {
    notice('操作结果尚未确认。请先点击“同步进度”读取服务器状态，再继续操作。', 'error');
    return;
  }
  const focusOrigin = document.activeElement;
  const previousRaid = view;
  const previousPickerSlot = equipmentPickerSlot;
  let raidActionSucceeded = false;
  let equippedItemId = null;
  toggleBusy(true, label || '正在提交……');
  try {
    const requestPayload = Object.assign({}, body, { requestId: requestId() });
    rememberRequest({ path, body: requestPayload });
    let payload;
    let requestError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        payload = await api(path, requestPayload);
        requestError = null;
        break;
      } catch (error) {
        if (error.definitive) { rememberRequest(null); throw error; }
        requestError = error;
      }
    }
    if (requestError) {
      uncertainMutation = true;
      const synced = await readState();
      if (synced) notice('已重试同一笔操作并确认服务器结果，请核对当前状态。');
      else {
        uncertainMutation = true;
        notice('操作结果尚未确认。请点击“同步进度”读取服务器状态后再继续。', 'error');
      }
      return;
    }
    rememberRequest(null);
    uncertainMutation = false;
    if (payload.hub) hub = payload.hub;
    if (Object.hasOwn(payload, 'view')) view = payload.view;
    phase = payload.phase || (view ? view.status === 'ended' ? 'result' : 'raid' : 'hub');
    raidActionSucceeded = payload.ok === true && path === '/api/expedition/action';
    if (payload.ok && path === '/api/hub/action' && /^buy-equip:/.test(body.action || '')) {
      const id = body.action.slice('buy-equip:'.length);
      const purchased = (payload.hub?.items || []).find(item => item.id === id);
      if (purchased?.slot === equipmentPickerSlot) {
        equipmentPickerSource = 'owned';
        selectedItems.set('equipment-owned', id);
        equippedItemId = id;
      }
    }
    if (payload.ok && path === '/api/hub/action' && /^equip:/.test(body.action || '')) {
      const id = body.action.slice('equip:'.length);
      if ((payload.hub?.items || []).find(item => item.id === id)?.slot === equipmentPickerSlot) {
        equipmentPickerSource = 'owned';
        selectedItems.set('equipment-owned', id);
        equippedItemId = id;
      }
    }
    if (payload.ok && (path === '/api/new' || path === '/api/hub/return')) equipmentPickerSlot = null;
    if (payload.ok && path === '/api/hub/return') {
      activeWorkspace = 'prepare';
      try { sessionStorage.setItem('xuefa-workspace', activeWorkspace); } catch { /* Optional UI memory. */ }
    }
    render();
    const message = payload.actionResult?.message || payload.message || (payload.ok === false ? payload.reason
      : path === '/api/hub/action' && body.action === 'upgrade:warehouse' ? '仓库已扩容至 ' + number(hub.stashCap) + ' 格。' : '');
    notice(message, payload.ok === false ? 'error' : message ? 'good' : '');
    if (path === '/api/hub/action' && equipmentPickerSlot && /^(buy-equip|equip|unequip):/.test(body.action || '')) {
      const feedback = $('#equipment-picker-feedback');
      if (feedback) {
        feedback.className = 'message ' + (payload.ok ? 'good' : 'error');
        feedback.textContent = payload.ok ? (body.action.startsWith('buy-equip:') ? '已购买并装备；原装备仍在仓库中。' : body.action.startsWith('unequip:') ? '已卸下，装备仍保留在仓库中。' : '已更换装备；原装备仍在仓库中。') : payload.reason || '这次装备选择没有完成。';
      }
    }
    if (payload.ok === false && /版本|过期|stale|revision|不同步/i.test(payload.reason || '') && !payload.view) {
      const fresh = await api('/api/state');
      if (fresh.hub) hub = fresh.hub;
      view = fresh.view || null;
      phase = fresh.phase || (view ? 'raid' : 'hub');
      render();
      notice('远征状态已同步，请按最新服务器结果重新选择。');
    }
  } catch (error) {
    notice(error.message, 'error');
    try {
      const fresh = await api('/api/state');
      if (fresh.hub) hub = fresh.hub;
      view = fresh.view || null;
      phase = fresh.phase || (view ? 'raid' : 'hub');
      render();
    } catch { /* keep last state and show the original error */ }
  } finally {
    toggleBusy(false);
    render();
    if (raidActionSucceeded && view?.status === 'playing') focusRaidStep(previousRaid, body.action);
    if (!view && path === '/api/hub/action' && /^research:(promote|milestone:)/.test(body.action || '')) {
      const target = body.action === 'research:promote' ? $('#promotion-title')
        : $('#research-current-goal');
      if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() }); }
    }
    if (equippedItemId && equipmentPickerSlot === previousPickerSlot) {
      const cell = $$('[data-item-zone="equipment-owned"]').find(button => button.dataset.itemId === equippedItemId);
      cell?.focus({ preventScroll: true });
    }
    restoreActionFocus(focusOrigin);
  }
}

function focusRaidStep(previous, action) {
  const target = view.pendingLoot?.length ? $('#pending-loot-actions button:not(:disabled)')
    : view.event ? $('#event-choices button:not(:disabled)') : $('#raid-actions [data-action="search"]');
  target?.focus({ preventScroll: true });
  animateBagChanges(previous,view);
}

$('#hub-start-raid').addEventListener('click', () => {
  if (!hub || view) return;
  const venue = $('#setup-venue').value, difficulty = setupSelection.difficulty;
  const setup = hub.probabilitySetup || {};
  const venues = asOptions(setup.venues);
  const selected = venues.find(item => item.id === venue);
  if (!selected || selected.disabled) { notice(selected?.reason || '当前地点不可用。', 'error'); return; }
  const selectedDifficulty = asOptions(setup.difficulties).find(item => item.id === difficulty);
  if (!selectedDifficulty || selectedDifficulty.disabled) { notice('请先选择有效的远征难度。', 'error'); return; }
  if (Number(hub.funding) < Number(selected.cost || 0)) { notice('经费不足；学术交流地点免费开放。', 'error'); return; }
  submitApi('/api/new', { mode: 'probability', venue, difficulty }, '正在开始远征……');
});

$('#hub-screen').addEventListener('click', event => {
  const button = event.target.closest('[data-hub-action]');
  if (button && !button.disabled && button.dataset.hubAction === 'research:abandon' && !confirm('放弃当前课题？已投入的材料与经费不会返还。')) return;
  if (button && !button.disabled) submitApi('/api/hub/action', { action: button.dataset.hubAction }, '正在更新工位存档……');
});
$('#raid-screen').addEventListener('click', event => {
  if (event.target.closest('[data-close-bag-item]')) { selectedItems.delete('bag'); renderItemDetail('bag'); return; }
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || !isProbabilityRaidView(view)) return;
  submitApi('/api/expedition/action', { action: button.dataset.action, raidId: view.raidId, revision: view.revision }, '正在提交这一步行动……');
});
$('#result-return').addEventListener('click', () => submitApi('/api/hub/return', {}, '正在返回研究工位……'));
$('#refresh-state')?.addEventListener('click', readState);
$('#hub-refresh-state').addEventListener('click', readState);
$('#setup-venue').addEventListener('change', () => {
  setupSelection.venue = $('#setup-venue').value;
  renderSetup();
});
function selectDifficulty(id, focus = false) {
  if (!hub || view || !asOptions(hub.probabilitySetup?.difficulties).some(item => item.id === id && !item.disabled)) return;
  setupSelection.difficulty = id;
  renderSetup();
  if (focus) $$('[data-difficulty-choice]').find(button => button.dataset.difficultyChoice === id)?.focus({ preventScroll: true });
}
$('#setup-difficulty-options')?.addEventListener('click', event => {
  const button = event.target.closest('[data-difficulty-choice]');
  if (button && !button.disabled) selectDifficulty(button.dataset.difficultyChoice, true);
});
$('#setup-difficulty-options')?.addEventListener('keydown', event => {
  const button = event.target.closest('[data-difficulty-choice]');
  if (!button) return;
  const ids = asOptions(hub?.probabilitySetup?.difficulties).filter(item => !item.disabled).map(item => item.id);
  const index = ids.indexOf(button.dataset.difficultyChoice);
  let next;
  if (event.key === 'ArrowRight') next = ids[(index + 1) % ids.length];
  else if (event.key === 'ArrowLeft') next = ids[(index + ids.length - 1) % ids.length];
  else if (event.key === 'Home') next = ids[0];
  else if (event.key === 'End') next = ids.at(-1);
  if (next) { event.preventDefault(); selectDifficulty(next, true); }
});
$('#equipment-picker-close')?.addEventListener('click', closeEquipmentPicker);
$('#equipment-picker')?.addEventListener('click', event => {
  const source = event.target.closest('[data-equipment-source]');
  if (source && ['owned', 'shop'].includes(source.dataset.equipmentSource)) {
    equipmentPickerSource = source.dataset.equipmentSource;
    renderEquipmentPicker();
  }
});
$('#equipment-picker')?.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeEquipmentPicker(); return; }
  const source = event.target.closest('[data-equipment-source]');
  if (!source) return;
  let next;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = equipmentPickerSource === 'owned' ? 'shop' : 'owned';
  else if (event.key === 'Home') next = 'owned';
  else if (event.key === 'End') next = 'shop';
  if (next) { event.preventDefault(); equipmentPickerSource = next; renderEquipmentPicker(); $('#equipment-source-' + next)?.focus(); }
});
document.addEventListener('click', event => {
  const cell = event.target.closest('[data-item-zone]');
  if (cell) selectItemCell(cell);
  const shortcut = event.target.closest('[data-open-workspace]');
  if (shortcut) selectWorkspace(shortcut.dataset.openWorkspace, true);
});
$('#workspace-nav')?.addEventListener('click', event => {
  const button = event.target.closest('[data-workspace-tab]');
  if (button) selectWorkspace(button.dataset.workspaceTab);
});
$('#workspace-nav')?.addEventListener('keydown', event => {
  if (!event.target.closest('[data-workspace-tab]')) return;
  const keys = Object.keys(WORKSPACES);
  const index = keys.indexOf(activeWorkspace);
  let next;
  if (event.key === 'ArrowRight') next = keys[(index + 1) % keys.length];
  else if (event.key === 'ArrowLeft') next = keys[(index + keys.length - 1) % keys.length];
  else if (event.key === 'Home') next = keys[0];
  else if (event.key === 'End') next = keys[keys.length - 1];
  if (next) { event.preventDefault(); selectWorkspace(next, true); }
});
readState();

$('#stash-sort').addEventListener('click', () => { stashSort = !stashSort; $('#stash-sort').textContent = stashSort ? '原顺序' : '整理'; renderInventory(); });
$('#stash-batch').addEventListener('click', () => { stashBatch = !stashBatch; batchItems.clear(); renderInventory(); });
$('#stash-select-all').addEventListener('click', () => { const entries = itemZones.get('stash')?.entries || []; const all = entries.filter(e => !e.item.unitPacked).map(e => String(e.key)); if(all.every(k => batchItems.has(k))) batchItems.clear(); else all.forEach(k => batchItems.add(k)); renderInventory(); });
$('#stash-bulk-sell').addEventListener('click', () => {
  const counts = {};
  for (const entry of itemZones.get('stash')?.entries || []) if (batchItems.has(String(entry.key)) && !entry.item.unitPacked) counts[entry.item.id] = (counts[entry.item.id] || 0) + 1;
  if (!Object.keys(counts).length) return;
  submitApi('/api/hub/action', { action: 'sell-batch:' + JSON.stringify(counts) }, '正在出售……');
  batchItems.clear();
});
$('#shop-categories').addEventListener('click', event => { const button = event.target.closest('[data-shop-category]'); if (!button) return; shopCategory = button.dataset.shopCategory; for(const b of $('#shop-categories').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === button)); selectedItems.delete('shop'); renderInventory(); });
