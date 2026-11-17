import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import {
    closePane,
    dumpScreen,
    ensureBackgroundSession,
    formatPaneId,
    listPanes,
    listSessions,
    listTabs,
    newPane,
    newTab,
    renamePane,
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
    type SubagentMode,
    type TrackedPane,
    type ZellijPaneJson,
} from "./types.ts"

const STATE_ENTRY_TYPE = "zellij-state"

const DEFAULT_TAB_NAMES: Record<Exclude<PaneKind, "repl">, string> = {
    task: "tasks",
    service: "services",
    agent: "agents",
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
    subagentMode?: SubagentMode
    modelLabel?: string
}

function defaultSessionNameForContext(ctx: ExtensionContext): string {
    const dirSlug = sanitizeIdentifier(basename(ctx.cwd) || "work", "work", 24)
    const shortId = sanitizeIdentifier(ctx.sessionManager.getSessionId().slice(0, 8), "session", 8)
    return validateIdentifier(`pi-${dirSlug}-${shortId}`, "session name")
}

function runtimeRootDir(): string {
    const base = process.env.XDG_RUNTIME_DIR || "/tmp"
    const uid = typeof process.getuid === "function" ? process.getuid() : 0
    return join(base, `pi-zellij-${uid}`)
}

function resolveWorkingDir(rawCwd: string, baseCwd: string): string {
    if (rawCwd === "~") return homedir()
    if (rawCwd.startsWith("~/")) return join(homedir(), rawCwd.slice(2))
    return resolve(baseCwd, rawCwd)
}

function removeArtifacts(pane: TrackedPane): void {
    if (pane.logPath) rmSync(pane.logPath, { force: true })
    if (pane.briefPath) rmSync(pane.briefPath, { force: true })
}

function parsePersistedState(data: unknown): PersistedZellijState | null {
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
        panes.push({
            paneId: item.paneId,
            numericId: item.numericId,
            tabId: item.tabId,
            tabName: item.tabName,
            name: item.name,
            kind: item.kind,
            layout: item.layout,
            command: item.command,
            cwd: item.cwd,
            logPath: typeof item.logPath === "string" ? item.logPath : undefined,
            briefPath: typeof item.briefPath === "string" ? item.briefPath : undefined,
            subagentMode:
                item.subagentMode === "one-shot" || item.subagentMode === "rpc"
                    ? item.subagentMode
                    : undefined,
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
    private artifactSeq = 0
    private spawnQueue: Promise<unknown> = Promise.resolve()

    constructor(pi: ExtensionAPI) {
        this.pi = pi
    }

    bindContext(ctx: ExtensionContext): void {
        this.ctx = ctx
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
        this.runtimeDir = join(runtimeRootDir(), sessionKey)
        mkdirSync(this.runtimeDir, { recursive: true, mode: 0o700 })
    }

    getContext(): ExtensionContext | undefined {
        return this.ctx
    }

    getSessionName(): string {
        return this.sessionName
    }

    isManagedSession(): boolean {
        return this.managedSession
    }

    isSessionReady(): boolean {
        return this.sessionReady
    }

    getRuntimeDir(): string {
        return this.runtimeDir
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

    allocateArtifactPaths(name: string): { logPath: string; briefPath: string } {
        this.artifactSeq += 1
        const safeName = sanitizeIdentifier(name, "job", 40)
        const stamp = `${Date.now().toString(36)}-${this.artifactSeq}`
        const logDir = join(this.runtimeDir, "logs")
        mkdirSync(logDir, { recursive: true, mode: 0o700 })
        return {
            logPath: join(logDir, `${safeName}-${stamp}.log`),
            briefPath: join(logDir, `${safeName}-${stamp}.task.md`),
        }
    }

    writeBriefFile(briefPath: string, content: string): void {
        writeFileSync(briefPath, content, { encoding: "utf-8", mode: 0o600 })
    }

    async readPaneOutput(
        pane: TrackedPane,
        opts?: { full?: boolean; ansi?: boolean; maxLines?: number; preferScreen?: boolean },
    ): Promise<string> {
        if (!opts?.ansi && !opts?.preferScreen && pane.logPath && existsSync(pane.logPath)) {
            const raw = readFileSync(pane.logPath, "utf-8")
            if (opts?.full) return raw.trimEnd()
            const limit = opts?.maxLines ?? 120
            const lines = raw.split(/\r?\n/)
            if (lines.length <= limit) return raw.trimEnd()
            return `[... ${lines.length - limit} earlier lines omitted; full log: ${pane.logPath} ...]\n${lines.slice(-limit).join("\n").trimEnd()}`
        }

        const screen = await dumpScreen(this.pi, this.sessionName, pane.paneId, {
            full: opts?.full ?? true,
            ansi: opts?.ansi ?? false,
        })
        return screen.trimEnd()
    }

    async restoreFromSession(
        ctx: ExtensionContext,
        reason?: "startup" | "reload" | "new" | "resume" | "fork",
    ): Promise<void> {
        this.bindContext(ctx)
        this.panes.clear()

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
            pane.status = live.exited ? "exited" : "running"
            pane.exitCode = live.exit_status
            this.panes.set(pane.paneId, pane)
        }
    }

    persist(): void {
        const snapshot: PersistedZellijState = {
            sessionName: this.sessionName,
            managedSession: this.managedSession,
            panes: Array.from(this.panes.values()).filter((p) => p.status !== "closed"),
        }
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

    async spawnInTopology(opts: SpawnOptions): Promise<TrackedPane> {
        // Serialize topology mutations so concurrent calls do not race creating the same category tab.
        const next = this.spawnQueue.then(() => this.spawnInTopologyUnlocked(opts))
        this.spawnQueue = next.catch(() => {})
        return next
    }

    private async spawnInTopologyUnlocked(opts: SpawnOptions): Promise<TrackedPane> {
        const session = await this.ensureSession()
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
            subagentMode: opts.subagentMode,
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

            const tabPanes = (await listPanes(this.pi, session))
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
                const panes = await listPanes(this.pi, session)
                matched = panes.find((p) => !p.is_plugin && p.tab_id === tabId)
                if (matched) break
                await new Promise((resolve) => setTimeout(resolve, 40))
            }
            if (!matched) {
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

    async closeTrackedPane(paneIdOrName: string, kind?: PaneKind): Promise<TrackedPane> {
        const tracked = this.getPane(paneIdOrName, kind)
        if (!tracked) {
            throw new Error(`No tracked zellij pane matches "${paneIdOrName}".`)
        }
        await closePane(this.pi, this.sessionName, tracked.paneId).catch(() => {})
        tracked.status = "closed"
        tracked.endedAt = tracked.endedAt ?? Date.now()
        this.panes.delete(tracked.paneId)
        removeArtifacts(tracked)
        this.persist()
        return tracked
    }

    async sweep(opts?: { killRunning?: boolean }): Promise<{
        closed: TrackedPane[]
        keptRunning: TrackedPane[]
    }> {
        const closed: TrackedPane[] = []
        const keptRunning: TrackedPane[] = []

        for (const pane of Array.from(this.panes.values())) {
            if (pane.status === "running" && !opts?.killRunning) {
                keptRunning.push(pane)
                continue
            }
            await closePane(this.pi, this.sessionName, pane.paneId).catch(() => {})
            pane.status = "closed"
            pane.endedAt = pane.endedAt ?? Date.now()
            this.panes.delete(pane.paneId)
            removeArtifacts(pane)
            closed.push(pane)
        }

        if (closed.length > 0) {
            this.persist()
        }
        return { closed, keptRunning }
    }

    markPaneUpdated(): void {
        this.persist()
    }

    removePane(paneId: string): void {
        const pane = this.panes.get(paneId)
        if (pane) {
            this.panes.delete(paneId)
            removeArtifacts(pane)
            this.persist()
        }
    }
}
