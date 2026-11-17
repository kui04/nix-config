export type PaneKind = "task" | "service" | "agent" | "repl"

export type LayoutMode = "stacked" | "split" | "floating" | "tab"

export type SplitDirection = "right" | "down"

export type PaneStatus = "running" | "exited" | "closed"

export type SubagentMode = "one-shot" | "rpc"

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
    subagentMode?: SubagentMode
    modelLabel?: string
    startedAt: number
    endedAt?: number
    status: PaneStatus
    exitCode?: number | null
    notifiedCompletion?: boolean
    lastAttentionSignature?: string
}

export interface PersistedZellijState {
    sessionName: string
    managedSession: boolean
    panes: TrackedPane[]
}

export interface ZellijAttentionDetail {
    kind: string | null
    progress: number | null
    app: string | null
    title: string | null
    body: string | null
    exit_code: number | null
    duration_ms: number | null
    command: string | null
}

export interface ZellijAttention {
    status: string
    source: string | null
    text: string
    detail?: ZellijAttentionDetail
    since_ms: number
    changed_ms: number
    seen: boolean
    muted: boolean | null
    ignore_output: boolean
    watched: boolean
    from_watch: boolean
}

export interface ZellijProgramStatus {
    id: string | null
    state: string
    kind: string | null
    progress: number | null
    app: string | null
    title: string | null
    msg: string | null
    updated_ms: number
}

export interface ZellijPaneJson {
    id: number
    is_plugin: boolean
    is_focused: boolean
    is_floating: boolean
    is_suppressed: boolean
    is_collapsed: boolean
    title: string
    exited: boolean
    exit_status: number | null
    is_held: boolean
    pane_x: number
    pane_y: number
    pane_rows: number
    pane_columns: number
    cursor_coordinates_in_pane: [number, number] | null
    tab_id: number
    tab_position: number
    tab_name: string
    pane_command: string | null
    pane_cwd: string | null
    attention?: ZellijAttention
    program_status?: ZellijProgramStatus[]
}

export interface ZellijTabJson {
    position: number
    name: string
    active: boolean
    tab_id: number
    selectable_tiled_panes_count: number
    selectable_floating_panes_count: number
    are_floating_panes_visible: boolean
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

function parseCursor(value: unknown): [number, number] | null {
    if (!Array.isArray(value) || value.length < 2) return null
    const items: unknown[] = value
    const x = items[0]
    const y = items[1]
    if (
        typeof x === "number" &&
        Number.isFinite(x) &&
        typeof y === "number" &&
        Number.isFinite(y)
    ) {
        return [x, y]
    }
    return null
}

function parseAttention(value: unknown): ZellijAttention | undefined {
    if (!isRecord(value)) return undefined
    const detailRaw = value.detail
    const detail: ZellijAttentionDetail | undefined = isRecord(detailRaw)
        ? {
              kind: asNullableString(detailRaw.kind),
              progress: asNullableNumber(detailRaw.progress),
              app: asNullableString(detailRaw.app),
              title: asNullableString(detailRaw.title),
              body: asNullableString(detailRaw.body),
              exit_code: asNullableNumber(detailRaw.exit_code),
              duration_ms: asNullableNumber(detailRaw.duration_ms),
              command: asNullableString(detailRaw.command),
          }
        : undefined
    return {
        status: asString(value.status, "Idle"),
        source: asNullableString(value.source),
        text: asString(value.text),
        detail,
        since_ms: asNumber(value.since_ms),
        changed_ms: asNumber(value.changed_ms),
        seen: asBoolean(value.seen),
        muted: typeof value.muted === "boolean" ? value.muted : null,
        ignore_output: asBoolean(value.ignore_output),
        watched: asBoolean(value.watched),
        from_watch: asBoolean(value.from_watch),
    }
}

function parseProgramStatusList(value: unknown): ZellijProgramStatus[] | undefined {
    if (!Array.isArray(value)) return undefined
    const result: ZellijProgramStatus[] = []
    for (const item of value) {
        if (!isRecord(item)) continue
        result.push({
            id: asNullableString(item.id),
            state: asString(item.state),
            kind: asNullableString(item.kind),
            progress: asNullableNumber(item.progress),
            app: asNullableString(item.app),
            title: asNullableString(item.title),
            msg: asNullableString(item.msg),
            updated_ms: asNumber(item.updated_ms),
        })
    }
    return result
}

/** Parse `zellij action list-panes -a -j` output safely. Returns `[]` on empty or non-array output. */
export function parseZellijPanesJson(raw: string): ZellijPaneJson[] {
    if (!raw.trim()) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const panes: ZellijPaneJson[] = []
    for (const item of parsed) {
        if (!isRecord(item)) continue
        panes.push({
            id: asNumber(item.id, -1),
            is_plugin: asBoolean(item.is_plugin),
            is_focused: asBoolean(item.is_focused),
            is_floating: asBoolean(item.is_floating),
            is_suppressed: asBoolean(item.is_suppressed),
            is_collapsed: asBoolean(item.is_collapsed),
            title: asString(item.title),
            exited: asBoolean(item.exited),
            exit_status: asNullableNumber(item.exit_status),
            is_held: asBoolean(item.is_held),
            pane_x: asNumber(item.pane_x),
            pane_y: asNumber(item.pane_y),
            pane_rows: asNumber(item.pane_rows),
            pane_columns: asNumber(item.pane_columns),
            cursor_coordinates_in_pane: parseCursor(item.cursor_coordinates_in_pane),
            tab_id: asNumber(item.tab_id, -1),
            tab_position: asNumber(item.tab_position),
            tab_name: asString(item.tab_name),
            pane_command: asNullableString(item.pane_command),
            pane_cwd: asNullableString(item.pane_cwd),
            attention: parseAttention(item.attention),
            program_status: parseProgramStatusList(item.program_status),
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

/** Parse `zellij action list-tabs -a -j` output safely. Returns `[]` on empty or non-array output. */
export function parseZellijTabsJson(raw: string): ZellijTabJson[] {
    if (!raw.trim()) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const tabs: ZellijTabJson[] = []
    for (const item of parsed) {
        if (!isRecord(item)) continue
        tabs.push({
            position: asNumber(item.position),
            name: asString(item.name),
            active: asBoolean(item.active),
            tab_id: asNumber(item.tab_id, -1),
            selectable_tiled_panes_count: asNumber(item.selectable_tiled_panes_count),
            selectable_floating_panes_count: asNumber(item.selectable_floating_panes_count),
            are_floating_panes_visible: asBoolean(item.are_floating_panes_visible),
        })
    }
    return tabs
}
