import type { Plugin } from '@opencode-ai/plugin'
import { appendFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// ─────────────────────────────────────────────────────────────────────────────
// CONFIRMED FACTS (cross-validated across DeepSeek V4 Pro, Claude MAX, Kimi
// via live subagent research on OpenCode v1.17.9):
//
// 1. experimental.chat.messages.transform receives input: {} (always empty)
//    input.model is NEVER available — confirmed by GitHub issue #25494
//    Do NOT use input.model for provider detection — it is always undefined
//
// 2. Detection strategy: scan output.messages for any assistant turn that
//    already HAS reasoning_content (set by OpenCode on the last response turn)
//    If found → reasoning model (DeepSeek/Kimi/GLM/MiMo) → patch ALL turns
//    If none → non-reasoning model (Qwen/GPT/Claude/Mistral) → pass through
//    Zero false positives: non-reasoning models never produce reasoning_content
//
// 3. In-place mutation only — reassigning output.messages is a silent no-op
//    Confirmed by GitHub issue #25754
//
// 4. Message wrapper shape: { info: Message, parts: Part[] } or bare Message
//    Handle both via: wrapper?.info ?? wrapper
//
// DEPLOYMENT:
//   Path: ~/.config/opencode/plugins/opencode-thinking-fix-universal.ts
//         (plural "plugins/" — auto-discovery, zero config needed)
//   Config: no opencode.json entry required for auto-discovery
//           OR: "plugin": ["opencode-thinking-fix-universal"] (array, not object)
//   Build: none — OpenCode compiles .ts plugins at load time
// ─────────────────────────────────────────────────────────────────────────────
// LOGGING
//   File: ~/.local/share/opencode/thinking-fix.log
//   Format: JSON lines — one entry per event
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
// Message patching — self-detection, in-place mutation
// ─────────────────────────────────────────────────────────────────────────────
interface PatchResult {
  patched:       number
  totalMessages: number
  turns:         Array<{ index: number; fields: string[] }>
}

function patchMessages(messages: any[]): PatchResult {
  const result: PatchResult = { patched: 0, totalMessages: messages.length, turns: [] }

  // ── Step 1: Self-detect reasoning model ──────────────────────────────────
  const isReasoningModel = messages.some((wrapper) => {
    const msg = wrapper?.info ?? wrapper
    return msg?.role === 'assistant' && ('reasoning_content' in msg || 'reasoning' in msg)
  })

  // ── Step 2: Non-reasoning model — exit immediately, zero modification ─────
  if (!isReasoningModel) return result

  // ── Step 3: Patch all assistant turns missing required fields ─────────────
  messages.forEach((wrapper, index) => {
    const msg = wrapper?.info ?? wrapper
    if (!msg || msg.role !== 'assistant') return

    const fields: string[] = []

    // Fix 1: content must be non-null string on every assistant turn
    if (!msg.content && msg.content !== '') {
      msg.content = msg.tool_calls?.length ? 'call tool' : ''
      fields.push('content')
    }

    // Fix 2: reasoning_content — absent causes HTTP 400 from DeepSeek/Kimi/GLM/MiMo on turn 2+
    if (!('reasoning_content' in msg)) {
      msg.reasoning_content = ''
      fields.push('reasoning_content')
    }

    // Fix 3: reasoning — required for OpenCode Go provider on every turn
    if (!('reasoning' in msg)) {
      msg.reasoning = ''
      fields.push('reasoning')
    }

    if (fields.length > 0) {
      result.patched += fields.length
      result.turns.push({ index, fields })
    }
  })

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────
export const ThinkingFixPlugin: Plugin = async ({ client }) => {
  mkdirSync(LOG_DIR, { recursive: true })

  writeLog({ event: 'plugin_loaded', logFile: LOG_FILE })

  await client.app.log({ body: { service: 'thinking-fix', level: 'info', message: `Plugin loaded — logging to ${LOG_FILE}` } })

  return {
    'chat.headers': async (input: any, output: any) => {
      if (input.sessionID && !output.headers['x-session-id']) {
        output.headers['x-session-id'] = input.sessionID
      }
    },

    'experimental.chat.messages.transform': async (_input: {}, output: any) => {
      try {
        const messages = output?.messages
        if (!Array.isArray(messages) || messages.length === 0) return

        const assistantTurns = messages.filter((w: any) => {
          const m = w?.info ?? w
          return m?.role === 'assistant'
        })
        const isReasoningModel = assistantTurns.some((w: any) => {
          const m = w?.info ?? w
          return 'reasoning_content' in m || 'reasoning' in m
        })
        writeLog({
          event:                  'inspect',
          isReasoningModel,
          totalMessages:          messages.length,
          assistantTurns:         assistantTurns.length,
          missingContent:         assistantTurns.filter((w: any) => {
            const m = w?.info ?? w
            return !m.content && m.content !== ''
          }).length,
          missingReasoningContent: assistantTurns.filter((w: any) => {
            const m = w?.info ?? w
            return !('reasoning_content' in m)
          }).length,
          missingReasoning:        assistantTurns.filter((w: any) => {
            const m = w?.info ?? w
            return !('reasoning' in m)
          }).length,
        })

        const result = patchMessages(messages)

        if (result.patched > 0) {
          writeLog({
            event:         'patched',
            patchedFields: result.patched,
            totalMessages: result.totalMessages,
            turns:         result.turns,
          })

          await client.app.log({ body: { service: 'thinking-fix', level: 'info', message: `patched ${result.patched} field(s) across ${result.totalMessages} message(s)` } })
        }
      } catch (err: any) {
        writeLog({ event: 'error', message: err?.message ?? String(err) })
        await client.app.log({ body: { service: 'thinking-fix', level: 'error', message: `Error — passing through unmodified: ${err?.message ?? err}` } })
      }
    },
  }
}

export default ThinkingFixPlugin
