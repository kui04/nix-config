import {
    chmodSync,
    closeSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import {
    closePane,
    closeTabById,
    dumpScreen,
    ensureBackgroundSession,
    formatPaneId,
    killAndDeleteSession,
    listPanes,
    listSessions,
    listTabs,
    markPaneSeen,
    newPane,
    newTab,
    releasePersistentClient,
    renamePane,
    retainPersistentClient,
    sanitizeIdentifier,
    stackPanes,
    validateIdentifier,
    watchPane,
    withTemporaryClient,
    type FloatingCoords,
} from "./cli.ts"
import {
    indexLivePanesById,
    isLayoutMode,
    isPaneKind,
    isPaneStatus,
    isRecord,
    type LayoutMode,
    type PaneKind,
    type PersistedZellijState,
    type SplitDirection,
    type TrackedPane,
    type ZellijPaneJson,
} from "./types.ts"

const STATE_ENTRY_TYPE = "zellij-state"
const MAX_TAIL_READ_BYTES = 512 * 1024
const MAX_FULL_READ_BYTES = 2 * 1024 * 1024
const MAX_TAIL_OUTPUT_CHARS = 48 * 1024
const MAX_FULL_OUTPUT_CHARS = 128 * 1024
const MAX_KEPT_EXITED_PANES = 2
/* eslint-disable no-control-regex */
const ANSI_ESCAPE_RE =
    /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[PX^_][^\x07\x1B]*(?:\x07|\x1B\\)|[@-Z\\-_])/g
const RESIDUAL_ESCAPE_RE = /\x1B(?:\[[0-?]*[ -/]*[@-~]?|[()][0-9A-Za-z]?|.)/g
/* eslint-enable no-control-regex */

const DEFAULT_TAB_NAMES: Record<Exclude<PaneKind, "repl">, string> = {
    task: "tasks",
    service: "services",
    agent: "agents",
}

export interface ArtifactPaths {
    logPath: string
    briefPath: string
    exitMarkerPath: string
}

export interface SpawnOptions {
    kind: PaneKind
    name: string
    command: string[]
    cwd: string
    layout: LayoutMode
    direction?: SplitDirection
    notify?: boolean
    floatingCoords?: FloatingCoords
    noFocus?: boolean
    logPath?: string
    briefPath?: string
    exitMarkerPath?: string
    modelLabel?: string
}

function defaultSessionNameForContext(ctx: ExtensionContext): string {
    const dirSlug = sanitizeIdentifier(basename(ctx.cwd) || "work", "work", 24)
    const shortId = sanitizeIdentifier(ctx.sessionManager.getSessionId().slice(0, 8), "session", 8)
    return validateIdentifier(`pi-${dirSlug}-${shortId}`, "session name")
}

function ensureSafeRuntimeRoot(): string {
    const xdg = process.env.XDG_RUNTIME_DIR?.trim()
    const uid = typeof process.getuid === "function" ? process.getuid() : 0
    if (xdg) {
        const root = join(xdg, `pi-zellij-${uid}`)
        mkdirSync(root, { recursive: true, mode: 0o700 })
        return root
    }

    const candidate = join(tmpdir(), `pi-zellij-${uid}`)
    if (!existsSync(candidate)) {
        mkdirSync(candidate, { recursive: true, mode: 0o700 })
        return candidate
    }
    const stat = lstatSync(candidate)
    if (stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === uid) {
        chmodSync(candidate, 0o700)
        return candidate
    }
    // Pre-created symlink or foreign-owned `/tmp` entry: fall back to a private `0700` temp dir.
    return mkdtempSync(join(tmpdir(), `pi-zellij-${uid}-`))
}

function clampReturnedChars(text: string, maxChars: number, logPath?: string): string {
    if (text.length <= maxChars) return text
    const ref = logPath ? `; full log: ${logPath}` : ""
    return `[... truncated to ${Math.round(maxChars / 1024)} KiB${ref} ...]\n${text.slice(-maxChars)}`
}

function resolveWorkingDir(rawCwd: string, baseCwd: string): string {
    if (rawCwd === "~") return homedir()
    if (rawCwd.startsWith("~/")) return join(homedir(), rawCwd.slice(2))
    return resolve(baseCwd, rawCwd)
}

function stripAnsi(text: string): string {
    return text.replace(ANSI_ESCAPE_RE, "")
}

/**
 * Normalize terminal text into single-line printable ASCII (`0x20..0x7E`):
 * strips ANSI/control sequences, resolves `\r` overwrites and `\x08` backspaces,
 * replaces non-ASCII runs with `?` (dropping leading bullet `? `), and caps length.
 */
export function sanitizeAsciiText(raw: string, maxChars = 200): string {
    if (maxChars <= 0 || !raw) return ""
    const withoutAnsi = stripAnsi(raw).replace(RESIDUAL_ESCAPE_RE, "")
    const segments = withoutAnsi.split("\r")
    let selected = ""
    for (let i = segments.length - 1; i >= 0; i -= 1) {
        const seg = segments[i]
        if (seg && seg.trim().length > 0) {
            selected = seg
            break
        }
    }
    if (!selected) return ""

    const chars: string[] = []
    for (const ch of selected) {
        const code = ch.codePointAt(0) ?? 0
        if (code === 0x08) {
            chars.pop()
            continue
        }
        if (ch === "\t" || ch === "\n") {
            chars.push(" ")
            continue
        }
        if ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) {
            continue
        }
        chars.push(ch)
    }

    const joined = chars.join("")
    const hadLeadingNonAscii = /^[^\x20-\x7e]/.test(joined.trimStart())
    let ascii = joined.replace(/[^\x20-\x7e]+/g, "?")
    if (hadLeadingNonAscii) {
        ascii = ascii.replace(/^\?+\s+(?=[A-Za-z0-9[(])/, "")
    }
    ascii = ascii.replace(/\s+/g, " ").trim()

    if (!ascii) return ""
    if (ascii.length <= maxChars) return ascii
    if (maxChars <= 3) return ascii.slice(0, maxChars)
    return `${ascii.slice(0, maxChars - 3)}...`
}

function removeArtifacts(
    pane: TrackedPane,
    opts?: { keepLog?: boolean; keepBrief?: boolean },
): void {
    if (!opts?.keepLog && pane.logPath) rmSync(pane.logPath, { force: true })
    if (!opts?.keepBrief && pane.briefPath) rmSync(pane.briefPath, { force: true })
    if (pane.exitMarkerPath) rmSync(pane.exitMarkerPath, { force: true })
}

/**
 * Read up to `maxBytes` from the tail of `filePath`.
 * Respects actual `readSync` byte counts so concurrent truncation cannot expose uninitialized memory.
 */
export function readTailFromFile(
    filePath: string,
    maxBytes: number,
): { text: string; truncatedBytes: number } {
    const size = statSync(filePath).size
    if (size === 0) return { text: "", truncatedBytes: 0 }
    const bytesToRead = Math.min(size, maxBytes)
    const startOffset = size - bytesToRead
    const buffer = Buffer.allocUnsafe(bytesToRead)
    const fd = openSync(filePath, "r")
    let bytesRead: number
    try {
        bytesRead = readSync(fd, buffer, 0, bytesToRead, startOffset)
    } finally {
        closeSync(fd)
    }
    let text = buffer.subarray(0, bytesRead).toString("utf-8")
    if (startOffset > 0) {
        const firstNewline = text.indexOf("\n")
        if (firstNewline !== -1 && firstNewline < text.length - 1) {
            text = text.slice(firstNewline + 1)
        }
    }
    return { text, truncatedBytes: startOffset }
}

/** Parse the exit code written by a wrapped pane's exit marker, or null if absent/invalid. */
export function readExitMarker(exitMarkerPath?: string): number | null {
    if (!exitMarkerPath || !existsSync(exitMarkerPath)) return null
    try {
        const raw = readFileSync(exitMarkerPath, "utf-8").trim()
        if (!/^-?\d+$/.test(raw)) return null
        return parseInt(raw, 10)
    } catch {
        return null
    }
}

/** Validate and deserialize a `zellij-state` session entry. Returns null for invalid payloads. */
export function parsePersistedState(data: unknown): PersistedZellijState | null {
    if (!isRecord(data)) return null
    if (typeof data.sessionName !== "string" || typeof data.managedSession !== "boolean") {
        return null
    }
    if (!Array.isArray(data.panes)) return null
    const panes: TrackedPane[] = []
    for (const item of data.panes) {
        if (!isRecord(item)) continue
        if (
            typeof item.paneId !== "string" ||
            typeof item.numericId !== "number" ||
            !Number.isFinite(item.numericId) ||
            typeof item.tabId !== "number" ||
            !Number.isFinite(item.tabId) ||
            typeof item.tabName !== "string" ||
            typeof item.name !== "string" ||
            !isPaneKind(item.kind) ||
            !isLayoutMode(item.layout) ||
            typeof item.command !== "string" ||
            typeof item.cwd !== "string" ||
            typeof item.startedAt !== "number" ||
            !isPaneStatus(item.status)
        ) {
            continue
        }
        const paneId = sanitizeAsciiText(item.paneId, 64)
        const name = sanitizeAsciiText(item.name, 64)
        const tabName = sanitizeAsciiText(item.tabName, 64) || "tab"
        if (!paneId || !name) continue

        panes.push({
            paneId,
            numericId: item.numericId,
            tabId: item.tabId,
            tabName,
            name,
            kind: item.kind,
            layout: item.layout,
            command: item.command,
            cwd: item.cwd,
            logPath: typeof item.logPath === "string" ? item.logPath : undefined,
            briefPath: typeof item.briefPath === "string" ? item.briefPath : undefined,
            exitMarkerPath:
                typeof item.exitMarkerPath === "string" ? item.exitMarkerPath : undefined,
            modelLabel: typeof item.modelLabel === "string" ? item.modelLabel : undefined,
            startedAt: item.startedAt,
            endedAt: typeof item.endedAt === "number" ? item.endedAt : undefined,
            status: item.status,
            exitCode:
                typeof item.exitCode === "number" || item.exitCode === null
                    ? item.exitCode
                    : undefined,
            notifiedCompletion:
                typeof item.notifiedCompletion === "boolean" ? item.notifiedCompletion : undefined,
            lastAttentionSignature:
                typeof item.lastAttentionSignature === "string"
                    ? item.lastAttentionSignature
                    : undefined,
            needsAttention:
                typeof item.needsAttention === "boolean" ? item.needsAttention : undefined,
            markedSeen: typeof item.markedSeen === "boolean" ? item.markedSeen : undefined,
            lastOutputLine:
                typeof item.lastOutputLine === "string"
                    ? sanitizeAsciiText(item.lastOutputLine, 200) || undefined
                    : undefined,
        })
    }
    return {
        sessionName: data.sessionName,
        managedSession: data.managedSession,
        panes,
    }
}

/**
 * Manages the 1:1 mapping between a Pi session and a Zellij session,
 * pane topology (`tasks`, `services`, `agents`, `floating`), and state persistence.
 */
export class ZellijSessionManager {
    private readonly pi: ExtensionAPI
    private ctx: ExtensionContext | undefined
    private sessionName = ""
    private managedSession = false
    private sessionReady = false
    private panes = new Map<string, TrackedPane>()
    private runtimeDir = ""
    private exitsDir = ""
    private artifactSeq = 0
    private lastPersistedJson = ""
    private shuttingDown = false
    private closingPaneIds = new Set<string>()
    private spawnQueue: Promise<unknown> = Promise.resolve()

    constructor(pi: ExtensionAPI) {
        this.pi = pi
    }

    bindContext(ctx: ExtensionContext): void {
        this.ctx = ctx
        this.shuttingDown = false
        this.closingPaneIds.clear()
        const envSession = process.env.ZELLIJ_SESSION_NAME?.trim()
        if (envSession) {
            this.sessionName = envSession
            this.managedSession = false
            this.sessionReady = true
        } else {
            this.sessionName = defaultSessionNameForContext(ctx)
            this.managedSession = true
            this.sessionReady = false
        }

        const sessionKey = sanitizeIdentifier(ctx.sessionManager.getSessionId(), "default", 32)
        this.runtimeDir = join(ensureSafeRuntimeRoot(), sessionKey)
        this.exitsDir = join(this.runtimeDir, "exits")
        mkdirSync(this.runtimeDir, { recursive: true, mode: 0o700 })
        mkdirSync(this.exitsDir, { recursive: true, mode: 0o700 })
    }

    getContext(): ExtensionContext | undefined {
        return this.ctx
    }

    getSessionName(): string {
        return this.sessionName
    }

    getExitsDir(): string {
        return this.exitsDir
    }

    isManagedSession(): boolean {
        return this.managedSession
    }

    isSessionReady(): boolean {
        return this.sessionReady
    }

    isClosingPane(paneId: string): boolean {
        return this.closingPaneIds.has(paneId)
    }

    getAttachHint(): string | undefined {
        if (!this.managedSession || !this.sessionReady || !this.sessionName) return undefined
        return `zellij attach ${this.sessionName}`
    }

    getTrackedPanes(): TrackedPane[] {
        return Array.from(this.panes.values())
    }

    getRunningPanes(): TrackedPane[] {
        return this.getTrackedPanes().filter((p) => p.status === "running")
    }

    /** Look up a tracked pane by ID or name (optionally filtered by kind). */
    getPane(paneIdOrName: string, kind?: PaneKind): TrackedPane | undefined {
        const direct = this.panes.get(paneIdOrName) ?? this.panes.get(formatPaneId(paneIdOrName))
        if (direct && (!kind || direct.kind === kind)) return direct

        const sanitized = sanitizeIdentifier(paneIdOrName, paneIdOrName, 48)
        let latestExited: TrackedPane | undefined
        let latestRunning: TrackedPane | undefined
        for (const pane of this.panes.values()) {
            if (kind && pane.kind !== kind) continue
            if (pane.name !== paneIdOrName && pane.name !== sanitized) continue
            if (pane.status === "running") {
                if (!latestRunning || pane.startedAt > latestRunning.startedAt) {
                    latestRunning = pane
                }
            } else if (pane.status === "exited") {
                if (!latestExited || pane.startedAt > latestExited.startedAt) {
                    latestExited = pane
                }
            }
        }
        return latestRunning ?? latestExited
    }

    allocateArtifactPaths(name: string): ArtifactPaths {
        this.artifactSeq += 1
        const safeName = sanitizeIdentifier(name, "job", 40)
        const stamp = `${Date.now().toString(36)}-${this.artifactSeq}`
        const logDir = join(this.runtimeDir, "logs")
        mkdirSync(logDir, { recursive: true, mode: 0o700 })
        mkdirSync(this.exitsDir, { recursive: true, mode: 0o700 })
        return {
            logPath: join(logDir, `${safeName}-${stamp}.log`),
            briefPath: join(logDir, `${safeName}-${stamp}.task.md`),
            exitMarkerPath: join(this.exitsDir, `${safeName}-${stamp}.exit`),
        }
    }

    writeBriefFile(briefPath: string, content: string): void {
        writeFileSync(briefPath, content, { encoding: "utf-8", mode: 0o600 })
    }

    readLastOutputLine(pane: TrackedPane): string | undefined {
        if (!pane.logPath || !existsSync(pane.logPath)) return undefined
        try {
            const { text } = readTailFromFile(pane.logPath, 16 * 1024)
            const lines = text.split("\n")
            for (let i = lines.length - 1; i >= 0; i -= 1) {
                const candidate = sanitizeAsciiText(lines[i] ?? "", 200)
                if (candidate) return candidate
            }
            return undefined
        } catch {
            return undefined
        }
    }

    async readPaneOutput(
        pane: TrackedPane,
        opts?: { full?: boolean; ansi?: boolean; maxLines?: number; preferScreen?: boolean },
    ): Promise<string> {
        const maxChars = opts?.full ? MAX_FULL_OUTPUT_CHARS : MAX_TAIL_OUTPUT_CHARS
        if (!opts?.preferScreen && pane.logPath && existsSync(pane.logPath)) {
            const byteCap = opts?.full ? MAX_FULL_READ_BYTES : MAX_TAIL_READ_BYTES
            const { text: rawBytes, truncatedBytes } = readTailFromFile(pane.logPath, byteCap)
            const raw = opts?.ansi ? rawBytes : stripAnsi(rawBytes)
            if (opts?.full) {
                const body =
                    truncatedBytes > 0
                        ? `[... ${truncatedBytes} earlier bytes omitted; full log: ${pane.logPath} ...]\n${raw.trimEnd()}`
                        : raw.trimEnd()
                return clampReturnedChars(body, maxChars, pane.logPath)
            }
            const limit = opts?.maxLines ?? 120
            const lines = raw.split(/\r?\n/)
            if (lines.length <= limit && truncatedBytes === 0) {
                return clampReturnedChars(raw.trimEnd(), maxChars, pane.logPath)
            }
            const prefix =
                truncatedBytes > 0
                    ? `[... truncated earlier output; full log: ${pane.logPath} ...]\n`
                    : `[... ${lines.length - limit} earlier lines omitted; full log: ${pane.logPath} ...]\n`
            return clampReturnedChars(
                `${prefix}${lines.slice(-limit).join("\n").trimEnd()}`,
                maxChars,
                pane.logPath,
            )
        }

        const screen = await dumpScreen(this.pi, this.sessionName, pane.paneId, {
            full: opts?.full ?? false,
            ansi: opts?.ansi ?? false,
        })
        const trimmed = screen.trimEnd()
        if (opts?.full) return clampReturnedChars(trimmed, maxChars, pane.logPath)
        const limit = opts?.maxLines ?? 120
        const lines = trimmed.split(/\r?\n/)
        if (lines.length <= limit) return clampReturnedChars(trimmed, maxChars, pane.logPath)
        return clampReturnedChars(
            `[... ${lines.length - limit} earlier lines omitted ...]\n${lines.slice(-limit).join("\n")}`,
            maxChars,
            pane.logPath,
        )
    }

    async restoreFromSession(
        ctx: ExtensionContext,
        reason?: "startup" | "reload" | "new" | "resume" | "fork",
    ): Promise<void> {
        this.bindContext(ctx)
        this.panes.clear()
        this.lastPersistedJson = ""

        // Forked sessions must start with their own isolated Zellij session and pane set.
        if (reason === "fork") return

        let restored: PersistedZellijState | null = null
        for (const entry of ctx.sessionManager.getBranch()) {
            if (entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE) {
                const parsed = parsePersistedState(entry.data)
                if (parsed) restored = parsed
            }
        }

        if (!restored) return

        if (this.managedSession) {
            if (restored.managedSession && restored.sessionName) {
                this.sessionName = restored.sessionName
            }
        } else if (restored.sessionName !== this.sessionName) {
            // Do not match persisted IDs against a different host Zellij session.
            return
        }

        const liveSessions = await listSessions(this.pi)
        if (!liveSessions.includes(this.sessionName)) {
            return
        }

        this.sessionReady = true
        const livePanes = await listPanes(this.pi, this.sessionName).catch(
            () => [] as ZellijPaneJson[],
        )
        const liveById = indexLivePanesById(livePanes)

        for (const pane of restored.panes) {
            if (pane.status === "closed") continue
            const live = liveById.get(pane.numericId)
            if (!live) continue
            const prevExit = pane.exitCode ?? null
            pane.status = live.exited ? "exited" : "running"
            pane.exitCode =
                live.exit_status ??
                live.command_state?.lastExitCode ??
                (live.exited ? readExitMarker(pane.exitMarkerPath) : null) ??
                (live.exited ? prevExit : null)
            if (pane.status === "exited") {
                pane.needsAttention = false
                pane.endedAt = pane.endedAt ?? Date.now()
                pane.notifiedCompletion = true
            }
            if (!pane.needsAttention) {
                pane.lastOutputLine =
                    this.readLastOutputLine(pane) ??
                    (pane.lastOutputLine ? sanitizeAsciiText(pane.lastOutputLine, 200) : undefined)
            } else if (pane.lastOutputLine) {
                pane.lastOutputLine = sanitizeAsciiText(pane.lastOutputLine, 200) || undefined
            }
            this.panes.set(pane.paneId, pane)
        }

        if (this.managedSession && this.panes.size > 0) {
            await retainPersistentClient(this.pi, this.sessionName).catch(() => {})
        }
    }

    markShuttingDown(): void {
        this.shuttingDown = true
    }

    persist(): void {
        if (this.shuttingDown) return
        const snapshot: PersistedZellijState = {
            sessionName: this.sessionName,
            managedSession: this.managedSession,
            panes: Array.from(this.panes.values()).filter((p) => p.status !== "closed"),
        }
        const serialized = JSON.stringify(snapshot)
        if (serialized === this.lastPersistedJson) return
        this.lastPersistedJson = serialized
        this.pi.appendEntry(STATE_ENTRY_TYPE, snapshot)
    }

    async ensureSession(): Promise<string> {
        if (!this.sessionName) {
            throw new Error("Zellij session manager is not initialized yet.")
        }

        if (this.managedSession) {
            const live = await listSessions(this.pi)
            if (!live.includes(this.sessionName)) {
                await ensureBackgroundSession(this.pi, this.sessionName)
            }
            this.sessionReady = true
            return this.sessionName
        }

        this.sessionReady = true
        return this.sessionName
    }

    releaseSessionClient(): void {
        if (this.managedSession && this.sessionName) {
            releasePersistentClient(this.sessionName)
        }
    }

    private finalizeClosedPane(
        pane: TrackedPane,
        opts?: {
            keepLog?: boolean
            keepBrief?: boolean
            skipPersist?: boolean
            keepClient?: boolean
        },
    ): void {
        pane.status = "closed"
        pane.endedAt = pane.endedAt ?? Date.now()
        this.closingPaneIds.delete(pane.paneId)
        this.panes.delete(pane.paneId)
        removeArtifacts(pane, {
            keepLog: opts?.keepLog,
            keepBrief: opts?.keepBrief,
        })
        if (!opts?.skipPersist) {
            this.persist()
        }
        if (this.panes.size === 0 && !opts?.keepClient) {
            this.releaseSessionClient()
        }
    }

    private enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.spawnQueue.then(fn)
        this.spawnQueue = next.catch(() => {})
        return next
    }

    async destroyManagedSessionIfEmpty(): Promise<void> {
        return this.enqueueMutation(() => this.destroyManagedSessionIfEmptyUnlocked())
    }

    private async destroyManagedSessionIfEmptyUnlocked(): Promise<void> {
        if (!this.managedSession || !this.sessionReady || !this.sessionName) return
        if (this.getRunningPanes().length > 0) return

        this.releaseSessionClient()
        await killAndDeleteSession(this.pi, this.sessionName)
        for (const pane of Array.from(this.panes.values())) {
            this.finalizeClosedPane(pane, { skipPersist: true })
        }
        this.persist()
        this.sessionReady = false
    }

    async spawnInTopology(opts: SpawnOptions): Promise<TrackedPane> {
        // Serialize topology and lifecycle mutations so concurrent calls do not race.
        return this.enqueueMutation(() => this.spawnInTopologyUnlocked(opts))
    }

    private async pruneOlderExitedPanesUnlocked(opts?: { keepClient?: boolean }): Promise<void> {
        const exited = Array.from(this.panes.values())
            .filter((p) => p.status === "exited" && p.notifiedCompletion)
            .sort((a, b) => (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt))

        let pruned = false
        while (exited.length > MAX_KEPT_EXITED_PANES) {
            const oldest = exited.shift()
            if (!oldest) break
            try {
                await this.tryClosePaneSafe(oldest.paneId)
            } catch {
                // Leave pane tracked and preserve artifacts if closing failed.
                continue
            }
            this.finalizeClosedPane(oldest, {
                keepLog: true,
                skipPersist: true,
                keepClient: opts?.keepClient,
            })
            pruned = true
        }
        if (pruned) {
            this.persist()
        }
    }

    async reapCompletedPanes(): Promise<TrackedPane[]> {
        return this.enqueueMutation(() => this.reapCompletedPanesUnlocked())
    }

    private async reapCompletedPanesUnlocked(opts?: {
        keepClient?: boolean
    }): Promise<TrackedPane[]> {
        const candidates = Array.from(this.panes.values()).filter(
            (p) =>
                p.status === "exited" &&
                p.notifiedCompletion &&
                (((p.kind === "task" || p.kind === "agent") && p.exitCode === 0) ||
                    p.kind === "repl"),
        )

        const closed: TrackedPane[] = []
        for (const pane of candidates) {
            try {
                await this.tryClosePaneSafe(pane.paneId)
            } catch {
                // Leave pane tracked and preserve artifacts if closing failed.
                continue
            }
            this.finalizeClosedPane(pane, {
                keepLog: true,
                skipPersist: true,
                keepClient: opts?.keepClient,
            })
            closed.push(pane)
        }

        if (closed.length > 0) {
            this.persist()
        }
        await this.pruneOlderExitedPanesUnlocked(opts)
        return closed
    }

    cleanupRuntimeDir(): void {
        if (this.runtimeDir && existsSync(this.runtimeDir)) {
            rmSync(this.runtimeDir, { recursive: true, force: true })
        }
    }

    private async spawnInTopologyUnlocked(opts: SpawnOptions): Promise<TrackedPane> {
        const session = await this.ensureSession()
        // Keep any existing helper client attached while reaping before spawn so reaping to 0 does
        // not release and immediately re-attach a helper client.
        await this.reapCompletedPanesUnlocked({ keepClient: true })
        if (this.managedSession) {
            await retainPersistentClient(this.pi, session).catch(() => {})
        }

        const safeName = sanitizeIdentifier(opts.name, opts.kind, 48)
        const baseCwd = this.ctx?.cwd ?? process.cwd()
        const resolvedCwd = resolveWorkingDir(opts.cwd, baseCwd)

        let paneId: string
        let numericId: number
        let tabId: number
        let tabName: string

        if (opts.layout === "floating") {
            const tabs = await listTabs(this.pi, session)
            const activeTab = tabs.find((t) => t.active) ?? tabs[0]
            tabId = activeTab?.tab_id ?? 0
            tabName = activeTab?.name ?? "active"
            const created = await newPane(this.pi, session, {
                cwd: resolvedCwd,
                name: safeName,
                tabId: activeTab ? activeTab.tab_id : undefined,
                floating: true,
                floatingCoords: opts.floatingCoords ?? {
                    x: "10%",
                    y: "10%",
                    width: "80%",
                    height: "80%",
                },
                noFocus: opts.noFocus ?? false,
                notify: opts.notify ?? false,
                command: opts.command,
            })
            paneId = created.paneId
            numericId = created.numericId
        } else if (opts.layout === "split") {
            const tabs = await listTabs(this.pi, session)
            const activeTab = tabs.find((t) => t.active) ?? tabs[0]
            tabId = activeTab?.tab_id ?? 0
            tabName = activeTab?.name ?? "active"
            const created = await newPane(this.pi, session, {
                cwd: resolvedCwd,
                name: safeName,
                tabId: activeTab ? activeTab.tab_id : undefined,
                direction: opts.direction ?? "down",
                noFocus: opts.noFocus ?? true,
                notify: opts.notify ?? true,
                command: opts.command,
            })
            paneId = created.paneId
            numericId = created.numericId
        } else if (opts.layout === "tab") {
            const created = await this.createTabWithInitialPane(
                session,
                safeName,
                safeName,
                resolvedCwd,
                opts.command,
                opts.notify ?? true,
            )
            paneId = created.paneId
            numericId = created.numericId
            tabId = created.tabId
            tabName = safeName
        } else {
            // Default: stacked inside the dedicated category tab (`tasks`, `services`, `agents`).
            const categoryTab = opts.kind === "repl" ? "repl" : DEFAULT_TAB_NAMES[opts.kind]
            tabName = categoryTab
            const tabs = await listTabs(this.pi, session)
            const existingTab = tabs.find((t) => t.name === categoryTab)

            if (!existingTab) {
                const created = await this.createTabWithInitialPane(
                    session,
                    categoryTab,
                    safeName,
                    resolvedCwd,
                    opts.command,
                    opts.notify ?? true,
                )
                paneId = created.paneId
                numericId = created.numericId
                tabId = created.tabId
            } else {
                tabId = existingTab.tab_id
                const created = await this.createStackedPaneInExistingTab(
                    session,
                    tabId,
                    safeName,
                    resolvedCwd,
                    opts.command,
                    opts.notify ?? true,
                )
                paneId = created.paneId
                numericId = created.numericId
            }
        }

        const tracked: TrackedPane = {
            paneId,
            numericId,
            tabId,
            tabName,
            name: safeName,
            kind: opts.kind,
            layout: opts.layout,
            command: opts.command.join(" "),
            cwd: resolvedCwd,
            logPath: opts.logPath,
            briefPath: opts.briefPath,
            exitMarkerPath: opts.exitMarkerPath,
            modelLabel: opts.modelLabel,
            startedAt: Date.now(),
            status: "running",
        }
        this.panes.set(tracked.paneId, tracked)
        this.persist()
        return tracked
    }

    private async createStackedPaneInExistingTab(
        session: string,
        tabId: number,
        paneName: string,
        cwd: string,
        command: string[],
        notify: boolean,
    ): Promise<{ paneId: string; numericId: number }> {
        return withTemporaryClient(this.pi, session, async () => {
            let created: { paneId: string; numericId: number }
            try {
                created = await newPane(this.pi, session, {
                    cwd,
                    name: paneName,
                    tabId,
                    stacked: true,
                    noFocus: true,
                    notify,
                    command,
                })
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                if (!msg.includes("No room for a new pane")) {
                    throw err
                }
                // Zellij 0.46 can report "No room for a new pane" with `--stacked` on an
                // unfocused tab after client detach/reattach; split then stack explicitly.
                created = await newPane(this.pi, session, {
                    cwd,
                    name: paneName,
                    tabId,
                    noFocus: true,
                    notify,
                    command,
                })
            }

            // Managed category tabs intentionally keep all tiled panes stacked together.
            const tabPanes = (await listPanes(this.pi, session).catch(() => [] as ZellijPaneJson[]))
                .filter((p) => !p.is_plugin && !p.is_floating && p.tab_id === tabId)
                .map((p) => formatPaneId(p.id))
            if (tabPanes.length >= 2) {
                await stackPanes(this.pi, session, tabPanes).catch(() => {})
            }
            return created
        })
    }

    private async createTabWithInitialPane(
        session: string,
        tabName: string,
        paneName: string,
        cwd: string,
        command: string[],
        notify: boolean,
    ): Promise<{ tabId: number; paneId: string; numericId: number }> {
        return withTemporaryClient(this.pi, session, async () => {
            const tabId = await newTab(this.pi, session, {
                name: tabName,
                cwd,
                noFocus: true,
                command,
            })

            let matched: ZellijPaneJson | undefined
            for (let i = 0; i < 15; i++) {
                const panes = await listPanes(this.pi, session).catch(() => [] as ZellijPaneJson[])
                matched = panes.find((p) => !p.is_plugin && p.tab_id === tabId)
                if (matched) break
                await new Promise((done) => setTimeout(done, 40))
            }
            if (!matched) {
                await closeTabById(this.pi, session, tabId).catch(() => {})
                throw new Error(
                    `Created tab "${tabName}" (id ${tabId}), but could not locate its pane.`,
                )
            }
            const paneId = formatPaneId(matched.id)
            await renamePane(this.pi, session, paneId, paneName).catch(() => {})
            if (notify) {
                await watchPane(this.pi, session, paneId).catch(() => {})
            }
            return { tabId, paneId, numericId: matched.id }
        })
    }

    /**
     * Attempt to close `paneId`. If `closePane` fails, verify whether the pane still
     * exists in Zellij before throwing so genuine already-gone panes clean up safely.
     */
    private async tryClosePaneSafe(paneId: string): Promise<void> {
        this.closingPaneIds.add(paneId)
        const tracked = this.panes.get(paneId)
        if (!tracked?.markedSeen) {
            await markPaneSeen(this.pi, this.sessionName, paneId)
                .then(() => {
                    if (tracked) tracked.markedSeen = true
                })
                .catch(() => {})
        }
        try {
            await closePane(this.pi, this.sessionName, paneId)
        } catch (err) {
            let keepClosing = false
            try {
                const sessions = await listSessions(this.pi)
                if (!sessions.includes(this.sessionName)) {
                    keepClosing = true
                } else {
                    const live = await listPanes(this.pi, this.sessionName).catch(() => null)
                    if (live !== null) {
                        keepClosing = !live.some(
                            (p) => !p.is_plugin && formatPaneId(p.id) === paneId,
                        )
                    }
                }
            } catch {
                keepClosing = false
            }
            if (!keepClosing) {
                this.closingPaneIds.delete(paneId)
                throw err
            }
        }
    }

    async closeTrackedPane(paneIdOrName: string, kind?: PaneKind): Promise<TrackedPane> {
        return this.enqueueMutation(async () => {
            const tracked = this.getPane(paneIdOrName, kind)
            if (!tracked) {
                throw new Error(`No tracked zellij pane matches "${paneIdOrName}".`)
            }
            await this.tryClosePaneSafe(tracked.paneId)
            this.finalizeClosedPane(tracked)
            return tracked
        })
    }

    async sweep(opts?: { killRunning?: boolean }): Promise<{
        closed: TrackedPane[]
        keptRunning: TrackedPane[]
        failed: Array<{ pane: TrackedPane; error: string }>
    }> {
        return this.enqueueMutation(async () => {
            const closed: TrackedPane[] = []
            const keptRunning: TrackedPane[] = []
            const failed: Array<{ pane: TrackedPane; error: string }> = []

            for (const pane of Array.from(this.panes.values())) {
                if (pane.status === "running" && !opts?.killRunning) {
                    keptRunning.push(pane)
                    continue
                }
                try {
                    await this.tryClosePaneSafe(pane.paneId)
                } catch (err) {
                    failed.push({
                        pane,
                        error: err instanceof Error ? err.message : String(err),
                    })
                    continue
                }
                this.finalizeClosedPane(pane, { skipPersist: true })
                closed.push(pane)
            }

            if (closed.length > 0) {
                this.persist()
            }
            return { closed, keptRunning, failed }
        })
    }

    markPaneUpdated(): void {
        this.persist()
    }

    removePane(paneId: string, opts?: { keepLog?: boolean; keepBrief?: boolean }): void {
        const pane = this.panes.get(paneId)
        if (pane) {
            this.finalizeClosedPane(pane, opts)
        }
    }
}
