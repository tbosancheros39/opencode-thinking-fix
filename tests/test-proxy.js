'use strict'

// ── Relevant functions extracted from proxy.js ──

const ROUTES = {
  deepseek:   { base: 'https://api.deepseek.com',              reasoning: true  },
  kimi:       { base: 'https://api.moonshot.ai/v1',            reasoning: true  },
  moonshot:   { base: 'https://api.moonshot.ai/v1',            reasoning: true  },
  glm:        { base: 'https://open.bigmodel.cn/api/paas/v4', reasoning: true  },
  zhipu:      { base: 'https://open.bigmodel.cn/api/paas/v4', reasoning: true  },
  minimax:    { base: 'https://api.minimax.io/v1',             reasoning: true  },
  mimo:       { base: 'https://api.minimax.io/v1',             reasoning: true  },
  gpt:        { base: 'https://api.openai.com',                reasoning: false },
  o1:         { base: 'https://api.openai.com',                reasoning: false },
  claude:     { base: 'https://api.anthropic.com',             reasoning: false },
  anthropic:  { base: 'https://api.anthropic.com',             reasoning: false },
  qwen:       { base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', reasoning: false },
  gemini:     { base: 'https://generativelanguage.googleapis.com/v1beta/openai', reasoning: false },
  llama:      { base: 'https://api.together.xyz',              reasoning: false },
  mistral:    { base: 'https://api.mistral.ai',                reasoning: false },
}

const DEFAULT_ROUTE = { base: 'https://api.deepseek.com', reasoning: false }

function route(modelName) {
  if (!modelName) return DEFAULT_ROUTE
  const lower = modelName.toLowerCase()
  for (const [prefix, entry] of Object.entries(ROUTES)) {
    if (lower.startsWith(prefix)) return entry
  }
  return DEFAULT_ROUTE
}

const cache = new Map()

function getSessionCache(sessionId) {
  if (!cache.has(sessionId)) cache.set(sessionId, new Map())
  return cache.get(sessionId)
}

function patchRequestBody(body, sessionId) {
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    return body
  }

  if (!Array.isArray(parsed.messages)) return body

  const sessionCache = getSessionCache(sessionId)
  let assistantIndex = 0
  let modified = false

  for (const msg of parsed.messages) {
    if (msg.role !== 'assistant') continue

    if (!msg.content && msg.content !== '') {
      msg.content = msg.tool_calls?.length ? 'call tool' : ''
      modified = true
    }

    if (!msg.reasoning_content) {
      const cached = sessionCache.get(assistantIndex)
      msg.reasoning_content = cached ?? ''
      modified = true
    }

    if (!msg.reasoning) {
      const cached = sessionCache.get(assistantIndex)
      msg.reasoning = cached ?? ''
      modified = true
    }

    assistantIndex++
  }

  return modified ? JSON.stringify(parsed) : body
}

function createStreamParser(sessionId, onComplete) {
  let buffer = ''
  let reasoningBuffer = ''
  let assistantIndex = 0
  let inReasoning = false

  return {
    feed(chunk) {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') {
          if (reasoningBuffer) {
            onComplete(assistantIndex, reasoningBuffer)
            reasoningBuffer = ''
          }
          continue
        }
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta
          if (!delta) continue

          if (typeof delta.reasoning_content === 'string') {
            reasoningBuffer += delta.reasoning_content
            inReasoning = true
          }

          if (typeof delta.reasoning === 'string') {
            reasoningBuffer += delta.reasoning
            inReasoning = true
          }

          if (typeof delta.content === 'string' && delta.content && inReasoning) {
            if (reasoningBuffer) {
              onComplete(assistantIndex, reasoningBuffer)
              reasoningBuffer = ''
              inReasoning = false
            }
          }

          if (parsed.choices?.[0]?.finish_reason) {
            if (reasoningBuffer) {
              onComplete(assistantIndex, reasoningBuffer)
              reasoningBuffer = ''
              inReasoning = false
            }
            assistantIndex++
          }
        } catch {
          // skip malformed
        }
      }
    },
    flush() {
      if (reasoningBuffer) {
        onComplete(assistantIndex, reasoningBuffer)
        reasoningBuffer = ''
      }
    }
  }
}

// ── Test runner ──

let testsPassed = 0
let testsFailed = 0
const failures = []

function assert(condition, description) {
  if (condition) {
    testsPassed++
    console.log('  PASS: ' + description)
  } else {
    testsFailed++
    failures.push(description)
    console.log('  FAIL: ' + description)
  }
}

function assertEqual(actual, expected, description) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    testsPassed++
    console.log('  PASS: ' + description)
  } else {
    testsFailed++
    failures.push(description + ' -- expected ' + e + ', got ' + a)
    console.log('  FAIL: ' + description + ' -- expected ' + e + ', got ' + a)
  }
}

function clearCache() {
  cache.clear()
}

// ═════════════════════════════════════════════════════════════════════════
// route() tests
// ═════════════════════════════════════════════════════════════════════════

console.log('\n=== route() tests ===\n')

// 11: deepseek-reasoner
let r = route('deepseek-reasoner')
assertEqual(r.base, 'https://api.deepseek.com', '11. deepseek-reasoner routes to deepseek')
assert(r.reasoning === true, '11b. deepseek-reasoner reasoning=true')

// 12: kimi-k2.6
r = route('kimi-k2.6')
assertEqual(r.base, 'https://api.moonshot.ai/v1', '12. kimi-k2.6 routes to kimi')
assert(r.reasoning === true, '12b. kimi-k2.6 reasoning=true')

// 13: glm-5.2
r = route('glm-5.2')
assertEqual(r.base, 'https://open.bigmodel.cn/api/paas/v4', '13. glm-5.2 routes to glm')
assert(r.reasoning === true, '13b. glm-5.2 reasoning=true')

// 14: gpt-4
r = route('gpt-4')
assertEqual(r.base, 'https://api.openai.com', '14. gpt-4 routes to gpt')
assert(r.reasoning === false, '14b. gpt-4 reasoning=false')

// 15: unknown-model
r = route('unknown-model')
assertEqual(r.base, 'https://api.deepseek.com', '15. unknown-model -> DEFAULT_ROUTE')
assert(r.reasoning === false, '15b. unknown-model reasoning=false')

// ═════════════════════════════════════════════════════════════════════════
// patchRequestBody() tests
// ═════════════════════════════════════════════════════════════════════════

console.log('\n=== patchRequestBody() tests ===\n')

// 1: reasoning_content injection
clearCache()
getSessionCache('test1').set(0, 'step 1...')
const b1 = JSON.stringify({
  messages: [{ role: 'assistant', content: 'hi', reasoning_content: '' }]
})
const r1 = JSON.parse(patchRequestBody(b1, 'test1'))
assertEqual(r1.messages[0].reasoning_content, 'step 1...', '1. reasoning_content injected from cache')

// 2: reasoning injection (OpenCode Go)
clearCache()
getSessionCache('test2').set(0, 'step 1...')
const b2 = JSON.stringify({
  messages: [{ role: 'assistant', content: 'hi', reasoning: '' }]
})
const r2 = JSON.parse(patchRequestBody(b2, 'test2'))
assertEqual(r2.messages[0].reasoning, 'step 1...', '2. reasoning injected from cache (OpenCode Go)')

// 3: BOTH fields injection
clearCache()
getSessionCache('test3').set(0, 'step 1...')
const b3 = JSON.stringify({
  messages: [{ role: 'assistant', content: 'hi', reasoning_content: '', reasoning: '' }]
})
const r3 = JSON.parse(patchRequestBody(b3, 'test3'))
assertEqual(r3.messages[0].reasoning_content, 'step 1...', '3a. both fields: reasoning_content injected')
assertEqual(r3.messages[0].reasoning, 'step 1...', '3b. both fields: reasoning injected')

// 4: No cache available
clearCache()
const b4 = JSON.stringify({
  messages: [{ role: 'assistant', content: 'hi' }]
})
const r4 = JSON.parse(patchRequestBody(b4, 'test4'))
assertEqual(r4.messages[0].reasoning_content, '', '4a. no cache: reasoning_content becomes ""')
assertEqual(r4.messages[0].reasoning, '', '4b. no cache: reasoning becomes ""')

// 5: User messages untouched
clearCache()
getSessionCache('test5').set(0, 'step 1...')
const b5 = JSON.stringify({
  messages: [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi', reasoning_content: '' }
  ]
})
const r5 = JSON.parse(patchRequestBody(b5, 'test5'))
assertEqual(r5.messages[0].role, 'user', '5a. user role unchanged')
assertEqual(r5.messages[0].content, 'hello', '5b. user content unchanged')
assert(!('reasoning_content' in r5.messages[0]) && !('reasoning' in r5.messages[0]), '5c. user has no reasoning fields')
assertEqual(r5.messages[1].reasoning_content, 'step 1...', '5d. assistant reasoning_content injected')

// 6: Multiple assistant turns
clearCache()
getSessionCache('test6').set(0, 'first reasoning')
getSessionCache('test6').set(1, 'second reasoning')
const b6 = JSON.stringify({
  messages: [
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1', reasoning_content: '' },
    { role: 'user', content: 'q2' },
    { role: 'assistant', content: 'a2', reasoning_content: '' }
  ]
})
const r6 = JSON.parse(patchRequestBody(b6, 'test6'))
assertEqual(r6.messages[1].reasoning_content, 'first reasoning', '6a. first assistant gets its cached reasoning')
assertEqual(r6.messages[3].reasoning_content, 'second reasoning', '6b. second assistant gets its cached reasoning')

// ═════════════════════════════════════════════════════════════════════════
// createStreamParser() tests
// ═════════════════════════════════════════════════════════════════════════

console.log('\n=== createStreamParser() tests ===\n')

// 7: delta.reasoning_content accumulation
const res7 = []
const p7 = createStreamParser('test7', function(idx, reasoning) {
  res7.push({ idx: idx, reasoning: reasoning })
})
p7.feed('data: {"choices":[{"delta":{"reasoning_content":"step "}}]}\n')
p7.feed('data: {"choices":[{"delta":{"reasoning_content":"1"}}]}\n')
p7.feed('data: [DONE]\n')
assertEqual(res7.length, 1, '7a. onComplete called once')
if (res7.length > 0) {
  assertEqual(res7[0].reasoning, 'step 1', '7b. reasoning_content accumulated as "step 1"')
  assertEqual(res7[0].idx, 0, '7c. index is 0')
}

// 8: delta.reasoning accumulation (OpenCode Go)
const res8 = []
const p8 = createStreamParser('test8', function(idx, reasoning) {
  res8.push({ idx: idx, reasoning: reasoning })
})
p8.feed('data: {"choices":[{"delta":{"reasoning":"think "}}]}\n')
p8.feed('data: {"choices":[{"delta":{"reasoning":"about it"}}]}\n')
p8.feed('data: [DONE]\n')
assertEqual(res8.length, 1, '8a. onComplete called once')
if (res8.length > 0) {
  assertEqual(res8[0].reasoning, 'think about it', '8b. reasoning accumulated as "think about it"')
  assertEqual(res8[0].idx, 0, '8c. index is 0')
}

// 9: Content after reasoning triggers flush
const res9 = []
const p9 = createStreamParser('test9', function(idx, reasoning) {
  res9.push({ idx: idx, reasoning: reasoning })
})
p9.feed('data: {"choices":[{"delta":{"reasoning_content":"step 1"}}]}\n')
p9.feed('data: {"choices":[{"delta":{"content":"Hello"}}]}\n')
assertEqual(res9.length, 1, '9a. onComplete called when content starts')
if (res9.length > 0) {
  assertEqual(res9[0].reasoning, 'step 1', '9b. reasoning is "step 1"')
  assertEqual(res9[0].idx, 0, '9c. index is 0')
}

// 10: finish_reason triggers flush
const res10 = []
const p10 = createStreamParser('test10', function(idx, reasoning) {
  res10.push({ idx: idx, reasoning: reasoning })
})
p10.feed('data: {"choices":[{"delta":{"reasoning_content":"step 1"}}]}\n')
p10.feed('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n')
assertEqual(res10.length, 1, '10a. onComplete called on finish_reason')
if (res10.length > 0) {
  assertEqual(res10[0].reasoning, 'step 1', '10b. reasoning is "step 1"')
  assertEqual(res10[0].idx, 0, '10c. index is 0 (before increment)')
}

// ═════════════════════════════════════════════════════════════════════════
// Summary
// ═════════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(50))
console.log('Tests: ' + (testsPassed + testsFailed) + ' | Passed: ' + testsPassed + ' | Failed: ' + testsFailed)
if (failures.length > 0) {
  console.log('\nFailures:')
  failures.forEach(function(f) { console.log('  - ' + f) })
}
console.log()

process.exit(testsFailed > 0 ? 1 : 0)
