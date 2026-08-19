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
