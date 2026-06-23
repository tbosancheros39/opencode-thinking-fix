// No-op TUI plugin entry point.
//
// opencode-thinking-fix is a server-side plugin. OpenCode's plugin installer
// validates that a package exposes either a server or a TUI target. By
// exposing an empty TUI target we make installation via Ctrl+P / `opencode
// plugin opencode-thinking-fix` work without warnings.
export default {
    name: 'opencode-thinking-fix-tui',
    version: '1.1.7',
    activate() {
        // nothing to do at TUI level
    },
};
//# sourceMappingURL=opencode-thinking-fix-tui.js.map