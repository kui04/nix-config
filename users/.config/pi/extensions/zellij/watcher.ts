import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { listPanes } from "./cli.ts"
import type { ZellijSessionManager } from "./session.ts"
import {
    indexLivePanesById,
    isRecord,
    type TrackedPane,
    type ZellijEventDetails,
    type ZellijPaneJson,
} from "./types.ts"

const POLL_INTERVAL_MS = 600
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

interface WaitEntry {
    resolve: (exited: boolean) => void
}

/**
 * Monitors tracked Zellij panes, updates TUI status/widgets, and injects
 * `followUp` messages into Pi when background jobs exit or need user input.
 */
export class PaneWatcher {
    private readonly pi: ExtensionAPI
    private readonly manager: ZellijSessionManager
    private pollTimer: ReturnType<typeof setInterval> | undefined
    private inFlightSync: Promise<void> | undefined
    private syncQueued = false
    private disposed = false
    private suppressedNotifyPanes = new Set<string>()
    private exitWaiters = new Map<string, Set<WaitEntry>>()
    private activeSubscribers = new Set<ChildProcess>()

    constructor(pi: ExtensionAPI, manager: ZellijSessionManager) {
        this.pi = pi
        this.manager = manager
    }

    reset(): void {
        this.disposed = false
    }

    ensureLoopRunning(): void {
        if (this.disposed) return
        this.refreshUI()
        if (this.manager.getRunningPanes().length === 0) {
            this.stopLoop()
            return
        }
        if (this.pollTimer) return
        this.pollTimer = setInterval(() => {
            void this.syncNow()
        }, POLL_INTERVAL_MS)
        // Do not block Node process shutdown if an interval is left behind.
        this.pollTimer.unref?.()
    }

    stopLoop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer)
            this.pollTimer = undefined
        }
    }

    dispose(): void {
        this.disposed = true
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
        for (const set of this.exitWaiters.values()) {
            for (const entry of set) {
                entry.resolve(false)
            }
        }
        this.exitWaiters.clear()
    }

    refreshUI(): void {
        if (this.disposed) return
        const ctx = this.manager.getContext()
        if (!ctx?.hasUI) return

        const panes = this.manager.getTrackedPanes()
        if (panes.length === 0) {
            const attachHint = this.manager.getAttachHint()
            ctx.ui.setStatus(
                "zellij",
                attachHint ? `zj:${this.manager.getSessionName()} (${attachHint})` : undefined,
            )
            ctx.ui.setWidget("zellij-panes", undefined)
            return
        }

        const counts = { task: 0, service: 0, agent: 0, repl: 0 }
        for (const p of panes) {
            if (p.status === "running") {
                counts[p.kind] += 1
            }
        }

        const summaryParts: string[] = []
        if (counts.task > 0) summaryParts.push(`tasks:${counts.task}`)
        if (counts.service > 0) summaryParts.push(`svc:${counts.service}`)
        if (counts.agent > 0) summaryParts.push(`agents:${counts.agent}`)
        if (counts.repl > 0) summaryParts.push(`repl:${counts.repl}`)
        if (summaryParts.length === 0) summaryParts.push(`done:${panes.length}`)

        const attachHint = this.manager.getAttachHint()
        const statusText = attachHint
            ? `zj:${this.manager.getSessionName()} [${summaryParts.join(" ")}] | ${attachHint}`
            : `zj [${summaryParts.join(" ")}]`
        ctx.ui.setStatus("zellij", statusText)

        const lines = panes.map((p) => {
            const badge =
                p.status === "running"
                    ? "[run]"
                    : p.exitCode === 0
                      ? "[ok]"
                      : `[err:${p.exitCode ?? "?"}]`
            const elapsed = formatDuration((p.endedAt ?? Date.now()) - p.startedAt)
            return `${badge} ${p.kind}:${p.name} (${p.paneId} @ ${p.tabName}/${p.layout}, ${elapsed})`
        })
        ctx.ui.setWidget("zellij-panes", lines, { placement: "aboveEditor" })
    }

    async syncNow(): Promise<void> {
        if (this.disposed || !this.manager.isSessionReady()) return
        if (this.inFlightSync) {
            this.syncQueued = true
            return this.inFlightSync
        }

        const run = async () => {
            do {
                this.syncQueued = false
                await this.runSingleSync()
            } while (this.syncQueued && !this.disposed)
        }

        this.inFlightSync = run().finally(() => {
            this.inFlightSync = undefined
        })
        return this.inFlightSync
    }

    private async runSingleSync(): Promise<void> {
        if (this.disposed || !this.manager.isSessionReady()) return
        const tracked = this.manager.getTrackedPanes()
        if (tracked.length === 0) {
            this.stopLoop()
            this.refreshUI()
            return
        }

        try {
            const livePanes = await listPanes(this.pi, this.manager.getSessionName())
            if (this.disposed) return
            const liveById = indexLivePanesById(livePanes)

            let dirtyPersist = false
            for (const pane of tracked) {
                if (this.disposed) return
                if (pane.status === "closed") continue
                const live = liveById.get(pane.numericId)

                if (!live) {
                    const wasRunning = pane.status === "running"
                    const tail = await this.manager
                        .readPaneOutput(pane, { maxLines: 80 })
                        .catch(() => "(unable to read output)")
                    if (this.disposed) return

                    pane.status = "closed"
                    pane.endedAt = pane.endedAt ?? Date.now()
                    this.resolveWaiters(pane.paneId, true)
                    if (
                        wasRunning &&
                        !pane.notifiedCompletion &&
                        !this.suppressedNotifyPanes.has(pane.paneId)
                    ) {
                        pane.notifiedCompletion = true
                        this.emitFollowUp(pane, "disappeared", null, tail)
                    }
                    // `removePane` persists the deletion directly.
                    this.manager.removePane(pane.paneId)
                    continue
                }

                if (live.exited && pane.status === "running") {
                    pane.status = "exited"
                    pane.exitCode = live.exit_status
                    pane.endedAt = Date.now()
                    dirtyPersist = true
                    this.resolveWaiters(pane.paneId, true)

                    if (!pane.notifiedCompletion && !this.suppressedNotifyPanes.has(pane.paneId)) {
                        pane.notifiedCompletion = true
                        const tail = await this.manager
                            .readPaneOutput(pane, { maxLines: 80 })
                            .catch(() => "(unable to read output)")
                        if (this.disposed) return
                        const eventType = pane.kind === "service" ? "crashed" : "exited"
                        this.emitFollowUp(pane, eventType, live.exit_status ?? null, tail)
                    }
                    continue
                }

                if (!live.exited && pane.status === "running" && pane.kind !== "repl") {
                    const updated = await this.checkNeedsAttention(pane, live)
                    if (updated) dirtyPersist = true
                }
            }

            if (this.disposed) return
            if (dirtyPersist) {
                this.manager.markPaneUpdated()
            }
            this.refreshUI()
            if (this.manager.getRunningPanes().length === 0) {
                this.stopLoop()
            }
        } catch {
            // Transient CLI query failure should not crash the extension.
        }
    }

    private async checkNeedsAttention(pane: TrackedPane, live: ZellijPaneJson): Promise<boolean> {
        if (this.suppressedNotifyPanes.has(pane.paneId) || this.disposed) return false

        const attStatus = live.attention?.status ?? "Idle"
        const blockedProgram = live.program_status?.find((ps) => ps.state === "Blocked")
        const isNeedsYou = attStatus === "NeedsYou" || blockedProgram !== undefined
        const isQuietWatch = attStatus === "Quiet"

        if (!isNeedsYou && !isQuietWatch) return false

        const signature = `${attStatus}:${live.attention?.changed_ms ?? 0}:${blockedProgram?.updated_ms ?? 0}`
        if (pane.lastAttentionSignature === signature) return false

        // Read terminal viewport (`preferScreen: true`) so `/dev/tty` prompts without trailing newlines are visible.
        const tail = await this.manager
            .readPaneOutput(pane, { maxLines: 25, preferScreen: true })
            .catch(() => "")
        if (this.disposed) return false

        const looksLikePrompt =
            isNeedsYou ||
            INTERACTIVE_PROMPT_RE.test(tail.split(/\r?\n/).slice(-3).join("\n").trimEnd())
        if (!looksLikePrompt) return false

        pane.lastAttentionSignature = signature
        this.emitFollowUp(pane, "needs_attention", null, tail)
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
        if (timeoutMs <= 0) {
            return { exited: pane.status !== "running", pane }
        }

        this.suppressedNotifyPanes.add(pane.paneId)
        try {
            await this.syncNow()
            if (this.disposed || pane.status !== "running") {
                if (pane.status !== "running" && !pane.notifiedCompletion) {
                    pane.notifiedCompletion = true
                    this.manager.markPaneUpdated()
                }
                return { exited: pane.status !== "running", pane }
            }

            const finished = await new Promise<boolean>((resolve) => {
                let settled = false
                const set = this.exitWaiters.get(pane.paneId) ?? new Set<WaitEntry>()
                const entry: WaitEntry = {
                    resolve: (didExit) => finish(didExit),
                }

                const finish = (didExit: boolean) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timer)
                    signal?.removeEventListener("abort", onAbort)
                    set.delete(entry)
                    if (set.size === 0) this.exitWaiters.delete(pane.paneId)
                    resolve(didExit)
                }

                const onAbort = () => finish(false)
                signal?.addEventListener("abort", onAbort, { once: true })

                const timer = setTimeout(() => finish(false), timeoutMs)
                timer.unref?.()

                set.add(entry)
                this.exitWaiters.set(pane.paneId, set)
            })

            if ((finished || pane.status !== "running") && !this.disposed) {
                if (!pane.notifiedCompletion) {
                    pane.notifiedCompletion = true
                    this.manager.markPaneUpdated()
                }
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
    ): Promise<"ready" | "exited" | "timeout"> {
        this.ensureLoopRunning()

        if (pane.logPath && existsSync(pane.logPath)) {
            const existing = await readFile(pane.logPath, "utf-8").catch(() => "")
            if (pattern.test(existing)) return "ready"
        }

        return new Promise<"ready" | "exited" | "timeout">((resolve) => {
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

            const cleanup = () => {
                clearTimeout(timer)
                clearInterval(exitCheck)
                signal?.removeEventListener("abort", onAbort)
                this.activeSubscribers.delete(sub)
                try {
                    sub.kill("SIGKILL")
                } catch {
                    // Ignore.
                }
            }

            const done = (result: "ready" | "exited" | "timeout") => {
                if (settled) return
                settled = true
                cleanup()
                resolve(result)
            }

            const onAbort = () => done("timeout")
            signal?.addEventListener("abort", onAbort, { once: true })

            const timer = setTimeout(() => done("timeout"), timeoutMs)
            timer.unref?.()

            sub.on("error", () => {
                // Keep exit/log fallback interval running if `subscribe` fails to spawn.
            })

            const exitCheck = setInterval(() => {
                void (async () => {
                    await this.syncNow()
                    if (settled) return
                    if (pane.status !== "running") {
                        done("exited")
                        return
                    }
                    if (pane.logPath && existsSync(pane.logPath)) {
                        const text = await readFile(pane.logPath, "utf-8").catch(() => "")
                        if (!settled && pattern.test(text)) done("ready")
                    }
                })()
            }, 350)
            exitCheck.unref?.()

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
