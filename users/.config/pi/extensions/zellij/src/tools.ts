import { existsSync } from "node:fs"
import type { ExtensionAPI, ToolAnnotations } from "@earendil-works/pi-coding-agent"
import { Type, type Static } from "typebox"
import {
    dumpScreen,
    focusPane,
    listPanes,
    markPaneSeen,
    sanitizeIdentifier,
    sendKeys,
    shellQuote,
    toggleEmbedOrFloating,
    writeChars,
} from "./cli.ts"
import { readTailFromFile, type ArtifactPaths, type ZellijSessionManager } from "./session.ts"
import {
    indexLivePanesById,
    isRecord,
    type LayoutMode,
    type PaneKind,
    type SplitDirection,
    type SubagentMode,
    type TrackedPane,
} from "./types.ts"
import type { PaneWatcher } from "./watcher.ts"

const MAX_READY_PATTERN_LEN = 256
const MAX_PTY_LINE_BYTES = 3800
// Reject common nested quantifier patterns like `(a+)+`, `(.*)*`, `([a-z]+){2,}` to avoid ReDoS.
const NESTED_QUANTIFIER_RE = /\([^)]*[+*][^)]*\)[+*{]/

const runSchema = Type.Object({
    command: Type.String({ description: "Shell command to run in a managed Zellij pane." }),
    name: Type.Optional(
        Type.String({ description: "Short label for the pane (letters/digits/._-)." }),
    ),
    cwd: Type.Optional(
        Type.String({ description: "Working directory (defaults to current session cwd)." }),
    ),
    layout: Type.Optional(
        Type.Union(
            [
                Type.Literal("stacked"),
                Type.Literal("split"),
                Type.Literal("floating"),
                Type.Literal("tab"),
            ],
            {
                description:
                    'Pane placement: "stacked" in tasks tab (default), "split" in active tab, "floating", or dedicated "tab".',
            },
        ),
    ),
    direction: Type.Optional(
        Type.Union([Type.Literal("right"), Type.Literal("down")], {
            description: 'Split direction when layout is "split" (default: "down").',
        }),
    ),
    waitSeconds: Type.Optional(
        Type.Number({
            minimum: 0,
            maximum: 30,
            description:
                "Seconds to wait synchronously before returning control (default: 8). If still running after this window, completion is pushed automatically.",
        }),
    ),
})

const runOutputSchema = Type.Object({
    status: Type.Union([Type.Literal("exited"), Type.Literal("running")]),
    paneId: Type.String(),
    name: Type.String(),
    session: Type.String(),
    tabName: Type.String(),
    layout: Type.String(),
    exitCode: Type.Union([Type.Number(), Type.Null()]),
    logPath: Type.String(),
    output: Type.String(),
})

const serviceSchema = Type.Object({
    action: Type.Union(
        [Type.Literal("start"), Type.Literal("stop"), Type.Literal("status"), Type.Literal("logs")],
        { description: "Service lifecycle operation." },
    ),
    name: Type.String({ description: "Service name (used as pane title and lookup key)." }),
    command: Type.Optional(
        Type.String({ description: 'Command to run (required when action is "start").' }),
    ),
    cwd: Type.Optional(Type.String({ description: "Working directory for the service." })),
    layout: Type.Optional(
        Type.Union([Type.Literal("stacked"), Type.Literal("split")], {
            description: 'Placement: "stacked" in services tab (default) or "split" in active tab.',
        }),
    ),
    direction: Type.Optional(
        Type.Union([Type.Literal("right"), Type.Literal("down")], {
            description: 'Split direction when layout is "split".',
        }),
    ),
    readyPattern: Type.Optional(
        Type.String({
            description:
                "Optional regex pattern (<= 256 chars) to wait for in output before returning readiness.",
        }),
    ),
    readyTimeoutSeconds: Type.Optional(
        Type.Number({
            minimum: 1,
            maximum: 60,
            description: "Max seconds to wait for readyPattern (default: 10).",
        }),
    ),
    lines: Type.Optional(
        Type.Integer({
            minimum: 1,
            maximum: 500,
            description: 'Number of tail lines to return when action is "logs" (default: 80).',
        }),
    ),
})

const serviceOutputSchema = Type.Object({
    action: Type.String(),
    name: Type.String(),
    paneId: Type.String(),
    status: Type.String(),
    readiness: Type.Union([Type.String(), Type.Null()]),
    exitCode: Type.Union([Type.Number(), Type.Null()]),
    logPath: Type.Union([Type.String(), Type.Null()]),
    output: Type.Union([Type.String(), Type.Null()]),
})

const subagentSchema = Type.Object({
    name: Type.String({ description: "Short name for the subagent pane (e.g. auth-review)." }),
    prompt: Type.String({
        description: "Standalone task brief with paths, context, and expected output shape.",
    }),
    mode: Type.Optional(
        Type.Union([Type.Literal("one-shot"), Type.Literal("rpc")], {
            description:
                '"one-shot" runs `pi -p` (default); "rpc" runs persistent `pi --mode rpc` for multi-turn prompts.',
        }),
    ),
    cwd: Type.Optional(Type.String({ description: "Working directory for the subagent." })),
    tools: Type.Optional(
        Type.Array(Type.String(), {
            description: 'Tool names for child pi (default: ["read", "grep", "find", "ls"]).',
        }),
    ),
    model: Type.Optional(
        Type.String({
            description:
                'Optional model override (e.g. "anthropic/claude-sonnet-4" or "sonnet:high").',
        }),
    ),
    thinking: Type.Optional(
        Type.Union(
            [
                Type.Literal("off"),
                Type.Literal("minimal"),
                Type.Literal("low"),
                Type.Literal("medium"),
                Type.Literal("high"),
                Type.Literal("xhigh"),
                Type.Literal("max"),
            ],
            { description: "Optional thinking level override." },
        ),
    ),
    layout: Type.Optional(
        Type.Union([Type.Literal("stacked"), Type.Literal("split")], {
            description: 'Placement: "stacked" in agents tab (default) or "split" in active tab.',
        }),
    ),
    waitSeconds: Type.Optional(
        Type.Number({
            minimum: 0,
            maximum: 60,
            description:
                "Seconds to wait synchronously before moving to background notification (default: 10).",
        }),
    ),
})

const subagentOutputSchema = Type.Object({
    status: Type.Union([
        Type.Literal("exited"),
        Type.Literal("running"),
        Type.Literal("rpc_running"),
    ]),
    paneId: Type.String(),
    name: Type.String(),
    model: Type.String(),
    exitCode: Type.Union([Type.Number(), Type.Null()]),
    briefPath: Type.String(),
    logPath: Type.String(),
    output: Type.String(),
})

const replSchema = Type.Object({
    command: Type.Optional(
        Type.String({ description: "Interactive command/REPL to launch (defaults to $SHELL)." }),
    ),
    name: Type.Optional(Type.String({ description: 'Pane name (default: "repl").' })),
    cwd: Type.Optional(Type.String({ description: "Working directory." })),
    x: Type.Optional(
        Type.String({ description: 'Floating x coordinate (integer or %, default: "10%").' }),
    ),
    y: Type.Optional(
        Type.String({ description: 'Floating y coordinate (integer or %, default: "10%").' }),
    ),
    width: Type.Optional(
        Type.String({ description: 'Floating width (integer or %, default: "80%").' }),
    ),
    height: Type.Optional(
        Type.String({ description: 'Floating height (integer or %, default: "80%").' }),
    ),
    pinned: Type.Optional(Type.Boolean({ description: "Keep floating pane pinned on top." })),
    focus: Type.Optional(
        Type.Boolean({ description: "Focus the floating pane immediately (default: true)." }),
    ),
})

const replOutputSchema = Type.Object({
    status: Type.Literal("opened"),
    paneId: Type.String(),
    name: Type.String(),
    tabName: Type.String(),
})

const paneSchema = Type.Object({
    action: Type.Union(
        [
            Type.Literal("list"),
            Type.Literal("read"),
            Type.Literal("send"),
            Type.Literal("keys"),
            Type.Literal("focus"),
            Type.Literal("float"),
            Type.Literal("close"),
            Type.Literal("sweep"),
        ],
        { description: "Operation to perform on tracked Zellij panes." },
    ),
    pane: Type.Optional(
        Type.String({ description: "Tracked pane ID (e.g. terminal_2) or pane name." }),
    ),
    text: Type.Optional(Type.String({ description: 'Text to send when action is "send".' })),
    raw: Type.Optional(
        Type.Boolean({ description: 'When action is "send", do not press Enter afterwards.' }),
    ),
    keys: Type.Optional(
        Type.Array(Type.String(), {
            description: 'Key sequence for action "keys" (e.g. ["Ctrl c"]).',
        }),
    ),
    full: Type.Optional(
        Type.Boolean({ description: 'Return full scrollback/log when action is "read".' }),
    ),
    ansi: Type.Optional(
        Type.Boolean({ description: 'Preserve ANSI escape sequences when action is "read".' }),
    ),
    maxLines: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 1000, description: "Max tail lines to read." }),
    ),
    killRunning: Type.Optional(
        Type.Boolean({
            description: 'When action is "sweep", also close panes that are still running.',
        }),
    ),
})

const paneOutputSchema = Type.Object({
    action: Type.String(),
    paneId: Type.Union([Type.String(), Type.Null()]),
    output: Type.String(),
})

const waitSchema = Type.Object({
    panes: Type.Optional(
        Type.Array(Type.String(), {
            description:
                "Target pane IDs or names. Omit to wait for all running task and one-shot agent panes.",
        }),
    ),
    mode: Type.Optional(
        Type.Union([Type.Literal("all"), Type.Literal("any")], {
            description:
                '"all" waits for every target and returns early on an input prompt (default); "any" returns after the first exit or prompt.',
        }),
    ),
    timeoutSeconds: Type.Optional(
        Type.Number({
            minimum: 1,
            maximum: 600,
            description: "Maximum seconds to wait before returning a timeout (default: 300).",
        }),
    ),
})

const waitPaneOutputSchema = Type.Object({
    paneId: Type.String(),
    name: Type.String(),
    kind: Type.String(),
    status: Type.String(),
    exitCode: Type.Union([Type.Number(), Type.Null()]),
    needsAttention: Type.Boolean(),
    logPath: Type.Union([Type.String(), Type.Null()]),
    output: Type.String(),
})

const waitOutputSchema = Type.Object({
    status: Type.Union([
        Type.Literal("completed"),
        Type.Literal("needs_attention"),
        Type.Literal("timeout"),
        Type.Literal("aborted"),
        Type.Literal("no_running_panes"),
    ]),
    mode: Type.String(),
    panes: Type.Array(waitPaneOutputSchema),
    message: Type.String(),
})

/**
 * Wrap a shell command so it exports the host Pi `PATH`, tees output to `logPath`,
 * writes its exact exit status to `exitMarkerPath`, and preserves the exit code.
 */
export function wrapCommandWithTee(
    command: string,
    logPath: string,
    exitMarkerPath: string,
    pathEnv = process.env.PATH,
): string[] {
    const pathPrefix = pathEnv ? `export PATH=${shellQuote(pathEnv)}\n` : ""
    const script = [
        "set -o pipefail",
        `${pathPrefix}{ ${command}\n} 2>&1 | tee ${shellQuote(logPath)}`,
        "rc=$?",
        `printf '%s\\n' "$rc" > ${shellQuote(exitMarkerPath)}`,
        'exit "$rc"',
    ].join("\n")
    return ["bash", "-c", script]
}

interface ManagedPaneRequest {
    kind: PaneKind
    name: string
    command: string
    cwd: string
    layout: LayoutMode
    direction?: SplitDirection
    notify?: boolean
    briefText?: string
    artifacts?: ArtifactPaths
    modelLabel?: string
    subagentMode?: SubagentMode
}

async function runManagedPane(
    manager: ZellijSessionManager,
    req: ManagedPaneRequest,
): Promise<{ pane: TrackedPane; logPath: string; briefPath: string }> {
    const { logPath, briefPath, exitMarkerPath } =
        req.artifacts ?? manager.allocateArtifactPaths(req.name)
    if (req.briefText !== undefined) {
        manager.writeBriefFile(briefPath, req.briefText)
    }

    const pane = await manager.spawnInTopology({
        kind: req.kind,
        name: req.name,
        command: wrapCommandWithTee(req.command, logPath, exitMarkerPath),
        cwd: req.cwd,
        layout: req.layout,
        direction: req.direction,
        notify: req.notify ?? req.kind !== "service",
        noFocus: true,
        logPath,
        briefPath: req.briefText !== undefined ? briefPath : undefined,
        exitMarkerPath,
        modelLabel: req.modelLabel,
        subagentMode: req.subagentMode,
    })

    return { pane, logPath, briefPath }
}

function findRpcResponseInLog(
    logPath: string,
    requestId: string,
): { success: boolean; error?: string } | null {
    if (!existsSync(logPath)) return null
    const tail = readTailFromFile(logPath, 64 * 1024).text
    for (const line of tail.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("{")) continue
        try {
            const parsed: unknown = JSON.parse(trimmed)
            if (!isRecord(parsed)) continue
            if (parsed.type === "response" && parsed.id === requestId) {
                return {
                    success: parsed.success === true,
                    error: typeof parsed.error === "string" ? parsed.error : undefined,
                }
            }
        } catch {
            // Ignore partial/non-JSON lines.
        }
    }
    return null
}

const MUTATING_ANNOTATIONS: ToolAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
}

const PANE_ANNOTATIONS: ToolAnnotations = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
}

const NO_WAIT_TARGETS_MESSAGE =
    'No running task or one-shot subagent panes to wait for. Start work with zellij_run or zellij_subagent(mode="one-shot"), or pass panes explicitly. If you just started panes in this same tool batch, wait for those calls to return status=running, then call zellij_wait again. Background completions still arrive as zellij-event follow-ups.'

function clearAttentionAfterInput(
    manager: ZellijSessionManager,
    watcher: PaneWatcher,
    target: TrackedPane,
): void {
    if (target.needsAttention) {
        target.needsAttention = false
        target.lastOutputLine = manager.readLastOutputLine(target)
        manager.markPaneUpdated()
    }
    watcher.refreshUI()
}

type WaitPaneSummary = {
    paneId: string
    name: string
    kind: PaneKind
    status: string
    exitCode: number | null
    needsAttention: boolean
    logPath: string | null
    output: string
}

function isDefaultWaitTarget(pane: TrackedPane): boolean {
    if (pane.status !== "running") return false
    if (pane.kind === "task") return true
    return pane.kind === "agent" && (pane.subagentMode ?? "one-shot") === "one-shot"
}

function indentOutput(text: string): string {
    return text
        .split(/\r?\n/)
        .map((line) => `    ${line}`)
        .join("\n")
}

function formatWaitResultText(
    status: string,
    mode: string,
    message: string,
    panes: readonly WaitPaneSummary[],
): string {
    const lines = [`status: ${status}`, `mode: ${mode}`, `message: ${message}`]
    if (panes.length === 0) return lines.join("\n")
    lines.push("", `panes: ${panes.length}`)
    for (const pane of panes) {
        lines.push(
            "",
            `- paneId: ${pane.paneId} (${pane.name})`,
            `  kind: ${pane.kind}`,
            `  status: ${pane.status}`,
            `  exitCode: ${pane.exitCode !== null ? String(pane.exitCode) : "unknown"}`,
            `  needsAttention: ${pane.needsAttention ? "true" : "false"}`,
            `  logPath: ${pane.logPath ?? "(none)"}`,
            "  output:",
            pane.output ? indentOutput(pane.output) : "    (no output)",
        )
    }
    return lines.join("\n")
}

function buildWaitMessage(
    status: "completed" | "needs_attention" | "timeout" | "aborted",
    mode: "all" | "any",
    panes: readonly WaitPaneSummary[],
    timeoutSeconds: number,
): string {
    const running = panes.filter((p) => p.status === "running").length
    const attentionNames = panes
        .filter((p) => p.status === "running" && p.needsAttention)
        .map((p) => `${p.name} (${p.paneId})`)
        .join(", ")
    const attentionNote = attentionNames ? ` Input needed in ${attentionNames}.` : ""
    switch (status) {
        case "completed": {
            const failed = panes.filter((p) => p.exitCode !== null && p.exitCode !== 0).length
            const base =
                mode === "any"
                    ? "At least one target pane is no longer running."
                    : "All target panes are no longer running."
            return `${base}${failed > 0 ? ` ${failed} pane(s) exited non-zero.` : ""}${attentionNote}`
        }
        case "needs_attention":
            return `Input needed in ${attentionNames || "a target pane"}; inspect the output tail and reply with zellij_pane(action="send") or zellij_pane(action="keys").`
        case "timeout":
            return `${running} pane(s) still running after ${timeoutSeconds}s.${attentionNote} Background zellij-event follow-ups remain active.`
        case "aborted":
            return `Wait cancelled; ${running} pane(s) still running in the background.${attentionNote} Call zellij_wait again or rely on zellij-event follow-ups.`
    }
}

/** Register all Zellij orchestration tools on the Pi extension API. */
export function registerZellijTools(
    pi: ExtensionAPI,
    manager: ZellijSessionManager,
    watcher: PaneWatcher,
): void {
    manager.setPaneFinalizedListener((pane) => watcher.notifyPaneFinalized(pane))

    pi.registerTool({
        name: "zellij_run",
        label: "Zellij Run",
        description:
            "Run a long-running or build/test/lint/check command in a Zellij pane (tasks tab, stacked by default). " +
            "Waits briefly for fast commands and automatically notifies via follow-up when longer jobs finish or need input.",
        promptSnippet: "Run build, test, lint, check, or long commands in a managed Zellij pane",
        promptGuidelines: [
            "Use zellij_run instead of bash for commands that may exceed ~15-30 seconds (builds, full test suites, nixos-rebuild, cargo/tsc/lint, migrations).",
            "Start all independent zellij_run and zellij_subagent calls first. After they return status=running, call zellij_wait in a later tool batch when you need their results; do not run sleep in bash or poll zellij_pane.",
            "If the user asked for background-only work with no wait, end the reply; zellij_run completion still triggers a zellij-event follow-up.",
        ],
        parameters: runSchema,
        outputSchema: runOutputSchema,
        annotations: MUTATING_ANNOTATIONS,
        async execute(_toolCallId, params: Static<typeof runSchema>, signal, _onUpdate, ctx) {
            if (!params.command.trim()) {
                throw new Error("Command cannot be empty.")
            }

            const label = sanitizeIdentifier(
                params.name ?? (params.command.trim().split(/\s+/)[0] || "task"),
                "task",
                40,
            )
            const { pane, logPath } = await runManagedPane(manager, {
                kind: "task",
                name: label,
                command: params.command,
                cwd: params.cwd || ctx.cwd,
                layout: params.layout ?? "stacked",
                direction: params.direction,
            })

            const waitMs = Math.round((params.waitSeconds ?? 8) * 1000)
            const { exited } = await watcher.waitForExit(pane, waitMs, signal)
            watcher.ensureLoopRunning()

            const attach = manager.getAttachHint()
            if (exited) {
                const output = await manager.readPaneOutput(pane, { maxLines: 120 }).catch(() => "")
                const exitCode = pane.exitCode ?? null
                const lines = [
                    `status: exited`,
                    `paneId: ${pane.paneId} (${pane.name})`,
                    `tab: ${pane.tabName} (${pane.layout})`,
                    `exitCode: ${exitCode !== null ? String(exitCode) : "unknown (pane closed externally or missing exit marker)"}`,
                    `logPath: ${logPath}`,
                    attach ? `attach: ${attach}` : undefined,
                    "",
                    output || "(no output)",
                ].filter((l): l is string => l !== undefined)
                return {
                    content: [{ type: "text", text: lines.join("\n") }],
                    structuredContent: {
                        status: "exited",
                        paneId: pane.paneId,
                        name: pane.name,
                        session: manager.getSessionName(),
                        tabName: pane.tabName,
                        layout: pane.layout,
                        exitCode,
                        logPath,
                        output,
                    },
                    details: undefined,
                    isError: exitCode !== 0,
                }
            }

            const preview = await manager.readPaneOutput(pane, { maxLines: 25 }).catch(() => "")
            const lines = [
                `status: running (moved to background; a follow-up event will fire on exit or prompt)`,
                `paneId: ${pane.paneId} (${pane.name})`,
                `session: ${manager.getSessionName()}`,
                `tab: ${pane.tabName} (${pane.layout})`,
                `logPath: ${logPath}`,
                attach ? `attach: ${attach}` : undefined,
                `next: Start other independent background work first; after the start calls return status=running, call zellij_wait in a later batch if you need this result before continuing. Do not run sleep or poll zellij_pane.`,
                `background-only: If the user asked not to wait, end the reply; the follow-up event still fires on exit or prompt.`,
                preview ? `\n--- Initial output ---\n${preview}` : undefined,
            ].filter((l): l is string => l !== undefined)
            return {
                content: [{ type: "text", text: lines.join("\n") }],
                structuredContent: {
                    status: "running",
                    paneId: pane.paneId,
                    name: pane.name,
                    session: manager.getSessionName(),
                    tabName: pane.tabName,
                    layout: pane.layout,
                    exitCode: null,
                    logPath,
                    output: preview,
                },
                details: undefined,
            }
        },
    })

    pi.registerTool({
        name: "zellij_wait",
        label: "Zellij Wait",
        description:
            "Wait for background Zellij tasks or one-shot subagents to finish or request input. " +
            "The wait is event-driven: it spends no tokens while waiting and uses no sleep polling; Pi stays working while it waits, and Esc cancels it.",
        promptSnippet: "Wait for background Zellij tasks or subagents to finish or need input",
        promptGuidelines: [
            'Use zellij_wait after zellij_run or zellij_subagent(mode="one-shot") calls have returned status=running. Call it in a later tool batch, not in the same parallel batch as the start call, and do not run sleep in bash or poll zellij_pane.',
            'zellij_wait defaults to mode="all" and returns early with status=needs_attention when any target pane asks for input; inspect the output tail and reply with zellij_pane(action="send") or zellij_pane(action="keys").',
            "Do not call zellij_wait when the user asked for background-only work with no wait; end the reply and rely on the zellij-event follow-up.",
        ],
        parameters: waitSchema,
        outputSchema: waitOutputSchema,
        annotations: MUTATING_ANNOTATIONS,
        async execute(_toolCallId, params: Static<typeof waitSchema>, signal, onUpdate) {
            const mode = params.mode ?? "all"
            const timeoutSeconds = params.timeoutSeconds ?? 300

            let targets: TrackedPane[]
            if (params.panes && params.panes.length > 0) {
                targets = []
                const seen = new Set<string>()
                for (const query of params.panes) {
                    const trimmed = query.trim()
                    if (!trimmed) {
                        throw new Error('"panes" cannot contain empty entries.')
                    }
                    const pane =
                        manager.getPane(trimmed) ?? manager.getRecentlyFinishedPane(trimmed)
                    if (!pane) {
                        throw new Error(
                            `No tracked pane matches "${query}". If it finished and was reaped, read the logPath from its earlier completion result.`,
                        )
                    }
                    if (seen.has(pane.paneId)) continue
                    seen.add(pane.paneId)
                    targets.push(pane)
                }
            } else {
                targets = manager.getTrackedPanes().filter(isDefaultWaitTarget)
            }

            if (targets.length === 0) {
                const text = formatWaitResultText(
                    "no_running_panes",
                    mode,
                    NO_WAIT_TARGETS_MESSAGE,
                    [],
                )
                return {
                    content: [{ type: "text", text }],
                    structuredContent: {
                        status: "no_running_panes",
                        mode,
                        panes: [],
                        message: NO_WAIT_TARGETS_MESSAGE,
                    },
                    details: undefined,
                }
            }

            const runningBefore = targets.filter((p) => p.status === "running")
            if (runningBefore.length > 0) {
                onUpdate?.({
                    content: [
                        {
                            type: "text",
                            text: `Waiting for ${runningBefore.length} pane(s) (mode=${mode}, timeout=${timeoutSeconds}s): ${runningBefore.map((p) => `${p.name} (${p.paneId})`).join(", ")}`,
                        },
                    ],
                    details: undefined,
                })
            }

            const waitResult = await watcher.waitForPanes(targets, {
                mode,
                timeoutMs: Math.round(timeoutSeconds * 1000),
                signal,
            })
            watcher.ensureLoopRunning()

            const panes: WaitPaneSummary[] = await Promise.all(
                targets.map(async (pane) => {
                    const preferScreen = pane.status === "running" && pane.needsAttention === true
                    const output = await manager
                        .readPaneOutput(pane, { maxLines: 60, preferScreen })
                        .catch(() => "")
                    return {
                        paneId: pane.paneId,
                        name: pane.name,
                        kind: pane.kind,
                        status: pane.status,
                        exitCode: pane.exitCode ?? null,
                        needsAttention: pane.needsAttention === true,
                        logPath: pane.logPath ?? null,
                        output: output || pane.lastOutputLine || "",
                    }
                }),
            )
            const attentionAfterWait = panes.some(
                (pane) => pane.status === "running" && pane.needsAttention,
            )
            const reportedStatus =
                waitResult.status === "completed" && attentionAfterWait
                    ? "needs_attention"
                    : waitResult.status
            const message = buildWaitMessage(reportedStatus, mode, panes, timeoutSeconds)
            const text = formatWaitResultText(reportedStatus, mode, message, panes)
            return {
                content: [{ type: "text", text }],
                structuredContent: {
                    status: reportedStatus,
                    mode,
                    panes,
                    message,
                },
                details: undefined,
            }
        },
    })

    pi.registerTool({
        name: "zellij_service",
        label: "Zellij Service",
        description:
            "Manage persistent background services (dev servers, watchers, docker compose, tunnels) in the Zellij services tab. " +
            "A service exiting during start (even with code 0) or timing out on readyPattern is treated as a startup failure (`isError: true`).",
        promptSnippet:
            "Start, stop, inspect, or read logs of persistent background services in Zellij",
        promptGuidelines: [
            "Use zellij_service for dev servers, file watchers, tunnels, or any process meant to keep running across turns.",
            "Pass readyPattern when you need to confirm startup (for example a listening URL or port line) before proceeding.",
        ],
        parameters: serviceSchema,
        outputSchema: serviceOutputSchema,
        annotations: MUTATING_ANNOTATIONS,
        async execute(_toolCallId, params: Static<typeof serviceSchema>, signal, _onUpdate, ctx) {
            const serviceName = sanitizeIdentifier(params.name, "service", 48)

            if (params.action === "start") {
                if (!params.command || !params.command.trim()) {
                    throw new Error('Missing "command" for zellij_service start.')
                }
                const existing = manager.getPane(serviceName, "service")
                if (existing && existing.status === "running") {
                    throw new Error(
                        `Service "${serviceName}" is already running in ${existing.paneId}. Stop it first or pick another name.`,
                    )
                }

                let readyRegex: RegExp | undefined
                if (params.readyPattern) {
                    if (params.readyPattern.length > MAX_READY_PATTERN_LEN) {
                        throw new Error(`readyPattern exceeds ${MAX_READY_PATTERN_LEN} characters.`)
                    }
                    if (NESTED_QUANTIFIER_RE.test(params.readyPattern)) {
                        throw new Error(
                            `readyPattern "${params.readyPattern}" contains unsafe nested quantifiers.`,
                        )
                    }
                    try {
                        readyRegex = new RegExp(params.readyPattern)
                    } catch (err) {
                        throw new Error(
                            `Invalid readyPattern regex "${params.readyPattern}": ${err instanceof Error ? err.message : String(err)}`,
                            { cause: err },
                        )
                    }
                }

                const artifacts = manager.allocateArtifactPaths(`svc-${serviceName}`)
                const { pane, logPath } = await runManagedPane(manager, {
                    kind: "service",
                    name: serviceName,
                    command: params.command,
                    cwd: params.cwd || ctx.cwd,
                    layout: params.layout ?? "stacked",
                    direction: params.direction,
                    artifacts,
                })

                let readiness: "not_checked" | "ready" | "exited" | "timeout" | "aborted" =
                    "not_checked"
                if (readyRegex) {
                    const timeoutMs = Math.round((params.readyTimeoutSeconds ?? 10) * 1000)
                    readiness = await watcher.waitForReadyPattern(
                        pane,
                        readyRegex,
                        timeoutMs,
                        signal,
                    )
                } else {
                    await watcher.syncNow()
                }
                watcher.ensureLoopRunning()

                const output = await manager.readPaneOutput(pane, { maxLines: 60 }).catch(() => "")
                const attach = manager.getAttachHint()
                const exitCode = pane.exitCode ?? null
                const lines = [
                    `service: ${pane.name} (${pane.paneId})`,
                    `status: ${pane.status}`,
                    `readiness: ${readiness}`,
                    pane.status === "exited" ? `exitCode: ${exitCode ?? "unknown"}` : undefined,
                    `tab: ${pane.tabName} (${pane.layout})`,
                    `logPath: ${logPath}`,
                    attach ? `attach: ${attach}` : undefined,
                    "",
                    output || "(no output yet)",
                ].filter((l): l is string => l !== undefined)
                return {
                    content: [{ type: "text", text: lines.join("\n") }],
                    structuredContent: {
                        action: "start",
                        name: pane.name,
                        paneId: pane.paneId,
                        status: pane.status,
                        readiness,
                        exitCode,
                        logPath,
                        output,
                    },
                    details: undefined,
                    isError: pane.status === "exited" || readiness === "timeout",
                }
            }

            if (params.action === "stop") {
                await watcher.syncNow()
                const existing = manager.getPane(serviceName, "service")
                if (!existing) {
                    throw new Error(`No tracked service matches "${params.name}".`)
                }
                const wasRunning = existing.status === "running"
                const closed = await manager.closeTrackedPane(existing.paneId, "service")
                watcher.ensureLoopRunning()
                const msg = wasRunning
                    ? `Stopped service "${closed.name}" (${closed.paneId}).`
                    : `Closed already-exited service "${closed.name}" (${closed.paneId}).`
                return {
                    content: [{ type: "text", text: msg }],
                    structuredContent: {
                        action: "stop",
                        name: closed.name,
                        paneId: closed.paneId,
                        status: "closed",
                        readiness: null,
                        exitCode: closed.exitCode ?? null,
                        logPath: closed.logPath ?? null,
                        output: null,
                    },
                    details: undefined,
                }
            }

            await watcher.syncNow()
            const pane = manager.getPane(serviceName, "service")
            if (!pane) {
                throw new Error(`No tracked service matches "${params.name}".`)
            }

            if (params.action === "status") {
                const text = [
                    `service: ${pane.name} (${pane.paneId})`,
                    `status: ${pane.status}`,
                    pane.exitCode !== undefined && pane.exitCode !== null
                        ? `exitCode: ${pane.exitCode}`
                        : undefined,
                    `tab: ${pane.tabName} (${pane.layout})`,
                    pane.logPath ? `logPath: ${pane.logPath}` : undefined,
                ]
                    .filter((l): l is string => Boolean(l))
                    .join("\n")
                return {
                    content: [{ type: "text", text }],
                    structuredContent: {
                        action: "status",
                        name: pane.name,
                        paneId: pane.paneId,
                        status: pane.status,
                        readiness: null,
                        exitCode: pane.exitCode ?? null,
                        logPath: pane.logPath ?? null,
                        output: null,
                    },
                    details: undefined,
                }
            }

            const logs = await manager.readPaneOutput(pane, { maxLines: params.lines ?? 80 })
            return {
                content: [{ type: "text", text: logs || "(no output)" }],
                structuredContent: {
                    action: "logs",
                    name: pane.name,
                    paneId: pane.paneId,
                    status: pane.status,
                    readiness: null,
                    exitCode: pane.exitCode ?? null,
                    logPath: pane.logPath ?? null,
                    output: logs,
                },
                details: undefined,
            }
        },
    })

    pi.registerTool({
        name: "zellij_subagent",
        label: "Zellij Subagent",
        description:
            "Delegate a self-contained subtask to an isolated child `pi` process inside the Zellij agents tab (stacked by default). " +
            "Shows live progress in Zellij and notifies the parent session when done.",
        promptSnippet: "Delegate an isolated subtask to a child pi subagent in a Zellij pane",
        promptGuidelines: [
            "Use zellij_subagent for wide file surveys, long audits, or independent parallel subtasks that would bloat the main context.",
            "Write a completely self-contained prompt with absolute paths, constraints, and desired answer shape (child pi has an empty context).",
            "Keep child tools read-only (default) unless the task explicitly requires bash, edit, or write.",
            'Start independent zellij_subagent and zellij_run calls first. For mode="one-shot", after the start call returns status=running, call zellij_wait in a later tool batch when you need the answer; do not run sleep in bash or poll zellij_pane.',
            "If the user asked for background-only work with no wait, end the reply; one-shot zellij_subagent completion still triggers a zellij-event follow-up.",
        ],
        parameters: subagentSchema,
        outputSchema: subagentOutputSchema,
        annotations: MUTATING_ANNOTATIONS,
        async execute(_toolCallId, params: Static<typeof subagentSchema>, signal, _onUpdate, ctx) {
            const label = sanitizeIdentifier(
                params.name.startsWith("sub-") ? params.name : `sub-${params.name}`,
                "sub-agent",
                48,
            )
            const mode = params.mode ?? "one-shot"
            const cwd = params.cwd || ctx.cwd
            const modelPattern =
                params.model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined)
            const thinkingLevel = params.thinking ?? pi.getThinkingLevel()

            const requestedTools =
                params.tools && params.tools.length > 0
                    ? params.tools
                    : ["read", "grep", "find", "ls"]
            // RPC prompts instruct the child to read the brief file, so ensure `read` is enabled.
            const toolsList =
                mode === "rpc" && !requestedTools.includes("read")
                    ? ["read", ...requestedTools]
                    : requestedTools

            const piArgs = [
                "env",
                "PI_ZELLIJ_SUBAGENT=1",
                "pi",
                mode === "rpc" ? "--mode" : "-p",
                ...(mode === "rpc" ? ["rpc"] : []),
                "--no-session",
                "--tools",
                toolsList.join(","),
            ]
            if (modelPattern) {
                piArgs.push("--model", modelPattern)
            }
            if (thinkingLevel) {
                piArgs.push("--thinking", thinkingLevel)
            }

            // Allocate once and reuse the exact `briefPath` in both the command and `writeBriefFile`.
            const artifacts = manager.allocateArtifactPaths(label)
            const effectivePiArgs =
                mode === "one-shot" ? [...piArgs, `@${artifacts.briefPath}`] : piArgs
            const commandStr = effectivePiArgs.map(shellQuote).join(" ")
            const modelLabel = modelPattern
                ? `${modelPattern}${thinkingLevel ? ` (${thinkingLevel})` : ""}`
                : `default${thinkingLevel ? ` (${thinkingLevel})` : ""}`

            const { pane, logPath, briefPath } = await runManagedPane(manager, {
                kind: "agent",
                name: label,
                command: commandStr,
                cwd,
                layout: params.layout ?? "stacked",
                notify: mode !== "rpc",
                briefText: params.prompt,
                artifacts,
                modelLabel,
                subagentMode: mode,
            })

            if (mode === "rpc") {
                try {
                    // Wait until foreground command in `command_state` becomes `pi` (not `bash -c`).
                    let piStarted = false
                    for (let i = 0; i < 20; i++) {
                        await new Promise((done) => setTimeout(done, 250))
                        await watcher.syncNow()
                        if (pane.status !== "running") {
                            const failOut = await manager
                                .readPaneOutput(pane, { maxLines: 60 })
                                .catch(() => "")
                            throw new Error(
                                `RPC subagent "${pane.name}" exited before ready (exit ${pane.exitCode ?? "?"}): ${failOut}`,
                            )
                        }
                        const livePanes = await listPanes(pi, manager.getSessionName()).catch(
                            () => [],
                        )
                        const live = livePanes.find((p) => !p.is_plugin && p.id === pane.numericId)
                        const fgCmd = live?.command_state?.runningCommandText ?? ""
                        if (/(?:^|\/)pi(?:\s|$)/.test(fgCmd)) {
                            piStarted = true
                            break
                        }
                    }
                    if (!piStarted) {
                        const failOut = await manager
                            .readPaneOutput(pane, { maxLines: 60 })
                            .catch(() => "")
                        throw new Error(
                            `RPC subagent "${pane.name}" did not become ready${failOut ? `: ${failOut}` : "."}`,
                        )
                    }

                    const rpcPrompt = JSON.stringify({
                        id: "1",
                        type: "prompt",
                        message: `Read ${briefPath} and follow all instructions in it.`,
                    })
                    if (Buffer.byteLength(rpcPrompt, "utf8") > MAX_PTY_LINE_BYTES) {
                        throw new Error(
                            "RPC prompt envelope exceeds canonical PTY line buffer limit.",
                        )
                    }

                    await writeChars(pi, manager.getSessionName(), pane.paneId, rpcPrompt)
                    await sendKeys(pi, manager.getSessionName(), pane.paneId, ["Enter"])

                    // Verify `pi --mode rpc` acknowledged prompt `"1"`.
                    let acked: { success: boolean; error?: string } | null = null
                    for (let i = 0; i < 20; i++) {
                        acked = findRpcResponseInLog(logPath, "1")
                        if (acked) break
                        await new Promise((done) => setTimeout(done, 250))
                        await watcher.syncNow()
                        if (pane.status !== "running") break
                    }
                    if (!acked) {
                        throw new Error(
                            `RPC subagent "${pane.name}" did not acknowledge initial prompt.`,
                        )
                    }
                    if (!acked.success) {
                        throw new Error(
                            `RPC subagent "${pane.name}" rejected prompt: ${acked.error ?? "unknown error"}`,
                        )
                    }
                } catch (err) {
                    await manager.closeTrackedPane(pane.paneId).catch(() => {})
                    watcher.ensureLoopRunning()
                    throw err
                }

                watcher.ensureLoopRunning()
                const text = [
                    `status: rpc_running`,
                    `paneId: ${pane.paneId} (${pane.name})`,
                    `model: ${modelLabel}`,
                    `briefPath: ${briefPath}`,
                    `rpcLogPath: ${logPath}`,
                    `note: Send short JSON prompts (<= ${MAX_PTY_LINE_BYTES} bytes) with zellij_pane(action="send") or read rpcLogPath.`,
                ].join("\n")
                return {
                    content: [{ type: "text", text }],
                    structuredContent: {
                        status: "rpc_running",
                        paneId: pane.paneId,
                        name: pane.name,
                        model: modelLabel,
                        exitCode: null,
                        briefPath,
                        logPath,
                        output: "",
                    },
                    details: undefined,
                }
            }

            const waitMs = Math.round((params.waitSeconds ?? 10) * 1000)
            const { exited } = await watcher.waitForExit(pane, waitMs, signal)
            watcher.ensureLoopRunning()

            if (exited) {
                const output = await manager.readPaneOutput(pane, { maxLines: 160 }).catch(() => "")
                const exitCode = pane.exitCode ?? null
                const text = [
                    `status: exited`,
                    `paneId: ${pane.paneId} (${pane.name})`,
                    `model: ${modelLabel}`,
                    `exitCode: ${exitCode ?? "unknown"}`,
                    `logPath: ${logPath}`,
                    "",
                    output || "(no output)",
                ].join("\n")
                return {
                    content: [{ type: "text", text }],
                    structuredContent: {
                        status: "exited",
                        paneId: pane.paneId,
                        name: pane.name,
                        model: modelLabel,
                        exitCode,
                        briefPath,
                        logPath,
                        output,
                    },
                    details: undefined,
                    isError: exitCode !== 0,
                }
            }

            const text = [
                `status: running (moved to background; a follow-up event will deliver the answer on completion)`,
                `paneId: ${pane.paneId} (${pane.name})`,
                `model: ${modelLabel}`,
                `tab: ${pane.tabName} (${pane.layout})`,
                `briefPath: ${briefPath}`,
                `logPath: ${logPath}`,
                `next: Start other independent background work first; after the start calls return status=running, call zellij_wait in a later batch if you need this subagent's answer before continuing. Do not run sleep or poll zellij_pane.`,
                `background-only: If the user asked not to wait, end the reply; the follow-up event still delivers the answer on completion.`,
            ].join("\n")
            return {
                content: [{ type: "text", text }],
                structuredContent: {
                    status: "running",
                    paneId: pane.paneId,
                    name: pane.name,
                    model: modelLabel,
                    exitCode: null,
                    briefPath,
                    logPath,
                    output: "",
                },
                details: undefined,
            }
        },
    })

    pi.registerTool({
        name: "zellij_repl",
        label: "Zellij REPL",
        description:
            "Open an interactive terminal, REPL, ssh session, or debugger in a Zellij floating pane on the active tab.",
        promptSnippet: "Open an interactive terminal or REPL in a floating Zellij pane",
        promptGuidelines: [
            "Use zellij_repl for interactive shells, REPLs (nix repl, python, gdb), ssh, or TUI tools that the user will interact with.",
        ],
        parameters: replSchema,
        outputSchema: replOutputSchema,
        annotations: MUTATING_ANNOTATIONS,
        async execute(_toolCallId, params: Static<typeof replSchema>, _signal, _onUpdate, ctx) {
            const label = sanitizeIdentifier(params.name ?? "repl", "repl", 40)
            const shell = process.env.SHELL || "bash"
            const pathPrefix = process.env.PATH
                ? `export PATH=${shellQuote(process.env.PATH)}; `
                : ""
            const cmd = params.command?.trim()
                ? ["bash", "-c", `${pathPrefix}${params.command}`]
                : [shell]

            const pane = await manager.spawnInTopology({
                kind: "repl",
                name: label,
                command: cmd,
                cwd: params.cwd || ctx.cwd,
                layout: "floating",
                noFocus: params.focus === false,
                notify: false,
                floatingCoords: {
                    x: params.x ?? "10%",
                    y: params.y ?? "10%",
                    width: params.width ?? "80%",
                    height: params.height ?? "80%",
                    pinned: params.pinned,
                },
            })
            watcher.ensureLoopRunning()

            const attach = manager.getAttachHint()
            const text = [
                `status: opened`,
                `paneId: ${pane.paneId} (${pane.name})`,
                `layout: floating on ${pane.tabName}`,
                attach ? `attach: ${attach}` : undefined,
            ]
                .filter((l): l is string => Boolean(l))
                .join("\n")
            return {
                content: [{ type: "text", text }],
                structuredContent: {
                    status: "opened",
                    paneId: pane.paneId,
                    name: pane.name,
                    tabName: pane.tabName,
                },
                details: undefined,
            }
        },
    })

    pi.registerTool({
        name: "zellij_pane",
        label: "Zellij Pane",
        description:
            "Inspect, read output from, send input/keys to, focus, float/embed, close, or sweep managed Zellij panes.",
        promptSnippet: "List, read, send input/keys, float, focus, close, or sweep Zellij panes",
        promptGuidelines: [
            'Successful one-shot tasks and subagents close automatically after the turn settles; use zellij_pane(action="sweep") or action="close" to clean up failed panes or finished RPC subagents.',
        ],
        parameters: paneSchema,
        outputSchema: paneOutputSchema,
        annotations: PANE_ANNOTATIONS,
        async execute(_toolCallId, params: Static<typeof paneSchema>) {
            if (params.action === "list") {
                await watcher.syncNow()
                const tracked = manager.getTrackedPanes()
                const session = manager.getSessionName()
                const live = manager.isSessionReady()
                    ? await listPanes(pi, session).catch(() => [])
                    : []
                const liveById = indexLivePanesById(live)

                if (tracked.length === 0) {
                    const msg = `Session "${session}" has no tracked panes.`
                    return {
                        content: [{ type: "text", text: msg }],
                        structuredContent: { action: "list", paneId: null, output: msg },
                        details: undefined,
                    }
                }

                const rows = tracked.map((p) => {
                    const lp = liveById.get(p.numericId)
                    const att = lp?.attention?.status ?? "-"
                    const floating = lp?.is_floating ? " floating" : ""
                    return `- ${p.paneId} name=${p.name} kind=${p.kind} status=${p.status}${p.exitCode !== undefined && p.exitCode !== null ? `(${p.exitCode})` : ""} tab=${p.tabName}/${p.layout}${floating} attention=${att}`
                })
                const attach = manager.getAttachHint()
                if (attach) rows.push(`attach: ${attach}`)
                const text = rows.join("\n")
                return {
                    content: [{ type: "text", text }],
                    structuredContent: { action: "list", paneId: null, output: text },
                    details: undefined,
                }
            }

            if (params.action === "sweep") {
                const { closed, keptRunning, failed } = await manager.sweep({
                    killRunning: params.killRunning ?? false,
                })
                watcher.ensureLoopRunning()
                const baseMsg = `Closed ${closed.length} pane(s); ${keptRunning.length} still running.`
                const msg =
                    failed.length > 0
                        ? `${baseMsg} Failed to close ${failed.length}: ${failed.map((f) => `${f.pane.paneId} (${f.error})`).join(", ")}`
                        : baseMsg
                return {
                    content: [{ type: "text", text: msg }],
                    structuredContent: { action: "sweep", paneId: null, output: msg },
                    details: undefined,
                    isError: failed.length > 0,
                }
            }

            if (!params.pane) {
                throw new Error(`"pane" is required for action "${params.action}".`)
            }
            const target = manager.getPane(params.pane)
            if (!target) {
                throw new Error(`No tracked pane matches "${params.pane}".`)
            }

            const session = manager.getSessionName()
            switch (params.action) {
                case "read": {
                    await watcher.syncNow()
                    const out = await manager.readPaneOutput(target, {
                        full: params.full ?? false,
                        ansi: params.ansi ?? false,
                        maxLines: params.maxLines ?? 120,
                    })
                    if (!out) {
                        const screenOut = (
                            await dumpScreen(pi, session, target.paneId, {
                                full: params.full ?? false,
                                ansi: params.ansi ?? false,
                            })
                        ).trimEnd()
                        return {
                            content: [{ type: "text", text: screenOut || "(empty screen)" }],
                            structuredContent: {
                                action: "read",
                                paneId: target.paneId,
                                output: screenOut,
                            },
                            details: undefined,
                        }
                    }
                    return {
                        content: [{ type: "text", text: out || "(no output)" }],
                        structuredContent: {
                            action: "read",
                            paneId: target.paneId,
                            output: out,
                        },
                        details: undefined,
                    }
                }
                case "send": {
                    if (params.text === undefined) {
                        throw new Error('"text" is required for action "send".')
                    }
                    await watcher.syncNow()
                    if (target.status !== "running") {
                        throw new Error(
                            `Cannot send input to ${target.paneId} (${target.name}): status is ${target.status}.`,
                        )
                    }
                    if (Buffer.byteLength(params.text, "utf8") > MAX_PTY_LINE_BYTES) {
                        throw new Error(
                            `Input exceeds canonical PTY line limit (${MAX_PTY_LINE_BYTES} bytes).`,
                        )
                    }
                    await markPaneSeen(pi, session, target.paneId).catch(() => {})
                    await writeChars(pi, session, target.paneId, params.text)
                    if (!params.raw) {
                        await sendKeys(pi, session, target.paneId, ["Enter"])
                    }
                    clearAttentionAfterInput(manager, watcher, target)
                    const msg = `Sent input to ${target.paneId} (${target.name}).`
                    return {
                        content: [{ type: "text", text: msg }],
                        structuredContent: {
                            action: "send",
                            paneId: target.paneId,
                            output: msg,
                        },
                        details: undefined,
                    }
                }
                case "keys": {
                    if (!params.keys || params.keys.length === 0) {
                        throw new Error('"keys" is required for action "keys".')
                    }
                    if (params.keys.some((k) => k.trim().length === 0)) {
                        throw new Error('"keys" cannot contain empty key names.')
                    }
                    await watcher.syncNow()
                    if (target.status !== "running") {
                        throw new Error(
                            `Cannot send keys to ${target.paneId} (${target.name}): status is ${target.status}.`,
                        )
                    }
                    await markPaneSeen(pi, session, target.paneId).catch(() => {})
                    await sendKeys(pi, session, target.paneId, params.keys)
                    clearAttentionAfterInput(manager, watcher, target)
                    const msg = `Sent keys [${params.keys.join(", ")}] to ${target.paneId}.`
                    return {
                        content: [{ type: "text", text: msg }],
                        structuredContent: {
                            action: "keys",
                            paneId: target.paneId,
                            output: msg,
                        },
                        details: undefined,
                    }
                }
                case "focus": {
                    await focusPane(pi, session, target.paneId)
                    const msg = `Focused ${target.paneId} (${target.name}).`
                    return {
                        content: [{ type: "text", text: msg }],
                        structuredContent: {
                            action: "focus",
                            paneId: target.paneId,
                            output: msg,
                        },
                        details: undefined,
                    }
                }
                case "float": {
                    await toggleEmbedOrFloating(pi, session, target.paneId)
                    const msg = `Toggled floating/embedded state for ${target.paneId} (${target.name}).`
                    return {
                        content: [{ type: "text", text: msg }],
                        structuredContent: {
                            action: "float",
                            paneId: target.paneId,
                            output: msg,
                        },
                        details: undefined,
                    }
                }
                case "close": {
                    const closed = await manager.closeTrackedPane(target.paneId)
                    watcher.ensureLoopRunning()
                    const msg = `Closed ${closed.paneId} (${closed.name}).`
                    return {
                        content: [{ type: "text", text: msg }],
                        structuredContent: {
                            action: "close",
                            paneId: closed.paneId,
                            output: msg,
                        },
                        details: undefined,
                    }
                }
            }
        },
    })
}
