---
name: zellij
description: Runs any command whose duration is long, unknown, or open-ended inside a Zellij tab instead of a single blocking, timeout-bound bash call — builds, installs, test suites, migrations, data/training jobs, servers, and watch/follow loops all fall into this by nature, not because of their specific names. Also drives interactive REPLs (python, ipython, node, lldb, gdb, sqlite3, etc.) and remote machines over ssh across multiple rounds of input/output. If pi is itself running inside a Zellij session, tasks land in a new, named tab of that same session so the user can watch live without their view being disrupted; otherwise a detached background session is used. Prefer this over raising a bash timeout when a command's runtime isn't confidently short, reach for this skill up front, not after a timeout failure.
license: MIT
---

# Zellij

Zellij is a terminal multiplexer, fully controllable from the command line
via `zellij action <subcommand>`. This skill treats it as a durable "task
backend": start something in its own named tab, keep doing other work, and
come back to read its output or feed it more input — without blocking a
tool call on it, and without a human needing to attach anything by hand.

## Use this instead of a bigger timeout

Don't respond to a bash command timing out by re-running it with a larger
number — that's a symptom, not a fix. The signal to act on is simpler than
any list of specific tools: **if you can't confidently say a command will
finish in well under a minute, or it's designed to keep running
indefinitely (a server, a watch/follow mode), start it in a tab instead of
guessing a timeout.** Builds, installs, test suites, migrations, data or
training jobs, and large network transfers tend to fall into this — not
because those particular words are magic, but because their actual runtime
is inherently variable and you usually can't know it in advance. Judge by
whether the duration is knowable and short, not by whether the command
matches a known pattern.

The upside isn't just "it won't get killed" — the command keeps running in
the background while you do other things, and you (or the user) can check
on it, or intervene, at any point without losing output.

## Also use this for

- Interactive REPLs that need several rounds of input
  (python/ipython/node, `lldb`/`gdb`, `sqlite3`, `psql`, a Rails/Django
  shell...).
- Controlling another machine over `ssh` where a single `ssh host "cmd"`
  call isn't enough because the session needs to stay open across several
  commands.
- Several of the above running at once (parallel builds, checking a
  handful of hosts).

## Mental model

- **One task = one tab, addressed by name — never a split pane.**
  `scripts/spawn.sh` always opens a brand-new tab, named whatever you give
  it (`"build"`, `"background"`, `"py"`, ...), whose sole pane *is* the
  command. No leftover idle pane splitting the view next to it.
- **Address everything by (session, tab name), not by numeric ID.** IDs
  captured in one command may not survive into your *next* tool call —
  don't rely on a `$PANE_ID` shell variable still being set later. Instead,
  every read/write/wait script here takes the tab's **name** and
  re-resolves its pane fresh, every time, via `scripts/pane-for-tab.sh`.
  The only things you need to remember across turns are two short strings:
  the session name and the tab name you chose — trivial to just restate.
  If two tasks ever share a name, the most recently created one wins; use
  distinct names (`"build-frontend"`, `"build-backend"`) to keep two things
  addressable at once.
- **Reuse the session you're already in, if there is one.** If pi is
  itself running inside a Zellij pane, `$ZELLIJ`/`$ZELLIJ_SESSION_NAME` are
  set. `scripts/current-or-new-session.sh` detects this and targets that
  same session, so a spawned task shows up as a tab right there in the
  user's own terminal — they can switch to it and watch, or start typing
  into it themselves. Only when pi is *not* nested in Zellij does it fall
  back to a separate detached background session.
- **Spawning a tab doesn't disrupt whatever the user is looking at.**
  Creating a tab does switch focus to it for a moment (Zellij has no
  "create in background" flag) — `spawn.sh` immediately jumps focus back to
  whatever tab was active before, so the net effect is invisible. The task
  keeps running regardless of which tab has focus; reading/writing by
  `--pane-id` never depends on focus either (verified: `dump-screen
  --pane-id` returns the target pane's real content even while a different
  tab is focused).
- **Never invoke bare `zellij`** (the interactive TUI) as a tool call —
  there's no terminal for it to attach to. Always go through the wrapper
  scripts below, or `zellij action ...` / `zellij --session <name> action
  ...` directly.

## Setup (once per environment)

```bash
zellij --version    # confirm it's installed; jq is also required by the scripts
```

The very first time Zellij ever creates a session on a machine (and again
right after a Zellij upgrade), it can pop up a "First Run Setup Wizard" or
"Release Notes" overlay as a focused floating pane in the default tab. It's
harmless to a named-tab workflow (it lives in the original tab, never in
one you create), but to avoid it entirely, dump a default config once:

```bash
mkdir -p ~/.config/zellij && zellij setup --dump-config > ~/.config/zellij/config.kdl
```

No session needs to be created ahead of time otherwise —
`current-or-new-session.sh` handles that (or reuses what's already there).

## A note on shells

Some tool runners execute commands via `/bin/sh` (`dash`) rather than
`bash`, which doesn't support bash-only syntax like `<<<` here-strings,
`[[ ]]`, or arrays. Every script in this skill has a `#!/usr/bin/env bash`
shebang, so calling them directly (`scripts/spawn.sh ...`) always runs
correctly under real bash no matter which shell invoked it — the loader
honors the shebang. What's *not* safe is typing bash-only syntax straight
into a raw multi-line command yourself; if you need to combine steps
inline, stick to the recipes below (they call the scripts directly and use
plain `$(...)` command substitution, no here-strings or arrays).

## Recipe: background / long-running task

```bash
SESSION=$(scripts/current-or-new-session.sh)
scripts/spawn.sh "$SESSION" "build" -- docker compose build
```

If pi is running nested inside Zellij, that's it — the build is now
visibly running in a tab named "build" in the user's terminal, and their
own view hasn't moved.

Read its output — any time, from any later call, using only the name:

```bash
scripts/read.sh "$SESSION" "build"          # current viewport
scripts/read.sh "$SESSION" "build" --full   # plus scrollback
```

Wait for a one-shot command to finish and grab its final output:

```bash
scripts/wait-exit.sh "$SESSION" "build"     # blocks until it exits, prints final screen
```

To keep working without blocking, poll `read.sh` periodically, or stream
changes live:

```bash
PANE_ID=$(scripts/pane-for-tab.sh "$SESSION" "build")
zellij --session "$SESSION" subscribe --pane-id "$PANE_ID" --format json \
  | jq --unbuffered 'select(.event=="pane_update") | .viewport[] | select(test("ERROR"))'
```

For pipeline-style steps where intervention-and-retry is wanted, use the
blocking flags directly instead of polling:

```bash
zellij --session "$SESSION" action new-tab --name "build" --block-until-exit-success -- make build
# on failure the tab stays open showing the error; retry by simulating Enter in it:
scripts/send.sh "$SESSION" "build" ""
```

## Recipe: driving a REPL (python, ipython, node, lldb, gdb, sqlite3, ...)

```bash
SESSION=$(scripts/current-or-new-session.sh)
scripts/spawn.sh "$SESSION" "py" -- python3 -i
scripts/send.sh "$SESSION" "py" "import pandas as pd"
scripts/send.sh "$SESSION" "py" "df = pd.read_csv('data.csv'); df.head()"
scripts/read.sh "$SESSION" "py"
```

A REPL never "exits", so exit-status polling doesn't apply — wait for a
marker to reappear instead:

- **Wait for the prompt itself** (`>>>`, `In [`, `(lldb)`, `(gdb)`,
  `sqlite>`...): `scripts/wait-for.sh "$SESSION" "py" '>>>'`
- **Wait for a unique sentinel** (more robust when the prompt text is
  ambiguous or output is multi-line): echo it after the real input where
  the REPL supports it, then
  `scripts/wait-for.sh "$SESSION" "py" "TASK_DONE_$$"`.

## Recipe: controlling a remote machine over SSH

```bash
SESSION=$(scripts/current-or-new-session.sh)
scripts/spawn.sh "$SESSION" "remote" -- ssh user@host
scripts/wait-for.sh "$SESSION" "remote" '\$\s*$'      # wait for a shell prompt
scripts/send.sh "$SESSION" "remote" "systemctl status myservice; echo TASK_DONE_$$"
scripts/wait-for.sh "$SESSION" "remote" "TASK_DONE_\$\$"
```

Notes:

- Prefer key-based auth so no interactive password prompt ever appears. If
  a host-key or password prompt is unavoidable, poll for the literal prompt
  text (`"(yes/no)"`, `"password:"`) with `wait-for.sh` before answering —
  never guess timing. Do not hardcode secrets in scripts; read them from an
  environment variable the user has already set.
- Because it's a real tab, a human can take over at any point — switch to
  it and type directly, then hand back to the agent later.
- To control several hosts in parallel, spawn one named tab per host
  (`"remote-web1"`, `"remote-db1"`, ...) and `send.sh` to each
  independently.

## Cleanup

```bash
scripts/close.sh "$SESSION" "build"
zellij kill-session "$SESSION"          # only if you created a separate background session
zellij delete-session "$SESSION"        # and forget its resurrection metadata
zellij list-sessions --short            # sanity check before assuming a clean slate
```

Don't call `kill-session`/`delete-session` on a session pi didn't create
itself (i.e. the one it's nested inside) — that's the user's terminal.

## Helper scripts

- `scripts/current-or-new-session.sh [fallback-name] [fallback-layout]` —
  the default entry point: reuses the session pi is nested in if there is
  one, otherwise ensures a detached background session.
- `scripts/background-session.sh <name> [layout]` — force a separate
  detached session even when nested (for a task that must outlive the
  user's current terminal).
- `scripts/spawn.sh <session> <tab-name> -- <command...>` — start a task as
  its own named tab; restores prior focus afterward; prints
  `"<tab-id> <pane-id>"` for immediate same-call use (not needed for later
  calls — use the name).
- `scripts/pane-for-tab.sh <session> <tab-name>` — resolve a tab's current
  pane id fresh, by name. What every script below uses internally.
- `scripts/read.sh <session> <tab-name> [--full] [--ansi]` — print a tab's
  current output.
- `scripts/send.sh <session> <tab-name> "<text>"` — paste text then press
  Enter.
- `scripts/wait-for.sh <session> <tab-name> <grep-ere-pattern> [timeout] [interval]`
  — poll until the pattern matches; prints the final screen.
- `scripts/wait-exit.sh <session> <tab-name> [timeout] [interval]` — poll
  until the tab's command has exited; prints the final full screen.
- `scripts/close.sh <session> <tab-name>` — close a tab by name.

All scripts require `jq`.

## Gotchas

- `paste`/`send-keys` go through the pane's own shell/REPL and are subject
  to its quoting rules. When only one command will ever run in a tab,
  `spawn.sh` already runs it as the tab's own process (not typed into a
  shell) — fewer escaping bugs, and exit status / `--block-until-*` flags
  work.
- `read.sh` (`dump-screen`) returns only the current viewport unless
  `--full` is given.
- Two writers sending input to the same tab at the same time interleave
  unpredictably. Route all writes to a given tab through one calling
  context.
- If `$ZELLIJ`/`$ZELLIJ_SESSION_NAME` aren't visible even though pi is
  visibly running inside Zellij (some sandboxes strip environment
  variables from tool subprocesses), `current-or-new-session.sh` falls back
  to a background session instead of reusing the visible one. If that
  happens, ask the user for `echo $ZELLIJ_SESSION_NAME` once and pass it
  explicitly as the fallback name.

See `references/cli-reference.md` for the fuller action catalogue.
