import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import initZellijExtension from "../src/index.ts"
import {
    parsePersistedState,
    readTailFromFile,
    sanitizeAsciiText,
    ZellijSessionManager,
} from "../src/session.ts"
import { PaneWatcher } from "../src/watcher.ts"
import { createMockContext, createMockRuntime } from "./helpers.ts"

void test("parsePersistedState validates schema and rejects malformed payloads", () => {
    assert.equal(parsePersistedState(null), null)
    assert.equal(
        parsePersistedState({ sessionName: "s", managedSession: true, panes: "bad" }),
        null,
    )
    const parsed = parsePersistedState({
        sessionName: "s1",
        managedSession: true,
        panes: [
            {
                paneId: "terminal_1",
                numericId: 1,
                tabId: 1,
                tabName: "tasks",
                name: "build",
                kind: "task",
                layout: "stacked",
                command: "echo hi",
                cwd: "/tmp",
                startedAt: 100,
                status: "running",
                needsAttention: true,
                markedSeen: false,
                lastOutputLine: "✓ 进度\t10%\r50%",
            },
            { paneId: "bad", kind: "invalid_kind" },
        ],
    })
    assert.ok(parsed)
    assert.equal(parsed.panes.length, 1)
    assert.equal(parsed.panes[0]?.name, "build")
    assert.equal(parsed.panes[0]?.needsAttention, true)
    assert.equal(parsed.panes[0]?.markedSeen, false)
    assert.equal(parsed.panes[0]?.lastOutputLine, "50%")
})

void test("parsePersistedState defaults legacy agent panes to one-shot and keeps explicit rpc mode", () => {
    const base = {
        paneId: "terminal_1",
        numericId: 1,
        tabId: 3,
        tabName: "agents",
        name: "legacy-agent",
        kind: "agent",
        layout: "stacked",
        command: "pi -p",
        cwd: "/tmp",
        startedAt: 1,
        status: "running",
    }
    const parsed = parsePersistedState({
        sessionName: "s1",
        managedSession: true,
        panes: [
            base,
            {
                ...base,
                paneId: "terminal_2",
                numericId: 2,
                name: "rpc-agent",
                command: "pi --mode rpc",
                subagentMode: "rpc",
            },
        ],
    })
    assert.ok(parsed)
    assert.equal(parsed.panes[0]?.subagentMode, "one-shot")
    assert.equal(parsed.panes[1]?.subagentMode, "rpc")
})

void test("sanitizeAsciiText and readLastOutputLine normalize Unicode, CR, controls, and long lines", () => {
    assert.equal(sanitizeAsciiText("\x1b[32m✓\x1b[0m Compiling \t crate\x07\n"), "Compiling crate")
    assert.equal(sanitizeAsciiText("10%\r50%\r100% done"), "100% done")
    assert.equal(sanitizeAsciiText("ab\x08c\x1b(B\x9b"), "ac")
    assert.equal(sanitizeAsciiText("foo\nbar"), "foo bar")
    assert.equal(sanitizeAsciiText("? keep question"), "? keep question")
    assert.equal(sanitizeAsciiText("中文日志"), "?")

    const dir = mkdtempSync(join(tmpdir(), "zj-lastline-"))
    try {
        const logFile = join(dir, "long.log")
        const longText = `${"x".repeat(5000)}\n`
        writeFileSync(logFile, longText, "utf-8")
        // Verify readTailFromFile keeps a >maxBytes single line ending with `\n`.
        const rawTail = readTailFromFile(logFile, 4096)
        assert.ok(rawTail.text.length === 4096 && rawTail.text.endsWith("\n"))
        const manager = new ZellijSessionManager(
            createMockRuntime(() =>
                Promise.resolve({
                    stdout: "",
                    stderr: "",
                    code: 0,
                    killed: false,
                    truncated: false,
                }),
            ).pi,
        )
        const line = manager.readLastOutputLine({
            paneId: "terminal_1",
            numericId: 1,
            tabId: 1,
            tabName: "tasks",
            name: "long",
            kind: "task",
            layout: "stacked",
            command: "echo",
            cwd: "/tmp",
            startedAt: 1,
            status: "running",
            logPath: logFile,
        })
        assert.ok(line && line.endsWith("...") && line.length === 200)
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

void test("readTailFromFile caps bytes and strips partial leading line", () => {
    const dir = mkdtempSync(join(tmpdir(), "zj-tail-"))
    try {
        const file = join(dir, "out.log")
        writeFileSync(file, "first-line\nsecond-line\nthird-line\n", "utf-8")
        // 25 bytes starts mid-"first-line\n" so the partial first line is stripped cleanly.
        const tail = readTailFromFile(file, 25)
        assert.ok(tail.truncatedBytes > 0)
        assert.equal(tail.text, "second-line\nthird-line\n")
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
})

void test("restoreFromSession isolates fork and mismatched host sessions", async () => {
    const { pi } = createMockRuntime(() =>
        Promise.resolve({
            stdout: "",
            stderr: "",
            code: 0,
            killed: false,
            truncated: false,
        }),
    )
    const manager = new ZellijSessionManager(pi)
    const savedState = {
        sessionName: "host-a",
        managedSession: false,
        panes: [
            {
                paneId: "terminal_9",
                numericId: 9,
                tabId: 1,
                tabName: "tasks",
                name: "old-job",
                kind: "task",
                layout: "stacked",
                command: "echo",
                cwd: "/tmp",
                startedAt: 1,
                status: "running",
            },
        ],
    }

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    try {
        process.env.ZELLIJ_SESSION_NAME = "host-b"
        await manager.restoreFromSession(
            createMockContext("sess-1", [
                { type: "custom", customType: "zellij-state", data: savedState },
            ]),
            "resume",
        )
        assert.equal(manager.getTrackedPanes().length, 0)

        delete process.env.ZELLIJ_SESSION_NAME
        await manager.restoreFromSession(
            createMockContext("sess-2", [
                { type: "custom", customType: "zellij-state", data: savedState },
            ]),
            "fork",
        )
        assert.equal(manager.getTrackedPanes().length, 0)
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
    }
})

void test("spawnInTopology falls back from --stacked to split+stack-panes", async () => {
    const calls: string[][] = []
    const { pi } = createMockRuntime((_cmd, args) => {
        calls.push(args)
        const joined = args.join(" ")
        if (joined.includes("list-clients")) {
            return Promise.resolve({
                stdout: "CLIENT_ID ZELLIJ_PANE_ID RUNNING_COMMAND\n1 terminal_0 N/A\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (joined.includes("list-tabs")) {
            return Promise.resolve({
                stdout: JSON.stringify([{ position: 0, name: "tasks", active: false, tab_id: 1 }]),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (joined.includes("new-pane") && args.includes("--stacked")) {
            return Promise.resolve({
                stdout: "",
                stderr: "No room for a new pane",
                code: 1,
                killed: false,
                truncated: false,
            })
        }
        if (joined.includes("new-pane")) {
            return Promise.resolve({
                stdout: "terminal_2\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (joined.includes("list-panes")) {
            return Promise.resolve({
                stdout: JSON.stringify([
                    {
                        id: 1,
                        is_plugin: false,
                        is_floating: false,
                        exited: false,
                        exit_status: null,
                        tab_id: 1,
                        tab_name: "tasks",
                    },
                    {
                        id: 2,
                        is_plugin: false,
                        is_floating: false,
                        exited: false,
                        exit_status: null,
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
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-host"
    try {
        const manager = new ZellijSessionManager(pi)
        manager.bindContext(createMockContext(`mock-${Date.now()}`))
        const pane = await manager.spawnInTopology({
            kind: "task",
            name: "p2",
            command: ["echo", "ok"],
            cwd: "/tmp",
            layout: "stacked",
        })
        assert.equal(pane.paneId, "terminal_2")
        assert.ok(calls.some((a) => a.includes("stack-panes") && a.includes("terminal_2")))
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
    }
})

void test("sweep distinguishes close-pane failures when pane is still live vs already gone", async () => {
    let liveIds = [71, 72]
    const sessionId = `sweep-test-${Date.now()}`
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
        if (args.includes("list-sessions")) {
            return Promise.resolve({
                stdout: "mock-sweep [Created 1m ago]\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-pane")) {
            const name = args[args.indexOf("-n") + 1]
            return Promise.resolve({
                stdout: name === "alive-fail" ? "terminal_71\n" : "terminal_72\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("close-pane")) {
            return Promise.resolve({
                stdout: "",
                stderr: "close denied",
                code: 1,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-panes")) {
            return Promise.resolve({
                stdout: JSON.stringify(
                    liveIds.map((id) => ({
                        id,
                        is_plugin: false,
                        is_floating: false,
                        exited: true,
                        exit_status: 0,
                        tab_id: 1,
                        tab_name: "tasks",
                    })),
                ),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-sweep"
    try {
        const manager = new ZellijSessionManager(pi)
        manager.bindContext(createMockContext(sessionId))
        const p1 = await manager.spawnInTopology({
            kind: "task",
            name: "alive-fail",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })
        const p2 = await manager.spawnInTopology({
            kind: "task",
            name: "gone-fail",
            command: ["bash"],
            cwd: "/tmp",
            layout: "stacked",
        })
        p1.status = "exited"
        p2.status = "exited"

        // Only terminal_71 remains in `list-panes`; terminal_72 already disappeared.
        liveIds = [71]
        const res = await manager.sweep({ killRunning: false })
        assert.equal(res.closed.length, 1)
        assert.equal(res.closed[0]?.paneId, "terminal_72")
        assert.equal(res.failed.length, 1)
        assert.equal(res.failed[0]?.pane.paneId, "terminal_71")
        assert.deepEqual(
            manager.getTrackedPanes().map((p) => p.paneId),
            ["terminal_71"],
        )
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        const uid = typeof process.getuid === "function" ? process.getuid() : 0
        rmSync(`/run/user/${uid}/pi-zellij-${uid}/${sessionId}`, { recursive: true, force: true })
        rmSync(`/tmp/pi-zellij-${uid}/${sessionId}`, { recursive: true, force: true })
    }
})

void test("restoreFromSession preserves fallback exitCode, concurrent reap+sync keeps logs, and index shutdown respects reload vs quit", async () => {
    const sessionId = `restore-exit-${Date.now()}`
    const dir = mkdtempSync(join(tmpdir(), "zj-restore-"))
    const exitFile = join(dir, "job.exit")
    const logFile = join(dir, "job.log")
    writeFileSync(exitFile, "0\n", "utf-8")
    writeFileSync(logFile, "finished cleanly\n", "utf-8")

    let releaseClose!: () => void
    const closeGate = new Promise<void>((resolve) => {
        releaseClose = resolve
    })
    let liveListPanes: Array<Record<string, unknown>> = [
        {
            id: 91,
            is_plugin: false,
            is_floating: false,
            exited: true,
            exit_status: null,
            tab_id: 1,
            tab_name: "tasks",
        },
    ]

    const { pi, entries, sentMessages } = createMockRuntime(async (_cmd, args) => {
        if (args.includes("list-sessions")) {
            return {
                stdout: "mock-restore [Created 1m ago]\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            }
        }
        if (args.includes("list-panes")) {
            return {
                stdout: JSON.stringify(liveListPanes),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            }
        }
        if (args.includes("close-pane")) {
            await closeGate
        }
        return { stdout: "", stderr: "", code: 0, killed: false, truncated: false }
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-restore"
    const manager = new ZellijSessionManager(pi)
    try {
        const saved = {
            sessionName: "mock-restore",
            managedSession: false,
            panes: [
                {
                    paneId: "terminal_91",
                    numericId: 91,
                    tabId: 1,
                    tabName: "tasks",
                    name: "offline-job",
                    kind: "task",
                    layout: "stacked",
                    command: "echo",
                    cwd: "/tmp",
                    logPath: logFile,
                    exitMarkerPath: exitFile,
                    startedAt: 100,
                    status: "running",
                    exitCode: 0,
                    needsAttention: true,
                },
            ],
        }
        await manager.restoreFromSession(
            createMockContext(sessionId, [
                { type: "custom", customType: "zellij-state", data: saved },
            ]),
            "resume",
        )
        const restored = manager.getPane("terminal_91")
        assert.ok(restored)
        assert.equal(restored.status, "exited")
        assert.equal(restored.exitCode, 0)
        assert.equal(restored.needsAttention, false)
        assert.equal(restored.notifiedCompletion, true)
        assert.equal(restored.lastOutputLine, "finished cleanly")

        // Concurrent reap + runSingleSync while pane disappears mid-close must NOT delete logFile or emit disappeared.
        const watcher = new PaneWatcher(pi, manager)
        const reapPromise = manager.reapCompletedPanes()
        await new Promise((done) => setTimeout(done, 10))
        liveListPanes = []
        await watcher.runSingleSync()
        assert.ok(existsSync(logFile), "concurrent runSingleSync must not delete kept log mid-reap")
        assert.equal(sentMessages.length, 0)
        releaseClose()
        const reaped = await reapPromise
        assert.equal(reaped.length, 1)
        assert.ok(existsSync(logFile), "reap must preserve logFile on disk")
        watcher.dispose()

        // Verify entry-level index.ts lifecycle: `reload` keeps runtimeDir, `quit` cleans it up.
        const extHandlers = new Map<string, Array<(e: unknown, c: unknown) => Promise<void>>>()
        const extSessionId = `idx-test-${Date.now()}`
        const extPi = {
            on: (ev: string, fn: (e: unknown, c: unknown) => Promise<void>) => {
                const list = extHandlers.get(ev) ?? []
                list.push(fn)
                extHandlers.set(ev, list)
            },
            registerTool: () => {},
            registerCommand: () => {},
            appendEntry: () => {},
            exec: (cmd: string, args: string[]) => {
                if (cmd === "zellij" && args.includes("--version")) {
                    return Promise.resolve({
                        stdout: "zellij 0.46.0\n",
                        stderr: "",
                        code: 0,
                        killed: false,
                        truncated: false,
                    })
                }
                return Promise.resolve({
                    stdout: "",
                    stderr: "",
                    code: 0,
                    killed: false,
                    truncated: false,
                })
            },
        } as unknown as ExtensionAPI
        await initZellijExtension(extPi)
        const extCtx = createMockContext(extSessionId)
        for (const h of extHandlers.get("session_start") ?? []) {
            await h({ reason: "startup" }, extCtx)
        }
        const uid = typeof process.getuid === "function" ? process.getuid() : 0
        const candidateRoot = process.env.XDG_RUNTIME_DIR?.trim()
            ? join(process.env.XDG_RUNTIME_DIR.trim(), `pi-zellij-${uid}`, extSessionId)
            : join(tmpdir(), `pi-zellij-${uid}`, extSessionId)
        assert.ok(existsSync(candidateRoot))

        for (const h of extHandlers.get("session_shutdown") ?? []) {
            await h({ reason: "reload" }, extCtx)
        }
        assert.ok(existsSync(candidateRoot), "reload must NOT delete runtimeDir")

        for (const h of extHandlers.get("session_start") ?? []) {
            await h({ reason: "reload" }, extCtx)
        }
        for (const h of extHandlers.get("agent_settled") ?? []) {
            await h({}, extCtx)
        }
        for (const h of extHandlers.get("session_shutdown") ?? []) {
            await h({ reason: "quit" }, extCtx)
        }
        assert.ok(!existsSync(candidateRoot), "quit with 0 panes must clean up runtimeDir")

        const entryCountBefore = entries.length
        manager.markShuttingDown()
        manager.persist()
        assert.equal(entries.length, entryCountBefore)
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        rmSync(dir, { recursive: true, force: true })
        manager.cleanupRuntimeDir()
    }
})

void test("recent finished panes evict the oldest log beyond the bounded registry", async () => {
    const sessionId = `recent-evict-${Date.now()}`
    let nextPane = 800
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
            nextPane += 1
            return Promise.resolve({
                stdout: `terminal_${nextPane}\n`,
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    process.env.ZELLIJ_SESSION_NAME = "mock-recent-evict"
    const manager = new ZellijSessionManager(pi)
    try {
        manager.bindContext(createMockContext(sessionId))
        const logs: string[] = []
        const panes = []
        for (let i = 0; i < 9; i += 1) {
            const art = manager.allocateArtifactPaths(`evict-${i}`)
            writeFileSync(art.logPath, `evict log ${i}\n`, "utf-8")
            logs.push(art.logPath)
            panes.push(
                await manager.spawnInTopology({
                    kind: "task",
                    name: `evict-${i}`,
                    command: ["bash"],
                    cwd: "/tmp",
                    layout: "stacked",
                    logPath: art.logPath,
                    exitMarkerPath: art.exitMarkerPath,
                }),
            )
        }
        for (const [i, pane] of panes.entries()) {
            pane.status = "exited"
            pane.exitCode = 0
            pane.notifiedCompletion = true
            pane.endedAt = i + 1
        }

        const reaped = await manager.reapCompletedPanes()
        assert.equal(reaped.length, 9)
        assert.equal(manager.getRecentlyFinishedPane("evict-0"), undefined)
        assert.equal(existsSync(logs[0] ?? ""), false)
        assert.equal(manager.getRecentlyFinishedPane("evict-8")?.name, "evict-8")
        assert.ok(existsSync(logs[8] ?? ""))
    } finally {
        if (prevHost !== undefined) process.env.ZELLIJ_SESSION_NAME = prevHost
        else delete process.env.ZELLIJ_SESSION_NAME
        manager.cleanupRuntimeDir()
    }
})
