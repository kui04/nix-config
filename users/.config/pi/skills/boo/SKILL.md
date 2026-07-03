---
name: boo
description: Use this skill whenever a shell command would otherwise block for a long time (large downloads, compiling, long builds, big data processing), whenever something needs to keep running in the background (dev servers, databases, watchers, queue workers, `npm run dev`, `python -m http.server`), or whenever a task requires a back-and-forth interactive session inside a single process (gdb, lldb, python REPL, node REPL, mysql/psql CLI, ssh, ftp, any prompt-driven CLI). Trigger this proactively any time you're about to background a process or drive an interactive tool with pi's shell/exec tool — don't wait for the user to ask for "background" or "interactive" handling explicitly. Always use `boo` for this, never `tmux`, `screen`, `nohup`, or `disown` — those are harder to inspect and manage reliably across separate tool calls. Also use this when a previous long/background/interactive attempt failed, hung, or lost output.
license: MIT
compatibility: Requires a POSIX shell and the `boo` binary (auto-installed on first use if missing). Linux or macOS.
---

# Long-Running, Background, and Interactive Tasks

Each call to pi's shell/exec tool runs one command, waits for it to finish, and returns. That's fine for quick commands but breaks down in three situations:

1. **Long tasks** (downloads, builds, big data jobs) — a blocking call risks timing out the tool call or wasting a turn waiting.
2. **Background services** (dev servers, DBs, watchers) — the process must keep running *after* the tool call returns, across many future turns, and often across compaction or session branches.
3. **Interactive tools** (gdb, lldb, REPLs, ssh, mysql) — the process expects a live back-and-forth conversation, but each tool call is a single one-shot command with no attached terminal.

**Always use [`boo`](https://github.com/coder/boo) for all three.** Do not use `tmux`, `screen`, `nohup &`, or `disown` — boo is the standard tool for this skill because it gives clean, scriptable primitives (`send`, `peek`, `wait`, `--json`, real exit codes) purpose-built for scripts/agents driving sessions without a TTY, instead of ad-hoc polling and raw pane-scraping. It also plays well with pi specifically: sessions survive between tool calls, between context compaction, and even if the pi process itself restarts, since boo sessions are independent of pi's own process tree.

## Setup: make sure boo is installed

Check first, install if missing:
```bash
command -v boo || curl -fsSL https://raw.githubusercontent.com/coder/boo/main/install.sh | sh
```

## Core pattern: named boo sessions

### Naming convention — always prefix sessions

Every session this skill creates must be prefixed so it's instantly identifiable as pi-managed, both to you (across turns, compaction, and future sessions) and to the user (so they never wonder what a stray process is or worry it's unrelated to pi):

- **`pi-bg-<name>`** — long-lived background services that are meant to keep running after the task is done (dev servers, DBs, watchers). The `bg` marks "this is expected to still be alive later."
- **`pi-<name>`** — everything else: one-off long tasks (downloads, builds) and interactive tool sessions (gdb, REPLs). These are expected to be killed once the task completes.

Never create an un-prefixed or anonymous session. This also makes cleanup and auditing trivial: `boo ls | grep '^pi-'` shows everything this skill is responsible for, `boo ls | grep '^pi-bg-'` shows just the long-lived services.

**Start a detached session running something:**
```bash
boo new pi-download1 -d -- wget -O ./big.zip https://example.com/big.zip
```
`-d` = detached (don't block, don't need a TTY). The command after `--` runs immediately inside the session.

**Wait for it to make progress or finish, instead of sleep-and-poll loops:**
```bash
boo wait pi-download1 --idle --timeout 30s      # blocks until output goes quiet for 2s, or 30s elapses
boo wait pi-download1 --text "100%" --timeout 5m # blocks until a specific string appears
```
Exit code `4` means it timed out — check for that rather than assuming success.

**Read the session's screen at any point (never blocks):**
```bash
boo peek pi-download1                # current screen
boo peek pi-download1 --scrollback   # full history
boo peek pi-download1 --json         # structured: size, cursor, title, etc.
```

**List all live sessions** (useful after a long conversation, after compaction, or to check nothing was left orphaned from an earlier turn):
```bash
boo ls
boo ls --json
```

**Send input to an interactive program running inside a session** (answering a prompt, issuing the next gdb command, etc.):
```bash
boo send pi-download1 --text 'y' --enter          # types "y" and presses Enter
boo send pi-download1 --key C-c                   # sends Ctrl-C
boo send pi-download1 --key Enter,C-c,Up           # multiple named keys in sequence
```
`--text` is sent literally: no escaping, no implicit newline — add `--enter` explicitly when you want to submit a line.

**Rename or kill a session:**
```bash
boo rename pi-download1 pi-download-final
boo kill pi-download1
```
Avoid `boo kill --all` — it ends every session on the box, including ones the user or other tools started that don't carry the `pi-` prefix. Since everything this skill creates is prefixed, clean up precisely instead:
```bash
boo ls | grep '^pi-' | xargs -n1 boo kill   # kill every pi-managed session
boo ls | grep '^pi-bg-' | xargs -n1 boo kill # kill only the long-lived background ones
```

Exit codes to check: `0` success, `1` error, `2` usage error, `3` no such session, `4` wait timed out.

Always clean up sessions once a task is finished or clearly failed — don't leave dangling sessions across turns or across pi sessions. `boo ls` before ending a turn is a cheap sanity check.

---

## 1. Long tasks (downloads, builds, data jobs)

- Start it detached with a descriptive name: `boo new pi-build1 -d -- make -j4`.
- Don't poll in a tight loop across many consecutive tool calls burning turns/tokens. Use `boo wait pi-build1 --idle --timeout <duration>` or `boo wait pi-build1 --text "Build complete" --timeout <duration>` to block efficiently for a bounded amount of time in one call, instead of repeated manual `peek`s.
- After `wait` returns (success or timeout), `boo peek pi-build1 --scrollback` to see the full output and confirm success/failure — don't assume from the boo command's own exit code, since the command runs inside the session, not as boo's own exit status.
- For downloads specifically, prefer `curl -fSL -o file url` or `wget` over language-level HTTP clients for big files — better resumability and progress reporting.
- Kill the session once you've confirmed completion: `boo kill pi-build1`.

## 2. Background services (dev servers, DBs, watchers)

- One boo session per service, named after the service: `boo new pi-bg-devserver -d -- npm run dev`.
- After starting, **verify it actually came up** — don't assume. Use `boo wait pi-bg-devserver --text "listening" --timeout 15s` (matching whatever startup string the tool prints), then confirm with a real request: `curl -sf http://localhost:3000 && echo UP`.
- To restart: `boo send pi-bg-devserver --key C-c`, confirm it stopped via `boo peek pi-bg-devserver`, then `boo send pi-bg-devserver --text 'npm run dev' --enter`.
- To stop cleanly: `boo send pi-bg-devserver --key C-c` (graceful), then `boo kill pi-bg-devserver` once you've confirmed via `peek` that it exited.
- Running several services at once (backend + frontend + DB)? Give each its own named boo session so output never interleaves and each can be restarted independently. `boo ls` gives you the full roster at a glance, and survives you losing track of a service across a long pi session.
- Before starting a service, check the target port isn't already in use: `lsof -i :3000` or `ss -ltnp | grep 3000` — avoids "address already in use" confusion later.
- If the user will keep working in this project directory across future pi sessions, tell them explicitly what's left running in boo and how to check/stop it themselves (`boo ls`, `boo kill <name>`) — a background service started by pi doesn't disappear when the pi session ends.

## 3. Interactive tools (gdb, lldb, REPLs, mysql, ssh, ftp)

Two approaches, in order of preference:

### A. Batch/scripted mode (preferred when the full command sequence is known upfront)
Most debuggers and CLIs support non-interactive scripting — this avoids sessions entirely and is easiest to read output from:
```bash
gdb -q -batch -ex "break main" -ex "run" -ex "bt" -ex "quit" --args ./prog arg1
lldb -b -o "breakpoint set -n main" -o "run" -o "bt" -o "quit" -- ./prog
mysql -u user -p"$PW" -e "SELECT * FROM t;" dbname
python3 script.py <<'EOF'
some stdin input
EOF
```
Use this whenever you can plan the whole interaction ahead of time — no boo session needed at all.

### B. Live boo session (preferred when the next input depends on prior output — real back-and-forth)
```bash
boo new pi-gdb1 -d -- gdb ./prog
boo send pi-gdb1 --text 'break main' --enter
boo send pi-gdb1 --text 'run' --enter
boo wait pi-gdb1 --idle --timeout 10s
boo peek pi-gdb1                                # read output, decide next command
boo send pi-gdb1 --text 'print some_var' --enter
boo peek pi-gdb1
boo send pi-gdb1 --text 'quit' --enter
boo kill pi-gdb1
```
This is the standard way to hold a genuine multi-turn conversation with a program across separate tool calls — treat "start session → send → wait/peek → repeat → kill" as the default loop for any interactive tool.

Notes:
- Prefer `boo wait --text <expected-prompt-or-output>` over blind sleeps between `send` and `peek` — it returns as soon as the expected output shows up (or times out), instead of guessing a fixed delay.
- Always `peek` (or `wait --text`) after `send` before deciding the next command — don't send several commands blind in a row when the next one depends on the output of the last.
- If a prompt is waiting for a special key (e.g. `(y/n)`, a password), send it directly: `boo send pi-gdb1 --text 'yes' --enter` or `boo send pi-gdb1 --text 'mypassword' --enter`.
- Password/secret input: be mindful these land in the session's scrollback in plaintext — fine for local sandboxed debugging, but don't do this with real production credentials.
- If the user wants to watch or take over an interactive session themselves, mention `boo attach <name>` — everything above (`send`/`peek`/`wait`) works headlessly for pi, but the human can attach in their own terminal without disturbing the session.

## Notes specific to running inside pi

- pi's shell/exec tool call and boo are independent processes: a boo session you start will keep running even if pi's own context gets compacted, the conversation branches, or the pi process is restarted. Don't assume state is lost just because pi's memory of the conversation changed — `boo ls` first to check what's still alive before starting something that might already be running.
- If this skill is bundled as a reusable pi package (rather than a one-off), install it at `~/.pi/agent/skills/long-running-tasks/` (user-level, all projects), `.pi/skills/long-running-tasks/` (project-level), or `.agents/skills/long-running-tasks/` (shared across Claude Code/Codex/pi). A bare `SKILL.md` with no extra scripts/references is enough for this skill.

## Checklist before finishing a task that used any of these patterns
- [ ] `boo ls | grep '^pi-'` shows nothing left running that shouldn't be
- [ ] Every session created follows the `pi-bg-<name>` / `pi-<name>` convention — no anonymous or un-prefixed sessions
- [ ] Any `pi-<name>` (non-bg) sessions no longer needed are killed (`boo kill <name>`)
- [ ] Any `pi-bg-<name>` sessions still needed are left running and reported to the user; ones no longer needed are killed
- [ ] The user is told what's still running in the background (if anything), its exact `pi-bg-` session name, and how to stop it (`boo kill <name>`), if it should stay alive past this turn or this pi session