---
name: zellij
description: Drives the Zellij terminal multiplexer to run long-lived and background tasks, control interactive REPLs (python, ipython, node, lldb, gdb, sqlite3, etc.), and operate other machines over SSH, all from non-interactive commands instead of a single blocking shell call. Use whenever work must keep running after this turn ends, needs several rounds of interactive input/output, or drives a shell/REPL on a remote host through ssh. Do not use it for a one-shot command that finishes immediately on its own.
license: MIT
---

# Zellij Tasks

Zellij is a terminal multiplexer. Every one of its features is reachable from
the command line via `zellij action <subcommand>`, so it can be driven
entirely by scripted commands with no human ever attaching to it. This skill
treats Zellij as a durable "task backend": start something in a pane, keep
going with other work, and come back to check on it or feed it more input.

## When to use this

- A task will outlive this turn (dev server, watch/build loop, long
  training/indexing job, `tail -f`, a monitor).
- A task needs an open interactive process fed with several rounds of input
  (a Python/IPython/Node REPL, `lldb`/`gdb`, `sqlite3`, `psql`, a Rails/Django
  shell...).
- A task means controlling another machine over `ssh` — running commands,
  reading results, handling a follow-up prompt — where a single `ssh host
  "cmd"` call isn't enough because the session needs to stay open.
- Several of the above need to happen at once (parallel builds, checking a
  handful of hosts).

Skip this for anything that finishes in one shot — just run it directly.

## Mental model

- **One Zellij session per project/task context.** Create it once with
  `zellij attach --create-background <name>` and reuse it across every later
  command in this conversation (and even across separate turns, since the
  session keeps running in the background independent of this agent process).
- **One pane per task.** Pane- and tab-creating commands print the created
  ID (`terminal_N`) to stdout — capture it and address that pane directly
  with `--pane-id` from then on. Never rely on "whatever pane currently has
  focus"; there is no human moving focus around.
- **Three primitives cover everything:**
  1. **Launch** — start the pane's own process directly:
     `new-pane -- <command>`. Best when there is exactly one command to run,
     because it sidesteps shell-quoting entirely and its exit status becomes
     queryable/blockable.
  2. **Feed** — send text into a pane that is already running a shell or a
     REPL: `action paste --pane-id <id> "<text>"` followed by
     `action send-keys --pane-id <id> "Enter"` (`paste` alone does not press
     Enter).
  3. **Read** — `action dump-screen --pane-id <id>` for a one-shot snapshot
     of the current viewport (`--full` for scrollback too), or
     `zellij subscribe --pane-id <id> --format json` to stream changes live.
- **Never invoke bare `zellij`** (the interactive TUI) as a tool call — there
  is no terminal for it to attach to. Always go through
  `zellij attach --create-background` to create/ensure a session, and
  `zellij action ...` / `zellij --session <name> action ...` to control it.

## Setup (once per environment)

```bash
zellij --version    # confirm it's installed
```

Pick one session name per logical project/task and stick to it, e.g.
`pi-$(basename "$PWD")`. `scripts/session.sh` creates it if missing and is a
no-op if it's already running, so it's safe to call at the start of every
recipe below.

## Recipe: background / long-running task

```bash
SESSION=$(scripts/session.sh pi-myproject)
PANE=$(zellij --session "$SESSION" action new-pane --name "build" -- npm run build:watch)
```

To just wait for a one-shot command to finish and grab its output:

```bash
PANE=$(zellij --session "$SESSION" action new-pane --name "tests" -- pytest -q)
scripts/wait-exit.sh "$SESSION" "$PANE"     # blocks until it exits, prints final screen
```

For pipeline-style steps where a human (or the agent, in a later turn) may
need to intervene and retry, use the blocking flags instead of polling:

```bash
zellij --session "$SESSION" action new-pane --block-until-exit-success -- make build
# on failure the pane stays open showing the error; retry by simulating Enter:
zellij --session "$SESSION" action send-keys --pane-id "$PANE" "Enter"
```

To keep monitoring without blocking, poll or stream:

```bash
zellij --session "$SESSION" action dump-screen --pane-id "$PANE"          # snapshot
zellij --session "$SESSION" subscribe --pane-id "$PANE" --format json \
  | jq --unbuffered 'select(.event=="pane_update") | .viewport[] | select(test("ERROR"))'
```

## Recipe: driving a REPL (python, ipython, node, lldb, gdb, sqlite3, ...)

Launch the REPL as the pane's own process (not "open a shell, then type
`python3`") so there's no ambiguity about what's running:

```bash
PANE=$(zellij --session "$SESSION" action new-pane --name "py" -- python3 -i)
scripts/send.sh "$SESSION" "$PANE" "import pandas as pd"
scripts/send.sh "$SESSION" "$PANE" "df = pd.read_csv('data.csv'); df.head()"
zellij --session "$SESSION" action dump-screen --pane-id "$PANE"
```

A REPL never "exits", so exit-status polling doesn't apply — instead wait
for a marker to reappear. Two options:

- **Wait for the prompt itself** (`>>>`, `In [`, `(lldb)`, `(gdb)`, `sqlite>`
  ...): `scripts/wait-for.sh "$SESSION" "$PANE" '>>>'`
- **Wait for a unique sentinel** (more robust, works even when the prompt
  text is ambiguous or the REPL echoes multi-line output): append it to the
  command itself where the REPL supports it, e.g. for a shell pane,
  `echo "$cmd"; echo TASK_DONE_$$`, then
  `scripts/wait-for.sh "$SESSION" "$PANE" "TASK_DONE_$$"`.

Same pattern for a debugger:

```bash
PANE=$(zellij --session "$SESSION" action new-pane --name "dbg" -- lldb ./a.out)
scripts/send.sh "$SESSION" "$PANE" "b main"
scripts/send.sh "$SESSION" "$PANE" "run"
scripts/wait-for.sh "$SESSION" "$PANE" '\(lldb\)'
```

## Recipe: controlling a remote machine over SSH

Launch `ssh` as the pane's process so a dropped connection is reflected in
the pane's exit status, then feed it commands the same way as a REPL:

```bash
PANE=$(zellij --session "$SESSION" action new-pane --name "remote" -- ssh user@host)
scripts/wait-for.sh "$SESSION" "$PANE" '\$\s*$'      # wait for a shell prompt
scripts/send.sh "$SESSION" "$PANE" "systemctl status myservice; echo TASK_DONE_$$"
scripts/wait-for.sh "$SESSION" "$PANE" "TASK_DONE_\$\$"
```

Notes:

- Prefer key-based auth so no interactive password prompt ever appears. If a
  host-key or password prompt is unavoidable, poll for the literal prompt
  text (`"(yes/no)"`, `"password:"`) with `wait-for.sh` before answering —
  never guess timing. Do not hardcode secrets in scripts; read them from an
  environment variable the user has already set.
- To control several hosts in parallel, open one pane per host and issue
  `paste` to each independently, then `wait` on the shell jobs. `zellij
  action toggle-active-sync-tab` broadcasts identical keystrokes to every
  pane in a tab — useful for literally identical fleet-wide commands (e.g.
  `uptime`), unsafe for anything host-specific.

## Cleanup

```bash
zellij --session "$SESSION" action close-pane --pane-id "$PANE"
zellij kill-session "$SESSION"        # stop it
zellij delete-session "$SESSION"      # and forget its resurrection metadata
zellij list-sessions --short          # sanity check before assuming a clean slate
```

## Helper scripts

- `scripts/session.sh <name> [layout]` — ensure a background session exists.
- `scripts/send.sh <session> <pane-id> "<text>"` — paste text then press Enter.
- `scripts/wait-for.sh <session> <pane-id> <grep-ere-pattern> [timeout] [interval]`
  — poll `dump-screen` until the pattern matches; prints the final screen.
- `scripts/wait-exit.sh <session> <pane-id> [timeout] [interval]` — poll
  `list-panes --json` until the pane has exited; prints the final full
  screen. Requires `jq`.

## Gotchas

- `paste`/`send-keys`/`write-chars` go through the pane's own shell and are
  subject to its quoting rules. When only one command will ever run in a
  pane, prefer passing it directly as `new-pane -- <command>` instead —
  fewer escaping bugs, and it makes exit status and the `--block-until-*`
  flags available.
- `dump-screen` returns only the current viewport unless `--full` is given.
- Two writers sending input to the same pane at the same time interleave
  unpredictably. Route all writes to a given pane through one calling
  context.
- Always pass `--session` and `--pane-id`/`--tab-id` explicitly in scripts;
  never depend on "current focus" or "current session".

See `references/cli-reference.md` for the fuller action catalogue —
querying session/pane/tab state as JSON, floating panes, layouts, and
inline KDL layouts.
