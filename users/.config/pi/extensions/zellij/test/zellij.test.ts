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
    promptNotify,
    sanitizeIdentifier,
    validateIdentifier,
    withTemporaryClient,
} from "../src/cli.ts"
import {
    parsePersistedState,
    readTailFromFile,
    sanitizeAsciiText,
    ZellijSessionManager,
} from "../src/session.ts"
import { registerZellijTools, wrapCommandWithTee } from "../src/tools.ts"
import { parseZellijPanesJson, parseZellijTabsJson } from "../src/types.ts"
import { PaneWatcher } from "../src/watcher.ts"
import initZellijExtension from "../src/index.ts"

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

void test("service/rpc skip --notify, Watch quiet needs prompt regex, exit/send mark-pane-seen cleanly, and promptNotify routes to user client", async () => {
    const calls: string[][] = []
    const sessionId = `notify-test-${Date.now()}`
    let panePayload: Array<Record<string, unknown>> = []
    let clientOutput = "CLIENT_ID ZELLIJ_PANE_ID RUNNING_COMMAND\n1 terminal_99 pi\n"
    const tabPayload: Array<Record<string, unknown>> = []
    let dumpScreenText = "Password: "

    const { pi, tools, sentMessages } = createMockRuntime((cmd, args) => {
        calls.push([cmd, ...args])
        if (args.includes("list-clients")) {
            return Promise.resolve({
                stdout: clientOutput,
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-tabs")) {
            return Promise.resolve({
                stdout: JSON.stringify(tabPayload),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-tab")) {
            const tabName = args[args.indexOf("-n") + 1] ?? ""
            const tabId = tabName === "services" ? 2 : 1
            tabPayload.push({
                position: tabPayload.length,
                name: tabName,
                active: false,
                tab_id: tabId,
            })
            return Promise.resolve({
                stdout: `${tabId}\n`,
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("new-pane")) {
            const name = args[args.indexOf("-n") + 1] ?? ""
            return Promise.resolve({
                stdout: name === "devsvc-2" ? "terminal_203\n" : "terminal_202\n",
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("list-panes")) {
            return Promise.resolve({
                stdout: JSON.stringify(panePayload),
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        if (args.includes("dump-screen")) {
            return Promise.resolve({
                stdout: dumpScreenText,
                stderr: "",
                code: 0,
                killed: false,
                truncated: false,
            })
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false, truncated: false })
    })

    const prevHost = process.env.ZELLIJ_SESSION_NAME
    const prevPaneId = process.env.ZELLIJ_PANE_ID
    process.env.ZELLIJ_SESSION_NAME = "mock-notify"
    delete process.env.ZELLIJ_PANE_ID
    const manager = new ZellijSessionManager(pi)
    try {
        const ctx = createMockContext(sessionId)
        manager.bindContext(ctx)
        const watcher = new PaneWatcher(pi, manager)
        registerZellijTools(pi, manager, watcher)

        const svcTool = tools.get("zellij_service")
        const runTool = tools.get("zellij_run")
        const paneTool = tools.get("zellij_pane")
        assert.ok(svcTool && runTool && paneTool)

        // Creating `services` tab via new-tab must NOT invoke `watch-pane`.
        panePayload = [
            {
                id: 201,
                is_plugin: false,
                is_floating: false,
                exited: false,
                tab_id: 2,
                tab_name: "services",
            },
        ]
        await svcTool.execute(
            "svc-1",
            { action: "start", name: "devsvc", command: "node dev.js" },
            undefined,
            undefined,
            ctx as never,
        )
        assert.ok(!calls.some((a) => a.includes("watch-pane")), "service tab must skip watch-pane")

        // Second service in existing `services` tab must omit `--notify`.
        panePayload.push({
            id: 203,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 2,
            tab_name: "services",
        })
        await svcTool.execute(
            "svc-2",
            { action: "start", name: "devsvc-2", command: "node dev2.js" },
            undefined,
            undefined,
            ctx as never,
        )

        // Pre-add `tasks` tab so `zellij_run` takes `new-pane` path (with `--notify`).
        tabPayload.push({ position: 1, name: "tasks", active: false, tab_id: 1 })
        panePayload.push({
            id: 202,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
            attention: {
                status: "NeedsYou",
                source: "Watch",
                text: "went quiet",
                from_watch: true,
                changed_ms: 1,
            },
        })
        await runTool.execute(
            "run-1",
            { name: "deploy", command: "deploy.sh", waitSeconds: 0 },
            undefined,
            undefined,
            ctx as never,
        )

        const newPaneCalls = calls.filter((a) => a.includes("new-pane"))
        assert.equal(newPaneCalls.length, 2)
        assert.ok(!newPaneCalls[0]?.includes("--notify"), "service new-pane must omit --notify")
        assert.ok(newPaneCalls[1]?.includes("--notify"), "task new-pane must include --notify")

        const deployPane = manager.getPane("terminal_202")
        assert.ok(deployPane?.logPath)
        writeFileSync(deployPane.logPath, "old stdout line\n", "utf-8")

        // Watch "went quiet" with non-prompt screen must NOT trigger needs_attention.
        dumpScreenText = "Compiling crates..."
        await watcher.runSingleSync()
        assert.equal(deployPane.needsAttention, false)
        assert.equal(sentMessages.length, 0)

        // Watch "went quiet" WITH prompt regex match triggers needs_attention + env ZELLIJ_PANE_ID=99 prompt notify.
        dumpScreenText = "Proceed? [y/N]"
        panePayload[2] = {
            id: 202,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
            attention: {
                status: "NeedsYou",
                source: "Watch",
                text: "went quiet",
                from_watch: true,
                changed_ms: 2,
            },
        }
        await watcher.runSingleSync()
        assert.equal(deployPane.needsAttention, true)
        assert.equal(deployPane.lastOutputLine, "Proceed? [y/N]")
        // Subsequent sync and refreshUI must NOT overwrite `/dev/tty` prompt line from `logPath`.
        await watcher.runSingleSync()
        watcher.refreshUI()
        assert.equal(deployPane.lastOutputLine, "Proceed? [y/N]")
        await new Promise((done) => setTimeout(done, 10))

        const envNotifyCall = calls.find(
            (a) => a[0] === "env" && a.includes("ZELLIJ_PANE_ID=99") && a.includes("notify"),
        )
        assert.ok(envNotifyCall, "Must invoke env ZELLIJ_PANE_ID=99 zellij prompt notify")
        assert.ok(envNotifyCall.includes("--no-pane-name"))
        assert.ok(envNotifyCall.includes("--no-tab-name"))

        // Calling `send` clears needsAttention and calls `mark-pane-seen`, WITHOUT suppressing exit-time mark-pane-seen.
        await paneTool.execute(
            "send-resp",
            { action: "send", pane: "terminal_202", text: "y" },
            undefined,
            undefined,
            ctx as never,
        )
        assert.equal(deployPane.needsAttention, false)

        // Blocked -> Idle -> Blocked with identical signature still re-notifies.
        process.env.ZELLIJ_PANE_ID = "99"
        panePayload[2] = {
            id: 202,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
            program_status: [{ state: "Blocked" }],
            attention: { status: "Idle", changed_ms: 0 },
        }
        await watcher.runSingleSync()
        const msgAfterBlocked1 = sentMessages.length
        panePayload[2] = {
            id: 202,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
            attention: { status: "Idle", changed_ms: 0 },
        }
        await watcher.runSingleSync()
        assert.equal(deployPane.needsAttention, false)
        assert.equal(deployPane.lastOutputLine, "old stdout line")

        panePayload[2] = {
            id: 202,
            is_plugin: false,
            is_floating: false,
            exited: false,
            tab_id: 1,
            tab_name: "tasks",
            program_status: [{ state: "Blocked" }],
            attention: { status: "Idle", changed_ms: 0 },
        }
        await watcher.runSingleSync()
        assert.equal(sentMessages.length, msgAfterBlocked1 + 1)
        await new Promise((done) => setTimeout(done, 10))
        const directNotifyCall = calls.find(
            (a) => a[0] === "zellij" && a.includes("prompt") && a.includes("notify"),
        )
        assert.ok(
            directNotifyCall,
            "Host ZELLIJ_PANE_ID=99 calls zellij directly without env wrapper",
        )

        // When no user client is attached, promptNotify returns without spawning `zellij prompt`.
        const beforePromptCount = calls.filter(
            (a) => a.includes("prompt") && a.includes("notify"),
        ).length
        clientOutput = "CLIENT_ID ZELLIJ_PANE_ID RUNNING_COMMAND\n"
        await promptNotify(pi, "mock-notify", "ignored", { paneId: "terminal_202" })
        assert.equal(
            calls.filter((a) => a.includes("prompt") && a.includes("notify")).length,
            beforePromptCount,
        )

        // Exit 0 marks pane seen even after `send` previously called `mark-pane-seen`, and reap does not duplicate.
        const seenBeforeExit = calls.filter(
            (a) => a.includes("mark-pane-seen") && a.includes("terminal_202"),
        ).length
        panePayload[2] = {
            id: 202,
            is_plugin: false,
            is_floating: false,
            exited: true,
            exit_status: 0,
            tab_id: 1,
            tab_name: "tasks",
        }
        await watcher.runSingleSync()
        await new Promise((done) => setTimeout(done, 10))
        await manager.reapCompletedPanes()
        const seenAfterExit = calls.filter(
            (a) => a.includes("mark-pane-seen") && a.includes("terminal_202"),
        ).length
        assert.equal(seenAfterExit, seenBeforeExit + 1)
        watcher.dispose()
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
