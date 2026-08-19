#!/usr/bin/env node
'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// L7 — opencode-go MiniMax anthropic-wire replay ship-gate (v3.2.0, F6 fix)
//
// F6 correction: the OLD L7 script exercised provider-native MiniMax against
// https://api.minimax.io/v1 (port 3457 universal mode) with the
// `reasoning_details` shape. That path is DEAD in our deployment. Every
// MiniMax request in production goes through opencode-go at port 3458 on the
// Anthropic /v1/messages wire, so reasoningKey is ALWAYS 'anthropic'.
//
// This script therefore tests the path we actually use:
//   opencode-go/minimax-m3 → port 3458 → Anthropic Messages API wire
//     → proxy unshifts { type:'thinking', thinking:<cached> } into the
//       assistant turn's content[] when the turn lacks a thinking block.
//
// Two modes:
//   DEFAULT (self-contained mock): starts an in-process mock upstream that
//     emulates opencode-go's /v1/messages SSE stream (thinking_delta events),
//     spawns proxy/proxy.js on a free port with UPSTREAM_URL pointed at the
//     mock, then:
//       turn 1 — streaming request; the proxy caches the streamed thinking.
//       turn 2 — a tool-call assistant turn whose content[] lacks a thinking
//         block; the proxy must unshift the cached turn-1 thinking. Verified by
//         inspecting the request body the mock upstream captured.
//     No network, no live key required. Exit 0=PASS, 1=FAIL.
//
//   LIVE (L7_LIVE=1): hits http://127.0.0.1:3458/v1/messages against the real
//     opencode-go proxy. Requires a running proxy + the opencode-go key in
//     auth.json. Exit 0=PASS, 2=SKIP if key/reachability missing, 1=FAIL.
//
// Requirements: Node 18+ (global fetch — no dependencies).
// Auth: the opencode-go key is read at runtime from
//   ~/.local/share/opencode/auth.json (top-level `opencode-go.key`, type api).
//   The key is NEVER printed.
//
// Exit codes: 0 PASS | 1 FAIL | 2 SKIP
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIVE = process.env.L7_LIVE === '1'
const SESSION_ID = 'l7-minimax-anthropic-replay'
const MODEL = 'minimax-m3'
const ANTHROPIC_VERSION = '2023-06-01'

// Known thinking text the mock streams on turn 1. Split so the client and the
// proxy must each accumulate two deltas (exercises multi-delta reasoning).
const THINKING = 'I need to check the current weather conditions for Paris before I answer.'
const THINKING_PART1 = THINKING.slice(0, 40)
const THINKING_PART2 = THINKING.slice(40)

const __dirname = dirname(fileURLToPath(import.meta.url))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── auth.json ────────────────────────────────────────────────────────────────
function loadOpenCodeGoKey() {
  const authPath = process.env.OPENCODE_AUTH_PATH || join(homedir(), '.local', 'share', 'opencode', 'auth.json')
  try {
    const auth = JSON.parse(readFileSync(authPath, 'utf8'))
    const entry = auth && auth['opencode-go']
    if (entry && typeof entry.key === 'string' && entry.key.length > 0) return entry.key
  } catch { /* missing/unreadable */ }
  return ''
}

// ── Anthropic wire headers (key is used, never logged) ───────────────────────
function authHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-session-id': SESSION_ID,
  }
}

// ── Client-side SSE parser: accumulate thinking_delta deltas ────────────────
function parseThinkingFromSSE(text) {
  let thinking = ''
  let answer = ''
  for (const block of text.split(/\n\n/)) {
    let event = ''
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (!data) continue
    let parsed
    try { parsed = JSON.parse(data) } catch { continue }
    if (event === 'content_block_delta' || parsed.type === 'content_block_delta') {
      const delta = parsed.delta
      if (delta && typeof delta.thinking === 'string') thinking += delta.thinking
      if (delta && typeof delta.text === 'string') answer += delta.text
    }
  }
  return { thinking, answer }
}

// ── In-process mock upstream (emulates opencode-go /v1/messages) ────────────
function startMockUpstream() {
  const captured = []
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/messages') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end('{"error":"not found"}')
      return
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end('{"error":"bad json"}')
        return
      }
      captured.push(body)
      const assistantTurns = Array.isArray(body.messages)
        ? body.messages.filter((m) => m && m.role === 'assistant').length
        : 0

      if (assistantTurns === 0) {
        // Turn 1: stream thinking + text so the proxy's SSE path caches it.
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' })
        const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        const frames = [
          sse('message_start', { type: 'message_start', message: { id: 'msg_mock1', type: 'message', role: 'assistant', content: [], model: body.model || '', stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } }),
          sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
          sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: THINKING_PART1 } }),
          sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: THINKING_PART2 } }),
          sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
          sse('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
          sse('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'It is 22C and sunny in Paris.' } }),
          sse('content_block_stop', { type: 'content_block_stop', index: 1 }),
          sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 14 } }),
          sse('message_stop', { type: 'message_stop' }),
        ]
        res.write(frames.join(''))
        res.end()
      } else {
        // Follow-up turn: buffered JSON (we only care about the REQUEST body).
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'msg_mock2', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Mock final answer.' }], model: body.model || '' }))
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, captured }))
  })
}

// ── Free-port helper (for the proxy child) ───────────────────────────────────
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

// ── Proxy child process (proxy/proxy.js) ─────────────────────────────────────
function startProxy(upstreamUrl, port) {
  const proxyJs = join(__dirname, '..', 'proxy', 'proxy.js')
  const child = spawn(process.execPath, [proxyJs], {
    env: { ...process.env, PORT: String(port), UPSTREAM_URL: upstreamUrl, LOG_FILE: '', DEBUG: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  return child
}

async function waitForHealth(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) return await res.json()
    } catch { /* not up yet */ }
    await sleep(100)
  }
  throw new Error(`proxy on :${port} did not become healthy within ${timeoutMs}ms`)
}

async function waitForStored(port, min, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const h = await (await fetch(`http://127.0.0.1:${port}/health`)).json()
      if ((h.stored || 0) >= min) return h
    } catch { /* retry */ }
    await sleep(100)
  }
  throw new Error(`proxy did not cache reasoning (stored >= ${min}) within ${timeoutMs}ms`)
}

// ── Turn helpers ─────────────────────────────────────────────────────────────
async function postStream(proxyBase, apiKey, messages) {
  const res = await fetch(`${proxyBase}/v1/messages`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, stream: true, messages }),
  })
  const text = await res.text()
  return { status: res.status, ...parseThinkingFromSSE(text) }
}

async function postTurn2(proxyBase, apiKey, messages) {
  const res = await fetch(`${proxyBase}/v1/messages`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages }),
  })
  return { status: res.status, text: await res.text() }
}

function turn2Messages() {
  const toolUseId = 'toolu_01L7REPLAY'
  return [
    { role: 'user', content: 'What is the weather in Paris right now?' },
    { role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: 'get_weather', input: { city: 'Paris' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: '22C, sunny' }] },
    { role: 'user', content: 'Summarize the weather in one sentence.' },
  ]
}

// ── Assertions on the captured turn-2 request body ───────────────────────────
function assertUnshifted(captured, streamedThinking) {
  const turn2 = captured.find((b) => Array.isArray(b.messages) && b.messages.some((m) => m && m.role === 'assistant'))
  if (!turn2) throw new Error('mock never received a follow-up request with an assistant turn')
  const assistant = turn2.messages.find((m) => m && m.role === 'assistant')
  const content = assistant.content
  if (!Array.isArray(content)) throw new Error('assistant content is not an array')
  const first = content[0]
  if (!first || first.type !== 'thinking') throw new Error('content[0] is not a thinking block: ' + JSON.stringify(first))
  if (typeof first.thinking !== 'string' || first.thinking.length === 0) throw new Error('thinking text empty')
  if (first.thinking !== streamedThinking) throw new Error('unshifted thinking != streamed thinking')
  // The tool_use block must still be present (unshift, not replace).
  if (!content.some((b) => b && b.type === 'tool_use')) throw new Error('tool_use block dropped after unshift')
  return { content, first }
}

// ═════════════════════════════════════════════════════════════════════════════
async function runMock() {
  console.log('\n[L7] opencode-go MiniMax anthropic-wire replay (mock mode)')
  const apiKey = loadOpenCodeGoKey()
  console.log(`[L7] auth    : ${apiKey ? 'key loaded from auth.json (' + apiKey.length + ' chars)' : 'no key found (mock mode proceeds without one)'}`)

  const mock = await startMockUpstream()
  const proxyPort = await getFreePort()
  const proxy = startProxy(`http://127.0.0.1:${mock.port}`, proxyPort)
  const proxyBase = `http://127.0.0.1:${proxyPort}`

  try {
    await waitForHealth(proxyPort)
    console.log(`[L7] mock upstream : http://127.0.0.1:${mock.port}/v1/messages`)
    console.log(`[L7] proxy         : ${proxyBase} (UPSTREAM_URL -> mock)`)

    // ── Turn 1: streaming request → proxy caches streamed thinking ──
    console.log('\n[L7] turn 1: streaming /v1/messages (model=%s) ...', MODEL)
    const t1 = await postStream(proxyBase, apiKey, [{ role: 'user', content: 'What is the weather in Paris right now?' }])
    if (t1.status !== 200) throw new Error(`turn 1 HTTP ${t1.status}`)
    if (!t1.thinking) throw new Error('turn 1 stream yielded no thinking deltas')
    console.log(`[L7] turn 1: streamed thinking (${t1.thinking.length} chars): ${JSON.stringify(t1.thinking.slice(0, 48))}…`)
    console.log(`[L7] turn 1: visible answer: ${JSON.stringify(t1.answer)}`)

    await waitForStored(proxyPort, 1)
    console.log('[L7] proxy cached turn-0 reasoning (stored >= 1)')

    // ── Turn 2: tool-call turn lacking a thinking block ──
    console.log('\n[L7] turn 2: POSTing tool-call turn with NO thinking block ...')
    const t2 = await postTurn2(proxyBase, apiKey, turn2Messages())
    if (t2.status !== 200) throw new Error(`turn 2 HTTP ${t2.status}`)

    // Give the mock a beat to flush its captured body, then assert.
    await sleep(50)
    const { content, first } = assertUnshifted(mock.captured, t1.thinking)
    console.log(`[L7] unshift evidence: content[0] = ${JSON.stringify(first).slice(0, 80)}…`)
    console.log(`[L7] unshift evidence: content has ${content.length} block(s); tool_use preserved = true`)
    console.log(`[L7] verified thinking length: ${first.thinking.length} chars (matches turn-1 stream)`)

    console.log('\n' + '='.repeat(60))
    console.log('[L7] VERDICT: PASS — proxy unshifted cached anthropic thinking into content[]')
    console.log('='.repeat(60))
    return 0
  } finally {
    proxy.kill('SIGTERM')
    mock.server.close()
  }
}

// ═════════════════════════════════════════════════════════════════════════════
async function runLive() {
  const proxyBase = (process.env.PROXY_URL || 'http://127.0.0.1:3458').replace(/\/+$/, '')
  console.log(`\n[L7] opencode-go MiniMax anthropic-wire replay (LIVE mode)`)
  console.log(`[L7] target : ${proxyBase}/v1/messages`)
  const apiKey = loadOpenCodeGoKey()
  if (!apiKey) {
    console.log('\nSKIP: opencode-go key not found in auth.json. Set OPENCODE_AUTH_PATH or add the key.')
    return 2
  }
  console.log(`[L7] auth   : key loaded (${apiKey.length} chars)`)

  let t1
  try {
    t1 = await postStream(proxyBase, apiKey, [{ role: 'user', content: 'What is the weather in Paris right now?' }])
  } catch (err) {
    console.log(`\nSKIP: could not reach proxy: ${err.message}`)
    return 2
  }
  if (t1.status !== 200) {
    console.log(`\nSKIP: turn 1 HTTP ${t1.status} — cannot capture reasoning to replay.`)
    return 2
  }
  if (!t1.thinking) {
    console.log('\nSKIP: turn 1 streamed no thinking — nothing to replay (model may not emit thinking).')
    return 2
  }
  console.log(`[L7] turn 1: streamed thinking (${t1.thinking.length} chars)`)

  const t2 = await postTurn2(proxyBase, apiKey, turn2Messages())
  console.log(`[L7] turn 2: HTTP ${t2.status}`)
  if (t2.status >= 200 && t2.status < 300) {
    console.log('\n' + '='.repeat(60))
    console.log('[L7] VERDICT: PASS — turn 2 accepted by live upstream (replayed thinking did not 400).')
    console.log('[L7] NOTE: live mode cannot capture the forwarded body; use mock mode for unshift proof.')
    console.log('='.repeat(60))
    return 0
  }
  console.log('\n' + '='.repeat(60))
  console.log(`[L7] VERDICT: FAIL — turn 2 HTTP ${t2.status}`)
  console.log('='.repeat(60))
  return 1
}

// ── entrypoint ────────────────────────────────────────────────────────────────
const mode = LIVE ? runLive : runMock
mode()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('\n[L7] FAIL:', err && err.message ? err.message : err)
    process.exit(1)
  })
