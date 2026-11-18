export type PaneKind = "task" | "service" | "agent" | "repl"

export type LayoutMode = "stacked" | "split" | "floating" | "tab"

export type SplitDirection = "right" | "down"

export type PaneStatus = "running" | "exited" | "closed"

export interface TrackedPane {
    paneId: string
    numericId: number
    tabId: number
    tabName: string
    name: string
    kind: PaneKind
    layout: LayoutMode
    command: string
    cwd: string
    logPath?: string
    briefPath?: string
    exitMarkerPath?: string
    modelLabel?: string
    startedAt: number
    endedAt?: number
    status: PaneStatus
    exitCode?: number | null
    notifiedCompletion?: boolean
    lastAttentionSignature?: string
    needsAttention?: boolean
    markedSeen?: boolean
    lastOutputLine?: string
}

export interface PersistedZellijState {
    sessionName: string
    managedSession: boolean
    panes: TrackedPane[]
}

export interface ZellijAttention {
    status: string
    changed_ms: number
    source?: string | null
    text?: string | null
    from_watch?: boolean
}

export interface ZellijProgramStatus {
    state: string
}

export interface ZellijCommandState {
    phase: string
    runningCommandText: string | null
    lastExitCode: number | null
}

export interface ZellijPaneJson {
    id: number
    is_plugin: boolean
    is_floating: boolean
    exited: boolean
    exit_status: number | null
    tab_id: number
    tab_name: string
    attention?: ZellijAttention
    program_status?: ZellijProgramStatus[]
    command_state?: ZellijCommandState
}

export interface ZellijTabJson {
    position: number
    name: string
    active: boolean
    tab_id: number
}

export interface ZellijEventDetails {
    paneId: string
    name: string
    kind: PaneKind
    eventType: "exited" | "needs_attention" | "crashed" | "disappeared"
    exitCode?: number | null
    logPath?: string
    outputTail?: string
    modelLabel?: string
}

const VALID_PANE_KINDS = new Set<string>(["task", "service", "agent", "repl"])
const VALID_LAYOUT_MODES = new Set<string>(["stacked", "split", "floating", "tab"])
const VALID_PANE_STATUSES = new Set<string>(["running", "exited", "closed"])

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isPaneKind(value: unknown): value is PaneKind {
    return typeof value === "string" && VALID_PANE_KINDS.has(value)
}

export function isLayoutMode(value: unknown): value is LayoutMode {
    return typeof value === "string" && VALID_LAYOUT_MODES.has(value)
}

export function isPaneStatus(value: unknown): value is PaneStatus {
    return typeof value === "string" && VALID_PANE_STATUSES.has(value)
}

function asString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback
}

function asNullableString(value: unknown): string | null {
    return typeof value === "string" ? value : null
}

function asNumber(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function asNullableNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null
}

function asBoolean(value: unknown, fallback = false): boolean {
    return typeof value === "boolean" ? value : fallback
}

function parseAttention(value: unknown): ZellijAttention | undefined {
    if (!isRecord(value)) return undefined
    return {
        status: asString(value.status, "Idle"),
        changed_ms: asNumber(value.changed_ms),
        source: asNullableString(value.source),
        text: asNullableString(value.text),
        from_watch: asBoolean(value.from_watch),
    }
}

function parseProgramStatusList(value: unknown): ZellijProgramStatus[] | undefined {
    if (!Array.isArray(value)) return undefined
    const result: ZellijProgramStatus[] = []
    for (const item of value) {
        if (!isRecord(item)) continue
        result.push({
            state: asString(item.state),
        })
    }
    return result
}

function parseCommandState(value: unknown): ZellijCommandState | undefined {
    if (!isRecord(value)) return undefined
    let runningCommandText: string | null = null
    if (isRecord(value.running) && isRecord(value.running.command)) {
        runningCommandText = asNullableString(value.running.command.text)
    }
    let lastExitCode: number | null = null
    if (isRecord(value.last)) {
        lastExitCode = asNullableNumber(value.last.exit_code)
    }
    return {
        phase: asString(value.phase, "Unknown"),
        runningCommandText,
        lastExitCode,
    }
}

/** Parse `zellij action list-panes -a -j` output safely. Returns `[]` on empty, invalid, or non-array output. */
export function parseZellijPanesJson(raw: string): ZellijPaneJson[] {
    if (!raw.trim()) return []
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return []
    }
    if (!Array.isArray(parsed)) return []

    const panes: ZellijPaneJson[] = []
    for (const item of parsed) {
        if (!isRecord(item)) continue
        panes.push({
            id: asNumber(item.id, -1),
            is_plugin: asBoolean(item.is_plugin),
            is_floating: asBoolean(item.is_floating),
            exited: asBoolean(item.exited),
            exit_status: asNullableNumber(item.exit_status),
            tab_id: asNumber(item.tab_id, -1),
            tab_name: asString(item.tab_name),
            attention: parseAttention(item.attention),
            program_status: parseProgramStatusList(item.program_status),
            command_state: parseCommandState(item.command_state),
        })
    }
    return panes
}

/** Index non-plugin live panes by their numeric terminal pane ID. */
export function indexLivePanesById(panes: readonly ZellijPaneJson[]): Map<number, ZellijPaneJson> {
    const byId = new Map<number, ZellijPaneJson>()
    for (const pane of panes) {
        if (!pane.is_plugin) byId.set(pane.id, pane)
    }
    return byId
}

/** Parse `zellij action list-tabs -a -j` output safely. Returns `[]` on empty, invalid, or non-array output. */
export function parseZellijTabsJson(raw: string): ZellijTabJson[] {
    if (!raw.trim()) return []
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return []
    }
    if (!Array.isArray(parsed)) return []

    const tabs: ZellijTabJson[] = []
    for (const item of parsed) {
        if (!isRecord(item)) continue
        tabs.push({
            position: asNumber(item.position),
            name: asString(item.name),
            active: asBoolean(item.active),
            tab_id: asNumber(item.tab_id, -1),
        })
    }
    return tabs
}
