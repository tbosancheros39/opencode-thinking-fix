import type { Plugin } from '@opencode-ai/plugin'
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
// Plugin
// ─────────────────────────────────────────────────────────────────────────────
export const ThinkingFixPlugin: Plugin = async ({ client }) => {
  mkdirSync(LOG_DIR, { recursive: true })

  writeLog({ event: 'plugin_loaded', logFile: LOG_FILE })

  await client.app.log({ body: { service: 'thinking-fix', level: 'info', message: `Plugin loaded, logging to ${LOG_FILE}` } })

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

        // Self-detect: if any assistant turn has reasoning_content → reasoning model
        const hasReasoning = messages.some((w: any) => {
          const m = w?.info ?? w
          return m?.role === 'assistant' && ('reasoning_content' in m || 'reasoning' in m)
        })

        if (!hasReasoning) {
          writeLog({ event: 'inspect', isReasoningModel: false, totalMessages: messages.length })
          return
        }

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

        writeLog({ event: 'inspect', isReasoningModel: true, totalMessages: messages.length, patchedFields: patched, turns })

        if (patched > 0) {
          await client.app.log({ body: { service: 'thinking-fix', level: 'info', message: `patched ${patched} field(s) across ${messages.length} message(s)` } })
        }
      } catch (err: any) {
        writeLog({ event: 'error', message: err?.message ?? String(err) })
        await client.app.log({ body: { service: 'thinking-fix', level: 'error', message: `Error, passing through unmodified: ${err?.message ?? err}` } })
      }
    },
  }
}


