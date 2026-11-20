import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { ZellijSessionManager } from "../src/session.ts"
import { PaneWatcher } from "../src/watcher.ts"
import { createMockContext, createMockRuntime, waitForRegisteredWaiters } from "./helpers.ts"

void test("runSingleSync recovers exit code from marker, keeps service 0 as exited, and mutes repl", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zj-sync-"))
    const logPath = join(dir, "job.log")
    const markerPath = join(dir, "job.exit")
    writeFileSync(logPath, "\x1b[32mdone\x1b[0m line\n", "utf-8")
    writeFileSync(markerPath, "0\n", "utf-8")

    let panesPayload: unknown[] = []
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
                stdout: JSON.stringify([
                    { position: 0, name: "tasks", active: true, tab_id: 1 },
                    { position: 1, name: "services", active: false, tab_id: 2 },
                ]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-pane")) {
            const nameIdx = args.indexOf("-n")
            const name = nameIdx !== -1 ? args[nameIdx + 1] : ""
            const out =
                name === "myrepl"
                    ? "terminal_20\n"
                    : name === "svc-ok"
                      ? "terminal_30\n"
                      : "terminal_10\n"
            return Promise.resolve({
                stdout: out,
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-panes")) {
            return Promise.resolve({
                stdout: JSON.stringify(panesPayload),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-sync"
    try {
        const manager = new ZellijSessionManager(pi)
        manager.bindContext(createMockContext(`sync-${Date.now()}`))
        const watcher = new PaneWatcher(pi, manager)

        const taskPane = await manager.spawnInTopology({
            kind: "task",
            name: "task-a",
            command: ["echo"],
            cwd: "/tmp",
            layout: "stacked",
            logPath,
            exitMarkerPath: markerPath,
        })
        assert.equal(await manager.readPaneOutput(taskPane, { ansi: false }), "done line")
        assert.equal(
            await manager.readPaneOutput(taskPane, { ansi: true }),
            "\x1b[32mdone\x1b[0m line",
        )

        await manager.spawnInTopology({
            kind: "service",
            name: "svc-ok",
            command: ["true"],
            cwd: "/tmp",
            layout: "stacked",
        })
        await manager.spawnInTopology({
            kind: "repl",
            name: "myrepl",
            command: ["bash"],
            cwd: "/tmp",
            layout: "floating",
        })

        // task-a and myrepl vanish (`!live`), svc-ok exits cleanly with 0.
        panesPayload = [
            {
                id: 30,
                is_plugin: false,
                is_floating: false,
                exited: true,
                exit_status: 0,
                tab_id: 1,
                tab_name: "tasks",
            },
        ]
        await watcher.runSingleSync()
        assert.equal(sentMessages.length, 2)
        const taskDetails = sentMessages[0]?.details as {
            name: string
            eventType: string
            exitCode: number | null
        }
        const svcDetails = sentMessages[1]?.details as {
            name: string
            eventType: string
            exitCode: number | null
        }
        assert.equal(taskDetails.name, "task-a")
        assert.equal(taskDetails.eventType, "exited")
        assert.equal(taskDetails.exitCode, 0)
        assert.equal(svcDetails.name, "svc-ok")
        assert.equal(svcDetails.eventType, "exited")
        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        rmSync(dir, { recursive: true, force: true })
    }
})

void test("watcher checkNeedsAttention handles NeedsYou/Quiet and notifies on 3-failure session loss", async () => {
    let dumpCalls = 0
    let screenText = "Compiling crates..."
    let attention: { status: string; changed_ms: number } = { status: "NeedsYou", changed_ms: 1 }
    let failListPanes = false
    let activeSessions = ["mock-att"]
    const sessionId = `att-test-${Date.now()}`

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
            return Promise.resolve({
                stdout: "terminal_81\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("dump-screen")) {
            dumpCalls += 1
            return Promise.resolve({
                stdout: screenText,
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-sessions")) {
            return Promise.resolve({
                stdout: activeSessions.map((s) => `${s} [Created 1m ago]`).join("\n"),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-panes")) {
            if (failListPanes) {
                return Promise.resolve({
                    stdout: "",
                    stderr: "session not found",
                    code: 1,
                    killed: false,
                    truncated: false,
                })
            }
            return Promise.resolve({
                stdout: JSON.stringify([
                    {
                        id: 81,
                        is_plugin: false,
                        is_floating: false,
                        exited: false,
                        tab_id: 1,
                        tab_name: "tasks",
                        attention,
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
    process.env.ZELLIJ_SESSION_NAME = "mock-att"
    try {
        const manager = new ZellijSessionManager(pi)
        manager.bindContext(createMockContext(sessionId))
        const watcher = new PaneWatcher(pi, manager)

        const art = manager.allocateArtifactPaths("att-job")
        writeFileSync(art.logPath, "step 1\n", "utf-8")
        await manager.spawnInTopology({
            kind: "task",
            name: "att-job",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: art.logPath,
            exitMarkerPath: art.exitMarkerPath,
        })

        // NeedsYou emits once; identical signature on next sync is deduplicated.
        await watcher.runSingleSync()
        assert.equal(sentMessages.length, 1)
        assert.equal(
            (sentMessages[0]?.details as { eventType: string }).eventType,
            "needs_attention",
        )
        await watcher.runSingleSync()
        assert.equal(dumpCalls, 1)

        // Quiet without prompt inspects once, caches negative result.
        attention = { status: "Quiet", changed_ms: 2 }
        await watcher.runSingleSync()
        assert.equal(dumpCalls, 2)
        assert.equal(sentMessages.length, 1)
        await watcher.runSingleSync()
        assert.equal(dumpCalls, 2)

        // Quiet with prompt signature emits followUp.
        attention = { status: "Quiet", changed_ms: 3 }
        screenText = "Proceed anyway? [y/N]"
        await watcher.runSingleSync()
        assert.equal(sentMessages.length, 2)

        // 3 consecutive `list-panes` failures + missing session => `disappeared` followUp + cleanup.
        failListPanes = true
        activeSessions = []
        await watcher.runSingleSync()
        await watcher.runSingleSync()
        assert.equal(manager.getTrackedPanes().length, 1)
        await watcher.runSingleSync()
        assert.equal(sentMessages.length, 3)
        assert.equal((sentMessages[2]?.details as { eventType: string }).eventType, "disappeared")
        assert.equal(manager.getTrackedPanes().length, 0)
        assert.ok(existsSync(art.logPath))

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        const uid = typeof process.getuid === "function" ? process.getuid() : 0
        rmSync(`/run/user/${uid}/pi-zellij-${uid}/${sessionId}`, { recursive: true, force: true })
        rmSync(`/tmp/pi-zellij-${uid}/${sessionId}`, { recursive: true, force: true })
    }
})

void test("reapCompletedPanes closes every notified exited pane regardless of kind or exit code and keeps logs", async () => {
    const closedPanes: string[] = []
    const markedSeen: string[] = []
    const sessionId = `reap-test-${Date.now()}`
    let nextPaneNum = 100

    const { pi } = createMockRuntime((_cmd, args) => {
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
                    { position: 0, name: "tasks", active: false, tab_id: 1 },
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
            nextPaneNum += 1
            return Promise.resolve({
                stdout: `terminal_${nextPaneNum}\n`,
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("mark-pane-seen")) {
            markedSeen.push(args[args.indexOf("-p") + 1] ?? "")
        }
        if (args.includes("close-pane")) {
            closedPanes.push(args[args.indexOf("-p") + 1] ?? "")
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    const prevPaneId = process.env.ZELLIJ_PANE_ID
    process.env.ZELLIJ_SESSION_NAME = "mock-reap"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(createMockContext(sessionId))

        const taskOkArt = manager.allocateArtifactPaths("task-ok")
        writeFileSync(taskOkArt.logPath, "ok log\n", "utf-8")
        const taskOk = await manager.spawnInTopology({
            kind: "task",
            name: "task-ok",
            command: ["echo"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: taskOkArt.logPath,
        })

        const agentFailedArt = manager.allocateArtifactPaths("agent-failed")
        writeFileSync(agentFailedArt.logPath, "agent failure log\n", "utf-8")
        const agentFailed = await manager.spawnInTopology({
            kind: "agent",
            name: "agent-failed",
            command: ["pi"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: agentFailedArt.logPath,
        })

        const unnotified = await manager.spawnInTopology({
            kind: "task",
            name: "task-unnotified",
            command: ["echo"],
            cwd: "/tmp",
            layout: "stacked",
        })

        const svcExited = await manager.spawnInTopology({
            kind: "service",
            name: "svc-exited",
            command: ["true"],
            cwd: "/tmp",
            layout: "stacked",
        })

        const replExited = await manager.spawnInTopology({
            kind: "repl",
            name: "repl-sigint",
            command: ["bash"],
            cwd: "/tmp",
            layout: "floating",
        })

        const fail1Art = manager.allocateArtifactPaths("fail-1")
        writeFileSync(fail1Art.logPath, "fail log\n", "utf-8")
        const fail1 = await manager.spawnInTopology({
            kind: "task",
            name: "fail-1",
            command: ["false"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: fail1Art.logPath,
        })

        const fail2 = await manager.spawnInTopology({
            kind: "task",
            name: "fail-2",
            command: ["false"],
            cwd: "/tmp",
            layout: "stacked",
        })

        const fail3 = await manager.spawnInTopology({
            kind: "task",
            name: "fail-3",
            command: ["false"],
            cwd: "/tmp",
            layout: "stacked",
        })

        taskOk.status = "exited"
        taskOk.exitCode = 0
        taskOk.notifiedCompletion = true
        taskOk.endedAt = 10

        agentFailed.status = "exited"
        agentFailed.exitCode = 1
        agentFailed.notifiedCompletion = true
        agentFailed.endedAt = 20

        unnotified.status = "exited"
        unnotified.exitCode = 0
        unnotified.notifiedCompletion = false
        unnotified.endedAt = 30

        svcExited.status = "exited"
        svcExited.exitCode = 1
        svcExited.notifiedCompletion = true
        svcExited.endedAt = 40

        replExited.status = "exited"
        replExited.exitCode = 130
        replExited.notifiedCompletion = true
        replExited.endedAt = 45

        fail1.status = "exited"
        fail1.exitCode = 1
        fail1.notifiedCompletion = true
        fail1.endedAt = 50

        fail2.status = "exited"
        fail2.exitCode = 1
        fail2.notifiedCompletion = true
        fail2.endedAt = 60

        fail3.status = "exited"
        fail3.exitCode = 1
        fail3.notifiedCompletion = true
        fail3.endedAt = 70

        const reaped = await manager.reapCompletedPanes()
        assert.deepEqual(
            reaped.map((p) => p.name),
            ["task-ok", "agent-failed", "svc-exited", "repl-sigint", "fail-1", "fail-2", "fail-3"],
        )
        assert.ok(existsSync(taskOkArt.logPath), "task-ok log must stay on disk after reap")
        assert.ok(
            existsSync(agentFailedArt.logPath),
            "agent-failed log must stay on disk after reap",
        )
        assert.ok(existsSync(fail1Art.logPath), "fail-1 log must stay on disk after reap")
        assert.ok(closedPanes.includes(taskOk.paneId))
        assert.ok(closedPanes.includes(agentFailed.paneId))
        assert.ok(closedPanes.includes(svcExited.paneId))
        assert.ok(closedPanes.includes(replExited.paneId))
        assert.ok(closedPanes.includes(fail1.paneId))
        assert.equal(markedSeen.filter((id) => id === taskOk.paneId).length, 1)
        assert.equal(markedSeen.filter((id) => id === agentFailed.paneId).length, 1)
        assert.equal(manager.getRecentlyFinishedPane("agent-failed")?.exitCode, 1)
        assert.equal(manager.getRecentlyFinishedPane("svc-exited")?.kind, "service")
        assert.equal(manager.getRecentlyFinishedPane("fail-1")?.exitCode, 1)

        const remainingIds = manager.getTrackedPanes().map((p) => p.name)
        assert.deepEqual(remainingIds, ["task-unnotified"])
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        if (prevPaneId !== undefined) process.env.ZELLIJ_PANE_ID = prevPaneId
        else delete process.env.ZELLIJ_PANE_ID
        manager.cleanupRuntimeDir()
    }
})

void test("refreshUI renders pure ASCII live tail rows and hides when only exit-0 panes remain", async () => {
    const sessionId = `ui-test-${Date.now()}`
    const statuses: Array<string | undefined> = []
    const widgets: Array<string[] | undefined> = []

    const { pi } = createMockRuntime((_cmd, args) => {
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
                stdout: name === "job-err" ? "terminal_302\n" : "terminal_301\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const ctx = {
        cwd: "/tmp",
        hasUI: true,
        mode: "rpc",
        sessionManager: {
            getSessionId: () => sessionId,
            getBranch: () => [],
        },
        ui: {
            setStatus: (_key: string, text: string | undefined) => {
                statuses.push(text)
            },
            setWidget: (_key: string, content: string[] | undefined) => {
                widgets.push(content)
            },
        },
    } as unknown as ExtensionContext

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-ui"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(ctx)
        const watcher = new PaneWatcher(pi, manager)

        const art1 = manager.allocateArtifactPaths("job-run")
        writeFileSync(art1.logPath, "\x1b[32mline one\x1b[0m\nrunning step 3/10\n", "utf-8")
        const p1 = await manager.spawnInTopology({
            kind: "task",
            name: "job-run",
            command: ["cargo", "test"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: art1.logPath,
        })
        p1.needsAttention = true

        const art2 = manager.allocateArtifactPaths("job-err")
        writeFileSync(art2.logPath, "fatal: build failed\n", "utf-8")
        const p2 = await manager.spawnInTopology({
            kind: "task",
            name: "job-err",
            command: ["cargo", "build"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: art2.logPath,
        })
        p2.status = "exited"
        p2.exitCode = 1

        watcher.refreshUI()
        const latestRows = widgets.at(-1)
        assert.ok(latestRows && latestRows.length === 2)
        assert.match(latestRows[0] ?? "", /^\[input \d+s\] task:job-run \| running step 3\/10$/)
        assert.match(latestRows[1] ?? "", /^\[err:1 \d+s\] task:job-err \| fatal: build failed$/)
        for (const row of latestRows) {
            for (const ch of row) {
                assert.ok((ch.codePointAt(0) ?? 0) <= 0x7f, `Non-ASCII char in widget row: ${row}`)
            }
        }
        assert.match(statuses.at(-1) ?? "", /input:1.*err:1/)

        // Mark both as exited 0 -> widget hides (`undefined`) while footer still shows summary.
        p1.status = "exited"
        p1.exitCode = 0
        p1.needsAttention = false
        p2.exitCode = 0
        watcher.refreshUI()
        assert.equal(widgets.at(-1), undefined)
        assert.match(statuses.at(-1) ?? "", /done:2/)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("TUI widget renders pure ASCII across narrow widths, ANSI theme, live output, overflow, and ignores exited repl errors", async () => {
    const sessionId = `tui-test-${Date.now()}`
    const statuses: Array<string | undefined> = []
    type WidgetFactory = (
        tui: unknown,
        theme: { fg: (c: string, t: string) => string; bold: (t: string) => string },
    ) => { render: (width: number) => string[] }
    const widgetFactories: Array<WidgetFactory | undefined> = []
    let nextId = 400

    const { pi } = createMockRuntime((_cmd, args) => {
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
                    { position: 0, name: "tasks\t中文", active: true, tab_id: 1 },
                ]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-pane")) {
            nextId += 1
            return Promise.resolve({
                stdout: `terminal_${nextId}\n`,
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const ctx = {
        cwd: "/tmp",
        hasUI: true,
        mode: "tui",
        sessionManager: {
            getSessionId: () => sessionId,
            getBranch: () => [],
        },
        ui: {
            setStatus: (_key: string, text: string | undefined) => {
                statuses.push(text)
            },
            setWidget: (_key: string, factory: WidgetFactory | undefined) => {
                widgetFactories.push(factory)
            },
        },
    } as unknown as ExtensionContext

    // eslint-disable-next-line no-control-regex
    const stripSgr = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, "")
    const mockTheme = {
        fg: (_c: string, t: string) => `\x1B[36m${t}\x1B[39m`,
        bold: (t: string) => `\x1B[1m${t}\x1B[22m`,
    }

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-tui"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(ctx)
        const watcher = new PaneWatcher(pi, manager)

        for (let i = 1; i <= 6; i += 1) {
            const art = manager.allocateArtifactPaths(`job-${i}`)
            if (i === 1) {
                writeFileSync(art.logPath, "building step 12 of 40 with long detail\n", "utf-8")
            }
            await manager.spawnInTopology({
                kind: "task",
                name: `job-${i}`,
                command: ["sleep", "10"],
                cwd: "/tmp",
                layout: "split",
                logPath: i === 1 ? art.logPath : undefined,
            })
        }
        const badRepl = await manager.spawnInTopology({
            kind: "repl",
            name: "shell",
            command: ["bash"],
            cwd: "/tmp",
            layout: "floating",
        })
        badRepl.status = "exited"
        badRepl.exitCode = 130

        watcher.refreshUI()
        const factory = widgetFactories.at(-1)
        assert.ok(factory)
        const comp = factory(null, mockTheme)

        const wideLines = comp.render(100)
        assert.equal(wideLines.length, 5)
        assert.match(stripSgr(wideLines[0] ?? ""), / \| building step 12 of 40 with long detail$/)
        assert.equal(stripSgr(wideLines[4] ?? ""), "+2 more; run /zellij")
        for (const line of wideLines) {
            const plain = stripSgr(line)
            assert.ok(plain.length <= 100)
            for (const ch of plain) {
                assert.ok((ch.codePointAt(0) ?? 0) <= 0x7e && (ch.codePointAt(0) ?? 0) >= 0x20)
            }
        }
        assert.ok(!statuses.at(-1)?.includes("err:"))

        for (const w of [25, 12, 3, 0]) {
            const lines = comp.render(w)
            assert.equal(lines.length, 5)
            for (const line of lines) {
                const plain = stripSgr(line)
                assert.ok(plain.length <= w, `width ${w} exceeded by "${plain}"`)
            }
        }

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("waitForPanes mode all waits for every target and suppresses duplicate followUps", async () => {
    const sessionId = `wait-all-${Date.now()}`
    let livePanes: Array<Record<string, unknown>> = [
        {
            id: 71,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
        {
            id: 72,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
    ]
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
            const name = args[args.indexOf("-n") + 1] ?? ""
            return Promise.resolve({
                stdout: `${name === "job-all-a" ? "terminal_71" : "terminal_72"}\n`,
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
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-all"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(createMockContext(sessionId))
        const watcher = new PaneWatcher(pi, manager)

        const artA = manager.allocateArtifactPaths("job-all-a")
        writeFileSync(artA.logPath, "job a done\n", "utf-8")
        const paneA = await manager.spawnInTopology({
            kind: "task",
            name: "job-all-a",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: artA.logPath,
            exitMarkerPath: artA.exitMarkerPath,
        })

        const artB = manager.allocateArtifactPaths("job-all-b")
        writeFileSync(artB.logPath, "job b still running\n", "utf-8")
        const paneB = await manager.spawnInTopology({
            kind: "task",
            name: "job-all-b",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: artB.logPath,
            exitMarkerPath: artB.exitMarkerPath,
        })

        const waitPromise = watcher.waitForPanes([paneA, paneB], {
            mode: "all",
            timeoutMs: 2000,
        })
        const settledState = { done: false }
        void waitPromise.then(() => {
            settledState.done = true
        })
        await waitForRegisteredWaiters(watcher, paneA.paneId, 1)
        await waitForRegisteredWaiters(watcher, paneB.paneId, 1)

        livePanes = livePanes.map((pane) =>
            pane.id === 71
                ? { ...pane, exited: true, exit_status: 0 }
                : { ...pane, exited: false, exit_status: null },
        )
        await watcher.runSingleSync()
        assert.equal(settledState.done, false)
        assert.equal(sentMessages.length, 0)

        livePanes = livePanes.map((pane) => ({
            ...pane,
            exited: true,
            exit_status: pane.id === 72 ? 1 : 0,
        }))
        await watcher.runSingleSync()

        const res = await waitPromise
        assert.equal(res.status, "completed")
        assert.deepEqual(
            res.panes.map((pane) => pane.status),
            ["exited", "exited"],
        )
        assert.equal(paneA.notifiedCompletion, true)
        assert.equal(paneB.notifiedCompletion, true)
        assert.equal(sentMessages.length, 0)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("waitForPanes mode any returns after one target and restores followUp for the rest", async () => {
    const sessionId = `wait-any-${Date.now()}`
    let livePanes: Array<Record<string, unknown>> = [
        {
            id: 73,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
        {
            id: 74,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
    ]
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
            const name = args[args.indexOf("-n") + 1] ?? ""
            return Promise.resolve({
                stdout: `${name === "job-any-a" ? "terminal_73" : "terminal_74"}\n`,
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
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-any"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(createMockContext(sessionId))
        const watcher = new PaneWatcher(pi, manager)

        const paneA = await manager.spawnInTopology({
            kind: "task",
            name: "job-any-a",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })
        const paneB = await manager.spawnInTopology({
            kind: "task",
            name: "job-any-b",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })

        const waitPromise = watcher.waitForPanes([paneA, paneB], {
            mode: "any",
            timeoutMs: 2000,
        })
        await waitForRegisteredWaiters(watcher, paneA.paneId, 1)
        await waitForRegisteredWaiters(watcher, paneB.paneId, 1)
        livePanes = livePanes.map((pane) =>
            pane.id === 73
                ? { ...pane, exited: true, exit_status: 0 }
                : { ...pane, exited: false, exit_status: null },
        )
        await watcher.runSingleSync()

        const res = await waitPromise
        assert.equal(res.status, "completed")
        assert.equal(paneA.status, "exited")
        assert.equal(paneA.notifiedCompletion, true)
        assert.equal(paneB.status, "running")
        assert.equal(sentMessages.length, 0)

        // The remaining pane was released from wait suppression, so its exit still notifies.
        livePanes = livePanes.map((pane) => ({ ...pane, exited: true, exit_status: 0 }))
        await watcher.runSingleSync()
        assert.equal(sentMessages.length, 1)
        assert.equal((sentMessages[0]?.details as { paneId: string }).paneId, paneB.paneId)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("waitForPanes mode all returns needs_attention early without duplicate followUp", async () => {
    const sessionId = `wait-att-${Date.now()}`
    const livePanes: Array<Record<string, unknown>> = [
        {
            id: 75,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
            attention: { status: "NeedsYou", changed_ms: 1 },
        },
        {
            id: 76,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
    ]
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
            const name = args[args.indexOf("-n") + 1] ?? ""
            return Promise.resolve({
                stdout: `${name === "job-att-a" ? "terminal_75" : "terminal_76"}\n`,
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
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-att"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(createMockContext(sessionId))
        const watcher = new PaneWatcher(pi, manager)

        const paneA = await manager.spawnInTopology({
            kind: "task",
            name: "job-att-a",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })
        const paneB = await manager.spawnInTopology({
            kind: "task",
            name: "job-att-b",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })

        const res = await watcher.waitForPanes([paneA, paneB], {
            mode: "all",
            timeoutMs: 2000,
        })
        assert.equal(res.status, "needs_attention")
        assert.equal(paneA.needsAttention, true)
        assert.equal(paneB.status, "running")
        assert.equal(sentMessages.length, 0)

        await watcher.runSingleSync()
        assert.equal(sentMessages.length, 0)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("waitForPanes timeout and abort release suppression for still-running panes", async () => {
    const sessionId = `wait-release-${Date.now()}`
    let livePanes: Array<Record<string, unknown>> = [
        {
            id: 77,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
        {
            id: 78,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
    ]
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
            const name = args[args.indexOf("-n") + 1] ?? ""
            return Promise.resolve({
                stdout: `${name === "job-timeout" ? "terminal_77" : "terminal_78"}\n`,
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
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-release"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(createMockContext(sessionId))
        const watcher = new PaneWatcher(pi, manager)

        const timeoutPane = await manager.spawnInTopology({
            kind: "task",
            name: "job-timeout",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })
        const abortPane = await manager.spawnInTopology({
            kind: "task",
            name: "job-abort",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })

        const timedOut = await watcher.waitForPanes([timeoutPane], {
            mode: "all",
            timeoutMs: 40,
        })
        assert.equal(timedOut.status, "timeout")
        livePanes = livePanes.map((pane) =>
            pane.id === 77 ? { ...pane, exited: true, exit_status: 0 } : pane,
        )
        await watcher.runSingleSync()
        assert.equal(sentMessages.length, 1)
        assert.equal((sentMessages[0]?.details as { paneId: string }).paneId, timeoutPane.paneId)

        const controller = new AbortController()
        const abortPromise = watcher.waitForPanes([abortPane], {
            mode: "all",
            timeoutMs: 2000,
            signal: controller.signal,
        })
        await waitForRegisteredWaiters(watcher, abortPane.paneId, 1)
        controller.abort()
        const aborted = await abortPromise
        assert.equal(aborted.status, "aborted")
        assert.equal(abortPane.status, "running")

        livePanes = livePanes.map((pane) =>
            pane.id === 78 ? { ...pane, exited: true, exit_status: 1 } : pane,
        )
        await watcher.runSingleSync()
        assert.equal(sentMessages.length, 2)
        assert.equal((sentMessages[1]?.details as { paneId: string }).paneId, abortPane.paneId)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("waitForExit keeps its exit waiter when a prompt is detected during the window", async () => {
    const sessionId = `wait-exit-att-${Date.now()}`
    let livePanes: Array<Record<string, unknown>> = [
        {
            id: 91,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
    ]
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
            return Promise.resolve({
                stdout: "terminal_91\n",
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
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-exit-att"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(createMockContext(sessionId))
        const watcher = new PaneWatcher(pi, manager)
        const pane = await manager.spawnInTopology({
            kind: "task",
            name: "job-exit-att",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })

        const waitPromise = watcher.waitForExit(pane, 1000)
        await waitForRegisteredWaiters(watcher, pane.paneId, 1)

        livePanes = [
            {
                ...livePanes[0],
                exited: false,
                attention: { status: "NeedsYou", changed_ms: 1 },
            },
        ]
        await watcher.runSingleSync()
        assert.equal(pane.needsAttention, true)
        assert.equal(sentMessages.length, 0)

        livePanes = [{ ...livePanes[0], exited: true, exit_status: 0 }]
        await watcher.runSingleSync()

        let guardTimer: ReturnType<typeof setTimeout> | undefined
        const outcome = await Promise.race([
            waitPromise,
            new Promise<"guard">((resolve) => {
                guardTimer = setTimeout(() => resolve("guard"), 300)
            }),
        ])
        if (guardTimer) clearTimeout(guardTimer)
        assert.notEqual(outcome, "guard")
        assert.equal((outcome as { exited: boolean }).exited, true)
        assert.equal(sentMessages.length, 0)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("concurrent waitForPanes calls keep suppression until the last waiter releases", async () => {
    const sessionId = `wait-concurrent-${Date.now()}`
    let livePanes: Array<Record<string, unknown>> = [
        {
            id: 92,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
    ]
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
            return Promise.resolve({
                stdout: "terminal_92\n",
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
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-concurrent"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(createMockContext(sessionId))
        const watcher = new PaneWatcher(pi, manager)
        const pane = await manager.spawnInTopology({
            kind: "task",
            name: "job-concurrent",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })

        const shortWait = watcher.waitForPanes([pane], { mode: "all", timeoutMs: 40 })
        const longWait = watcher.waitForPanes([pane], { mode: "all", timeoutMs: 1000 })
        await waitForRegisteredWaiters(watcher, pane.paneId, 2)

        const shortResult = await shortWait
        assert.equal(shortResult.status, "timeout")

        livePanes = [
            {
                ...livePanes[0],
                attention: { status: "NeedsYou", changed_ms: 2 },
            },
        ]
        await watcher.runSingleSync()
        assert.equal(sentMessages.length, 0)

        const longResult = await longWait
        assert.equal(longResult.status, "needs_attention")

        await watcher.runSingleSync()
        assert.equal(sentMessages.length, 0)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("reset aborts pending waiters and clears suppression", async () => {
    const sessionId = `wait-reset-${Date.now()}`
    let livePanes: Array<Record<string, unknown>> = [
        {
            id: 93,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
    ]
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
            return Promise.resolve({
                stdout: "terminal_93\n",
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
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-reset"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(createMockContext(sessionId))
        const watcher = new PaneWatcher(pi, manager)
        const pane = await manager.spawnInTopology({
            kind: "task",
            name: "job-reset",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })

        const waitPromise = watcher.waitForPanes([pane], { mode: "all", timeoutMs: 1000 })
        await waitForRegisteredWaiters(watcher, pane.paneId, 1)
        watcher.reset()

        let guardTimer: ReturnType<typeof setTimeout> | undefined
        const outcome = await Promise.race([
            waitPromise,
            new Promise<"guard">((resolve) => {
                guardTimer = setTimeout(() => resolve("guard"), 300)
            }),
        ])
        if (guardTimer) clearTimeout(guardTimer)
        assert.notEqual(outcome, "guard")
        assert.equal((outcome as { status: string }).status, "aborted")

        livePanes = [{ ...livePanes[0], exited: true, exit_status: 0 }]
        await watcher.runSingleSync()
        assert.equal(sentMessages.length, 1)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("waitForPanes deduplicates repeated pane targets without leaking waiters", async () => {
    const sessionId = `wait-dedup-${Date.now()}`
    const livePanes: Array<Record<string, unknown>> = [
        {
            id: 94,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
    ]
    const { pi } = createMockRuntime((_cmd, args) => {
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
                stdout: "terminal_94\n",
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
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-dedup"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(createMockContext(sessionId))
        const watcher = new PaneWatcher(pi, manager)
        const pane = await manager.spawnInTopology({
            kind: "task",
            name: "job-dedup",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })

        const res = await watcher.waitForPanes([pane, pane], {
            mode: "all",
            timeoutMs: 40,
        })
        assert.equal(res.status, "timeout")
        const internal = watcher as unknown as {
            exitWaiters: Map<string, Set<unknown>>
        }
        assert.equal(internal.exitWaiters.size, 0)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("mode any does not duplicate followUp when another pane prompts in the same sync", async () => {
    const sessionId = `wait-any-att-${Date.now()}`
    let livePanes: Array<Record<string, unknown>> = [
        {
            id: 95,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
        {
            id: 96,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
    ]
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
            const name = args[args.indexOf("-n") + 1] ?? ""
            return Promise.resolve({
                stdout: `${name === "job-any-exit" ? "terminal_95" : "terminal_96"}\n`,
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
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-any-att"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(createMockContext(sessionId))
        const watcher = new PaneWatcher(pi, manager)
        const exitPane = await manager.spawnInTopology({
            kind: "task",
            name: "job-any-exit",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })
        const promptPane = await manager.spawnInTopology({
            kind: "task",
            name: "job-any-prompt",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })

        const waitPromise = watcher.waitForPanes([exitPane, promptPane], {
            mode: "any",
            timeoutMs: 1000,
        })
        await waitForRegisteredWaiters(watcher, exitPane.paneId, 1)
        await waitForRegisteredWaiters(watcher, promptPane.paneId, 1)

        livePanes = [
            { ...livePanes[0], exited: true, exit_status: 0 },
            {
                ...livePanes[1],
                exited: false,
                attention: { status: "NeedsYou", changed_ms: 3 },
            },
        ]
        await watcher.runSingleSync()

        const res = await waitPromise
        assert.equal(res.status, "completed")
        assert.equal(promptPane.needsAttention, true)
        assert.equal(sentMessages.length, 0)

        await watcher.runSingleSync()
        assert.equal(sentMessages.length, 0)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("closing a tracked pane wakes waitForPanes and keeps its log", async () => {
    const sessionId = `wait-close-${Date.now()}`
    const livePanes: Array<Record<string, unknown>> = [
        {
            id: 97,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
        },
    ]
    const { pi } = createMockRuntime((_cmd, args) => {
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
                stdout: "terminal_97\n",
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
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-close"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(createMockContext(sessionId))
        const watcher = new PaneWatcher(pi, manager)
        manager.setPaneFinalizedListener((pane) => watcher.notifyPaneFinalized(pane))

        const art = manager.allocateArtifactPaths("job-close")
        writeFileSync(art.logPath, "close log output\n", "utf-8")
        const pane = await manager.spawnInTopology({
            kind: "task",
            name: "job-close",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: art.logPath,
            exitMarkerPath: art.exitMarkerPath,
        })

        const waitPromise = watcher.waitForPanes([pane], {
            mode: "all",
            timeoutMs: 1000,
        })
        await waitForRegisteredWaiters(watcher, pane.paneId, 1)

        await manager.closeTrackedPane(pane.paneId)
        const res = await waitPromise
        assert.equal(res.status, "completed")
        assert.equal(res.panes[0]?.status, "closed")
        assert.ok(existsSync(art.logPath), "log must stay readable after close during wait")
        assert.equal(await manager.readPaneOutput(pane, { maxLines: 10 }), "close log output")

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})

void test("releasing suppressed attention persists the cleared signature", async () => {
    const sessionId = `wait-att-persist-${Date.now()}`
    const livePanes: Array<Record<string, unknown>> = [
        {
            id: 102,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
            attention: { status: "NeedsYou", changed_ms: 5 },
        },
    ]
    const { pi, entries } = createMockRuntime((_cmd, args) => {
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
                stdout: "terminal_102\n",
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
    process.env.ZELLIJ_SESSION_NAME = "mock-wait-att-persist"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(createMockContext(sessionId))
        const watcher = new PaneWatcher(pi, manager)
        const pane = await manager.spawnInTopology({
            kind: "task",
            name: "job-att-persist",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })

        const res = await watcher.waitForExit(pane, 100)
        assert.equal(res.exited, false)
        assert.equal(pane.needsAttention, true)
        assert.equal(pane.lastAttentionSignature, undefined)

        const stateEntries = entries.filter((entry) => entry.customType === "zellij-state")
        const latest = stateEntries.at(-1)?.data as {
            panes: Array<{
                paneId: string
                needsAttention?: boolean
                lastAttentionSignature?: string
            }>
        }
        const saved = latest.panes.find((candidate) => candidate.paneId === pane.paneId)
        assert.ok(saved)
        assert.equal(saved.needsAttention, true)
        assert.equal(saved.lastAttentionSignature, undefined)

        watcher.dispose()
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})
