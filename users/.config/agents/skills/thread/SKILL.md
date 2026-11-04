---
name: thread
description: >-
  Run long-running, interactive or persistent terminal commands in named zellij tabs with the bundled scripts/thread
  CLI, instead of blocking a tool call or using nohup, &, timeout, sleep-and-tail loops, tmux or screen. Use this
  whenever a command may take more than ~30 seconds or has no known end (nixos-rebuild, home-manager, nix build, cargo
  build/test, docker build, full test suites, benchmarks, installs, migrations); whenever a process must outlive the
  current tool call (dev servers, file watchers, docker compose, tunnels); whenever something needs a real TTY (REPLs,
  ssh, prompts, installers asking y/N); and whenever the user says "run it in the background", "keep the server
  running", "start X and let me know", or "check on that job later". Skip it for commands that finish in seconds.
---

# thread — long work in zellij tabs

A tool call has no TTY and no memory. A command that outlives it can't answer a prompt, can't show progress, and its
output and exit status are lost. `nohup`, `&` and `timeout` each throw away one of those things. A **thread** is a named
zellij tab that keeps the process alive between tool calls, so you can check on it, answer it, and read its exit code
later. The user can also attach and watch live.

## Calling the CLI

The CLI is `scripts/thread`, next to this SKILL.md. Each Bash call starts a fresh shell, so a variable set in an earlier
call is gone: write the full path each time, or define it at the top of the same command.

```bash
S="<this-skill-dir>/scripts/thread"; "$S" spawn test -- cargo test
```

Don't read the script's source into context; it's long and you don't need it. `"$S" help` or `"$S" usage <subcommand>`
prints option syntax, output fields and exit codes.

## Should this be a thread?

Spawn a thread if any of these is true:

- It may run longer than ~30 seconds and you can't be sure it won't.
- It needs a TTY, shows interactive prompts, or is a REPL or `ssh` session.
- It must keep running after this tool call (server, watcher, tunnel).
- You were about to reach for `nohup`, `&`, `disown`, `setsid`, `timeout`, `tmux`, `screen`, `watch`, `tail -f` or a
  `sleep` + check loop.

Otherwise run it as a normal Bash call. Never run raw `zellij kill-all-sessions`, `delete-all-sessions`, a bare
`zellij attach` or `subscribe`; they can destroy the user's sessions or hang your call. Everything goes through `"$S"`,
which only touches tabs it created.

## Workflow

**1. `init` once per task.** Creates (or joins) the task session and names your pane `agent`. Outside zellij it prints
`ATTACH_HINT=zellij attach <session>`: give that command to the user so they can watch. The session is remembered per
working directory, so later calls need no `-s`; pass `-s <session>` only if you `cd` elsewhere.

**2. `spawn <name> -- <command>`.** One tab per job, named for what it does (`test`, `build`, `web`). A single quoted
string runs under `bash -c` (pipes and redirects work); several arguments run directly. Use `--cwd <dir>` to start
elsewhere. Max 8 live threads per session; `read` finished ones first, and if none are finished, stop and tell the user.

**Estimate the duration first and pass it as `--eta <seconds>`.** Before spawning, think about how long this job should
take: what it is, how big the project or test suite is, whether it's a cold or warm cache, what the same command took
earlier in this session. A warm `cargo check` is ~30, a cold `nix build` of a large flake ~900, a full e2e suite ~600. A
rough guess is enough. `join` polls at a rhythm that fits the job: the first check is at a quarter of the ETA (minimum
10s) and each later one doubles, up to 180s. Without `--eta`, every job is polled as if it were a 10-second one, so a
20-minute build gets checked far too often (each check costs a tool call and context) and a 30-second job gets no
benefit from knowing it's short. If the first `inspect` shows the job is much bigger or smaller than you thought, say a
test count or progress percentage on screen, don't fight the estimate: just pass a longer or shorter wait to `join`.

**Never redirect the command's output away from the terminal** (`> file`, `>> file`, `&> file`). The tab's screen is the
only thing the user can watch and the only thing `inspect` and `read` can see; a redirected job leaves a blank tab
showing just `THREAD_PID:…`, so nobody can tell whether it is progressing or stuck. `2>/dev/null` on a single noisy step
is fine. If you also want a log file to grep later, use `tee` so output still reaches the screen, with `pipefail` so the
exit code is the command's rather than `tee`'s:

```bash
"$S" spawn --eta 300 build -- "set -o pipefail; cargo build 2>&1 | tee /tmp/build.log"
```

**3. `join <name>`** waits for a one-shot thread. It returns the moment the job exits, so fast jobs cost nothing. The
ceiling only bounds how long a stuck job goes unnoticed. It is exponential backoff scaled by your ETA: first call ETA/4
(minimum 10s), then double each call, capped at 180s. For example, `--eta 120` gives 30s, 60s, 120s, 180s; `--eta 30` or
no ETA gives 10s, 20s, 40s, 80s, 160s, 180s. From the second call on you may pass seconds (`join test 60`, clamped
between the rung's ceiling and 180). When the job is still running, `join` prints `ETA_SECONDS`, and `PAST_ETA=yes` once
total waiting has exceeded your estimate. Take that as a cue to reconsider the estimate from what `inspect` shows, not
just to keep waiting.

**4. `inspect <name>` after every `STATUS=RUNNING`.** This is mandatory (`join` exits 2 otherwise). It prints `[META]`,
`[PROCESS_TREE]` and `[SCREEN_TAIL]`; decide from all three:

| What you see                                                                                 | Meaning                        | Do this                                                                                        |
| -------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `SCREEN_CHANGED=yes`                                                                         | output is still flowing        | `join` again                                                                                   |
| screen static but `CPU_ACTIVE=yes`                                                           | busy compiling/linking/hashing | `join` again                                                                                   |
| tail ends in a question or prompt (`[y/N]`, `Password:`, `?`, `:`), quiet, cursor at the end | waiting for input              | answer with `send` (see below)                                                                 |
| `HANG_CANDIDATE=yes` (two inspects in a row with no screen change, no CPU, no prompt)        | probably stuck                 | `read --keep`, answer any missed prompt, or `close` and report the last screen and exit status |

Treat `SCREEN_CHANGED` as the stronger signal: `CPU_ACTIVE` uses `ps`'s lifetime-average %CPU, which stays high for a
while after a process goes quiet, and a state of `S` doesn't prove a process wants input (it may be waiting on disk or
network).

At 600s of cumulative waiting (or twice your ETA, if that is longer) `join` exits 3. Ask the user once whether to keep
waiting; if yes, add `--allow-over-10m`.

**5. `read <name>`** after `STATUS=EXITED`. It prints the full screen and `EXIT_CODE`, and closes the tab so dead tabs
don't pile up. Use `--keep` to read without closing, `--ansi` when colour carries meaning. Report the exit code, not
just the output: a build can print a lot and still have failed.

**6. Persistent threads** (servers, watchers, REPLs, `ssh`) never exit, so never `join` them. Start with `--persistent`,
optionally with `--wait <regex>` to block up to 10s until it's ready (the output says `READINESS=ready|timeout`):

```bash
"$S" spawn --persistent --wait "Serving HTTP" web -- python3 -m http.server 8931
```

Talk to a live thread with `send` (text plus Enter; `--raw` omits Enter):

```bash
"$S" send migrate "yes"                              # answer a prompt
"$S" send --wait-marker shell sh-repl "make check"   # run in a shell and wait for its boundary
"$S" send --wait-marker python py-repl "2 + 2"       # same for a Python REPL
```

Everything you send is visible on screen and in scrollback, so never send secrets. Ask the user before sending any
destructive confirmation (`yes` to a drop, delete or force-push prompt).

**7. `sweep` before your final reply.** Closes finished thread tabs of yours and never closes foreign tabs. It prints
`CLOSED_THREADS`, `RUNNING_THREADS` (when any remain) and `FOREIGN_TABS_LEFT_UNTOUCHED` (when it leaves foreign panes).
Running threads make it exit 3: ask whether to kill them (`sweep --kill-running`) or leave them
(`sweep --keep-session`); `--keep-session` exits 0 and keeps the threads and the session.

When the session was created by `init`, no foreign tabs remain, `--keep-session` is not set, and `sweep` does not run
inside that session, it also removes the whole session, including the `agent` pane, and prints `SESSION_REMOVED=...`.
This is cleanup, not a thread close: anyone attached is disconnected. Otherwise it prints `SESSION_KEPT=...`. `board`
shows every pane at a glance if you lose track.

## Exit codes

| Code | Meaning                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------ |
| 0    | success (for `join`, read `STATUS=`)                                                                   |
| 1    | bad arguments, zellij missing, or a zellij action failed                                               |
| 2    | policy: 8-thread cap, `join` before `inspect`, reserved name `agent`, or `join` on a persistent thread |
| 3    | needs the user: 600s of waiting reached, or running threads at `sweep`                                 |

At `sweep`, `--kill-running` and `--keep-session` both clear exit 3. Without either, ask the user which one to use.

## When things go wrong

- **No fallback.** If zellij is missing or `"$S"` exits 1, stop and tell the user. Quietly switching to `nohup` or `&`
  brings back exactly the lost-output problems this skill exists to avoid.
- **Windows (Git Bash/MSYS) without `script`:** the CLI falls back to panes in the current tab automatically. If a job
  spawns native binaries that MSYS `ps` can't see, check them with
  `powershell -NoProfile -Command "Get-Process -Id <pid>"`.
