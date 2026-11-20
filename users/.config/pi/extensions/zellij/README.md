# Zellij Pi Extension

This extension connects one Pi session to one Zellij session and maps Pi workloads to native Zellij tabs and panes. It
replaces polling shell scripts with event-driven `followUp` turns and live UI widgets.

## Requirements

- `zellij` `>= 0.45.0` in `PATH` (tested with `zellij 0.46.0`)
- `script` (from `util-linux`) in `PATH` when Pi starts outside Zellij so headless tabs can initialize
- `bash` and `tee` in `PATH`

If `zellij` is missing or older than `0.45.0`, the extension sets a status notice and disables itself. Child `pi`
subagents started with `PI_ZELLIJ_SUBAGENT=1` also skip loading this extension. Wrapped commands (`zellij_run`,
`zellij_service`, `zellij_subagent`, and `zellij_repl` with a command) export the host `pi` process `PATH` so tools from
Nix or `devenv` remain available inside Zellij panes.

## Session Mapping

- **Inside Zellij (`ZELLIJ_SESSION_NAME` is set)**: The extension attaches to the host Zellij session and leaves it
  untouched on shutdown.
- **Outside Zellij**: On first tool call, the extension starts a detached background session named
  `pi-<cwd>-<shortSessionId>` via `zellij attach --create-background` and shows the `zellij attach <name>` command in
  the Pi status bar. On `quit`, empty managed sessions with no running panes are killed and deleted automatically; if
  background services or tasks are still running, the session stays alive.

State for tracked panes is saved in the Pi session branch (`zellij-state`) and reconciled against live panes on
`/reload` or resume. Forked sessions (`reason === "fork"`) start with a clean pane set and a new managed session.

## Scenario Topology

| Workload                                   | Tool              | Default Structure               | Lifecycle                                                                                              |
| :----------------------------------------- | :---------------- | :------------------------------ | :----------------------------------------------------------------------------------------------------- |
| Long task (`build`, `test`, `lint`)        | `zellij_run`      | `tasks` tab, `stacked` panes    | Waits briefly (`8s` default), then runs in background and pushes a `followUp` turn on exit or prompt.  |
| Background task or one-shot subagent wait  | `zellij_wait`     | Tracked panes, no new pane      | Event-driven `all`/`any` wait; no sleep polling, returns early on input, and `Esc` cancels it.         |
| Background service (`dev` server, watcher) | `zellij_service`  | `services` tab, `stacked` panes | Optional `readyPattern` wait via `zellij subscribe --format json`; pushes a `followUp` alert on crash. |
| Subagent (isolated `pi` run)               | `zellij_subagent` | `agents` tab, `stacked` panes   | Supports `one-shot` (`pi -p`) and `rpc` (`pi --mode rpc`) with read-only default tools.                |
| Interactive terminal or REPL               | `zellij_repl`     | Active tab, `floating` pane     | Opens a floating pane (`10%`, `10%`, `80%`, `80%` by default) for direct user input.                   |

## Pane Lifecycle, Display, and Inbox

- **Auto-reap and log retention**: After completion handling (`notifiedCompletion === true`), every exited pane closes
  automatically on `agent_settled` or before spawning a new pane in `spawnInTopology`, regardless of kind or exit code.
  Logs and briefs stay available through the bounded 8-entry recent-pane registry; when an entry is evicted, its log and
  brief files are deleted. `zellij_pane` `close`/`sweep` and `zellij_service` `stop` also retain finished-pane logs
  while the pane remains queryable. The runtime directory is removed on `session_shutdown` when `reason === "quit"` and
  no tracked panes remain. Panes that are not yet notified or whose close fails remain tracked for a later retry; older
  notified exited panes are pruned beyond `MAX_KEPT_EXITED_PANES = 2` on later passes.
- **ASCII UI widget and status bar**: The `zellij` status bar and the `zellij-panes` widget above the editor use
  printable ASCII characters only (`0x20` to `0x7E`), such as `[run 12s] task:name | <last output line>`,
  `[input 5s] ...`, and `[err:1 8s] ...`. The `zellij-panes` widget hides automatically when only `exitCode === 0` panes
  or exited `repl` panes remain.
- **Zellij inbox notifications**: `zellij_run` and `zellij_subagent` (`mode="one-shot"`) pass `--notify`, while
  `zellij_service`, `zellij_subagent` (`mode="rpc"`), and `zellij_repl` omit `--notify`. Clean pane exits
  (`exitCode === 0`), auto-reap closes, and `zellij_pane` `send` or `keys` actions run `zellij action mark-pane-seen`.
  Interactive prompt detection (`needs_attention`) sends `zellij prompt notify --no-pane-name --no-tab-name` when a user
  client is attached.

## Tools and Commands

- `zellij_run`: Run a command in a managed pane (`layout`: `stacked`, `split`, `floating`, or `tab`).
- `zellij_wait`: Wait for running task and one-shot subagent panes without sleep polling. Call it in a later tool batch
  after the start calls return `status: running`. `panes` selects explicit pane IDs or names; when omitted, the tool
  selects all running `task` panes and one-shot `agent` panes, and skips `service`, `repl`, and RPC subagent panes.
  `mode: "all"` (default) waits for every target and returns early on an input prompt; `mode: "any"` returns after the
  first exit or prompt. `timeoutSeconds` defaults to `300` (range `1-600`). Results include `completed`,
  `needs_attention`, `timeout`, `aborted`, or `no_running_panes` plus each pane's status, exit code, log path, and
  output tail. The wait suppresses duplicate `zellij-event` follow-ups while active, then releases panes that are still
  running so later exits still notify; `Esc` aborts the wait cleanly. Recently finished panes stay queryable for a
  bounded number of entries; otherwise read the `logPath` from the earlier completion result.
- `zellij_service`: Manage persistent services with `start`, `stop`, `status`, and `logs`. Note: `readyPattern` rejects
  nested quantifiers (`(\w+)+` style) with a static heuristic to prevent catastrophic regex backtracking.
- `zellij_subagent`: Delegate a self-contained prompt to a child `pi` instance.
- `zellij_repl`: Open a floating shell, REPL, `ssh` session, or debugger.
- `zellij_pane`: Run `list`, `read`, `send`, `keys`, `focus`, `float`, `close`, or `sweep` on tracked panes.
- `/zellij [status|sweep|attach]`: Interactive pane menu and session utilities in Pi TUI.

## Bash Guard

A `tool_call` hook blocks unquoted `nohup`, `disown`, `setsid`, `tmux`, `screen`, background `&` jobs, `while ... sleep`
loops, and unsafe global `zellij` commands inside `bash`, directing the model to the `zellij_*` tools instead.
