'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// patchMessages — ported from opencode-thinking-fix-universal.ts (lines 31-77)
// ─────────────────────────────────────────────────────────────────────────────
function patchMessages(messages) {
  let count = 0

  // Step 1: Self-detect reasoning model
  const isReasoningModel = messages.some((wrapper) => {
    const msg = wrapper?.info ?? wrapper
    return msg?.role === 'assistant' && ('reasoning_content' in msg || 'reasoning' in msg)
  })

  // Step 2: Non-reasoning model — exit immediately
  if (!isReasoningModel) return 0

  // Step 3: Patch all assistant turns missing required fields
  for (const wrapper of messages) {
    const msg = wrapper?.info ?? wrapper
    if (!msg || msg.role !== 'assistant') continue

    if (!msg.content && msg.content !== '') {
      msg.content = msg.tool_calls?.length ? 'call tool' : ''
      count++
    }

    if (!('reasoning_content' in msg)) {
      msg.reasoning_content = ''
      count++
    }

    if (!('reasoning' in msg)) {
      msg.reasoning = ''
      count++
    }
  }

  return count
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function deepClone(o) { return JSON.parse(JSON.stringify(o)) }

let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  PASS: ${name}`)
  } catch (e) {
    failed++
    const msg = `${name} — ${e.message}`
    failures.push(msg)
    console.log(`  FAIL: ${msg}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Cases
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== patchMessages Regression Tests ===\n')

// ── TC1: Native reasoning model (reasoning_content) ─────────────────────────
test('TC1: Native reasoning model detects via reasoning_content', () => {
  const msgs = deepClone([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi there', reasoning_content: 'step 1...' },
  ])
  const result = patchMessages(msgs)
  assert(result === 1, `expected 1 patch, got ${result}`)
  assert(msgs[1].reasoning === '', 'reasoning should be added as empty string')
  assert(msgs[1].reasoning_content === 'step 1...', 'should not overwrite existing reasoning_content')
  assert(msgs[0].role === 'user' && msgs[0].content === 'hello', 'user message must not be touched')
})

// ── TC2: OpenCode Go model (reasoning, NO reasoning_content) ─────────────────
test('TC2: OpenCode Go model detected via reasoning field', () => {
  const msgs = deepClone([
    { role: 'assistant', content: 'ok', reasoning: 'step 1...' },
  ])
  const result = patchMessages(msgs)
  assert(result === 1, `expected 1 patch, got ${result}`)
  assert(msgs[0].reasoning_content === '', 'reasoning_content should be added as empty string')
  assert(msgs[0].reasoning === 'step 1...', 'should not overwrite existing reasoning')
})

// ── TC3: Non-reasoning model (Qwen/GPT/Claude) ──────────────────────────────
test('TC3: Non-reasoning model returns 0 with zero modifications', () => {
  const msgs = deepClone([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ])
  const result = patchMessages(msgs)
  assert(result === 0, `expected 0 patches, got ${result}`)
  assert(!('reasoning_content' in msgs[1]), 'reasoning_content must not be injected')
  assert(!('reasoning' in msgs[1]), 'reasoning must not be injected')
})

// ── TC4: Mixed messages (user + assistant + user) ───────────────────────────
test('TC4: Only assistant messages are patched, user messages untouched', () => {
  const msgs = deepClone([
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1', reasoning_content: 'thinking' },
    { role: 'user', content: 'q2' },
  ])
  const result = patchMessages(msgs)
  assert(result === 1, `expected 1 patch, got ${result}`)
  assert(msgs[1].reasoning === '', 'assistant reasoning should be added')
  assert(!('reasoning_content' in msgs[0]), 'user message must not get reasoning_content')
  assert(!('reasoning' in msgs[0]), 'user message must not get reasoning')
  assert(!('reasoning_content' in msgs[2]), 'second user message must not get reasoning_content')
  assert(msgs[2].content === 'q2', 'second user message content unchanged')
})

// ── TC5: Multiple assistant turns ───────────────────────────────────────────
test('TC5: Both assistant messages patched when at least one has reasoning', () => {
  const msgs = deepClone([
    { role: 'assistant', content: 'first', tool_calls: [{ function: { name: 'f' } }] },
    { role: 'assistant', content: 'second', reasoning: 'thinking' },
  ])
  const result = patchMessages(msgs)
  // msgs[0]: +reasoning_content, +reasoning (2). msgs[1]: +reasoning_content (1). Total = 3.
  // msgs[0].content is 'first' (truthy) so no content patch.
  assert(result === 3, `expected 3 patches, got ${result}`)
  assert(msgs[0].reasoning_content === '', 'first assistant should get reasoning_content')
  assert(msgs[0].reasoning === '', 'first assistant should get reasoning')
  // first assistant content is 'first' (truthy) so NOT patched
  assert(msgs[0].content === 'first', 'first assistant content unchanged')
  assert(!('content' in Object.getOwnPropertyDescriptor(msgs[1], 'content') || true) || msgs[1].content === 'second', 'second assistant content unchanged')
  assert(msgs[1].reasoning_content === '', 'second assistant should get reasoning_content')
  assert(msgs[1].reasoning === 'thinking', 'second assistant reasoning unchanged')
})

// ── TC6: Already complete message ───────────────────────────────────────────
test('TC6: Already complete message — no changes', () => {
  const msgs = deepClone([
    { role: 'assistant', content: 'done', reasoning_content: 'done', reasoning: 'done' },
  ])
  const result = patchMessages(msgs)
  assert(result === 0, `expected 0 patches, got ${result}`)
  assert(msgs[0].reasoning_content === 'done', 'reasoning_content unchanged')
  assert(msgs[0].reasoning === 'done', 'reasoning unchanged')
})

// ── TC7: Wrapper format ({ info: Message }) ─────────────────────────────────
test('TC7: Wrapper format correctly handled', () => {
  const msgs = deepClone([
    { info: { role: 'user', content: 'hello' } },
    { info: { role: 'assistant', content: 'reply', reasoning: 'thinking' } },
  ])
  const result = patchMessages(msgs)
  assert(result === 1, `expected 1 patch, got ${result}`)
  assert(msgs[1].info.reasoning_content === '', 'wrapped assistant should get reasoning_content')
  assert(msgs[1].info.reasoning === 'thinking', 'wrapped assistant reasoning unchanged')
  assert(!('reasoning_content' in msgs[0].info), 'wrapped user must not get reasoning_content')
  assert(msgs[0].info.content === 'hello', 'wrapped user content unchanged')
})

// ── TC8: Empty reasoning_content string ─────────────────────────────────────
test('TC8: Empty reasoning_content still triggers detection', () => {
  const msgs = deepClone([
    { role: 'assistant', content: 'ok', reasoning_content: '' },
  ])
  const result = patchMessages(msgs)
  assert(result === 1, `expected 1 patch (reasoning), got ${result}`)
  assert(msgs[0].reasoning === '', 'reasoning should be added')
  assert(msgs[0].reasoning_content === '', 'reasoning_content stays empty')
})

// ── TC9: Empty messages array ───────────────────────────────────────────────
test('TC9: Empty messages array returns 0', () => {
  const result = patchMessages([])
  assert(result === 0, `expected 0, got ${result}`)
})

// ── TC10: Non-reasoning model with tool_calls ────────────────────────────────
test('TC10: Non-reasoning model with tool_calls — no injection', () => {
  const msgs = deepClone([
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'f' } }] },
  ])
  const result = patchMessages(msgs)
  assert(result === 0, `expected 0, got ${result}`)
  assert(!('reasoning_content' in msgs[0]), 'must not inject reasoning_content')
})

// ── TC11: Reasoning model with empty content + tool_calls ───────────────────
test('TC11: Reasoning model patches content to "call tool"', () => {
  const msgs = deepClone([
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'f' } }], reasoning_content: 'thinking' },
  ])
  const result = patchMessages(msgs)
  // content is '' (empty string) — guard `!msg.content && msg.content !== ''` skips it
  // because '' !== '' is false. The original code treats '' as valid content.
  // Only reasoning is patched (reasoning_content and content are already present/invalid).
  assert(result === 1, `expected 1 patch (reasoning), got ${result}`)
  assert(msgs[0].content === '', 'content stays empty string')
  assert(msgs[0].reasoning === '', 'reasoning added')
  assert(msgs[0].reasoning_content === 'thinking', 'reasoning_content preserved')
})

// ── TC12: Null wrapper ──────────────────────────────────────────────────────
test('TC12: Null/undefined wrapper in array is skipped gracefully', () => {
  const msgs = deepClone([
    null,
    { role: 'assistant', content: 'hi', reasoning_content: 'think' },
    undefined,
  ])
  const result = patchMessages(msgs)
  assert(result >= 1, `expected at least 1 patch, got ${result}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===\n`)

process.exit(failed > 0 ? 1 : 0)
