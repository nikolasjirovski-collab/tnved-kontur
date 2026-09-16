import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(process.env.BUNDLED_NODE_MODULES+'/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const targets=process.env.TNVED_TEST_URL?[process.env.TNVED_TEST_URL]:[
  pathToFileURL(resolve('index.html')).href,
  pathToFileURL(resolve('docs/index.html')).href,
  'http://127.0.0.1:8765/'
];
try{
  for(const target of targets){
    const page=await browser.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.goto(target);
    if(target.startsWith('file:'))await page.waitForURL('https://nikolasjirovski-collab.github.io/tnved-kontur/**',{timeout:30000});
    await page.locator('#load-status').filter({hasText:'Справочник загружен'}).waitFor({timeout:60000});
    await page.locator('#description').fill('Карбюратор');
    await page.locator('#results-content').getByText(/Точное совпадение названия/).waitFor({timeout:15000});
    assert(await page.locator('.candidate .code').count()>0);
    assert(await page.locator('#search-button').isEnabled());
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({from:target,to:page.url(),result:'Search succeeded without console errors'}));
    await page.close();
  }
}finally{await browser.close();}
