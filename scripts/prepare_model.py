"""Download a pinned public embedding model and package it for static hosting."""
from pathlib import Path
import urllib.request
import json
import hashlib
import shutil

ROOT=Path(__file__).resolve().parents[2]
REPO='Xenova/paraphrase-multilingual-MiniLM-L12-v2'
REV='2c4055b12046f11709e9df2c122e59ffbdc2f900'
MODEL=ROOT/'work/semantic_model'
PUBLIC=Path(__file__).resolve().parents[1]/'public/model'
FILES=['config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','onnx/model_quantized.onnx']
EXPECTED=dict(zip(FILES,[
    '05b570bff786faa5c4604152aa16f19f77ed6dfc31e47dd0f3dd987078693ac7',
    'b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441',
    '3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2',
    '06e405a36dfe4b9604f484f6a1e619af1a7f7d09e34a8555eb0b77b66318067f',
    '66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc']))

def main():
    MODEL.mkdir(parents=True,exist_ok=True);PUBLIC.mkdir(parents=True,exist_ok=True)
    hashes={}
    for name in FILES:
        target=MODEL/name;target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():
            print('Downloading',name,flush=True)
            with urllib.request.urlopen(f'https://huggingface.co/{REPO}/resolve/{REV}/{name}',timeout=120) as response, target.with_suffix(target.suffix+'.partial').open('wb') as out:
                shutil.copyfileobj(response,out)
            target.with_suffix(target.suffix+'.partial').replace(target)
        hashes[name]=hashlib.sha256(target.read_bytes()).hexdigest()
        if hashes[name]!=EXPECTED[name]:raise ValueError('Pinned model integrity mismatch: '+name)
        if name.endswith('.json'):shutil.copyfile(target,PUBLIC/Path(name).name)
        print(name,target.stat().st_size,flush=True)
    parts=[]
    with (MODEL/FILES[-1]).open('rb') as stream:
        while chunk:=stream.read(48*1024*1024):
            name=f'weights-{len(parts)}.bin';(PUBLIC/name).write_bytes(chunk)
            parts.append({'file':name,'bytes':len(chunk),'sha256':hashlib.sha256(chunk).hexdigest()})
    manifest={'model':REPO,'revision':REV,'dimension':384,'max_length':128,'pooling':'mean','normalize':True,'dtype':'q8','parts':parts,'files':hashes}
    (PUBLIC/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    # SentenceTransformer wrapper around precisely the same ONNX encoder used by the browser.
    (MODEL/'modules.json').write_text(json.dumps([{'idx':0,'name':'0','path':'','type':'sentence_transformers.models.Transformer'},{'idx':1,'name':'1','path':'1_Pooling','type':'sentence_transformers.models.Pooling'}]),encoding='utf-8')
    (MODEL/'sentence_bert_config.json').write_text(json.dumps({'max_seq_length':128,'do_lower_case':False}),encoding='utf-8')
    (MODEL/'1_Pooling').mkdir(exist_ok=True)
    (MODEL/'1_Pooling/config.json').write_text(json.dumps({'word_embedding_dimension':384,'pooling_mode_cls_token':False,'pooling_mode_mean_tokens':True,'pooling_mode_max_tokens':False,'pooling_mode_mean_sqrt_len_tokens':False}),encoding='utf-8')
    print('Model prepared',json.dumps(manifest),flush=True)

if __name__=='__main__':main()
