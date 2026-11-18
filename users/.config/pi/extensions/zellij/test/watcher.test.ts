import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { ZellijSessionManager } from "../src/session.ts"
import { PaneWatcher } from "../src/watcher.ts"
import { createMockContext, createMockRuntime } from "./helpers.ts"

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

void test("reapCompletedPanes closes exit-0 notified task/agent and exited repl panes, keeps logs, and caps failed panes at 2", async () => {
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

        const agentOkArt = manager.allocateArtifactPaths("agent-ok")
        writeFileSync(agentOkArt.logPath, "agent log\n", "utf-8")
        const agentOk = await manager.spawnInTopology({
            kind: "agent",
            name: "agent-ok",
            command: ["pi"],
            cwd: "/tmp",
            layout: "stacked",
            logPath: agentOkArt.logPath,
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

        const fail1 = await manager.spawnInTopology({
            kind: "task",
            name: "fail-1",
            command: ["false"],
            cwd: "/tmp",
            layout: "stacked",
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

        agentOk.status = "exited"
        agentOk.exitCode = 0
        agentOk.notifiedCompletion = true
        agentOk.endedAt = 20

        unnotified.status = "exited"
        unnotified.exitCode = 0
        unnotified.notifiedCompletion = false
        unnotified.endedAt = 30

        svcExited.status = "exited"
        svcExited.exitCode = 0
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
            ["task-ok", "agent-ok", "repl-sigint"],
        )
        assert.ok(existsSync(taskOkArt.logPath), "task-ok log must stay on disk after reap")
        assert.ok(existsSync(agentOkArt.logPath), "agent-ok log must stay on disk after reap")
        assert.ok(closedPanes.includes(taskOk.paneId))
        assert.ok(closedPanes.includes(agentOk.paneId))
        assert.ok(closedPanes.includes(replExited.paneId))
        assert.equal(markedSeen.filter((id) => id === taskOk.paneId).length, 1)
        assert.equal(markedSeen.filter((id) => id === agentOk.paneId).length, 1)

        // Remaining exited notified panes (`svc-exited`, `fail-1`, `fail-2`, `fail-3`) are capped at 2 (`fail-2`, `fail-3`).
        const remainingIds = manager.getTrackedPanes().map((p) => p.name)
        assert.deepEqual(remainingIds, ["task-unnotified", "fail-2", "fail-3"])
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
