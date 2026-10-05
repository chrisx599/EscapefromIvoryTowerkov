import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createCareer,careerView} from '../src/career.js';
const probe=createServer(); await new Promise(r=>probe.listen(0,'127.0.0.1',r)); const port=probe.address().port; await new Promise(r=>probe.close(r));
const dir=await fs.mkdtemp('/tmp/warehouse-qa-'), base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),GAME_SAVE_DIR:dir},stdio:'ignore'});
let browser; const errors=[];let checks=0;
try {
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/meta')).ok)break;}catch{} await new Promise(r=>setTimeout(r,50));}
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 for(const width of [1440,390,320]) {
 const c=createCareer(888); c.profile.stash.dataset=5; c.profile.stash.src_code=3;c.profile.funding=1000;
 const sid=randomBytes(12).toString('hex');await fs.writeFile(dir+'/'+sid+'.json',JSON.stringify(c));
 const ctx=await browser.newContext({baseURL:base,viewport:{width,height:900}});await ctx.addCookies([{name:'sid',value:sid,url:base}]);
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto('/');await p.locator('[data-workspace-tab="inventory"]').click();
 await p.locator('#hub-stash .item-cell').first().waitFor();
 const initial=await (await p.request.get('/api/state')).json();assert.equal(await p.locator('#hub-stash .item-cell').count(),initial.hub.stashUsed);checks++;
 assert.equal(await p.locator('#hub-stash .item-cell[data-item-id="dataset"]').count(),5);checks++;
 await p.locator('#stash-sort').click();await p.locator('#stash-batch').click();await p.locator('#hub-stash .item-cell[data-item-id="dataset"]').nth(0).click();await p.locator('#hub-stash .item-cell[data-item-id="dataset"]').nth(1).click();
 const response=p.waitForResponse(r=>r.url().endsWith('/api/hub/action')&&r.request().method()==='POST');await p.locator('#stash-bulk-sell').click();assert.equal((await response).status(),200);
 await p.waitForFunction(()=>document.querySelectorAll('#hub-stash .item-cell[data-item-id="dataset"]').length===3); checks++;
 await p.reload();await p.locator('[data-workspace-tab="inventory"]').click();assert.equal(await p.locator('#hub-stash .item-cell[data-item-id="dataset"]').count(),3);checks++;
 assert.ok((await p.locator('#warehouse-upgrade-card').innerText()).length<45);checks++;
 await p.screenshot({path:`.artifacts/warehouse-grid-v10-${width}.png`,fullPage:true});
 await p.locator('[data-workspace-tab="shop"]').click();
 for(const category of ['materials','equipment','supplies','all']) {await p.locator(`[data-shop-category="${category}"]`).click();assert.equal(await p.locator(`[data-shop-category="${category}"]`).getAttribute('aria-pressed'),'true');checks++;}
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks++;
 await p.screenshot({path:`.artifacts/warehouse-v10-${width}.png`,fullPage:true});await ctx.close();
 }
 assert.deepEqual(errors,[]); console.log(JSON.stringify({checks,errors}));
} finally {await browser?.close();server.kill();await fs.rm(dir,{recursive:true,force:true});}
