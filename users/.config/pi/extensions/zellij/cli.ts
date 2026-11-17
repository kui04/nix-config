import { spawn, type ChildProcess } from "node:child_process"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
    parseZellijPanesJson,
    parseZellijTabsJson,
    type SplitDirection,
    type ZellijPaneJson,
    type ZellijTabJson,
} from "./types.ts"

const CLI_TIMEOUT_MS = 10_000
// Leading alphanumeric forbids `-foo` flag injection and `.` / `..` path segments.
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const COORD_RE = /^(?:\d+|\d+%)$/

export interface FloatingCoords {
    x?: string
    y?: string
    width?: string
    height?: string
    pinned?: boolean
}

export interface NewPaneOptions {
    cwd?: string
    name?: string
    tabId?: number
    floating?: boolean
    floatingCoords?: FloatingCoords
    stacked?: boolean
    direction?: SplitDirection
    noFocus?: boolean
    notify?: boolean
    closeOnExit?: boolean
    command: string[]
}

export interface NewTabOptions {
    name: string
    cwd?: string
    noFocus?: boolean
    closeOnExit?: boolean
    command?: string[]
}

interface SharedHelperClient {
    refs: number
    readyPromise: Promise<void>
    cleanup: () => void
}

const activeHelperClients = new Map<string, SharedHelperClient>()

/**
 * Validate a Zellij session, tab, or pane identifier.
 *
 * Limits: 1-64 characters matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.
 * Throws an Error when the identifier is invalid.
 */
export function validateIdentifier(value: string, kind: string): string {
    if (!IDENTIFIER_RE.test(value)) {
        throw new Error(
            `Invalid ${kind} "${value}". Use 1-64 chars from [A-Za-z0-9._-], starting with an alphanumeric character.`,
        )
    }
    return value
}

/** Sanitize an arbitrary label into a valid Zellij identifier. */
export function sanitizeIdentifier(raw: string, fallback: string, maxLen = 48): string {
    const cleaned = raw
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^[^A-Za-z0-9]+|-+$/g, "")
        .slice(0, maxLen)
    return cleaned && IDENTIFIER_RE.test(cleaned) ? cleaned : fallback
}

function validateCoord(value: string, field: string): string {
    if (!COORD_RE.test(value)) {
        throw new Error(
            `Invalid floating ${field} "${value}". Expected integer or percentage (e.g. "10" or "80%").`,
        )
    }
    return value
}

export function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function formatPaneId(paneId: string | number): string {
    if (typeof paneId === "number") return `terminal_${paneId}`
    if (/^\d+$/.test(paneId)) return `terminal_${paneId}`
    return paneId
}

export function parsePaneNumericId(rawPaneId: string): number {
    const trimmed = rawPaneId.trim()
    const match = trimmed.match(/^(?:terminal_)?(\d+)$/)
    if (!match) {
        throw new Error(`Unexpected zellij pane ID: "${trimmed}"`)
    }
    return parseInt(match[1], 10)
}

async function execZellij(
    pi: ExtensionAPI,
    args: string[],
    timeoutMs = CLI_TIMEOUT_MS,
): Promise<string> {
    const res = await pi.exec("zellij", args, { timeout: timeoutMs })
    if (res.killed) {
        throw new Error(`zellij ${args.join(" ")} timed out after ${timeoutMs}ms`)
    }
    if (res.code !== 0) {
        const msg = res.stderr.trim() || res.stdout.trim() || `exit code ${res.code}`
        const sub =
            args[0] === "--session" ? (args[3] ?? args[2] ?? "action") : (args[0] ?? "command")
        throw new Error(`zellij ${sub} failed: ${msg}`)
    }
    return res.stdout
}

/** Probe `zellij --version` and ensure >= 0.45.0 is available in PATH. */
export async function probeZellijVersion(
    pi: ExtensionAPI,
): Promise<
    | { ok: true; major: number; minor: number; patch: number; raw: string }
    | { ok: false; reason: string }
> {
    try {
        const res = await pi.exec("zellij", ["--version"], { timeout: 3_000 })
        if (res.killed || res.code !== 0) {
            return { ok: false, reason: "zellij binary not found or timed out" }
        }
        const raw = res.stdout.trim()
        const m = raw.match(/(\d+)\.(\d+)\.(\d+)/)
        if (!m) {
            return { ok: false, reason: `unrecognized zellij version "${raw}"` }
        }
        const major = parseInt(m[1], 10)
        const minor = parseInt(m[2], 10)
        const patch = parseInt(m[3], 10)
        if (major === 0 && minor < 45) {
            return {
                ok: false,
                reason: `zellij ${major}.${minor}.${patch} is too old (need >= 0.45.0)`,
            }
        }
        return { ok: true, major, minor, patch, raw }
    } catch {
        return { ok: false, reason: "zellij binary not found in PATH" }
    }
}

/** Return names of currently running (non-EXITED) Zellij sessions. */
export async function listSessions(pi: ExtensionAPI): Promise<string[]> {
    const res = await pi.exec("zellij", ["list-sessions", "-n"], { timeout: 5_000 })
    if (res.killed || res.code !== 0) return []
    const sessions: string[] = []
    for (const rawLine of res.stdout.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || /\(EXITED\b/i.test(line)) continue
        const name = line.split(/\s+/)[0]
        if (name) sessions.push(name)
    }
    return sessions
}

export async function activeClientCount(pi: ExtensionAPI, session: string): Promise<number> {
    const res = await pi.exec("zellij", ["--session", session, "action", "list-clients"], {
        timeout: 5_000,
    })
    if (res.killed || res.code !== 0) return 0
    const lines = res.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    // Output always includes a header row when any query succeeds.
    return Math.max(0, lines.length - 1)
}

export async function ensureBackgroundSession(pi: ExtensionAPI, session: string): Promise<void> {
    validateIdentifier(session, "session name")
    const existing = await listSessions(pi)
    if (existing.includes(session)) return

    // Clear any dead serialized session of the same name before creating a fresh one.
    await pi.exec("zellij", ["delete-session", session], { timeout: 3_000 }).catch(() => {})
    await execZellij(pi, ["attach", "--create-background", session])
    for (let i = 0; i < 20; i++) {
        const sessions = await listSessions(pi)
        if (sessions.includes(session)) return
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
}

function killHelperProcessGroup(helper: ChildProcess): void {
    try {
        helper.stdin?.destroy()
    } catch {
        // Ignore.
    }
    if (helper.pid !== undefined) {
        try {
            process.kill(-helper.pid, "SIGKILL")
            return
        } catch {
            // Fall back to direct kill if process group no longer exists.
        }
    }
    try {
        helper.kill("SIGKILL")
    } catch {
        // Ignore if already exited.
    }
}

/**
 * Zellij 0.45/0.46 drops `new-tab` or rejects `new-pane` in sessions with zero
 * attached clients because geometry requires an active client. Refcount a shared
 * temporary PTY client per session so concurrent calls never yank it early.
 */
export async function withTemporaryClient<T>(
    pi: ExtensionAPI,
    session: string,
    fn: () => Promise<T>,
): Promise<T> {
    const existingShared = activeHelperClients.get(session)
    if (existingShared) {
        existingShared.refs += 1
        try {
            await existingShared.readyPromise
            return await fn()
        } finally {
            existingShared.refs -= 1
            if (existingShared.refs === 0) {
                activeHelperClients.delete(session)
                existingShared.cleanup()
            }
        }
    }

    if ((await activeClientCount(pi, session)) > 0) {
        return fn()
    }

    // Strip ZELLIJ* variables so `zellij attach` does not refuse with
    // "You are trying to attach to the current session".
    const helperEnv = { ...process.env }
    delete helperEnv.ZELLIJ
    delete helperEnv.ZELLIJ_SESSION_NAME
    delete helperEnv.ZELLIJ_PANE_ID

    // Keep stdin as an open pipe so util-linux `script` does not receive EOF immediately.
    const helper = spawn(
        "script",
        ["-qfc", `stty rows 40 cols 120; zellij attach ${shellQuote(session)}`, "/dev/null"],
        { stdio: ["pipe", "ignore", "ignore"], env: helperEnv, detached: true },
    )

    let spawnError: Error | undefined
    let exitedEarly = false
    helper.on("error", (err) => {
        spawnError = err
    })
    helper.stdin?.on("error", () => {
        // Ignore EPIPE during teardown.
    })
    helper.on("exit", () => {
        exitedEarly = true
    })

    const readyPromise = (async () => {
        for (let i = 0; i < 40; i++) {
            if (spawnError) {
                throw new Error(
                    `Failed to launch temporary PTY client ("script"): ${spawnError.message}`,
                )
            }
            if ((await activeClientCount(pi, session)) > 0) return
            if (exitedEarly) {
                throw new Error(
                    `Temporary PTY client exited before attaching to session "${session}".`,
                )
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error(`Timed out attaching temporary PTY client to session "${session}".`)
    })()

    const shared: SharedHelperClient = {
        refs: 1,
        readyPromise,
        cleanup: () => killHelperProcessGroup(helper),
    }
    activeHelperClients.set(session, shared)

    try {
        await readyPromise
        return await fn()
    } finally {
        shared.refs -= 1
        if (shared.refs === 0) {
            activeHelperClients.delete(session)
            shared.cleanup()
        }
    }
}

export async function listTabs(pi: ExtensionAPI, session: string): Promise<ZellijTabJson[]> {
    const out = await execZellij(pi, ["--session", session, "action", "list-tabs", "-a", "-j"])
    return parseZellijTabsJson(out)
}

export async function listPanes(pi: ExtensionAPI, session: string): Promise<ZellijPaneJson[]> {
    const out = await execZellij(pi, ["--session", session, "action", "list-panes", "-a", "-j"])
    return parseZellijPanesJson(out)
}

export async function newTab(
    pi: ExtensionAPI,
    session: string,
    opts: NewTabOptions,
): Promise<number> {
    validateIdentifier(opts.name, "tab name")
    const args = ["--session", session, "action", "new-tab", "-n", opts.name]
    if (opts.cwd) args.push("-c", opts.cwd)
    if (opts.noFocus !== false) args.push("--no-focus")
    if (opts.closeOnExit) args.push("--close-on-exit")
    if (opts.command && opts.command.length > 0) {
        args.push("--", ...opts.command)
    }
    const out = (await execZellij(pi, args)).trim()
    if (!/^\d+$/.test(out)) {
        throw new Error(`Unexpected tab ID from zellij new-tab: "${out}"`)
    }
    return parseInt(out, 10)
}

export async function newPane(
    pi: ExtensionAPI,
    session: string,
    opts: NewPaneOptions,
): Promise<{ paneId: string; numericId: number }> {
    const args = ["--session", session, "action", "new-pane"]
    if (opts.tabId !== undefined) args.push("--tab-id", String(opts.tabId))
    if (opts.cwd) args.push("--cwd", opts.cwd)
    if (opts.name) {
        validateIdentifier(opts.name, "pane name")
        args.push("-n", opts.name)
    }
    if (opts.floating) {
        args.push("--floating")
        if (opts.floatingCoords?.x) args.push("-x", validateCoord(opts.floatingCoords.x, "x"))
        if (opts.floatingCoords?.y) args.push("-y", validateCoord(opts.floatingCoords.y, "y"))
        if (opts.floatingCoords?.width) {
            args.push("--width", validateCoord(opts.floatingCoords.width, "width"))
        }
        if (opts.floatingCoords?.height) {
            args.push("--height", validateCoord(opts.floatingCoords.height, "height"))
        }
        if (opts.floatingCoords?.pinned !== undefined) {
            args.push("--pinned", String(opts.floatingCoords.pinned))
        }
    } else if (opts.stacked) {
        args.push("--stacked")
    } else if (opts.direction) {
        args.push("-d", opts.direction)
    }
    if (opts.noFocus) args.push("--no-focus")
    if (opts.notify) args.push("--notify")
    if (opts.closeOnExit) args.push("--close-on-exit")
    args.push("--", ...opts.command)

    const out = await withTemporaryClient(pi, session, () => execZellij(pi, args))
    const numericId = parsePaneNumericId(out)
    return { paneId: formatPaneId(numericId), numericId }
}

export async function stackPanes(
    pi: ExtensionAPI,
    session: string,
    paneIds: string[],
): Promise<void> {
    if (paneIds.length < 2) return
    await execZellij(pi, [
        "--session",
        session,
        "action",
        "stack-panes",
        "--",
        ...paneIds.map(formatPaneId),
    ])
}

export async function watchPane(pi: ExtensionAPI, session: string, paneId: string): Promise<void> {
    await execZellij(pi, ["--session", session, "action", "watch-pane", "-p", formatPaneId(paneId)])
}

export async function renamePane(
    pi: ExtensionAPI,
    session: string,
    paneId: string,
    name: string,
): Promise<void> {
    validateIdentifier(name, "pane name")
    await execZellij(pi, [
        "--session",
        session,
        "action",
        "rename-pane",
        "-p",
        formatPaneId(paneId),
        "--",
        name,
    ])
}

export async function focusPane(pi: ExtensionAPI, session: string, paneId: string): Promise<void> {
    await execZellij(pi, ["--session", session, "action", "focus-pane-id", formatPaneId(paneId)])
}

export async function closePane(pi: ExtensionAPI, session: string, paneId: string): Promise<void> {
    await execZellij(pi, ["--session", session, "action", "close-pane", "-p", formatPaneId(paneId)])
}

export async function toggleEmbedOrFloating(
    pi: ExtensionAPI,
    session: string,
    paneId: string,
): Promise<void> {
    await execZellij(pi, [
        "--session",
        session,
        "action",
        "toggle-pane-embed-or-floating",
        "-p",
        formatPaneId(paneId),
    ])
}

export async function toggleFloatingPanes(
    pi: ExtensionAPI,
    session: string,
    tabId?: number,
): Promise<void> {
    const args = ["--session", session, "action", "toggle-floating-panes"]
    if (tabId !== undefined) args.push("-t", String(tabId))
    await execZellij(pi, args)
}

export async function dumpScreen(
    pi: ExtensionAPI,
    session: string,
    paneId: string,
    opts?: { full?: boolean; ansi?: boolean },
): Promise<string> {
    const args = ["--session", session, "action", "dump-screen", "-p", formatPaneId(paneId)]
    if (opts?.full) args.push("-f")
    if (opts?.ansi) args.push("-a")
    return execZellij(pi, args)
}

export async function writeChars(
    pi: ExtensionAPI,
    session: string,
    paneId: string,
    text: string,
): Promise<void> {
    await execZellij(pi, [
        "--session",
        session,
        "action",
        "write-chars",
        "-p",
        formatPaneId(paneId),
        "--",
        text,
    ])
}

export async function sendKeys(
    pi: ExtensionAPI,
    session: string,
    paneId: string,
    keys: string[],
): Promise<void> {
    await execZellij(pi, [
        "--session",
        session,
        "action",
        "send-keys",
        "-p",
        formatPaneId(paneId),
        "--",
        ...keys,
    ])
}
