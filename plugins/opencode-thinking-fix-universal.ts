import { Plugin } from '@opencode/plugin'
import { appendFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// LOGGING
//   File: ~/.local/share/opencode/thinking-fix.log
//   Format: JSON lines, one entry per event
//   View:  tail -f ~/.local/share/opencode/thinking-fix.log | jq
// ─────────────────────────────────────────────────────────────────────────────

const LOG_DIR  = join(homedir(), '.local', 'share', 'opencode')
const LOG_FILE = join(LOG_DIR, 'thinking-fix.log')

function writeLog(entry: Record<string, unknown>): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8')
  } catch (err: any) {
    try { console.error('[thinking-fix] log write failed:', err?.message) } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// V1 message patching (OpenCode 1.x)
//   Assistant turns must carry reasoning_content / reasoning so providers that
//   require the passback do not reject the next request.
// ─────────────────────────────────────────────────────────────────────────────

function patchV1Messages(messages: any[]): { patched: number; reasoningModel: boolean; turns: Array<{ index: number; fields: string[] }> } {
  // Self-detect: if any assistant turn has reasoning_content → reasoning model
  const reasoningModel = messages.some((wrapper: any) => {
    const msg = wrapper?.info ?? wrapper
    return msg?.role === 'assistant' && ('reasoning_content' in msg || 'reasoning' in msg)
  })

  if (!reasoningModel) return { patched: 0, reasoningModel: false, turns: [] }

  let patched = 0
  const turns: Array<{ index: number; fields: string[] }> = []

  messages.forEach((wrapper: any, index: number) => {
    const msg = wrapper?.info ?? wrapper
    if (!msg || msg.role !== 'assistant') return
    const fields: string[] = []

    if (!msg.content && msg.content !== '') {
      msg.content = msg.tool_calls?.length ? 'call tool' : ''
      fields.push('content')
    }
    if (!('reasoning_content' in msg)) { msg.reasoning_content = ''; fields.push('reasoning_content') }
    if (!('reasoning' in msg)) { msg.reasoning = ''; fields.push('reasoning') }

    if (fields.length > 0) {
      patched += fields.length
      turns.push({ index, fields })
    }
  })

  return { patched, reasoningModel: true, turns }
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 message patching (OpenCode 2.x)
//   V2 normalizes assistant turns into `content` parts, so the passback field
//   is carried on `native.openaiCompatible.reasoning_content`. The OpenAI Chat
//   protocol reads it when it builds the outbound body.
// ─────────────────────────────────────────────────────────────────────────────

function patchV2Messages(messages: any[]): { patched: number; reasoningModel: boolean } {
  const reasoningModel = messages.some((msg: any) => {
    if (!msg || msg.role !== 'assistant') return false
    if (Array.isArray(msg.content) && msg.content.some((part: any) => part?.type === 'reasoning')) return true
    const native = msg.native?.openaiCompatible
    return !!native && (typeof native.reasoning_content === 'string' || typeof native.reasoning === 'string')
  })

  if (!reasoningModel) return { patched: 0, reasoningModel: false }

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

  return { patched, reasoningModel: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// V1 plugin (OpenCode 1.x)
// ─────────────────────────────────────────────────────────────────────────────

type V1Input = {
  client?: {
    app?: {
      log?: (args: { body: { service: string; level: string; message: string } }) => Promise<unknown>
    }
  }
}

type V1Hooks = Record<string, (input: any, output: any) => Promise<void>>

const ThinkingFixPluginV1 = async (input: V1Input = {}): Promise<V1Hooks> => {
  const { client } = input
  mkdirSync(LOG_DIR, { recursive: true })

  writeLog({ event: 'plugin_loaded', runtime: 'v1', logFile: LOG_FILE })

  await client?.app?.log?.({ body: { service: 'thinking-fix', level: 'info', message: `Plugin loaded, logging to ${LOG_FILE}` } })

  return {
    'chat.headers': async (input: any, output: any) => {
      if (input.sessionID && !output.headers['x-session-id']) {
        output.headers['x-session-id'] = input.sessionID
      }
    },

    'experimental.chat.messages.transform': async (_input: any, output: any) => {
      try {
        const messages = output?.messages
        if (!Array.isArray(messages) || messages.length === 0) return

        const result = patchV1Messages(messages)

        writeLog({
          event: 'inspect',
          runtime: 'v1',
          isReasoningModel: result.reasoningModel,
          totalMessages: messages.length,
          patchedFields: result.patched,
          turns: result.turns,
        })

        if (result.patched > 0) {
          await client?.app?.log?.({
            body: {
              service: 'thinking-fix',
              level: 'info',
              message: `patched ${result.patched} field(s) across ${messages.length} message(s)`,
            },
          })
        }
      } catch (err: any) {
        writeLog({ event: 'error', runtime: 'v1', message: err?.message ?? String(err) })
        await client?.app?.log?.({
          body: {
            service: 'thinking-fix',
            level: 'error',
            message: `Error, passing through unmodified: ${err?.message ?? err}`,
          },
        })
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 plugin (OpenCode 2.x)
//   chat.headers            → ctx.session.hook('model.request', ...)
//   chat.messages.transform → ctx.session.hook('context', ...)
// ─────────────────────────────────────────────────────────────────────────────

const ThinkingFixPluginV2 = Plugin.define({
  id: 'opencode-thinking-fix',
  async setup(ctx) {
    mkdirSync(LOG_DIR, { recursive: true })
    writeLog({ event: 'plugin_loaded', runtime: 'v2', directory: ctx.location.directory, logFile: LOG_FILE })

    await ctx.session.hook('model.request', (event) => {
      if (event.sessionID && !event.headers['x-session-id']) {
        event.headers['x-session-id'] = event.sessionID
      }
    })

    const inspect = (messages: any[]) => {
      try {
        if (!Array.isArray(messages) || messages.length === 0) return

        const result = patchV2Messages(messages)

        writeLog({
          event: 'inspect',
          runtime: 'v2',
          isReasoningModel: result.reasoningModel,
          totalMessages: messages.length,
          patchedFields: result.patched,
        })
      } catch (err: any) {
        writeLog({ event: 'error', runtime: 'v2', message: err?.message ?? String(err) })
      }
    }

    // `context` covers the agent loop; `compaction` covers checkpoint summaries.
    await ctx.session.hook('context', (event) => inspect(event.messages as any[]))
    await ctx.session.hook('compaction', (event) => inspect(event.messages as any[]))
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// Entrypoint
//   V2 reads the default export's id/setup. V1 (>=1.18.29) reads server().
//   Keeping one default object avoids loading the plugin twice on V1.
// ─────────────────────────────────────────────────────────────────────────────

export default {
  ...ThinkingFixPluginV2,
  async server(input: V1Input) {
    return ThinkingFixPluginV1(input)
  },
}
