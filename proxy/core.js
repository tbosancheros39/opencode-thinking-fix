'use strict'

import { createParser } from 'eventsource-parser'
import crypto from 'node:crypto'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { appendFileSync, mkdirSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

export function deriveSessionId(modelName, parsedBody, authHeader) {
  const messages = parsedBody?.messages
  if (!Array.isArray(messages)) return ''
  const firstUser = messages.find((m) => m && m.role === 'user')
  if (!firstUser) return ''
  const text = typeof firstUser.content === 'string'
    ? firstUser.content
    : Array.isArray(firstUser.content)
      ? firstUser.content.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('')
      : ''
  if (!text) return ''
  return 'derived:' + crypto.createHash('sha256')
    .update(`${authHeader || ''}||${modelName}||${text}`).digest('hex').slice(0, 32)
}

const LOG_FILE = process.env.LOG_FILE === ''
  ? ''
  : (process.env.LOG_FILE || join(homedir(), '.local', 'share', 'opencode', 'thinking-fix.log'))

export function writeLog(entry) {
  if (!LOG_FILE) return
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true })
    appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8')
  } catch (error) {
    console.error('[Proxy] log write error:', error instanceof Error ? error.message : error)
  }
}

const DEBUG = process.env.DEBUG === '1'

export const ROUTES = {
  // Zen free-tier lane — BARE model ids as sent by the `opencode` provider
  // section (port 3459, universal mode). MUST stay at the top: generic
  // prefixes below ('deepseek-v4-flash', 'mimo', ...) would otherwise swallow
  // these names and route free traffic to provider-native endpoints.
  'x-preview-f-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'hy3-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'mimo-v2.5-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'muse-spark-1.2-contributor-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  // Step 5 Preview Free (StepFun): Zen free lane, chat/completions wire,
  // reasoning model with interleaved reasoning_content (verified 2026-10-12
  // against opencode.ai/docs/zen endpoints table + bundled model catalog).
  'step-5-preview-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'muse-spark-1.3-contributor-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  // 2026-10-18 models --refresh: newly published Zen free-tier models
  'beam-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'deepseek-v4.1-flash-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'glm-5.3-flash-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'longcat-2.5-preview-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'mimo-v2.6-flash-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'nemotron-3.5-super-vl-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'space-bunny-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'deepseek-v4-flash-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'ling-3.0-flash-fin-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'laguna-s-2.1-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'big-pickle': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'ox-alpha-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'nemotron-3-ultra-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'nemotron-3.5-lightning-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  // R1 aliases: reasoning must not be echoed back — the 'strip' sentinel
  // admits the request to patchRequestBody (to REMOVE any reasoning fields a
  // client/plugin attached) while excluding it from response-side caching.
  'deepseek-r1': { base: 'https://api.deepseek.com', reasoningKey: 'strip' },
  'deepseek-v4-pro': { base: 'https://api.deepseek.com', reasoningKey: 'reasoning_content' },
  'deepseek-v4-flash': { base: 'https://api.deepseek.com', reasoningKey: 'reasoning_content' },
  'deepseek-chat': { base: 'https://api.deepseek.com', reasoningKey: 'reasoning_content' },
  'deepseek-reasoner': { base: 'https://api.deepseek.com', reasoningKey: 'strip' },
  deepseek: { base: 'https://api.deepseek.com', reasoningKey: 'reasoning_content' },
  kimi: { base: 'https://api.moonshot.ai/v1', reasoningKey: 'reasoning_content' },
  moonshot: { base: 'https://api.moonshot.ai/v1', reasoningKey: 'reasoning_content' },
  glm: { base: 'https://open.bigmodel.cn/api/paas/v4', reasoningKey: 'reasoning_content' },
  zhipu: { base: 'https://open.bigmodel.cn/api/paas/v4', reasoningKey: 'reasoning_content' },
  minimax: { base: 'https://api.minimax.io/v1', reasoningKey: 'reasoning_details' },
  mimo: { base: 'https://api.xiaomimimo.com/v1', reasoningKey: 'reasoning_content' },
  qwen: { base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', reasoningKey: null },
  gpt: { base: 'https://api.openai.com', reasoningKey: null },
  o1: { base: 'https://api.openai.com', reasoningKey: null },
  claude: { base: 'https://api.anthropic.com', reasoningKey: null },
  anthropic: { base: 'https://api.anthropic.com', reasoningKey: null },
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/openai', reasoningKey: null },
  llama: { base: 'https://api.together.xyz', reasoningKey: null },
  mistral: { base: 'https://api.mistral.ai', reasoningKey: null },
  // opencode/ zen free-tier models — served by the OpenCode zen gateway at
  // zen/v1 (chat/completions wire, reasoning_content carrier). Distinct from
  // the opencode-go namespace (port 3458) handled by fixedUpstreamRoute.
  // Explicit per-model prefixes only: no catch-all `opencode/` prefix, so paid
  // opencode/* models keep their existing DEFAULT_ROUTE behavior.
  'opencode/hy3-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/mimo-v2.5-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/muse-spark-1.2-contributor-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/muse-spark-1.3-contributor-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/step-5-preview-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/beam-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/deepseek-v4.1-flash-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/glm-5.3-flash-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/longcat-2.5-preview-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/mimo-v2.6-flash-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/nemotron-3.5-super-vl-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/space-bunny-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/deepseek-v4-flash-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/nemotron-3-ultra-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  'opencode/nemotron-3.5-lightning-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  // F19 (2026-09-03): InclusionAI Ling 3.0 Flash — Chinese MoE reasoning model
  // (124B/5.1B active, 262K ctx). Primary distribution is OpenRouter
  // (`inclusionai/ling-3.0-flash` paid, `:free` free tier). On OR the response
  // wire uses `delta.reasoning` (string) + `delta.reasoning_details` (array
  // of `reasoning.text` items with `format: "unknown"`); OR also accepts
  // `reasoning_content` as an input alias and normalizes on outbound to the
  // upstream (Novita, DeepInfra). Native ant-ling.com uses
  // `thinking.type: enabled|disabled`; not routed here (no client key).
  'inclusionai/ling-3.0-flash': { base: 'https://openrouter.ai/api/v1', reasoningKey: 'reasoning_content' },
  'inclusionai/ling-3.0-flash:free': { base: 'https://openrouter.ai/api/v1', reasoningKey: 'reasoning_content' },
  // Zen free-tier lane: `opencode/ling-3.0-flash-fin-free` is served by the
  // OpenCode Zen gateway at zen/v1 (chat/completions wire, DeepSeek-style
  // `reasoning_content` carrier). Add the prefixed form here so 3457 model-
  // routing sends it to Zen, not the default DeepSeek fallback.
  'opencode/ling-3.0-flash-fin-free': { base: 'https://opencode.ai/zen/v1', reasoningKey: 'reasoning_content' },
  // Catch-all for future InclusionAI variants (Ling-2.x, Ring-2.6-1T, etc.)
  // that may be added to OpenRouter before this proxy gets a per-model entry.
  'inclusionai': { base: 'https://openrouter.ai/api/v1', reasoningKey: 'reasoning_content' },
}

export const DEFAULT_ROUTE = { base: 'https://api.deepseek.com', reasoningKey: null }

// F13 (2026-08-27): clients may speak either OpenAI-style relative paths
// (/v1/...) or the upstream's full official prefix (/api/v1/... — OpenRouter's
// documented base is https://openrouter.ai/api/v1). Never double the prefix.
export function upstreamPathFor(reqUrl, basePath) {
  if (!basePath || basePath === '/' || basePath === '/v1') return reqUrl
  if (reqUrl === basePath || reqUrl.startsWith(basePath + '/')) return reqUrl
  return basePath + reqUrl.replace(/^\/v1/, '')
}

export function route(modelName) {
  if (!modelName) return DEFAULT_ROUTE
  const lower = modelName.toLowerCase()
  for (const [prefix, entry] of Object.entries(ROUTES)) {
    if (lower.startsWith(prefix)) return entry
  }
  return DEFAULT_ROUTE
}

// Models served by opencode-go over the Anthropic /v1/messages wire format.
const ANTHROPIC_WIRE_PREFIXES = ['minimax', 'qwen']

export function fixedUpstreamRoute(modelName, requestUrl = '') {
  const stripped = (modelName || '').toLowerCase().replace(/^opencode-go(?:-(?:messages|responses))?\//, '')
  if (String(requestUrl).includes('/messages') && ANTHROPIC_WIRE_PREFIXES.some((p) => stripped.startsWith(p))) {
    return { base: '', reasoningKey: 'anthropic' }
  }
  // F11 (validated 2026-08-19): the opencode-go gateway rejects the `reasoning`
  // field on glm-5.2 chat/completions echo (400 "Extra inputs are not
  // permitted") but accepts `reasoning_content`. glm-5.2 was live-validated
  // two-turn; other Go models were NOT changed by F11 and keep the existing
  // `reasoning` behavior below (no exhaustive per-model validation claimed).
  if (stripped === 'glm-5.2' && String(requestUrl).includes('/chat/completions')) {
    return { base: '', reasoningKey: 'reasoning_content' }
  }
  // REASONING_KEY env override (F12, 2026-08-27): lanes fixed to upstreams whose
  // wire is reasoning_content-based (zen/v1 free models, OpenRouter normalized
  // per-message passback) set REASONING_KEY=reasoning_content in their unit.
  // OpenRouter docs define top-level `reasoning` as a config OBJECT on requests,
  // so a string injection there must use reasoning_content instead. Units without
  // the env (validated go lane, 3458) keep the unconditional 'reasoning' behavior.
  if (process.env.REASONING_KEY) {
    return { base: '', reasoningKey: process.env.REASONING_KEY }
  }
  // Unconditional 'reasoning' for go mode: matches current working behavior
  // for chat/completions models; /responses bodies have no `messages` array
  // and pass through untouched.
  return { base: '', reasoningKey: 'reasoning' }
}

export class LRUCache {
  constructor(capacity) { this.cache = new Map(); this.capacity = capacity }
  get(key) {
    if (!this.cache.has(key)) return undefined
    const value = this.cache.get(key)
    this.cache.delete(key); this.cache.set(key, value)
    return value
  }
  set(key, value) {
    this.cache.delete(key)
    this.cache.set(key, value)
    while (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value
      this.cache.delete(oldest)
      if (DEBUG) console.log(`[Cache] evicted session ${String(oldest).slice(-8)}`)
    }
  }
  put(key, value) { this.set(key, value) }
}

const parsedCapacity = parseInt(process.env.CACHE_CAPACITY || '500', 10)
const CACHE_CAPACITY = Number.isFinite(parsedCapacity) && parsedCapacity >= 0 ? parsedCapacity : 500
const parsedMaxTurns = parseInt(process.env.MAX_TURNS_PER_SESSION || '200', 10)
const MAX_TURNS_PER_SESSION = Number.isFinite(parsedMaxTurns) && parsedMaxTurns > 0 ? parsedMaxTurns : 200
const parsedMaxReasoning = parseInt(process.env.MAX_REASONING_CHARS || '200000', 10)
const MAX_REASONING_CHARS = Number.isFinite(parsedMaxReasoning) && parsedMaxReasoning > 0 ? parsedMaxReasoning : 200000

// MiniMax reasoning_details replay shape.
//
// NOTE (F6, 2026-08-19): in our opencode-go deployment (port 3458, Anthropic
// /v1/messages wire) every MiniMax request resolves to reasoningKey 'anthropic'
// via fixedUpstreamRoute(), so this constant and the reasoning_details branch
// in patchRequestBody() are UNUSED in production. Retained defensively for the
// port-3457 universal-mode / provider-native MiniMax fallback (ROUTES.minimax).
//
// 'full' emits the openai-responses-v1 item { type, format, index, text };
// 'minimal' emits { type, text }. Default 'minimal' (smallest documented
// outbound shape).
const MINIMAX_REASONING_DETAILS_SHAPE = process.env.MINIMAX_REASONING_DETAILS_SHAPE === 'full' ? 'full' : 'minimal'

class BoundedSessionMap extends Map {
  set(key, value) {
    // Skip-not-truncate: an oversized reasoning value is dropped entirely
    // rather than silently truncated (a truncated replay can be worse than a
    // cache miss). Returns true when stored, false when skipped.
    if (typeof value === 'string' && value.length > MAX_REASONING_CHARS) return false
    super.set(key, value)
    while (this.size > MAX_TURNS_PER_SESSION) this.delete(this.keys().next().value)
    return true
  }
}

export const cache = new LRUCache(CACHE_CAPACITY)
export const stats = { sessions: 0, hits: 0, misses: 0, stored: 0, requests: 0, passthrough: 0 }

export function getSessionCache(sessionId) {
  let sessionMap = cache.get(sessionId)
  if (!sessionMap) { sessionMap = new BoundedSessionMap(); cache.set(sessionId, sessionMap); stats.sessions++ }
  return sessionMap
}

export function patchRequestBody(body, sessionId, reasoningKey) {
  const emptyReport = { assistantTurns: 0, missingText: 0, missingReasoning: 0, hits: 0, misses: 0, turns: [] }
  if (!reasoningKey || typeof sessionId !== 'string' || !sessionId.trim() || sessionId.trim() === 'unknown') return { body, assistantCount: 0, modified: false, report: emptyReport }
  let parsed
  try { parsed = JSON.parse(body) } catch { return { body, assistantCount: 0, modified: false, report: emptyReport } }
  if (!Array.isArray(parsed.messages)) return { body, assistantCount: 0, modified: false, report: emptyReport }

  const sessionCache = getSessionCache(sessionId)
  const report = { ...emptyReport, turns: [] }
  let assistantIndex = 0
  let modified = false
  for (const msg of parsed.messages) {
    if (msg.role !== 'assistant') continue
    report.assistantTurns++
    if (msg.content == null || msg.content === '') report.missingText++
    const cached = sessionCache.get(assistantIndex)
    let missingReasoning = false
    if (reasoningKey === 'anthropic') {
      // Anthropic wire: reasoning lives inside content[] as a thinking block.
      const hasThinking = Array.isArray(msg.content) && msg.content.some((b) => b && (b.type === 'thinking' || b.type === 'redacted_thinking'))
      missingReasoning = !hasThinking
      if (missingReasoning) report.missingReasoning++
      if (cached) {
        if (Array.isArray(msg.content)) {
          if (!hasThinking) { msg.content.unshift({ type: 'thinking', thinking: cached }); stats.hits++; report.hits++; report.turns.push({ index: assistantIndex, fields: ['content'], source: 'hit' }); modified = true }
        } else if (typeof msg.content === 'string') {
          msg.content = [{ type: 'thinking', thinking: cached }, { type: 'text', text: msg.content }]
          stats.hits++; report.hits++; report.turns.push({ index: assistantIndex, fields: ['content'], source: 'hit' }); modified = true
        }
      } else {
        // No hard-400 contract on MiniMax/Qwen anthropic endpoints; never fabricate.
        if (missingReasoning) { stats.misses++; report.misses++ }
      }
    } else if (reasoningKey === 'reasoning_details') {
      // F6 (defensive): provider-native MiniMax on port 3457 universal mode
      // replays reasoning into `reasoning_details`. Never executed in the
      // opencode-go deployment (MiniMax always routes as 'anthropic' there) —
      // retained for the universal-mode / provider-native fallback.
      const hasDetails = Array.isArray(msg.reasoning_details) ? msg.reasoning_details.length > 0 : !!msg.reasoning_details
      missingReasoning = !hasDetails && !msg.reasoning_content
      if (missingReasoning) report.missingReasoning++
      if (!hasDetails && !msg.reasoning_content && cached) {
        msg.reasoning_details = MINIMAX_REASONING_DETAILS_SHAPE === 'full'
          ? [{ type: 'reasoning.text', format: 'openai-responses-v1', index: assistantIndex, text: cached }]
          : [{ type: 'reasoning.text', text: cached }]
        stats.hits++; report.hits++; report.turns.push({ index: assistantIndex, fields: ['reasoning_details'], source: 'hit' }); modified = true
      } else if (missingReasoning) {
        stats.misses++; report.misses++
      }
    } else if (reasoningKey === 'strip') {
      // R1 sentinel: deepseek-r1 / deepseek-reasoner 400 when reasoning is
      // echoed back. Actively remove any reasoning field a client/plugin may
      // have attached rather than replay it.
      const stripped = []
      if (msg.reasoning_content !== undefined) { delete msg.reasoning_content; stripped.push('reasoning_content') }
      if (msg.reasoning !== undefined) { delete msg.reasoning; stripped.push('reasoning') }
      if (msg.reasoning_details !== undefined) { delete msg.reasoning_details; stripped.push('reasoning_details') }
      if (Array.isArray(msg.content)) {
        const kept = msg.content.filter((b) => !(b && (b.type === 'thinking' || b.type === 'redacted_thinking')))
        if (kept.length !== msg.content.length) { msg.content = kept; stripped.push('content') }
      }
      if (stripped.length > 0) {
        modified = true
        report.turns.push({ index: assistantIndex, fields: stripped, source: 'strip' })
      }
    } else if (!msg[reasoningKey] || msg[reasoningKey] === '') {
      missingReasoning = true
      report.missingReasoning++
      if (cached) { msg[reasoningKey] = cached; stats.hits++ }
      else { msg[reasoningKey] = ''; stats.misses++ }
      if (cached) { report.hits++; report.turns.push({ index: assistantIndex, fields: [reasoningKey], source: 'hit' }) }
      else { report.misses++; report.turns.push({ index: assistantIndex, fields: [reasoningKey], source: 'miss' }) }
      modified = true
    }
    assistantIndex++
  }
  return { body: modified ? JSON.stringify(parsed) : body, assistantCount: assistantIndex, modified, report }
}

export function extractReasoningFromJson(text) {
  try {
    const parsed = JSON.parse(text)
    // Anthropic buffered format: content[] with thinking blocks.
    if (Array.isArray(parsed?.content)) {
      const thinking = parsed.content
        // Explicit redacted_thinking guard (redundant with the
        // b.type === 'thinking' equality below, but kept for contract
        // clarity: redacted blocks must never be replayed as reasoning).
        .filter((b) => b && b.type === 'thinking' && b.type !== 'redacted_thinking' && typeof b.thinking === 'string')
        .map((b) => b.thinking)
        .join('\n')
      if (thinking) return thinking
    }
    // OpenAI buffered format.
    const msg = parsed?.choices?.[0]?.message
    if (msg) {
      if (typeof msg.reasoning_content === 'string' && msg.reasoning_content) return msg.reasoning_content
      if (typeof msg.reasoning === 'string' && msg.reasoning) return msg.reasoning
      if (Array.isArray(msg.reasoning_details)) {
        const reasoning = msg.reasoning_details.map((d) => d.text || '').join('')
        if (reasoning) return reasoning
      }
    }
  } catch { /* not JSON */ }
  return null
}

export function createStreamParser(sessionId, baseIndex, onComplete) {
  let reasoningBuffer = ''
  // StringDecoder buffers partial multibyte UTF-8 sequences across feed()
  // calls, so a character split between two chunks is not corrupted.
  const decoder = new StringDecoder('utf8')
  const parser = createParser({
    maxBufferSize: 1024 * 1024,
    onEvent(event) {
      if (!event.data || event.data === '[DONE]') {
        if (reasoningBuffer) { onComplete(baseIndex, reasoningBuffer); reasoningBuffer = '' }
        return
      }
      try {
        const parsed = JSON.parse(event.data)
        // Anthropic SSE: terminate on message_stop.
        if (event.event === 'message_stop' || parsed.type === 'message_stop') {
          if (reasoningBuffer) { onComplete(baseIndex, reasoningBuffer); reasoningBuffer = '' }
          return
        }
        // Anthropic SSE: thinking deltas carry delta.thinking (type thinking_delta).
        if (event.event === 'content_block_delta' || parsed.type === 'content_block_delta') {
          const delta = parsed.delta
          if (delta && typeof delta.thinking === 'string') reasoningBuffer += delta.thinking
          return
        }
        // OpenAI SSE.
        const delta = parsed.choices?.[0]?.delta
        if (!delta) return
        if (typeof delta.reasoning_content === 'string') reasoningBuffer += delta.reasoning_content
        if (typeof delta.reasoning === 'string') reasoningBuffer += delta.reasoning
        if (Array.isArray(delta.reasoning_details)) {
          for (const detail of delta.reasoning_details) if (typeof detail.text === 'string') reasoningBuffer += detail.text
        }
        if (parsed.choices?.[0]?.finish_reason && reasoningBuffer) {
          onComplete(baseIndex, reasoningBuffer); reasoningBuffer = ''
        }
      } catch { /* malformed SSE chunk, ignore */ }
    },
    onError(error) { if (DEBUG) console.error(`[Proxy] SSE parse error (${sessionId.slice(-8)}):`, error.message) },
  })
  return {
    feed(chunk) { parser.feed(decoder.write(chunk)) },
    flush() {
      const tail = decoder.end()
      if (tail) parser.feed(tail)
      if (reasoningBuffer) { onComplete(baseIndex, reasoningBuffer); reasoningBuffer = '' }
    },
  }
}

// F12 (2026-09-01): provider-specific request-body injections applied before
// forwarding. Currently a single rule: Z.ai preserved-thinking opt-in. Future
// F-tags (per-provider `thinking.keep`, sampling-constraint strips, etc.) can
// be added here without growing the patchRequestBody signature.
//
// Z.ai `clear_thinking` is the server-side opt-in for Preserved Thinking on
// the standard Z.ai Chat Completions endpoint. Default is `true` on the
// standard API, `false` on the Coding Plan endpoint. With `true`, the server
// strips prior reasoning_content from context even when the client passes it
// back — which silently degrades multi-turn GLM sessions to "re-derive from
// scratch every turn, loop, burn tokens". The OpenCode Go gateway and
// OpenRouter do NOT change this default on the user's behalf; the client must
// opt in.
//
// Docs:
//   https://docs.z.ai/guides/capabilities/thinking-mode
//     "This capability is enabled by default on the Coding Plan endpoint and
//      disabled by default on the standard API endpoint. If you want to enable
//      Preserved Thinking in your product … you can turn it on for the API
//      endpoint by setting clear_thinking: false, and you must return the
//      complete, unmodified reasoning_content back to the API."
//   https://docs.z.ai/api-reference/llm/chat-completion
//     thinking.clear_thinking — type boolean, default true.
//
// Z.ai-reachable hosts (allowlist, conservative):
//   - open.bigmodel.cn       (BigModel direct, port 3457 universal mode)
//   - api.z.ai               (Z.ai international, future-proofing)
//   - opencode.ai/zen/go     (OpenCode Go gateway, port 3458)
//   - openrouter.ai          (OpenRouter, port 3462; routes GLM to Z.ai under the hood)
function isZAiReachableBase(base) {
  if (!base || typeof base !== 'string') return false
  let host, path
  try { const u = new URL(base); host = u.hostname.toLowerCase(); path = u.pathname.toLowerCase() } catch { return false }
  if (host === 'open.bigmodel.cn') return true
  if (host === 'api.z.ai') return true
  if (host === 'opencode.ai' && path.startsWith('/zen/go')) return true
  if (host === 'openrouter.ai') return true
  return false
}

export function applyProviderBodyInjections(modelName, body, routeTarget) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { body, modified: false, injections: [] }
  const injections = []
  let modified = false
  const lower = (modelName || '').toLowerCase()
  const base = (routeTarget && routeTarget.base) || ''

  // F12: GLM / Zhipu on any Z.ai-reachable lane — opt in to Preserved Thinking
  // so the server keeps prior reasoning_content across turns instead of
  // silently stripping it. Skipped when the client explicitly disabled
  // thinking (forcing preserved thinking on top of disabled thinking would be
  // incoherent). The merge is idempotent: a client-supplied thinking.type is
  // preserved alongside the injected clear_thinking:false.
  //
  // Model-name detection accepts both bare names (glm-5.2, zhipu-glm-5) and
  // gateway-prefixed slugs (z-ai/glm-5.2, zhipu/glm-4.5, opencode-go/glm-5.2).
  // The "/glm" or "/zhipu" path-segment check catches the prefixed slugs that
  // don't start with the bare name.
  const isZAiModel = lower.startsWith('glm')
    || lower.startsWith('zhipu')
    || lower.includes('/glm')
    || lower.includes('/zhipu')
  if (isZAiModel && isZAiReachableBase(base)) {
    if (body.thinking !== false) {
      const before = body.thinking
      const preserved = before && typeof before === 'object' && !Array.isArray(before) ? before : {}
      body.thinking = { ...preserved, clear_thinking: false }
      if (before !== body.thinking) modified = true
      injections.push({ tag: 'F12', field: 'thinking.clear_thinking', value: false })
    }
  }

  return { body, modified, injections }
}
