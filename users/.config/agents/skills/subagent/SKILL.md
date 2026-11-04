---
name: subagent
description: >-
  Delegate a self-contained task to a child pi process with its own context window, and bring back only its answer. Load
  this skill before starting work that may need a long read (more than a few hundred lines), three or more files for one
  answer, a whole-directory survey, or a comparison/audit across files, and whenever the user says "delegate this", "use
  a subagent", "spawn another agent", "have another agent do it", "get a second opinion", or "run a background agent".
  Also load it when an independent subtask can run alongside the current work, even if the user never names a subagent;
  deciding to stay inline after loading is fine. Skip only tasks that clearly take one or two tool calls, and work that
  needs the user's answers mid-way.
---

# subagent

A subagent is a second `pi` process with an empty context. It runs in its own thread, a zellij tab managed by the
`thread` skill, so it can run long, survive this tool call, and keep its reading out of this context. Only its final
answer comes back.

Isolation costs startup time and repeats file reads the parent already did. Delegate when the task needs any of these:

- a long file or a whole directory read end to end for a review, audit or summary;
- three or more files that you would read only to produce one answer;
- an independent subtask that can run while this session does something else;
- the user asked for a subagent, a second opinion, or a background agent.

Keep it inline when it takes one or two tool calls, when the answer depends on this conversation, or when the user must
answer questions along the way. Loading this skill and then staying inline is fine; reading the long file first is not,
because the context is already spent by then.

One child gets one deliverable. Split a large job into several children with separate answers, not one vague child.

The user can also load this skill directly with `/skill:subagent <task>`. Treat that task text as the task.

## Workflow

1. Read the `thread` skill and run its `init` step once for this task. It owns `spawn`, `join`, `inspect`, `read`,
   `send`, `close`, `sweep`, the 8-thread cap and the policy for running threads. Follow it instead of reimplementing
   it.
2. Pick a short name, prefixed `sub-`, such as `sub-auth-review`.
3. Write the brief to `/tmp/<name>.task.md`. This is the child's only context, so it must stand alone:
   - the goal and why it matters;
   - the working directory and the paths to read;
   - what you already know or ruled out, so it does not repeat your work;
   - constraints, and the tools it may use;
   - "Do not commit, push or open a pull request. Leave changes in the working tree.";
   - the exact answer shape: sections, length, file paths;
   - "Do not delegate to another subagent. Do the work yourself and answer." Write absolute paths, not "as we
     discussed". The file also avoids shell quoting problems.
4. Spawn a one-shot child. Build the model flags in the same Bash call that spawns, because each call starts a fresh
   shell, and because the zellij tab does not inherit this shell's environment: the values must expand before
   `thread spawn` runs. Default to read-only tools. Add `bash` when the child must run commands, and `edit,write` only
   when it must change files.

   ```bash
   S="$HOME/.pi/agent/skills/thread/scripts/thread"   # use the path of the thread skill you loaded
   NAME=sub-auth-review
   MF=""
   [ -n "$PI_MODEL" ] && MF="--model $PI_PROVIDER/$PI_MODEL"
   [ -n "$PI_REASONING_LEVEL" ] && MF="$MF --thinking $PI_REASONING_LEVEL"
   "$S" spawn "$NAME" -- "pi -p $MF --no-session --tools read,grep,find,ls @/tmp/$NAME.task.md >/tmp/$NAME.out 2>/tmp/$NAME.err"
   ```

   Pass `--cwd <dir>` to `thread spawn` when the task belongs to another directory. Put it before `--`, not inside the
   command string.

5. `join` it, and `inspect` after every `STATUS=RUNNING`, as the thread skill describes. If the child ends with a
   question, answer it only when the brief or this conversation already makes the answer clear. Otherwise bring the
   question back to the user instead of guessing.
6. When it exits, `read` the thread for the exit code, then read `/tmp/<name>.out`. If the exit code is non-zero, read
   the tail of `/tmp/<name>.err` as well. For a long answer, read the summary and the paths it cites rather than every
   line. If the child changed files, inspect the diff before you trust the result.
7. Reply with the child's answer, trimmed to what the user needs. State the model the child ran on, the exit code, and
   any part that looks incomplete or unverified. Do not present a child's guess as this session's finding.

## Model and thinking level

The child follows this session's model and thinking level unless the user overrides them. Pi exports `PI_PROVIDER`,
`PI_MODEL` and `PI_REASONING_LEVEL` to every Bash command, so read them there; do not guess.

- **Default:** the flags in step 4, expanded in the parent shell.
- **Override:** when the user names a model ("use haiku", "run it on sonnet:high"), remove that instruction from the
  task text and pass the value as `--model <value>`. Keep `--thinking "$PI_REASONING_LEVEL"` unless the value ends in a
  known level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Pi model IDs can also contain a colon, so do
  not split on the last colon.
- **Fallback:** if `PI_MODEL` is empty, pass no model flags and tell the user the child ran on Pi's configured defaults.
- Never pick a cheaper or stronger model on your own.

## Multi-round child

Use RPC only when the child must ask questions or take steering. Start it persistent and talk in JSON lines. Redirect
stdout to a file so a long answer does not scroll out of the pane:

```bash
"$S" spawn --persistent "$NAME" -- "pi --mode rpc --no-session $MF >/tmp/$NAME.rpc.jsonl 2>/tmp/$NAME.err"
"$S" send "$NAME" '{"id":"1","type":"prompt","message":"Read /tmp/sub-auth-review.task.md and follow it."}'
```

RPC does not expand `@file` arguments, so point the child at the brief path in the message. Wait for the `agent_settled`
event, not `agent_end`: retries, compaction, steering and follow-up work can still follow an `agent_end`. Then take the
last assistant message:

```bash
jq -r 'select(.type=="message_end" and .message.role=="assistant")
       | .message.content | map(select(.type=="text") | .text) | join("\n")' /tmp/$NAME.rpc.jsonl >/tmp/$NAME.answer.md
```

Then read `/tmp/$NAME.answer.md`.

A persistent child is idle by design while it waits for the next message, so a quiet pane is not a hang; judge it by the
JSONL file and by `CPU_ACTIVE`. Do not `join` a persistent thread. Close it when the exchange is over.

## Parallel children

Independent tasks can run at the same time as separate `sub-*` threads. Give each a distinct name and a separate brief,
join each one, and expect the 8-thread cap from the thread skill. Parallel only pays when the children do not edit the
same files or wait on each other. If the tasks share state, run them one after another.

## Finish

`read` closes a finished tab. Run `sweep` as the last action before your final reply, even when every child is finished:
it closes finished tabs and may remove the thread session that `init` created for this task. Read its `SESSION_REMOVED`
or `SESSION_KEPT` output. Ask the user whether to kill any child that is still running. If `thread` or zellij is
unavailable, report that; do not fall back to a blocking child in this shell, which would leave no way to inspect or
stop it.
