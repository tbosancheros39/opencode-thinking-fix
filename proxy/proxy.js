'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// OpenCode Reasoning Cache Proxy  —  v3.1 (performance + correctness + dialect)
//
// What it does:
//   - Sits between OpenCode and DeepSeek/Kimi/GLM/MiMo/MiniMax on localhost:3457
//   - On every response: extracts the REAL reasoning_content from the stream and
//     stores it in memory, keyed by sessionID + the assistant turn index.
//   - On every request: replays the cached real reasoning_content into the
//     assistant history turns instead of empty strings.
//
// Performance model (v3):
//   1. Responses are forwarded as RAW BYTES — no SSE re-serialization. The
//      stream is parsed in parallel ONLY to populate the cache. This removes the
//      per-chunk serialization bottleneck that added latency to every token.
//   2. Request patching is LAZY: if OpenCode already round-trips reasoning
//      (non-empty reasoning_content/reasoning on assistant turns), the body is
//      forwarded untouched — zero JSON work. Patching only runs when a turn is
//      actually missing its reasoning.
//   3. Upstream connections are kept alive (TLS/handshake reuse) via an agent.
//   4. gzip is disabled on the upstream leg so bytes pass through verbatim.
//
// Correctness fix (v3):
//   The cache index for a response is the number of assistant messages already
//   present in the request that produced it. This aligns the stored reasoning
//   with the slot patchRequestBody() looks up on the NEXT request, so every
//   turn replays its OWN reasoning (not turn 0's).
//
// Dialect fix (v3.1):
//   Each route declares which reasoning field its upstream requires
//   (reasoning_content vs reasoning_details vs null). Patching now echoes ONLY
//   that field — no more cross-provider poisoning (GLM stored under `reasoning`
//   used to 400 against DeepSeek which expects `reasoning_content`).
//   deepseek-reasoner (R1) is null: it must NOT receive reasoning echoed back.
//   Unknown models default to null (never fabricate reasoning).
//
// Deployment:
//   node proxy.js
//   PORT=3457  (universal model-routing proxy)
//   PORT=3458 UPSTREAM_URL=https://opencode.ai/zen/go/v1  (OpenCode Go proxy)
//   In opencode.json: set baseURL to http://127.0.0.1:<PORT>/v1
//
// Optional env:
//   DEBUG=1            verbose cache logging
//   CACHE_CAPACITY=500 max sessions
//   UPSTREAM_TIMEOUT=30000  ms request timeout
// ─────────────────────────────────────────────────────────────────────────────

import http  from 'node:http'
import https from 'node:https'
import url   from 'node:url'
import {
  ROUTES, cache, stats, route, fixedUpstreamRoute, getSessionCache, patchRequestBody,
  extractReasoningFromJson, createStreamParser, writeLog, deriveSessionId,
} from './core.js'

const PORT            = parseInt(process.env.PORT || '3457', 10)
const DEBUG           = process.env.DEBUG === '1'
const UPSTREAM_TIMEOUT = parseInt(process.env.UPSTREAM_TIMEOUT || '30000', 10)

// Fixed-upstream mode (OpenCode Go): every request goes to one endpoint.
const UPSTREAM_URL = process.env.UPSTREAM_URL || ''

// ── Keep-alive agents (connection reuse → lower latency) ───────────────────
const httpAgent  = new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 32 })
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 32 })

// ── Main proxy handler ─────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.on('error', (err) => { if (DEBUG) console.error('[Proxy] client response error:', err.message) })
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      uptime: Math.floor(process.uptime()),
      sessions: stats.sessions,
      cacheHits: stats.hits,
      cacheMisses: stats.misses,
      stored: stats.stored,
      requests: stats.requests,
      passthrough: stats.passthrough,
    }))
    return
  }

  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    stats.requests++
    const rawBody = Buffer.concat(chunks)
    const rawSessionId = req.headers['x-session-id']
    const isPost = req.method === 'POST'
    const isJson = (req.headers['content-type'] || '').includes('application/json')
    let parsedBody = null
    if (isPost && isJson && rawBody.length > 0) {
      try { parsedBody = JSON.parse(rawBody.toString('utf8')) } catch { /* ignore */ }
    }

    // Resolve model + route (model parsed even in fixed-upstream mode)
    const modelName = parsedBody?.model || ''
    const routeTarget = UPSTREAM_URL
      ? { ...fixedUpstreamRoute(modelName, req.url), base: UPSTREAM_URL }
      : route(modelName)
    const upstream = url.parse(routeTarget.base)
    let sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : ''
    if ((!sessionId || sessionId === 'unknown') && isPost && isJson && parsedBody) {
      sessionId = deriveSessionId(modelName, parsedBody, req.headers['authorization']) || 'unknown'
    }
    const shouldPatch = isPost && isJson && !!routeTarget.reasoningKey && !!sessionId && sessionId !== 'unknown'

    if (!shouldPatch) {
      const reason = !isPost ? 'get'
        : !isJson ? 'non_json'
          : !sessionId ? 'no_session'
            : sessionId === 'unknown' ? 'unknown_session'
              : !modelName ? 'unknown_route'
                : !routeTarget.reasoningKey ? 'model_not_patched'
                  : 'unknown_route'
      writeLog({ event: 'passthrough', model: modelName, session: sessionId.slice(-8) || 'none', reason })
    }

    // ── Build outgoing request body ──
    let bodyToSend = rawBody
    let assistantCount = 0
    let patchReport = null
    if (shouldPatch && rawBody.length > 0 && parsedBody) {
      try {
        const bj = parsedBody

        // Kimi/Moonshot hardcode sampling params for thinking models.
        const lower = modelName.toLowerCase()
        const isKimi = lower.startsWith('kimi') || lower.startsWith('moonshot')
        if (isKimi) {
          for (const k of ['temperature', 'top_p', 'top_k', 'presence_penalty', 'frequency_penalty', 'n']) delete bj[k]
          if (lower.startsWith('kimi-k2.7')) { delete bj.thinking; delete bj.reasoning_effort }
        }
        // MiniMax: keep thinking separate from content.
        if (lower.startsWith('minimax')) bj.reasoning_split = true

        const patched = patchRequestBody(JSON.stringify(bj), sessionId, routeTarget.reasoningKey)
        bodyToSend = Buffer.from(patched.body, 'utf8')
        assistantCount = patched.assistantCount
        patchReport = patched.report
        if (!patched.modified) stats.passthrough++
        if (patchReport.assistantTurns > 0) {
          writeLog({ event: 'inspect', model: modelName, session: sessionId.slice(-8), endpoint: req.url,
            totalMessages: bj.messages.length, assistantTurns: patchReport.assistantTurns,
            missingText: patchReport.missingText, missingReasoning: patchReport.missingReasoning })
        }
        if (patched.modified) {
          writeLog({ event: 'patched', model: modelName, session: sessionId.slice(-8),
            patchedFields: patchReport.turns.reduce((sum, turn) => sum + turn.fields.length, 0),
            turns: patchReport.turns })
        }
      } catch { /* forward as-is */ }
    }

    // ── Upstream request options ──
    let upstreamPath = req.url
    const basePath = upstream.path || '/'
    if (basePath !== '/' && basePath !== '/v1') {
      upstreamPath = basePath + req.url.replace(/^\/v1/, '')
    }
    const transport = upstream.protocol === 'https:' ? https : http
    const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-'])
    const safeHeaders = {}
    for (const [key, value] of Object.entries(req.headers)) {
      const lowerKey = key.toLowerCase()
      if (HOP_BY_HOP.has(lowerKey) || lowerKey.startsWith('proxy-')) continue
      safeHeaders[key] = value
    }
    const proxyReq = transport.request({
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
      path: upstreamPath,
      method: req.method,
      agent: upstream.protocol === 'https:' ? httpsAgent : httpAgent,
      headers: {
        ...safeHeaders,
        host: upstream.hostname,
        'content-length': bodyToSend.length,
        'accept-encoding': 'identity', // force uncompressed so we can stream raw
      },
    })

    let responseClosed = false
    const closeResponse = () => {
      if (responseClosed) return
      responseClosed = true
      if (!res.destroyed) res.destroy()
    }
    const endError = (status, payload) => {
      if (responseClosed) return
      writeLog({ event: 'error', message: payload?.error || 'proxy error' })
      responseClosed = true
      if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      } else if (!res.destroyed) {
        res.destroy()
      }
    }

    proxyReq.setTimeout(UPSTREAM_TIMEOUT, () => {
      endError(504, { error: 'upstream timeout' })
      proxyReq.destroy()
    })

    proxyReq.on('error', (err) => {
      if (DEBUG) console.error('[Proxy] upstream error:', err.message)
      writeLog({ event: 'error', message: err.message })
      endError(502, { error: 'upstream error', detail: err.message })
    })

    proxyReq.on('response', (proxyRes) => {
      const isStream = (proxyRes.headers['content-type'] || '').includes('text/event-stream')
      const isOk = (proxyRes.statusCode || 500) < 400
      const isCompressed = !!proxyRes.headers['content-encoding']

      // Forward response headers unchanged; client must decode compressed bytes.
      const outHeaders = { ...proxyRes.headers }
      res.writeHead(proxyRes.statusCode, outHeaders)

      // Buffer ordinary JSON responses so reasoning can be cached too.
      if (shouldPatch && !isStream && isOk && !isCompressed) {
        const responseChunks = []
        proxyRes.on('data', (chunk) => responseChunks.push(chunk))
        proxyRes.on('end', () => {
          if (responseClosed) return
          const responseBody = Buffer.concat(responseChunks)
          const reasoning = extractReasoningFromJson(responseBody.toString('utf8'))
          if (reasoning) {
            getSessionCache(sessionId).set(assistantCount, reasoning)
            stats.stored++
            writeLog({ event: 'cache_store', session: sessionId.slice(-8), turn: assistantCount, chars: reasoning.length })
          }
          responseClosed = true
          res.end(responseBody)
        })
        proxyRes.on('error', closeResponse)
        proxyRes.on('aborted', closeResponse)
        return
      }

      if (!shouldPatch || !isStream || !isOk || isCompressed) {
        proxyRes.pipe(res)
        proxyRes.on('error', closeResponse)
        proxyRes.on('aborted', closeResponse)
        return
      }

      // Reasoning stream: forward RAW bytes immediately, parse only for cache.
      const parser = createStreamParser(sessionId, assistantCount, (index, reasoning) => {
        const sc = getSessionCache(sessionId)
        sc.set(index, reasoning)
        stats.stored++
        writeLog({ event: 'cache_store', session: sessionId.slice(-8), turn: index, chars: reasoning.length })
        if (DEBUG) console.log(`[Cache] ${sessionId.slice(-8)}: stored turn ${index} (${reasoning.length} chars)`)
      })

      let parserDead = false
      proxyRes.on('data', (chunk) => {
        if (responseClosed) return
        res.write(chunk)        // raw forward — zero re-serialization
        if (!parserDead) {
          try { parser.feed(chunk) } catch { parserDead = true }
        }
      })
      proxyRes.on('end', () => {
        if (responseClosed) return
        parser.flush(); responseClosed = true; res.end()
      })
      proxyRes.on('error', closeResponse)
      proxyRes.on('aborted', closeResponse)
    })

    proxyReq.write(bodyToSend)
    proxyReq.end()
  })

  req.on('error', (err) => { if (DEBUG) console.error('[Proxy] request error:', err.message) })
})

server.listen(PORT, '127.0.0.1', () => {
  writeLog({ event: 'proxy_started', port: PORT, version: '3.1.4', upstream: UPSTREAM_URL || 'model-routing', pid: process.pid })
  if (UPSTREAM_URL) {
    console.log(`[Proxy] fixed-upstream proxy on http://127.0.0.1:${PORT} -> ${UPSTREAM_URL}`)
  } else {
    console.log(`[Proxy] universal model-routing proxy on http://127.0.0.1:${PORT}`)
    console.log(`[Proxy] ${Object.keys(ROUTES).length} model prefixes loaded`)
  }
  console.log(`[Proxy] in opencode.json set baseURL to http://127.0.0.1:${PORT}/v1`)
})

server.on('error', (err) => { console.error('[Proxy] server error:', err.message); process.exit(1) })

// ── Graceful shutdown ──────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`[Proxy] received ${signal}, shutting down gracefully...`)
  let totalEntries = 0
  for (const [, sessionMap] of cache.cache) totalEntries += sessionMap.size
  console.log(`[Proxy] ${cache.cache.size} session(s), ${totalEntries} cached turn(s)`)
  server.close(() => { console.log('[Proxy] server closed'); process.exit(0) })
  setTimeout(() => { console.error('[Proxy] forced exit after timeout'); process.exit(1) }, 5000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
