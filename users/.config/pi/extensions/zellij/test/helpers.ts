import type {
    ExtensionAPI,
    ExtensionContext,
    ToolDefinition,
} from "@earendil-works/pi-coding-agent"

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
