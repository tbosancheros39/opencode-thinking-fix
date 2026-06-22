'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// OpenCode Reasoning Cache Proxy
//
// What it does:
//   - Sits between OpenCode and DeepSeek/Kimi/GLM/MiMo on localhost:3457
//   - On every response: extracts real reasoning_content from the stream
//     and stores it in memory, keyed by sessionID + message index
//   - On every request: replays the cached real reasoning_content into
//     assistant history turns instead of empty strings
//
// What it does NOT do:
//   - Touch non-reasoning providers (Qwen/GPT/Claude pass through untouched)
//   - Persist cache to disk (in-memory only, resets on restart)
//   - Add any dashboard, UI, or monitoring endpoints
//
// Deployment:
//   node proxy.js
//   Set UPSTREAM_URL env to change target (default: https://api.deepseek.com)
//   Set PORT env to change listen port (default: 3457)
//   In opencode.json: set baseURL to http://127.0.0.1:3457/v1
// ─────────────────────────────────────────────────────────────────────────────

const http  = require('http')
const https = require('https')
const url   = require('url')

const PORT = parseInt(process.env.PORT || '3457', 10)

// Optional fixed upstream override. When set, ALL requests are routed here
// instead of using the model-based routing table. Used for OpenCode Go:
//   UPSTREAM_URL=https://opencode.ai/zen/go/v1 PORT=3458 node proxy.js
const UPSTREAM_URL = process.env.UPSTREAM_URL || ''

// ── Model routing table ────────────────────────────────────────────────────
// Each entry: { base: upstream API base URL, reasoning: does this model emit reasoning_content? }
// Prefix-based matching: "deepseek-v4-pro" matches the "deepseek" prefix
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

// Default: fall back to DeepSeek for unknown models
const DEFAULT_ROUTE = { base: 'https://api.deepseek.com', reasoning: false }

function route(modelName) {
  if (!modelName) return DEFAULT_ROUTE
  const lower = modelName.toLowerCase()
  for (const [prefix, entry] of Object.entries(ROUTES)) {
    if (lower.startsWith(prefix)) return entry
  }
  return DEFAULT_ROUTE
}

// ── In-memory reasoning cache ─────────────────────────────────────────────
// Structure: Map<sessionID, Map<assistantIndex, reasoning_content_string>>
// sessionID comes from x-session-id header forwarded by OpenCode
// assistantIndex is the position of the assistant message in the history array
const cache = new Map()

function getSessionCache(sessionId) {
  if (!cache.has(sessionId)) cache.set(sessionId, new Map())
  return cache.get(sessionId)
}

// ── Request body patching ─────────────────────────────────────────────────
// Injects cached real reasoning_content into assistant history turns
// Falls back to "" if no cache exists for that turn yet
function patchRequestBody(body, sessionId) {
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    return body // not JSON, forward as-is
  }

  if (!Array.isArray(parsed.messages)) return body

  const sessionCache = getSessionCache(sessionId)
  let assistantIndex = 0
  let modified = false

  for (const msg of parsed.messages) {
    if (msg.role !== 'assistant') continue

    // Fix content if missing
    if (!msg.content && msg.content !== '') {
      msg.content = msg.tool_calls?.length ? 'call tool' : ''
      modified = true
    }

    // Inject real cached reasoning if available, otherwise ""
    // Check VALUE (not key existence) — plugin sets "" so key always exists
    if (!msg.reasoning_content) {
      const cached = sessionCache.get(assistantIndex)
      msg.reasoning_content = cached ?? ''
      if (cached) {
        console.log(`[Cache] session ${sessionId.slice(-8)}: replayed reasoning_content for turn ${assistantIndex} (${cached.length} chars)`)
      }
      modified = true
    }

    // OpenCode Go uses reasoning instead of reasoning_content
    if (!msg.reasoning) {
      const cached = sessionCache.get(assistantIndex)
      msg.reasoning = cached ?? ''
      if (cached) {
        console.log(`[Cache] session ${sessionId.slice(-8)}: replayed reasoning for turn ${assistantIndex} (${cached.length} chars)`)
      }
      modified = true
    }

    assistantIndex++
  }

  return modified ? JSON.stringify(parsed) : body
}

// ── SSE stream parser ─────────────────────────────────────────────────────
// Parses streaming response chunks to extract reasoning_content
// Accumulates across chunks since a single reasoning block can span many
function createStreamParser(sessionId, onComplete) {
  let buffer = ''
  let reasoningBuffer = ''
  let assistantIndex = 0  // tracks which assistant turn we're building
  let inReasoning = false

  return {
    feed(chunk) {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') {
          // Flush accumulated reasoning for this turn
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

          // reasoning_content delta (DeepSeek/Kimi/GLM native)
          if (typeof delta.reasoning_content === 'string') {
            reasoningBuffer += delta.reasoning_content
            inReasoning = true
          }

          // OpenCode Go uses delta.reasoning instead of reasoning_content
          if (typeof delta.reasoning === 'string') {
            reasoningBuffer += delta.reasoning
            inReasoning = true
          }

          // When content starts after reasoning, the reasoning block is done
          if (typeof delta.content === 'string' && delta.content && inReasoning) {
            if (reasoningBuffer) {
              onComplete(assistantIndex, reasoningBuffer)
              reasoningBuffer = ''
              inReasoning = false
            }
          }

          // finish_reason means the assistant turn is complete
          if (parsed.choices?.[0]?.finish_reason) {
            if (reasoningBuffer) {
              onComplete(assistantIndex, reasoningBuffer)
              reasoningBuffer = ''
              inReasoning = false
            }
            assistantIndex++
          }
        } catch {
          // malformed SSE chunk, skip
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

// ── Main proxy handler ────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // Health check — plugin uses this to detect running proxy
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, uptime: Math.floor(process.uptime()) }))
    return
  }

  // Collect request body
  const chunks = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks)
    const sessionId = req.headers['x-session-id'] || 'unknown'
    const isPost = req.method === 'POST'
    const isJson = (req.headers['content-type'] || '').includes('application/json')

    // Determine upstream route
    let modelName = ''
    let routeTarget = DEFAULT_ROUTE
    if (UPSTREAM_URL) {
      // Fixed upstream mode (e.g. OpenCode Go)
      routeTarget = { base: UPSTREAM_URL, reasoning: true }
    } else if (isPost && isJson && rawBody.length > 0) {
      // Model-based routing mode
      try {
        const bodyJson = JSON.parse(rawBody.toString('utf8'))
        modelName = bodyJson.model || ''
        routeTarget = route(modelName)
      } catch { /* body not JSON yet, use defaults */ }
    }
    const upstream = url.parse(routeTarget.base)
    const shouldPatch = isPost && isJson && routeTarget.reasoning

    // Patch request body if this is a reasoning provider
    let bodyToSend = rawBody
    if (shouldPatch && rawBody.length > 0) {
      const patched = patchRequestBody(rawBody.toString('utf8'), sessionId)
      bodyToSend = Buffer.from(patched, 'utf8')
    }

    // Build upstream request options
    // If base URL has a path prefix (e.g. /api/paas/v4), prepend it to req.url
    let upstreamPath = req.url
    const basePath = upstream.path || '/'
    if (basePath !== '/' && basePath !== '/v1') {
      upstreamPath = basePath + req.url.replace(/^\/v1/, '')
    }
    const upstreamOptions = {
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
      path: upstreamPath,
      method: req.method,
      headers: {
        ...req.headers,
        host: upstream.hostname,
        'content-length': bodyToSend.length,
      },
    }

    // Use http or https depending on upstream
    const transport = upstream.protocol === 'https:' ? https : http

    const proxyReq = transport.request(upstreamOptions, (proxyRes) => {
      // Forward response headers
      res.writeHead(proxyRes.statusCode, proxyRes.headers)

      const isStream = (proxyRes.headers['content-type'] || '').includes('text/event-stream')
      const isOk = (proxyRes.statusCode || 500) < 400

      if (shouldPatch && isStream && isOk) {
        // Parse SSE stream to extract and cache reasoning_content
        const parser = createStreamParser(sessionId, (index, reasoning) => {
          const sc = getSessionCache(sessionId)
          sc.set(index, reasoning)
          console.log(`[Cache] session ${sessionId.slice(-8)}: stored reasoning turn ${index} (${reasoning.length} chars)`)
        })

        proxyRes.on('data', chunk => {
          parser.feed(chunk)
          res.write(chunk) // forward chunk immediately (no buffering)
        })

        proxyRes.on('end', () => {
          parser.flush()
          res.end()
        })
      } else {
        // Non-streaming or non-reasoning: pipe directly
        proxyRes.pipe(res)
      }
    })

    proxyReq.on('error', (err) => {
      console.error('[Proxy] upstream error:', err.message)
      if (!res.headersSent) {
        res.writeHead(502)
        res.end(JSON.stringify({ error: 'upstream error', detail: err.message }))
      }
    })

    proxyReq.write(bodyToSend)
    proxyReq.end()
  })

  req.on('error', (err) => {
    console.error('[Proxy] request error:', err.message)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  if (UPSTREAM_URL) {
    console.log(`[Proxy] fixed-upstream proxy on http://127.0.0.1:${PORT}`)
    console.log(`[Proxy] upstream: ${UPSTREAM_URL}`)
  } else {
    console.log(`[Proxy] universal model-routing proxy on http://127.0.0.1:${PORT}`)
    console.log(`[Proxy] ${Object.keys(ROUTES).length} model prefixes loaded`)
  }
  console.log(`[Proxy] in opencode.json set baseURL to http://127.0.0.1:${PORT}/v1`)
})

server.on('error', (err) => {
  console.error('[Proxy] server error:', err.message)
  process.exit(1)
})
