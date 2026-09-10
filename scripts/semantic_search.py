"""Python encoder and the same reviewed ranking module as the website (requires Node.js)."""
import argparse,json,subprocess,sys
from datetime import date
from pathlib import Path
from build_semantic import load_model

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('description')
    for field in ['material','purpose','construction','specifications']:parser.add_argument('--'+field,default='')
    parser.add_argument('--as-of',default=date.today().isoformat())
    parser.add_argument('--equipment',choices=['all','electric','petrol'],default='all');args=parser.parse_args()
    profile=vars(args)
    # Ask the shared module to form and validate the encoder input first.
    runner=Path(__file__).with_name('rank_query.mjs')
    def call(payload):
        result=subprocess.run(['node',str(runner)],input=json.dumps(payload,ensure_ascii=False),text=True,encoding='utf-8',capture_output=True)
        if result.returncode:raise ValueError(result.stderr.strip())
        return json.loads(result.stdout)
    request=call({'profile':profile,'action':'prepare'})
    vector=None
    if not request['code_query']:
        model=load_model()
        if len(model.tokenizer.encode(request['text']))>128:raise ValueError('Сократите описание до названия и ключевых характеристик.')
        vector=model.encode(request['text'],normalize_embeddings=True).tolist()
    print(json.dumps(call({'profile':profile,'vector':vector}),ensure_ascii=False,indent=2))

if __name__=='__main__':
    try:main()
    except ValueError as error:print(str(error),file=sys.stderr);sys.exit(1)
