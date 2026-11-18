import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, statSync, watch, type FSWatcher } from "node:fs"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { listPanes, listSessions, markPaneSeen, promptNotify } from "./cli.ts"
import {
    readExitMarker,
    readTailFromFile,
    sanitizeAsciiText,
    type ZellijSessionManager,
} from "./session.ts"
import {
    indexLivePanesById,
    isRecord,
    type TrackedPane,
    type ZellijEventDetails,
    type ZellijPaneJson,
} from "./types.ts"

const RECONCILE_INTERVAL_MS = 3_000
const MAX_WIDGET_ROWS = 5
const READY_LOG_TAIL_BYTES = 64 * 1024
const CLOSED_SUB_BACKOFF_MS = [1_000, 2_000, 5_000, 30_000]
// Match explicit interactive prompts only; avoid bare `:`, `?`, or `>` on normal log lines.
const INTERACTIVE_PROMPT_RE =
    /(?:\[[yYnN]\/[yYnN]\]|\(y\/n\)|(?:password|passphrase|pin|otp|token)\s*:\s*$|continue\?\s*$|\(yes\/no\)\s*[:?]?\s*$)/i

function formatDuration(ms: number): string {
    const secs = Math.max(0, Math.floor(ms / 1000))
    if (secs < 60) return `${secs}s`
    const mins = Math.floor(secs / 60)
    const rem = secs % 60
    return `${mins}m${rem}s`
}

function charDisplayWidth(ch: string): number {
    if (ch === "\t") return 3
    const cp = ch.codePointAt(0) ?? 0
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return 0
    return cp > 0xff ? 2 : 1
}

function stringDisplayWidth(text: string): number {
    let cols = 0
    for (const ch of text) {
        cols += charDisplayWidth(ch)
    }
    return cols
}

function fitPlain(text: string, maxCols: number): string {
    if (maxCols <= 0) return ""
    if (stringDisplayWidth(text) <= maxCols) return text
    const target = maxCols <= 3 ? maxCols : maxCols - 3
    let out = ""
    let cols = 0
    for (const ch of text) {
        const w = charDisplayWidth(ch)
        if (cols + w > target) break
        out += ch
        cols += w
    }
    return maxCols <= 3 ? out : `${out}...`
}

function formatPaneWidgetParts(pane: TrackedPane): {
    badgePlain: string
    badgeColor: "warning" | "accent" | "success" | "error"
    safeKind: string
    safeName: string
    headPlain: string
    metaPlain: string
} {
    const elapsed = formatDuration((pane.endedAt ?? Date.now()) - pane.startedAt)
    const badgePlain =
        pane.status === "running" && pane.needsAttention
            ? `[input ${elapsed}]`
            : pane.status === "running"
              ? `[run ${elapsed}]`
              : pane.exitCode === 0
                ? `[ok ${elapsed}]`
                : `[err:${pane.exitCode ?? "?"} ${elapsed}]`
    const badgeColor =
        pane.status === "running" && pane.needsAttention
            ? "warning"
            : pane.status === "running"
              ? "accent"
              : pane.exitCode === 0
                ? "success"
                : "error"
    const safeKind = sanitizeAsciiText(pane.kind, 16) || "pane"
    const safeName = sanitizeAsciiText(pane.name, 48) || "pane"
    const safePaneId = sanitizeAsciiText(pane.paneId, 48) || "pane"
    const tabLabel = sanitizeAsciiText(pane.tabName, 48) || "tab"
    const outputPreview = pane.lastOutputLine ? sanitizeAsciiText(pane.lastOutputLine, 200) : ""
    const headPlain = `${badgePlain} ${safeKind}:${safeName}`
    const metaPlain = outputPreview
        ? ` | ${outputPreview}`
        : ` (${safePaneId} @ ${tabLabel}/${pane.layout})`
    return { badgePlain, badgeColor, safeKind, safeName, headPlain, metaPlain }
}

interface WaitEntry {
    resolve: (exited: boolean) => void
}

/**
 * Monitors tracked Zellij panes via exit-marker `fs.watch`, a passive `pane_closed`
 * subscriber when only exited panes remain, and `followUp` turn injection.
 */
export class PaneWatcher {
    private readonly pi: ExtensionAPI
    private readonly manager: ZellijSessionManager
    private pollTimer: ReturnType<typeof setInterval> | undefined
    private exitWatcher: FSWatcher | undefined
    private exitFollowupTimer: ReturnType<typeof setTimeout> | undefined
    private closedSubscriber: ChildProcess | undefined
    private subscribedClosedKey = ""
    private closedSubRetries = 0
    private closedSubRetryTimer: ReturnType<typeof setTimeout> | undefined
    private inFlightSync: Promise<void> | undefined
    private syncQueued = false
    private disposed = false
    private generation = 0
    private consecutiveSyncErrors = 0
    private suppressedNotifyPanes = new Set<string>()
    private markSeenInFlight = new Set<string>()
    private exitWaiters = new Map<string, Set<WaitEntry>>()
    private activeSubscribers = new Set<ChildProcess>()
    private lastStatusText: string | undefined | null = null
    private lastPlainWidgetKey: string | null = null

    constructor(pi: ExtensionAPI, manager: ZellijSessionManager) {
        this.pi = pi
        this.manager = manager
    }

    reset(): void {
        this.disposed = false
        this.generation += 1
        this.consecutiveSyncErrors = 0
        this.closedSubRetries = 0
        this.inFlightSync = undefined
        this.syncQueued = false
        this.markSeenInFlight.clear()
        this.lastStatusText = null
        this.lastPlainWidgetKey = null
    }

    ensureLoopRunning(): void {
        if (this.disposed) return
        this.refreshUI()
        const tracked = this.manager.getTrackedPanes()
        if (tracked.length === 0) {
            this.stopLoop()
            return
        }

        const running = this.manager.getRunningPanes()
        if (running.length === 0) {
            // Stop active polling when 0 running panes remain; watch for manual closure via `subscribe`.
            this.stopPollingOnly()
            this.ensureClosedSubscriber(tracked)
            return
        }

        this.closedSubRetries = 0
        this.stopClosedSubscriber()

        if (!this.exitWatcher) {
            const exitsDir = this.manager.getExitsDir()
            if (exitsDir && existsSync(exitsDir)) {
                try {
                    this.exitWatcher = watch(exitsDir, () => {
                        if (this.disposed) return
                        void this.syncNow()
                        // Exit marker writes can lead pane disappearance slightly; schedule a follow-up check.
                        if (!this.exitFollowupTimer) {
                            this.exitFollowupTimer = setTimeout(() => {
                                this.exitFollowupTimer = undefined
                                if (!this.disposed) void this.syncNow()
                            }, 200)
                            this.exitFollowupTimer.unref?.()
                        }
                    })
                    this.exitWatcher.unref?.()
                } catch {
                    // Fall back to reconciliation timer if fs.watch fails.
                }
            }
        }

        if (!this.pollTimer) {
            this.pollTimer = setInterval(() => {
                void this.syncNow()
            }, RECONCILE_INTERVAL_MS)
            this.pollTimer.unref?.()
        }
    }

    private ensureClosedSubscriber(panes: readonly TrackedPane[]): void {
        if (this.disposed || !this.manager.isSessionReady()) return
        if (this.closedSubRetryTimer) return

        const paneIds = panes.map((p) => p.paneId).sort()
        const key = `${this.manager.getSessionName()}:${paneIds.join(",")}`
        if (this.closedSubscriber && this.subscribedClosedKey === key) return

        this.stopClosedSubscriber()
        if (paneIds.length === 0) return

        const args = ["--session", this.manager.getSessionName(), "subscribe", "--format", "json"]
        for (const paneId of paneIds) {
            args.push("--pane-id", paneId)
        }

        const sub = spawn("zellij", args, { stdio: ["ignore", "pipe", "ignore"] })
        this.closedSubscriber = sub
        this.subscribedClosedKey = key
        let sawCloseEvent = false

        let buffer = ""
        sub.stdout.on("data", (chunk: Buffer) => {
            if (this.disposed) return
            buffer += chunk.toString("utf-8")
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed) continue
                try {
                    const parsed: unknown = JSON.parse(trimmed)
                    if (isRecord(parsed) && parsed.event === "pane_closed") {
                        sawCloseEvent = true
                        this.closedSubRetries = 0
                        void this.syncNow()
                        return
                    }
                } catch {
                    // Ignore malformed NDJSON lines.
                }
            }
        })

        sub.on("error", () => {
            if (this.closedSubscriber === sub) {
                this.closedSubscriber = undefined
                this.subscribedClosedKey = ""
                this.scheduleClosedSubscriberRetry()
            }
        })

        sub.on("exit", () => {
            if (this.closedSubscriber !== sub) return
            this.closedSubscriber = undefined
            this.subscribedClosedKey = ""
            if (this.disposed || this.manager.getTrackedPanes().length === 0) return

            if (sawCloseEvent) {
                void this.syncNow()
            } else {
                this.scheduleClosedSubscriberRetry()
            }
        })
    }

    private scheduleClosedSubscriberRetry(): void {
        if (this.disposed || this.closedSubRetryTimer) return
        const idx = Math.min(this.closedSubRetries, CLOSED_SUB_BACKOFF_MS.length - 1)
        const delay = CLOSED_SUB_BACKOFF_MS[idx]
        if (delay === undefined) return
        this.closedSubRetries += 1
        this.closedSubRetryTimer = setTimeout(() => {
            this.closedSubRetryTimer = undefined
            if (!this.disposed && this.manager.getRunningPanes().length === 0) {
                void this.syncNow()
            }
        }, delay)
        this.closedSubRetryTimer.unref?.()
    }

    private stopClosedSubscriber(): void {
        if (this.closedSubRetryTimer) {
            clearTimeout(this.closedSubRetryTimer)
            this.closedSubRetryTimer = undefined
        }
        if (this.closedSubscriber) {
            const sub = this.closedSubscriber
            this.closedSubscriber = undefined
            this.subscribedClosedKey = ""
            try {
                sub.kill("SIGKILL")
            } catch {
                // Ignore.
            }
        }
    }

    private stopPollingOnly(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer)
            this.pollTimer = undefined
        }
        if (this.exitFollowupTimer) {
            clearTimeout(this.exitFollowupTimer)
            this.exitFollowupTimer = undefined
        }
        if (this.exitWatcher) {
            try {
                this.exitWatcher.close()
            } catch {
                // Ignore.
            }
            this.exitWatcher = undefined
        }
    }

    stopLoop(): void {
        this.stopPollingOnly()
        this.stopClosedSubscriber()
    }

    dispose(): void {
        this.disposed = true
        this.generation += 1
        this.consecutiveSyncErrors = 0
        this.stopLoop()
        for (const child of this.activeSubscribers) {
            try {
                child.kill("SIGKILL")
            } catch {
                // Ignore.
            }
        }
        this.activeSubscribers.clear()
        this.suppressedNotifyPanes.clear()
        this.markSeenInFlight.clear()
        this.lastStatusText = null
        this.lastPlainWidgetKey = null
        for (const set of this.exitWaiters.values()) {
            for (const entry of set) {
                entry.resolve(false)
            }
        }
        this.exitWaiters.clear()
        this.manager.releaseSessionClient()
    }

    private applyStatus(
        ctx: { ui: { setStatus: (k: string, t: string | undefined) => void } },
        text: string | undefined,
    ): void {
        if (this.lastStatusText === text) return
        this.lastStatusText = text
        ctx.ui.setStatus("zellij", text)
    }

    private applyPlainWidget(
        ctx: {
            ui: {
                setWidget: (
                    k: string,
                    c: string[] | undefined,
                    o?: { placement?: "aboveEditor" | "belowEditor" },
                ) => void
            }
        },
        rows: string[] | undefined,
    ): void {
        const key = rows ? JSON.stringify(rows) : "__undefined__"
        if (this.lastPlainWidgetKey === key) return
        this.lastPlainWidgetKey = key
        ctx.ui.setWidget("zellij-panes", rows, rows ? { placement: "aboveEditor" } : undefined)
    }

    refreshUI(): void {
        if (this.disposed) return
        const ctx = this.manager.getContext()
        if (!ctx?.hasUI) return

        const panes = this.manager.getTrackedPanes()
        if (panes.length === 0) {
            const attachHint = this.manager.getAttachHint()
            this.applyStatus(
                ctx,
                attachHint ? `zj:${this.manager.getSessionName()} (${attachHint})` : undefined,
            )
            this.applyPlainWidget(ctx, undefined)
            return
        }

        const counts = { task: 0, service: 0, agent: 0, repl: 0 }
        let inputCount = 0
        let errCount = 0
        for (const p of panes) {
            if (p.status === "running") {
                counts[p.kind] += 1
                if (p.needsAttention) inputCount += 1
            } else if (p.status === "exited" && p.kind !== "repl" && p.exitCode !== 0) {
                errCount += 1
            }
        }

        const summaryParts: string[] = []
        if (counts.task > 0) summaryParts.push(`tasks:${counts.task}`)
        if (counts.service > 0) summaryParts.push(`svc:${counts.service}`)
        if (counts.agent > 0) summaryParts.push(`agents:${counts.agent}`)
        if (counts.repl > 0) summaryParts.push(`repl:${counts.repl}`)
        if (inputCount > 0) summaryParts.push(`input:${inputCount}`)
        if (errCount > 0) summaryParts.push(`err:${errCount}`)
        if (summaryParts.length === 0) summaryParts.push(`done:${panes.length}`)

        const attachHint = this.manager.getAttachHint()
        const statusText = attachHint
            ? `zj:${this.manager.getSessionName()} [${summaryParts.join(" ")}] | ${attachHint}`
            : `zj [${summaryParts.join(" ")}]`
        this.applyStatus(ctx, statusText)

        const visiblePanes = panes.filter(
            (p) =>
                p.status === "running" ||
                (p.status === "exited" && p.kind !== "repl" && p.exitCode !== 0),
        )
        if (visiblePanes.length === 0) {
            this.applyPlainWidget(ctx, undefined)
            return
        }

        const maxItems =
            visiblePanes.length > MAX_WIDGET_ROWS ? MAX_WIDGET_ROWS - 1 : visiblePanes.length
        const displayedPanes = visiblePanes.slice(0, maxItems)
        for (const p of displayedPanes) {
            if (p.lastOutputLine === undefined) {
                p.lastOutputLine = this.manager.readLastOutputLine(p)
            }
        }

        if (ctx.mode !== "tui") {
            const plainRows = displayedPanes.map((p) => {
                const { headPlain, metaPlain } = formatPaneWidgetParts(p)
                return `${headPlain}${metaPlain}`
            })
            if (visiblePanes.length > MAX_WIDGET_ROWS) {
                plainRows.push(`+${visiblePanes.length - maxItems} more; run /zellij`)
            }
            this.applyPlainWidget(ctx, plainRows)
            return
        }

        // Snapshot rows and render via a component factory so we control colors and avoid
        // the built-in `Text(line, 1, 0)` left padding added for plain string arrays.
        this.lastPlainWidgetKey = null
        const snapshot = visiblePanes.map((p) => ({ ...p }))
        ctx.ui.setWidget(
            "zellij-panes",
            (_tui, theme) => ({
                invalidate() {},
                render(width: number): string[] {
                    const rowCap =
                        snapshot.length > MAX_WIDGET_ROWS ? MAX_WIDGET_ROWS - 1 : snapshot.length
                    const lines: string[] = []
                    for (const p of snapshot.slice(0, rowCap)) {
                        const { badgePlain, badgeColor, safeKind, safeName, headPlain, metaPlain } =
                            formatPaneWidgetParts(p)
                        const badge = theme.fg(badgeColor, badgePlain)
                        const kindColor =
                            p.kind === "service"
                                ? "warning"
                                : p.kind === "agent"
                                  ? "accent"
                                  : "toolTitle"
                        const headCols = stringDisplayWidth(headPlain)

                        if (headCols >= width) {
                            lines.push(fitPlain(headPlain, width))
                            continue
                        }

                        const remaining = Math.max(0, width - headCols)
                        const styledKind = theme.fg(kindColor, safeKind)
                        const styledName = theme.bold(theme.fg("text", safeName))
                        const styledMeta =
                            remaining > 6 ? theme.fg("muted", fitPlain(metaPlain, remaining)) : ""
                        lines.push(`${badge} ${styledKind}:${styledName}${styledMeta}`)
                    }

                    if (snapshot.length > MAX_WIDGET_ROWS) {
                        const hidden = snapshot.length - (MAX_WIDGET_ROWS - 1)
                        lines.push(theme.fg("dim", fitPlain(`+${hidden} more; run /zellij`, width)))
                    }
                    return lines
                },
            }),
            { placement: "aboveEditor" },
        )
    }

    async syncNow(): Promise<void> {
        if (this.disposed || !this.manager.isSessionReady()) return
        if (this.inFlightSync) {
            this.syncQueued = true
            return this.inFlightSync
        }

        const gen = this.generation
        const run = async () => {
            try {
                do {
                    this.syncQueued = false
                    await this.runSingleSync()
                } while (this.syncQueued && !this.disposed && gen === this.generation)
            } catch {
                // Never propagate rejections from background/fire-and-forget syncs.
            }
        }

        const syncPromise = run().finally(() => {
            if (this.inFlightSync === syncPromise) {
                this.inFlightSync = undefined
            }
        })
        this.inFlightSync = syncPromise
        return syncPromise
    }

    /** Reconcile tracked pane state with live Zellij panes. Accessible directly for testing. */
    async runSingleSync(): Promise<void> {
        if (this.disposed || !this.manager.isSessionReady()) return
        const gen = this.generation
        try {
            const tracked = this.manager.getTrackedPanes()
            if (tracked.length === 0) {
                this.consecutiveSyncErrors = 0
                this.stopLoop()
                this.refreshUI()
                return
            }

            let livePanes: ZellijPaneJson[]
            try {
                livePanes = await listPanes(this.pi, this.manager.getSessionName())
                this.consecutiveSyncErrors = 0
            } catch {
                if (this.disposed || gen !== this.generation) return
                this.consecutiveSyncErrors += 1
                if (this.consecutiveSyncErrors >= 3) {
                    const sessions = await listSessions(this.pi).catch(() => null)
                    if (this.disposed || gen !== this.generation) return
                    if (sessions !== null && !sessions.includes(this.manager.getSessionName())) {
                        for (const pane of tracked) {
                            if (pane.status === "closed") continue
                            const wasRunning = pane.status === "running"
                            pane.status = "closed"
                            pane.endedAt = pane.endedAt ?? Date.now()
                            this.resolveWaiters(pane.paneId, true)
                            const shouldNotify =
                                wasRunning &&
                                pane.kind !== "repl" &&
                                !pane.notifiedCompletion &&
                                !this.suppressedNotifyPanes.has(pane.paneId)
                            if (shouldNotify) {
                                pane.notifiedCompletion = true
                                const tail = await this.manager
                                    .readPaneOutput(pane, { maxLines: 80 })
                                    .catch(() => "(unable to read output)")
                                if (this.disposed || gen !== this.generation) return
                                this.emitFollowUp(pane, "disappeared", null, tail)
                            }
                            this.manager.removePane(pane.paneId, {
                                keepLog: true,
                                keepBrief: shouldNotify,
                            })
                        }
                        this.consecutiveSyncErrors = 0
                        this.stopLoop()
                        this.refreshUI()
                    }
                }
                return
            }
            if (this.disposed || gen !== this.generation) return
            const liveById = indexLivePanesById(livePanes)

            let dirtyPersist = false
            for (const pane of tracked) {
                if (this.disposed || gen !== this.generation) return
                if (pane.status === "closed" || this.manager.isClosingPane(pane.paneId)) continue
                const live = liveById.get(pane.numericId)

                if (!live) {
                    const wasRunning = pane.status === "running"
                    const markerExit = readExitMarker(pane.exitMarkerPath)
                    if (markerExit !== null) {
                        pane.exitCode = markerExit
                    }
                    const tail =
                        wasRunning && pane.kind !== "repl"
                            ? await this.manager
                                  .readPaneOutput(pane, { maxLines: 80 })
                                  .catch(() => "(unable to read output)")
                            : ""
                    if (
                        this.disposed ||
                        gen !== this.generation ||
                        this.manager.isClosingPane(pane.paneId) ||
                        this.manager.getPane(pane.paneId) !== pane
                    ) {
                        continue
                    }

                    pane.status = "closed"
                    pane.endedAt = pane.endedAt ?? Date.now()
                    const hasWaiter = (this.exitWaiters.get(pane.paneId)?.size ?? 0) > 0
                    this.resolveWaiters(pane.paneId, true)
                    const shouldNotify =
                        wasRunning &&
                        pane.kind !== "repl" &&
                        !pane.notifiedCompletion &&
                        !this.suppressedNotifyPanes.has(pane.paneId)
                    if (shouldNotify) {
                        pane.notifiedCompletion = true
                        const eventType: ZellijEventDetails["eventType"] =
                            markerExit !== null
                                ? pane.kind === "service" && markerExit !== 0
                                    ? "crashed"
                                    : "exited"
                                : "disappeared"
                        this.emitFollowUp(pane, eventType, markerExit, tail)
                    }
                    const keepArtifacts =
                        shouldNotify || hasWaiter || this.suppressedNotifyPanes.has(pane.paneId)
                    // Keep log/brief paths when emitting a followUp or while a wait is active.
                    this.manager.removePane(pane.paneId, {
                        keepLog: keepArtifacts,
                        keepBrief: shouldNotify,
                    })
                    continue
                }

                if (live.exited && pane.status === "running") {
                    const resolvedExit =
                        live.exit_status ??
                        live.command_state?.lastExitCode ??
                        readExitMarker(pane.exitMarkerPath)
                    pane.status = "exited"
                    pane.exitCode = resolvedExit
                    pane.endedAt = Date.now()
                    pane.needsAttention = false
                    pane.lastOutputLine =
                        this.manager.readLastOutputLine(pane) ?? pane.lastOutputLine
                    dirtyPersist = true
                    this.resolveWaiters(pane.paneId, true)
                    this.markPaneSeenOnCleanExit(pane)

                    if (pane.kind === "repl") {
                        pane.notifiedCompletion = true
                        continue
                    }

                    if (!pane.notifiedCompletion && !this.suppressedNotifyPanes.has(pane.paneId)) {
                        pane.notifiedCompletion = true
                        const tail = await this.manager
                            .readPaneOutput(pane, { maxLines: 80 })
                            .catch(() => "(unable to read output)")
                        if (this.disposed || gen !== this.generation) return
                        const eventType =
                            pane.kind === "service" && resolvedExit !== 0 ? "crashed" : "exited"
                        this.emitFollowUp(pane, eventType, resolvedExit ?? null, tail)
                    }
                    continue
                }

                if (!live.exited && pane.status === "running") {
                    if (pane.kind !== "repl") {
                        const updated = await this.checkNeedsAttention(pane, live, gen)
                        if (this.disposed || gen !== this.generation) return
                        if (updated) dirtyPersist = true
                    }
                    if (!pane.needsAttention) {
                        pane.lastOutputLine =
                            this.manager.readLastOutputLine(pane) ?? pane.lastOutputLine
                    }
                }
            }

            if (this.disposed || gen !== this.generation) return
            if (dirtyPersist) {
                this.manager.markPaneUpdated()
            }
            this.ensureLoopRunning()
        } catch {
            // Transient CLI or UI query failure should not crash the extension.
        }
    }

    private async checkNeedsAttention(
        pane: TrackedPane,
        live: ZellijPaneJson,
        gen = this.generation,
    ): Promise<boolean> {
        if (this.suppressedNotifyPanes.has(pane.paneId) || this.disposed) return false

        const attStatus = live.attention?.status ?? "Idle"
        const isWatchQuiet =
            (live.attention?.from_watch === true || live.attention?.source === "Watch") &&
            live.attention?.text === "went quiet"
        const blockedProgram = live.program_status?.find((ps) => ps.state === "Blocked")
        const isNeedsYou =
            (attStatus === "NeedsYou" && !isWatchQuiet) || blockedProgram !== undefined
        const isQuietWatch = attStatus === "Quiet" || (attStatus === "NeedsYou" && isWatchQuiet)

        if (!isNeedsYou && !isQuietWatch) {
            const hadSignature = pane.lastAttentionSignature !== undefined
            pane.lastAttentionSignature = undefined
            if (pane.needsAttention) {
                pane.needsAttention = false
                pane.lastOutputLine = this.manager.readLastOutputLine(pane)
                return true
            }
            return hadSignature
        }

        const signature = `${attStatus}:${live.attention?.changed_ms ?? 0}:${blockedProgram !== undefined ? "blocked" : ""}`
        if (pane.lastAttentionSignature === signature) return false

        // Record the signature before inspecting so Quiet panes do not re-dump on every cycle.
        pane.lastAttentionSignature = signature

        // Read viewport only (`full: false`) so `/dev/tty` prompts show without dumping 10k scrollback lines.
        const tail = await this.manager
            .readPaneOutput(pane, { maxLines: 25, preferScreen: true, full: false })
            .catch(() => "")
        if (this.disposed || gen !== this.generation) return false

        const looksLikePrompt =
            isNeedsYou ||
            INTERACTIVE_PROMPT_RE.test(tail.split(/\r?\n/).slice(-3).join("\n").trimEnd())
        if (!looksLikePrompt) {
            pane.needsAttention = false
            pane.lastOutputLine = this.manager.readLastOutputLine(pane)
            return true
        }

        pane.needsAttention = true
        pane.markedSeen = false
        const lastPromptLine = tail
            .split(/\r?\n/)
            .map((line) => sanitizeAsciiText(line, 200))
            .filter(Boolean)
            .pop()
        if (lastPromptLine) {
            pane.lastOutputLine = lastPromptLine
        }

        this.emitFollowUp(pane, "needs_attention", null, tail)
        void promptNotify(
            this.pi,
            this.manager.getSessionName(),
            `${pane.kind}:${pane.name} (${pane.paneId}) is waiting for input.`,
            { title: "Pi Zellij", timeout: "8s", at: "top-right", paneId: pane.paneId },
        ).catch(() => {})
        return true
    }

    private emitFollowUp(
        pane: TrackedPane,
        eventType: ZellijEventDetails["eventType"],
        exitCode: number | null,
        tail: string,
    ): void {
        if (this.disposed) return

        const header =
            eventType === "crashed"
                ? `Background service "${pane.name}" (${pane.paneId}) exited unexpectedly with code ${exitCode ?? "unknown"}.`
                : eventType === "needs_attention"
                  ? `${pane.kind} "${pane.name}" (${pane.paneId}) appears to be waiting for interactive input.`
                  : eventType === "disappeared"
                    ? `${pane.kind} "${pane.name}" (${pane.paneId}) was closed externally.`
                    : `${pane.kind} "${pane.name}" (${pane.paneId}) finished with exit code ${exitCode ?? "unknown"}.`

        const metaLines = [
            header,
            `Tab: ${pane.tabName} | Layout: ${pane.layout}`,
            pane.modelLabel ? `Model: ${pane.modelLabel}` : undefined,
            pane.logPath ? `Full log: ${pane.logPath}` : undefined,
        ].filter((line): line is string => Boolean(line))

        const content = `${metaLines.join("\n")}\n\n--- Output tail ---\n${tail || "(no output)"}`
        const details: ZellijEventDetails = {
            paneId: pane.paneId,
            name: pane.name,
            kind: pane.kind,
            eventType,
            exitCode,
            logPath: pane.logPath,
            outputTail: tail,
            modelLabel: pane.modelLabel,
        }

        this.pi.sendMessage(
            {
                customType: "zellij-event",
                content,
                display: true,
                details,
            },
            { triggerTurn: true, deliverAs: "followUp" },
        )
    }

    private resolveWaiters(paneId: string, exited: boolean): void {
        const set = this.exitWaiters.get(paneId)
        if (!set) return
        this.exitWaiters.delete(paneId)
        for (const waiter of set) {
            waiter.resolve(exited)
        }
    }

    private markPaneSeenOnCleanExit(pane: TrackedPane): void {
        if (
            pane.markedSeen ||
            this.markSeenInFlight.has(pane.paneId) ||
            pane.exitCode !== 0 ||
            (pane.kind !== "task" && pane.kind !== "agent" && pane.kind !== "repl")
        ) {
            return
        }
        this.markSeenInFlight.add(pane.paneId)
        void markPaneSeen(this.pi, this.manager.getSessionName(), pane.paneId)
            .then(() => {
                pane.markedSeen = true
            })
            .catch(() => {})
            .finally(() => {
                this.markSeenInFlight.delete(pane.paneId)
            })
    }

    private markExitedPaneHandled(pane: TrackedPane): void {
        if (pane.status !== "exited") return
        pane.needsAttention = false
        this.markPaneSeenOnCleanExit(pane)
        if (!pane.notifiedCompletion) {
            pane.notifiedCompletion = true
            this.manager.markPaneUpdated()
        }
    }

    /**
     * Wait up to `timeoutMs` for a pane to exit while suppressing duplicate
     * background followUp notifications during the synchronous wait window.
     */
    async waitForExit(
        pane: TrackedPane,
        timeoutMs: number,
        signal?: AbortSignal,
    ): Promise<{ exited: boolean; pane: TrackedPane }> {
        this.ensureLoopRunning()
        if (signal?.aborted || timeoutMs <= 0) {
            return { exited: pane.status !== "running", pane }
        }

        const gen = this.generation
        this.suppressedNotifyPanes.add(pane.paneId)
        try {
            await this.syncNow()
            if (
                signal?.aborted ||
                this.disposed ||
                gen !== this.generation ||
                pane.status !== "running"
            ) {
                if (!this.disposed && gen === this.generation && pane.status === "exited") {
                    this.markExitedPaneHandled(pane)
                }
                return { exited: pane.status !== "running", pane }
            }

            const finished = await new Promise<boolean>((done) => {
                let settled = false
                const timers: { timeout?: ReturnType<typeof setTimeout> } = {}
                const set = this.exitWaiters.get(pane.paneId) ?? new Set<WaitEntry>()

                const finish = (didExit: boolean) => {
                    if (settled) return
                    settled = true
                    if (timers.timeout) clearTimeout(timers.timeout)
                    signal?.removeEventListener("abort", onAbort)
                    set.delete(entry)
                    if (set.size === 0) this.exitWaiters.delete(pane.paneId)
                    done(didExit)
                }

                const entry: WaitEntry = {
                    resolve: (didExit) => finish(didExit),
                }

                const onAbort = () => finish(false)
                signal?.addEventListener("abort", onAbort, { once: true })

                timers.timeout = setTimeout(() => finish(false), timeoutMs)
                timers.timeout.unref?.()

                set.add(entry)
                this.exitWaiters.set(pane.paneId, set)
            })

            if (
                (finished || pane.status !== "running") &&
                !this.disposed &&
                gen === this.generation
            ) {
                this.markExitedPaneHandled(pane)
                return { exited: true, pane }
            }
            return { exited: false, pane }
        } finally {
            this.suppressedNotifyPanes.delete(pane.paneId)
        }
    }

    /**
     * Stream pane updates via `zellij subscribe --format json` until `pattern`
     * matches viewport/log output, the pane exits, or timeout expires.
     */
    async waitForReadyPattern(
        pane: TrackedPane,
        pattern: RegExp,
        timeoutMs: number,
        signal?: AbortSignal,
    ): Promise<"ready" | "exited" | "timeout" | "aborted"> {
        this.ensureLoopRunning()
        if (signal?.aborted) return "aborted"

        let lastLogSize = -1
        if (pane.logPath && existsSync(pane.logPath)) {
            try {
                lastLogSize = statSync(pane.logPath).size
                const existing = readTailFromFile(pane.logPath, READY_LOG_TAIL_BYTES).text
                if (pattern.test(existing)) return "ready"
            } catch {
                // Ignore transient file race on startup.
            }
        }
        if (signal?.aborted) return "aborted"

        return new Promise<"ready" | "exited" | "timeout" | "aborted">((donePromise) => {
            let settled = false
            const sub = spawn(
                "zellij",
                [
                    "--session",
                    this.manager.getSessionName(),
                    "subscribe",
                    "--pane-id",
                    pane.paneId,
                    "--scrollback",
                    "100",
                    "--format",
                    "json",
                ],
                { stdio: ["ignore", "pipe", "ignore"] },
            )
            this.activeSubscribers.add(sub)

            const timers: {
                timeout?: ReturnType<typeof setTimeout>
                exitCheck?: ReturnType<typeof setInterval>
            } = {}

            const done = (result: "ready" | "exited" | "timeout" | "aborted") => {
                if (settled) return
                settled = true
                if (timers.timeout) clearTimeout(timers.timeout)
                if (timers.exitCheck) clearInterval(timers.exitCheck)
                signal?.removeEventListener("abort", onAbort)
                this.activeSubscribers.delete(sub)
                try {
                    sub.kill("SIGKILL")
                } catch {
                    // Ignore.
                }
                donePromise(result)
            }

            const onAbort = () => done("aborted")
            signal?.addEventListener("abort", onAbort, { once: true })

            timers.timeout = setTimeout(() => done("timeout"), timeoutMs)
            timers.timeout.unref?.()

            sub.on("error", () => {
                // Keep exit/log fallback interval running if `subscribe` fails to spawn.
            })

            timers.exitCheck = setInterval(() => {
                void (async () => {
                    try {
                        await this.syncNow()
                        if (settled) return
                        if (pane.status !== "running") {
                            done("exited")
                            return
                        }
                        if (pane.logPath && existsSync(pane.logPath)) {
                            const size = statSync(pane.logPath).size
                            if (size !== lastLogSize) {
                                lastLogSize = size
                                const tail = readTailFromFile(
                                    pane.logPath,
                                    READY_LOG_TAIL_BYTES,
                                ).text
                                if (!settled && pattern.test(tail)) done("ready")
                            }
                        }
                    } catch {
                        // Ignore transient stat/read race if file was removed or rotated.
                    }
                })()
            }, 350)
            timers.exitCheck.unref?.()

            let buffer = ""
            sub.stdout.on("data", (chunk: Buffer) => {
                if (settled) return
                buffer += chunk.toString("utf-8")
                const lines = buffer.split("\n")
                buffer = lines.pop() ?? ""
                for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed) continue
                    try {
                        const parsed: unknown = JSON.parse(trimmed)
                        if (!isRecord(parsed)) continue
                        if (parsed.event === "pane_closed") {
                            done("exited")
                            return
                        }
                        if (parsed.event === "pane_update") {
                            const viewport = Array.isArray(parsed.viewport)
                                ? parsed.viewport
                                      .filter((v): v is string => typeof v === "string")
                                      .join("\n")
                                : ""
                            const scrollback = Array.isArray(parsed.scrollback)
                                ? parsed.scrollback
                                      .filter((v): v is string => typeof v === "string")
                                      .join("\n")
                                : ""
                            if (pattern.test(`${scrollback}\n${viewport}`)) {
                                done("ready")
                                return
                            }
                        }
                    } catch {
                        // Ignore partial/malformed JSON lines.
                    }
                }
            })

            sub.on("exit", () => {
                if (settled) return
                void this.syncNow().then(() => {
                    if (!settled && pane.status !== "running") {
                        done("exited")
                    }
                })
            })
        })
    }
}
