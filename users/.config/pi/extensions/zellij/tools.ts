import type { ExtensionAPI, ToolAnnotations } from "@earendil-works/pi-coding-agent"
import { Type, type Static } from "typebox"
import {
    dumpScreen,
    focusPane,
    listPanes,
    sanitizeIdentifier,
    sendKeys,
    shellQuote,
    toggleEmbedOrFloating,
    writeChars,
} from "./cli.ts"
import type { ZellijSessionManager } from "./session.ts"
import { indexLivePanesById } from "./types.ts"
import type { PaneWatcher } from "./watcher.ts"

const MAX_READY_PATTERN_LEN = 256
const MAX_PTY_LINE_BYTES = 3800

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

function wrapCommandWithTee(command: string, logPath: string): string[] {
    return ["bash", "-c", `set -o pipefail; { ${command}\n} 2>&1 | tee ${shellQuote(logPath)}`]
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

/** Register all Zellij orchestration tools on the Pi extension API. */
export function registerZellijTools(
    pi: ExtensionAPI,
    manager: ZellijSessionManager,
    watcher: PaneWatcher,
): void {
    pi.registerTool({
        name: "zellij_run",
        label: "Zellij Run",
        description:
            "Run a long-running or build/test/lint/check command in a Zellij pane (tasks tab, stacked by default). " +
            "Waits briefly for fast commands and automatically notifies via follow-up when longer jobs finish or need input.",
        promptSnippet: "Run build, test, lint, check, or long commands in a managed Zellij pane",
        promptGuidelines: [
            "Use zellij_run instead of bash for commands that may exceed ~15-30 seconds (builds, full test suites, nixos-rebuild, cargo/tsc/lint, migrations).",
            "Do not poll zellij_pane in a loop after zellij_run returns status=running; the extension pushes a follow-up event automatically when the pane exits or needs input.",
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
            const { logPath } = manager.allocateArtifactPaths(label)
            const cwd = params.cwd || ctx.cwd
            const layout = params.layout ?? "stacked"

            const pane = await manager.spawnInTopology({
                kind: "task",
                name: label,
                command: wrapCommandWithTee(params.command, logPath),
                cwd,
                layout,
                direction: params.direction,
                notify: true,
                noFocus: true,
                logPath,
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
                    `exitCode: ${exitCode ?? "unknown"}`,
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
                `status: running (moved to background; follow-up event will fire on exit or prompt)`,
                `paneId: ${pane.paneId} (${pane.name})`,
                `session: ${manager.getSessionName()}`,
                `tab: ${pane.tabName} (${pane.layout})`,
                `logPath: ${logPath}`,
                attach ? `attach: ${attach}` : undefined,
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
        name: "zellij_service",
        label: "Zellij Service",
        description:
            "Manage persistent background services (dev servers, watchers, docker compose, tunnels) in the Zellij services tab.",
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
                    try {
                        readyRegex = new RegExp(params.readyPattern)
                    } catch (err) {
                        throw new Error(
                            `Invalid readyPattern regex "${params.readyPattern}": ${err instanceof Error ? err.message : String(err)}`,
                            { cause: err },
                        )
                    }
                }

                const { logPath } = manager.allocateArtifactPaths(`svc-${serviceName}`)
                const pane = await manager.spawnInTopology({
                    kind: "service",
                    name: serviceName,
                    command: wrapCommandWithTee(params.command, logPath),
                    cwd: params.cwd || ctx.cwd,
                    layout: params.layout ?? "stacked",
                    direction: params.direction,
                    notify: true,
                    noFocus: true,
                    logPath,
                })

                let readiness: "not_checked" | "ready" | "exited" | "timeout" = "not_checked"
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
                    isError: pane.status === "exited",
                }
            }

            if (params.action === "stop") {
                const closed = await manager.closeTrackedPane(serviceName, "service")
                watcher.ensureLoopRunning()
                const msg = `Stopped service "${closed.name}" (${closed.paneId}).`
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

            const pane = manager.getPane(serviceName, "service")
            if (!pane) {
                throw new Error(`No tracked service matches "${params.name}".`)
            }
            await watcher.syncNow()

            if (params.action === "status") {
                const text = [
                    `service: ${pane.name} (${pane.paneId})`,
                    `status: ${pane.status}`,
                    pane.exitCode !== undefined ? `exitCode: ${pane.exitCode}` : undefined,
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
            const { logPath, briefPath } = manager.allocateArtifactPaths(label)
            manager.writeBriefFile(briefPath, params.prompt)

            const modelPattern =
                params.model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined)
            const thinkingLevel = params.thinking ?? pi.getThinkingLevel()
            const toolsList =
                params.tools && params.tools.length > 0
                    ? params.tools
                    : ["read", "grep", "find", "ls"]

            // Mark child pi so it skips loading this Zellij orchestrator extension recursively.
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
            if (mode === "one-shot") {
                piArgs.push(`@${briefPath}`)
            }

            const commandStr = piArgs.map(shellQuote).join(" ")
            const modelLabel = modelPattern
                ? `${modelPattern}${thinkingLevel ? ` (${thinkingLevel})` : ""}`
                : `default${thinkingLevel ? ` (${thinkingLevel})` : ""}`

            const pane = await manager.spawnInTopology({
                kind: "agent",
                name: label,
                command: wrapCommandWithTee(commandStr, logPath),
                cwd,
                layout: params.layout ?? "stacked",
                notify: true,
                noFocus: true,
                logPath,
                briefPath,
                subagentMode: mode,
                modelLabel,
            })

            if (mode === "rpc") {
                // Wait briefly for child `pi --mode rpc` to enter Running state before sending prompt.
                for (let i = 0; i < 20; i++) {
                    await new Promise((resolve) => setTimeout(resolve, 250))
                    await watcher.syncNow()
                    if (pane.status !== "running") {
                        const failOut = await manager
                            .readPaneOutput(pane, { maxLines: 60 })
                            .catch(() => "")
                        throw new Error(
                            `RPC subagent "${pane.name}" exited before ready (exit ${pane.exitCode ?? "?"}): ${failOut}`,
                        )
                    }
                    const panes = await listPanes(pi, manager.getSessionName()).catch(() => [])
                    const live = panes.find((p) => !p.is_plugin && p.id === pane.numericId)
                    if (live?.pane_command?.includes("pi")) break
                }

                const rpcPrompt = JSON.stringify({
                    id: "1",
                    type: "prompt",
                    message: `Read ${briefPath} and follow all instructions in it.`,
                })
                if (Buffer.byteLength(rpcPrompt, "utf8") > MAX_PTY_LINE_BYTES) {
                    throw new Error("RPC prompt envelope exceeds canonical PTY line buffer limit.")
                }
                await writeChars(pi, manager.getSessionName(), pane.paneId, rpcPrompt)
                await sendKeys(pi, manager.getSessionName(), pane.paneId, ["Enter"])
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
                `status: running (moved to background; follow-up event will deliver answer on completion)`,
                `paneId: ${pane.paneId} (${pane.name})`,
                `model: ${modelLabel}`,
                `tab: ${pane.tabName} (${pane.layout})`,
                `briefPath: ${briefPath}`,
                `logPath: ${logPath}`,
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
            const cmd = params.command?.trim() ? ["bash", "-c", params.command] : [shell]

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
                const { closed, keptRunning } = await manager.sweep({
                    killRunning: params.killRunning ?? false,
                })
                watcher.ensureLoopRunning()
                const msg = `Closed ${closed.length} pane(s); ${keptRunning.length} still running.`
                return {
                    content: [{ type: "text", text: msg }],
                    structuredContent: { action: "sweep", paneId: null, output: msg },
                    details: undefined,
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
                    if (params.ansi) {
                        const out = (
                            await dumpScreen(pi, session, target.paneId, {
                                full: params.full ?? true,
                                ansi: true,
                            })
                        ).trimEnd()
                        return {
                            content: [{ type: "text", text: out || "(empty screen)" }],
                            structuredContent: {
                                action: "read",
                                paneId: target.paneId,
                                output: out,
                            },
                            details: undefined,
                        }
                    }
                    const out = await manager.readPaneOutput(target, {
                        full: params.full ?? false,
                        maxLines: params.maxLines ?? 120,
                    })
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
                    await writeChars(pi, session, target.paneId, params.text)
                    if (!params.raw) {
                        await sendKeys(pi, session, target.paneId, ["Enter"])
                    }
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
                    await watcher.syncNow()
                    if (target.status !== "running") {
                        throw new Error(
                            `Cannot send keys to ${target.paneId} (${target.name}): status is ${target.status}.`,
                        )
                    }
                    await sendKeys(pi, session, target.paneId, params.keys)
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
