import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=['index.html','style.css','favicon.svg','app.js','render.js','engine.js','worker.js','public/manifest.json','public/catalog.json.gz'];
for(const file of files.filter(f=>f.endsWith('.js'))){const check=spawnSync(process.execPath,['--check',join(root,file)],{encoding:'utf8'});if(check.status!==0)throw Error(check.stderr);}
const packed=await readFile(join(root,'public/catalog.json.gz'));
const manifest=JSON.parse(await readFile(join(root,'public/manifest.json'),'utf8'));
if(createHash('sha256').update(packed).digest('hex')!==manifest.index_sha256)throw Error('Catalog integrity mismatch');
const html=await readFile(join(root,'index.html'),'utf8');
if(/(?:src|href)=["']\//.test(html))throw Error('Root-relative paths would break GitHub project Pages');
const out=join(root,'docs');await mkdir(join(out,'public'),{recursive:true});
for(const file of files)await copyFile(join(root,file),join(out,file));
await writeFile(join(out,'.nojekyll'),'');
await writeFile(join(out,'build.json'),JSON.stringify({version:'2.0.0',index_sha256:manifest.index_sha256,files},null,2));
console.log(`Build complete: ${files.length} application assets; ${(packed.length/1e6).toFixed(2)} MB index. Output: docs/`);
