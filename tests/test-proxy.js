'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// Real-core regression suite for proxy/core.js (v3.2.0).
//
// Unlike the earlier extracted-copy suite, this file imports the ACTUAL
// core.js module under test — so route(), fixedUpstreamRoute(),
// patchRequestBody(), extractReasoningFromJson(), createStreamParser(), and the
// BoundedSessionMap/LRUCache/stats all run against production code.
//
// Run:  node tests/test-proxy.js   (exits 0 on success, 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────

import {
  ROUTES,
  DEFAULT_ROUTE,
  route,
  fixedUpstreamRoute,
  cache,
  stats,
  getSessionCache,
  patchRequestBody,
  extractReasoningFromJson,
  createStreamParser,
  upstreamPathFor,
  applyProviderBodyInjections,
} from '../proxy/core.js'

// ── Test harness ────────────────────────────────────────────────────────────
let passed = 0
let failed = 0
const failures = []

function ok(cond, desc) {
  if (cond) { passed++; console.log('  PASS: ' + desc) }
  else { failed++; failures.push(desc); console.log('  FAIL: ' + desc) }
}

function eq(actual, expected, desc) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { passed++; console.log('  PASS: ' + desc) }
  else { failed++; failures.push(desc + ' -- expected ' + e + ', got ' + a); console.log('  FAIL: ' + desc + ' -- expected ' + e + ', got ' + a) }
}

function resetState() {
  cache.cache.clear()
  for (const k of Object.keys(stats)) stats[k] = 0
}

// ═════════════════════════════════════════════════════════════════════════
// route() — provider table + the v3.2 'strip' sentinel
// ═════════════════════════════════════════════════════════════════════════
console.log('\n=== route() tests ===\n')

eq(route('deepseek-v4-pro').reasoningKey, 'reasoning_content', 'R1. deepseek-v4-pro -> reasoning_content')
eq(route('deepseek-v4-flash').reasoningKey, 'reasoning_content', 'R2. deepseek-v4-flash -> reasoning_content')
eq(route('deepseek').base, 'https://api.deepseek.com', 'R3. deepseek -> api.deepseek.com')

// v3.2 sentinel: R1 aliases now 'strip', not null.
eq(route('deepseek-r1').reasoningKey, 'strip', 'R4. deepseek-r1 -> strip (sentinel)')
eq(route('deepseek-reasoner').reasoningKey, 'strip', 'R5. deepseek-reasoner -> strip (sentinel)')

eq(route('kimi-k2.6').reasoningKey, 'reasoning_content', 'R6. kimi-k2.6 -> reasoning_content')
eq(route('moonshot-v1').base, 'https://api.moonshot.ai/v1', 'R7. moonshot -> api.moonshot.ai/v1')
eq(route('glm-5.2').reasoningKey, 'reasoning_content', 'R8. glm-5.2 -> reasoning_content')
eq(route('minimax-m2.7').reasoningKey, 'reasoning_details', 'R9. minimax-m2.7 -> reasoning_details')

// v3.2 doc fix: mimo routes to xiaomimimo (not minimax.io).
eq(route('mimo-v2.5').base, 'https://api.xiaomimimo.com/v1', 'R10. mimo-v2.5 -> api.xiaomimimo.com/v1')
eq(route('mimo-v2.5').reasoningKey, 'reasoning_content', 'R11. mimo-v2.5 -> reasoning_content')

// Null routes: never fabricate, never strip.
eq(route('qwen3.6-plus').reasoningKey, null, 'R12. qwen3.6-plus -> null (preserve_thinking)')
eq(route('gpt-4').reasoningKey, null, 'R13. gpt-4 -> null')
eq(route('claude-3-7').reasoningKey, null, 'R14. claude -> null')
eq(route('gemini-2.5').reasoningKey, null, 'R15. gemini -> null')

// Unknown models default to null (never fabricate, never strip).
eq(route('unknown-model'), DEFAULT_ROUTE, 'R16. unknown -> DEFAULT_ROUTE')
eq(route('unknown-model').reasoningKey, null, 'R17. unknown -> reasoningKey null')
eq(route('').reasoningKey, null, 'R18. empty model -> DEFAULT_ROUTE (null)')

// opencode/ zen free-tier pins: zen/v1 upstream, reasoning_content carrier.
// Re-synced 2026-10-23 against GET /v1/models on the Zen relay (85 ids, 8 free).
for (const free of ['beam-free', 'deepseek-v4.1-flash-free', 'flint-40b-free', 'glm-5.3-flash-free', 'jev-1.13-free', 'mimo-v2.6-flash-free', 'nemotron-3.5-lightning-free', 'nemotron-3.5-super-vl-free']) {
  eq(route(`opencode/${free}`).base, 'https://opencode.ai/zen/v1', `R19. opencode/${free} -> zen/v1`)
  eq(route(`opencode/${free}`).reasoningKey, 'reasoning_content', `R19b. opencode/${free} -> reasoning_content`)
}

// Paid opencode/* models must NOT match the -free entries (no catch-all).
eq(route('opencode/gpt-5.5'), DEFAULT_ROUTE, 'R25. opencode/gpt-5.5 -> DEFAULT_ROUTE (paid, no -free entry)')
eq(route('opencode/gpt-5.5').reasoningKey, null, 'R25b. opencode/gpt-5.5 -> reasoningKey null')

// Bare zen free-tier ids (no `opencode/` prefix) — R26, re-synced 2026-10-23.
for (const bare of ['beam-free', 'deepseek-v4.1-flash-free', 'flint-40b-free', 'glm-5.3-flash-free', 'jev-1.13-free', 'mimo-v2.6-flash-free', 'nemotron-3.5-lightning-free', 'nemotron-3.5-super-vl-free', 'big-pickle']) {
  eq(route(bare).base, 'https://opencode.ai/zen/v1', `R26. bare ${bare} -> zen/v1`)
  eq(route(bare).reasoningKey, 'reasoning_content', `R26b. bare ${bare} -> reasoning_content`)
}

// R27: retired free ids must no longer be pinned to the Zen lane. They are
// absent from the live catalogue (or answer 400), so a bare request for
// one falls through to whatever generic prefix matches — never zen/v1 —
// and the opencode/ form falls through to DEFAULT_ROUTE (no catch-all).
for (const gone of ['x-preview-f-free', 'hy3-free', 'mimo-v2.5-free', 'muse-spark-1.2-contributor-free', 'muse-spark-1.3-contributor-free', 'step-5-preview-free', 'longcat-2.5-preview-free', 'space-bunny-free', 'deepseek-v4-flash-free', 'ling-3.0-flash-fin-free', 'laguna-s-2.1-free', 'ox-alpha-free', 'nemotron-3-ultra-free']) {
  eq(route(gone).base !== 'https://opencode.ai/zen/v1', true, `R27. retired ${gone} is not routed to zen`)
  eq(route(`opencode/${gone}`), DEFAULT_ROUTE, `R27b. retired opencode/${gone} -> DEFAULT_ROUTE`)
}

// ═════════════════════════════════════════════════════════════════════════
// upstreamPathFor() — F13 prefix dedup (OpenRouter /api/v1 vs /v1)
// ═════════════════════════════════════════════════════════════════════════
console.log('\n=== upstreamPathFor() tests ===\n')

eq(upstreamPathFor('/v1/chat/completions', '/api/v1'), '/api/v1/chat/completions', 'P1. /v1 path + /api/v1 base -> prefixed once')
eq(upstreamPathFor('/api/v1/chat/completions', '/api/v1'), '/api/v1/chat/completions', 'P2. client already sent official prefix -> unchanged')
eq(upstreamPathFor('/api/v1/chat/completions', '/'), '/api/v1/chat/completions', 'P3. root base -> unchanged')
eq(upstreamPathFor('/v1/chat/completions', '/v1'), '/v1/chat/completions', 'P4. /v1 base -> unchanged')
eq(upstreamPathFor('/v1/chat/completions', undefined), '/v1/chat/completions', 'P5. undefined base -> unchanged')
eq(upstreamPathFor('/api/v1/models', '/api/v1'), '/api/v1/models', 'P6. official-prefix subpath -> unchanged')

// ═════════════════════════════════════════════════════════════════════════
// fixedUpstreamRoute() — OpenCode Go (port 3458) dialect selection
// ═════════════════════════════════════════════════════════════════════════
console.log('\n=== fixedUpstreamRoute() tests ===\n')

eq(fixedUpstreamRoute('opencode-go/minimax-m3', '/v1/messages').reasoningKey, 'anthropic', 'G1. minimax /messages -> anthropic')
eq(fixedUpstreamRoute('opencode-go/qwen3-max', '/v1/messages').reasoningKey, 'anthropic', 'G2. qwen /messages -> anthropic')
eq(fixedUpstreamRoute('opencode-go/glm-5.3', '/v1/chat/completions').reasoningKey, 'reasoning', 'G3. glm chat -> reasoning')
eq(fixedUpstreamRoute('opencode-go/deepseek-v4-pro', '/v1/chat/completions').reasoningKey, 'reasoning', 'G4. deepseek chat -> reasoning')
eq(fixedUpstreamRoute('opencode-go/minimax-m3', '/v1/chat/completions').reasoningKey, 'reasoning', 'G5. minimax chat (not /messages) -> reasoning')
eq(fixedUpstreamRoute('opencode-go/glm-5.3', '').reasoningKey, 'reasoning', 'G6. glm no-url -> reasoning')

// v3.2 provider-split prefixes: opencode-go-messages / opencode-go-responses
eq(fixedUpstreamRoute('opencode-go-messages/minimax-m3', '/v1/messages').reasoningKey, 'anthropic', 'G7. messages/minimax /messages -> anthropic')
eq(fixedUpstreamRoute('opencode-go-messages/qwen3.8-max', '/v1/messages').reasoningKey, 'anthropic', 'G8. messages/qwen /messages -> anthropic')
eq(fixedUpstreamRoute('opencode-go/qwen3.8-max', '/v1/messages').reasoningKey, 'anthropic', 'G9. old-prefix qwen /messages -> anthropic (backward-compatible)')
eq(fixedUpstreamRoute('opencode-go-responses/grok-4.5', '/v1/responses').reasoningKey, 'reasoning', 'G10. responses/grok /responses -> reasoning')
eq(fixedUpstreamRoute('opencode-go-responses/grok-4.5', '/v1/messages').reasoningKey, 'reasoning', 'G11. responses/grok /messages -> reasoning (not minimax/qwen)')
eq(fixedUpstreamRoute('opencode-go/glm-5.3', '/v1/chat/completions').reasoningKey, 'reasoning', 'G12. glm chat -> reasoning (old prefix)')

// F11 per-model key: glm-5.2 rejects `reasoning` echo (gateway 400) but
// accepts `reasoning_content` — verified live 2026-08-19. Pin tests.
eq(fixedUpstreamRoute('opencode-go/glm-5.2', '/v1/chat/completions').reasoningKey, 'reasoning_content', 'G13. glm-5.2 chat -> reasoning_content (F11 per-model key)')
eq(fixedUpstreamRoute('opencode-go/glm-5.1', '/v1/chat/completions').reasoningKey, 'reasoning', 'G14. glm-5.1 chat -> reasoning (pin: other glm unchanged)')

// ═════════════════════════════════════════════════════════════════════════
// patchRequestBody() — replay, strip, anthropic, reasoning_details shapes
// ═════════════════════════════════════════════════════════════════════════
console.log('\n=== patchRequestBody() tests ===\n')

// P1: reasoning_content hit
resetState()
getSessionCache('s-p1').set(0, 'step 1...')
{
  const r = patchRequestBody(JSON.stringify({ messages: [{ role: 'assistant', content: 'hi', reasoning_content: '' }] }), 's-p1', 'reasoning_content')
  const parsed = JSON.parse(r.body)
  eq(parsed.messages[0].reasoning_content, 'step 1...', 'P1. reasoning_content injected from cache')
  ok(r.modified === true, 'P1b. modified true')
  ok(Array.isArray(r.report.turns), 'P1c. report.turns is array')
  eq(r.report.turns[0].fields, ['reasoning_content'], 'P1d. turn fields = [reasoning_content]')
  eq(r.report.turns[0].source, 'hit', 'P1e. source = hit')
}

// P2: reasoning_content miss -> empty string + miss report
resetState()
{
  const r = patchRequestBody(JSON.stringify({ messages: [{ role: 'assistant', content: 'hi' }] }), 's-p2', 'reasoning_content')
  const parsed = JSON.parse(r.body)
  eq(parsed.messages[0].reasoning_content, '', 'P2. reasoning_content miss -> ""')
  eq(r.report.turns[0].source, 'miss', 'P2b. source = miss')
  eq(r.report.turns[0].fields, ['reasoning_content'], 'P2c. fields = [reasoning_content]')
}

// P3: reasoning (OpenCode Go) replay
resetState()
getSessionCache('s-p3').set(0, 'think about it')
{
  const r = patchRequestBody(JSON.stringify({ messages: [{ role: 'assistant', content: 'ok', reasoning: '' }] }), 's-p3', 'reasoning')
  const parsed = JSON.parse(r.body)
  eq(parsed.messages[0].reasoning, 'think about it', 'P3. reasoning injected (go mode)')
}

// P4: reasoning_details hit -> F6 minimal shape (default)
resetState()
getSessionCache('s-p4').set(0, 'mini thinking')
{
  const r = patchRequestBody(JSON.stringify({ messages: [{ role: 'assistant', content: 'ok' }] }), 's-p4', 'reasoning_details')
  const parsed = JSON.parse(r.body)
  eq(parsed.messages[0].reasoning_details, [{ type: 'reasoning.text', text: 'mini thinking' }], 'P4. reasoning_details -> minimal F6 shape')
}

// P5: reasoning_details already present -> untouched (lazy patch)
resetState()
{
  const body = JSON.stringify({ messages: [{ role: 'assistant', content: 'ok', reasoning_details: [{ type: 'reasoning.text', text: 'x' }] }] })
  const r = patchRequestBody(body, 's-p5', 'reasoning_details')
  eq(r.body, body, 'P5. present reasoning_details -> body forwarded untouched')
  ok(r.modified === false, 'P5b. modified false')
}

// P6: anthropic wire — inject thinking block into content[]
resetState()
getSessionCache('s-p6').set(0, 'anthropic reasoning')
{
  const r = patchRequestBody(JSON.stringify({ messages: [{ role: 'assistant', content: 'hi' }] }), 's-p6', 'anthropic')
  const parsed = JSON.parse(r.body)
  ok(Array.isArray(parsed.messages[0].content), 'P6. anthropic content becomes array')
  eq(parsed.messages[0].content[0], { type: 'thinking', thinking: 'anthropic reasoning' }, 'P6b. thinking block prepended')
  eq(r.report.turns[0].fields, ['content'], 'P6c. fields = [content]')
}

// P7: anthropic wire — string content converted to thinking+text blocks
resetState()
getSessionCache('s-p7').set(0, 'anthropic reasoning')
{
  const r = patchRequestBody(JSON.stringify({ messages: [{ role: 'assistant', content: 'visible answer' }] }), 's-p7', 'anthropic')
  const parsed = JSON.parse(r.body)
  eq(parsed.messages[0].content, [{ type: 'thinking', thinking: 'anthropic reasoning' }, { type: 'text', text: 'visible answer' }], 'P7. string content -> [thinking, text]')
}

// P8: strip sentinel — reasoning fields removed from R1 body
resetState()
{
  const r = patchRequestBody(JSON.stringify({
    messages: [
      { role: 'assistant', content: 'hi', reasoning_content: 'x', reasoning: 'y', reasoning_details: [{ text: 'z' }] },
    ],
  }), 's-p8', 'strip')
  const parsed = JSON.parse(r.body)
  ok(!('reasoning_content' in parsed.messages[0]), 'P8. reasoning_content stripped')
  ok(!('reasoning' in parsed.messages[0]), 'P8b. reasoning stripped')
  ok(!('reasoning_details' in parsed.messages[0]), 'P8c. reasoning_details stripped')
  eq(r.report.turns[0].source, 'strip', 'P8d. source = strip')
  ok(Array.isArray(r.report.turns[0].fields), 'P8e. fields is array')
  ok(r.report.turns[0].fields.includes('reasoning_content'), 'P8f. fields includes reasoning_content')
  ok(r.modified === true, 'P8g. modified true')
}

// P9: strip sentinel — thinking blocks removed from content[]
resetState()
{
  const r = patchRequestBody(JSON.stringify({
    messages: [
      { role: 'assistant', content: [{ type: 'thinking', thinking: 't' }, { type: 'text', text: 'a' }] },
    ],
  }), 's-p9', 'strip')
  const parsed = JSON.parse(r.body)
  eq(parsed.messages[0].content, [{ type: 'text', text: 'a' }], 'P9. thinking block removed, text kept')
  ok(r.report.turns[0].fields.includes('content'), 'P9b. fields includes content')
}

// P10: strip with nothing to strip -> not modified, no turns
resetState()
{
  const body = JSON.stringify({ messages: [{ role: 'assistant', content: 'clean' }] })
  const r = patchRequestBody(body, 's-p10', 'strip')
  eq(r.body, body, 'P10. clean body -> forwarded untouched')
  ok(r.modified === false, 'P10b. modified false')
  eq(r.report.turns.length, 0, 'P10c. no turns recorded')
}

// P11: user messages untouched by patching
resetState()
getSessionCache('s-p11').set(0, 'step 1...')
{
  const r = patchRequestBody(JSON.stringify({
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi', reasoning_content: '' },
    ],
  }), 's-p11', 'reasoning_content')
  const parsed = JSON.parse(r.body)
  eq(parsed.messages[0].content, 'hello', 'P11. user content unchanged')
  ok(!('reasoning_content' in parsed.messages[0]), 'P11b. user has no reasoning_content')
  eq(parsed.messages[1].reasoning_content, 'step 1...', 'P11c. assistant patched')
}

// P12: multiple assistant turns each get their own cached reasoning
resetState()
getSessionCache('s-p12').set(0, 'first reasoning')
getSessionCache('s-p12').set(1, 'second reasoning')
{
  const r = patchRequestBody(JSON.stringify({
    messages: [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1', reasoning_content: '' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2', reasoning_content: '' },
    ],
  }), 's-p12', 'reasoning_content')
  const parsed = JSON.parse(r.body)
  eq(parsed.messages[1].reasoning_content, 'first reasoning', 'P12. turn 0 -> first reasoning')
  eq(parsed.messages[3].reasoning_content, 'second reasoning', 'P12b. turn 1 -> second reasoning')
}

// P13: null reasoningKey -> untouched (never fabricate)
resetState()
{
  const body = JSON.stringify({ messages: [{ role: 'assistant', content: 'hi' }] })
  const r = patchRequestBody(body, 's-p13', null)
  eq(r.body, body, 'P13. null reasoningKey -> untouched')
  eq(r.assistantCount, 0, 'P13b. assistantCount 0')
}

// P14: 'unknown' session id -> untouched
resetState()
{
  const body = JSON.stringify({ messages: [{ role: 'assistant', content: 'hi' }] })
  const r = patchRequestBody(body, 'unknown', 'reasoning_content')
  eq(r.body, body, 'P14. unknown session -> untouched')
}

// P15: report contract — assistantCount counts assistant turns
resetState()
{
  const r = patchRequestBody(JSON.stringify({
    messages: [
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a1', reasoning_content: '' },
      { role: 'assistant', content: 'a2', reasoning_content: '' },
    ],
  }), 's-p15', 'reasoning_content')
  eq(r.assistantCount, 2, 'P15. assistantCount = 2')
  ok(r.report.assistantTurns === 2, 'P15b. report.assistantTurns = 2')
}

// ═════════════════════════════════════════════════════════════════════════
// extractReasoningFromJson() — buffered JSON reasoning extraction
// ═════════════════════════════════════════════════════════════════════════
console.log('\n=== extractReasoningFromJson() tests ===\n')

eq(extractReasoningFromJson(JSON.stringify({ content: [{ type: 'thinking', thinking: 'step a' }, { type: 'text', text: 'x' }] })), 'step a', 'E1. anthropic thinking extracted')

// F7 guard: redacted_thinking must NOT be replayed.
eq(extractReasoningFromJson(JSON.stringify({ content: [{ type: 'redacted_thinking', thinking: 'secret' }] })), null, 'E2. redacted_thinking NOT extracted (F7 guard)')

eq(extractReasoningFromJson(JSON.stringify({ choices: [{ message: { reasoning_content: 'rc text' } }] })), 'rc text', 'E3. reasoning_content extracted')
eq(extractReasoningFromJson(JSON.stringify({ choices: [{ message: { reasoning: 'r text' } }] })), 'r text', 'E4. reasoning extracted')
eq(extractReasoningFromJson(JSON.stringify({ choices: [{ message: { reasoning_details: [{ type: 'reasoning.text', text: 'rd text' }] } }] })), 'rd text', 'E5. reasoning_details .text extracted')
eq(extractReasoningFromJson('not json'), null, 'E6. non-JSON -> null')
eq(extractReasoningFromJson(JSON.stringify({ content: [{ type: 'thinking', thinking: '' }] })), null, 'E7. empty thinking -> null')

// ═════════════════════════════════════════════════════════════════════════
// createStreamParser() — SSE reasoning accumulation
// ═════════════════════════════════════════════════════════════════════════
console.log('\n=== createStreamParser() tests ===\n')

// S1: reasoning_content accumulation + [DONE]
{
  const res = []
  const p = createStreamParser('s-s1', 0, (i, r) => res.push({ i, r }))
  p.feed('data: {"choices":[{"delta":{"reasoning_content":"step "}}]}\n\n')
  p.feed('data: {"choices":[{"delta":{"reasoning_content":"1"}}]}\n\n')
  p.feed('data: [DONE]\n\n')
  eq(res.length, 1, 'S1. onComplete called once')
  if (res.length) eq(res[0].r, 'step 1', 'S1b. accumulated "step 1"')
  if (res.length) eq(res[0].i, 0, 'S1c. index 0')
}

// S2: reasoning (go) accumulation
{
  const res = []
  const p = createStreamParser('s-s2', 0, (i, r) => res.push({ i, r }))
  p.feed('data: {"choices":[{"delta":{"reasoning":"think "}}]}\n\n')
  p.feed('data: {"choices":[{"delta":{"reasoning":"hard"}}]}\n\n')
  p.feed('data: [DONE]\n\n')
  eq(res.length, 1, 'S2. onComplete called once')
  if (res.length) eq(res[0].r, 'think hard', 'S2b. accumulated "think hard"')
}

// S3: finish_reason triggers flush
{
  const res = []
  const p = createStreamParser('s-s3', 0, (i, r) => res.push({ i, r }))
  p.feed('data: {"choices":[{"delta":{"reasoning_content":"step 1"}}]}\n\n')
  p.feed('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')
  eq(res.length, 1, 'S3. onComplete on finish_reason')
  if (res.length) eq(res[0].r, 'step 1', 'S3b. reasoning is "step 1"')
}

// S4: reasoning_details deltas accumulate (MiniMax split stream)
{
  const res = []
  const p = createStreamParser('s-s4', 0, (i, r) => res.push({ i, r }))
  p.feed('data: {"choices":[{"delta":{"reasoning_details":[{"type":"thinking","text":"a"},{"type":"thinking","text":"b"}]}}]}\n\n')
  p.feed('data: [DONE]\n\n')
  eq(res.length, 1, 'S4. onComplete called once')
  if (res.length) eq(res[0].r, 'ab', 'S4b. reasoning_details concatenated "ab"')
}

// S5: F1 StringDecoder — multibyte char split across two feed() calls
{
  const res = []
  const p = createStreamParser('s-s5', 0, (i, r) => res.push({ i, r }))
  const line = 'data: {"choices":[{"delta":{"reasoning_content":"中"}}]}\n\n'
  const buf = Buffer.from(line, 'utf8')
  const idx = buf.indexOf(Buffer.from([0xe4, 0xb8, 0xad])) // bytes of 中
  ok(idx >= 0, 'S5. multibyte char located in buffer')
  // Feed [..E4 B8] then [AD ..] — the char straddles the chunk boundary.
  p.feed(buf.subarray(0, idx + 2))
  p.feed(buf.subarray(idx + 2))
  p.feed('data: [DONE]\n\n')
  eq(res.length, 1, 'S5b. onComplete called once')
  if (res.length) eq(res[0].r, '中', 'S5c. intact multibyte char preserved (StringDecoder)')
}

// S6: anthropic thinking_delta accumulation + message_stop
{
  const res = []
  const p = createStreamParser('s-s6', 0, (i, r) => res.push({ i, r }))
  p.feed('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"thinking":"deep "}}\n\n')
  p.feed('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"thinking":"thought"}}\n\n')
  p.feed('event: message_stop\ndata: {"type":"message_stop"}\n\n')
  eq(res.length, 1, 'S6. onComplete on message_stop')
  if (res.length) eq(res[0].r, 'deep thought', 'S6b. thinking deltas accumulated')
}

// ═════════════════════════════════════════════════════════════════════════
// BoundedSessionMap — F4 skip-not-truncate (via getSessionCache)
// ═════════════════════════════════════════════════════════════════════════
console.log('\n=== BoundedSessionMap (F4 skip-not-truncate) tests ===\n')

resetState()
{
  const sm = getSessionCache('s-b1')
  const okSet = sm.set(0, 'short reasoning')
  ok(okSet === true, 'B1. set() returns true on store')
  eq(sm.get(0), 'short reasoning', 'B1b. value stored intact')

  const oversized = 'x'.repeat(200001) // > MAX_REASONING_CHARS (200000)
  const skipped = sm.set(1, oversized)
  ok(skipped === false, 'B2. set() returns false on oversized value')
  eq(sm.get(1), undefined, 'B2b. oversized value NOT stored (skip, not truncate)')
}

// ═════════════════════════════════════════════════════════════════════════
// F12: applyProviderBodyInjections — Z.ai clear_thinking:false
// ═════════════════════════════════════════════════════════════════════════
console.log('\n=== F12 provider body injection (Z.ai clear_thinking) tests ===\n')

// F12-1: glm-5.2 on BigModel direct (port 3457 universal) — injects.
{
  const bj = { model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('glm-5.2', bj, { base: 'https://open.bigmodel.cn/api/paas/v4', reasoningKey: 'reasoning_content' })
  ok(r.modified === true, 'F12-1. glm-5.2 on bigmodel.modified = true')
  eq(bj.thinking && bj.thinking.clear_thinking, false, 'F12-1b. thinking.clear_thinking = false')
  eq(r.injections.length, 1, 'F12-1c. one injection recorded')
  eq(r.injections[0].tag, 'F12', 'F12-1d. injection tag is F12')
}

// F12-2: glm-5.2 on OpenCode Go gateway (port 3458) — injects.
{
  const bj = { model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('glm-5.2', bj, { base: 'https://opencode.ai/zen/go/v1', reasoningKey: 'reasoning_content' })
  ok(r.modified === true, 'F12-2. glm-5.2 on Go gateway.modified = true')
  eq(bj.thinking && bj.thinking.clear_thinking, false, 'F12-2b. thinking.clear_thinking = false on Go')
}

// F12-3: glm-5.2 on OpenRouter (port 3462) — injects.
{
  const bj = { model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('glm-5.2', bj, { base: 'https://openrouter.ai/api/v1', reasoningKey: 'reasoning_content' })
  ok(r.modified === true, 'F12-3. glm-5.2 on OpenRouter.modified = true')
  eq(bj.thinking && bj.thinking.clear_thinking, false, 'F12-3b. thinking.clear_thinking = false on OpenRouter')
}

// F12-4: zhipu prefix also triggers F12.
{
  const bj = { model: 'zhipu-glm-5', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('zhipu-glm-5', bj, { base: 'https://open.bigmodel.cn/api/paas/v4', reasoningKey: 'reasoning_content' })
  ok(r.modified === true, 'F12-4. zhipu prefix on bigmodel.modified = true')
  eq(bj.thinking && bj.thinking.clear_thinking, false, 'F12-4b. zhipu also opts in to clear_thinking:false')
}

// F12-5: deepseek on a Z.ai-reachable host does NOT trigger F12.
{
  const bj = { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('deepseek-v4-pro', bj, { base: 'https://open.bigmodel.cn/api/paas/v4', reasoningKey: 'reasoning_content' })
  ok(r.modified === false, 'F12-5. deepseek on bigmodel.modified = false (model prefix mismatch)')
  ok(!bj.thinking, 'F12-5b. no thinking field injected for deepseek')
  eq(r.injections.length, 0, 'F12-5c. zero injections')
}

// F12-6: glm-5.2 on a non-Z.ai host (api.deepseek.com) does NOT trigger F12.
{
  const bj = { model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('glm-5.2', bj, { base: 'https://api.deepseek.com', reasoningKey: 'reasoning_content' })
  ok(r.modified === false, 'F12-6. glm-5.2 on deepseek host.modified = false (host allowlist blocks)')
  ok(!bj.thinking, 'F12-6b. no thinking field injected for non-Z.ai host')
}

// F12-7: client explicitly disabled thinking (thinking: false) — F12 skips.
{
  const bj = { model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }], thinking: false }
  const r = applyProviderBodyInjections('glm-5.2', bj, { base: 'https://open.bigmodel.cn/api/paas/v4', reasoningKey: 'reasoning_content' })
  ok(r.modified === false, 'F12-7. client-set thinking:false.modified = false (F12 skipped)')
  eq(bj.thinking, false, 'F12-7b. thinking:false preserved, not overwritten')
  eq(r.injections.length, 0, 'F12-7c. zero injections when client disabled thinking')
}

// F12-8: client supplied thinking.type — F12 merges idempotently.
{
  const bj = { model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }], thinking: { type: 'enabled' } }
  const r = applyProviderBodyInjections('glm-5.2', bj, { base: 'https://open.bigmodel.cn/api/paas/v4', reasoningKey: 'reasoning_content' })
  ok(r.modified === true, 'F12-8. merge with client thinking.modified = true')
  eq(bj.thinking.type, 'enabled', 'F12-8b. client thinking.type preserved')
  eq(bj.thinking.clear_thinking, false, 'F12-8c. F12 added clear_thinking:false alongside')
}

// F12-9: body with no model name — F12 skipped (defensive).
{
  const bj = { messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('', bj, { base: 'https://open.bigmodel.cn/api/paas/v4', reasoningKey: 'reasoning_content' })
  ok(r.modified === false, 'F12-9. empty model name.modified = false')
  ok(!bj.thinking, 'F12-9b. no thinking field injected for empty model name')
}

// F12-10: null body — F12 returns the same shape without crashing.
{
  const r = applyProviderBodyInjections('glm-5.2', null, { base: 'https://open.bigmodel.cn/api/paas/v4', reasoningKey: 'reasoning_content' })
  ok(r.modified === false, 'F12-10. null body.modified = false')
  eq(r.injections.length, 0, 'F12-10b. zero injections on null body')
}

// F12-11: routeTarget.base is empty (defensive) — F12 skipped.
{
  const bj = { model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('glm-5.2', bj, { base: '', reasoningKey: 'reasoning_content' })
  ok(r.modified === false, 'F12-11. empty base.modified = false (host allowlist misses)')
  ok(!bj.thinking, 'F12-11b. no thinking field injected for empty base')
}

// F12-12: routeTarget is null — F12 skipped.
{
  const bj = { model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('glm-5.2', bj, null)
  ok(r.modified === false, 'F12-12. null routeTarget.modified = false')
}

// F12-13: api.z.ai (international Z.ai direct) — F12 injects (forward-compat).
{
  const bj = { model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('glm-5.2', bj, { base: 'https://api.z.ai/api/paas/v4', reasoningKey: 'reasoning_content' })
  ok(r.modified === true, 'F12-13. glm-5.2 on api.z.ai.modified = true (forward-compat)')
  eq(bj.thinking && bj.thinking.clear_thinking, false, 'F12-13b. api.z.ai also gets clear_thinking:false')
}

// F12-14: opencode.ai but NOT /zen/go path — F12 skipped (different gateway).
{
  const bj = { model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('glm-5.2', bj, { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' })
  ok(r.modified === false, 'F12-14. glm-5.2 on zen/v1 (not zen/go).modified = false (path allowlist blocks)')
  ok(!bj.thinking, 'F12-14b. no thinking field injected on zen/v1')
}

// F12-15: OpenRouter-style slug z-ai/glm-5.2 — F12 fires (the user's actual config).
{
  const bj = { model: 'z-ai/glm-5.2', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('z-ai/glm-5.2', bj, { base: 'https://openrouter.ai/api/v1', reasoningKey: 'reasoning_content' })
  ok(r.modified === true, 'F12-15. z-ai/glm-5.2 on OpenRouter.modified = true (gateway-prefixed slug)')
  eq(bj.thinking && bj.thinking.clear_thinking, false, 'F12-15b. thinking.clear_thinking = false injected via OpenRouter-style slug')
}

// F12-16: zhipu/glm-4.5 slug — F12 fires.
{
  const bj = { model: 'zhipu/glm-4.5', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('zhipu/glm-4.5', bj, { base: 'https://openrouter.ai/api/v1', reasoningKey: 'reasoning_content' })
  ok(r.modified === true, 'F12-16. zhipu/glm-4.5 on OpenRouter.modified = true')
  eq(bj.thinking && bj.thinking.clear_thinking, false, 'F12-16b. thinking.clear_thinking = false injected')
}

// F12-17: opencode-go/glm-5.2 slug on Go gateway — F12 fires.
{
  const bj = { model: 'opencode-go/glm-5.2', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('opencode-go/glm-5.2', bj, { base: 'https://opencode.ai/zen/go/v1', reasoningKey: 'reasoning_content' })
  ok(r.modified === true, 'F12-17. opencode-go/glm-5.2 on Go.modified = true')
  eq(bj.thinking && bj.thinking.clear_thinking, false, 'F12-17b. thinking.clear_thinking = false injected on Go')
}

// F12-17c: the deployed Go upstream since 2026-10-23 is /inference/go/openai/v1 —
// the allowlist must match that path too, or GLM on the Go lane silently loses
// Preserved Thinking while the units look correct.
{
  const bj = { model: 'opencode-go/glm-5.3', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('opencode-go/glm-5.3', bj, { base: 'https://opencode.ai/inference/go/openai/v1', reasoningKey: 'reasoning_content' })
  ok(r.modified === true, 'F12-17c. glm on inference/go/openai/v1 -> injection fires')
  eq(bj.thinking && bj.thinking.clear_thinking, false, 'F12-17d. clear_thinking = false on the deployed Go upstream')
}

// F12-18: anthropic/glm-* or thudm/glm-* (any other gateway-prefixed glm) — F12 fires on Z.ai host.
{
  const bj = { model: 'anthropic/glm-5', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('anthropic/glm-5', bj, { base: 'https://openrouter.ai/api/v1', reasoningKey: 'reasoning_content' })
  ok(r.modified === true, 'F12-18. anthropic/glm-5 on OpenRouter.modified = true (any /glm path-segment matches)')
}

// F12-19: non-GLM model with "glm" in the middle — F12 should NOT fire.
// (Defensive: includes() with /glm is too loose if the model name has /glm
// in a non-name segment. Verify the false-positive case is handled.)
{
  const bj = { model: 'some-glm-translator', messages: [{ role: 'user', content: 'hi' }] }
  const r = applyProviderBodyInjections('some-glm-translator', bj, { base: 'https://openrouter.ai/api/v1', reasoningKey: 'reasoning_content' })
  // 'some-glm-translator' starts with 'some-', not 'glm' or 'zhipu', and has no '/glm' segment.
  // So F12 should NOT fire.
  ok(r.modified === false, 'F12-19. some-glm-translator.modified = false (no /glm segment, no glm prefix)')
}

// ═════════════════════════════════════════════════════════════════════════
// F19: InclusionAI Ling 3.0 Flash — port 3457 ROUTES entries
// ═════════════════════════════════════════════════════════════════════════
console.log('\n=== F19 InclusionAI Ling 3.0 Flash route tests ===\n')

// F19-1: inclusionai/ling-3.0-flash (paid) -> openrouter, reasoning_content
{
  const r = route('inclusionai/ling-3.0-flash')
  eq(r.base, 'https://openrouter.ai/api/v1', 'F19-1. paid -> openrouter base')
  eq(r.reasoningKey, 'reasoning_content', 'F19-1b. paid -> reasoning_content key')
}

// F19-2: inclusionai/ling-3.0-flash:free (free tier) -> openrouter, reasoning_content
{
  const r = route('inclusionai/ling-3.0-flash:free')
  eq(r.base, 'https://openrouter.ai/api/v1', 'F19-2. :free -> openrouter base')
  eq(r.reasoningKey, 'reasoning_content', 'F19-2b. :free -> reasoning_content key')
}

// F19-3: the Zen `-fin-free` form is retired (2026-10-23) — it must not route to zen.
{
  const r = route('opencode/ling-3.0-flash-fin-free')
  eq(r.base !== 'https://opencode.ai/zen/v1', true, 'F19-3. retired opencode/-fin-free is not zen')
}

// F19-4: same for the bare retired id.
{
  const r = route('ling-3.0-flash-fin-free')
  eq(r.base !== 'https://opencode.ai/zen/v1', true, 'F19-4. retired bare -fin-free is not zen')
}

// F19-5: a hypothetical paid inclusionai variant that does not start with
// 'inclusionai/ling-3.0-flash' would NOT match the new F19 route — defensive.
{
  // generic 'inclusionai' prefix exists too (added for future variants)
  const r = route('inclusionai/ling-2.6-flash')
  eq(r.base, 'https://openrouter.ai/api/v1', 'F19-5. future inclusionai/* variant -> openrouter (catch-all prefix)')
  eq(r.reasoningKey, 'reasoning_content', 'F19-5b. future variant -> reasoning_content key')
}

// F19-6: distinguish from a non-inclusionai model that happens to contain 'ling'
// (e.g. a custom 'blings-v2'). Defensive: only the inclusionai/ and
// opencode/ling-3.0-flash-fin-free prefixes match.
{
  // 'something/blings-v2' does NOT start with 'inclusionai' and does not match
  // any zen free-tier entry. Falls through to DEFAULT_ROUTE (DeepSeek, null).
  const r = route('something/blings-v2')
  eq(r, DEFAULT_ROUTE, 'F19-6. non-inclusionai "blings-v2" -> DEFAULT_ROUTE (no false positive)')
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(50))
const total = passed + failed
console.log(`Tests: ${total} | Passed: ${passed} | Failed: ${failed}`)
if (failures.length > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log('  - ' + f))
}
console.log()

process.exit(failed > 0 ? 1 : 0)
