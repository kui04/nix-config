import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { focusPane, toggleEmbedOrFloating } from "./cli.ts"
import type { ZellijSessionManager } from "./session.ts"
import type { PaneWatcher } from "./watcher.ts"

async function handleInteractiveMenu(
    pi: ExtensionAPI,
    manager: ZellijSessionManager,
    watcher: PaneWatcher,
    ctx: ExtensionCommandContext,
): Promise<void> {
    await watcher.syncNow()
    const panes = manager.getTrackedPanes()
    if (panes.length === 0) {
        const attach = manager.getAttachHint()
        ctx.ui.notify(
            attach
                ? `No tracked Zellij panes. Attach command: ${attach}`
                : "No tracked Zellij panes.",
            "info",
        )
        return
    }

    const choices = panes.map((p) => {
        const exitInfo = p.status === "exited" ? ` exit=${p.exitCode ?? "?"}` : ""
        return `${p.paneId} | ${p.kind}:${p.name} [${p.status}${exitInfo}] (${p.tabName}/${p.layout})`
    })
    choices.push("Sweep exited panes")

    const picked = await ctx.ui.select("Zellij Panes", choices)
    if (!picked) return

    if (picked === "Sweep exited panes") {
        const { closed } = await manager.sweep()
        watcher.ensureLoopRunning()
        ctx.ui.notify(`Closed ${closed.length} exited pane(s).`, "info")
        return
    }

    const paneId = picked.split(" | ")[0]?.trim()
    if (!paneId) return

    const action = await ctx.ui.select(`Action for ${paneId}`, [
        "Focus pane",
        "Toggle floating / embedded",
        "Show output tail",
        "Close pane",
    ])
    if (!action) return

    const session = manager.getSessionName()
    if (action === "Focus pane") {
        await focusPane(pi, session, paneId)
    } else if (action === "Toggle floating / embedded") {
        await toggleEmbedOrFloating(pi, session, paneId)
    } else if (action === "Show output tail") {
        const pane = manager.getPane(paneId)
        if (pane) {
            const out = await manager.readPaneOutput(pane, { maxLines: 40 })
            ctx.ui.notify(out || "(no output)", "info")
        }
    } else if (action === "Close pane") {
        await manager.closeTrackedPane(paneId)
        watcher.ensureLoopRunning()
        ctx.ui.notify(`Closed ${paneId}.`, "info")
    }
}

export function registerZellijCommands(
    pi: ExtensionAPI,
    manager: ZellijSessionManager,
    watcher: PaneWatcher,
): void {
    pi.registerCommand("zellij", {
        description: "Manage Zellij panes and session (usage: /zellij [status|sweep|attach])",
        handler: async (args, ctx) => {
            try {
                const sub = args.trim().toLowerCase()
                if (sub === "status") {
                    await watcher.syncNow()
                    const panes = manager.getTrackedPanes()
                    const attach = manager.getAttachHint()
                    const lines = [
                        `Session: ${manager.getSessionName()} (${manager.isManagedSession() ? "managed" : "host"})`,
                        attach ? `Attach: ${attach}` : undefined,
                        `Tracked panes: ${panes.length}`,
                        ...panes.map((p) => `- ${p.paneId} ${p.kind}:${p.name} [${p.status}]`),
                    ].filter((l): l is string => Boolean(l))
                    ctx.ui.notify(lines.join("\n"), "info")
                    return
                }

                if (sub === "sweep") {
                    const { closed, keptRunning } = await manager.sweep()
                    watcher.ensureLoopRunning()
                    ctx.ui.notify(
                        `Closed ${closed.length} exited pane(s); ${keptRunning.length} running.`,
                        "info",
                    )
                    return
                }

                if (sub === "attach") {
                    if (!manager.isManagedSession()) {
                        ctx.ui.notify(
                            `Already running inside host Zellij session "${manager.getSessionName()}".`,
                            "info",
                        )
                        return
                    }
                    if (!manager.isSessionReady()) {
                        ctx.ui.notify(
                            `Managed session "${manager.getSessionName()}" has not been created yet (starts on first zellij_* call).`,
                            "info",
                        )
                        return
                    }
                    ctx.ui.notify(
                        `Run in another terminal: zellij attach ${manager.getSessionName()}`,
                        "info",
                    )
                    return
                }

                if (!ctx.hasUI) {
                    ctx.ui.notify("Use /zellij status, /zellij sweep, or /zellij attach.", "info")
                    return
                }

                await handleInteractiveMenu(pi, manager, watcher, ctx)
            } catch (err) {
                ctx.ui.notify(
                    `Zellij command error: ${err instanceof Error ? err.message : String(err)}`,
                    "error",
                )
            }
        },
    })
}
