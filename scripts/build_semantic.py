"""Build real multilingual sentence embeddings with the pinned ONNX SentenceTransformer.

Examples are retrieval evidence, never verified classification labels. Max similarity
per code prevents duplicate aliases from voting for a code.
"""
from pathlib import Path
import gzip,json,hashlib,re,time,os
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
PUBLIC=Path(__file__).resolve().parents[1]/'public'
CACHE=ROOT/'work/semantic_cache'

def texts(data):
    documents=[];seen=set()
    for r in data['records']:
        code=r['code'];names=[]
        for value in [data['nodes'].get(code,{}).get('description',''),r['description'],*[data['nodes'].get(code[:n],{}).get('description','') for n in [9,8,6,4]]]:
            value=re.sub(r'^[\s\-\xa0]+','',value).strip()
            if value and value not in names:names.append(value)
        text='. '.join(names)[:1200]
        if (code,text) not in seen:documents.append({'code':code,'text':text,'kind':'nomenclature'});seen.add((code,text))
    by_code={}
    for e in data['entries']:
        if e['kind']!='xlsx':continue
        name=re.sub(r'\s+',' ',e['name']).strip()
        # Keep functional names; trim tail model/SKU strings, not Russian characteristics.
        name=re.split(r'\s+[A-ZА-Я]{2,}[\s\-_/\d(]',name,maxsplit=1)[0].strip()
        key=re.sub(r'[\d\W_]+',' ',name.casefold()).strip()
        if len(key)<3:continue
        bucket=by_code.setdefault(e['code'],{})
        bucket.setdefault(key,name)
    for code,bucket in sorted(by_code.items()):
        # Diversity by object and equipment; deterministic, without row-frequency votes.
        choices=sorted(bucket.values(),key=lambda s:(len(s),s))
        selected=[];groups=set()
        for name in choices:
            words=re.findall(r'[а-яё]+',name.lower())
            equipment=[w for w in words if re.search(r'бенз|мотокос|триммер|электро|перфоратор|шурупов|дрел|лобзик|шлиф|газонокос',w)]
            signature=' '.join(words[:3]+equipment)
            if signature in groups:continue
            groups.add(signature);selected.append(name)
        for name in selected:
            if (code,name) not in seen:documents.append({'code':code,'text':name,'kind':'example'});seen.add((code,name))
    glossary=json.loads(Path(__file__).with_name('domain_glossary.json').read_text(encoding='utf-8'))['terms']
    extra=[]
    # One glossary explanation per code/term/context, derived from an existing name.
    # No hand-maintained assignment of a definition to a legal code.
    for d in documents:
        name=re.sub(r'^[\s\-\xa0]+','',d['text']).casefold()
        for term in glossary:
            if not re.search(term['pattern'],name):continue
            context=''
            if re.search(r'бензокос|мотокос|бензопил|бензинов',name):context=' Для бензоинструмента.'
            elif re.search(r'электроинструмент|электропил|шурупов|перфоратор',name):context=' Для электроинструмента.'
            material=[]
            for pattern,label in [(r'медн|меди|медь','медь'),(r'резин','резина'),(r'сталь|стальн','сталь'),(r'пластмасс|пластик','пластмасса'),(r'алюмин','алюминий')]:
                if re.search(pattern,name):material.append(label)
            if len(material)==1:context+=' Материал: '+material[0]+'.'
            text=term['text']+context
            if (d['code'],text) not in seen:extra.append({'code':d['code'],'text':text,'kind':'glossary'});seen.add((d['code'],text))
    return documents+extra

def load_model():
    import torch,onnxruntime as ort
    from sentence_transformers import SentenceTransformer
    torch.set_num_threads(4)
    options=ort.SessionOptions();options.intra_op_num_threads=4;options.inter_op_num_threads=1
    model=SentenceTransformer(str(ROOT/'work/semantic_model'),backend='onnx',model_kwargs={
        'file_name':'onnx/model_quantized.onnx','export':False,'provider':'CPUExecutionProvider','session_options':options},local_files_only=True)
    model.max_seq_length=128
    return model

def main():
    data=json.loads(gzip.decompress((PUBLIC/'catalog.json.gz').read_bytes()))
    docs=texts(data);CACHE.mkdir(exist_ok=True,parents=True)
    identity=hashlib.sha256(json.dumps(docs,ensure_ascii=False).encode()+(PUBLIC/'model/manifest.json').read_bytes()).hexdigest()
    output=CACHE/(identity+'.npy')
    print('Preparing',len(docs),'semantic documents',flush=True)
    model=load_model();batch=64;started=time.monotonic()
    if output.exists():vectors=np.load(output)
    else:
        vectors=np.empty((len(docs),384),dtype=np.float32)
        previous={};previous_vectors=None
        if (PUBLIC/'semantic.json.gz').exists() and (PUBLIC/'vectors.f32.gz').exists():
            old=json.loads(gzip.decompress((PUBLIC/'semantic.json.gz').read_bytes()))
            if old['model']==json.loads((PUBLIC/'model/manifest.json').read_text()):
                previous_vectors=np.frombuffer(gzip.decompress((PUBLIC/'vectors.f32.gz').read_bytes()),dtype='<f4').reshape(-1,384)
                previous={(d['code'],d['text'],d['kind']):j for j,d in enumerate(old['documents'])}
        progress=CACHE/(identity+'.progress.json');partial=CACHE/(identity+'.partial.npy');start=0
        if progress.exists() and partial.exists():start=json.loads(progress.read_text())['done'];vectors=np.load(partial)
        for i in range(start,len(docs),batch):
            missing=[]
            for j,d in enumerate(docs[i:i+batch],start=i):
                old=previous.get((d['code'],d['text'],d['kind']))
                if old is not None:vectors[j]=previous_vectors[old]
                else:missing.append(j)
            if missing:
                values=model.encode([docs[j]['text'] for j in missing],batch_size=16,normalize_embeddings=True,show_progress_bar=False,convert_to_numpy=True)
                vectors[missing]=values
            if i%512==0 or i+batch>=len(docs):
                done=min(i+batch,len(docs));np.save(partial,vectors);progress.write_text(json.dumps({'done':done}))
                print(f'{done}/{len(docs)} encoded; {time.monotonic()-started:.1f}s',flush=True)
        np.save(output,vectors)
    # Float32 for cosine parity; gzip is supported by all target browsers.
    packed=gzip.compress(vectors.astype('<f4').tobytes(),compresslevel=6,mtime=0)
    (PUBLIC/'vectors.f32.gz').write_bytes(packed)
    index={'schema':1,'dimension':384,'documents':docs,'model':json.loads((PUBLIC/'model/manifest.json').read_text()),
           'vectors_sha256':hashlib.sha256(packed).hexdigest(),'catalog_sha256':hashlib.sha256((PUBLIC/'catalog.json.gz').read_bytes()).hexdigest(),'identity':identity}
    raw=gzip.compress(json.dumps(index,ensure_ascii=False,separators=(',',':')).encode(),mtime=0)
    (PUBLIC/'semantic.json.gz').write_bytes(raw)
    # Hold-out phrases are never added to indexed documents.
    queries=['Устройство смешивания бензина с воздухом для двигателя мотокосы','Защитный щиток режущей головки бензокосы','Зубчатое колесо механизма натяжения цепи бензопилы','Кольцевая медная прокладка под крепёж','Карбюратор','абракадабракса']
    q=model.encode(queries,batch_size=1,normalize_embeddings=True,show_progress_bar=False)
    fixtures=[]
    for phrase,vector in zip(queries,q):
        similarities=vectors@vector;order=np.argsort(-similarities);best=[];seen=set()
        for j in order:
            d=docs[int(j)]
            if d['code'] in seen:continue
            seen.add(d['code']);best.append({'code':d['code'],'text':d['text'],'cosine':float(similarities[j])})
            if len(best)==5:break
        fixtures.append({'query':phrase,'vector':vector.tolist(),'nearest':best})
        print(phrase,json.dumps(best,ensure_ascii=False),flush=True)
    (CACHE/'evaluation.json').write_text(json.dumps(fixtures,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Semantic index ready:',len(docs),'vectors;',len(packed),'compressed bytes',flush=True)

if __name__=='__main__':main()
