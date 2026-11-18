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
    command: string[]
}

export interface NewTabOptions {
    name: string
    cwd?: string
    noFocus?: boolean
    command?: string[]
}

interface SharedHelperClient {
    refs: number
    persistent: boolean
    readyPromise: Promise<void>
    cleanup: () => void
}

const activeHelperClients = new Map<string, SharedHelperClient>()
const pendingHelperAcquires = new Map<string, Promise<SharedHelperClient | null>>()

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

/** Parse `terminal_<id>` or bare numeric pane IDs into a non-negative integer. */
export function parsePaneNumericId(rawPaneId: string): number {
    const trimmed = rawPaneId.trim()
    const match = trimmed.match(/^(?:terminal_)?(\d+)$/)
    if (!match) {
        throw new Error(`Unexpected zellij pane ID: "${trimmed}"`)
    }
    return parseInt(match[1], 10)
}

async function execChecked(
    pi: ExtensionAPI,
    command: string,
    args: string[],
    label: string,
    timeoutMs = CLI_TIMEOUT_MS,
): Promise<string> {
    const res = await pi.exec(command, args, { timeout: timeoutMs })
    if (res.killed) {
        throw new Error(`zellij ${label} timed out after ${timeoutMs}ms`)
    }
    if (res.code !== 0) {
        const msg = res.stderr.trim() || res.stdout.trim() || `exit code ${res.code}`
        throw new Error(`zellij ${label} failed: ${msg}`)
    }
    return res.stdout
}

async function execZellij(
    pi: ExtensionAPI,
    args: string[],
    label: string,
    timeoutMs = CLI_TIMEOUT_MS,
): Promise<string> {
    return execChecked(pi, "zellij", args, label, timeoutMs)
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

/** Parse `zellij list-sessions -n` stdout, preserving spaces in session names and excluding EXITED sessions. */
export function parseListSessionsOutput(stdout: string): string[] {
    const sessions: string[] = []
    for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || /\(EXITED\b/i.test(line)) continue
        const name = line
            .replace(/\s+\[Created\b[\s\S]*$/, "")
            .replace(/\s+\(current\)\s*$/, "")
            .trim()
        if (name) sessions.push(name)
    }
    return sessions
}

/**
 * Return names of currently active (non-EXITED) Zellij sessions.
 * Uses `-n` instead of `-s` because `-s` prints dead serialized `(EXITED)` sessions too.
 */
export async function listSessions(pi: ExtensionAPI): Promise<string[]> {
    const res = await pi.exec("zellij", ["list-sessions", "-n"], { timeout: 5_000 })
    if (res.killed || res.code !== 0) return []
    return parseListSessionsOutput(res.stdout)
}

async function listClientRows(pi: ExtensionAPI, session: string): Promise<string[] | null> {
    const res = await pi.exec("zellij", ["--session", session, "action", "list-clients"], {
        timeout: 5_000,
    })
    if (res.killed || res.code !== 0) return null
    const lines = res.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    // Output always includes a header row when any query succeeds.
    return lines.slice(1)
}

export async function activeClientCount(pi: ExtensionAPI, session: string): Promise<number> {
    const rows = await listClientRows(pi, session)
    return rows ? rows.length : 0
}

export async function ensureBackgroundSession(pi: ExtensionAPI, session: string): Promise<void> {
    validateIdentifier(session, "session name")
    const existing = await listSessions(pi)
    if (existing.includes(session)) return

    // Clear any dead serialized session of the same name before creating a fresh one.
    await pi.exec("zellij", ["delete-session", session], { timeout: 3_000 }).catch(() => {})
    await execZellij(pi, ["attach", "--create-background", session], "attach --create-background")
    for (let i = 0; i < 20; i++) {
        const sessions = await listSessions(pi)
        if (sessions.includes(session)) return
        await new Promise((done) => setTimeout(done, 50))
    }
    throw new Error(`Timed out waiting for background zellij session "${session}" to appear.`)
}

export async function killAndDeleteSession(pi: ExtensionAPI, session: string): Promise<void> {
    validateIdentifier(session, "session name")
    await pi.exec("zellij", ["kill-session", session], { timeout: 5_000 }).catch(() => {})
    await pi.exec("zellij", ["delete-session", "-f", session], { timeout: 5_000 }).catch(() => {})
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

function spawnHelperClient(pi: ExtensionAPI, session: string): SharedHelperClient {
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
        const current = activeHelperClients.get(session)
        if (current && current.cleanup === cleanup) {
            activeHelperClients.delete(session)
        }
    })

    const cleanup = () => killHelperProcessGroup(helper)

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
            await new Promise((done) => setTimeout(done, 50))
        }
        throw new Error(`Timed out attaching temporary PTY client to session "${session}".`)
    })().catch((err) => {
        activeHelperClients.delete(session)
        cleanup()
        throw err
    })

    const shared: SharedHelperClient = {
        refs: 0,
        persistent: false,
        readyPromise,
        cleanup,
    }
    activeHelperClients.set(session, shared)
    return shared
}

/**
 * Serialize helper client discovery/creation per session so concurrent calls
 * never spawn duplicate helper processes.
 */
async function acquireHelperClientIfNeeded(
    pi: ExtensionAPI,
    session: string,
): Promise<SharedHelperClient | null> {
    const existing = activeHelperClients.get(session)
    if (existing) return existing

    const pending = pendingHelperAcquires.get(session)
    if (pending) return pending

    const init = (async (): Promise<SharedHelperClient | null> => {
        const again = activeHelperClients.get(session)
        if (again) return again
        if ((await activeClientCount(pi, session)) > 0) return null
        return spawnHelperClient(pi, session)
    })().finally(() => {
        pendingHelperAcquires.delete(session)
    })

    pendingHelperAcquires.set(session, init)
    return init
}

/**
 * Keep one headless PTY client attached to `session` while tracked panes exist
 * so repeated `new-pane` calls avoid paying the 100-500ms attach cost each time.
 */
export async function retainPersistentClient(pi: ExtensionAPI, session: string): Promise<void> {
    const shared = await acquireHelperClientIfNeeded(pi, session)
    if (!shared) return
    shared.persistent = true
    await shared.readyPromise
}

/** Release the persistent headless PTY client for `session` when no tracked panes remain. */
export function releasePersistentClient(session: string): void {
    const shared = activeHelperClients.get(session)
    if (!shared) return
    shared.persistent = false
    if (shared.refs === 0) {
        activeHelperClients.delete(session)
        shared.cleanup()
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
    const shared = await acquireHelperClientIfNeeded(pi, session)
    if (!shared) {
        return fn()
    }

    shared.refs += 1
    try {
        await shared.readyPromise
        return await fn()
    } finally {
        shared.refs -= 1
        if (shared.refs === 0 && !shared.persistent) {
            activeHelperClients.delete(session)
            shared.cleanup()
        }
    }
}

export async function listTabs(pi: ExtensionAPI, session: string): Promise<ZellijTabJson[]> {
    const out = await execZellij(
        pi,
        ["--session", session, "action", "list-tabs", "-a", "-j"],
        "list-tabs",
    )
    return parseZellijTabsJson(out)
}

export async function listPanes(pi: ExtensionAPI, session: string): Promise<ZellijPaneJson[]> {
    const out = await execZellij(
        pi,
        ["--session", session, "action", "list-panes", "-a", "-j"],
        "list-panes",
    )
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
    if (opts.noFocus) args.push("--no-focus")
    if (opts.command && opts.command.length > 0) {
        args.push("--", ...opts.command)
    }
    const out = (await execZellij(pi, args, "new-tab")).trim()
    if (!/^\d+$/.test(out)) {
        throw new Error(`Unexpected tab ID from zellij new-tab: "${out}"`)
    }
    return parseInt(out, 10)
}

export async function closeTabById(
    pi: ExtensionAPI,
    session: string,
    tabId: number,
): Promise<void> {
    await execZellij(
        pi,
        ["--session", session, "action", "close-tab-by-id", String(tabId)],
        "close-tab-by-id",
    )
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
    args.push("--", ...opts.command)

    const out = await withTemporaryClient(pi, session, () => execZellij(pi, args, "new-pane"))
    const numericId = parsePaneNumericId(out)
    return { paneId: formatPaneId(numericId), numericId }
}

export async function stackPanes(
    pi: ExtensionAPI,
    session: string,
    paneIds: string[],
): Promise<void> {
    if (paneIds.length < 2) return
    await execZellij(
        pi,
        ["--session", session, "action", "stack-panes", "--", ...paneIds.map(formatPaneId)],
        "stack-panes",
    )
}

export async function watchPane(pi: ExtensionAPI, session: string, paneId: string): Promise<void> {
    await execZellij(
        pi,
        ["--session", session, "action", "watch-pane", "-p", formatPaneId(paneId)],
        "watch-pane",
    )
}

export async function renamePane(
    pi: ExtensionAPI,
    session: string,
    paneId: string,
    name: string,
): Promise<void> {
    validateIdentifier(name, "pane name")
    await execZellij(
        pi,
        ["--session", session, "action", "rename-pane", "-p", formatPaneId(paneId), "--", name],
        "rename-pane",
    )
}

export async function focusPane(pi: ExtensionAPI, session: string, paneId: string): Promise<void> {
    await execZellij(
        pi,
        ["--session", session, "action", "focus-pane-id", formatPaneId(paneId)],
        "focus-pane-id",
    )
}

export async function closePane(pi: ExtensionAPI, session: string, paneId: string): Promise<void> {
    await execZellij(
        pi,
        ["--session", session, "action", "close-pane", "-p", formatPaneId(paneId)],
        "close-pane",
    )
}

export async function toggleEmbedOrFloating(
    pi: ExtensionAPI,
    session: string,
    paneId: string,
): Promise<void> {
    await execZellij(
        pi,
        [
            "--session",
            session,
            "action",
            "toggle-pane-embed-or-floating",
            "-p",
            formatPaneId(paneId),
        ],
        "toggle-pane-embed-or-floating",
    )
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
    return execZellij(pi, args, "dump-screen")
}

export async function writeChars(
    pi: ExtensionAPI,
    session: string,
    paneId: string,
    text: string,
): Promise<void> {
    await execZellij(
        pi,
        ["--session", session, "action", "write-chars", "-p", formatPaneId(paneId), "--", text],
        "write-chars",
    )
}

export async function sendKeys(
    pi: ExtensionAPI,
    session: string,
    paneId: string,
    keys: string[],
): Promise<void> {
    await execZellij(
        pi,
        ["--session", session, "action", "send-keys", "-p", formatPaneId(paneId), "--", ...keys],
        "send-keys",
    )
}

export async function markPaneSeen(
    pi: ExtensionAPI,
    session: string,
    paneId: string,
): Promise<void> {
    await execZellij(
        pi,
        ["--session", session, "action", "mark-pane-seen", "-p", formatPaneId(paneId)],
        "mark-pane-seen",
    )
}

export async function resolveUserClientPaneId(
    pi: ExtensionAPI,
    session: string,
    fallbackPaneId?: string | number,
): Promise<number | null> {
    const clientRows = await listClientRows(pi, session)
    if (!clientRows) return null
    const helperCount = activeHelperClients.has(session) ? 1 : 0
    if (clientRows.length <= helperCount) return null

    if (process.env.ZELLIJ_SESSION_NAME?.trim() === session) {
        const envPane = process.env.ZELLIJ_PANE_ID?.trim()
        if (envPane && /^\d+$/.test(envPane)) {
            return parseInt(envPane, 10)
        }
    }

    const lastRow = clientRows.at(-1)
    if (lastRow) {
        const cols = lastRow.split(/\s+/)
        const colMatch = cols[1]?.match(/^(?:terminal_)?(\d+)$/)
        if (colMatch) {
            return parseInt(colMatch[1], 10)
        }
    }

    if (fallbackPaneId !== undefined) {
        return parsePaneNumericId(String(fallbackPaneId))
    }
    return null
}

export async function promptNotify(
    pi: ExtensionAPI,
    session: string,
    message: string,
    opts?: { title?: string; timeout?: string; at?: string; paneId?: string | number },
): Promise<void> {
    const targetPaneId = await resolveUserClientPaneId(pi, session, opts?.paneId)
    if (targetPaneId === null) return

    const args = [
        "--session",
        session,
        "prompt",
        "notify",
        "--no-pane-name",
        "--no-tab-name",
        "--at",
        opts?.at ?? "top-right",
        "--timeout",
        opts?.timeout ?? "8s",
    ]
    if (opts?.title) {
        args.push("--title", opts.title)
    }
    args.push("--", message)

    if (
        process.env.ZELLIJ_SESSION_NAME?.trim() === session &&
        process.env.ZELLIJ_PANE_ID?.trim() === String(targetPaneId)
    ) {
        await execZellij(pi, args, "prompt notify")
        return
    }

    await execChecked(
        pi,
        "env",
        [`ZELLIJ_PANE_ID=${targetPaneId}`, "zellij", ...args],
        "prompt notify",
    )
}
