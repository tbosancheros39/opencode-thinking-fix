import type { TUIPlugin } from '@opencode-ai/plugin'

/**
 * No-op TUI plugin entry point.
 *
 * opencode-thinking-fix is a server-side plugin: it patches outgoing chat
 * messages via experimental.chat.messages.transform. OpenCode's plugin
 * installer, however, validates that a package exposes either a server or a
 * TUI target. By exposing an empty TUI target we make installation via
 * Ctrl+P / `opencode plugin opencode-thinking-fix` work without warnings.
 */
const tuiPlugin: TUIPlugin = {
  name: 'opencode-thinking-fix-tui',
  version: '1.1.6',
  activate() {
    // nothing to do at TUI level
  },
}

export default tuiPlugin
