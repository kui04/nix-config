---
name: thread
description: >-
  Spawn long-running work as a thread in a zellij tab instead of blocking a tool call, backgrounding it with nohup or &,
  or polling with sleep and tail. Use for long builds and test suites, dev servers, watchers, REPLs, ssh sessions, and
  any command whose duration you cannot bound; whenever a thread must outlive one tool call, needs a TTY, asks a
  question, or must be checked on later; and whenever you would reach for timeout, nohup, &, disown, setsid, screen,
  tmux, sleep-and-check, watch, or tail -f. Also use when the user says to run something in the background, keep it
  running, start a server, watch the output, or check on it later. Not for commands that finish within seconds.
---

# thread — long work in zellij tabs

A tool call is stateless and has no TTY. That makes it a bad place for work that outlives seconds: it cannot show
progress, it cannot answer a prompt, and killing it throws the output away. `timeout`, `nohup`, `&`, and sleep-and-check
loops each work around one of those limits and lose another — the output, the exit status, the process, or your context.
zellij supplies the missing piece: a tab where a thread lives between calls.

## The model

- One **task session** holds the agent tab and every thread of this task.
- One thread is one tab. The tab name is the thread name. A tab is the analogue of a window; a pane is a split inside
  it, not a thread.
- The agent's own tab holds the `agent` pane. It is not a thread and is never closed.
- Thread names describe the job: `test`, `web`, `repl`, `build`.

zellij 0.45 sizes a tab from the clients watching it. With no client attached, a new tab is discarded on the first
attach. The fix is narrow: **a client must exist at the instant the tab is created**. It can leave immediately after.
The tab survives and keeps updating its screen.

Inside zellij, `$ZELLIJ_SESSION_NAME` and `$ZELLIJ_PANE_ID` identify you:

```bash
S="$ZELLIJ_SESSION_NAME"
zellij action rename-pane -p "$ZELLIJ_PANE_ID" agent
```

Outside zellij there is no client. Create a session and name its first pane `agent`, so the sweep rule stays the same:

```bash
S="thread-$(basename "$PWD")-<short task>"
if ! zellij list-sessions -s | grep -qx "$S"; then
  zellij attach -b -c "$S" -- sh
  i=0
  until zellij --session "$S" action rename-pane -p 0 agent 2>/dev/null; do
    [ "$i" -ge 25 ] && break
    sleep 0.2; i=$((i+1))
  done
fi
# tell the user: zellij attach "$S"
```

The first terminal pane of a new session is `terminal_0`, so bare `0` names it. Rename in a retry loop: the pane can
need a moment to exist after the session is created.

Every `new-tab` carries `--no-focus`: the tab opens without moving the view of any attached client. Never switch tabs or
focus panes on the user.

## When to spawn

Spawn a thread when any of these holds:

- The command may run longer than 30 seconds, and you cannot prove it will not.
- It needs a TTY, asks a question, or is interactive.
- It must survive the end of this tool call.
- You would write `timeout`, `nohup`, `&`, `disown`, `setsid`, `screen`, `tmux`, `sleep` followed by a check, `watch`,
  or `tail -f`.

Short commands stay plain bash calls. The test is not the clock; it is whether you can be sure the call ends in seconds.

Never use `kill-all-sessions`, `delete-all-sessions`, `attach`, `subscribe`, or a bare `new-tab` with no client.
`kill-all-sessions` ends every task and every human session. `attach` needs a TTY. `subscribe` only delivers updates for
panes that are currently rendered. A tab created with no client is silently discarded.

## Starting a thread

Step 1: make sure a client exists. Skip this when the user is attached.

```bash
if [ "$(zellij --session "$S" action list-clients | wc -l)" -le 1 ]; then
  script -qfc "stty rows 40 cols 120; zellij attach $S" /dev/null >/dev/null 2>&1 &
  helper=$!
  i=0
  while [ "$(zellij --session "$S" action list-clients | wc -l)" -le 1 ]; do
    [ "$i" -ge 40 ] && break
    sleep 0.05; i=$((i+1))
  done
fi
```

`script` gives the client a PTY. The helper lives inside this tool call: no `setsid`, no background job. It attaches
quickly; the loop waits up to two seconds. Its viewport only sets the tab's initial size; when the user attaches, zellij
reflows the tab to their terminal.

Step 2: create the tab, then let the helper go. The tab survives the helper, and its screen keeps updating.

```bash
TASK_DIR=$(mktemp -d)
W=test
st="$TASK_DIR/$W.status"

tab=$(zellij --session "$S" action new-tab --no-focus -n "$W" -- sh -c '
  echo "THREAD_PID:$$"
  make test
  s=$?
  echo "THREAD_EXIT:$s"
  echo "$s" > "'"$st"'"
  exit $s')
[ -n "${helper:-}" ] && kill -9 "$helper"
```

`THREAD_PID` gives the process tree for the hang check. `THREAD_EXIT` puts the exit status on screen where a human can
see it. The status file is the event the join waits for. Because the tab stays alive, `dump-screen` still works
afterwards.

Find the pane id from the board, because `dump-screen` and `close-pane` take a pane id, not a tab id:

```bash
zellij --session "$S" action list-panes -a -j
# take the pane whose tab_name is W
```

Quoting: the wrapper is a single-quoted `sh -c` script in your tool call, with the status path spliced in through double
quotes. Keep `$?` and `$$` inside the single quotes so they expand in the pane, not in your shell.

## Joining

Wait for the status file with a bound. The loop runs inside one tool call; the agent never wakes itself to check:

```bash
join() {  # $1 status file, $2 tries of 0.2s
  i=0
  while [ ! -f "$1" ] && [ "$i" -lt "$2" ]; do sleep 0.2; i=$((i+1)); done
  [ -f "$1" ]
}
join "$st" 50 && cat "$st" || echo RUNNING
```

The wait is a ceiling, not an estimate. A short job returns at the next 0.2s tick, never at the end of the ceiling. The
ladder decides only how long a stuck thread stays invisible.

| rung | wait | tries |
| ---- | ---- | ----- |
| 1    | 10s  | 50    |
| 2    | 20s  | 100   |
| 3    | 40s  | 200   |
| 4    | 80s  | 400   |
| 5    | 180s | 900   |
| 6    | 180s | 900   |
| 7    | 180s | 900   |

Rules:

- The first wait is always 10 seconds. Its purpose is to classify the job, not to finish it.
- After every expiry, inspect before you wait again (next section). Never repeat a wait without looking.
- The next wait may grow from evidence, but never shrink below the current rung, and never exceed 3 minutes.
- Past 10 minutes of elapsed waiting, ask the user once whether to keep waiting or to move on. Remember the answer for
  that thread.

`RUNNING` means the thread is still alive, not that it failed. A thread that died without writing its status is detected
by the inspect step, not by this loop.

## Persistent threads

A server, a watcher, a REPL, or an ssh session never ends, so a join would only burn the ladder. Start it without the
status-file wrapper and never join it. The helper rule is the same: a client must exist at tab creation.

```bash
wid=$(zellij --session "$S" action new-tab --no-focus -n web -- python3 -m http.server 8931)
[ -n "${helper:-}" ] && kill -9 "$helper"
zellij --session "$S" action list-panes -a -j
```

Read the board and take the id of the pane whose `tab_name` is `web`; call it `pid`. Then wait for readiness:

```bash
i=0
while ! zellij --session "$S" action dump-screen -p "$pid" | grep -q 'Serving HTTP'; do
  [ "$i" -ge 50 ] && break
  sleep 0.2; i=$((i+1))
done
```

The same bounded screen poll tells you when a server is ready. `close-pane` ends the pane and its process, but the tab
remains; use `close-tab-by-id` to remove the whole thread, as below. The channel below talks to a REPL.

## Inspect after every expiry

Three signals together:

- **Screen** — did the output change since the last look? Does it end in a prompt? Is there an error?
  `zellij --session "$S" action dump-screen -p "$pid" -f`
- **CPU** — the wrapper printed `THREAD_PID:<pid>` on the first line. Check it and its children:
  `ps -o pid,stat,%cpu,etime,args -p "$pid" --ppid "$pid"`. On macOS or Git Bash, use `pgrep -P "$pid"` and inspect the
  children too.
- **Input wait** — the cursor is visible in `list-panes -a -j` as `cursor_coordinates_in_pane`, the screen ends in a
  prompt, and output has been quiet.

Three verdicts:

- **Progressing** — wait again on the next rung.
- **Waiting for input** — answer it (next section).
- **No progress** — check the hang rule.

`S` in `ps` does not prove the process waits for input: a compile blocked on I/O also sleeps. Combine the signals.

## Channel: talking to a live thread

A live thread takes requests, not joins. Give every request a boundary. The marker must be built from pieces inside the
program, so the echoed command does not contain the marker itself — otherwise a screen search matches the echo instead
of the answer:

```bash
n="REPLY_$(date +%s)_$RANDOM"
zellij --session "$S" action write-chars -p "$repl" "print('THREAD_'+'$n')"
zellij --session "$S" action send-keys -p "$repl" Enter

i=0
while ! zellij --session "$S" action dump-screen -p "$repl" | grep -q "THREAD_$n"; do
  [ "$i" -ge 50 ] && break
  sleep 0.2; i=$((i+1))
done
zellij --session "$S" action dump-screen -p "$repl" -f
```

The echo shows `print('THREAD_'+'REPLY_x')`; the answer shows `THREAD_REPLY_x`. Only the answer matches. For a shell,
use `echo "THREAD_""$n"` for the same effect.

Answering a prompt: answer when the answer follows from the task; never type a secret — everything sent lands on the
screen and in scrollback; ask the user before any destructive choice.

## A hang is not slow work

Declare a hang when two consecutive inspections all show no screen change, CPU near zero, and no input wait. Then:

1. Read the whole screen once more.
2. Answer the prompt if there is one.
3. Otherwise close the tab and report the last screen and the exit status.

Two inspections is about a minute at rung 2 and 3. Enough to catch a real hang, short enough not to leave a dead thread
running.

## Reading the result

Default to rendered text plus the exit status:

```bash
zellij --session "$S" action dump-screen -p "$pid" -f
cat "$st"
```

`dump-screen` returns the pane as a human sees it, and it works for tabs the user is not watching too. There is no raw
byte stream; `dump-screen -a` keeps ANSI styling, which is usually what you want when colour carries meaning. If exact
bytes matter, redirect inside the wrapper (`make test > "$TASK_DIR/test.log" 2>&1`) and read the file.

For a one-shot thread, read the result and close the whole tab in the same step. A dead tab holds a pane and memory
until it is closed:

```bash
zellij --session "$S" action close-tab-by-id "$tab"
```

## The board

One read shows every thread of the task:

```bash
zellij --session "$S" action list-panes -a -j
```

Each pane carries `id`, `title`, `tab_name`, `tab_id`, `exited`, `exit_status`, `pane_content_columns`, and
`cursor_coordinates_in_pane`. Use the board when you return to the user, or when you need the state of more than one
thread. Do not check threads one by one, and do not poll: check when you need the answer.

## Ending the task

- At most 8 thread tabs per task session, not counting the agent tab. At the cap, collect the finished ones first; if
  none are finished, refuse the new thread and say why.
- Before the final answer, sweep: the board shows only the `agent` pane and zellij's own plugin panes.
- A thread still running at sweep time is the user's decision. Ask whether to kill it or leave it, and name the tab.
- Close only tabs you created. Never close the agent tab. A tab you did not create belongs to someone else; report it
  and leave it.
- Remove the task directory, and end a session you created:

```bash
zellij kill-session "$S"
zellij delete-session "$S"
rm -rf "$TASK_DIR"
```

`kill-session` leaves the session listed as EXITED and resurrectable; `delete-session` removes it and stops the
session's server process.

## Failure

zellij often exits 0 on a bad pane id: `dump-screen -p 999` and `close-pane -p 999` both return 0. Do not trust the exit
code as proof. After creating a tab, confirm its pane appears in `list-panes -a -j`. If it does not, the thread failed
to start; report it.

There is no fallback. If zellij is missing or a command fails, say so and stop. Do not reach for `timeout`, `nohup`, or
a background `&`; that reintroduces exactly the loss this skill exists to remove.

## Windows

zellij runs natively on Windows from 0.44. There is no `script` in Git Bash, so the throwaway client is unavailable. On
native Windows, use panes instead of tabs: create threads with `new-pane --no-focus` in the agent tab, read them with
`dump-screen -p`, and close them with `close-pane`. The join, status file, markers, channel, and hang rules are
unchanged. Do not use GNU `timeout`: Git Bash does not guarantee it, and the Windows built-in with that name is a sleep.
`ps` in Git Bash sees MSYS processes only; if the job launches native Windows programs, use
`powershell -NoProfile -Command "Get-Process -Id <pid>"` for the CPU signal.

## Pitfalls

- A tab created with no client is discarded when the first client attaches. Create a client first; it only needs to live
  for the instant of creation.
- Kill the helper with `kill -9`, not `kill`. `script` ignores SIGTERM and leaves a zombie child.
- The helper is a child of this tool call. Do not add `setsid` or `nohup`; it must die with the call.
- A tab survives the helper. Its screen keeps updating, and `list-panes` still shows it.
- The typed command is echoed on screen. For a channel marker, build it from pieces so the echo does not match.
- `dump-screen` without `-f` shows only the viewport.
- A dead tab stays until `close-tab-by-id`. Close it after reading.
- `kill-session` alone leaves an EXITED entry; `delete-session` removes it and stops its server.
