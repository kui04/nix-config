import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import test from "node:test"
import { promptNotify } from "../src/cli.ts"
import { ZellijSessionManager } from "../src/session.ts"
import { registerZellijTools } from "../src/tools.ts"
import { PaneWatcher } from "../src/watcher.ts"
import { createMockContext, createMockRuntime } from "./helpers.ts"

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
