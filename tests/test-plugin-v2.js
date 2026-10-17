'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// patchV2Messages, ported from opencode-thinking-fix-universal.ts
// V2 carries the passback field on native.openaiCompatible.reasoning_content.
// ─────────────────────────────────────────────────────────────────────────────
function patchV2Messages(messages) {
  const reasoningModel = messages.some((msg) => {
    if (!msg || msg.role !== 'assistant') return false
    if (Array.isArray(msg.content) && msg.content.some((part) => part?.type === 'reasoning')) return true
    const native = msg.native?.openaiCompatible
    return !!native && (typeof native.reasoning_content === 'string' || typeof native.reasoning === 'string')
  })

  if (!reasoningModel) return 0

  let patched = 0
  for (const msg of messages) {
    if (!msg || msg.role !== 'assistant') continue
    if (msg.native === undefined) msg.native = {}
    if (msg.native.openaiCompatible === undefined) msg.native.openaiCompatible = {}
    const native = msg.native.openaiCompatible
    if (typeof native.reasoning_content !== 'string') {
      native.reasoning_content = ''
      patched++
    }
  }

  return patched
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
    const msg = `${name}, ${e.message}`
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
console.log('\n=== patchV2Messages Regression Tests ===\n')

test('V2-TC1: reasoning part detects the model and injects the carrier', () => {
  const msgs = deepClone([
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [{ type: 'reasoning', text: 'step 1' }, { type: 'text', text: 'ok' }] },
  ])
  const result = patchV2Messages(msgs)
  assert(result === 1, `expected 1 patch, got ${result}`)
  assert(msgs[1].native.openaiCompatible.reasoning_content === '', 'carrier should be injected')
  assert(msgs[0].native === undefined, 'user message must not be touched')
})

test('V2-TC2: existing native reasoning_content also triggers detection', () => {
  const msgs = deepClone([
    { role: 'assistant', content: [{ type: 'text', text: 'ok' }], native: { openaiCompatible: { reasoning_content: 't' } } },
  ])
  const result = patchV2Messages(msgs)
  assert(result === 0, `expected 0 patches, got ${result}`)
  assert(msgs[0].native.openaiCompatible.reasoning_content === 't', 'existing carrier preserved')
})

test('V2-TC3: non-reasoning model is untouched', () => {
  const msgs = deepClone([
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
  ])
  const result = patchV2Messages(msgs)
  assert(result === 0, `expected 0, got ${result}`)
  assert(msgs[1].native === undefined, 'no carrier injected')
})

test('V2-TC4: every assistant turn gets the carrier', () => {
  const msgs = deepClone([
    { role: 'assistant', content: [{ type: 'text', text: 'first' }] },
    { role: 'assistant', content: [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'second' }] },
  ])
  const result = patchV2Messages(msgs)
  assert(result === 2, `expected 2 patches, got ${result}`)
  assert(msgs[0].native.openaiCompatible.reasoning_content === '', 'first assistant patched')
  assert(msgs[1].native.openaiCompatible.reasoning_content === '', 'second assistant patched')
})

test('V2-TC5: empty messages array returns 0', () => {
  assert(patchV2Messages([]) === 0, 'expected 0')
})

test('V2-TC6: null and undefined entries are skipped', () => {
  const msgs = [null, undefined, { role: 'assistant', content: [{ type: 'reasoning', text: 't' }] }]
  const result = patchV2Messages(msgs)
  assert(result === 1, `expected 1, got ${result}`)
})

test('V2-TC7: tool-call assistant with reasoning is patched', () => {
  const msgs = deepClone([
    { role: 'assistant', content: [{ type: 'reasoning', text: 't' }, { type: 'tool-call', id: '1', name: 'f', input: {} }] },
  ])
  const result = patchV2Messages(msgs)
  assert(result === 1, `expected 1, got ${result}`)
  assert(msgs[0].native.openaiCompatible.reasoning_content === '', 'carrier injected')
})

test('V2-TC8: unrelated native data is preserved', () => {
  const msgs = deepClone([
    { role: 'assistant', content: [{ type: 'reasoning', text: 't' }], native: { other: { keep: true } } },
  ])
  const result = patchV2Messages(msgs)
  assert(result === 1, `expected 1, got ${result}`)
  assert(msgs[0].native.other.keep === true, 'unrelated native data preserved')
  assert(msgs[0].native.openaiCompatible.reasoning_content === '', 'carrier injected alongside')
})

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed
console.log(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===\n`)

process.exit(failed > 0 ? 1 : 0)
