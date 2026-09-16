import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const model=JSON.parse(await readFile(join(root,'public/model/manifest.json'),'utf8'));
const semanticPacked=await readFile(join(root,'public/semantic.json.gz'));
const semantic=JSON.parse(gunzipSync(semanticPacked));
const files=['index.html','style.css','favicon.svg','app.js','render.js','engine.js','worker.js','search.js','semantic.js','semantic-runtime.js',
 'public/manifest.json','public/catalog.json.gz','public/elitech.json','public/semantic.json.gz','public/vectors.f32.gz','public/model/manifest.json',
 ...Object.keys(model.files).filter(n=>n.endsWith('.json')).map(n=>'public/model/'+n),...model.parts.map(p=>'public/model/'+p.file),
 'vendor/transformers.min.js','vendor/ort-wasm-simd-threaded.jsep.mjs','vendor/ort-wasm-simd-threaded.jsep.wasm','vendor/LICENSE-APACHE-2.0.txt','vendor/LICENSE-ONNX.txt','vendor/LICENSE-JINJA.txt','vendor/NOTICE.txt'];
for(const file of files.filter(f=>f.endsWith('.js')&&!f.startsWith('vendor/'))){const check=spawnSync(process.execPath,['--check',join(root,file)],{encoding:'utf8'});if(check.status!==0)throw Error(check.stderr);}
const packed=await readFile(join(root,'public/catalog.json.gz'));
const manifest=JSON.parse(await readFile(join(root,'public/manifest.json'),'utf8'));
if(hash(packed)!==manifest.index_sha256||hash(packed)!==semantic.catalog_sha256)throw Error('Catalog integrity mismatch');
if(hash(await readFile(join(root,'public/vectors.f32.gz')))!==semantic.vectors_sha256)throw Error('Vector integrity mismatch');
if(JSON.stringify(model)!==JSON.stringify(semantic.model))throw Error('Model/index mismatch');
for(const part of model.parts)if(hash(await readFile(join(root,'public/model',part.file)))!==part.sha256)throw Error('Weight integrity mismatch');
for(const [name,expected] of Object.entries(model.files).filter(([n])=>n.endsWith('.json')))if(hash(await readFile(join(root,'public/model',name)))!==expected)throw Error('Tokenizer integrity mismatch');
manifest.semantic_sha256=hash(semanticPacked);
await writeFile(join(root,'public/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const html=await readFile(join(root,'index.html'),'utf8');
if(/(?:src|href)=["']\//.test(html))throw Error('Root-relative paths would break GitHub project Pages');
const out=join(root,'docs');await mkdir(join(out,'public'),{recursive:true});
for(const file of files){await mkdir(dirname(join(out,file)),{recursive:true});await copyFile(join(root,file),join(out,file));}
await writeFile(join(out,'.nojekyll'),'');
await writeFile(join(out,'build.json'),JSON.stringify({version:'4.2.0',index_sha256:manifest.index_sha256,semantic_sha256:manifest.semantic_sha256,files},null,2));
console.log(`Build complete: ${files.length} assets, ${semantic.documents.length} semantic vectors. Output: docs/`);
