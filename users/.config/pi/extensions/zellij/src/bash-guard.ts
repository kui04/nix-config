import type {
    BashToolCallEvent,
    ExtensionAPI,
    ToolCallEvent,
} from "@earendil-works/pi-coding-agent"

// Local type guard avoids importing the `@earendil-works/pi-coding-agent` barrel at runtime.
function isBashToolCallEvent(event: ToolCallEvent): event is BashToolCallEvent {
    return event.toolName === "bash"
}

interface GuardRule {
    pattern: RegExp
    reason: string
}

const CMD_PREFIX = String.raw`(?:^|[;&|({\n])\s*(?:(?:then|do|else|elif)\b\s*)?(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*)?(?:\/[^\s;&|]*\/)?`
const ZELLIJ_GLOBAL_OPT = String.raw`(?:(?:--?(?:max-panes|data-dir|session|layout|layout-string|new-session-with-layout|config|config-dir|s|l|n|c)(?:=\S*|\s+\S+)|--debug|-d)\s+)*`
const ZELLIJ_CMD = `${CMD_PREFIX}zellij\\s+${ZELLIJ_GLOBAL_OPT}`
const SIMPLE_WORD_RE = /^[A-Za-z0-9._/-]+$/

const BASH_GUARD_RULES: GuardRule[] = [
    {
        pattern: new RegExp(`${CMD_PREFIX}nohup\\b(?!=)`),
        reason: "Blocked `nohup` in bash: use `zellij_run` for long tasks or `zellij_service` for background services.",
    },
    {
        pattern: new RegExp(`${CMD_PREFIX}(?:disown|setsid)\\b(?!=)`),
        reason: "Blocked `disown`/`setsid` in bash: use `zellij_run` or `zellij_service` so lifecycle and logs remain managed.",
    },
    {
        pattern: new RegExp(`${CMD_PREFIX}(?:tmux|screen)\\b(?!=)`),
        reason: "Blocked `tmux`/`screen` in bash: use the native `zellij_*` tools instead.",
    },
    {
        // Match background `&` outside `&&`, `>&`, `<&`, `&>`, and `&>>` (allows `2>&1`, catches `8080&` and `2>&1&`).
        pattern: /(?:^|[^&><])&(?![&>])/,
        reason: "Blocked background `&` job in bash: use `zellij_run` or `zellij_service` instead of detaching with `&`.",
    },
    {
        pattern: new RegExp(`${CMD_PREFIX}while\\b(?!=)[\\s\\S]*\\bsleep\\b`),
        reason: "Blocked sleep-poll loop in bash: use `zellij_run` or `zellij_service(readyPattern=...)` instead of polling.",
    },
    {
        pattern: new RegExp(`${ZELLIJ_CMD}(?:kill-all-sessions|delete-all-sessions|ka|da)\\b`),
        reason: "Blocked destructive global zellij session command.",
    },
    {
        pattern: new RegExp(
            `${ZELLIJ_CMD}(?:attach|a|subscribe|kill-session|k)(?![^\\n;|&]*(?:\\s--help\\b|\\s-h\\b))(?:\\s|$)`,
        ),
        reason: "Blocked direct `zellij attach`/`subscribe`/`kill-session` inside bash; use `zellij_pane` or `zellij_repl`.",
    },
    {
        pattern: new RegExp(
            `${ZELLIJ_CMD}(?:action|ac)\\s+(?:new-pane|new-tab|write-chars|send-keys|close-pane)(?![^\\n;|&]*(?:\\s--help\\b|\\s-h\\b))(?:\\s|$)`,
        ),
        reason: "Blocked bypassing orchestrator with raw `zellij action`; use `zellij_run`, `zellij_service`, `zellij_subagent`, `zellij_repl`, or `zellij_pane`.",
    },
    {
        pattern: new RegExp(
            `${ZELLIJ_CMD}(?:run|r|edit|e|plugin|p)(?![^\\n;|&]*(?:\\s--help\\b|\\s-h\\b))(?:\\s|$)`,
        ),
        reason: "Blocked spawning panes/plugins directly via `zellij run`/`edit`/`plugin`; use `zellij_run`, `zellij_service`, or `zellij_repl`.",
    },
]

function skipHeredocBody(
    command: string,
    afterNewlineIdx: number,
    delimiter: string,
    allowTabIndent: boolean,
): { out: string; nextIdx: number } {
    let i = afterNewlineIdx
    let out = ""
    while (i < command.length) {
        const nl = command.indexOf("\n", i)
        const lineEnd = nl === -1 ? command.length : nl
        const line = command.slice(i, lineEnd)
        const normalized = allowTabIndent ? line.replace(/^\t+/, "") : line
        if (normalized === delimiter) {
            out += `${" ".repeat(line.length)}${nl === -1 ? "" : "\n"}`
            return { out, nextIdx: nl === -1 ? command.length : nl + 1 }
        }
        out += `${" ".repeat(line.length)}${nl === -1 ? "" : "\n"}`
        i = nl === -1 ? command.length : nl + 1
    }
    return { out, nextIdx: command.length }
}

/**
 * Normalize shell syntax before regex matching:
 * - Blank `#` comments, `$(( ... ))` arithmetic expansions, and heredoc bodies.
 * - Unquote single-word literals (so `zellij "subscribe"` is caught) while blanking
 *   multi-word/metacharacter quoted literals (so `echo "foo &"` is allowed).
 */
function normalizeShellForGuard(command: string): string {
    let out = ""
    let pendingHeredoc: { delimiter: string; allowTabIndent: boolean } | undefined

    let i = 0
    while (i < command.length) {
        const ch = command[i]

        if (ch === "\n") {
            out += "\n"
            i += 1
            if (pendingHeredoc) {
                const skipped = skipHeredocBody(
                    command,
                    i,
                    pendingHeredoc.delimiter,
                    pendingHeredoc.allowTabIndent,
                )
                out += skipped.out
                i = skipped.nextIdx
                pendingHeredoc = undefined
            }
            continue
        }

        // Backslash-escaped character outside quotes.
        if (ch === "\\" && i + 1 < command.length) {
            out += "  "
            i += 2
            continue
        }

        // `#` comment to end of line.
        if (ch === "#" && (i === 0 || /\s|[;&|()]/.test(command[i - 1]))) {
            while (i < command.length && command[i] !== "\n") {
                out += " "
                i += 1
            }
            continue
        }

        // `$(( ... ))` arithmetic expansion (keeps `&` bitwise operators out of background check).
        if (command.startsWith("$((", i)) {
            out += "   "
            i += 3
            let depth = 2
            while (i < command.length && depth > 0) {
                if (command[i] === "(") depth += 1
                else if (command[i] === ")") depth -= 1
                out += command[i] === "\n" ? "\n" : " "
                i += 1
            }
            continue
        }

        // Heredoc header `<<EOF` / `<<- 'EOF'` (excluding `<<<` herestring).
        if (command.startsWith("<<", i) && command[i + 2] !== "<" && !pendingHeredoc) {
            const rest = command.slice(i + 2)
            const m = rest.match(
                /^(-)?\s*(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))/,
            )
            if (m) {
                const delimiter = m[2] ?? m[3] ?? m[4]
                if (delimiter) {
                    pendingHeredoc = { delimiter, allowTabIndent: m[1] === "-" }
                }
            }
            out += "<<"
            i += 2
            continue
        }

        // Single-quoted literal.
        if (ch === "'") {
            const end = command.indexOf("'", i + 1)
            if (end === -1) {
                out += " ".repeat(command.length - i)
                break
            }
            const inner = command.slice(i + 1, end)
            out += SIMPLE_WORD_RE.test(inner) ? ` ${inner} ` : " ".repeat(end - i + 1)
            i = end + 1
            continue
        }

        // Double-quoted literal.
        if (ch === '"') {
            let j = i + 1
            let inner = ""
            let hasEscapeOrExpansion = false
            while (j < command.length) {
                const c = command[j]
                if (c === "\\" && j + 1 < command.length) {
                    hasEscapeOrExpansion = true
                    j += 2
                    continue
                }
                if (c === "$" || c === "`") {
                    hasEscapeOrExpansion = true
                }
                if (c === '"') break
                inner += c
                j += 1
            }
            if (j >= command.length) {
                out += " ".repeat(command.length - i)
                break
            }
            out +=
                !hasEscapeOrExpansion && SIMPLE_WORD_RE.test(inner)
                    ? ` ${inner} `
                    : " ".repeat(j - i + 1)
            i = j + 1
            continue
        }

        out += ch
        i += 1
    }

    return out
}

/** Return a block reason if `command` uses detached/polling bash anti-patterns, else undefined. */
export function detectBlockedBashReason(command: string): string | undefined {
    const trimmed = command.trim()
    if (!trimmed) return undefined
    const normalized = normalizeShellForGuard(trimmed)
    for (const rule of BASH_GUARD_RULES) {
        if (rule.pattern.test(normalized)) {
            return rule.reason
        }
    }
    return undefined
}

export function registerBashGuard(pi: ExtensionAPI): void {
    pi.on("tool_call", (event) => {
        if (!isBashToolCallEvent(event)) return
        const cmd = event.input.command
        if (typeof cmd !== "string") return

        const reason = detectBlockedBashReason(cmd)
        if (reason) {
            return { block: true, reason }
        }
        return undefined
    })
}
