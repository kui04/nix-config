---
name: spawn
description: >-
  Run long work in persistent rmux windows instead of blocking a tool call, backgrounding it with nohup or &, or polling
  with sleep and tail. Use for long builds and test suites, dev servers, watchers, REPLs, ssh sessions, and any command
  whose duration you cannot bound; whenever a job must outlive one tool call, needs a TTY, asks a question, or must be
  checked on later; and whenever you would reach for timeout, nohup, &, disown, setsid, screen, tmux, sleep-and-check,
  watch, or tail -f. Also use when the user says to run something in the background, keep it running, start a server,
  watch the output, or check on it later. Not for commands that finish within seconds.
---

# spawn — long work in rmux windows

A tool call is stateless and has no TTY. That makes it a bad place for work that outlives seconds: it cannot show
progress, it cannot answer a prompt, and killing it throws the output away. `timeout`, `nohup`, `&`, and sleep-and-check
loops each work around one of those limits and lose another — the output, the exit status, the process, or your context.
rmux supplies the missing piece: a persistent, observable place where a process lives between calls.

## The model

- One **task session** holds the agent window and every spawn of this task.
- One spawn is one window. The window name is the spawn name.
- The agent's own window is named `agent`. It is not a spawn and is never killed.
- Spawn names describe the job: `test`, `web`, `repl`, `build`.

Find the task session. Inside rmux, `$TMUX_PANE` points at the agent's pane:

```bash
S=$(rmux display-message -p -t "$TMUX_PANE" '#{session_name}')
rmux rename-window -t "$TMUX_PANE" agent
```

Outside rmux there is no agent pane. Create a session named for the directory and the task, and tell the user how to
attach:

```bash
S="spawn-$(basename "$PWD")-<short task>"
if ! rmux has-session -t "$S" 2>/dev/null; then
  rmux new-session -d -s "$S" -- sh
  rmux rename-window -t "$S" agent
fi
# tell the user: rmux attach -t "$S"
```

Every `new-window` carries `-d`, so the window opens without stealing the view of a user who is attached. Never select
or switch a window.

## When to spawn

Spawn when any of these holds:

- The command may run longer than 30 seconds, and you cannot prove it will not.
- It needs a TTY, asks a question, or is interactive.
- It must survive the end of this tool call.
- You would write `timeout`, `nohup`, `&`, `disown`, `setsid`, `screen`, `tmux`, `sleep` followed by a check, `watch`,
  or `tail -f`.

Short commands stay plain bash calls. The test is not the clock; it is whether you can be sure the call ends in seconds.

Never write any of these in a tool call: `timeout`, `nohup`, `&` backgrounding, `disown`, `setsid`, `screen`, plain
`tmux`, `sleep` followed by a check, `watch`, `tail -f`, `wait-pane` without `--timeout`, `stream-pane`, `attach`,
`kill-server`, or `kill-session` inside the task session.

`kill-server` is never right: it ends every session of every task and every human. `kill-session` inside the task
session kills the agent itself. `attach` needs a TTY. `stream-pane` never returns.

## Starting a spawn

Run the job inside a shell, not as the window command. A window dies with its command, and a dead window can no longer
be read. The shell outlives the command, so the result stays readable:

```bash
W=test
rmux new-window -d -t "$S" -n "$W" -- sh
rmux set-option -w -t "$S:$W" remain-on-exit on
rmux send-keys -t "$S:$W" -- 'make test; s=$?; echo "SPAWN_EXIT:$s"; exit $s' Enter
```

`remain-on-exit` must be set before the command runs, or the window disappears the moment the command ends. The
`exit $s` makes the shell's exit status the command's exit status; without saving `$?` first, `echo` would overwrite it.
The marker on screen survives even when the process output scrolls.

Quoting: keep the payload in single quotes in your tool call, so `$?` and `$s` expand in the spawned shell, not in
yours.

## Three modes

**Synchronous** — you need the result before you can continue. Start the spawn, then join immediately (the next
section). Use this only when there is nothing else to do.

**Detached** — the common case. Start the spawn and continue with other work. Join later, at the moment you need the
result. Ten spawns in parallel are ten `new-window` calls; none of them blocks.

**Persistent** — the process never ends: a dev server, a watcher, a REPL, an ssh session. Do not set `remain-on-exit`.
Never join it; join means "wait for the end", and there is no end. Read it and talk to it instead. Stop it with
`rmux send-keys -t "$S:$W" C-c`, then `rmux kill-window -t "$S:$W"`; the kill sends SIGHUP, so no process is left
behind.

## The wait ladder

A wait is a ceiling, not an estimate. `wait-pane` returns the moment the process ends, so a short job is never delayed
by a long ceiling. The ladder decides only how long a stuck job stays invisible.

Join with `--pane-exit` and a timeout:

```bash
rmux wait-pane -t "$S:$W" --pane-exit --timeout 10s --json
```

| rung | wait | elapsed |
| ---- | ---- | ------- |
| 1    | 10s  | 0:10    |
| 2    | 20s  | 0:30    |
| 3    | 40s  | 1:10    |
| 4    | 80s  | 2:30    |
| 5    | 180s | 5:30    |
| 6    | 180s | 8:30    |
| 7    | 180s | 11:30   |

Rules:

- The first wait is always 10 seconds. Its purpose is to classify the job, not to finish it.
- After every timeout, inspect before you wait again (next section). Never repeat a wait without looking.
- The next wait may grow from evidence, but never shrink below the current rung, and never exceed 3 minutes.
- Past 10 minutes of elapsed waiting, ask the user once whether to keep waiting or to move on. Remember the answer for
  that spawn.

Exit code 1 with `"error":"timeout"` in the JSON means **still running**, not failed. Any other error is an rmux
problem: report it and stop.

## Inspect after every timeout

Three signals together:

- **Screen** — did the output change since the last look? Does it end in a prompt? Is there an error?
  `rmux capture-pane -p -S -200 -t "$S:$W"`
- **CPU** — is anything working? `ps -o pid,stat,%cpu,etime,args -p "$pid" --ppid "$pid"`, where
  `pid=$(rmux display-message -p -t "$S:$W" '#{pane_pid}')`. On macOS, use `pgrep -P "$pid"` and inspect the children
  too.
- **Input wait** — cursor visible, prompt-like ending, long silence.

Three verdicts:

- **Progressing** — wait again on the next rung.
- **Waiting for input** — answer it (next section).
- **No progress** — check the hang rule.

`S` in `ps` does not prove the process waits for input: a compile blocked on I/O also sleeps. Combine the signals.

## Channel: talking to a live spawn

A live spawn takes requests, not joins. Give every request a boundary, so the reply cannot be confused with older
output:

```bash
n="SPAWN_REPLY_$(date +%s)_$RANDOM"
rmux send-keys -t "$S:repl" -- "print(\"$n\")" Enter
rmux wait-pane -t "$S:repl" --text "$n" --timeout 10s --json
rmux capture-pane -p -S -50 -t "$S:repl"
```

Wait on `--text`, not `--next-text`. A fresh nonce cannot match an older reply, so `--text` is safe; and it matches a
reply that already arrived. `--next-text` only sees output produced after the wait arms, so a fast reply that lands
between the send and the wait counts as old output, and the wait then blocks to its timeout with the answer already on
screen. On any timeout, capture the screen first: the reply is often already there.

For a long reply, the nonce can scroll out of the viewport. Then use `--quiet --stable-for 2s`, capture with `-S`, and
find the nonce in the history.

Answering a prompt: answer when the answer follows from the task; never type a secret — everything sent lands on the
screen and in scrollback; ask the user before any destructive choice.

## A hang is not slow work

Declare a hang when two consecutive inspections all show no screen change, CPU near zero, and no input wait. Then:

1. Read the whole screen once more.
2. Answer the prompt if there is one.
3. Otherwise kill the window and report the last screen and the exit status.

Two inspections is about a minute at rung 2 and 3. Enough to catch a real hang, short enough not to leave a dead job
running.

## Reading the result

Default to rendered text plus the exit status:

```bash
rmux capture-pane -p -S -200 -t "$S:$W"
rmux list-windows -t "$S" -F '#{window_index} #{window_name} #{pane_dead} #{pane_dead_status}'
```

`capture-pane` gives the screen as a human sees it. `collect-pane-output` gives the raw PTY bytes with shell echo and
ANSI escapes; use it only when exact bytes matter:

```bash
rmux collect-pane-output -t "$S:$W" --until-pane-exit --max-bytes 1048576 --json
```

For a one-shot spawn, read the result and kill the window in the same step. A dead pane holds memory until it is killed,
and the result is useless once read:

```bash
rmux kill-window -t "$S:$W"
```

Keep `remain-on-exit` off for persistent spawns; there is nothing to retain after a server ends.

## The board

One read shows every spawn of the task:

```bash
rmux list-windows -t "$S" -F '#{window_index} #{window_name} #{pane_dead} #{pane_dead_status}'
```

Use the board when you return to the user, or when you need the state of more than one spawn. Do not check spawns one by
one, and do not poll: check when you need the answer.

## Ending the task

- At most 8 spawn windows per task session, not counting `agent`. At the cap, collect the finished ones first; if none
  are finished, refuse the new spawn and say why.
- Before the final answer, sweep: `list-windows` shows only `agent`.
- A spawn still running at sweep time is the user's decision. Ask whether to kill it or leave it, and name the window.
- Kill only windows you created. Never kill `agent`. A window you did not create belongs to someone else; report it and
  leave it.

## Failure

There is no fallback. If rmux is missing or a command fails, report the error and stop. Do not reach for `timeout`,
`nohup`, or a background `&`; that reintroduces exactly the loss this skill exists to remove.

## Pitfalls

- The typed command is echoed on screen. Read past it, or send a marker.
- `wait-pane --text` matches only the visible viewport. Output that scrolled away is invisible to it; use
  `capture-pane -S` to read history.
- A persistent spawn can exit on its own. The window disappears and `kill-window` then fails with `can't find window`;
  check the board before cleanup, and treat that error as already-swept.
- A window dies with its command. Set `remain-on-exit` first, or the result is gone.
- `capture-pane` without `-S` shows only the current screen.
- Killing the last window ends the session; the agent's window must outlive every spawn.
- An ambiguous window name fails; use exact names.
- `kill-server` kills other tasks and human sessions. Never use it.
