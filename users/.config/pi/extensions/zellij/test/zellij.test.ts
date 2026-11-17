import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type {
    ExtensionAPI,
    ExtensionContext,
    ToolDefinition,
} from "@earendil-works/pi-coding-agent"
import { detectBlockedBashReason } from "../src/bash-guard.ts"
import {
    parseListSessionsOutput,
    parsePaneNumericId,
    sanitizeIdentifier,
    validateIdentifier,
    withTemporaryClient,
} from "../src/cli.ts"
import { parsePersistedState, readTailFromFile, ZellijSessionManager } from "../src/session.ts"
import { registerZellijTools, wrapCommandWithTee } from "../src/tools.ts"
import { parseZellijPanesJson, parseZellijTabsJson } from "../src/types.ts"
import { PaneWatcher } from "../src/watcher.ts"

const BLOCKED_CASES = [
    "nohup cargo build &",
    "/usr/bin/nohup sleep 5",
    "env FOO=1 nohup make",
    "if true; then nohup sleep 1; fi",
    "{ nohup sleep 1; }",
    "for i in 1; do setsid true; done",
    "python3 -m http.server &",
    "npm run dev 8080&",
    "make 2>&1&",
    "cmd1 & cmd2",
    "disown %1",
    "setsid node server.js",
    "tmux new -s foo",
    "/usr/bin/screen -S test",
    "while true; do sleep 2; done",
    "zellij kill-all-sessions",
    "zellij delete-all-sessions",
    "zellij kill-session foo",
    "zellij attach my-session",
    "zellij subscribe --pane-id terminal_1",
    'zellij "subscribe" --pane-id terminal_1',
    "zellij action new-pane -- echo hi",
    "zellij action write-chars -p 1 -- ls",
    "zellij -s nc action new-pane -- echo hi",
    "zellij --session=nc action new-tab --name foo",
    "zellij run -- echo hi",
    "zellij -s nc r -- echo hi",
    "zellij edit foo.txt",
    "zellij plugin file:bar.wasm",
]

const ALLOWED_CASES = [
    "cargo check && cargo test",
    "echo hi 2>&1",
    "echo hi >&2",
    "git status",
    "git status # nohup comment &",
    'grep "nohup" file.txt',
    "rg -l then nohup.md",
    'echo "foo &"',
    'git commit -m "while sleep"',
    "echo $((1 & 1))",
    "nohup=true",
    "zellij subscribe --help",
    'zellij "subscribe" --help',
    "zellij action new-pane --help",
    "zellij -s nc action new-pane -h",
    "zellij run --help",
    "zellij attach -h",
    "cat <<'EOF'\nnohup foo &\ntmux new\nEOF",
    "cat <<-EOF\n\tnohup foo &\n\tEOF",
]

void test("detectBlockedBashReason blocks anti-patterns", () => {
    for (const cmd of BLOCKED_CASES) {
        assert.ok(detectBlockedBashReason(cmd), `Expected blocked: ${cmd}`)
    }
})

void test("detectBlockedBashReason allows safe commands, assignments, and heredocs", () => {
    for (const cmd of ALLOWED_CASES) {
        assert.equal(detectBlockedBashReason(cmd), undefined, `Expected allowed: ${cmd}`)
    }
})

void test("identifier and pane ID helpers reject invalid formats", () => {
    assert.throws(() => validateIdentifier("-flag", "pane"))
    assert.throws(() => validateIdentifier(".hidden", "pane"))
    assert.throws(() => validateIdentifier("..", "pane"))
    assert.equal(validateIdentifier("api-dev_1.0", "pane"), "api-dev_1.0")
    assert.equal(sanitizeIdentifier("---api/dev", "fallback"), "api-dev")
    assert.equal(parsePaneNumericId("terminal_12"), 12)
    assert.equal(parsePaneNumericId("7"), 7)
    assert.throws(() => parsePaneNumericId("plugin_1"))
})

void test("JSON parsers return empty array on empty or invalid JSON", () => {
    assert.deepEqual(parseZellijPanesJson(""), [])
    assert.deepEqual(parseZellijPanesJson("not json"), [])
    assert.deepEqual(parseZellijTabsJson(""), [])
    assert.deepEqual(parseZellijTabsJson("{}"), [])
})

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
            },
            { paneId: "bad", kind: "invalid_kind" },
        ],
    })
    assert.ok(parsed)
    assert.equal(parsed.panes.length, 1)
    assert.equal(parsed.panes[0]?.name, "build")
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

void test("wrapCommandWithTee embeds PATH, tee log, and exit marker", () => {
    const cmd = wrapCommandWithTee("npm test", "/tmp/a.log", "/tmp/a.exit", "/custom/bin")
    assert.equal(cmd[0], "bash")
    assert.equal(cmd[1], "-c")
    assert.match(cmd[2] ?? "", /export PATH='\/custom\/bin'/)
    assert.match(cmd[2] ?? "", /tee '\/tmp\/a\.log'/)
    assert.match(cmd[2] ?? "", /> '\/tmp\/a\.exit'/)
})

function createMockRuntime(execImpl: ExtensionAPI["exec"]) {
    const sentMessages: Array<{ customType: string; content: string; details: unknown }> = []
    const entries: Array<{ customType: string; data: unknown }> = []
    const tools = new Map<string, ToolDefinition>()
    const pi = {
        exec: execImpl,
        registerTool: (def: ToolDefinition) => {
            tools.set(def.name, def)
        },
        getThinkingLevel: () => "medium",
        sendMessage: (msg: { customType: string; content: string; details?: unknown }) => {
            sentMessages.push({
                customType: msg.customType,
                content: msg.content,
                details: msg.details,
            })
        },
        appendEntry: (customType: string, data?: unknown) => {
            entries.push({ customType, data })
        },
    } as unknown as ExtensionAPI
    return { pi, tools, sentMessages, entries }
}

function createMockContext(sessionId: string, branchEntries: unknown[] = []): ExtensionContext {
    return {
        cwd: "/tmp",
        hasUI: false,
        mode: "print",
        sessionManager: {
            getSessionId: () => sessionId,
            getBranch: () => branchEntries,
        },
    } as unknown as ExtensionContext
}

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

void test("parseListSessionsOutput preserves spaces in names and drops EXITED sessions", () => {
    const raw = [
        "pi review 123 [Created 1h 2m ago] (current)",
        "old dead session [Created 2d ago] (EXITED - attach to resurrect)",
        "nc [Created 5h ago]",
        "",
    ].join("\n")
    assert.deepEqual(parseListSessionsOutput(raw), ["pi review 123", "nc"])
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
        await new Promise((done) => setTimeout(done, 30))
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

void test("withTemporaryClient serializes concurrent acquisition via single list-clients probe", async () => {
    let clientQueries = 0
    let releaseQuery!: () => void
    const gate = new Promise<void>((resolve) => {
        releaseQuery = resolve
    })

    const { pi } = createMockRuntime(async (_cmd, args) => {
        if (args.includes("list-clients")) {
            clientQueries += 1
            await gate
            return {
                stdout: "CLIENT_ID\n1\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            }
        }
        return { stdout: "", stderr: "", code: 0, killed: false, truncated: false }
    })

    const p1 = withTemporaryClient(pi, "shared-sess", () => Promise.resolve("a"))
    const p2 = withTemporaryClient(pi, "shared-sess", () => Promise.resolve("b"))
    await new Promise((done) => setTimeout(done, 10))
    assert.equal(clientQueries, 1)
    releaseQuery()
    assert.deepEqual(await Promise.all([p1, p2]), ["a", "b"])
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
