import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { registerBashGuard } from "./bash-guard.ts"
import { probeZellijVersion } from "./cli.ts"
import { registerZellijCommands } from "./commands.ts"
import { ZellijSessionManager } from "./session.ts"
import { registerZellijTools } from "./tools.ts"
import { PaneWatcher } from "./watcher.ts"

function registerUnavailableNotice(pi: ExtensionAPI) {
    let reason: string | undefined
    let sessionContext: ExtensionContext | undefined

    const applyStatus = () => {
        if (!reason || !sessionContext?.hasUI) return
        try {
            sessionContext.ui.setStatus("zellij", `Zellij disabled: ${reason}`)
        } catch {
            // Never fail session startup when reporting unavailability.
        }
    }

    pi.on("session_start", (_event, ctx) => {
        sessionContext = ctx
        applyStatus()
    })

    return (nextReason: string) => {
        reason = nextReason
        applyStatus()
    }
}

export default async function (pi: ExtensionAPI) {
    // Child pi subagents launched by `zellij_subagent` skip re-initializing the orchestrator.
    if (process.env.PI_ZELLIJ_SUBAGENT === "1") {
        return
    }

    const reportUnavailable = registerUnavailableNotice(pi)
    const probe = await probeZellijVersion(pi)
    if (!probe.ok) {
        reportUnavailable(probe.reason)
        console.warn(`[zellij] ${probe.reason} — extension disabled`)
        return
    }

    const manager = new ZellijSessionManager(pi)
    const watcher = new PaneWatcher(pi, manager)

    registerZellijTools(pi, manager, watcher)
    registerZellijCommands(pi, manager, watcher)
    registerBashGuard(pi)

    pi.on("session_start", async (event, ctx) => {
        watcher.reset()
        await manager.restoreFromSession(ctx, event.reason)
        watcher.ensureLoopRunning()
    })

    pi.on("agent_settled", async () => {
        await manager.reapCompletedPanes().catch(() => {})
        watcher.ensureLoopRunning()
    })

    pi.on("session_shutdown", async (event, ctx) => {
        if (event.reason === "quit") {
            const running = manager.getRunningPanes()
            if (running.length > 0) {
                if (ctx.hasUI) {
                    const names = running.map((p) => `${p.kind}:${p.name}(${p.paneId})`).join(", ")
                    ctx.ui.notify(
                        `Leaving ${running.length} active Zellij pane(s) running in "${manager.getSessionName()}": ${names}`,
                        "info",
                    )
                }
                // Clean up already-exited tracked panes while keeping running services alive.
                await manager.sweep({ killRunning: false }).catch(() => {})
            } else {
                // Clean up exited tracked panes in both managed and host sessions, then delete empty managed session.
                await manager.sweep({ killRunning: false }).catch(() => {})
                await manager.destroyManagedSessionIfEmpty().catch(() => {})
            }
            if (manager.getTrackedPanes().length === 0) {
                manager.cleanupRuntimeDir()
            }
        }
        watcher.dispose()
        manager.markShuttingDown()
    })
}
