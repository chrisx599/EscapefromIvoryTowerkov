import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { ITEMS } from '../src/content.js';
import { GEAR } from '../src/loot-content.js';
import { createCareer, migrateCareer, careerView, deployProbability, hubAct, settle } from '../src/career.js';
import { actProbabilityRaid } from '../src/probability-raid.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, '.artifacts');

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startServer(port, saveDir) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(port), GAME_SAVE_DIR: saveDir, LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: '' },
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('server process exited');
    try {
      const response = await fetch(`${base}/api/meta`, { signal: AbortSignal.timeout(300) });
      if (response.ok) return child;
    } catch { /* wait for the listener */ }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  child.kill();
  throw new Error('server did not start in time');
}

async function createIsolatedSaveDir(prefix = 'career-api-') {
  await mkdir(ARTIFACTS, { recursive: true });
  return mkdtemp(path.join(ARTIFACTS, prefix));
}

async function removeIsolatedSaveDir(directory) {
  const artifactRoot = await realpath(ARTIFACTS);
  const actual = await realpath(directory).catch(() => null);
  assert.ok(actual && path.dirname(actual) === artifactRoot, 'career API tests may only remove their isolated save directory');
  await rm(actual, { recursive: true, force: true });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit').catch(() => {});
  child.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))]);
}

async function api(base, sid, route, method = 'GET', body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { Cookie: `sid=${sid}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  return { status: response.status, ...(await response.json()) };
}

function finishWith(career, result, raidId = 'test-raid') {
  const loadout = Object.values(career.profile.loadout || {}).filter(Boolean);
  career.run = {
    mode: 'probability', probabilityVersion: 3, status: 'ended', settled: false, campaign: true, raidId, loadout,
    result: {
      kind: 'clean', archivedIds: [], carriedIds: [], returnedLoadoutIds: loadout, converted: {},
      ...result,
    },
  };
}

test('new career has common starter gear, coffee tickets, and a separate spending bank', () => {
  const career = createCareer(101);
  const hub = careerView(career);
  assert.equal(career.version, 2);
  assert.equal(hub.funding, 800);
  assert.equal(hub.loadout.bag, 'canvas_pack');
  assert.equal(hub.loadout.focus, 'foam_earplugs');
  assert.equal(hub.loadout.tool, 'coffee_thermos');
  assert.equal(career.profile.stash.coffee_ticket, 2);
  assert.equal(hub.stashCap, 40);
  assert.equal(hub.stashUsed, 2, 'the four worn starter items do not occupy storage');
  assert.equal(hub.loadout.device, 'lightweight_laptop');
  const wornPack = hub.items.find(item => item.id === 'canvas_pack');
  assert.equal(wornPack.ownedCount, 1);
  assert.equal(wornPack.equippedCount, 1);
  assert.equal(wornPack.storedCount, 0);
  assert.equal(hub.stash.some(item => item.id === 'canvas_pack'), false);
  assert.equal(hub.storageUpgrade.level, 0);
  assert.equal(hub.storageUpgrade.currentCap, 40);
  assert.equal(hub.storageUpgrade.nextCap, 60);
  assert.equal(hub.storageUpgrade.cost, 200);
  assert.deepEqual(hub.identity, career.profile.identity);
});

test('warehouse counts only stored copies while owned/equipped duplicates remain visible', () => {
  const career = createCareer(102);
  assert.equal(careerView(career).stashUsed, 2);
  career.profile.stash.canvas_pack += 1;
  let hub = careerView(career);
  let pack = hub.items.find(item => item.id === 'canvas_pack');
  assert.equal(pack.ownedCount, 2);
  assert.equal(pack.equippedCount, 1);
  assert.equal(pack.storedCount, 1);
  assert.equal(hub.stash.find(item => item.id === 'canvas_pack').count, 1);
  assert.equal(hub.stashUsed, 3);

  assert.equal(hubAct(career, 'sell:canvas_pack').ok, true);
  assert.equal(career.profile.loadout.bag, 'canvas_pack', 'selling a spare copy never unloads current gear');
  hub = careerView(career);
  pack = hub.items.find(item => item.id === 'canvas_pack');
  assert.equal(pack.ownedCount, 1);
  assert.equal(pack.equippedCount, 1);
  assert.equal(pack.storedCount, 0);
  assert.equal(hub.stash.some(item => item.id === 'canvas_pack'), false);
  assert.equal(hub.stashUsed, 2);
});

test('warehouse upgrade prices, caps, guards, and maximum level are explicit and durable', () => {
  const career = createCareer(103);
  career.profile.funding = 10_000;
  const costs = [200, 500, 1000, 1800];
  for (let level = 0; level < 4; level += 1) {
    const upgrade = careerView(career).storageUpgrade;
    assert.equal(upgrade.level, level);
    assert.equal(upgrade.currentCap, 40 + 20 * level);
    assert.equal(upgrade.nextCap, 60 + 20 * level);
    assert.equal(upgrade.cost, costs[level]);
    assert.equal(upgrade.disabled, false);
    const before = career.profile.funding;
    const result = hubAct(career, upgrade.action);
    assert.equal(result.ok, true);
    assert.equal(result.level, level + 1);
    assert.equal(result.capacity, 60 + 20 * level);
    assert.equal(result.spent, costs[level]);
    assert.equal(career.profile.funding, before - costs[level]);
    assert.equal(career.profile.stashCap, 60 + 20 * level);
  }
  assert.equal(careerView(career).storageUpgrade.currentCap, 120);
  assert.equal(careerView(career).storageUpgrade.level, 4);
  assert.equal(careerView(career).storageUpgrade.nextCap, null);
  assert.equal(careerView(career).storageUpgrade.disabled, true);
  const atLimit = structuredClone(career.profile);
  assert.equal(hubAct(career, 'upgrade:warehouse').ok, false);
  assert.deepEqual(career.profile, atLimit);

  const poor = createCareer(104);
  poor.profile.funding = 199;
  const beforePoor = structuredClone(poor.profile);
  assert.equal(careerView(poor).storageUpgrade.disabled, true);
  assert.match(careerView(poor).storageUpgrade.reason, /需要 200/);
  assert.equal(hubAct(poor, 'upgrade:warehouse').ok, false);
  assert.deepEqual(poor.profile, beforePoor);

  const active = createCareer(105);
  assert.equal(deployProbability(active, { seed: 106, venue: 'conference', difficulty: 'normal' }).ok, true);
  const beforeActive = structuredClone(active);
  assert.equal(careerView(active).storageUpgrade.disabled, true);
  assert.equal(hubAct(active, 'upgrade:warehouse').ok, false);
  assert.deepEqual(active, beforeActive);

  const saved = createCareer(107);
  saved.profile.warehouseLevel = 2;
  saved.profile.stashCap = 40; // stale compatibility field never overrides the authoritative level
  const restored = migrateCareer(JSON.stringify(saved));
  assert.equal(restored.profile.warehouseLevel, 2);
  assert.equal(restored.profile.stashCap, 80);
  assert.equal(careerView(restored).storageUpgrade.currentCap, 80);
  const oldSave = createCareer(108);
  delete oldSave.profile.warehouseLevel;
  oldSave.profile.stashCap = 40;
  const migratedOld = migrateCareer(JSON.stringify(oldSave));
  assert.equal(migratedOld.profile.warehouseLevel, 0);
  assert.equal(migratedOld.profile.stashCap, 40);
});

test('buy-equip wears into an empty slot without storage, but refuses full-storage replacement atomically', () => {
  const wear = createCareer(109);
  wear.profile.stash = { coffee_ticket: 40 };
  wear.profile.loadout = { bag: null, focus: null, tool: null, device: null, storage: null };
  wear.profile.funding = GEAR.noise_headphones.value * 5;
  assert.equal(careerView(wear).stashUsed, 40);
  assert.equal(hubAct(wear, 'buy-equip:noise_headphones').ok, true);
  assert.equal(wear.profile.loadout.focus, 'noise_headphones');
  assert.equal(careerView(wear).items.find(item => item.id === 'noise_headphones').storedCount, 0);
  assert.equal(careerView(wear).stashUsed, 40);

  const replacement = createCareer(110);
  replacement.profile.stash = { coffee_ticket: 40 };
  replacement.profile.loadout = { bag: null, focus: 'foam_earplugs', tool: null, device: null, storage: null };
  replacement.profile.funding = 10_000;
  const before = structuredClone(replacement.profile);
  const refused = hubAct(replacement, 'buy-equip:digital_notebook');
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /仓库|位置/);
  assert.deepEqual(replacement.profile, before);

  const exactSwap = createCareer(111);
  exactSwap.profile.stash = { coffee_ticket: 39, foam_earplugs: 1, noise_headphones: 1 };
  exactSwap.profile.loadout = { bag: null, focus: 'foam_earplugs', tool: null, device: null, storage: null };
  assert.equal(careerView(exactSwap).stashUsed, 40);
  assert.equal(hubAct(exactSwap, 'equip:noise_headphones').ok, true);
  assert.equal(exactSwap.profile.loadout.focus, 'noise_headphones');
  assert.equal(careerView(exactSwap).stashUsed, 40, 'switching stored gear for worn gear is a full-capacity swap');

  const unequip = createCareer(112);
  unequip.profile.stash = { coffee_ticket: 40, foam_earplugs: 1 };
  unequip.profile.loadout = { bag: null, focus: 'foam_earplugs', tool: null, device: null, storage: null };
  const beforeUnequip = structuredClone(unequip.profile);
  assert.equal(hubAct(unequip, 'unequip:focus').ok, false);
  assert.deepEqual(unequip.profile, beforeUnequip);
});

test('shop enforces funding, buying changes the bank, and selling requires held stock', () => {
  const career = createCareer(202);
  const price = careerView(career).shop.find((item) => item.id === 'noise_headphones').price;
  career.profile.funding = price - 1;
  assert.equal(hubAct(career, 'buy:noise_headphones').ok, false);
  assert.equal(career.profile.stash.noise_headphones, undefined);

  career.profile.funding = price;
  assert.equal(hubAct(career, 'buy:noise_headphones').ok, true);
  assert.equal(career.profile.funding, 0);
  assert.equal(career.profile.stash.noise_headphones, 1);
  assert.equal(hubAct(career, 'sell:dataset').ok, false);
  const soldFor = careerView(career).shop.find((item) => item.id === 'noise_headphones').sellPrice;
  assert.equal(hubAct(career, 'sell:noise_headphones').ok, true);
  assert.equal(career.profile.funding, soldFor);
  assert.equal(career.profile.stash.noise_headphones, undefined);
});

test('a full-warehouse gear overflow cannot be repurchased for direct wear; storing it then equips for free', () => {
  const career = createCareer(207);
  const price = careerView(career).shop.find(item => item.id === 'noise_headphones').price;
  career.profile.stash.coffee_ticket += 38;
  career.profile.funding = price;
  assert.equal(careerView(career).stashUsed, 40);

  assert.equal(hubAct(career, 'buy:noise_headphones').ok, true);
  assert.equal(career.profile.funding, 0);
  assert.equal(career.profile.stash.noise_headphones, undefined);
  assert.deepEqual(career.profile.overflow.find(row => row.id === 'noise_headphones'), { id: 'noise_headphones', count: 1 });

  const beforeRejectedWear = structuredClone(career.profile);
  const rejected = hubAct(career, 'buy-equip:noise_headphones');
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /待整理.*先存入仓库/);
  assert.deepEqual(career.profile, beforeRejectedWear);

  assert.equal(hubAct(career, 'sell:coffee_ticket').ok, true);
  assert.equal(hubAct(career, 'store:noise_headphones').ok, true);
  const fundsBeforeEquip = career.profile.funding;
  assert.equal(hubAct(career, 'equip:noise_headphones').ok, true);
  assert.equal(career.profile.funding, fundsBeforeEquip, 'wearing an owned overflow item is free');
  assert.equal(career.profile.loadout.focus, 'noise_headphones');
  assert.equal(careerView(career).stashUsed, 40);
});

test('atomic buy-equip replaces a slot while preserving the previous owned equipment', () => {
  const career = createCareer(203);
  const price = careerView(career).shop.find((item) => item.id === 'noise_headphones').price;
  const previous = career.profile.loadout.focus;
  const previousCount = career.profile.stash[previous];
  career.profile.funding = price;

  const result = hubAct(career, 'buy-equip:noise_headphones');
  assert.equal(result.ok, true);
  assert.equal(result.slot, 'focus');
  assert.equal(result.boughtFor, price);
  assert.equal(career.profile.funding, 0);
  assert.equal(career.profile.loadout.focus, 'noise_headphones');
  assert.equal(career.profile.stash.noise_headphones, 1);
  assert.equal(career.profile.stash[previous], previousCount);

  career.profile.funding = price;
  const equippedBefore = structuredClone(career.profile);
  assert.equal(hubAct(career, 'buy-equip:noise_headphones').ok, false, 'equipped gear must not be bought again by the slot picker');
  assert.deepEqual(career.profile, equippedBefore);
  assert.equal(hubAct(career, 'equip:' + previous).ok, true);
  const ownedBefore = structuredClone(career.profile);
  assert.equal(hubAct(career, 'buy-equip:noise_headphones').ok, false, 'unequipped owned gear must be switched for free');
  assert.deepEqual(career.profile, ownedBefore);
});

test('atomic buy-equip rejects locked, unaffordable, full-stash, and non-gear purchases without mutation', () => {
  const career = createCareer(204);

  career.profile.research.stage = 0;
  career.profile.funding = 10_000;
  let before = structuredClone(career.profile);
  assert.equal(hubAct(career, 'buy-equip:gpu_workstation').ok, false);
  assert.deepEqual(career.profile, before);

  career.profile.research.stage = 4;
  career.profile.funding = 0;
  before = structuredClone(career.profile);
  assert.equal(hubAct(career, 'buy-equip:noise_headphones').ok, false);
  assert.deepEqual(career.profile, before);

  career.profile.funding = 10_000;
  career.profile.stash = { coffee_ticket: 40 };
  before = structuredClone(career.profile);
  assert.equal(hubAct(career, 'buy-equip:noise_headphones').ok, false);
  assert.deepEqual(career.profile, before);

  career.profile.stash = { coffee_ticket: 2 };
  before = structuredClone(career.profile);
  assert.equal(hubAct(career, 'buy-equip:dataset').ok, false);
  assert.deepEqual(career.profile, before);
});

test('active raid guard rejects atomic buy-equip without settling or changing the run', () => {
  const career = createCareer(205);
  assert.equal(deployProbability(career, { seed: 206, venue: 'conference', difficulty: 'normal' }).ok, true);
  const before = structuredClone(career);
  assert.equal(hubAct(career, 'buy-equip:noise_headphones').ok, false);
  assert.deepEqual(career, before);
});

test('supplies reserve only owned consumables, cap at three, and cannot be sold while packed', () => {
  const career = createCareer(250);
  const hub = careerView(career);
  assert.deepEqual(hub.supplies, []);
  assert.equal(hub.shop.find((item) => item.id === 'coffee_ticket').price, 50);
  assert.equal(hub.shop.find((item) => item.id === 'coffee_ticket').sellPrice, 5);
  assert.equal(hub.shop.find((item) => item.id === 'stomach_pill').price, 60);
  assert.equal(hub.shop.find((item) => item.id === 'stomach_pill').sellPrice, 6);

  assert.equal(hubAct(career, 'pack:stomach_pill').ok, false);
  assert.equal(hubAct(career, 'pack:canvas_pack').ok, false);
  assert.equal(hubAct(career, 'pack:coffee_ticket').ok, true);
  assert.equal(hubAct(career, 'pack:coffee_ticket').ok, true);
  assert.equal(hubAct(career, 'pack:coffee_ticket').ok, false); // only two are owned
  career.profile.stash.stomach_pill = 2;
  assert.equal(hubAct(career, 'pack:stomach_pill').ok, true);
  assert.equal(hubAct(career, 'pack:stomach_pill').ok, false); // three selected already

  const updated = careerView(career);
  assert.equal(updated.supplies.find((item) => item.id === 'coffee_ticket').count, 2);
  assert.equal(updated.supplies.find((item) => item.id === 'stomach_pill').count, 1);
  assert.equal(updated.items.find((item) => item.id === 'coffee_ticket').packedCount, 2);
  assert.equal(hubAct(career, 'sell:coffee_ticket').ok, false);
  assert.equal(hubAct(career, 'unpack:coffee_ticket').ok, true);
  assert.equal(hubAct(career, 'sell:coffee_ticket').ok, true); // one unreserved copy remains
  assert.equal(hubAct(career, 'sell:coffee_ticket').ok, false); // the remaining copy is reserved
});

test('packed supplies leave the warehouse for the current raid, are usable, and settle only once', () => {
  const career = createCareer(260);
  assert.equal(hubAct(career, 'pack:coffee_ticket').ok, true);
  assert.equal(deployProbability(career, { seed: 261, venue: 'conference', difficulty: 'normal' }).ok, true);
  assert.deepEqual(career.run.bag, ['coffee_ticket']);
  assert.equal(career.profile.stash.coffee_ticket, 1);
  assert.deepEqual(career.profile.supplies, []);
  const willMax = career.run.stats.willMax;
  const riskBeforeUse = career.run.stats.risk;
  career.run.stats.will -= 1;
  assert.equal(actProbabilityRaid(career.run, 'use:0').ok, true);
  assert.equal(career.run.bag.length, 0);
  assert.equal(career.run.stats.will, willMax);
  assert.equal(career.run.stats.risk, riskBeforeUse);

  const clean = createCareer(262);
  hubAct(clean, 'pack:coffee_ticket');
  deployProbability(clean, { seed: 263, venue: 'conference', difficulty: 'normal' });
  clean.run.status = 'ended';
  clean.run.result = {
    kind: 'clean', archivedIds: [], carriedIds: ['coffee_ticket'],
    returnedLoadoutIds: clean.run.loadout, converted: {},
  };
  assert.equal(settle(clean), true);
  assert.equal(clean.profile.stash.coffee_ticket, 2); // one leftover plus one returned; no reservation duplicate

  const scatter = createCareer(264);
  hubAct(scatter, 'pack:coffee_ticket');
  deployProbability(scatter, { seed: 265, venue: 'conference', difficulty: 'normal' });
  scatter.run.status = 'ended';
  scatter.run.result = {
    kind: 'scatter', archivedIds: [], carriedIds: [], returnedLoadoutIds: [],
    converted: {},
  };
  assert.equal(settle(scatter), true);
  assert.equal(scatter.profile.stash.coffee_ticket, 1); // deployed supply was lost with the bag
});

test('deployment refuses supplies above equipped backpack capacity without spending or removing them', () => {
  const career = createCareer(270);
  const originalWeight = ITEMS.coffee_ticket.weight;
  try {
    ITEMS.coffee_ticket.weight = 3;
    career.profile.stash.coffee_ticket = 3;
    assert.equal(hubAct(career, 'pack:coffee_ticket').ok, true);
    assert.equal(hubAct(career, 'pack:coffee_ticket').ok, true);
    assert.equal(hubAct(career, 'pack:coffee_ticket').ok, true);
    const result = deployProbability(career, { seed: 271, venue: 'conference', difficulty: 'normal' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /背包容量/);
    assert.equal(career.profile.funding, 800);
    assert.equal(career.profile.stash.coffee_ticket, 3);
    assert.equal(career.profile.supplies.length, 3);
    assert.equal(career.run, null);
  } finally {
    ITEMS.coffee_ticket.weight = originalWeight;
  }
});

test('probability raids borrow equipped gear without changing owned count or duplicating it at settlement', () => {
  const career = createCareer(304);
  const equipped = Object.values(career.profile.loadout).filter(Boolean);
  const before = Object.fromEntries(equipped.map(id => [id, career.profile.stash[id]]));
  assert.equal(deployProbability(career, { seed: 305, venue: 'conference', difficulty: 'normal' }).ok, true);
  for (const id of equipped) assert.equal(career.profile.stash[id], before[id]);
  assert.equal(careerView(career).stashUsed, 2);
  career.run.status = 'ended';
  career.run.result = { kind: 'clean', archivedIds: [], carriedIds: [],
    returnedLoadoutIds: career.run.loadout, converted: {} };
  assert.equal(settle(career), true);
  for (const id of equipped) assert.equal(career.profile.stash[id], before[id]);
  assert.equal(careerView(career).stashUsed, 2);
});

test('active raid persistence keeps equipped IDs associated with the loaded gear', () => {
  const career = createCareer(350);
  assert.equal(deployProbability(career, { seed: 351, venue: 'conference', difficulty: 'hard' }).ok, true);
  const restored = migrateCareer(JSON.parse(JSON.stringify(career)));
  assert.deepEqual(restored.profile.loadout, career.profile.loadout);
  assert.deepEqual(restored.run.loadout, career.run.loadout);
  assert.equal(restored.run.probabilityVersion, 4);
  assert.equal(restored.run.difficultyId, 'hard');
  const stashBeforeView = structuredClone(restored.profile.stash);
  const hub = careerView(restored);
  for (const id of restored.run.loadout) {
    const item = hub.items.find(row => row.id === id);
    assert.equal(item.ownedCount, 1);
    assert.equal(item.equippedCount, 1);
    assert.equal(item.storedCount, 0);
  }
  assert.deepEqual(restored.profile.stash, stashBeforeView, 'GET-style views do not debit or clear selected gear');
});

test('full storage sends items to overflow and lets the player store or sell them explicitly', () => {
  const career = createCareer(505);
  career.profile.stash = { coffee_ticket: 40 };
  career.profile.loadout = { bag: null, focus: null, tool: null };
  finishWith(career, { archivedIds: ['card'], converted: { 经费: 0 } }, 'overflow-store');
  assert.equal(settle(career), true);
  assert.equal(career.profile.overflow[0].id, 'card');
  assert.equal(career.profile.overflow[0].count, 1);
  assert.equal(hubAct(career, 'store:card').ok, false);

  delete career.profile.stash.coffee_ticket;
  assert.equal(hubAct(career, 'store:card').ok, true);
  assert.equal(career.profile.stash.card, 1);
  career.profile.stash.coffee_ticket = 39;
  finishWith(career, { archivedIds: ['promise'], converted: { 经费: 0 } }, 'overflow-sell');
  assert.equal(settle(career), true);
  assert.equal(career.profile.overflow[0].id, 'promise');
  assert.equal(hubAct(career, 'sell-overflow:promise').ok, true);
  assert.equal(career.profile.funding, 800 + ITEMS.promise.value);
  assert.equal(career.profile.overflow.length, 0);
});

test('selling cannot unequip current gear and can sell only a stored duplicate', () => {
  const career = createCareer(606);
  assert.equal(career.profile.loadout.bag, 'canvas_pack');
  const pack = careerView(career).shop.find((item) => item.id === 'canvas_pack');
  assert.equal(pack.price, GEAR.canvas_pack.value * 5);
  assert.equal(pack.sellPrice, GEAR.canvas_pack.value);
  const before = structuredClone(career.profile);
  assert.equal(hubAct(career, 'sell:canvas_pack').ok, false);
  assert.deepEqual(career.profile, before);
  career.profile.stash.canvas_pack += 1;
  assert.equal(careerView(career).items.find(item => item.id === 'canvas_pack').storedCount, 1);
  assert.equal(hubAct(career, 'sell:canvas_pack').ok, true);
  assert.equal(career.profile.loadout.bag, 'canvas_pack');
  assert.equal(career.profile.funding, 800 + GEAR.canvas_pack.value);
  assert.equal(career.profile.stash.canvas_pack, 1);
  assert.equal(hubAct(career, 'sell:canvas_pack').ok, false);
  for (const item of Object.values(GEAR)) assert.ok(item.id);
});

test('retired saves recover actual asset counts once without replaying run rewards', () => {
  const defaultCareer = createCareer(707);
  const starterLoadout = Object.values(defaultCareer.profile.loadout).filter(Boolean);
  const singleRun = {
    seed: 707,
    raidId: 'retired-single-active-707',
    status: 'playing',
    settled: false,
    player: defaultCareer.profile.identity,
    loadout: starterLoadout,
    archive: ['dataset', 'dataset', 'card'],
    bag: ['dataset', 'wind', 'wind'],
    stats: { funding: 123, achievement: 999, network: 12 },
  };
  const recoveredSingle = migrateCareer(singleRun);
  assert.equal(recoveredSingle.run, null, 'a retired active run should return to the current hub instead of restarting');
  assert.equal(recoveredSingle.profile.funding, 123, 'only the actual unspent balance should transfer from the bare save');
  assert.equal(recoveredSingle.profile.stash.dataset, 3, 'archive and bag copies of the same material must remain separate copies');
  assert.equal(recoveredSingle.profile.stash.card, 1);
  assert.equal(recoveredSingle.profile.stash.wind, 2);
  for (const id of starterLoadout) assert.equal(recoveredSingle.profile.stash[id], 1, 'default starter gear must not be duplicated during migration');
  assert.equal(recoveredSingle.profile.research.papers.length, 0);
  assert.ok(['old-expedition-recovered', 'already-settled'].includes(recoveredSingle.profile.migrationNotice.kind));
  assert.ok(recoveredSingle.profile.migratedLegacyRunIds.includes(singleRun.raidId));
  const reloadedSingle = migrateCareer(JSON.stringify(recoveredSingle));
  assert.deepEqual(reloadedSingle.profile.stash, recoveredSingle.profile.stash,
    'reloading a recovered save must not add a second set of assets');

  for (const version of [1, 2]) {
    const old = createCareer(720 + version);
    old.profile.funding = 333;
    old.profile.achievement = 17;
    old.profile.network = 6;
    old.profile.research.papers.push({ id: 'replicate-1', type: 'replicate', title: 'Existing paper', quality: 72, credit: 30, day: 1 });
    const ownedGear = Object.values(old.profile.loadout).filter(Boolean);
    old.run = {
      mode: 'probability', probabilityVersion: version, raidId: `retired-prob-${version}`,
      status: 'playing', settled: false, seed: 720 + version,
      loadout: ownedGear, bag: ['dataset'], pendingLoot: ['dataset', 'dataset'],
      archive: ['src_code', 'src_code'], protectedIndex: 0,
      stats: { funding: 999, achievement: 999, network: 99 }, initialNetwork: 6,
    };
    const recovered = migrateCareer(JSON.stringify(old));
    assert.equal(recovered.run, null);
    assert.equal(recovered.profile.funding, 333, 'an active old probability run must not replay the departure balance');
    assert.equal(recovered.profile.achievement, 17, 'old run progress must not grant new research experience');
    assert.equal(recovered.profile.network, 6);
    assert.deepEqual(recovered.profile.research.papers.map(paper => paper.id), ['replicate-1']);
    assert.equal(recovered.profile.stash.dataset, 1, 'only the carried bag item should be returned');
    assert.equal(recovered.profile.overflow.find(row => row.id === 'dataset')?.count, 2,
      'each pending item should remain represented in overflow for deliberate sorting');
    assert.equal(recovered.profile.stash.src_code, undefined, 'archive/protected data from an interrupted probability run should not be duplicated');
    assert.equal(recovered.profile.stash.gpu_workstation, undefined, 'equipped gear is still a permanent profile reference');
    assert.equal(recovered.profile.migrationNotice.kind, 'old-probability-recovered');
    const reload = migrateCareer(JSON.stringify(recovered));
    assert.deepEqual(reload.profile.stash, recovered.profile.stash);
    assert.deepEqual(reload.profile.overflow, recovered.profile.overflow);
  }

  const ended = createCareer(733);
  ended.profile.funding = 250;
  ended.profile.achievement = 12;
  ended.profile.network = 4;
  ended.run = {
    mode: 'probability', probabilityVersion: 2, raidId: 'retired-ended-733', status: 'ended', settled: false,
    seed: 733, bag: [], loadout: [], stats: { funding: 900, network: 4 }, initialNetwork: 4,
    result: { kind: 'clean', archivedIds: ['dataset', 'dataset'], carriedIds: ['dataset'],
      converted: { 经费: 999, 成果: 9999, 人脉: 90 } },
  };
  const settled = migrateCareer(JSON.stringify(ended));
  assert.equal(settled.run, null);
  assert.equal(settled.profile.stash.dataset, 3, 'canonical archived and carried entries with duplicate IDs each represent one item');
  assert.equal(settled.profile.funding, 250, 'old probability settlement must not refund a fee or replay a payout');
  assert.equal(settled.profile.achievement, 12);
  assert.equal(settled.profile.network, 4);
  assert.equal(settled.profile.migrationNotice.kind, 'settled-result');
  const settledReload = migrateCareer(JSON.stringify(settled));
  assert.equal(settledReload.profile.stash.dataset, 3, 'the finalized old result cannot be claimed twice');

  const already = createCareer(734);
  already.run = { mode: 'probability', probabilityVersion: 1, raidId: 'retired-already-settled-734',
    status: 'ended', settled: true, result: { kind: 'clean', archivedIds: ['card'], carriedIds: [] } };
  const closed = migrateCareer(JSON.stringify(already));
  assert.equal(closed.run, null);
  assert.equal(closed.profile.stash.card, undefined, 'an old result already marked settled should not be replayed');
  assert.equal(closed.profile.migrationNotice.kind, 'already-settled');
  assert.throws(() => migrateCareer({ broken: true }), /unrecognized save format/);
});

test('current API creates a durable profile, deploys version 4, and protects an active run', { timeout: 15000 }, async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const sid = randomBytes(12).toString('hex');
  const saveDir = await createIsolatedSaveDir();
  const savePath = path.join(saveDir, `${sid}.json`);
  let child;
  try {
    child = await startServer(port, saveDir);
    const initial = await api(base, sid, '/api/state');
    assert.equal(initial.status, 200);
    assert.equal(initial.phase, 'hub');
    assert.equal(initial.hub.funding, 800);
    assert.equal(initial.hub.stashCap, 40);
    assert.equal(initial.hub.stashUsed, 2);

    const bought = await api(base, sid, '/api/hub/action', 'POST', { action: 'buy:noise_headphones', requestId: 'career-buy-headphones-01' });
    assert.equal(bought.ok, true);
    const equipped = await api(base, sid, '/api/hub/action', 'POST', { action: 'equip:noise_headphones', requestId: 'career-equip-headphones-01' });
    assert.equal(equipped.hub.loadout.focus, 'noise_headphones');
    assert.equal(equipped.hub.items.find(item => item.id === 'noise_headphones').storedCount, 0);
    assert.equal(equipped.hub.items.find(item => item.id === 'noise_headphones').equippedCount, 1);

    const deployed = await api(base, sid, '/api/new', 'POST', { venue: 'conference', difficulty: 'normal', requestId: 'career-current-deploy-01' });
    assert.equal(deployed.ok, true);
    assert.equal(deployed.phase, 'raid');
    assert.equal(deployed.view.probabilityVersion, 4);
    assert.equal(deployed.view.difficulty.id, 'normal');
    assert.equal(deployed.view.clock, undefined);
    assert.equal(deployed.hub.loadout.focus, 'noise_headphones', 'the raid borrows the current profile equipment');

    await stopServer(child);
    child = null;
    child = await startServer(port, saveDir);
    const restored = await api(base, sid, '/api/state');
    assert.equal(restored.phase, 'raid');
    assert.equal(restored.view.probabilityVersion, 4);
    assert.equal(restored.view.difficulty.id, 'normal');
    assert.equal(restored.view.revision, deployed.view.revision);
    assert.equal(restored.hub.loadout.focus, 'noise_headphones');
    assert.equal(restored.hub.items.some((item) => item.id === 'noise_headphones'), true);
    assert.equal(restored.hub.items.find((item) => item.id === 'noise_headphones').storedCount, 0);
    assert.equal(restored.hub.stash.some((item) => item.id === 'noise_headphones'), false);

    const blocked = await api(base, sid, '/api/new', 'POST', { venue: 'conference', difficulty: 'normal', requestId: 'career-active-redeploy-01' });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.view.revision, deployed.view.revision);
    const returnBlocked = await api(base, sid, '/api/hub/return', 'POST', { requestId: 'career-active-return-01' });
    assert.equal(returnBlocked.ok, false);

    const saved = JSON.parse(await readFile(savePath, 'utf8'));
    assert.equal(saved.version, 2);
    assert.equal(saved.run.probabilityVersion, 4);
  } finally {
    await stopServer(child);
    await removeIsolatedSaveDir(saveDir);
  }
});

test('concurrent first deployments create only one current run', { timeout: 15000 }, async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const sid = randomBytes(12).toString('hex');
  const saveDir = await createIsolatedSaveDir();
  let child;
  try {
    child = await startServer(port, saveDir);
    const replies = await Promise.all([
      api(base, sid, '/api/new', 'POST', { venue: 'conference', difficulty: 'normal', requestId: 'career-current-race-a' }),
      api(base, sid, '/api/new', 'POST', { venue: 'conference', difficulty: 'hard', requestId: 'career-current-race-b' }),
    ]);
    assert.equal(replies.filter(reply => reply.ok).length, 1);
    const state = await api(base, sid, '/api/state');
    assert.equal(state.phase, 'raid');
    assert.equal(state.hub.funding, 800, 'the free conference deployment should not charge a client-supplied allowance');
    assert.equal(state.view.probabilityVersion, 4);
    assert.ok(['normal', 'hard'].includes(state.view.difficulty.id));
    const saved = JSON.parse(await readFile(path.join(saveDir, `${sid}.json`), 'utf8'));
    assert.equal(saved.run.probabilityVersion, 4);
  } finally {
    await stopServer(child);
    await removeIsolatedSaveDir(saveDir);
  }
});

test('warehouse upgrade API receipt spends once and survives a server restart', { timeout: 15000 }, async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const sid = randomBytes(12).toString('hex');
  const saveDir = await createIsolatedSaveDir();
  const savePath = path.join(saveDir, `${sid}.json`);
  let child;
  try {
    child = await startServer(port, saveDir);
    const request = { action: 'upgrade:warehouse', requestId: 'warehouse-upgrade-once-1' };
    const first = await api(base, sid, '/api/hub/action', 'POST', request);
    assert.equal(first.ok, true);
    assert.equal(first.hub.funding, 600);
    assert.equal(first.hub.stashCap, 60);
    assert.equal(first.hub.storageUpgrade.level, 1);

    const replay = await api(base, sid, '/api/hub/action', 'POST', request);
    assert.equal(replay.ok, true);
    assert.equal(replay.replayed, true);
    assert.equal(replay.hub.funding, 600);
    assert.equal(replay.hub.stashCap, 60);

    const conflict = await api(base, sid, '/api/hub/action', 'POST', {
      action: 'upgrade:warehouse', requestId: 'warehouse-upgrade-once-1', difficulty: 'hard',
    });
    assert.equal(conflict.ok, false);
    assert.match(conflict.reason, /另一项操作/);

    await stopServer(child);
    child = null;
    child = await startServer(port, saveDir);
    const restored = await api(base, sid, '/api/state');
    assert.equal(restored.hub.storageUpgrade.level, 1);
    assert.equal(restored.hub.stashCap, 60);
    assert.equal(restored.hub.funding, 600);
  } finally {
    await stopServer(child);
    await removeIsolatedSaveDir(saveDir);
  }
});
