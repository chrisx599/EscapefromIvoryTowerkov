import test from 'node:test';
import assert from 'node:assert/strict';
import {createCareer, hubAct, careerView, migrateCareer} from '../src/career.js';
test('batch sale is atomic, priced per unit and preserves equipped/reserved items', () => {
 const c=createCareer(42); c.profile.stash.dataset=6; c.profile.stash.src_code=4;
 const before=structuredClone(c); assert.equal(hubAct(c,'sell-batch:'+JSON.stringify({dataset:2,src_code:99})).ok,false); assert.deepEqual(c,before);
 const view=careerView(c), price=view.items.find(x=>x.id==='dataset').sellPrice;
 const funding=c.profile.funding; const result=hubAct(c,'sell-batch:'+JSON.stringify({dataset:3}));
 assert.equal(result.ok,true); assert.equal(c.profile.stash.dataset,3); assert.equal(c.profile.funding,funding+price*3);
 for(const bad of ['[]','null','{}','{"dataset":-1}','{"dataset":1.5}','{"dataset":999999}','{"unknown":1}']) {const snapshot=structuredClone(c); assert.equal(hubAct(c,'sell-batch:'+bad).ok,false); assert.deepEqual(c,snapshot);}
 const migrated=migrateCareer(JSON.parse(JSON.stringify(c))); assert.equal(migrated.profile.stash.dataset,3);
});
test('batch excludes reserved supplies and the last worn equipment copy',()=>{
 const c=createCareer(8);c.profile.stash.coffee_ticket=3;
 assert.equal(hubAct(c,'pack:coffee_ticket').ok,true);
 assert.equal(hubAct(c,'sell-batch:{"coffee_ticket":3}').ok,false);
 assert.equal(hubAct(c,'sell-batch:{"coffee_ticket":2}').ok,true);
 assert.equal(c.profile.stash.coffee_ticket,1);assert.ok(c.profile.supplies.includes('coffee_ticket'));
 const id=Object.values(c.profile.loadout).find(Boolean);assert.ok(id);
 const before=structuredClone(c);assert.equal(hubAct(c,'sell-batch:'+JSON.stringify({[id]:1})).ok,false);assert.deepEqual(c,before);
});
