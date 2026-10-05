import { ITEMS } from './content.js';
import { GEAR, SHOP_ITEMS } from './loot-content.js';
import { EQUIPMENT_SLOTS, normalizeResearch, researchView, researchAct, learnFromRaid, VENUES, skillLevels } from './research.js';
import { createProbabilityRaid, isProbabilityDifficulty, probabilitySetup, PROBABILITY_MODE } from './probability-raid.js';
import { createIdentity } from './identity.js';
import { normalizeStories, storyJournal } from './academic-stories.js';

export { probabilitySetup };

export const STASH_CAP = 40;
const clone = (value) => structuredClone(value);
const toCount = (value) => Math.max(0, Math.floor(Number(value) || 0));
const MAX_SUPPLIES = 3;
const WAREHOUSE_MAX_LEVEL = 4;
const WAREHOUSE_UPGRADE_COSTS = [200, 500, 1000, 1800];
const SUPPLY_SHOP = [
  { id: 'coffee_ticket', price: 50, sellPrice: 5 },
  { id: 'stomach_pill', price: 60, sellPrice: 6 },
  { id: 'compute', price: 60, sellPrice: 30 },
  { id: 'dataset', price: 40, sellPrice: 20 },
  { id: 'src_code', price: 50, sellPrice: 25 },
  { id: 'wind', price: 25, sellPrice: 10 },
];

function itemDef(id) {
  return GEAR[id] || ITEMS[id] || null;
}

function gearDef(id) {
  const item = itemDef(id);
  return item?.gear || item?.slot ? item : null;
}

function isSupply(id) {
  const item = ITEMS[id];
  return !!item?.use && !item.gear;
}

function normalizeSupplies(value, stash) {
  const supplies = [];
  const reserved = {};
  for (const id of Array.isArray(value) ? value : []) {
    if (supplies.length >= MAX_SUPPLIES || typeof id !== 'string' || !isSupply(id)) continue;
    reserved[id] = (reserved[id] || 0) + 1;
    if (reserved[id] > toCount(stash[id])) {
      reserved[id] -= 1;
      continue;
    }
    supplies.push(id);
  }
  return supplies;
}

function packedCount(profile, id) {
  return (profile.supplies || []).reduce((count, packedId) => count + (packedId === id ? 1 : 0), 0);
}

function gearValues() {
  return Object.values(GEAR || {}).filter((item) => item?.id && item?.slot);
}

function blankLoadout() {
  return Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null]));
}

function normalizeLoadout(value, stash, heldIds = []) {
  const out = blankLoadout();
  const held = new Set(heldIds);
  for (const slot of EQUIPMENT_SLOTS) {
    const id = typeof value?.[slot] === 'string' ? value[slot] : null;
    const gear = id && gearDef(id);
    if (gear?.slot === slot && (toCount(stash[id]) > 0 || held.has(id))) out[slot] = id;
  }
  return out;
}

function initialInventory() {
  const stash = {};
  const loadout = blankLoadout();
  for (const gear of gearValues()) {
    if (gear.rarity !== 'common' || !EQUIPMENT_SLOTS.includes(gear.slot) || loadout[gear.slot]) continue;
    loadout[gear.slot] = gear.id;
    stash[gear.id] = (stash[gear.id] || 0) + 1;
  }
  if (ITEMS.coffee_ticket) stash.coffee_ticket = 2;
  return { stash, loadout };
}

function profileDefaults(seed) {
  const inventory = initialInventory();
  return {
    funding: 800,
    identity: createIdentity(seed >>> 0),
    achievement: 0,
    network: 0,
    raids: 0,
    extracted: 0,
    lastReport: null,
    warehouseLevel: 0,
    stashCap: STASH_CAP,
    stash: inventory.stash,
    overflow: [],
    supplies: [],
    loadout: inventory.loadout,
    settledRaidIds: [],
    migratedLegacyRunIds: [],
    migrationNotice: null,
    research: normalizeResearch({ balanceVersion: 2 }, seed),
    venue: 'conference',
    contacts: {},
    stories: normalizeStories(),
  };
}

function overflowCount(profile) {
  return (profile.overflow || []).reduce((sum, row) => sum + toCount(row.count), 0);
}

function normalizeWarehouseLevel(value, legacyCap = STASH_CAP) {
  const hasLevel = value !== null && value !== undefined && Number.isFinite(Number(value));
  const candidate = hasLevel ? Number(value) : Math.round((Number(legacyCap) - STASH_CAP) / 20);
  return Math.max(0, Math.min(WAREHOUSE_MAX_LEVEL, Math.floor(Number(candidate) || 0)));
}

function warehouseCapacity(profile) {
  return STASH_CAP + normalizeWarehouseLevel(profile?.warehouseLevel, profile?.stashCap) * 20;
}

function equippedCount(profile, id) {
  return EQUIPMENT_SLOTS.reduce((count, slot) => count + Number(profile?.loadout?.[slot] === id), 0);
}

function ownedCount(profile, id) {
  return Math.max(toCount(profile?.stash?.[id]), equippedCount(profile, id));
}

function storedCount(profile, id) {
  return Math.max(0, toCount(profile?.stash?.[id]) - equippedCount(profile, id));
}

function storageCount(profile) {
  return Object.keys(profile?.stash || {}).reduce((sum, id) => sum + storedCount(profile, id), 0);
}

function includeEquippedCopies(profile) {
  const stash = { ...(profile.stash || {}) };
  for (const id of new Set(EQUIPMENT_SLOTS.map(slot => profile.loadout?.[slot]).filter(Boolean))) {
    stash[id] = Math.max(toCount(stash[id]), equippedCount(profile, id));
  }
  return { ...profile, stash };
}

export function createCareer(seed = Date.now() >>> 0) {
  return { version: 2, profile: profileDefaults(seed), run: null };
}

function normalizeOverflow(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row) => row && itemDef(String(row.id)))
    .map((row) => ({ id: String(row.id), count: toCount(row.count) }))
    .filter((row) => row.count > 0);
}

function migrationRunId(run) {
  for (const key of ['raidId', 'cid', 'id']) {
    if (typeof run?.[key] === 'string' && run[key]) return run[key];
  }
  const signature = [run?.mode || '2d', run?.probabilityVersion || 0, run?.seed ?? 'unknown',
    run?.tick ?? 'na', run?.node || '', run?.status || '', run?.actionIndex ?? 'na'].join('|');
  let hash = 2166136261;
  for (const char of signature) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-${(hash >>> 0).toString(36)}`;
}

function recordLegacyMigration(profile, sourceRunId, kind, text) {
  profile.migratedLegacyRunIds ||= [];
  if (!profile.migratedLegacyRunIds.includes(sourceRunId)) profile.migratedLegacyRunIds.push(sourceRunId);
  profile.migrationNotice = { sourceRunId, kind, text };
}

function hasLegacyMigration(profile, sourceRunId) {
  return Array.isArray(profile.migratedLegacyRunIds) && profile.migratedLegacyRunIds.includes(sourceRunId);
}

function validRunItems(value) {
  return Array.isArray(value) ? value.filter(id => typeof id === 'string' && itemDef(id)) : [];
}

function loadoutFromRun(run, fallback) {
  if (!Array.isArray(run?.loadout)) return fallback;
  const out = blankLoadout();
  for (const id of run.loadout) {
    const gear = gearDef(id);
    if (gear?.gear && EQUIPMENT_SLOTS.includes(gear.slot) && !out[gear.slot]) out[gear.slot] = id;
  }
  return out;
}

function restoreLegacyLoadout(profile, run, useDefaultCopy = false, baselineStash = profile.stash) {
  const defaultCopies = {};
  for (const id of Array.isArray(run?.loadout) ? run.loadout : []) {
    const gear = gearDef(id);
    if (!gear?.gear || !EQUIPMENT_SLOTS.includes(gear.slot)) continue;
    if (useDefaultCopy && toCount(baselineStash[id]) > (defaultCopies[id] || 0)) {
      defaultCopies[id] = (defaultCopies[id] || 0) + 1;
      continue;
    }
    addToInventory(profile, id, 1);
  }
}

function fallbackResultItems(result) {
  for (const key of ['returnedIds', 'returnedItems', 'carriedItems', 'returned', 'carried']) {
    if (Array.isArray(result?.[key])) return validRunItems(result[key]);
  }
  return [];
}

function safeFinalizeLegacyResult(profile, run, sourceRunId, { singleRun = false } = {}) {
  const result = run.result || {};
  const baselineStash = { ...(profile.stash || {}) };
  const kind = result.kind;
  const probabilityRaid = run.mode === PROBABILITY_MODE;
  const cleanOrMessy = kind === 'clean' || kind === 'messy';
  const hasCanonical = Array.isArray(result.archivedIds) || Array.isArray(result.carriedIds);
  const archivedIds = hasCanonical ? validRunItems(result.archivedIds) : [];
  const carriedIds = hasCanonical ? validRunItems(result.carriedIds) : fallbackResultItems(result);
  const items = kind === 'scatter' ? archivedIds : [...archivedIds, ...carriedIds];
  addUniqueIds(profile, items);

  const returnedLoadoutIds = !probabilityRaid && cleanOrMessy ? validRunItems(result.returnedLoadoutIds) : [];
  if (!probabilityRaid && cleanOrMessy) {
    const defaultCopies = {};
    for (const id of returnedLoadoutIds) {
      if (singleRun && toCount(baselineStash[id]) > (defaultCopies[id] || 0)) {
        defaultCopies[id] = (defaultCopies[id] || 0) + 1;
        continue;
      }
      addToInventory(profile, id, 1);
    }
  }
  if (!probabilityRaid) {
    const returnedSet = new Set(returnedLoadoutIds);
    for (const slot of EQUIPMENT_SLOTS) {
      const selected = profile.loadout[slot];
      if (selected && Array.isArray(run.loadout) && run.loadout.includes(selected) && !returnedSet.has(selected)) {
        profile.loadout[slot] = null;
      }
    }
  }

  const converted = result.converted || {};
  const fundsReturned = !probabilityRaid && cleanOrMessy ? Math.max(0, Math.floor(Number(converted['经费']) || 0)) : 0;
  if (!probabilityRaid) {
    profile.funding += fundsReturned;
    profile.achievement += Number(converted['成果']) || 0;
    profile.network += Number(converted['人脉']) || 0;
  } else {
    const networkBefore = Math.max(0, Math.floor(Number(run.initialNetwork) || 0));
    const networkAfter = Math.max(0, Math.floor(Number(run.stats?.network) || 0));
    profile.network = Math.max(0, (Number(profile.network) || 0) + networkAfter - networkBefore);
    profile.contacts ||= {};
    for (const [npcId, update] of Object.entries(run.contactUpdates || {})) {
      const old = profile.contacts[npcId] || {};
      profile.contacts[npcId] = {
        ...old,
        name: update.name || old.name || npcId,
        trust: Math.max(-3, Math.min(3, (Number(old.trust) || 0) + (Number(update.trustDelta) || 0))),
        meetings: Math.max(0, Math.floor(Number(old.meetings) || 0)) + Math.max(0, Math.floor(Number(update.meetings) || 0)),
        lastImpression: update.lastImpression || old.lastImpression || '',
        outcome: update.outcome || old.outcome || null,
      };
    }
  }

  profile.raids += 1;
  if (cleanOrMessy) profile.extracted += 1;
  const returnedLoadout = probabilityRaid ? 0 : returnedLoadoutIds.length;
  const convertedNetwork = probabilityRaid
    ? Math.max(0, Math.floor(Number(run.stats?.network) || 0)) - Math.max(0, Math.floor(Number(run.initialNetwork) || 0))
    : Number(converted['人脉']) || 0;
  profile.lastReport = {
    kind: kind || 'unknown',
    returnedCount: items.length,
    fundsReturned,
    achievement: probabilityRaid ? 0 : Number(converted['成果']) || 0,
    network: convertedNetwork,
    loadoutReturned: returnedLoadout,
    loadoutLost: probabilityRaid ? 0 : Math.max(0, (Array.isArray(run.loadout) ? run.loadout.length : 0) - returnedLoadout),
    overflowCount: overflowCount(profile),
    raidId: sourceRunId,
  };
  profile.settledRaidIds ||= [];
  if (!profile.settledRaidIds.includes(sourceRunId)) profile.settledRaidIds.push(sourceRunId);
  recordLegacyMigration(profile, sourceRunId, 'settled-result', '已按旧局保存的实际撤离结果完成结算；没有重新掷骰或增加研究经验。');
}

function recoverLegacyActive(profile, run, sourceRunId, { singleRun = false } = {}) {
  const probabilityRaid = run.mode === PROBABILITY_MODE;
  const baselineStash = { ...(profile.stash || {}) };
  if (!probabilityRaid && singleRun) profile.loadout = loadoutFromRun(run, profile.loadout);
  const heldItems = probabilityRaid
    ? validRunItems(run.bag)
    : [...validRunItems(run.archive), ...validRunItems(run.bag)];
  addUniqueIds(profile, heldItems);

  if (probabilityRaid) {
    addPendingItemsToOverflow(profile, run.pendingLoot);
  } else {
    restoreLegacyLoadout(profile, run, singleRun, baselineStash);
    profile.funding += Math.max(0, Math.floor(Number(run.stats?.funding) || 0));
    if (singleRun) {
      profile.achievement = Math.max(0, Number(run.stats?.achievement) || 0);
      profile.network = Math.max(0, Math.floor(Number(run.stats?.network) || 0));
    }
  }
  recordLegacyMigration(profile, sourceRunId, probabilityRaid ? 'old-probability-recovered' : 'old-expedition-recovered',
    probabilityRaid
      ? '旧版远征已回收背包物品；待整理发现保存在溢出仓，装备与奖励未重复发放。'
      : '旧版远征已安全回收背包、归档物品、装备和剩余经费，并返回工位；没有补发论文或研究经验。');
}

function normalizeVersion2(raw) {
  const fallback = profileDefaults((Date.now() >>> 0));
  const source = raw.profile || {};
  const run = raw.run && typeof raw.run === 'object' ? clone(raw.run) : null;
  const stash = {};
  if (Array.isArray(source.stash)) {
    for (const row of source.stash) {
      const id = String(row?.id || '');
      if (itemDef(id)) stash[id] = (stash[id] || 0) + toCount(row.count ?? 1);
    }
  } else {
    for (const [id, count] of Object.entries(source.stash || {})) {
      if (itemDef(id) && toCount(count)) stash[id] = toCount(count);
    }
  }
  const identity = source.identity && typeof source.identity === 'object'
    ? clone(source.identity)
    : fallback.identity;
  const warehouse = normalizeWarehouseLevel(source.warehouseLevel, source.stashCap);
  const profile = {
    ...fallback,
    ...clone(source),
    identity,
    contacts: source.contacts && typeof source.contacts === 'object' && !Array.isArray(source.contacts) ? clone(source.contacts) : {},
    stories: normalizeStories(source.stories),
    research: normalizeResearch(source.research, Number(run?.seed) || 1),
    venue: Object.hasOwn(VENUES, source.venue) ? source.venue : 'conference',
    funding: Math.max(0, Math.floor(Number(source.funding) || 0)),
    achievement: Number(source.achievement) || 0,
    network: Number(source.network) || 0,
    raids: toCount(source.raids),
    extracted: toCount(source.extracted),
    lastReport: source.lastReport && typeof source.lastReport === 'object' ? clone(source.lastReport) : null,
    warehouseLevel: warehouse,
    stashCap: STASH_CAP + warehouse * 20,
    stash,
    overflow: normalizeOverflow(source.overflow),
    supplies: normalizeSupplies(source.supplies, stash),
    loadout: normalizeLoadout(source.loadout, stash,
      run && !run.settled && Array.isArray(run.loadout) ? run.loadout : []),
    settledRaidIds: Array.isArray(source.settledRaidIds)
      ? source.settledRaidIds.filter((id) => typeof id === 'string')
      : [],
    migratedLegacyRunIds: Array.isArray(source.migratedLegacyRunIds)
      ? source.migratedLegacyRunIds.filter(id => typeof id === 'string')
      : [],
    migrationNotice: source.migrationNotice && typeof source.migrationNotice === 'object' ? clone(source.migrationNotice) : null,
  };

  let currentRun = run;
  if (run) {
    const sourceRunId = migrationRunId(run);
    const currentProbabilityRun = run.mode === PROBABILITY_MODE && Number(run.probabilityVersion) >= 3;
    if (!currentProbabilityRun) {
      if (!hasLegacyMigration(profile, sourceRunId)
        && !profile.settledRaidIds.includes(sourceRunId)
        && run.settled !== true) {
        if (run.status === 'playing') recoverLegacyActive(profile, run, sourceRunId);
        else if (run.status === 'ended') safeFinalizeLegacyResult(profile, run, sourceRunId);
        else recordLegacyMigration(profile, sourceRunId, 'old-run-closed', '旧版局内状态已关闭，没有补发奖励。');
      } else if (!hasLegacyMigration(profile, sourceRunId)) {
        recordLegacyMigration(profile, sourceRunId, 'already-settled', '旧版远征已结算，未重复发放奖励。');
      }
      currentRun = null;
    }
  }
  return { version: 2, profile, run: currentRun };
}

/** Convert a retired single-run save into a career without reopening old runtime. */
export function migrateCareer(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object') throw new Error('save data is not an object');
  if (parsed.version === 2 && parsed.profile) return normalizeVersion2(parsed);
  if (parsed.profile && Object.hasOwn(parsed, 'run')) return normalizeVersion2({ ...parsed, version: 2 });

  const looksLikeRun = parsed.stats && parsed.player && typeof parsed.status === 'string';
  if (!looksLikeRun) throw new Error('unrecognized save format');

  const profile = profileDefaults((Number(parsed.seed) || Date.now()) >>> 0);
  profile.identity = clone(parsed.player);
  profile.funding = 0;
  const sourceRunId = migrationRunId(parsed);
  if (parsed.mode === PROBABILITY_MODE && Number(parsed.probabilityVersion) >= 3 && parsed.status === 'playing') {
    profile.loadout = loadoutFromRun(parsed, profile.loadout);
    return { version: 2, profile, run: clone(parsed) };
  }

  if (parsed.status === 'playing' && parsed.settled !== true) {
    recoverLegacyActive(profile, parsed, sourceRunId, { singleRun: true });
    return { version: 2, profile, run: null };
  }

  if (parsed.status === 'ended' && parsed.settled !== true) {
    const resultLoadout = Array.isArray(parsed.result?.returnedLoadoutIds)
      ? parsed.result.returnedLoadoutIds : (parsed.result?.kind === 'scatter' ? [] : parsed.loadout);
    profile.loadout = loadoutFromRun({ loadout: resultLoadout }, profile.loadout);
    profile.achievement = Math.max(0, Number(parsed.stats?.achievement) || 0);
    safeFinalizeLegacyResult(profile, parsed, sourceRunId, { singleRun: true });
    return { version: 2, profile, run: null };
  }

  recordLegacyMigration(profile, sourceRunId, 'already-settled', '旧版远征已结算，未重复发放奖励。');
  return { version: 2, profile, run: null };
}

function entriesFor(stash) {
  return Object.entries(stash).filter(([, count]) => toCount(count) > 0);
}

function shopMap() {
  const rows = [
    ...(Array.isArray(SHOP_ITEMS) ? SHOP_ITEMS : Object.values(SHOP_ITEMS || {})),
    ...SUPPLY_SHOP,
  ];
  return new Map(rows.filter((row) => row?.id && itemDef(row.id)).map((row) => {
    const price = Math.max(0, Math.floor(Number(row.price) || 0));
    const item = { ...itemDef(row.id), ...row, id: row.id, price };
    item.sellPrice = Math.max(0, Math.floor(Number(row.sellPrice ?? item.sellPrice ?? itemDef(row.id).value ?? price * 0.45) || 0));
    return [row.id, item];
  }));
}

function publicItem(id, profile) {
  const item = itemDef(id);
  if (!item) return null;
  const shop = shopMap().get(id);
  const gear = gearDef(id);
  const equippedSlots = EQUIPMENT_SLOTS.filter((slot) => profile.loadout?.[slot] === id);
  const equipped = equippedCount(profile, id);
  const total = ownedCount(profile, id);
  const stored = storedCount(profile, id);
  return {
    ...item,
    id,
    rarity: gear?.rarity || item.rarity || null,
    slot: gear?.slot || item.slot || null,
    bonus: gear?.bonus || item.bonus || null,
    count: total,
    ownedCount: total,
    storedCount: stored,
    equippedCount: equipped,
    packedCount: packedCount(profile, id),
    equipped: equipped > 0,
    equippedSlots,
    price: shop?.price ?? null,
    sellPrice: Math.max(0, Math.floor(Number(shop?.sellPrice ?? item.sellPrice ?? (shop ? shop.price * 0.45 : item.value || 0)) || 0)),
  };
}

function storageUpgradeView(career) {
  const profile = career.profile;
  const level = normalizeWarehouseLevel(profile.warehouseLevel, profile.stashCap);
  const currentCap = STASH_CAP + level * 20;
  const atLimit = level >= WAREHOUSE_MAX_LEVEL;
  const cost = atLimit ? null : WAREHOUSE_UPGRADE_COSTS[level];
  const nextCap = atLimit ? null : currentCap + 20;
  const active = career.run?.status === 'playing';
  const poor = !atLimit && Number(profile.funding) < cost;
  const reason = active ? '本局进行中，结束后才能扩建仓库。'
    : atLimit ? '仓库已达到扩建上限。'
      : poor ? `经费不足，需要 ${cost}。` : '';
  return {
    level,
    maxLevel: WAREHOUSE_MAX_LEVEL,
    currentCap,
    nextCap,
    cost,
    disabled: active || atLimit || poor,
    reason,
    action: 'upgrade:warehouse',
  };
}

export function careerView(career) {
  const profile = career.profile;
  const itemIds = new Set([
    ...entriesFor(profile.stash).map(([id]) => id),
    ...EQUIPMENT_SLOTS.map(slot => profile.loadout?.[slot]).filter(Boolean),
  ]);
  const owned = [...itemIds]
    .map(id => publicItem(id, profile))
    .filter(Boolean);
  const shop = [...shopMap().values()].map((item) => ({
    ...item,
    count: ownedCount(profile, item.id),
    ownedCount: ownedCount(profile, item.id),
    storedCount: storedCount(profile, item.id),
    equippedCount: equippedCount(profile, item.id),
    equipped: EQUIPMENT_SLOTS.some((slot) => profile.loadout[slot] === item.id),
  }));
  const overflow = normalizeOverflow(profile.overflow).map(({ id, count }) => ({
    id, item: itemDef(id), count,
  }));
  const supplies = [...new Set(profile.supplies || [])].map((id) => ({
    id, item: itemDef(id), count: packedCount(profile, id),
  }));
  return {
    funding: profile.funding,
    identity: clone(profile.identity),
    achievement: profile.achievement,
    network: profile.network,
    raids: profile.raids,
    extracted: profile.extracted,
    lastReport: profile.lastReport ? clone(profile.lastReport) : null,
    stashCap: warehouseCapacity(profile),
    stashUsed: storageCount(profile),
    stash: owned.filter(row => row.storedCount > 0)
      .map((row) => ({ ...row, count: row.storedCount, item: { ...clone(row), count: row.storedCount } })),
    items: owned.map(row => ({ ...row, item: clone(row) })),
    supplies,
    loadout: { ...profile.loadout },
    shop,
    overflow,
    research: researchView(profile),
    venue: profile.venue,
    venues: Object.entries(VENUES).map(([id, venue]) => ({ id, ...venue, disabled: profile.research.stage < venue.minStage })),
    contacts: clone(profile.contacts || {}),
    stories: storyJournal(profile.stories),
    probabilitySetup: probabilitySetup(profile),
    storageUpgrade: storageUpgradeView(career),
    migrationNotice: profile.migrationNotice ? clone(profile.migrationNotice) : null,
  };
}

function addToInventory(profile, id, count = 1) {
  const item = itemDef(id);
  const amount = toCount(count);
  if (!item || amount < 1) return 0;
  let stored = 0;
  for (let index = 0; index < amount; index += 1) {
    const total = toCount(profile.stash[id]);
    const worn = equippedCount(profile, id);
    const beforeStorage = Math.max(0, total - worn);
    const afterStorage = Math.max(0, total + 1 - worn);
    const extraStorage = afterStorage - beforeStorage;
    if (storageCount(profile) + extraStorage > warehouseCapacity(profile)) continue;
    profile.stash[id] = total + 1;
    stored += 1;
  }
  if (amount > stored) {
    const overflowAmount = amount - stored;
    const existing = profile.overflow.find((row) => row.id === id);
    if (existing) existing.count += overflowAmount;
    else profile.overflow.push({ id, count: overflowAmount });
  }
  return stored;
}

function addUniqueIds(profile, ids) {
  if (!Array.isArray(ids)) return;
  for (const id of ids) addToInventory(profile, String(id), 1);
}

function addPendingItemsToOverflow(profile, ids) {
  profile.overflow ||= [];
  for (const id of validRunItems(ids)) {
    const existing = profile.overflow.find(row => row.id === id);
    if (existing) existing.count += 1;
    else profile.overflow.push({ id, count: 1 });
  }
}

/** Start the current manual probability expedition. */
export function deployProbability(career, options = {}) {
  if (!career?.profile) return { ok: false, reason: '找不到生涯档案。' };
  if (Object.hasOwn(options, 'target') || Object.hasOwn(options, 'strategy')) {
    return { ok: false, reason: '出征已改为选择难度，请刷新页面后重试。' };
  }
  if (Object.hasOwn(options, 'difficulty')
    && !isProbabilityDifficulty(options.difficulty)) {
    return { ok: false, reason: '远征难度无效，请刷新页面后重试。' };
  }
  if (career.run?.status === 'playing') return { ok: false, reason: '本局仍在进行，不能重新出发。' };
  if (career.run && !career.run.settled) settle(career);

  const profile = career.profile;
  const setup = probabilitySetup(profile);
  const venueId = typeof options.venue === 'string' ? options.venue : profile.venue || 'conference';
  const venue = setup.venues.find(row => row.id === venueId);
  if (!venue) return { ok: false, reason: '没有这个概率远征地点。' };
  if (venue.disabled) return { ok: false, reason: venue.reason || '当前身份尚未解锁这个地点。' };
  if (profile.funding < venue.cost) return { ok: false, reason: `经费不足，需要 ${venue.cost}。` };
  const difficultyId = Object.hasOwn(options, 'difficulty') ? options.difficulty : 'normal';

  const loadout = normalizeLoadout(profile.loadout, profile.stash);
  const loadoutIds = EQUIPMENT_SLOTS.map(slot => loadout[slot]).filter(Boolean);
  if (loadoutIds.some(id => profile.research.stage < (itemDef(id)?.minStage || 0))) {
    return { ok: false, reason: '已选装备超出当前身份，请先卸下。' };
  }
  const requestedSupplies = Array.isArray(profile.supplies) ? profile.supplies : [];
  const supplies = normalizeSupplies(requestedSupplies, profile.stash);
  if (supplies.length !== requestedSupplies.length) return { ok: false, reason: '补给无效或仓库数量不足，请重新整理补给。' };
  const supplyCounts = {};
  for (const id of supplies) supplyCounts[id] = (supplyCounts[id] || 0) + 1;
  if (Object.entries(supplyCounts).some(([id, count]) => toCount(profile.stash[id]) < count)) {
    return { ok: false, reason: '仓库里的补给数量不足。' };
  }
  const bagCap = 6 + Math.round(loadoutIds.reduce((sum, id) => sum + (Number(itemDef(id)?.bonus?.bagCap) || 0), 0));
  const supplyWeight = supplies.reduce((sum, id) => sum + (Number(ITEMS[id]?.weight) || 0), 0);
  if (supplyWeight > bagCap + 0.001) return { ok: false, reason: '背包容量放不下已选的补给。' };

  const seed = options.seed == null ? (Date.now() >>> 0) : (Number(options.seed) >>> 0);
  const raidId = `raid-${cryptoId()}`;
  const run = createProbabilityRaid({
    seed,
    raidId,
    venue: venueId,
    difficulty: difficultyId,
    stage: profile.research.stage,
    player: clone(profile.identity),
    skills: skillLevels(profile.research),
    direction: profile.research.direction,
    loadout: loadoutIds,
    supplies,
    network: profile.network,
    contacts: profile.contacts,
    stories: normalizeStories(profile.stories),
    // Titles now provide automatic research support. Keep old active raid
    // identities in their saved run, but never create a new faction ability.
    talent: null,
    surprise: true,
  });
  if (run.bag.length !== supplies.length) return { ok: false, reason: '补给放不进当前背包。' };

  // New probability raids reference permanent equipped gear; only the fee and
  // packed consumables leave the stash. No result can duplicate or destroy gear.
  for (const [id, count] of Object.entries(supplyCounts)) {
    profile.stash[id] -= count;
    if (profile.stash[id] <= 0) delete profile.stash[id];
  }
  profile.funding -= venue.cost;
  profile.supplies = [];
  profile.loadout = loadout;
  profile.venue = venueId;
  run.settled = false;
  run.campaign = true;
  run.feePaid = venue.cost;
  run.initialNetwork = Math.max(0, Math.floor(Number(profile.network) || 0));
  career.run = run;
  return { ok: true, raidId };
}

function cryptoId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function settle(career) {
  const run = career.run;
  if (!run || run.mode !== PROBABILITY_MODE || ![3, 4].includes(Number(run.probabilityVersion)) || run.status !== 'ended' || run.settled) return false;
  const result = run.result || {};
  const raidId = String(run.raidId || `raid-${cryptoId()}`);
  if (career.profile.settledRaidIds.includes(raidId)) {
    run.settled = true;
    return false;
  }
  const kind = result.kind;
  const cleanOrMessy = kind === 'clean' || kind === 'messy';
  const archivedIds = Array.isArray(result.archivedIds) ? result.archivedIds : [];
  const carriedIds = Array.isArray(result.carriedIds) ? result.carriedIds : [];
  // Current and v3 runs reference permanently owned equipment; only recovered
  // material IDs enter inventory here.
  addUniqueIds(career.profile, archivedIds);
  addUniqueIds(career.profile, carriedIds);
  const networkBefore = Math.max(0, Math.floor(Number(run.initialNetwork) || 0));
  const networkAfter = Math.max(0, Math.floor(Number(run.stats?.network) || 0));
  career.profile.network = Math.max(0, (Number(career.profile.network) || 0) + networkAfter - networkBefore);
  career.profile.contacts ||= {};
  for (const [npcId, update] of Object.entries(run.contactUpdates || {})) {
    const old = career.profile.contacts[npcId] || {};
    career.profile.contacts[npcId] = {
      ...old,
      name: update.name || old.name || npcId,
      trust: Math.max(-3, Math.min(3, (Number(old.trust) || 0) + (Number(update.trustDelta) || 0))),
      meetings: Math.max(0, Math.floor(Number(old.meetings) || 0)) + Math.max(0, Math.floor(Number(update.meetings) || 0)),
      lastImpression: update.lastImpression || old.lastImpression || '',
      outcome: update.outcome || old.outcome || null,
    };
  }
  career.profile.raids += 1;
  // Choices are career memories, not backpack loot. Preserve them even when
  // extraction fails, but never replace existing memories from a legacy run.
  if (run.stories) career.profile.stories = normalizeStories(run.stories);
  learnFromRaid(career.profile, run);
  if (cleanOrMessy) career.profile.extracted += 1;
  const networkReport = networkAfter - networkBefore;
  career.profile.lastReport = {
    kind: kind || 'unknown',
    returnedCount: archivedIds.length + carriedIds.length,
    fundsReturned: 0,
    achievement: 0,
    network: networkReport,
    loadoutReturned: Array.isArray(run.loadout) ? run.loadout.length : 0,
    loadoutLost: 0,
    overflowCount: overflowCount(career.profile),
    raidId,
  };
  career.profile.settledRaidIds.push(raidId);
  career.profile.settledRaidIds = career.profile.settledRaidIds.slice(-50);
  run.raidId = raidId;
  run.settled = true;
  return true;
}

function removeOne(profile, id) {
  if (toCount(profile.stash[id]) < 1) return false;
  profile.stash[id] -= 1;
  if (profile.stash[id] <= 0) delete profile.stash[id];
  return true;
}

function cashPrice(id) {
  const shop = shopMap().get(id);
  const item = itemDef(id);
  return Math.max(0, Math.floor(Number(shop?.sellPrice ?? item?.sellPrice ?? (shop ? shop.price * 0.45 : item?.value || 0)) || 0));
}

export function hubAct(career, action) {
  if (career.run?.status === 'playing') return { ok: false, reason: '本局仍在进行，请先结束本次出行。' };
  if (career.run && !career.run.settled) settle(career);
  const profile = career.profile;
  if (String(action || '').startsWith('research:')) return researchAct(profile, String(action).slice(9));
  const [verb, ...rest] = String(action || '').split(':');
  const id = rest.join(':');
  if (verb === 'venue') {
    if (!Object.hasOwn(VENUES, id) || profile.research.stage < VENUES[id].minStage) return { ok: false, reason: '当前身份尚未解锁这个场景。' };
    profile.venue = id;
    return { ok: true };
  }
  if (verb === 'upgrade' && id === 'warehouse') {
    const level = normalizeWarehouseLevel(profile.warehouseLevel, profile.stashCap);
    if (level >= WAREHOUSE_MAX_LEVEL) return { ok: false, reason: '仓库已达到扩建上限。' };
    const cost = WAREHOUSE_UPGRADE_COSTS[level];
    if (Number(profile.funding) < cost) return { ok: false, reason: `经费不足，需要 ${cost}。` };
    const nextLevel = level + 1;
    const nextCap = STASH_CAP + nextLevel * 20;
    profile.funding -= cost;
    profile.warehouseLevel = nextLevel;
    profile.stashCap = nextCap;
    return { ok: true, level: nextLevel, capacity: nextCap, spent: cost };
  }
  if (verb === 'sell-batch') {
    let requested;
    try { requested = JSON.parse(id); } catch { return { ok: false, reason: '选择无效。' }; }
    if (!requested || Array.isArray(requested) || typeof requested !== 'object' || !Object.keys(requested).length) return { ok: false, reason: '请选择物品。' };
    for (const [itemId, count] of Object.entries(requested)) {
      if (!itemDef(itemId) || !Number.isSafeInteger(count) || count < 1 || count > storedCount(profile, itemId) - packedCount(profile, itemId)) return { ok: false, reason: '库存已变化，请重新选择。' };
    }
    let soldFor = 0, soldCount = 0;
    for (const [itemId, count] of Object.entries(requested)) {
      profile.stash[itemId] -= count;
      if (profile.stash[itemId] <= 0) delete profile.stash[itemId];
      soldFor += cashPrice(itemId) * count; soldCount += count;
    }
    profile.funding += soldFor;
    return { ok: true, soldFor, soldCount };
  }
  const item = itemDef(id);
  const shop = shopMap().get(id);
  if (!id) return { ok: false, reason: '找不到这件物品。' };

  if (verb === 'buy-equip') {
    const gear = gearDef(id);
    if (!gear?.gear || !EQUIPMENT_SLOTS.includes(gear.slot)) return { ok: false, reason: '这件物品不是可装备的装备。' };
    if (!shop || shop.id !== id) return { ok: false, reason: '这件装备目前不能购买。' };
    if (profile.research.stage < (gear.minStage || 0)) return { ok: false, reason: '当前身份尚未解锁这件装备。' };
    if ((profile.overflow || []).some(row => row.id === id && toCount(row.count) > 0)) {
      return { ok: false, reason: '已有待整理的这件装备，请先存入仓库后装备，无需再次购买。' };
    }
    if (ownedCount(profile, id) > 0) return { ok: false, reason: '你已拥有这件装备，请从仓库直接装备，无需重复购买。' };
    if (profile.funding < shop.price) return { ok: false, reason: `经费不足，需要 ${shop.price}。` };
    const reconciled = includeEquippedCopies(profile);
    const projected = {
      ...reconciled,
      stash: { ...reconciled.stash, [id]: toCount(reconciled.stash[id]) + 1 },
      loadout: { ...reconciled.loadout, [gear.slot]: id },
    };
    if (storageCount(projected) > warehouseCapacity(profile)) {
      return { ok: false, reason: '换下的装备会占满仓库，请先腾出一个位置。' };
    }
    profile.funding -= shop.price;
    profile.stash = { ...reconciled.stash, [id]: toCount(reconciled.stash[id]) + 1 };
    profile.loadout[gear.slot] = id;
    return { ok: true, equipped: id, slot: gear.slot, boughtFor: shop.price };
  }

  if (verb === 'unequip') {
    if (!EQUIPMENT_SLOTS.includes(id)) return { ok: false, reason: '没有这个装备槽位。' };
    const selected = profile.loadout[id];
    if (!selected) return { ok: true };
    const reconciled = includeEquippedCopies(profile);
    const projected = { ...reconciled, loadout: { ...reconciled.loadout, [id]: null } };
    if (storageCount(projected) > warehouseCapacity(profile)) {
      return { ok: false, reason: '仓库已满，先腾出一个位置再卸下装备。' };
    }
    profile.stash = reconciled.stash;
    profile.loadout[id] = null;
    return { ok: true };
  }
  if (!item) return { ok: false, reason: '找不到这件物品。' };

  if (verb === 'buy') {
    if (!shop) return { ok: false, reason: '这件物品目前不在商店出售。' };
    if (profile.research.stage < (item.minStage || 0)) return { ok: false, reason: '当前身份尚未解锁这件装备。' };
    if (profile.funding < shop.price) return { ok: false, reason: `经费不足，需要 ${shop.price}。` };
    profile.funding -= shop.price;
    addToInventory(profile, id, 1);
    return { ok: true };
  }

  if (verb === 'sell') {
    if (storedCount(profile, id) <= packedCount(profile, id)) {
      return { ok: false, reason: '已装入补给的物品不能出售，请先卸下补给。' };
    }
    if (!removeOne(profile, id)) return { ok: false, reason: '仓库里没有这件物品。' };
    profile.funding += cashPrice(id);
    return { ok: true, soldFor: cashPrice(id) };
  }

  if (verb === 'equip') {
    const gear = gearDef(id);
    if (!gear || !EQUIPMENT_SLOTS.includes(gear.slot)) return { ok: false, reason: '这件物品不能装备。' };
    if (profile.research.stage < (gear.minStage || 0)) return { ok: false, reason: '当前身份尚未解锁这件装备。' };
    if (profile.loadout[gear.slot] === id) return { ok: true, equipped: id, slot: gear.slot };
    if (storedCount(profile, id) < 1) return { ok: false, reason: '仓库里没有未装备的这件装备。' };
    const reconciled = includeEquippedCopies(profile);
    const projected = { ...reconciled, loadout: { ...reconciled.loadout, [gear.slot]: id } };
    if (storageCount(projected) > warehouseCapacity(profile)) {
      return { ok: false, reason: '仓库已满，先腾出一个位置再换装。' };
    }
    profile.stash = reconciled.stash;
    profile.loadout[gear.slot] = id;
    return { ok: true };
  }

  if (verb === 'pack') {
    if (!isSupply(id)) return { ok: false, reason: '只有可使用的消耗品才能装入补给。' };
    if (profile.supplies.length >= MAX_SUPPLIES) return { ok: false, reason: `每次最多带 ${MAX_SUPPLIES} 件补给。` };
    if (toCount(profile.stash[id]) <= packedCount(profile, id)) return { ok: false, reason: '仓库里没有未预留的这件补给。' };
    profile.supplies.push(id);
    return { ok: true };
  }

  if (verb === 'unpack') {
    const index = profile.supplies.indexOf(id);
    if (index < 0) return { ok: false, reason: '这件物品没有装入补给。' };
    profile.supplies.splice(index, 1);
    return { ok: true };
  }

  if (verb === 'store') {
    const row = profile.overflow.find((entry) => entry.id === id && entry.count > 0);
    if (!row) return { ok: false, reason: '没有待处理的这件物品。' };
    const beforeStored = storedCount(profile, id);
    const beforeTotal = toCount(profile.stash[id]);
    const extraStorage = Math.max(0, beforeTotal + 1 - equippedCount(profile, id)) - beforeStored;
    if (storageCount(profile) + extraStorage > warehouseCapacity(profile)) return { ok: false, reason: '仓库已满，先腾出空间。' };
    row.count -= 1;
    if (!row.count) profile.overflow = profile.overflow.filter((entry) => entry !== row);
    profile.stash[id] = (profile.stash[id] || 0) + 1;
    return { ok: true };
  }

  if (verb === 'sell-overflow') {
    const row = profile.overflow.find((entry) => entry.id === id && entry.count > 0);
    if (!row) return { ok: false, reason: '没有待处理的这件物品。' };
    row.count -= 1;
    if (!row.count) profile.overflow = profile.overflow.filter((entry) => entry !== row);
    profile.funding += cashPrice(id);
    return { ok: true, soldFor: cashPrice(id) };
  }

  return { ok: false, reason: '未知的大厅操作。' };
}
