"""Build a sanitized browser index; original files and saved cases are never exported."""
from pathlib import Path
import sys
import gzip
import json
import hashlib
from datetime import datetime, timezone
from collections import defaultdict

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT))
from tnved.core import Catalog, STOP, SUFFIXES, SYNONYMS, digest
from tnved.classification import document_features, MATERIALS, FIELDS


def main():
    c = Catalog()
    minimum = c.meta['snapshot_date']
    starts = {minimum, *[r[0] for r in c.con.execute('SELECT DISTINCT start FROM nomenclature WHERE start>?', (minimum,))]}
    periods = {}
    for day in sorted(starts):
        rows, _ = c.index(day)
        for code, row in rows.items():
            path, terms, specific, objects = document_features(row, c.tree_nodes)
            periods[(code, row['start'])] = {
                'code': code, 'description': row['description'], 'start': row['start'], 'end': row['end'],
                'line': row['source_line'], 'heading': row['heading'], 'chapter': row['chapter'],
                'chapter_notes': row['chapter_notes'], 'section_notes': row['section_notes'],
                'terms': sorted(terms), 'specific': specific, 'objects': sorted(objects),
            }
    # Deduplicate long notes and headings before export.
    strings, string_index = [], {}
    for row in periods.values():
        for key in ('heading', 'chapter', 'chapter_notes', 'section_notes'):
            value = row[key]
            if value not in string_index:
                string_index[value] = len(strings); strings.append(value)
            row[key] = string_index[value]
    nodes = {code: {'code': code, 'description': n['description'], 'url': n['url'],
                    'line': n['source_line'], 'variants': n['description_variants']}
             for code, n in c.tree_nodes.items()}
    refs = defaultdict(list)
    counts = defaultdict(lambda: defaultdict(int))
    for r in c.customer.con.execute('''SELECT r.entry_id,r.sheet,r.row_number,r.page,s.name,s.kind
                                       FROM refs r JOIN sources s ON s.id=r.source_id
                                       ORDER BY r.entry_id,s.name,r.row_number,r.page'''):
        counts[r['entry_id']][r['name']] += 1
        if counts[r['entry_id']][r['name']] <= 3:
            refs[r['entry_id']].append([r['name'], r['sheet'], r['row_number'], r['page']])
    entries = []
    for r in c.customer.con.execute('SELECT * FROM entries ORDER BY id'):
        entries.append({'name': r['name'], 'code': r['code'], 'normalized': r['normalized'],
                        'kind': r['kind'], 'terms': r['terms'].split(), 'refs': refs[r['id']],
                        'counts': dict(counts[r['id']])})
    issues = [dict(r) for r in c.customer.con.execute('''SELECT i.name,i.raw_code,i.reason,i.sheet,i.row_number,s.name AS file
                                                        FROM issues i JOIN sources s ON s.id=i.source_id''')]
    # Code expression screening data; no local paths or full source documents.
    data = {'meta': {'version': '2.0.0', 'method': 'web-hierarchical-support-v1', 'minimum_date': minimum,
                     'snapshot_date': minimum, 'built_at': datetime.now(timezone.utc).isoformat(),
                     'code_count': len({r['code'] for r in periods.values()}), 'pair_count': len(entries),
                     'source_hashes': c.meta['sources'], 'customer_sha256': c.customer.fingerprint,
                     'sources': c.customer.sources(),
                     'notice': 'CSV: classifikators.ru, полнота и дата редакции не подтверждены. ФНС: срез 27.04.2026.'},
            'tokenizer': {'stop': sorted(STOP), 'suffixes': SUFFIXES, 'synonyms': SYNONYMS},
            'weights': FIELDS, 'materials': sorted(MATERIALS), 'strings': strings,
            'records': list(periods.values()), 'nodes': nodes, 'entries': entries, 'issues': issues,
            'guidance': c.guidance, 'pp': c.pp, 'sgr': c.sgr, 'categories': c.categories}
    output = Path(__file__).resolve().parents[1] / 'public'
    output.mkdir(exist_ok=True)
    packed = gzip.compress(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode(), compresslevel=9, mtime=0)
    (output / 'catalog.json.gz').write_bytes(packed)
    manifest = {**data['meta'], 'index_sha256': hashlib.sha256(packed).hexdigest(), 'bytes': len(packed)}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'records':len(periods),'pairs':len(entries),'gzip_bytes':len(packed)}, ensure_ascii=False))
    c.close()


if __name__ == '__main__':
    main()
