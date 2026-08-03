---
name: boo
description: Drive interactive terminal programs programmatically with boo sessions — start headless PTY sessions, type text/keys into them, wait for screen text or idle output, and read the rendered screen as text or JSON. Use whenever you need to automate REPLs (python, node, psql, sqlite3, gdb, lldb), TUI or full-screen programs (vim, htop, k9s, lazygit, menu installers), answer interactive prompts, interrupt programs with C-c, or run long builds/tests/dev servers in the background and check them later — even if the user never names boo and only asks to run an interactive command, keep a program alive across steps, or watch terminal output. Requires the boo CLI (a GNU screen-style multiplexer on libghostty).
---

# boo — terminal session automation

boo is a GNU screen-style terminal multiplexer. Each session is a real
PTY whose full screen state (contents, styles, cursor, scrollback,
title) is maintained by libghostty, so `peek` returns the rendered
screen exactly as a human would see it — not a raw byte log full of
ANSI escapes.

Everything except `attach` and `ui` works without a TTY, which makes
boo the right tool for driving interactive programs from an agent:
things a plain shell tool cannot do (TUI apps, prompts, REPL state,
deterministic waits) all become scriptable.

## Setup

Verify boo is installed:

```sh
boo version
```

If missing (Linux/macOS), install it and re-check:

```sh
curl -fsSL https://raw.githubusercontent.com/coder/boo/main/install.sh | sh
```

## The canonical loop

```sh
boo new build -d -- bash               # 1. headless session (prints its name)
boo send build --text 'make' --enter   # 2. type into it
boo wait build --idle                  # 3. let output settle
boo peek build                         # 4. read the screen
boo kill build                         # 5. clean up
```

Three rules make this loop reliable:

- **Always create sessions with `-d`.** Plain `boo new` attaches
  immediately and blocks forever — there is no human at the keyboard.
  For the same reason, never call `attach` or `ui` from a script.
- **Prefer driving a shell** (`-- bash`, or the default `$SHELL`)
  instead of running the target command directly. A session ends when
  its command exits; after that `send`/`wait`/`peek` fail with exit 3
  and the output is unrecoverable. A shell stays alive, keeps state
  (cwd, env, REPL variables), and lets you run follow-ups.
- **Always `kill` sessions when done.** Sessions outlive your commands;
  leftovers leak processes. Audit with `boo ls --json`.

## Command reference

Commands taking a name accept any unique prefix of it (`boo peek bu`
for "build"). Session names may contain letters, digits, `.`, `_`, `-`.

### new — create a session

```sh
boo new [name] -d [--rows N] [--cols N] [--cwd DIR] [-- cmd...]
```

`-d` starts detached and prints the session name on stdout. Default
cmd is `$SHELL`; default size is 80x24 (TUIs that lay out for 80
columns may need `--cols`). `--cwd` must point to an existing
directory.

### send — type into a session

```sh
boo send <name> --text 'make test' --enter   # text, then Enter
boo send <name> --key C-c                    # named control keys
printf 'y\n' | boo send <name>               # bytes from stdin (binary safe)
```

`--text` is literal: no escape processing, no implicit newline — you
must add `--enter` to submit. `--key` takes a comma-separated list of
`Enter, Tab, Escape, Space, Backspace, Up, Down, Left, Right, Home,
End, C-a..C-z` and **cannot be combined with `--text`**; use two calls.
For multiline input, write a script file and execute it inside the
session rather than fighting quoting layers.

### wait — block until something happens (replaces sleep loops)

```sh
boo wait <name> --text 'PASS' --timeout 2m   # screen contains text
boo wait <name> --idle --timeout 5m          # output quiet for 2s
```

Durations: `500ms`, `2s`, `1m`, `4h`, `1d`. **Default timeout is 30s**
— always pass `--timeout` for builds/tests. Timeout exits with code 4;
treat that as "still running or stuck", then `peek` to see which.

### peek — read the rendered screen

```sh
boo peek <name>                    # visible screen, as a human sees it
boo peek <name> --scrollback       # plus history
boo peek <name> --json             # {"session","title","rows","cols","cursor":{"row","col"},"screen"}
```

Screens are small but scrollback can be huge — pipe through
`tail -50` or `grep -n error` to keep context size under control.

### ls — audit sessions

```sh
boo ls --json   # [{"name","attached","idle_ms","unread","bell_idle_ms","title"}]
```

`idle_ms` grows when a session goes quiet; `unread` flags output you
have not peeked at. Use it to monitor several background tasks at once.

### kill / rename

```sh
boo kill <name>     # SIGHUP the process, daemon exits
boo kill --all      # end every session
boo rename old new
```

### Exit codes

`0` success · `1` error · `2` usage error · `3` no such session ·
`4` wait timed out

## Patterns

**REPL (python, node, psql, sqlite3, gdb):** start `boo new py -d --
python3`, then loop: `send --text '<expr>' --enter` → `wait --text
'>>>'` → `peek | tail -20`. Interpreter state persists across steps, so
exploratory work (load data, inspect, refine) works like a human at the
keyboard. Use the prompt string as the `--text` target; it is a more
reliable sync point than `--idle` for chatty REPLs.

**Long build/test/deploy:** `boo new build -d -- bash`, send the
command, `wait --text 'Build finished' --timeout 30m` (or `--idle`),
then `peek --scrollback | grep -n -i error` on failure. The task keeps
running while you do other work; check back with `ls --json`.

**TUI navigation (htop, k9s, lazygit, menu installers):** loop `peek`
→ decide → `send --key Down,Down,Enter`. The screen you get is fully
rendered, so menus and dialogs are readable as plain text.

**Interactive prompts:** `wait --text '[y/N]'` → `send --text y
--enter`. Works for ssh confirmations, package-manager prompts, and
password fields (feed secrets via stdin mode, not the command line, so
they stay out of logs).

**Interrupt / unstuck:** `send --key C-c` (or `C-d`, `C-\`) — the
program receives the real signal via the PTY.

## Gotchas

- **`wait --text` matches only the visible screen, not scrollback.** If
  the marker text can scroll past before you wait, wait early, make the
  window taller (`--rows` at `new`), or fall back to `--idle`.
- **`--idle` means 2 seconds of silence, not "finished".** A
  quiet-but-running process (downloads, GC pauses) looks idle. For
  completion, prefer `wait --text` on a real end marker when one
  exists.
- **A session whose command exits is gone (exit 3).** `boo new -d`
  prints the name and succeeds even if the command fails instantly
  (e.g. binary not found) — the daemon dies with its child, and the
  next `send`/`peek` reports exit 3. Don't `peek` after the process
  completed expecting output; drive a shell from the start, or check
  `boo ls` first when the command might not exist.
- **`send --text` sends no newline.** Forgetting `--enter` leaves the
  command typed but unsubmitted, and the next `wait` hangs until its
  timeout.
- **Timed-out `wait` (exit 4) is not a failure of the task** — the task
  may still be running. `peek` before deciding to kill.
- **One session per task, with unique descriptive names.** Sessions are
  cheap; unique names keep prefix matching and `ls` output unambiguous,
  and parallel tasks stay isolated.
- **Sessions run with `TERM=xterm-256color`.** Programs that probe for
  other terminal types may behave slightly differently than on the host
  terminal.
- **NUL bytes cannot be sent** via stdin mode; everything else is
  binary safe.
- **Debugging boo itself:** `BOO_LOG=/tmp/boo.log boo ...` appends
  daemon logs; `BOO_DIR` overrides the socket directory (useful to
  isolate a test run from real sessions).
