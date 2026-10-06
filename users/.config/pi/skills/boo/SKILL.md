---
name: boo
description: >-
  Run and drive terminal programs headlessly with the boo terminal multiplexer: REPLs (python, nix repl, psql, ghci),
  TUIs, prompt-driven wizards and installers, dev servers, watchers, long-running builds and tests, and nested agents.
  Use it instead of a long timeout wrapper, a sleep-and-poll loop, or a background job with log tailing whenever a
  command will run for more than about a minute, needs a TTY or asks questions (y/n, credentials, menus), needs state
  across separate tool calls (persistent REPL, nix develop shell), or must keep running to be checked on later. Trigger
  even when the user never says boo - interactive, it prompts for confirmation, keep a session open, run it in the
  background and check on it later, drive the TUI, and blocking calls like timeout 600 all apply. Not for commands that
  finish in seconds and need no interaction.
compatibility: >-
  Requires the boo binary (github.com/coder/boo, verified against v0.6.4) on PATH. Linux and macOS. Sessions are
  per-user; sockets live in $XDG_RUNTIME_DIR/boo (or /tmp/boo-<uid>); set BOO_DIR to isolate test sessions.
---

# boo

boo is a GNU-screen-style terminal multiplexer whose sessions are built for headless automation. Every command except
`attach` and `ui` runs without a TTY, and `peek` returns the rendered screen state — parsed by Ghostty's VT core — not a
raw byte log.

## The model

- Each session is a daemon holding a PTY and the exact terminal state of one command. Sessions outlive any single tool
  call — and outlive the agent.
- Every `boo` invocation is a cheap stateless call that reads or writes that daemon: `send` types into it, `peek` reads
  its screen, `wait` blocks on its output, `kill` ends it.
- The bash tool is stateless and TTY-less; boo supplies both: a persistent, interactive, observable place for processes
  to live between calls.

## Reach for boo instead of blocking habits

Before typing any of these into a tool call, start a session instead — each habit blocks the call or leaves you blind:

| Habit                                      | boo replacement                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `timeout 600 make test`                    | session + `send --text 'make test; echo DONE:$?'` + `wait --text 'DONE:' --timeout 30s` |
| `cmd > log 2>&1 &` then sleep/tail loops   | session + `wait --idle` + `peek`                                                        |
| `nohup ... & disown`                       | `boo new -d -- bash`, type commands in later                                            |
| "is it still running? how far did it get?" | `boo ls --json` / `boo peek <name>`                                                     |

A session gives what `timeout` cannot: no duration guess up front, the screen and exit status preserved when something
stalls, the process alive across tool calls, and a place to look instead of a blindly killed process. Keep plain shell
calls for work that finishes in seconds; reach for boo the moment a run would last more than about a minute or you would
poll anything.

## Setup

Check first, install only if missing:

```bash
command -v boo && boo version
```

- Install script: `curl -fsSL https://raw.githubusercontent.com/coder/boo/main/install.sh | sh` (pin with
  `BOO_VERSION=0.6.4`, redirect with `BOO_INSTALL_DIR=<dir>`)
- Nix: `nix profile install github:coder/boo` (the upstream flake builds from source; prebuilt binaries come from the
  releases page)
- boo is young and evolving. `boo help --all` prints the entire CLI in one call — verify flags with it instead of
  guessing from memory.

## The canonical loop

```bash
boo new work -d -- bash                                 # 1. headless session running a shell
boo send work --text 'make test; echo DONE:$?' --enter  # 2. run a command, print a marker you control
boo wait work --text 'DONE:' --timeout 30s              # 3. bounded wait on that marker
boo peek work | tail -3                                 # 4. read the result: DONE:<exit status>
boo kill work                                           # 5. clean up — on success and on failure
```

Run **a shell in the session and send commands into it**. Never start the payload directly (`boo new -d -- make`): a
session dies with its command — when the command exits, the daemon exits, the session vanishes, and there is no final
screen to peek. A shell outlives every command typed into it.

- Always pass `-d`. Without it, `boo new` tries to attach and fails in a TTY-less tool call ("attach requires a
  terminal").
- Quoting: `$?` must expand in the session's shell, not in the tool call — write `--text 'make; echo DONE:$?'` in single
  quotes, or `--text "make; echo DONE:\$?"` from double quotes.

## Waiting: never guess, never block

Waiting on guessed text is the standard boo failure: the wait blocks the tool call until its timeout while the real
completion line never matched — wrong wording, or it scrolled out of the viewport long before the wait started. Follow
this discipline:

1. **Wait only on markers you control.** Send `cmd; echo DONE:$?` and wait on `DONE:`. Your marker prints last, so a
   finished command always leaves it in the viewport, and it carries the exit status. Program-native text ("PASS",
   "listening on") is a guess about output you have not read.
2. **Unknown output: peek first, wait second.** Run `boo wait <name> --idle`, then `peek --scrollback` to see what the
   program actually prints; wait on that exact observed string from then on.
3. **Readiness of busy servers scrolls away.** If the wait may already be late (the server logged its readiness and
   moved on to request logs), do not wait at all — `peek --scrollback | grep <text>` reads history that `wait` can no
   longer see.
4. **First wait is always short: 30s or less.** On exit 4, `peek` to see what is actually on screen, then decide:
   re-wait with a marker the peek just verified, send input, or kill the session. Never repeat a failed wait unchanged,
   and never raise the timeout without a peek that justifies it.
5. **Never block a tool call for minutes.** The session runs detached: a short wait, other work, another short wait.
   `--idle` plus `peek` is the fallback when no marker exists at all.

## Command reference

```
boo new [name] [-d] [--rows N] [--cols N] [--cwd DIR] [-- cmd...]
    Start a session running cmd (default $SHELL); attach unless -d.
    -d prints the session name on stdout. Defaults: 24 rows, 80 cols.
    Names: letters, digits, '.', '_', '-'; default name = current directory.
boo send <name> [--text <text>] [--enter] [--key <list>] [--stdin]
    Type as if at the keyboard. --text is literal: no escape processing, no
    implicit newline (add --enter). --key: Enter, Tab, Escape, Space,
    Backspace, Up, Down, Left, Right, Home, End, C-a..C-z (comma-separated);
    cannot combine with --text — use two calls. No flags: read binary-safe
    bytes from stdin (max ~1MB, NUL excluded).
boo peek <name> [--scrollback] [--json]
    Print the rendered screen; --scrollback includes history. Safe to run
    while a human is attached (read-only, never steals).
boo wait <name> (--text <text> | --idle) [--timeout <dur>]
    Block until the screen contains <text> (plain substring) or output has
    been quiet for 2s. Default timeout 30s. Durations: 500ms, 2s, 1m, 4h, 1d.
boo ls [--json]
    List sessions. --json: name, attached, idle_ms, unread, bell_idle_ms, title.
boo kill <name | --all>       SIGHUP the command; the session ends.
boo rename <name> <new-name>
boo attach <name>             human-only, needs a TTY; steals from another
                              client; aliases: at, a
boo ui                        human-only, full-screen session manager; alias: i
boo help [page]               per-command help, or topics: keys, automation;
                              --all prints every page in one call

Every <name> accepts a unique prefix ('boo attach bu' → "build").
Exit codes: 0 success · 1 error · 2 usage · 3 no such session · 4 wait timed out
Env: BOO_DIR (socket dir), BOO_LOG (debug log file)
```

## Output shapes

```
boo peek --json → {"session","title","rows","cols","cursor":{"row","col"},"screen"}
boo ls --json   → [{"name","attached","idle_ms","unread","bell_idle_ms","title"}]
```

- `cursor.row/col` is a signal: where the caret sits now (e.g. waiting for input at a prompt).
- `idle_ms` is time since last output or input; high idle = quiet session.
- `unread` = output not yet viewed; `bell_idle_ms >= 0` = the program rang the bell while away (boo's designed signal
  for "attention needed", e.g. a nested agent finished its turn). Both clear when the session is viewed.

## Recipes

### Persistent REPL across tool calls

```bash
boo new py -d -- python
boo send py --text 'import project.config as c' --enter
boo wait py --idle
boo send py --text 'c.evaluate("users/kui04")' --enter
boo wait py --idle && boo peek py
```

Imports, variables, and expensive startup persist between calls. Same pattern for `nix repl` (send `:lf .` to load the
flake in the session's cwd — the cold start is paid once), `psql`, `ghci`, `node`, `sqlite3`.

### Prompt-driven wizards and installers

```bash
boo new setup -d -- some-interactive-installer
boo wait setup --text 'Proceed?' --timeout 10s
boo send setup --text 'y' --enter
```

Step through prompts as a state machine: wait for each question's text, answer it, repeat. Never type secrets —
everything sent lands on the rendered screen and scrollback, readable via `peek`.

### Long-running processes (servers, watchers)

```bash
boo new web -d --rows 200 -- bash
boo send web --text 'npm run dev' --enter
boo wait web --idle --timeout 30s
boo peek web --scrollback | grep -i 'listening on'  # read readiness from history, never wait on it
# ...do other work between tool calls...
boo peek web               # current screen; add --scrollback for history
boo send web --key C-c     # stop it
boo kill web
```

A real PTY means servers behave as they do for humans: colors, formatted stack traces, debuggers that prompt on crash.
`--rows 200` enlarges the viewport so more output stays visible per peek.

### Parallel fan-out, one session per task

```bash
for t in unit smoke e2e; do
  boo new "job-$t" -d --rows 200 -- bash
  boo send "job-$t" --text "make test-$t; echo DONE:\$?" --enter
done
# ...later: check on all of them
boo ls --json                                  # idle_ms shows which went quiet
for t in unit smoke e2e; do
  boo wait "job-$t" --text 'DONE:' --timeout 30s || true   # short wait, then look
  boo peek "job-$t" | tail -3                              # DONE:<status>, or real progress if unfinished
done
# a peek that showed real progress justifies a longer re-wait; kill once every job reports DONE
for t in unit smoke e2e; do boo kill "job-$t"; done
```

### Nested agents

```bash
boo new sub -d --rows 200 -- claude    # or pi, aider, codex...
boo send sub --text 'fix the failing test in src/foo.ts' --enter
boo wait sub --idle --timeout 30s || true   # turns take minutes: short wait, then look
boo peek sub --scrollback | tail -20         # read its output; re-wait if it is mid-turn
boo ls --json                          # bell_idle_ms >= 0: it rang for attention
```

### Human handoff and pair-driving

- Agent-created sessions are headless: a human can `boo attach <name>` at any time and take over mid-flow (agent preps,
  human continues).
- Reverse direction: `peek` is safe while a human is attached — read their live session, or `send` input alongside them.

### Self-testing a TUI

```bash
boo new t -d --rows 40 -- ./my-tui
boo send t --key Down,Down,Enter
boo wait t --idle
boo peek t --json     # assert on screen text and cursor.row/col
boo kill t
```

boo's detached sessions answer terminal queries (DSR, DA, XTWINOPS) from libghostty state, so TUIs driven headlessly do
not hang waiting for replies.

## Gotchas

- **A session dies with its command.** When the command exits, the session is gone — no final screen, exit 3 afterwards.
  Run `bash` in the session and send commands into it (see the canonical loop).
- **`--text` is literal.** No escape processing, no implicit newline; pass `--enter` yourself. `$?` and `~` expand in
  the session's shell only — mind the quoting in the tool call (`\$?` inside double quotes).
- **`--key` and `--text` are mutually exclusive.** Two calls: type the text, then press the key.
- **`wait --text` sees only the visible viewport** as a plain, case-sensitive substring. Text that scrolled off,
  wrapped, or split across lines will not match. Create tall sessions (`--rows 200`), or use `--idle` plus
  `peek --scrollback | grep`.
- **`--idle` means 2s of quiet, not completion.** A server idles forever.
- **Exit codes are branchable:** 3 = no such session (or ambiguous prefix), 4 = wait timed out.
  `boo wait s --text X --timeout 5m || test $? -eq 4`.
- **Secrets sent with `send` end up on the screen and in scrollback.** Treat boo screens as logs; do not type passwords
  or tokens.
- **Kill by name.** `kill --all` ends every session of the current user, including human ones.
- `TERM` is fixed to `xterm-256color`; there are no splits or tabs — one session per task is the design, juggle them
  with `ls`.
- Raw `0x01` bytes are safe through headless `send`; during a human attach they are eaten as the C-a prefix (`boo ui` is
  immune via bracketed paste).
- `--cwd DIR` must already exist. Stdin `send` is capped at ~1MB.

## Cleanup discipline

- Give sessions explicit, unique names — ambiguous prefixes fail (exit 3).
- Before finishing a task, `boo ls` and `kill` every session you created; sessions survive the agent's exit.
- Prefer `peek` over `attach` from scripts; attach needs a TTY and steals the session from any human viewer.
