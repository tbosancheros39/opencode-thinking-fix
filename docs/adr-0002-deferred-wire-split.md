# ADR-0002: Deferred three-wire provider split (v4.0)

Status: Deferred — architecture documentation only, no runtime change
Date: 2026-08-19

## Context

The OpenCode Go gateway (`https://opencode.ai/zen/go/v1`) serves models across
three wire formats, each with its own SDK package and auth convention:

| Endpoint | SDK package | Auth header |
|---|---|---|
| `/v1/chat/completions` | `@ai-sdk/openai-compatible` | `Authorization: Bearer <key>` |
| `/v1/messages` | `@ai-sdk/anthropic` | `x-api-key: <key>` (+ `anthropic-version: 2023-06-01`) |
| `/v1/responses` | `@ai-sdk/openai` | `Authorization: Bearer <key>` |

Live verification evidence for all three wires: `docs/anthropic-wiring.md`
(`/v1/messages`) and `docs/openai-wiring.md` (`/v1/chat/completions` +
`/v1/responses`).

## Current v3.2.0 reality (main config)

The main config `~/.opencode/opencode.json` does NOT use the three-wire split.
It declares a single `opencode-go` provider (`@ai-sdk/openai-compatible`,
baseURL `http://127.0.0.1:3458/v1`) that bundles ALL go models — including
MiniMax and Qwen, which the gateway natively serves over `/v1/messages`.

Consequence: current production MiniMax/Qwen traffic rides
`/v1/chat/completions`. The deployed proxy log confirms this: zero
`/v1/messages` events and 236 `/v1/chat/completions` events, with
`"model":"minimax-m3","endpoint":"/v1/chat/completions"`. `fixedUpstreamRoute`
therefore resolves `reasoningKey: 'reasoning'` for these models — NOT
`'anthropic'`. The anthropic-wire branch (thinking-block unshift into
`content[]`) is verified-correct but currently unexercised in production
traffic; it only activates if a config uses the `opencode-go-messages` provider.

## Decision (deferred to v4.0)

Split the single `opencode-go` provider into three providers, one per wire:

- `opencode-go` → `/v1/chat/completions` via `@ai-sdk/openai-compatible`
- `opencode-go-messages` → `/v1/messages` via `@ai-sdk/anthropic`
- `opencode-go-responses` → `/v1/responses` via `@ai-sdk/openai`

### Ternary-wire rationale

- Each wire has a distinct auth header convention: `/v1/messages` requires
  `x-api-key: <key>` (Bearer → 401 "Missing API key"), while chat/completions
  and responses require `Authorization: Bearer <key>` (`x-api-key` → 401). A
  single OpenAI-compatible provider cannot send `x-api-key` on the anthropic
  wire, so the split must be per-provider, not per-model.
- The gateway rejects prefixed model ids (`opencode-go/minimax-m3` →
  ModelError); each provider must send bare model names. The proxy already
  supports the split: `fixedUpstreamRoute` strips the extended prefix via the
  intentional regex `opencode-go(?:-(?:messages|responses))?/` (core.js:82),
  so `opencode-go-messages/minimax-m3` on `/v1/messages` resolves to
  `reasoningKey: 'anthropic'` and `opencode-go-responses/grok-4.5` on
  `/v1/responses` passes through untouched (no `messages` array → never
  patched, never cached).

### Triggers for revisiting

Revisit the split when any of the following holds:

1. OpenCode Go requires the Anthropic (`/v1/messages`) or Responses
   (`/v1/responses`) wire for models currently served over chat/completions in
   our deployment (e.g. MiniMax/Qwen stop being accepted on chat/completions).
2. The current gateway behavior changes — per-endpoint auth conventions, field
   contracts, or model-to-wire routing.
3. A model currently on `/v1/responses` (grok-4.5, gpt-5.6-luna,
   muse-spark-1.2-contributor) is needed in production and its reasoning must
   be cached (currently pass-through).

## Auth differentiation

- `/v1/messages` → `x-api-key: <key>` (+ `anthropic-version: 2023-06-01`).
  Bearer returns 401 "Missing API key".
- `/v1/chat/completions` and `/v1/responses` → `Authorization: Bearer <key>`.
  `x-api-key` returns 401.
- The key material is the same for all three wires; only the header format
  differs. The proxy forwards client headers as-is — the client (SDK) must send
  the correct header per wire; the proxy does not translate auth schemes.

## Status

No runtime change now. This is deferred architecture documentation for v4.0.
The v3.2.0 deployment (single `opencode-go` OpenAI-compatible provider on port
3458) remains the source of truth for current behavior.
