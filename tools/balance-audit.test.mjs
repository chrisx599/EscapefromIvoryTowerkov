import test from 'node:test';
import assert from 'node:assert/strict';
import * as balance from '../src/raid-balance.js';
import * as factors from '../src/research-factors.js';
import { loadGame, seedFor, fixture, TIERS, playRaid, paperPath, promotionPath, eligiblePromotion, progressionPath, simulate } from './balance-simulation.mjs';
const game = await loadGame();
const pass = (result, label = '') => assert.equal(result.ok, true, `${label}: ${result.reason || ''}`);

test('independent raid grid: finite bounded distributions sum exactly, including malformed inputs', () => {
  for (const difficulty of ['easy','normal','hard']) for (const risk of [0,20,50,100,NaN,Infinity,-Infinity]) {
    for (const level of [1,4,7,10,NaN,999]) for (const depth of [0,2,4,99]) {
      const input={difficulty,risk,depth,engineering:level,research:level,expression:level,
        searches:8,load:6,capacity:7,will:1,willMax:10,venueGrowth:12,venueBaseRisk:12,base:60,hasSkill:true,skillLevel:level,neutral:true};
      const p=balance.raidExtractionProbabilities(input);
      assert.ok(Number.isFinite(p.full)); assert.ok(p.fail>=3 && p.fail<=42); assert.ok(p.partial>=6 && p.partial<=36);
      assert.ok(Math.abs(p.full+p.partial+p.fail-100)<1e-9);
      const search=balance.raidSearchProbability(input).chance;
      assert.ok(search>=12 && search<=84);
      const event=balance.raidEventProbability(input);
      assert.ok(event>=18 && event<=88);
      const after=balance.raidRiskAfterSearch(input); assert.ok(after>=0 && after<=100);
    }
  }
});

test('independent monotonicity: difficulty and accumulated pressure cannot improve checks', () => {
  const base={research:4,engineering:4,expression:4,stage:3,venueMinStage:2,venueBaseRisk:12,venueDifficulty:8,
    venueGrowth:12,risk:30,depth:1,searches:4,load:3,capacity:7,will:5,willMax:10,base:60,hasSkill:true,skillLevel:4,neutral:true};
  const variants=['easy','normal','hard'].map(difficulty=>({...base,difficulty}));
  for(let i=1;i<variants.length;i++) {
    assert.ok(balance.raidSearchProbability(variants[i]).chance<=balance.raidSearchProbability(variants[i-1]).chance);
    assert.ok(balance.raidExtractionProbabilities(variants[i]).fail>=balance.raidExtractionProbabilities(variants[i-1]).fail);
    assert.ok(balance.raidEventProbability(variants[i])<=balance.raidEventProbability(variants[i-1]));
  }
  for(const [key,values] of Object.entries({risk:[0,20,40,60,80,100],depth:[0,1,2,3,4],searches:[0,2,4,6,8],load:[0,3,5,7],will:[10,5,2,0]})) {
    let previous;
    for(const value of values) {
      const x={...base,[key]:value}; const row={search:balance.raidSearchProbability(x).chance,fail:balance.raidExtractionProbabilities(x).fail,event:balance.raidEventProbability(x)};
      if(previous) { assert.ok(row.search<=previous.search,key); assert.ok(row.fail>=previous.fail,key); assert.ok(row.event<=previous.event,key); }
      previous=row;
    }
  }
  let previous=0, previousGain=Infinity;
  for(let level=1;level<=10;level++) {
    const next=balance.raidDiminishingSkill(level,24), gain=next-previous;
    assert.ok(gain>=0); if(level>1) assert.ok(gain<=previousGain+1e-10);
    previous=next; if(level>1)previousGain=gain;
  }
});

test('independent research grid: bounded probabilities, genuine saturated failure tails', () => {
  for(const v of [NaN,Infinity,-Infinity,-999,0,1,10,100,1e9]) {
    const x=Object.fromEntries(['engineering','research','expression','quality','evidence','experience','equipment','scope','stage','headroom','support','preparation'].map(k=>[k,v]));
    for(const type of ['replicate','evaluate','finetune']) {
      const p=factors.reviewProbability(x,type); assert.ok(Number.isFinite(p) && p>=0 && p<=.90);
      const e=factors.experimentProbability(x); assert.ok(e>=.30 && e<=.85);
      const outcome=factors.experimentOutcome(x,1); assert.ok(Number.isFinite(outcome.qualityGain)); assert.equal(outcome.success,false);
    }
  }
  const saturated={quality:100,evidence:100,engineering:10,research:10,expression:10,experience:30,equipment:12,preparation:2,support:6,headroom:2,topicFit:true};
  assert.notEqual(factors.reviewOutcome(saturated,.9999).status,'ready');
  assert.equal(factors.experimentOutcome(saturated,.9999).success,false);
  assert.equal(factors.reviewOutcome({...saturated,runs:8,reviewFailures:4},.9999).status,'ready');
  for(const key of ['engineering','research','equipment','headroom','preparation','experience','quality','evidence','support']) {
    let previous=0;
    for(const value of [0,1,2,3,5,10,20,30,50,100]) { const p=factors.experimentProbability({[key]:value}); assert.ok(p>=previous,key); previous=p; }
  }
});

test('first papers fit starter funds or recover through actual free outings across fixed seeds', () => {
  for(let i=0;i<64;i++) for(const type of ['replicate','evaluate']) {
    const row=paperPath(game,i,{type,recover:true});
    assert.equal(row.published,true); assert.ok(row.paidRuns<=5); assert.ok(row.runs<=10); assert.ok(row.funding>=0);
  }
});

test('zero-funding careers still recover first papers through real inventory sales and free raids', () => {
  for(let i=0;i<16;i++) {
    const row=paperPath(game,i,{type:'replicate',recover:true,initialFunding:0});
    assert.equal(row.published,true); assert.ok(row.raids>0 && row.raids<200); assert.ok(row.funding>=0);
  }
});

test('qualified promotions have action-earned retries, saved failures and a finite support bound', () => {
  let failures=0;
  for(const tier of TIERS) for(let i=0;i<64;i++) {
    const result=promotionPath(game,i,tier);
    assert.equal(result.promoted,1); assert.ok(result.attempts>=1 && result.attempts<=4);
    assert.equal(result.retryRaids,result.attempts-1); failures+=result.blockedClicks;
  }
  assert.ok(failures>0,'a promotion should not be deterministic');
});

test('views, reloads and settlement replay do not create promotion retry progress', () => {
  let career;
  for(let i=0;i<128;i++) {
    const candidate=eligiblePromotion(game,i);
    pass(game.hubAct(candidate,'research:promote'));
    if(candidate.profile.research.stage===0) { career=candidate; break; }
  }
  assert.ok(career);
  for(let i=0;i<4;i++) {
    const before=JSON.stringify(career.profile.research); game.careerView(career); game.researchView(career.profile);
    assert.equal(JSON.stringify(career.profile.research),before);
    career=game.migrateCareer(JSON.stringify(career));
    const retry=game.hubAct(career,'research:promote'); assert.equal(retry.ok,false);
  }
  playRaid(game,career,{seed:seedFor(444),searches:0,difficulty:'easy'});
  assert.equal(game.hubAct(career,'research:promote').ok,false,'empty deployments cannot buy retry access');
  const before=JSON.stringify(career.profile); assert.equal(game.settle(career),false); assert.equal(JSON.stringify(career.profile),before);
  playRaid(game,career,{seed:seedFor(445),searches:4,difficulty:'easy',approach:'steady'});
  pass(game.hubAct(career,'research:promote'));
});

test('new free repair preserves progress but cannot farm XP, method practice or funding', () => {
  const c=fixture(game,90); c.profile.funding=10000; Object.assign(c.profile.stash,{dataset:2,src_code:2,compute:20});
  pass(game.hubAct(c,'research:start:replicate'));
  for(let i=0;i<5;i++) pass(game.hubAct(c,'research:experiment'));
  const funding=c.profile.funding, compute=c.profile.stash.compute, skills=structuredClone(c.profile.research.skills), methods=structuredClone(c.profile.research.methods);
  for(let i=0;i<20;i++) pass(game.hubAct(c,'research:experiment'));
  assert.equal(c.profile.funding,funding); assert.equal(c.profile.stash.compute,compute);
  assert.deepEqual(c.profile.research.skills,skills); assert.deepEqual(c.profile.research.methods,methods);
  assert.equal(c.profile.research.project.quality,100); assert.equal(c.profile.research.project.evidence,100);
});

test('old levels, titles, ready papers and one-time grants survive repeat migration', () => {
  for(const stage of [0,1,3,6,8]) for(const xp of [0,3,9,18,27,54]) {
    const c=game.createCareer(seedFor(stage+xp)); const r=c.profile.research;
    r.stage=stage; r.skills={engineering:xp,research:xp,expression:xp};
    delete r.balanceVersion; delete r.skillFloors;
    r.project={id:'paper-5',type:'replicate',direction:'llm',title:'Earned ready paper',scope:0,quality:88,evidence:75,runs:7,successfulRuns:4,setbacks:3,reviews:4,submittedRuns:7,status:'ready'};
    c.profile.funding=1234;
    let current=game.migrateCareer(JSON.stringify(c));
    assert.equal(current.profile.research.stage,stage); assert.equal(current.profile.research.project.status,'ready');
    assert.ok(game.skillLevels(current.profile.research).engineering>=Math.min(10,1+Math.floor(xp/3)));
    for(let i=0;i<3;i++) {
      const research=structuredClone(current.profile.research);
      current=game.migrateCareer(JSON.stringify(current));
      assert.equal(current.profile.funding,1234); assert.deepEqual(current.profile.research,research);
    }
    pass(game.hubAct(current,'research:publish'));
    const after=JSON.stringify(current.profile); assert.equal(game.hubAct(current,'research:publish').ok,false); assert.equal(JSON.stringify(current.profile),after);
  }
});

test('simulation seeds and action policy reproduce exactly without wall-clock dependence', async () => {
  const a=await simulate({seeds:4,sections:['raids','research','starter','promotion']});
  const b=await simulate({seeds:4,sections:['raids','research','starter','promotion']});
  assert.deepEqual(a,b);
});


test('full funded progression unlocks higher-scope learning before later title gates', () => {
  for(let i=0;i<16;i++) assert.equal(progressionPath(game,i).stage,8);
});

test('repeating basic projects cannot grind past level four or ten method practice', () => {
  const career=fixture(game,33); career.profile.funding=100000;
  for(let i=0;i<20;i++) assert.equal(paperPath(game,i,{existingCareer:career}).published,true);
  const levels=game.skillLevels(career.profile.research);
  for(const value of Object.values(levels)) assert.ok(value<=4);
  assert.equal(career.profile.research.methods.replicate,10);
});


test('worst ordinary draws reach supported review within 7+scope runs and no more than five paid runs', () => {
  let seed=1;
  for(;seed<500000;seed++) {
    let x=seed; x^=x<<13;x^=x>>>17;x^=x<<5;
    if((x>>>0)/4294967296>.999) break;
  }
  assert.ok(seed<500000);
  for(const tier of TIERS) {
    const c=fixture(game,33,tier); c.profile.funding=10000;
    Object.assign(c.profile.stash,{dataset:1,src_code:1,compute:30});
    pass(game.hubAct(c,'research:start:replicate'));
    let steps=0;
    while(c.profile.research.project.status!=='ready' && steps++<40) {
      const view=game.researchView(c.profile);
      const action=view.nextActionId;
      c.profile.research.rng=seed;
      pass(game.hubAct(c,action));
    }
    const p=c.profile.research.project;
    assert.equal(p.status,'ready'); assert.ok(p.runs<=7+p.scope);
    assert.ok(p.reviewFailures>=4); assert.match(p.lastOutcome,/支持评审/);
    assert.equal(p.runs-p.supportedRuns,5);
  }
});
