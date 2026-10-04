import { itemIconHtml } from './item-art.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value == null ? '' : value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
const attr = value => esc(value).replace(/'/g, '&#39;');
const pct = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) + '%' : '—';
const friendlyPct = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1).replace(/\.0$/, '') + '%' : '—';
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
    const chosen = String(entry.key) === selectedItems.get(zone);
    const name = item.name || entry.name || '空槽';
    const count = entry.count == null ? 1 : entry.count;
    const label = [name, entry.empty ? '空槽' : '数量 ' + count, QUALITY_NAMES[quality], entry.state || '', entry.reason || ''].filter(Boolean).join('，');
    return '<button type="button" class="item-cell quality-' + quality + (chosen ? ' is-selected' : '') + (entry.empty ? ' empty-cell' : '')
      + '" data-item-zone="' + attr(zone) + '" data-item-key="' + attr(entry.key) + '" data-item-id="' + attr(item.id || '') + '"'
      + (entry.index == null ? '' : ' data-item-index="' + attr(entry.index) + '"') + ' aria-pressed="' + chosen + '" aria-label="' + attr(label) + '" title="' + attr(label) + '">'
      + (entry.empty ? '<span class="empty-slot-symbol" aria-hidden="true">＋</span>' : itemIconHtml(item, 'item-icon-large'))
      + '<span class="cell-name">' + esc(name) + '</span>'
      + (entry.empty ? '' : '<span class="cell-count">' + (zone === 'shop' || zone === 'equipment-shop' ? '持有 ' : '×') + number(count) + '</span>')
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
    detail.innerHTML = '<div class="item-detail-placeholder"><strong>选择一个物品</strong><p>点击格子查看用途和可用操作。</p></div>';
    return;
  }
  const item = entry.item || {};
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
  else if (current === 'raid') updateAreaHeading('远征现场', '先看风险，再选择搜索、应对或撤离。');
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
    box.textContent = visibleText || '';
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
  const research = hub?.research || {};
  const stats = [
    ['研究者', identity.name || '新研究者', [school, identity.major].filter(Boolean).join(' · ')],
    ['科研经费', number(hub.funding) + ' 点'],
    ['仓库容量', number(hub.stashUsed) + ' / ' + number(hub.stashCap) + ' 格'],
    ['研究阶段', research.stageName || '本科'],
    ['远征', number(hub.raids) + ' 次 · 成功撤离 ' + number(hub.extracted) + ' 次'],
  ];
  $('#hub-stats').innerHTML = stats.map((row, index) => '<div class="stat stat-' + index + '"><label>' + esc(row[0]) + '</label><strong>' + esc(row[1]) + '</strong>' + (row[2] ? '<small>' + esc(row[2]) + '</small>' : '') + '</div>').join('');
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

function materialProbabilityHtml(materials, conditional = false) {
  return (materials || []).map(item => {
    const label = item.name || item.id;
    const rate = conditional ? item.conditionalProbability : item.hitProbability;
    const title = label + ' · ' + (conditional ? '搜获成功后类别占比 ' : '每次搜索至少发现一份 ') + pct(rate)
      + (Number(item.weightBonus) > 0 ? ' · 装备使该类别权重增加 ' + number(item.weightBonus) + '%' : '');
    return '<div data-material-id="' + attr(item.id) + '" title="' + attr(title) + '" aria-label="' + attr(title) + '">' + itemIconHtml(item, 'item-icon-small')
      + '<span>' + esc(MATERIAL_LABELS[item.id] || label) + '</span><strong>' + pct(rate) + '</strong></div>';
  }).join('');
}
function renderDifficultySetup(venues, difficulties) {
  const venue = venues.find(item => item.id === setupSelection.venue);
  const previews = venue?.difficultyPreviews || [];
  const difficulty = difficulties.find(item => item.id === setupSelection.difficulty);
  const preview = previews.find(item => item.difficultyId === setupSelection.difficulty);
  $('#setup-difficulty-options').innerHTML = difficulties.map(item => {
    const selected = item.id === setupSelection.difficulty;
    const summary = item.id === 'easy' ? '收益稍低 · 容易应对' : item.id === 'hard' ? '收益更高 · 应对更难' : '收益与风险均衡';
    return '<button type="button" data-difficulty-choice="' + attr(item.id) + '" aria-pressed="' + selected + '" '
      + (item.disabled ? 'disabled' : '') + '><strong>' + esc(item.name) + '</strong><small>' + esc(summary) + '</small></button>';
  }).join('');
  $('#setup-difficulty-description').textContent = difficulty?.description || '同步进度后可选择本局难度。';
  const riskGrowth = Number(preview?.searchGrowth) || 0;
  const pressure = riskGrowth <= 6 ? '较轻' : riskGrowth <= 10 ? '适中' : riskGrowth <= 15 ? '较高' : '很高';
  const responseText = Number(difficulty?.eventModifier) > 0 ? '遇到麻烦更容易化解。' : Number(difficulty?.eventModifier) < 0 ? '遇到麻烦更难化解。' : '按当前能力应对遇到的麻烦。';
  const summaries = preview ? [
    ['找到材料的机会', friendlyPct(preview.acquisition), '每次搜索都有一次发现机会。'],
    ['探索压力', pressure, '反复搜索会积累危险。' + responseText],
    ['完整带回的把握', friendlyPct(preview.full), '这是出发时的估计，途中会随风险变化。'],
  ] : [];
  $('#setup-difficulty-preview').innerHTML = summaries.map(([label, value, help]) => '<div class="difficulty-summary"><span>' + label + '</span><strong>' + esc(value) + '</strong><small>' + esc(help) + '</small></div>').join('') || '同步进度后可查看这次探索的情况。';
  const rows = preview ? [
    ['acquisition', '每次搜索找到材料', pct(preview.acquisition)],
    ['searchGrowth', '每次搜索增加的风险', '+' + number(preview.searchGrowth)],
    ...(Number(difficulty?.eventModifier) ? [['eventModifier', '应对成功机会相比标准难度', Number(difficulty.eventModifier) > 0 ? '提高 ' + number(difficulty.eventModifier) + ' 个百分点' : '降低 ' + number(Math.abs(difficulty.eventModifier)) + ' 个百分点']] : []),
    ['encounter', '首次搜索遇到事件', pct(preview.encounter)],
    ...(Number(preview.extraDrop) ? [['extraDrop', '找到材料后，再多找到一份', pct(preview.extraDrop)]] : []),
    ['full', '出发时完整带回', pct(preview.full)],
    ['partial', '出发时丢失一份材料', pct(preview.partial)],
    ['fail', '出发时未能带回未保护物品', pct(preview.fail)],
  ] : [];
  $('#setup-difficulty-numbers').innerHTML = rows.map(([field, label, value]) => '<div class="difficulty-metric"><span>' + label + '</span><strong data-preview-field="' + field + '">' + esc(value) + '</strong></div>').join('');
  $('#setup-material-pool').innerHTML = materialProbabilityHtml(preview?.materials || venue?.pool?.materials, true);
}

function renderResearch() {
  const research = hub.research || {};
  const skills = research.skills || {};
  const papers = research.papers || [];
  const project = research.project;
  $('#research-stage').textContent = research.nextStage ? (research.stageName || '研究阶段') + ' → ' + research.nextStage : research.stageName || '研究阶段';
  const direction = research.directions && research.directions[research.direction];
  const lines = [
    research.stageName || '',
    direction ? '方向：' + direction.name : '',
    '工程 Lv.' + (skills.engineering ?? 1) + ' · 研究 Lv.' + (skills.research ?? 1) + ' · 表达 Lv.' + (skills.expression ?? 1),
    '研究日 ' + number(research.day) + ' · 已录用 ' + papers.length + ' 篇 · 实验能力 ' + number(research.capacity),
  ];
  if (project) lines.push('当前项目：' + (project.title || project.type) + ' · ' + project.status + ' · 实验 ' + number(project.runs) + '/6 轮 · 质量 ' + number(project.quality) + '/' + number(project.target));
  if (research.promotionReasons && research.promotionReasons.length) lines.push('晋升条件：' + research.promotionReasons.join('；'));

  const templates = research.templates || [];
  const starter = templates.find(template => template.id === 'replicate') || templates[0];
  const inventory = new Map(stashItems().map(item => [item.id, item]));
  const experiment = (research.actions || []).find(action => action.id === 'research:experiment');
  if (project && experiment?.disabled && experiment.reason) lines.push('当前实验缺口：' + experiment.reason);
  if (!project && starter) {
    const needs = Object.entries(starter.materials || {}).map(([id, count]) => {
      const item = inventory.get(id);
      const available = Math.max(0, Number(item?.count || 0) - Number(item?.packedCount || 0));
      return { id, name: item?.name || itemCatalog().get(id)?.name || id, need: count, missing: Math.max(0, count - available) };
    }).filter(item => item.missing);
    if (needs.length) lines.push('复现缺口：' + needs.map(item => item.name + ' ×' + item.missing).join('、'));
    const computeAvailable = Math.max(0, Number(inventory.get('compute')?.count || 0) - Number(inventory.get('compute')?.packedCount || 0));
    if (computeAvailable < 2) lines.push('实验准备：算力卡 ' + computeAvailable + '/2；可通过探索、资源交换或商店补齐。');
  }
  $('#research-profile').innerHTML = lines.filter(Boolean).map(line => '<div>' + esc(line) + '</div>').join('');
  $('#setup-gap').textContent = lines.filter(line => /^(当前实验缺口|复现缺口|实验准备)：/.test(line)).join('；')
    || (project ? '当前课题：' + (project.title || '研究项目') + '。带回算力后可继续实验。' : '研究材料已齐，可在工作台创建课题；也可搜集下一轮所需算力。');

  const directions = Object.entries(research.directions || {}).map(([id, item]) => {
    const label = (id === research.direction ? '● ' : '') + (item.name || id);
    const disabled = Boolean(project) || id === research.direction;
    return hubButton('research:direction:' + id, label, disabled, project ? '请先完成或放弃当前项目' : '');
  }).join('');
  const actions = (research.actions || []).map(action => '<div>' + hubButton(action.id, action.name, action.disabled, action.reason)
    + (action.reason ? '<small class="disabled-reason">' + esc(action.reason) + '</small>' : '') + '</div>').join('');
  $('#research-actions').innerHTML = directions + actions;

  const shopNames = new Map((hub.shop || []).map(item => [item.id, item.name]));
  $('#research-templates').innerHTML = project
    ? '<article class="item-card"><div class="item-copy"><div class="item-title">' + esc(project.title || project.type) + '</div><div class="meta">' + esc(project.status || '') + ' · 已完成 ' + number(project.runs) + '/6 轮 · 质量 ' + number(project.quality) + '/' + number(project.target) + '</div></div></article>'
    : templates.map(template => {
      const materials = Object.entries(template.materials || {}).map(([id, count]) => (shopNames.get(id) || id) + ' ×' + count).join('、');
      return '<article class="item-card"><div class="item-copy"><div class="item-title">' + esc(template.name) + '</div><div class="meta">立项材料：' + esc(materials) + ' · ' + number(template.cost) + ' 经费</div><div class="item-controls">' + hubButton('research:start:' + template.id, '创建课题', template.disabled, template.reason) + '</div>' + (template.reason ? '<small class="disabled-reason">' + esc(template.reason) + '</small>' : '') + '</div></article>';
    }).join('') || '<div class="empty">当前没有可创建的研究项目。</div>';
  $('#research-preparations').innerHTML = (research.preparations || []).map(item => hubButton('research:prepare:' + item.id, '整理 ' + item.inputName + ' → ' + item.outputName, item.disabled, item.reason)).join('');
  $('#research-papers').innerHTML = papers.length
    ? '<strong>已录用论文 ' + papers.length + ' 篇</strong><div class="meta">' + papers.slice(-4).reverse().map(paper => esc(paper.title || paper.type || '研究论文') + ' · 质量 ' + number(paper.quality)).join('<br>') + '</div>'
    : '<span class="meta">尚无已录用论文；完成实验、投稿与审稿后会记录于此。</span>';
}

function renderInventory() {
  const catalog = itemCatalog();
  const items = storedItems();
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
  renderItemZone('supplies', '#hub-supplies', '#supplies-item-detail', supplies.map(row => {
    const item = row.item || catalog.get(row.id) || { id: row.id, name: row.id };
    return { key: row.id, item, count: row.count, state: '已预留', actions: hubButton('unpack:' + row.id, '卸下一件补给') };
  }), '没有预留补给，可从仓库中带入。');

  $('#stash-count').textContent = number(hub.stashUsed) + ' / ' + number(hub.stashCap) + ' 格';
  renderWarehouseUpgrade();
  renderItemZone('stash', '#hub-stash', '#stash-item-detail', items.map(item => {
    const equipped = Boolean(item.equipped || item.equippedSlots && item.equippedSlots.length);
    const packed = Number(item.packedCount || 0);
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
    return { key: item.id, item, count: item.count, state: equipped ? '备用同款' : packed ? '预留 ' + packed : '',
      description: bonusText(item) + (packed ? ' 其中 ' + packed + ' 件已预留，不能出售或再次预留。' : ''), actions };
  }), '仓库为空。');

  renderItemZone('shop', '#hub-shop', '#shop-item-detail', (hub.shop || []).map(item => {
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
  $('#warehouse-level').textContent = upgrade ? number(Number(upgrade.level) + 1) + ' / ' + number(Number(upgrade.maxLevel) + 1) : '—';
  $('#warehouse-upgrade-summary').textContent = !upgrade ? '同步进度后可查看扩容方案。' : maximum ? '已达到最大容量 ' + number(hub.stashCap) + ' 格。'
    : '再增加 ' + number(Number(upgrade.nextCap) - Number(upgrade.currentCap)) + ' 格：' + number(upgrade.currentCap) + ' → ' + number(upgrade.nextCap) + ' 格';
  $('#warehouse-upgrade-price').textContent = !upgrade || maximum ? '' : number(upgrade.cost) + ' 经费';
  $('#warehouse-upgrade-price').closest('.warehouse-upgrade-price')?.classList.toggle('hidden', !upgrade || maximum);
  const disabled = !upgrade || maximum || Boolean(upgrade.disabled);
  button.dataset.serverDisabled = String(disabled);
  button.disabled = disabled || pending || uncertainMutation;
  button.textContent = maximum ? '仓库已满级' : upgrade ? '花 ' + number(upgrade.cost) + ' 经费扩容' : '等待仓库配置';
  $('#warehouse-upgrade-reason').textContent = upgrade?.reason || '';
}

function exitAction(action) {
  return action.endsRaid === true || Boolean(action.exitProbabilities) || action.id === 'respond:leave';
}
function exitPreview(probabilities) {
  return '完整 ' + pct(probabilities.full) + ' / 部分 ' + pct(probabilities.partial) + ' / 失败 ' + pct(probabilities.fail);
}
function plainOutcome(value) {
  return String(value || '').replaceAll('实际后果：', '结果：')
    .replace(/接应支持\s*\+[\d.]+（部分带回率\s*([\d.]+)%→([\d.]+)%）/g, '接应更可靠（丢失部分物资的机会 $1%→$2%）')
    .replaceAll('检定未通过。', '这次没能解决问题。')
    .replaceAll('无检定；该方案按 100% 成功结算。', '按所列消耗执行，不会额外失败。');
}
function renderGenericActions(target, actions, skip, probabilities) {
  const shouldSkip = skip || (() => false);
  const list = (actions || []).filter(action => !shouldSkip(action));
  target.innerHTML = list.map(action => {
    const cost = formatCost(action.cost);
    const isLeave = exitAction(action);
    const probabilityLabel = action.id === 'search' ? '找到材料的机会 ' : /^(respond|event):/.test(action.id) ? '应对成功机会 ' : '成功机会 ';
    const probability = action.probability == null || isLeave ? '' : probabilityLabel + pct(action.probability);
    const searchEvent = action.searchPreview?.encounter == null ? '' : '事件触发 ' + pct(action.searchPreview.encounter);
    const exit = action.exitProbabilities || (action.id === 'extract' ? probabilities : null);
    const exitOdds = exit ? (isLeave ? '直接撤离：' : '当前带回概率：') + exitPreview(exit) : '';
    const fallbackSearchCost = action.id === 'search' && !cost ? '心力 −1' : '';
    const effect = !isLeave && (action.success || action.failure) ? '成功：' + (action.success || '—') + ' · 未解决：' + (action.failure || '—') : '';
    const detail = [cost || fallbackSearchCost, probability, searchEvent, exitOdds, effect, action.reason || ''].filter(Boolean).join(' · ');
    const primary = action.id === 'search' || action.id === 'extract';
    return '<button type="button" class="button ' + (primary ? 'primary' : '') + '" data-action="' + attr(action.id)
      + '" data-server-disabled="' + (action.disabled ? 'true' : 'false') + '" ' + (action.disabled || pending || uncertainMutation ? 'disabled' : '')
      + (action.reason ? ' title="' + attr(action.reason) + '"' : '') + '>' + esc(action.name || action.id)
      + (detail ? '<small>' + esc(detail) + '</small>' : '') + '</button>';
  }).join('') || '<span class="tiny">当前没有可执行行动。</span>';
}

function renderEventChoices(actions, hasPendingLoot = false) {
  $('#event-choices').innerHTML = (actions || []).map((action, index) => {
    const leave = exitAction(action);
    const awaitingLoot = leave && action.disabled && hasPendingLoot;
    const cost = formatCost(action.cost);
    const descriptionId = 'event-choice-detail-' + index;
    const probability = awaitingLoot ? '先整理本轮发现 · 整理后更新撤离概率' : leave ? '结束本局 · 按下方分布结算' : action.probability == null ? '' : '应对成功机会 ' + friendlyPct(action.probability);
    const outcomes = awaitingLoot ? '<div class="notice-box decision-exit">背包整理完成后，可查看并执行新的撤离方案。</div>' : leave && action.exitProbabilities
      ? '<div class="notice-box decision-exit">撤离结算：' + esc(exitPreview(action.exitProbabilities)) + '</div>'
      : '<div class="decision-outcomes"><div class="decision-success">' + esc(plainOutcome(action.success || '按方案执行'))
        + '</div><div class="decision-failure">' + esc(plainOutcome(action.failure || '无额外变化')) + '</div></div>';
    return '<article class="decision-option' + (action.disabled ? ' is-disabled' : '') + '"><button type="button" class="button" data-action="' + attr(action.id)
      + '" data-server-disabled="' + Boolean(action.disabled) + '" aria-describedby="' + descriptionId + '" '
      + (action.disabled || pending || uncertainMutation ? 'disabled' : '') + '>' + esc(action.name || action.id)
      + (probability ? '<small>' + esc(probability) + '</small>' : '') + '</button><div id="' + descriptionId + '">'
      + '<div class="decision-cost"><span class="cost-chip">' + esc(cost || '无资源消耗') + '</span></div>' + outcomes
      + (action.reason ? '<p class="disabled-reason">' + esc(action.reason) + '</p>' : '') + '</div></article>';
  }).join('');
}

function formatCost(cost) {
  if (cost == null || cost === '') return '';
  if (typeof cost !== 'object') return String(cost);
  return Object.entries(cost).map(([key, value]) => key + ' ' + value).join(' · ');
}

function renderProbabilityParts(parts) {
  function flatten(value, prefix) {
    if (Array.isArray(value)) return value.flatMap((entry, index) => flatten(entry, prefix + (index + 1) + ' '));
    if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => flatten(entry, prefix + key + ' · '));
    return [{ label: prefix || '因素', value }];
  }
  const rows = flatten(parts, '');
  $('#probability-parts').innerHTML = rows.map(row => '<div class="parts-row"><span>' + esc(row.label) + '</span><span>'
    + esc(typeof row.value === 'number' ? Number.isInteger(row.value) ? row.value : row.value.toFixed(1) : row.value) + '</span></div>').join('')
    || '<span class="tiny">服务器未提供分项。</span>';
}

function renderTurnResult(current) {
  const action = current.lastAction;
  $('#raid-turn-card').classList.toggle('hidden', !action);
  if (!action) return;
  $('#raid-turn-title').textContent = action.title || '本轮结果';
  $('#raid-turn-text').textContent = plainOutcome(action.text);
  const changes = [['心力', action.willDelta, false], ['风险', action.riskDelta, true], ['人脉', action.networkDelta, false]];
  $('#raid-turn-changes').innerHTML = changes.filter(([, value]) => Number.isFinite(value) && value !== 0).map(([label, value, harmfulIncrease]) => {
    const good = harmfulIncrease ? value < 0 : value > 0;
    return '<span class="turn-change ' + (good ? 'positive' : 'negative') + '">' + label + ' ' + (value > 0 ? '+' : '−') + number(Math.abs(value)) + '</span>';
  }).join('');
  $('#raid-turn-items').innerHTML = (action.itemsAdded || []).map(item => '<div class="turn-item">' + itemIconHtml(item, 'item-icon-small')
    + '<div>' + esc(item.name || item.id) + '</div>' + (item.pending ? '<span class="tiny">待整理</span>' : '') + '</div>').join('');
}

function renderEncounterPacing(current) {
  const pacing = current.encounterPacing;
  let text = '本局事件 ' + number(pacing.eventsUsed) + ' / ' + number(pacing.eventsLimit);
  text += pacing.reason ? ' · ' + pacing.reason : '';
  if (!current.event && !pacing.cooldown && Number.isFinite(pacing.searchesUntilGuaranteed) && pacing.searchesUntilGuaranteed > 0) {
    text += ' · 最迟 ' + number(pacing.searchesUntilGuaranteed) + ' 次有效搜索内遇到事件';
  }
  $('#encounter-pacing').textContent = text;
}

function renderRaid(current) {
  const probabilities = current.probabilities || {};
  const stats = current.stats || {};
  const venue = current.venue || {};
  const difficulty = current.difficulty;
  const school = typeof current.player?.school === 'object' ? current.player.school.name : current.player?.school;
  const configuration = (difficulty.name || difficulty.id) + '难度';
  $('#raid-heading').textContent = [venue.name || venue.id || '概率远征', configuration].filter(Boolean).join(' · ');
  $('#raid-status').textContent = current.status === 'ended' ? '已结算' : '行动中';
  $('#raid-statusline').innerHTML = '<strong>' + esc(current.player?.name || '研究者') + '</strong><span>' + esc(difficulty.description || '')
    + '</span><span>心力 ' + number(stats.will) + '/' + number(stats.willMax) + '</span><span>人脉 ' + number(stats.network)
    + '</span><span>风险 ' + number(stats.risk) + '</span>';
  const risk = Math.max(0, Math.min(100, Number(stats.risk) || 0));
  $('#risk-meter-fill').style.width = risk + '%';
  $('.risk-meter').setAttribute('aria-valuenow', String(risk));
  $('#prob-acquisition').textContent = pct(probabilities.acquisition);
  $('#raid-material-probabilities').innerHTML = materialProbabilityHtml(probabilities.materials);
  $('#raid-material-probabilities').closest('details').hidden = !probabilities.materials?.length;
  $('#prob-encounter').textContent = pct(probabilities.encounter);
  $('#prob-full').textContent = pct(probabilities.full);
  $('#prob-partial').textContent = pct(probabilities.partial);
  $('#prob-fail').textContent = pct(probabilities.fail);
  $('#encounter-reason').textContent = probabilities.encounterReason || '';
  renderEncounterPacing(current);
  renderTurnResult(current);
  renderProbabilityParts(probabilities.parts);
  $('#bag-capacity').textContent = number(current.bagUsed) + ' / ' + number(current.bagCap);
  const actions = current.actions || [];
  const bagActions = actions.filter(action => /^(drop|use|backup):/.test(action.id));
  const bag = current.bag || [];
  const bagEntries = bag.map((item, index) => {
    const applicable = bagActions.filter(action => action.id.endsWith(':' + index));
    const controls = applicable.map(action => '<button class="button small" data-action="' + attr(action.id) + '" data-server-disabled="' + (action.disabled ? 'true' : 'false') + '" '
      + (action.disabled || pending || uncertainMutation ? 'disabled' : '') + (action.reason ? ' title="' + attr(action.reason) + '"' : '') + '>' + esc(action.name) + '</button>').join('');
    return { key: current.raidId + ':' + current.revision + ':' + index + ':' + item.id, item, index, count: 1,
      state: item.protected ? '已备份' : '', actions: controls || '<span class="tiny">这件物品暂时没有可用操作。</span>' };
  });
  const cancelBackup = actions.find(action => action.id === 'backup:none');
  if (cancelBackup) bagEntries.filter(entry => entry.item.protected).forEach(entry => {
    entry.actions += actionButton(cancelBackup.id, cancelBackup.name, cancelBackup.disabled, cancelBackup.reason, '');
  });
  renderItemZone('bag', '#raid-bag', '#bag-item-detail', bagEntries, '还没有随身收获。');
  const leader = current.player || {};
  $('#raid-team').innerHTML = '<div class="item-card"><div class="player-avatar" role="img" aria-label="研究者朝南"></div><div class="item-copy"><div class="item-title">' + esc(leader.name || '研究者')
    + '</div><div class="meta">' + esc(school || '') + ' ' + esc(leader.major || '') + '</div></div></div>';
  $('#raid-objective').textContent = current.objective?.text || researchPreparationText() + ' 材料按地点自然出现，带回后投入研究。';
  $('#raid-log').innerHTML = (current.log || []).slice(-30).reverse().map(entry => '<div class="log-row">' + esc(entry.text || entry.message || '') + '</div>').join('')
    || '<div class="empty">行动记录会显示在这里。</div>';
  const event = current.event && current.event.id ? current.event : null;
  $('#raid-event-card').classList.toggle('hidden', !event);
  ['opportunity', 'danger', 'social'].forEach(tone => $('#raid-event-card').classList.toggle('tone-' + tone, event?.tone === tone));
  if (event) {
    $('#event-title').textContent = [event.name, event.title].filter(Boolean).join(' · ') || '临场遭遇';
    $('#event-text').textContent = event.text || '';
    $('#event-type-label').textContent = event.typeLabel || '人物交流';
    $('#event-image').src = EVENT_ART.has(event.image) ? event.image : '/assets/generated/scholar.png';
    $('#event-image').alt = event.typeLabel || '人物交流';
    renderEventChoices(event.actions || [], Boolean(current.pendingLoot?.length));
  } else {
    $('#event-title').textContent = '';
    $('#event-text').textContent = '';
    $('#event-choices').replaceChildren();
  }
  const pendingLoot = current.pendingLoot || [];
  const exitHint = $('#extraction-hint-text');
  if (exitHint) exitHint.textContent = event && pendingLoot.length ? '先处理当前遭遇和待整理发现，再选择下一步。' : event ? '先处理当前遭遇；也可在遭遇中选择直接撤离。'
    : pendingLoot.length ? '先整理本轮发现，再按当前概率选择搜索或撤离。' : '撤离会立即按当前完整、部分、失败概率结算。';
  $('#pending-loot-card').classList.toggle('hidden', !pendingLoot.length);
  renderItemZone('pending', '#pending-loot-items', '#pending-item-detail', pendingLoot.map((item, index) => ({
    key: current.raidId + ':' + current.revision + ':' + index, item, index, state: '尚未拿取',
    description: bonusText(item) + ' 这件发现尚未进入背包，请在本轮发现区域选择拿取或放弃。',
  })));
  renderGenericActions($('#pending-loot-actions'), actions, action => !action.id.startsWith('take:'));
  renderGenericActions($('#raid-actions'), actions, action => /^(drop|use|backup|take|respond|event):/.test(action.id), probabilities);
  renderResult(current);
}

function renderResult(current) {
  const result = current.result || {};
  const ended = current.status === 'ended';
  $('#result-screen').classList.toggle('hidden', !ended);
  if (!ended) return;
  const labels = { clean: '完整撤离', messy: '部分撤离', scatter: '行动失败', complete: '完整撤离', partial: '部分撤离', fail: '行动失败' };
  $('#result-title').textContent = labels[result.kind] || result.title || '本局结算';
  $('#result-summary').textContent = result.summary || result.text || '';
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
  const odds = result.probabilities || current.probabilities || {};
  $('#result-full').textContent = pct(odds.full);
  $('#result-partial').textContent = pct(odds.partial);
  $('#result-fail').textContent = pct(odds.fail);
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
    if (equippedItemId && equipmentPickerSlot === previousPickerSlot) {
      const cell = $$('[data-item-zone="equipment-owned"]').find(button => button.dataset.itemId === equippedItemId);
      cell?.focus({ preventScroll: true });
    }
    restoreActionFocus(focusOrigin);
  }
}

function focusRaidStep(previous, action) {
  let card;
  if (view.pendingLoot?.length && (!previous?.pendingLoot?.length || action?.startsWith('take:'))) card = $('#pending-loot-card');
  else if (view.event && (!previous?.event || previous.event.id !== view.event.id || action?.startsWith('take:'))) card = $('#raid-event-card');
  else if ((view.lastAction && view.revision !== previous?.revision) || action === 'search' || /^(respond|event):/.test(action || '')) card = $('#raid-turn-card');
  if (!card || card.classList.contains('hidden')) return;
  const focus = card.querySelector('button:not(:disabled)') || card.querySelector('h2');
  if (focus) { if (focus.tagName !== 'BUTTON') focus.tabIndex = -1; focus.focus({ preventScroll: true }); }
  card.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
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
  if (button && !button.disabled) submitApi('/api/hub/action', { action: button.dataset.hubAction }, '正在更新工位存档……');
});
$('#raid-screen').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || !isProbabilityRaidView(view)) return;
  submitApi('/api/expedition/action', { action: button.dataset.action, raidId: view.raidId, revision: view.revision }, '正在提交这一步行动……');
});
$('#result-return').addEventListener('click', () => submitApi('/api/hub/return', {}, '正在返回研究工位……'));
$('#refresh-state').addEventListener('click', readState);
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
