#!/usr/bin/env node
/** Deterministic action-level balance audit. See BALANCE.md for policy/limits. */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TIERS = [
  { id: 'beginner', stage: 0, level: 1, venue: 'conference', gear: {} },
  { id: 'mid', stage: 3, level: 4, venue: 'visit', gear: { device: 'remote_terminal', focus: 'literature_assistant', tool: 'experiment_tracker', storage: 'portable_ssd' } },
  { id: 'late', stage: 6, level: 7, venue: 'industry', gear: { bag: 'custom_lab_pack', device: 'remote_terminal', focus: 'literature_assistant', tool: 'data_cleaner', storage: 'encrypted_ssd' } },
];
export function seedFor(index, stream = 0) {
  let x = ((index + 1) ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ x >>> 16, 0x21f0aaad); x = Math.imul(x ^ x >>> 15, 0x735a2d97);
  return ((x ^ x >>> 15) >>> 0) || 1;
}
export function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = p => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? null;
  return { n: sorted.length, mean: sorted.length ? +(sorted.reduce((a,b) => a+b, 0) / sorted.length).toFixed(3) : null,
    min: sorted[0] ?? null, p50: q(.5), p90: q(.9), p99: q(.99), max: sorted.at(-1) ?? null };
}
export async function loadGame(root = DEFAULT_ROOT) {
  const mod = async name => import(pathToFileURL(path.join(root, 'src', name + '.js')).href);
  return { ...(await mod('career')), ...(await mod('research')), ...(await mod('probability-raid')), ...(await mod('content')) };
}
export function fixture(game, index, tier = TIERS[0]) {
  const career = game.createCareer(seedFor(index));
  career.profile.research.stage = tier.stage;
  career.profile.research.rewardedStage = tier.stage;
  // Normalize legacy XP into a stable comparison fixture at the stated earned level.
  for (const key of ['engineering', 'research', 'expression']) career.profile.research.skills[key] = 3 * (tier.level - 1);
  // New curve fixtures use exact level, rather than accidentally comparing XP units.
  if (career.profile.research.skillFloors) {
    for (const key of ['engineering', 'research', 'expression']) career.profile.research.skillFloors[key] = tier.level;
  }
  for (const [slot, id] of Object.entries(tier.gear)) { career.profile.stash[id] = 1; career.profile.loadout[slot] = id; }
  return career;
}
function must(result, context) {
  if (!result?.ok) throw new Error(`${context}: ${result?.reason || JSON.stringify(result)}`);
  return result;
}
export function playRaid(game, career, { seed, venue = 'conference', difficulty = 'normal', searches = 4, approach = 'steady' } = {}) {
  must(game.deployProbability(career, { seed, venue, difficulty }), 'deploy');
  const run = career.run;
  let actions = 0, searched = 0, found = 0, eventTrials = 0, eventSuccesses = 0;
  while (run.status === 'playing') {
    if (actions++ > 100) throw new Error('raid action limit exceeded');
    let action;
    if (run.pendingLoot.length) action = 'take:available';
    else if (run.event) {
      // Blind fixed-slot policy. Surprise choices are shuffled at encounter creation;
      // never inspect hidden check values or choose the best unrevealed probability.
      const view = game.probabilityRaidView(run);
      action = view.event.actions.find(row => !row.disabled && !row.endsRaid)?.id || 'event:leave';
    } else if (searched >= searches || run.stats.will < 1) action = 'extract';
    else { action = approach === 'steady' ? 'search' : `search:${approach}`; searched++; }
    const result = must(game.actProbabilityRaid(run, action), action);
    if (action.startsWith('search')) found += Number(result.found);
    if (action.startsWith('event:') && !result.endsRaid) { eventTrials++; eventSuccesses += Number(result.eventSuccess === true); }
  }
  if (!game.settle(career)) throw new Error('settle failed');
  const items = [...run.result.carriedIds, ...run.result.archivedIds];
  return { actions, searches: searched, found, events: eventTrials, eventSuccesses,
    returned: items.length, materials: items.filter(id => ['dataset','src_code','compute','wind'].includes(id)).length,
    value: items.reduce((s,id) => s+(game.ITEMS[id]?.value || 0),0), kind: run.result.kind,
    risk: run.stats.risk, will: run.stats.will, automatic: Number(run.result.automatic),
    zeroReturn: Number(items.length === 0), stoppedEarly: Number(searched < searches) };
}
function aggregateRows(rows, fields) {
  return Object.fromEntries(fields.map(key => [key, distribution(rows.map(row => row[key]))]));
}
async function raidScenarios(game, n) {
  const out = [];
  for (const tier of TIERS) for (const difficulty of ['easy','normal','hard']) for (const searches of [4,8]) {
    const rows = Array.from({ length: n }, (_,index) => playRaid(game, fixture(game,index,tier), {
      seed: seedFor(index, 1), venue: tier.venue, difficulty, searches }));
    out.push({ tier: tier.id, venue: tier.venue, difficulty, requestedSearches: searches,
      ...aggregateRows(rows,['searches','found','returned','materials','value','events','risk','will','actions']),
      counts: Object.fromEntries(['clean','messy','scatter'].map(kind => [kind, rows.filter(row=>row.kind===kind).length])),
      eventSuccessRate: +(rows.reduce((s,r)=>s+r.eventSuccesses,0) / rows.reduce((s,r)=>s+r.events,0)).toFixed(4),
      stoppedEarly: rows.reduce((s,r)=>s+r.stoppedEarly,0), automatic: rows.reduce((s,r)=>s+r.automatic,0), zeroReturn: rows.reduce((s,r)=>s+r.zeroReturn,0) });
  }
  return out;
}
function sellSurplus(game, career, reserves) {
  let actions=0;
  for (const [id, count] of Object.entries(career.profile.stash)) {
    if (Object.values(career.profile.loadout).includes(id)) continue;
    let amount = count - (reserves[id] || 0);
    while (amount-- > 0) { must(game.hubAct(career, `sell:${id}`), `sell:${id}`); actions++; }
  }
  // Free recovery outings are short enough not to require overflowing the warehouse.
  return actions;
}
export function paperPath(game, index, { tier = TIERS[0], type = 'replicate', recover = false, initialFunding = 800, abundant = false, existingCareer = null } = {}) {
  const career = existingCareer || fixture(game,index,tier);
  const profile = career.profile;
  if (!existingCareer) profile.funding = abundant ? 1e7 : initialFunding;
  let actions = 0, purchases = 0, expense = 0, raids = 0, steps = 0, runs = 0, reviews = 0, paidRuns = 0, supportRuns = 0, supportAcceptance = 0, minFunding = profile.funding;
  const act = id => {
    const before = profile.funding;
    const result = game.hubAct(career,id);
    if (result.ok) { actions++; expense += Math.max(0,before-profile.funding); minFunding = Math.min(minFunding,profile.funding); }
    return result;
  };
  const resupply = reserves => {
    if (!recover || raids >= 200) return false;
    const outing=playRaid(game,career,{ seed: seedFor(index,20+profile.raids), difficulty:'easy', searches:4, approach:'steady' });
    raids++; actions+=outing.actions+sellSurplus(game,career,reserves); return true;
  };
  function ensure(resources, fee) {
    for (let attempts=0; attempts<201; attempts++) {
      let available = true;
      for (const [id,count] of Object.entries(resources)) while ((profile.stash[id] || 0)<count) {
        const result=act(`buy:${id}`);
        if (!result.ok) { available=false; break; }
        purchases++;
      }
      if (available && profile.funding>=fee) return true;
      if (!resupply(resources)) return false;
    }
    return false;
  }
  const template = game.PROJECTS[type];
  const scope = game.researchScope(profile,type);
  if (!ensure(template.materials, template.cost*(scope+1))) return { published: false, blocked:'start', runs,reviews,paidRuns,supportRuns,actions,purchases,expense,raids,minFunding,funding:profile.funding };
  must(act(`research:start:${type}`),'start');
  while (profile.research.project && steps++ < 100) {
    const project=profile.research.project;
    let action;
    if (project.status==='ready') action='publish';
    else if (project.status==='submitted') { action='review'; reviews++; }
    else if (game.researchView(profile).actions.some(a=>a.id==='research:submit' && !a.disabled)) action='submit';
    else {
      const pview=game.researchView(profile).project;
      const cost=pview.experimentCost;
      const cards=pview.experimentMaterials?.compute ?? pview.experimentCompute ?? (pview.supportedExperiment ? 0 : 1+project.scope);
      // Support may be described by the action rather than the view's material field.
      const offered=game.researchView(profile).actions.find(a=>a.id==='research:experiment');
      const free=cost===0 || /0 张算力|不消耗|免费/.test(offered?.name || '');
      if (!ensure(free?{}:{compute:cards}, cost)) return { published:false,blocked:'experiment',runs,reviews,paidRuns,supportRuns,actions,purchases,expense,raids,minFunding,funding:profile.funding };
      action='experiment'; runs++; if (free) supportRuns++; else paidRuns++;
    }
    must(act(`research:${action}`),action);
    if(action==='review' && /支持评审/.test(profile.research.project?.lastOutcome || '')) supportAcceptance++;
  }
  return { published:!profile.research.project, runs,reviews,paidRuns,supportRuns,actions,purchases,expense,raids,minFunding,
    funding:profile.funding, engineering:game.skillLevels(profile.research).engineering, methods:profile.research.methods[type],
    supportAcceptance };
}
async function researchScenarios(game,n) {
  const out=[];
  for (const tier of TIERS) for (const type of ['replicate','evaluate',...(tier.stage?['finetune']:[])]) {
    const rows=Array.from({length:n},(_,index)=>paperPath(game,index,{tier,type,abundant:true}));
    out.push({tier:tier.id,type,...aggregateRows(rows,['runs','reviews','paidRuns','supportRuns','supportAcceptance','expense','actions','engineering','methods']),
      unpublished:rows.filter(r=>!r.published).length, over800:rows.filter(r=>r.expense>800).length });
  }
  return out;
}
async function starterScenarios(game,n) {
  const out=[];
  for (const type of ['replicate','evaluate']) for(const recover of [false,true]) {
    const rows=Array.from({length:n},(_,index)=>paperPath(game,index,{type,recover}));
    out.push({type,recover,...aggregateRows(rows,['runs','reviews','paidRuns','supportRuns','supportAcceptance','expense','funding','minFunding','raids','actions']),
      published:rows.filter(r=>r.published).length, exhausted:rows.filter(r=>!r.published).length,
      neededResupply:rows.filter(r=>r.raids>0).length });
  }
  return out;
}
export function eligiblePromotion(game,index,tier=TIERS[0]) {
  const career=fixture(game,index,tier), r=career.profile.research, next=game.STAGES[tier.stage+1];
  career.profile.funding=100000;
  career.profile.achievement=next.credit;
  r.papers=Array.from({length:next.papers},(_,i)=>({id:`paper-${i+1}`,type:'replicate',title:`Fixture ${i+1}`,quality:80,evidence:65,credit:30,day:i}));
  r.completed.replicate=next.papers; r.sequence=next.papers; r.methods.replicate=30;
  for(const key of ['engineering','research','expression']) {
    const level=key==='expression'?Math.max(1,next.skill-1):next.skill;
    r.skills[key]=3*(level-1);
    if(r.skillFloors) r.skillFloors[key]=level;
  }
  return career;
}
export function promotionPath(game,index,tier=TIERS[0]) {
  let career=eligiblePromotion(game,index,tier);
  let attempts=0,retryRaids=0,blockedClicks=0;
  while(career.profile.research.stage===tier.stage && attempts<8) {
    must(game.hubAct(career,'research:promote'),'qualified promotion'); attempts++;
    if(career.profile.research.stage>tier.stage) break;
    const before=JSON.stringify(career);
    const denied=game.hubAct(career,'research:promote');
    if(denied.ok || before!==JSON.stringify(career)) throw new Error('promotion retry is not atomic and action-earned');
    blockedClicks++;
    career=game.migrateCareer(JSON.stringify(career));
    playRaid(game,career,{seed:seedFor(index,80+retryRaids),difficulty:'easy',searches:4,approach:'steady'});
    retryRaids++;
  }
  return {attempts,retryRaids,blockedClicks,promoted:Number(career.profile.research.stage===tier.stage+1)};
}
async function promotionScenarios(game,n) {
  return TIERS.map(tier=>{
    const rows=Array.from({length:n},(_,index)=>promotionPath(game,index,tier));
    return {tier:tier.id,fromStage:tier.stage,...aggregateRows(rows,['attempts','retryRaids','blockedClicks']),
      attemptCounts:Object.fromEntries([1,2,3,4,5,6,7,8].map(n=>[n,rows.filter(r=>r.attempts===n).length])),unpromoted:rows.filter(r=>!r.promoted).length};
  });
}

export function progressionPath(game,index,{projectLimit=80,economic=false}={}) {
  const career=game.createCareer(seedFor(index)); if(!economic) career.profile.funding=1000000;
  let projects=0,attempts=0,expense=0,actions=0;
  while(career.profile.research.stage<8 && projects<projectLimit) {
    const stage=career.profile.research.stage;
    const device=stage>=3?'remote_terminal':stage>=1?'gpu_workstation':'lightweight_laptop';
    if(career.profile.loadout.device!==device) {
      let bought=false;
      for(let retries=0;retries<100;retries++) {
        const funds=career.profile.funding;
        const result=game.hubAct(career,`buy-equip:${device}`);
        if(result.ok) {expense+=funds-career.profile.funding;actions++;bought=true;break;}
        if(!economic) throw new Error(`upgrade: ${result.reason}`);
        const outing=playRaid(game,career,{seed:seedFor(index,20+career.profile.raids),difficulty:'easy',searches:4});
        actions+=outing.actions+sellSurplus(game,career,{});
      }
      if(!bought) throw new Error('device recovery limit');
    }
    const view=game.researchView(career.profile);
    if(view.actions.some(a=>a.id==='research:promote' && !a.disabled)) {
      must(game.hubAct(career,'research:promote'),'progression promotion'); attempts++; actions++; continue;
    }
    // Prefer the unlocked higher-credit project, without fabricating skills.
    const levels=game.skillLevels(career.profile.research);
    const type=stage>=1 && levels.engineering>=2 && levels.research>=2 ? 'finetune':'replicate';
    const result=paperPath(game,index,{type,existingCareer:career,recover:economic});
    if(!result.published) throw new Error(`funded progression blocked: ${JSON.stringify(result)}`);
    projects++; expense+=result.expense; actions+=result.actions;
  }
  return {stage:career.profile.research.stage,projects,attempts,expense,actions,raids:career.profile.raids,funding:career.profile.funding,
    engineering:game.skillLevels(career.profile.research).engineering,research:game.skillLevels(career.profile.research).research,
    expression:game.skillLevels(career.profile.research).expression};
}
async function progressionScenarios(game,n) {
  const rows=Array.from({length:n},(_,index)=>progressionPath(game,index));
  return {...aggregateRows(rows,['projects','attempts','expense','actions','engineering','research','expression']),
    incomplete:rows.filter(r=>r.stage!==8).length,note:'Resource-fed gate audit (1,000,000 funding), not an economic completion-time claim'};
}
async function recoveryScenarios(game,n) {
  const rows=Array.from({length:n},(_,index)=>paperPath(game,index,{recover:true,initialFunding:0}));
  return {...aggregateRows(rows,['runs','reviews','expense','raids','funding']),incomplete:rows.filter(r=>!r.published).length,
    note:'Zero starting funds; keep starter equipped gear; real free easy conference raids, four visible steady searches; buy needed items when affordable, sell surplus'};
}

async function learningScenarios(game,n) {
  const out=[];
  for(const tier of TIERS) {
    const checkpoints=[];
    for(let index=0;index<n;index++) {
      const career=fixture(game,index,tier); career.profile.funding=1000000;
      for(let project=1;project<=20;project++) {
        const row=paperPath(game,index,{type:'replicate',existingCareer:career});
        if(!row.published) throw new Error('repeated learning path failed');
        if([1,4,8,12,20].includes(project)) checkpoints.push({project,...game.skillLevels(career.profile.research),methods:career.profile.research.methods.replicate});
      }
    }
    out.push({tier:tier.id,scope:Math.min(2,Math.floor(tier.stage/3)),checkpoints:[1,4,8,12,20].map(project=>({project,...aggregateRows(checkpoints.filter(x=>x.project===project),['engineering','research','expression','methods'])}))});
  }
  return out;
}

async function economyScenarios(game,n) {
  const rows=Array.from({length:n},(_,index)=>progressionPath(game,index,{economic:true}));
  return {...aggregateRows(rows,['projects','attempts','expense','actions','raids','funding']),
    incomplete:rows.filter(r=>r.stage!==8).length,note:'Coupled actual-economy path from initial800; visible steady four-search free easy conference resupply; shop-first; prioritize finetune after unlock; real device purchases'};
}

export async function simulate({root=DEFAULT_ROOT,seeds=1000,sections=['raids','research','starter','promotion','progression','recovery','learning']}={}) {
  const game=await loadGame(root);
  const sourceSha256=Object.fromEntries(await Promise.all(['career.js','research.js','research-factors.js','probability-raid.js','raid-balance.js'].map(async file=>[file,await readFile(path.join(root,'src',file)).then(bytes=>createHash('sha256').update(bytes).digest('hex')).catch(()=>null)])));
  const result={schema:1,sourceSha256,seeds,seedAlgorithm:'mix32(index+1 XOR imul(stream+1,0x9e3779b9)); constants 0x21f0aaad,0x735a2d97',
    policy:'blind first legal non-exit encounter option; steady raids; submit as soon as legal; shop-first research; recovery uses four visible steady searches at free easy conference',root};
  if(sections.includes('raids')) result.raids=await raidScenarios(game,seeds);
  if(sections.includes('research')) result.research=await researchScenarios(game,seeds);
  if(sections.includes('starter')) result.starter=await starterScenarios(game,seeds);
  if(sections.includes('promotion')) result.promotion=await promotionScenarios(game,seeds);
  if(sections.includes('progression')) result.progression=await progressionScenarios(game,seeds);
  if(sections.includes('recovery')) result.recovery=await recoveryScenarios(game,seeds);
  if(sections.includes('learning')) result.learning=await learningScenarios(game,seeds);
  if(sections.includes('economy')) result.economy=await economyScenarios(game,seeds);
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2); const get=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
  const result=await simulate({root:path.resolve(get('--root',DEFAULT_ROOT)),seeds:Number(get('--seeds','1000')),sections:get('--sections','raids,research,starter,promotion,progression,recovery,learning').split(',')});
  const output=JSON.stringify(result,null,2)+'\n'; const file=get('--json',null);
  if(file) { await writeFile(file,output); console.log(`Wrote ${file}: ${result.seeds} seeds/case`); } else process.stdout.write(output);
}
