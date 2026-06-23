import type { Plugin, PluginModule } from '@opencode-ai/plugin'

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

function patchMessages(messages: any[]): number {
  let count = 0

  // ── Step 1: Self-detect reasoning model ──────────────────────────────────
  // Scan for any assistant message that already has reasoning_content.
  // OpenCode sets this field on the most recent response turn.
  // Non-reasoning providers (Qwen/GPT/Claude/Mistral/Llama) never have it.
  const isReasoningModel = messages.some((wrapper) => {
    const msg = wrapper?.info ?? wrapper
    return msg?.role === 'assistant' && ('reasoning_content' in msg || 'reasoning' in msg)
  })

  // ── Step 2: Non-reasoning model — exit immediately, zero modification ─────
  // Qwen/GPT/Claude reject unknown fields with HTTP 400.
  // This guard is what prevents multi-session errors on non-reasoning models.
  if (!isReasoningModel) return 0

  // ── Step 3: Patch all assistant turns missing required fields ─────────────
  for (const wrapper of messages) {
    const msg = wrapper?.info ?? wrapper
    if (!msg || msg.role !== 'assistant') continue

    // Fix 1: content must be non-null string on every assistant turn.
    // OpenAI-compatible SDK omits it when only tool_calls are present.
    if (!msg.content && msg.content !== '') {
      msg.content = msg.tool_calls?.length ? 'call tool' : ''
      count++
    }

    // Fix 2: reasoning_content must be present on every assistant turn in history.
    // Absence causes HTTP 400 from DeepSeek/Kimi/GLM/MiMo on turn 2+.
    // Use "" (empty string) — confirmed working cross-provider.
    // "" and null both work per DeepSeek docs; "" is safer cross-provider.
    if (!('reasoning_content' in msg)) {
      msg.reasoning_content = ''
      count++
    }

    // Fix 3: reasoning must be present for OpenCode Go provider on every turn.
    if (!('reasoning' in msg)) {
      msg.reasoning = ''
      count++
    }
  }

  return count
}

export const ThinkingFixPlugin: Plugin = async ({ client }) => {
  client.app.log({ body: { service: 'thinking-fix', level: 'info', message: 'Plugin loaded — universal reasoning_content fix active' } })

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

        const patched = patchMessages(messages)

        if (patched > 0) {
          client.app.log({ body: { service: 'thinking-fix', level: 'info', message: `patched ${patched} field(s) across ${messages.length} message(s)` } })
        }
      } catch (err) {
        client.app.log({ body: { service: 'thinking-fix', level: 'error', message: `Error — passing through unmodified: ${err}` } })
      }
    },
  }
}

export default { server: ThinkingFixPlugin } satisfies PluginModule
