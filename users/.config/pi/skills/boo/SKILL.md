---
name: boo
description: Drive long-running, background, or interactive terminal programs headlessly via the boo multiplexer (github.com/coder/boo) — dev servers, watchers, REPLs, test runners, TUIs, or anything that must keep running across turns, take input mid-run, or be waited on without blocking. Use whenever asked to run something in the background, keep a process alive, send input to a running process, or wait for a condition — instead of bare `&` / nohup / manual sleep-poll loops.
compatibility: Requires the boo CLI (https://github.com/coder/boo) installed and on PATH. Linux/macOS. Install with `curl -fsSL https://raw.githubusercontent.com/coder/boo/main/install.sh | sh`.
---

# boo

`boo` is a screen-style terminal multiplexer purpose-built for automation: every action (`send`, `peek`, `wait`) works without a TTY, and `--json` output is available where it matters. Use it any time a task needs a process that outlives a single tool call, or a program you need to type into and watch rather than just execute-and-capture.

## When to reach for boo instead of plain bash

| Situation | Use |
|---|---|
| One-shot command, output when it finishes | plain bash |
| Process must keep running while you do other things (dev server, watcher, tail) | **boo** |
| Program is interactive (REPL, `ssh`, `psql`, wizards) and you need to send input over multiple steps | **boo** |
| You need to wait for a specific condition (a string appears, output goes quiet) instead of guessing a sleep duration | **boo** |
| You need to reliably know a background process is still alive / kill it later | **boo** |

If a command finishes on its own and you just want its output, don't use boo — a normal foreground command is simpler and cheaper.

## Session naming convention

**Every session this skill creates must be named with a `pi-` prefix.** This is non-negotiable for sessions started through this skill — it's what makes `boo ls` self-documenting and lets agent-created sessions be told apart from, and cleaned up separately from, anything a human started by hand.

Format: `pi-<tag>-<descriptor>`, where `<tag>` says what kind of task it is:

- `pi-bg-<descriptor>` — generic background task (migrations, one-off scripts, long-running jobs)
- `pi-dev-<descriptor>` — a dev/watch server (`npm run dev`, `air`, etc.)
- `pi-test-<descriptor>` — a test runner in watch mode
- `pi-build-<descriptor>` — a build/compile process
- `pi-repl-<descriptor>` — an interactive REPL/console (python, rails console, psql, etc.)
- `pi-log-<descriptor>` — tailing logs (`docker logs -f`, `tail -f`, etc.)

If nothing more specific fits, default to `pi-bg-<short-task-name>` — don't drop the prefix just because the task is a quick one-off.

```bash
boo new pi-dev-frontend -d -- npm run dev
boo new pi-test-backend -d -- pytest -f
boo new pi-bg-migrate -d -- ./scripts/migrate.sh
```

Bulk cleanup can then target only agent-created sessions instead of `kill --all` (which would also kill anything the human is running):

```bash
# check the actual key name in your boo version's `boo ls --json` output once before relying on this
boo ls --json | jq -r '.[] | select(.name | startswith("pi-")) | .name' | xargs -r -n1 boo kill
```

## The canonical loop

Almost everything you do with boo follows this five-step shape:

```bash
boo new pi-bg-build -d -- bash               # 1. create a detached (headless) session
boo send pi-bg-build --text 'make' --enter   # 2. type into it
boo wait pi-bg-build --idle                  # 3. block until output settles
boo peek pi-bg-build --scrollback            # 4. read the reconstructed screen
boo kill pi-bg-build                         # 5. clean up when done
```

- `pi-bg-build` is a session name you choose (following the naming convention above) — reuse it across all five calls so you're always talking to the same session.
- Step 1 only needs to happen once per session; repeat steps 2–4 as many times as you need to drive the process.
- Always run step 5 when you're done with a session — sessions don't clean themselves up.

## Never launch your target command directly

**Never do this:**

```bash
boo new pi-bg-build -d -- make
```

Here the session's own process *is* `make`. When it exits — whether it fails or succeeds — the session's underlying process is gone, and the session can be torn down along with its scrollback before you get a chance to `peek` it. This is the single most common way a failing build's log gets lost: the compile fails, the process exits, and there's nothing left to read.

**Always start a persistent shell instead, and `send` the real command into it:**

```bash
boo new pi-bg-build -d -- bash
boo send pi-bg-build --text 'make' --enter
```

Now the shell is the session's process. It survives the command's exit either way, so the scrollback with the full failure output stays readable right up until you explicitly `boo kill` the session yourself. Treat `-- bash` (or `-- sh`) as the default first argument to every `boo new` call this skill makes — only run a command directly when you specifically want the session to end the moment that command exits.

## Getting a reliable pass/fail signal

`wait --idle` only tells you the output went quiet — not whether the command succeeded or failed. `wait --text` needs you to already know what a success or failure line looks like, which isn't always reliable (an unrelated log line can contain the word "error"). For anything where pass/fail actually matters — compiles, test runs, migrations — echo the exit code explicitly so it lands in the scrollback as a fixed, greppable marker:

```bash
boo new pi-bg-build -d -- bash
boo send pi-bg-build --text 'make; echo "BOO_DONE exit=$?"' --enter
boo wait pi-bg-build --text 'BOO_DONE' --timeout 5m
boo peek pi-bg-build --scrollback
```

Read the `exit=<n>` value out of what `peek` returns — `0` is success, anything else is failure — and the full build output is still sitting right there in scrollback either way, because the shell (not `make`) is what kept the session alive. Only `boo kill` a session after you've peeked and captured what you need from it; never kill immediately on a `wait` returning, without reading scrollback first.

## Core commands

`<name>` below always means a session name following the `pi-<tag>-<descriptor>` convention above.

- `boo new <name> -d -- <command>` — start a detached session running `<command>`. **Default `<command>` to `bash` (or `sh`), then `send` your real command into it** — see "Never launch your target command directly" above for why. Omit `-d` and the command to get an attached session running `$SHELL` (rarely what you want from an agent). Never omit `<name>` — an auto-derived name won't carry the `pi-` prefix.
- `boo send <name> --text '<literal text>' --enter` — type text into the session. `--text` is sent **literally**: no shell escaping, no implicit newline. Add `--enter` to submit it, or use `--key Enter`, `--key C-c`, `--key Up` etc. for control keys.
- `boo wait <name> --idle` — block until the session has been quiet for 2 seconds (use after sending a command, before peeking). `boo wait <name> --text '<string>'` blocks until that string appears on screen instead — better than `--idle` when you know what success/failure looks like. Always add `--timeout <duration>` (e.g. `30s`, `2m`) so a hung or wrong process can't block you forever — it exits with code `4` instead of hanging.
- `boo peek <name> --scrollback` — print the reconstructed screen (not a raw log — a redrawn, stable snapshot). Add `--json` for machine-readable output including cursor position and title. Drop `--scrollback` to see only the current visible screen.
- `boo kill <name>` — end the session. `boo kill --all` ends every session boo knows about, including anything a human is running — prefer the filtered cleanup pattern above for sessions this skill created.
- `boo ls` (add `--json` for scripting) — list active sessions; check this if you're unsure whether a session from an earlier step is still alive, or to confirm nothing stray is left over with a `pi-` prefix.

Full flag reference, exit codes, and the remaining commands (`attach`, `rename`, `ui`) are in `references/commands.md` — read it if you need anything beyond the loop above.

## Gotchas worth remembering

- **A failing build "taking its log down with it" is a wrapping bug, not a boo bug.** If output from a failed compile/test seems to disappear along with the session, check whether the target command was launched directly as the session's process (`boo new x -d -- make`) instead of inside a persistent shell (`boo new x -d -- bash` + `send`). See "Never launch your target command directly" above — this is the #1 cause of lost failure logs.
- **`--text` does not add a newline.** `boo send pi-bg-build --text 'make'` alone types `make` without pressing Enter — you almost always want `--enter` appended, or the command just sits in the prompt unsent.
- **Don't poll with `peek` in a loop.** Use `wait --idle` or `wait --text` first; peeking before the program has responded just shows you stale output.
- **Always set `--timeout` on `wait`.** Without it, a process that never goes idle or never prints your expected string will hang the call indefinitely.
- **Never create a session without the `pi-` prefix.** If you catch yourself about to run `boo new <bare-name>`, stop and pick a `pi-<tag>-<descriptor>` name instead — even for a quick throwaway session.
- **Session names collide with existing ones.** If `boo new pi-<tag>-<descriptor>` fails because the name is taken, check `boo ls` — it may be a `pi-` session you started earlier and forgot to `kill`.
- **Exit code 4 means timeout, not failure of the underlying program.** Distinguish this from exit code 1 (boo error) when deciding how to react.