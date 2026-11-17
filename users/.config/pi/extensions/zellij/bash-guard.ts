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

const CMD_PREFIX = String.raw`(?:^|[;&|(\n])\s*(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*)?(?:\/[^\s;&|]*\/)?`

const BASH_GUARD_RULES: GuardRule[] = [
    {
        pattern: new RegExp(`${CMD_PREFIX}nohup\\b`),
        reason: "Blocked `nohup` in bash: use `zellij_run` for long tasks or `zellij_service` for background services.",
    },
    {
        pattern: new RegExp(`${CMD_PREFIX}(?:disown|setsid)\\b`),
        reason: "Blocked `disown`/`setsid` in bash: use `zellij_run` or `zellij_service` so lifecycle and logs remain managed.",
    },
    {
        pattern: new RegExp(`${CMD_PREFIX}(?:tmux|screen)\\b`),
        reason: "Blocked `tmux`/`screen` in bash: use the native `zellij_*` tools instead.",
    },
    {
        // Match background `&` outside `&&`, `>&`, `<&`, `&>`, and `&>>`.
        pattern: /(?:^|[^&><\d])&(?![&>])/,
        reason: "Blocked background `&` job in bash: use `zellij_run` or `zellij_service` instead of detaching with `&`.",
    },
    {
        pattern: new RegExp(`${CMD_PREFIX}while\\b[\\s\\S]*\\bsleep\\b`),
        reason: "Blocked sleep-poll loop in bash: use `zellij_run` or `zellij_service(readyPattern=...)` instead of polling.",
    },
    {
        pattern: new RegExp(
            `${CMD_PREFIX}zellij\\s+(?:kill-all-sessions|delete-all-sessions|ka|da)\\b`,
        ),
        reason: "Blocked destructive global zellij session command.",
    },
    {
        pattern: new RegExp(`${CMD_PREFIX}zellij\\s+(?:attach|a|subscribe)\\b`),
        reason: "Blocked interactive/streaming `zellij attach`/`subscribe` inside bash; use `zellij_pane` or `zellij_repl`.",
    },
]

/**
 * Replace quoted string literals and `#` comments with spaces so regex rules
 * only inspect unquoted shell syntax and do not match arguments like `grep nohup`.
 */
function stripQuotesAndComments(command: string): string {
    let out = ""
    let mode: "none" | "single" | "double" | "comment" = "none"

    for (let i = 0; i < command.length; i++) {
        const ch = command[i]
        if (mode === "comment") {
            if (ch === "\n") {
                mode = "none"
                out += ch
            } else {
                out += " "
            }
            continue
        }
        if (mode === "single") {
            if (ch === "'") mode = "none"
            out += " "
            continue
        }
        if (mode === "double") {
            if (ch === "\\" && i + 1 < command.length) {
                out += "  "
                i += 1
                continue
            }
            if (ch === '"') mode = "none"
            out += " "
            continue
        }

        if (ch === "\\" && i + 1 < command.length) {
            out += "  "
            i += 1
            continue
        }
        if (ch === "'") {
            mode = "single"
            out += " "
            continue
        }
        if (ch === '"') {
            mode = "double"
            out += " "
            continue
        }
        if (ch === "#" && (i === 0 || /\s|[;&|()]/.test(command[i - 1]))) {
            mode = "comment"
            out += " "
            continue
        }
        out += ch
    }
    return out
}

/** Return a block reason if `command` uses detached/polling bash anti-patterns, else undefined. */
export function detectBlockedBashReason(command: string): string | undefined {
    const trimmed = command.trim()
    if (!trimmed) return undefined
    const scrubbed = stripQuotesAndComments(trimmed)
    for (const rule of BASH_GUARD_RULES) {
        if (rule.pattern.test(scrubbed)) {
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
