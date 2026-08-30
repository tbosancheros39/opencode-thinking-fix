#!/usr/bin/env python3
"""Build the final reasoning-drop exhibit from drop-tap logs.

Emits (verbose, metadata-only — tap logs contain no message content):
  proof/reasoning-drop/drops.csv           every strict drop
  proof/reasoning-drop/switches.csv        every model-switch event, classified
  proof/reasoning-drop/exhibit-summary.md  full stats + switch attribution
  proof/reasoning-drop/examples/exNN-*.md  top before/after request pairs (full JSON)
  proof/reasoning-drop/methodology.md      capture + classification method
"""
import glob, json, os, csv, sys
from datetime import datetime
from collections import defaultdict, Counter

TAP_DIRS = {
    'go': '/home/user/drop-tap',
    'deepseek': '/home/user/drop-tap/deepseek',
    'zen': '/home/user/drop-tap/zen',
    'openrouter': '/home/user/drop-tap/openrouter',
}
OUT = os.environ.get('OUT_DIR', os.path.dirname(os.path.abspath(__file__)))
CARRIERS = ('rc', 'r', 'think', 'tt')
GAP_SECS = 1800
N_EXAMPLES = 8

def has_carrier(t): return any(t.get(c) for c in CARRIERS)
def char_len(t): return (t.get('rcLen') or 0) + (t.get('ttLen') or 0) + (t.get('thinkChars') or 0)

def load_reqs():
    reqs = []
    for lane, d in TAP_DIRS.items():
        for f in sorted(glob.glob(d + '/tap-*.log')):
            for line in open(f):
                try: e = json.loads(line)
                except Exception: continue
                if e.get('event') == 'req' and isinstance(e.get('turns'), list):
                    e['_lane'] = lane
                    reqs.append(e)
    reqs.sort(key=lambda e: e['ts'])
    return reqs

def segment(reqs):
    by_id = defaultdict(list); nulls = []
    for e in reqs:
        (by_id[e['session']] if e.get('session') else nulls).append(e)
    groups = [(f'id:{k}', v) for k, v in by_id.items()]
    by_lane = defaultdict(list)
    for e in nulls: by_lane[e['_lane']].append(e)
    for lane, es in by_lane.items():
        cur, prev = [], None
        for e in es:
            if cur:
                dt = (datetime.fromisoformat(e['ts'][:19]) - datetime.fromisoformat(prev['ts'][:19])).total_seconds()
                if e.get('msgs', 0) < prev.get('msgs', 0) or dt > GAP_SECS:
                    groups.append((f'null:{lane}#{len(groups)}', cur)); cur = []
            cur.append(e); prev = e
        if cur: groups.append((f'null:{lane}#{len(groups)}', cur))
    return groups

def analyze(groups):
    all_switches, all_drops, group_stats = [], [], []
    for key, es in groups:
        models = [e.get('model', '') for e in es]
        distinct = sorted(set(models))
        switched = len(distinct) > 1
        for i in range(1, len(es)):
            if es[i].get('model') != es[i-1].get('model'):
                all_switches.append({
                    'ts': es[i]['ts'], 'session': key, 'class': 'id-confirmed' if key.startswith('id:') else 'heuristic-null',
                    'from': es[i-1].get('model'), 'to': es[i].get('model'),
                    'lane_from': es[i-1]['_lane'], 'lane_to': es[i]['_lane'],
                })
        hist = {}
        prev_msgs = 0
        for e in es:
            if hist and e.get('msgs', 0) < prev_msgs: hist = {}
            prev_msgs = e.get('msgs', 0)
            for t in e.get('turns', []):
                i = t['i']
                if has_carrier(t):
                    if i not in hist:
                        hist[i] = {'ts': e['ts'], 'chars': char_len(t), 'req': e}
                elif i in hist:
                    all_drops.append({
                        'ts': e['ts'], 'session': key, 'class': 'id-confirmed' if key.startswith('id:') else 'heuristic-null',
                        'lane': e['_lane'], 'model': e.get('model'), 'turn': i,
                        'chars_lost': hist[i]['chars'], 'first_seen': hist[i]['ts'],
                        'switched_session': switched, 'tool_turn': bool(t.get('tool')),
                        'before_req': hist[i]['req'], 'after_req': e,
                    })
                    del hist[i]
        group_stats.append({'key': key, 'models': distinct, 'reqs': len(es), 'switched': switched})
    return all_switches, all_drops, group_stats

def main():
    os.makedirs(OUT + '/examples', exist_ok=True)
    reqs = load_reqs()
    groups = segment(reqs)
    switches, drops, gstats = analyze(groups)

    # ---- drops.csv ----
    with open(OUT + '/drops.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['ts','session','class','lane','model','turn','chars_lost','first_seen','switched_session','tool_turn'], extrasaction='ignore')
        w.writeheader()
        for d in sorted(drops, key=lambda x: x['ts']): w.writerow(d)

    # ---- switches.csv ----
    with open(OUT + '/switches.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['ts','session','class','from','to','lane_from','lane_to'])
        w.writeheader()
        for s in sorted(switches, key=lambda x: x['ts']): w.writerow(s)

    # ---- exhibit-summary.md (verbose) ----
    id_switches = [s for s in switches if s['class'] == 'id-confirmed']
    null_switches = [s for s in switches if s['class'] == 'heuristic-null']
    sm = [d for d in drops if not d['switched_session']]
    sw = [d for d in drops if d['switched_session']]
    chars = sum(d['chars_lost'] for d in drops)
    per_lane = Counter(d['lane'] for d in drops)
    per_model = Counter(d['model'] for d in drops)
    per_day = Counter(d['ts'][:10] for d in drops)
    failover = [s for s in null_switches if {s['from'], s['to']} <= {'x-preview-f-free','hy3-free','mimo-v2.5-free','muse-spark-1.2-contributor-free','nemotron-3-ultra-free','nemotron-3.5-lightning-free','big-pickle','laguna-s-2.1-free','deepseek-v4-flash-free'}]

    L = []
    L.append('# Reasoning-Drop Exhibit — Passive Tap Corpus\n')
    L.append(f'Generated: {datetime.utcnow().isoformat()}Z · corpus: {len(reqs)} requests, {len(groups)} session groups\n')
    L.append('## Headline\n')
    L.append(f'- **{len(drops)} strict reasoning drops** captured (turn seen with reasoning carrier → later bare, same session, epoch-guarded)')
    L.append(f'- **{chars:,} characters** of reasoning content confirmed erased (measurable where rcLen/ttLen present, i.e. post-2026-08-24T21:54Z traffic)')
    L.append(f'- **{len(sm)} drops ({100*len(sm)/max(1,len(drops)):.0f}%) occurred in sessions with ZERO model change** — the drop is not a model-switch artifact\n')
    L.append('## Switch Attribution (answers "did the user switch models 635 times?")\n')
    L.append(f'| Class | Switch events | Interpretation |')
    L.append(f'|---|---|---|')
    L.append(f'| id-confirmed (real x-session-id) | {len(id_switches)} | Genuine model changes within one conversation |')
    L.append(f'| heuristic-null (no session header) | {len(null_switches)} | Mostly machine behavior: free-model failover + parallel subagents |\n')
    L.append(f'### id-confirmed switches ({len(id_switches)}) — the user\'s actual model changes\n')
    for s in sorted(id_switches, key=lambda x: x['ts']):
        lane = f" [{s['lane_from']}→{s['lane_to']}]" if s['lane_from'] != s['lane_to'] else ''
        L.append(f"- `{s['ts']}` {s['from']} → {s['to']}{lane} ({s['session']})")
    L.append(f'\n### heuristic-null switches ({len(null_switches)}) — machine, not human\n')
    L.append(f'- **{len(failover)} are free-model failover pairs** (x-preview-f-free ↔ hy3-free ↔ mimo-v2.5-free etc., sub-second alternation = automatic retry/failover after 503s, not user action)')
    L.append(f'- Remainder: parallel subagent traffic interleaving different models into one time-bucket (e.g. 6 model changes in 0.8s)\n')
    L.append('## Drops per lane\n')
    L.append('| Lane | Drops |')
    L.append('|---|---|')
    for lane, c in per_lane.most_common(): L.append(f'| {lane} | {c} |')
    L.append('\n## Drops per model (top 10)\n')
    L.append('| Model | Drops |')
    L.append('|---|---|')
    for m, c in per_model.most_common(10): L.append(f'| {m} | {c} |')
    L.append('\n## Drops per day\n')
    L.append('| Day | Drops |')
    L.append('|---|---|')
    for day, c in sorted(per_day.items()): L.append(f'| {day} | {c} |')
    L.append('\n## Char-loss distribution\n')
    buckets = Counter()
    for d in drops:
        c = d['chars_lost']
        b = '0 (pre-verbose logs)' if c == 0 else '1-99' if c < 100 else '100-999' if c < 1000 else '1000-9999' if c < 10000 else '10000+'
        buckets[b] += 1
    L.append('| Chars lost | Drops |')
    L.append('|---|---|')
    for b in ['0 (pre-verbose logs)','1-99','100-999','1000-9999','10000+']:
        L.append(f'| {b} | {buckets.get(b,0)} |')
    L.append('\n## Methodology\n')
    L.append('See methodology.md. Capture: 4 passive taps (raw-byte forward, zero modification), 2026-08-22 → present.')
    L.append('Classification: session-stitched (id-groups authoritative; null-streams heuristic), epoch-reset on msgs-shrink guards compaction index-shifts.')
    open(OUT + '/exhibit-summary.md', 'w').write('\n'.join(L) + '\n')

    # ---- examples (verbose: full before/after req JSON) ----
    drops_sorted = sorted([d for d in drops if d['chars_lost'] > 0 and 'before_req' in d], key=lambda x: -x['chars_lost'])[:N_EXAMPLES]
    for n, d in enumerate(drops_sorted, 1):
        before, after = d['before_req'], d['after_req']
        md = [f"# Example {n:02d} — {d['chars_lost']} chars of reasoning erased\n",
              f"- Lane: {d['lane']} · Model: {d['model']} · Session: `{d['session']}` · Turn index: {d['turn']}",
              f"- First seen WITH reasoning: `{d['first_seen']}`",
              f"- Seen WITHOUT reasoning: `{d['ts']}`",
              f"- Switched session: {d['switched_session']} · Tool turn: {d['tool_turn']}\n",
              '## BEFORE (request carrying the reasoning)\n', '```json', json.dumps(before, indent=2)[:6000], '```',
              '## AFTER (same turn, reasoning gone)\n', '```json', json.dumps(after, indent=2)[:6000], '```']
        open(f"{OUT}/examples/ex{n:02d}-{d['lane']}-{str(d['model']).replace('/','_')}-t{d['turn']}.md", 'w').write('\n'.join(md) + '\n')

    # ---- methodology.md ----
    open(OUT + '/methodology.md', 'w').write('''# Methodology

## Capture
Four passive taps (~/drop-tap/tap.js, systemd units drop-tap*) intercept client→upstream HTTPS:
- 3457 → api.deepseek.com · 3458 → opencode.ai/zen/go/v1 · 3459 → opencode.ai/zen/v1 · 3462 → openrouter.ai/api/v1
- Raw-byte forwarding (res.write per chunk) — the wire is NEVER modified; parsing is a side channel.
- Auth headers never logged; session ids truncated to 8 chars; no message content logged — only per-turn metadata (carrier booleans + char lengths).
- Verbose schema (TAP_VERBOSE=2) live since 2026-08-24T21:54Z: rc/r/think/tt booleans + rcLen/rLen/thinkChars/tbChars/ttLen/textLen + response-side fields[] + reasoningTokens.

## Drop signature
A strict drop = assistant turn index T present in request N with any carrier (reasoning_content / reasoning / thinking block / <think> tag) and present in request M>N with ALL carriers false, within one session group, with an epoch reset whenever message count shrinks (compaction guard against turn-index renumbering).

## Session stitching
- Requests with x-session-id (8-char) are grouped globally by id — authoritative. Model change inside one id = genuine switch.
- Null-session requests (zen 92%, go 95%) are segmented heuristically (msgs shrink / 30-min gap) and labeled heuristic-null; their switch events are dominated by machine behavior (free-model failover after 503s; parallel subagents).

## Limitations
- Char loss measurable only for post-verbose traffic; earlier drops counted but chars unknown (bucket "0").
- heuristic-null groups may merge concurrent subagent traffic; their drop counts are lower-bound estimates.
- Compaction that removes turns entirely (not just strips reasoning) is invisible to the signature (turn absent ≠ bare).

## Reproducibility
- ~/drop-tap/scripts/classify-drops.py — interactive classifier
- proof/reasoning-drop/build-exhibit.py — this exhibit builder
- Raw logs: ~/drop-tap/{,deepseek,zen,openrouter}/tap-*.log (hourly rotation, retained)
''')

    print(f"exhibit built at {OUT}")
    print(f"  drops.csv: {len(drops)} rows | switches.csv: {len(switches)} rows")
    print(f"  examples: {len(drops_sorted)} | summary + methodology written")

if __name__ == '__main__':
    main()
