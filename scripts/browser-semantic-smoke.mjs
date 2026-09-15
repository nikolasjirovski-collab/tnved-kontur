import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Use the bundled Playwright package; no project dependency changes are needed.
const require=createRequire(process.env.BUNDLED_NODE_MODULES+'/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base=process.env.TNVED_TEST_URL||'http://127.0.0.1:8765/';
try{
  await page.goto(base);
  await page.locator('#load-status').filter({hasText:'Справочник загружен'}).waitFor({timeout:60000});
  const queries=['Карбюратор','Устройство смешивания бензина с воздухом для двигателя мотокосы','Защитный щиток режущей головки бензокосы','абракадабракса'];
  for(const query of queries){
    await page.locator('#description').fill(query);
    await page.locator('#search-button').click();
    await page.waitForFunction(()=>!document.getElementById('search-button').disabled,{},{timeout:240000});
    const result=await page.locator('#results-content').innerText();
    console.log(JSON.stringify({query,result:result.slice(0,1400)}));
    assert(!result.includes('Смысловой поиск недоступен'),result);
    if(query.startsWith('Устройство')){assert(result.includes('Смысловой поиск:'));assert(result.includes('8409910008'));}
    if(query==='Карбюратор')assert(result.includes('Точное совпадение'));
    if(query.startsWith('Защитный')){
      await mkdir('../work/semantic_cache',{recursive:true});
      await page.screenshot({path:'../work/semantic_cache/semantic-browser.png',fullPage:true});
    }
  }
  assert.deepEqual(errors,[]);
  console.log('Browser button, model download, semantic result and repeated search verified.');
}finally{await browser.close();}
