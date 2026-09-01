---
name: rmux
description: Run persistent terminal sessions and automate terminal output with rmux, the tmux-compatible terminal multiplexer installed on this machine. Use it whenever a command is long-running (builds, test suites, dev servers, watches), needs to keep running across multiple shell invocations, runs an interactive TUI app (REPL, editor, another coding agent), or requires parallel terminal workers — instead of bare background bash plus sleep-and-grep polling. Trigger when the user says "run this in the background", "keep it running", "watch the logs/output", "start a dev server", "run these in parallel", or mentions sessions, panes, or tmux — even if they never say the word rmux.
---

# rmux — persistent, scriptable terminal sessions

`rmux` is a tmux-compatible terminal multiplexer (Rust daemon + CLI, ~90 tmux
commands). A daemon owns the PTY processes, so sessions survive between your
shell invocations: create a session in one tool call, drive it and read its
output in the next. Check the installed version with `rmux -V`; confirm exact
flags per command with `rmux list-commands COMMAND` (e.g.
`rmux list-commands send-keys`) — the surface follows tmux, but rmux adds
automation flags that `list-commands` does not enumerate, so when a flag
errors, test it once directly instead of assuming it is unsupported.

## When to use — and when not

Use rmux instead of background bash (`cmd &`, `nohup`) when:

- The command runs long enough that you would otherwise poll with `sleep` + grep.
- The process must keep running while you do other tool calls, or between turns.
- The process is interactive: REPLs, editors, TUIs, another agent in a pane.
- You need several parallel shells with isolated outputs.

Do not use rmux for quick commands that finish in seconds and print their
result directly — running `cargo build` via a session adds indirection for no
benefit. Run those directly.

## Core workflow

Create a detached session, sync on shell readiness, send a command with a
bounded wait, then read the output:

```bash
rmux new-session -d -s work
rmux wait-pane -t work --quiet --timeout 10s
rmux send-keys -t work --wait quiet --stable-for 500ms --timeout 2m -- 'cargo test' Enter
rmux capture-pane -t work -p
```

Why each part matters:

- `new-session -d -s NAME` creates a detached session owned by the daemon.
- `wait-pane --quiet` right after creation is NOT optional — see the
  fresh-session race below. It waits for the pane's shell to boot and its
  prompt to appear before you send anything.
- `--wait quiet` makes `send-keys` return only once output has settled — this
  replaces sleep-and-poll. The daemon does the waiting, not you.
- `--timeout 2m` bounds the wait so a hung command cannot block the call forever.
- `--` separates flags from the payload keys, so a payload word like `-v`
  cannot be parsed as a flag.
- `capture-pane -p` prints the pane's current visible text. Read it after any
  wait to see the actual result; do not assume success from the exit code alone.
- The session persists — send more commands to `-t work` in any later tool
  call, and the user can `rmux attach-session -t work` to take over.

## Robust alternative — the wait-for channel

When text matching is fragile (noisy output, marker would appear in the
command itself), use tmux-style channel signaling instead. It is immune to
both shell echo and old scrollback:

```bash
rmux send-keys -t work -- 'cargo test; rmux wait-for -S work-done' Enter
rmux wait-for work-done
```

The `-S` inside the pane signals the channel; the outer `wait-for` blocks
until it fires. Notes:

- `wait-for` has NO `--timeout` flag (it errors with "too many arguments") —
  it blocks indefinitely. Bound it from the calling shell:
  `timeout 60 rmux wait-for work-done`.
- It requires rmux to be inside the pane's `PATH` (true on this machine).
- Channel names are global to the daemon; prefix them with the session name
  to avoid collisions between parallel workers (`work-done`, not `done`).

## Wait modes on send-keys

Pick the wait that matches what "done" means for the command:

| Flag | Meaning | Use for |
|------|---------|---------|
| `--wait quiet` | output settles and stays quiet | builds, tests, any command with unknown final text — the default choice |
| `--wait-next-text TEXT` | TEXT appears in *new* output only | avoiding matches against old scrollback |
| `--wait-visible-text TEXT` | TEXT appears in rendered visible text | prompts/progress bars that repaint the screen |
| `--wait-pane-exit` | pane process exits | one-shot commands launched via `new-session`/`new-window` |
| (none) | returns immediately | fire-and-forget input, e.g. typing into a REPL |

Always pair any wait with `--timeout`.

## Reading and monitoring output

```bash
rmux capture-pane -t work -p                    # visible screen, plain text
rmux capture-pane -t work -p -S -100            # last 100 lines of scrollback
rmux wait-pane -t work --quiet --timeout 30s    # wait on an already-running pane
rmux stream-pane -t work --lines                # follow output as line events
rmux collect-pane-output -t work --until-pane-exit --max-bytes 1048576
```

`collect-pane-output` gathers a finished command's full output reliably;
`capture-pane` shows what is currently on screen.

## Managing sessions and panes

Same grammar as tmux; targets are `-t session:window.pane`:

```bash
rmux list-sessions
rmux split-window -h -t work                    # side-by-side split
rmux split-window -v -t work                    # stacked split
rmux list-panes -t work
rmux kill-session -t work
rmux kill-server                                # stop the daemon and all sessions
```

Name sessions for their purpose (`build`, `server`, `agent-1`), not `s1` —
you target them by name from later tool calls, and so can the user.

## Gotchas

All of these were verified live against rmux 0.10.0; treat them as real, not
theoretical.

- **Fresh-session race (the big one).** `new-session -d` returns *before* the
  pane's shell is spawned and reading input. Keys sent immediately can be
  lost, and `--wait quiet` cannot detect the loss because a silent pane is
  trivially "quiet" — the send appears to succeed and the capture comes back
  blank. Always run `rmux wait-pane -t NAME --quiet --timeout 10s` between
  `new-session` and the first `send-keys`. This is why the core workflow has
  that step.
- **Shell echo poisons text waits.** `--wait-text`/`--wait-next-text` observe
  raw PTY output, which includes the terminal echoing the command line you
  typed. If the marker string appears in the command itself, the wait matches
  the *echo* and returns before the command has even executed — exit 0, and
  the capture shows the echoed command instead of the result. Prefer
  `--wait quiet`, or use the wait-for channel, or pick a marker that never
  appears contiguously in the command text.
- **Killing the last session stops the daemon.** Verified: after
  `kill-session` on the final session, later commands fail with
  `no server running on /tmp/rmux-1000/default`. That is expected, not a bug —
  create a new session (which restarts the daemon) and continue.
- **`--` before the payload.** With any `--wait*` flag, put `--` between the
  flags and the keys, or a payload word like `-v` is parsed as a flag.
- **Daemon lifetime on Unix.** A daemon started from inside a shell that later
  gets recycled can die with it. When the session must outlive the current
  tool call's process group, start it detached: `setsid rmux new-session -d -s
  NAME`. `setsid` is Unix-only.
- **Version drift.** This machine installs rmux from nixpkgs unstable; the
  flag surface may differ from upstream docs you remember. `rmux
  list-commands COMMAND` is the source of truth for the tmux-compatible
  surface; automation flags are verified by running them.

## Beyond the CLI

- **Web Share**: `rmux web-share -t work --spectator-only` exposes a pane in
  the browser over an end-to-end encrypted WebSocket (spectator links are
  read-only, operator links can type). Requires explicit invocation — nothing
  is network-exposed by default.
- **SDKs** (`rmux-sdk` Rust / `librmux` Python / `@rmux/sdk` TypeScript) exist
  for programmatic automation with typed handles and structured snapshots.
  For agent work the CLI above is sufficient; reach for an SDK only when
  writing actual code that embeds terminal automation.
- **Claude Code launcher**: `rmux claude` starts Claude Code inside an rmux
  workspace with a private tmux shim. Claude-Code-specific; not relevant to pi.