import type {
    ExtensionAPI,
    ExtensionContext,
    ToolDefinition,
} from "@earendil-works/pi-coding-agent"
import type { PaneWatcher } from "../src/watcher.ts"

export function createMockRuntime(execImpl: ExtensionAPI["exec"]) {
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

export function createMockContext(
    sessionId: string,
    branchEntries: unknown[] = [],
): ExtensionContext {
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

/** Wait until `watcher` has registered at least `expected` waiters for `paneId`. */
export async function waitForRegisteredWaiters(
    watcher: PaneWatcher,
    paneId: string,
    expected: number,
): Promise<void> {
    const internal = watcher as unknown as {
        exitWaiters: Map<string, Set<unknown>>
    }
    const deadline = Date.now() + 500
    while (Date.now() < deadline) {
        if ((internal.exitWaiters.get(paneId)?.size ?? 0) >= expected) return
        await new Promise((done) => setTimeout(done, 5))
    }
    throw new Error(`waiter for ${paneId} was not registered ${expected} time(s)`)
}
