import assert from "node:assert/strict"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import test from "node:test"
import { ZellijSessionManager } from "../src/session.ts"
import { registerZellijTools, wrapCommandWithTee } from "../src/tools.ts"
import { PaneWatcher } from "../src/watcher.ts"
import { createMockContext, createMockRuntime, waitForRegisteredWaiters } from "./helpers.ts"

void test("wrapCommandWithTee embeds PATH, tee log, and exit marker", () => {
    const cmd = wrapCommandWithTee("npm test", "/tmp/a.log", "/tmp/a.exit", "/custom/bin")
    assert.equal(cmd[0], "bash")
    assert.equal(cmd[1], "-c")
    assert.match(cmd[2] ?? "", /export PATH='\/custom\/bin'/)
    assert.match(cmd[2] ?? "", /tee '\/tmp\/a\.log'/)
    assert.match(cmd[2] ?? "", /> '\/tmp\/a\.exit'/)
})

void test("zellij_subagent one-shot passes the exact briefPath written to disk", async () => {
    const newTabCommands: string[] = []
    const sessionId = `sub-test-${Date.now()}`
    const { pi, tools } = createMockRuntime((_cmd, args) => {
        if (args.includes("list-clients")) {
            return Promise.resolve({
                stdout: "CLIENT_ID\n1\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-tabs")) {
            return Promise.resolve({
                stdout: "[]",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-tab")) {
            newTabCommands.push(args.join(" "))
            return Promise.resolve({
                stdout: "2\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-panes")) {
            return Promise.resolve({
                stdout: JSON.stringify([
                    {
                        id: 5,
                        is_plugin: false,
                        is_floating: false,
                        exited: true,
                        exit_status: 0,
                        tab_id: 2,
                        tab_name: "agents",
                    },
                ]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-subagent"
    try {
        const manager = new ZellijSessionManager(pi)
        const ctx = createMockContext(sessionId)
        manager.bindContext(ctx)
        const watcher = new PaneWatcher(pi, manager)
        registerZellijTools(pi, manager, watcher)

        const subTool = tools.get("zellij_subagent")
        assert.ok(subTool)
        const res = await subTool.execute(
            "call-1",
            { name: "audit", prompt: "Inspect foo.ts", waitSeconds: 1 },
            undefined,
            undefined,
            ctx as never,
        )
        const sc = res.structuredContent as { briefPath: string; status: string }
        assert.equal(sc.status, "exited")
        assert.equal(manager.getPane("sub-audit")?.subagentMode, "one-shot")
        assert.ok(existsSync(sc.briefPath), "briefPath must exist on disk")
        assert.equal(readFileSync(sc.briefPath, "utf-8"), "Inspect foo.ts")
        assert.ok(
            newTabCommands[0]?.includes(`@${sc.briefPath}`),
            `command must reference exact briefPath ${sc.briefPath}`,
        )
        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        const uid = typeof process.getuid === "function" ? process.getuid() : 0
        rmSync(`/run/user/${uid}/pi-zellij-${uid}/${sessionId}`, { recursive: true, force: true })
        rmSync(`/tmp/pi-zellij-${uid}/${sessionId}`, { recursive: true, force: true })
    }
})

void test("waitForReadyPattern and zellij_service handle ready, exited, timeout, aborted, and vanished panes", async () => {
    let paneExited = false
    let panePresent = true
    const sessionId = `svc-test-${Date.now()}`
    const { pi, tools } = createMockRuntime((_cmd, args) => {
        if (args.includes("list-clients")) {
            return Promise.resolve({
                stdout: "CLIENT_ID\n1\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-tabs")) {
            return Promise.resolve({
                stdout: JSON.stringify([
                    { position: 0, name: "services", active: false, tab_id: 3 },
                ]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-pane")) {
            return Promise.resolve({
                stdout: "terminal_41\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-panes")) {
            const payload = panePresent
                ? [
                      {
                          id: 41,
                          is_plugin: false,
                          is_floating: false,
                          exited: paneExited,
                          exit_status: paneExited ? 1 : null,
                          tab_id: 3,
                          tab_name: "services",
                      },
                  ]
                : []
            return Promise.resolve({
                stdout: JSON.stringify(payload),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-svc"
    try {
        const manager = new ZellijSessionManager(pi)
        const ctx = createMockContext(sessionId)
        manager.bindContext(ctx)
        const watcher = new PaneWatcher(pi, manager)
        registerZellijTools(pi, manager, watcher)

        const svcTool = tools.get("zellij_service")
        assert.ok(svcTool)

        // Start without readyPattern, then inspect ready/timeout/aborted on watcher directly.
        await svcTool.execute(
            "call-start",
            { action: "start", name: "api", command: "node server.js" },
            undefined,
            undefined,
            ctx as never,
        )
        const pane = manager.getPane("api", "service")
        assert.ok(pane?.logPath)

        // Timeout branch (short 60ms wait).
        assert.equal(await watcher.waitForReadyPattern(pane, /READY/, 60), "timeout")

        // Pre-aborted signal branch.
        const preAborted = new AbortController()
        preAborted.abort()
        assert.equal(
            await watcher.waitForReadyPattern(pane, /READY/, 5000, preAborted.signal),
            "aborted",
        )

        // Tool-level aborted branch must not set isError.
        const abortedStart = await svcTool.execute(
            "call-abort",
            {
                action: "start",
                name: "api-abort",
                command: "node server.js",
                readyPattern: "READY",
                readyTimeoutSeconds: 5,
            },
            preAborted.signal,
            undefined,
            ctx as never,
        )
        assert.equal((abortedStart.structuredContent as { readiness: string }).readiness, "aborted")
        assert.equal(abortedStart.isError, false)

        // Ready branch via log file match.
        writeFileSync(pane.logPath, "listening READY on 8080\n", "utf-8")
        assert.equal(await watcher.waitForReadyPattern(pane, /READY/, 500), "ready")

        // External removal must be caught by status/logs after syncNow().
        panePresent = false
        await assert.rejects(
            () =>
                svcTool.execute(
                    "call-status",
                    { action: "status", name: "api" },
                    undefined,
                    undefined,
                    ctx as never,
                ),
            /No tracked service matches/,
        )
        await assert.rejects(
            () =>
                svcTool.execute(
                    "call-logs",
                    { action: "logs", name: "api" },
                    undefined,
                    undefined,
                    ctx as never,
                ),
            /No tracked service matches/,
        )

        // Exited branch via tool.
        panePresent = true
        paneExited = true
        const exitedRes = await svcTool.execute(
            "call-exited",
            {
                action: "start",
                name: "api-crash",
                command: "false",
                readyPattern: "READY",
                readyTimeoutSeconds: 2,
            },
            undefined,
            undefined,
            ctx as never,
        )
        assert.equal((exitedRes.structuredContent as { readiness: string }).readiness, "exited")
        assert.equal(exitedRes.isError, true)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        const uid = typeof process.getuid === "function" ? process.getuid() : 0
        rmSync(`/run/user/${uid}/pi-zellij-${uid}/${sessionId}`, { recursive: true, force: true })
        rmSync(`/tmp/pi-zellij-${uid}/${sessionId}`, { recursive: true, force: true })
    }
})

void test("waitForExit suppresses duplicate followUps, releases on timeout, and preserves log when vanished during wait", async () => {
    let livePanes: Array<Record<string, unknown>> = [
        {
            id: 51,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
        {
            id: 52,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
    ]
    const sessionId = `wait-test-${Date.now()}`
    const { pi, sentMessages } = createMockRuntime((_cmd, args) => {
        if (args.includes("list-clients")) {
            return Promise.resolve({
                stdout: "CLIENT_ID\n1\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-tabs")) {
            return Promise.resolve({
                stdout: JSON.stringify([{ position: 0, name: "tasks", active: false, tab_id: 1 }]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-pane")) {
            const nameArgIdx = args.indexOf("-n")
            const paneId = args[nameArgIdx + 1] === "job-a" ? "terminal_51" : "terminal_52"
            return Promise.resolve({
                stdout: `${paneId}\n`,
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-panes")) {
            return Promise.resolve({
                stdout: JSON.stringify(livePanes),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-wait"
    try {
        const manager = new ZellijSessionManager(pi)
        manager.bindContext(createMockContext(sessionId))
        const watcher = new PaneWatcher(pi, manager)

        const artA = manager.allocateArtifactPaths("job-a")
        writeFileSync(artA.logPath, "job-a log output\n", "utf-8")
        const paneA = await manager.spawnInTopology({
            kind: "task",
            name: "job-a",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: artA.logPath,
            exitMarkerPath: artA.exitMarkerPath,
        })

        // Timeout releases suppression so a subsequent exit emits a followUp.
        const timedOut = await watcher.waitForExit(paneA, 40)
        assert.equal(timedOut.exited, false)
        assert.equal(sentMessages.length, 0)

        livePanes = [
            {
                id: 51,
                is_plugin: false,
                is_floating: false,
                exited: true,
                exit_status: 0,
                tab_id: 1,
                tab_name: "tasks",
            },
            {
                id: 52,
                is_plugin: false,
                is_floating: false,
                exited: false,
                tab_id: 1,
                tab_name: "tasks",
            },
        ]
        await watcher.runSingleSync()
        assert.equal(sentMessages.length, 1)

        // Pane vanished while waitForExit is active: followUp suppressed and log preserved.
        const artB = manager.allocateArtifactPaths("job-b")
        writeFileSync(artB.logPath, "job-b final line\n", "utf-8")
        const paneB = await manager.spawnInTopology({
            kind: "task",
            name: "job-b",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: artB.logPath,
            exitMarkerPath: artB.exitMarkerPath,
        })

        const waitPromise = watcher.waitForExit(paneB, 1000)
        await waitForRegisteredWaiters(watcher, paneB.paneId, 1)
        livePanes = livePanes.filter((p) => p.id !== 52)
        await watcher.runSingleSync()

        const waitRes = await waitPromise
        assert.equal(waitRes.exited, true)
        assert.equal(sentMessages.length, 1)
        assert.ok(
            existsSync(artB.logPath),
            "log file must remain readable after vanish during wait",
        )
        assert.equal(await manager.readPaneOutput(paneB, { maxLines: 10 }), "job-b final line")

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        const uid = typeof process.getuid === "function" ? process.getuid() : 0
        rmSync(`/run/user/${uid}/pi-zellij-${uid}/${sessionId}`, { recursive: true, force: true })
        rmSync(`/tmp/pi-zellij-${uid}/${sessionId}`, { recursive: true, force: true })
    }
})

void test("zellij_subagent rpc checks command_state, verifies ack, and cleans up when not ready", async () => {
    const sessionId = `rpc-test-${Date.now()}`
    let listPaneCalls = 0
    let modePi = true
    let ackResponse = true
    const closedPanes: string[] = []
    let activeLogPath = ""

    const { pi, tools } = createMockRuntime((_cmd, args) => {
        if (args.includes("list-clients")) {
            return Promise.resolve({
                stdout: "CLIENT_ID\n1\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-tabs")) {
            return Promise.resolve({
                stdout: JSON.stringify([{ position: 0, name: "agents", active: false, tab_id: 4 }]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-pane")) {
            const cmdStr = args[args.indexOf("-c") + 1] ?? ""
            const match = cmdStr.match(/tee '([^']+)'/)
            activeLogPath = match?.[1] ?? ""
            return Promise.resolve({
                stdout: "terminal_61\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-panes")) {
            listPaneCalls += 1
            return Promise.resolve({
                stdout: JSON.stringify([
                    {
                        id: 61,
                        is_plugin: false,
                        is_floating: false,
                        exited: false,
                        tab_id: 4,
                        tab_name: "agents",
                        command_state: {
                            phase: "Running",
                            running: {
                                command: {
                                    text:
                                        modePi && listPaneCalls >= 2
                                            ? "pi --mode rpc --no-session"
                                            : "bash",
                                },
                            },
                        },
                    },
                ]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("write-chars") && ackResponse && activeLogPath) {
            writeFileSync(
                activeLogPath,
                `${JSON.stringify({ id: "1", type: "response", command: "prompt", success: true })}\n`,
                "utf-8",
            )
        }
        if (args.includes("close-pane")) {
            closedPanes.push(args[args.indexOf("-p") + 1] ?? "")
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-rpc"
    try {
        const manager = new ZellijSessionManager(pi)
        const ctx = createMockContext(sessionId)
        manager.bindContext(ctx)
        const watcher = new PaneWatcher(pi, manager)
        registerZellijTools(pi, manager, watcher)

        const subTool = tools.get("zellij_subagent")
        assert.ok(subTool)

        // Success path: bash -> pi transition, write-chars, ack confirmed.
        const okRes = await subTool.execute(
            "rpc-ok",
            { name: "worker-ok", mode: "rpc", prompt: "Analyze" },
            undefined,
            undefined,
            ctx as never,
        )
        assert.equal((okRes.structuredContent as { status: string }).status, "rpc_running")
        assert.equal(manager.getPane("sub-worker-ok")?.subagentMode, "rpc")

        // Failure path: command_state never becomes `pi`; must throw and close pane.
        modePi = false
        ackResponse = false
        await assert.rejects(
            () =>
                subTool.execute(
                    "rpc-fail",
                    { name: "worker-fail", mode: "rpc", prompt: "Analyze" },
                    undefined,
                    undefined,
                    ctx as never,
                ),
            /did not become ready/,
        )
        assert.ok(closedPanes.includes("terminal_61"))

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        const uid = typeof process.getuid === "function" ? process.getuid() : 0
        rmSync(`/run/user/${uid}/pi-zellij-${uid}/${sessionId}`, { recursive: true, force: true })
        rmSync(`/tmp/pi-zellij-${uid}/${sessionId}`, { recursive: true, force: true })
    }
})

void test("zellij_pane send/keys clear needsAttention, call mark-pane-seen first, and persist state", async () => {
    const callOrder: string[] = []
    const sessionId = `send-test-${Date.now()}`

    const { pi, tools, entries } = createMockRuntime((_cmd, args) => {
        if (args.includes("list-clients")) {
            return Promise.resolve({
                stdout: "CLIENT_ID\n1\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-tabs")) {
            return Promise.resolve({
                stdout: JSON.stringify([{ position: 0, name: "tasks", active: false, tab_id: 1 }]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-pane")) {
            return Promise.resolve({
                stdout: "terminal_501\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-panes")) {
            return Promise.resolve({
                stdout: JSON.stringify([
                    {
                        id: 501,
                        is_plugin: false,
                        is_floating: false,
                        exited: false,
                        tab_id: 1,
                        tab_name: "tasks",
                    },
                ]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("mark-pane-seen")) callOrder.push("mark-pane-seen")
        if (args.includes("write-chars")) callOrder.push("write-chars")
        if (args.includes("send-keys")) callOrder.push("send-keys")
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-send"
    const manager = new ZellijSessionManager(pi)
    try {
        const ctx = createMockContext(sessionId)
        manager.bindContext(ctx)
        const watcher = new PaneWatcher(pi, manager)
        registerZellijTools(pi, manager, watcher)

        const paneTool = tools.get("zellij_pane")
        assert.ok(paneTool)
        const art = manager.allocateArtifactPaths("interactive")
        writeFileSync(art.logPath, "ready for input\n", "utf-8")
        const pane = await manager.spawnInTopology({
            kind: "task",
            name: "interactive",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: art.logPath,
        })
        pane.needsAttention = true
        pane.lastOutputLine = "Password:"

        await paneTool.execute(
            "send-1",
            { action: "send", pane: "terminal_501", text: "secret" },
            undefined,
            undefined,
            ctx as never,
        )
        assert.deepEqual(callOrder.slice(0, 3), ["mark-pane-seen", "write-chars", "send-keys"])
        assert.equal(pane.needsAttention, false)
        assert.equal(pane.lastOutputLine, "ready for input")
        const latestPersisted = entries.at(-1)?.data as {
            panes: Array<{ needsAttention?: boolean }>
        }
        assert.equal(latestPersisted.panes[0]?.needsAttention, false)

        pane.needsAttention = true
        await paneTool.execute(
            "keys-1",
            { action: "keys", pane: "terminal_501", keys: ["Ctrl c"] },
            undefined,
            undefined,
            ctx as never,
        )
        assert.deepEqual(callOrder.slice(3, 5), ["mark-pane-seen", "send-keys"])
        assert.equal(pane.needsAttention, false)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("zellij_wait selects running task and one-shot agent panes and skips service, repl, and rpc", async () => {
    const sessionId = `wait-select-${Date.now()}`
    const paneIds = new Map([
        ["build-job", "terminal_81"],
        ["sub-one-shot", "terminal_82"],
        ["sub-rpc", "terminal_83"],
        ["api", "terminal_84"],
        ["shell", "terminal_85"],
    ])
    let livePanes: Array<Record<string, unknown>> = [81, 82, 83, 84, 85].map((id) => ({
        id,
        is_plugin: false,
        is_floating: id === 85,
        exited: false,
        tab_id: 1,
        tab_name: "tasks",
    }))
    const { pi, tools } = createMockRuntime((_cmd, args) => {
        if (args.includes("list-clients")) {
            return Promise.resolve({
                stdout: "CLIENT_ID\n1\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-tabs")) {
            return Promise.resolve({
                stdout: JSON.stringify([
                    { position: 0, name: "tasks", active: true, tab_id: 1 },
                    { position: 1, name: "services", active: false, tab_id: 2 },
                    { position: 2, name: "agents", active: false, tab_id: 3 },
                ]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-pane")) {
            const name = args[args.indexOf("-n") + 1] ?? ""
            return Promise.resolve({
                stdout: `${paneIds.get(name) ?? "terminal_99"}\n`,
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-panes")) {
            return Promise.resolve({
                stdout: JSON.stringify(livePanes),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-select"
    const manager = new ZellijSessionManager(pi)
    try {
        const ctx = createMockContext(sessionId)
        manager.bindContext(ctx)
        const watcher = new PaneWatcher(pi, manager)
        registerZellijTools(pi, manager, watcher)

        const taskArt = manager.allocateArtifactPaths("build-job")
        writeFileSync(taskArt.logPath, "build-job finished\n", "utf-8")
        await manager.spawnInTopology({
            kind: "task",
            name: "build-job",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: taskArt.logPath,
            exitMarkerPath: taskArt.exitMarkerPath,
        })

        const agentArt = manager.allocateArtifactPaths("sub-one-shot")
        writeFileSync(agentArt.logPath, "one-shot answer\n", "utf-8")
        await manager.spawnInTopology({
            kind: "agent",
            name: "sub-one-shot",
            command: ["pi", "-p"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: agentArt.logPath,
            exitMarkerPath: agentArt.exitMarkerPath,
            subagentMode: "one-shot",
        })

        await manager.spawnInTopology({
            kind: "agent",
            name: "sub-rpc",
            command: ["pi", "--mode", "rpc"],
            cwd: "/tmp",
            layout: "stacked",
            subagentMode: "rpc",
        })
        await manager.spawnInTopology({
            kind: "service",
            name: "api",
            command: ["node", "server.js"],
            cwd: "/tmp",
            layout: "stacked",
        })
        await manager.spawnInTopology({
            kind: "repl",
            name: "shell",
            command: ["bash"],
            cwd: "/tmp",
            layout: "floating",
        })

        const waitTool = tools.get("zellij_wait")
        assert.ok(waitTool)
        const updates: string[] = []

        const res = await waitTool.execute(
            "wait-default",
            {},
            undefined,
            (update: { content: Array<{ type: string; text?: string }> }) => {
                const text = update.content.find((item) => item.type === "text")?.text
                if (!text) return
                updates.push(text)
                livePanes = livePanes.map((pane) =>
                    pane.id === 81 || pane.id === 82
                        ? { ...pane, exited: true, exit_status: 0 }
                        : pane,
                )
            },
            ctx as never,
        )

        const sc = res.structuredContent as {
            status: string
            panes: Array<{ name: string; status: string; output: string }>
        }
        assert.equal(sc.status, "completed")
        assert.deepEqual(
            sc.panes.map((pane) => pane.name),
            ["build-job", "sub-one-shot"],
        )
        assert.ok(
            updates.some((text) => text.includes("Waiting for 2 pane(s)")),
            `onUpdate must describe the waiting panes, got: ${updates.join(" | ")}`,
        )

        const emptyRes = await waitTool.execute(
            "wait-empty",
            {},
            undefined,
            undefined,
            ctx as never,
        )
        assert.equal((emptyRes.structuredContent as { status: string }).status, "no_running_panes")

        await assert.rejects(
            () =>
                waitTool.execute(
                    "wait-missing",
                    { panes: ["missing-pane"] },
                    undefined,
                    undefined,
                    ctx as never,
                ),
            /No tracked pane matches "missing-pane"/,
        )

        const exitedRes = await waitTool.execute(
            "wait-exited",
            { panes: ["build-job"] },
            undefined,
            undefined,
            ctx as never,
        )
        const exitedSc = exitedRes.structuredContent as {
            status: string
            panes: Array<{ name: string; status: string; output: string }>
        }
        assert.equal(exitedSc.status, "completed")
        assert.equal(exitedSc.panes[0]?.status, "exited")
        assert.match(exitedSc.panes[0]?.output ?? "", /build-job finished/)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("zellij_wait returns a screen-only prompt without a pre-sync followUp", async () => {
    const sessionId = `wait-prompt-${Date.now()}`
    const livePanes: Array<Record<string, unknown>> = [
        {
            id: 98,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
            attention: { status: "NeedsYou", changed_ms: 1 },
        },
    ]
    const { pi, tools, sentMessages } = createMockRuntime((_cmd, args) => {
        if (args.includes("list-clients")) {
            return Promise.resolve({
                stdout: "CLIENT_ID\n1\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-tabs")) {
            return Promise.resolve({
                stdout: JSON.stringify([{ position: 0, name: "tasks", active: false, tab_id: 1 }]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-pane")) {
            return Promise.resolve({
                stdout: "terminal_98\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("dump-screen")) {
            return Promise.resolve({
                stdout: "Proceed anyway? [y/N]",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-panes")) {
            return Promise.resolve({
                stdout: JSON.stringify(livePanes),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-prompt"
    const manager = new ZellijSessionManager(pi)
    try {
        const ctx = createMockContext(sessionId)
        manager.bindContext(ctx)
        const watcher = new PaneWatcher(pi, manager)
        registerZellijTools(pi, manager, watcher)

        const art = manager.allocateArtifactPaths("job-prompt")
        writeFileSync(art.logPath, "building...\n", "utf-8")
        const pane = await manager.spawnInTopology({
            kind: "task",
            name: "job-prompt",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: art.logPath,
            exitMarkerPath: art.exitMarkerPath,
        })

        const waitTool = tools.get("zellij_wait")
        assert.ok(waitTool)
        const res = await waitTool.execute(
            "wait-prompt",
            { panes: [pane.paneId] },
            undefined,
            undefined,
            ctx as never,
        )
        const sc = res.structuredContent as {
            status: string
            panes: Array<{ needsAttention: boolean; output: string }>
        }
        assert.equal(sc.status, "needs_attention")
        assert.equal(sc.panes[0]?.needsAttention, true)
        assert.match(sc.panes[0]?.output ?? "", /Proceed anyway/)
        assert.equal(sentMessages.length, 0)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("zellij_wait returns a reaped pane's retained log", async () => {
    const sessionId = `wait-reaped-${Date.now()}`
    const { pi, tools } = createMockRuntime((_cmd, args) => {
        if (args.includes("list-clients")) {
            return Promise.resolve({
                stdout: "CLIENT_ID\n1\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-tabs")) {
            return Promise.resolve({
                stdout: JSON.stringify([{ position: 0, name: "tasks", active: false, tab_id: 1 }]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-pane")) {
            return Promise.resolve({
                stdout: "terminal_99\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-reaped"
    const manager = new ZellijSessionManager(pi)
    try {
        const ctx = createMockContext(sessionId)
        manager.bindContext(ctx)
        const watcher = new PaneWatcher(pi, manager)
        registerZellijTools(pi, manager, watcher)

        const art = manager.allocateArtifactPaths("job-reaped")
        writeFileSync(art.logPath, "reaped log output\n", "utf-8")
        const pane = await manager.spawnInTopology({
            kind: "task",
            name: "job-reaped",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: art.logPath,
            exitMarkerPath: art.exitMarkerPath,
        })
        pane.status = "exited"
        pane.exitCode = 0
        pane.notifiedCompletion = true
        pane.endedAt = Date.now()

        await manager.reapCompletedPanes()
        assert.equal(manager.getPane("job-reaped"), undefined)
        assert.equal(manager.getRecentlyFinishedPane("job-reaped")?.paneId, pane.paneId)

        const waitTool = tools.get("zellij_wait")
        assert.ok(waitTool)
        const res = await waitTool.execute(
            "wait-reaped",
            { panes: ["job-reaped"] },
            undefined,
            undefined,
            ctx as never,
        )
        const sc = res.structuredContent as {
            status: string
            panes: Array<{ status: string; output: string }>
        }
        assert.equal(sc.status, "completed")
        assert.equal(sc.panes[0]?.status, "exited")
        assert.match(sc.panes[0]?.output ?? "", /reaped log output/)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("zellij_wait upgrades completed to needs_attention when another target prompts", async () => {
    const sessionId = `wait-race-${Date.now()}`
    let livePanes: Array<Record<string, unknown>> = [
        {
            id: 100,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
        {
            id: 101,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
    ]
    const { pi, tools, sentMessages } = createMockRuntime((_cmd, args) => {
        if (args.includes("list-clients")) {
            return Promise.resolve({
                stdout: "CLIENT_ID\n1\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-tabs")) {
            return Promise.resolve({
                stdout: JSON.stringify([{ position: 0, name: "tasks", active: false, tab_id: 1 }]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-pane")) {
            const name = args[args.indexOf("-n") + 1] ?? ""
            return Promise.resolve({
                stdout: `${name === "job-race-exit" ? "terminal_100" : "terminal_101"}\n`,
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("dump-screen")) {
            return Promise.resolve({
                stdout: "Continue? (y/n)",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-panes")) {
            return Promise.resolve({
                stdout: JSON.stringify(livePanes),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-race"
    const manager = new ZellijSessionManager(pi)
    try {
        const ctx = createMockContext(sessionId)
        manager.bindContext(ctx)
        const watcher = new PaneWatcher(pi, manager)
        registerZellijTools(pi, manager, watcher)

        const exitArt = manager.allocateArtifactPaths("job-race-exit")
        writeFileSync(exitArt.logPath, "exit log\n", "utf-8")
        const exitPane = await manager.spawnInTopology({
            kind: "task",
            name: "job-race-exit",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: exitArt.logPath,
            exitMarkerPath: exitArt.exitMarkerPath,
        })
        const promptArt = manager.allocateArtifactPaths("job-race-prompt")
        writeFileSync(promptArt.logPath, "prompt log\n", "utf-8")
        const promptPane = await manager.spawnInTopology({
            kind: "task",
            name: "job-race-prompt",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: promptArt.logPath,
            exitMarkerPath: promptArt.exitMarkerPath,
        })

        const waitTool = tools.get("zellij_wait")
        assert.ok(waitTool)
        const res = await waitTool.execute(
            "wait-race",
            { panes: [exitPane.paneId, promptPane.paneId], mode: "any" },
            undefined,
            () => {
                livePanes = [
                    { ...livePanes[0], exited: true, exit_status: 0 },
                    {
                        ...livePanes[1],
                        exited: false,
                        attention: { status: "NeedsYou", changed_ms: 4 },
                    },
                ]
            },
            ctx as never,
        )
        const sc = res.structuredContent as {
            status: string
            panes: Array<{ needsAttention: boolean; output: string }>
        }
        assert.equal(sc.status, "needs_attention")
        assert.equal(sc.panes[1]?.needsAttention, true)
        assert.match(sc.panes[1]?.output ?? "", /Continue\?/)
        assert.equal(sentMessages.length, 0)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})
