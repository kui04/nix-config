---
name: agents-md
description: >-
  Create, update, or trim AGENTS.md files, for the repository root and for nested package directories. Use when a
  repository has no agent instructions, when an existing AGENTS.md is stale or bloated and the user asks to review,
  audit, or clean it, or when migrating CLAUDE.md, .cursorrules, or .github/copilot-instructions.md to AGENTS.md. Also
  use when the user says "add agent instructions", "document this repo for agents", or "keep agent docs in sync", even
  without naming the file. Not for README files, human documentation, or skills.
---

# AGENTS.md

`AGENTS.md` loads into every session, so every line spends context on every turn. Two properties of the file decide what
goes in.

- A repository overview does not shorten the search. The agent reads the tree and the files it needs on the way, so a
  map of the directories buys nothing and costs a paragraph every turn.
- Whatever you write down gets done. A tool named in the file is used; a tool named nowhere stays unused. The agent also
  takes more steps and thinks longer when the file asks for more, so an instruction that prevents no mistake is cost
  without return.

So a line pays for itself only when the wrong turn it prevents costs more than following it does. This skill builds that
file, and it accepts "no file" as an answer.

## The gate: value over toll

Judge every candidate line three times, in this order.

- **Reachable**: would the agent find this on the path it already takes, by reading `README.md`, the manifest, or the
  file it is about to edit? If yes, delete the line. `README.md` is a pointer target, never a source: a copy of it costs
  context and gives back what the agent can already read.
- **Value**: does the line stop one expensive wrong turn that the agent would not otherwise avoid? A wrong build
  command, an edit of a generated file, a missing environment variable, a boundary the compiler cannot see.
- **Toll**: does the line add a step to every task? "Always write a failing test first" adds several. "Use `make build`"
  adds none, because the agent builds anyway.

Keep the line only when it is not reachable, and value beats toll. Accept a line only with a source: a CI workflow, a
task-runner target, a `git log` correction, or the user's own statement. A line whose only source is general practice is
a no-op: the model already does it, and now pays for it on every turn.

## Choose the channel

Most candidates belong somewhere other than `AGENTS.md`. The channel decides when the text loads, and whether the model
or the harness enforces it.

| The fact is                                               | The channel                                               |
| --------------------------------------------------------- | --------------------------------------------------------- |
| Visible by reading the codebase (layout, stack, overview) | Nowhere. The agent reads it.                              |
| Mechanical, and a tool can check it                       | Formatter, linter, or CI configuration.                   |
| Must always happen or never happen                        | Hook, deny rule, or CI check. The harness enforces these. |
| Needed only for some tasks                                | A skill, or a doc behind a pointer.                       |
| Needed only under one directory or file glob              | Nested `AGENTS.md`, or a `paths:`-scoped rule.            |
| Needed everywhere, on every task                          | Root `AGENTS.md`.                                         |

Two facts about loading. An `@path` import costs the same context as inline text. Nested files must only add rules:
Claude Code concatenates them and may pick either side of a contradiction, and Codex appends them in path order, then
drops everything past its size limit without a message.

## Create

### 1. Collect evidence

Read only what can source a line:

- CI workflows and pre-commit configuration: the commands that gate a merge.
- The task runner (`Makefile`, `justfile`, `package.json` scripts, `flake.nix`): the wrappers that carry required flags.
- The lockfile: only to name the package manager once.
- `README.md`, `CONTRIBUTING.md`, and any older agent file: to avoid copying them.

Treat harness-generated output (`/init`) as candidate material, then expect to delete most of it. It describes the
repository, and descriptions fail the gate.

Do not write a directory map. When the layout carries meaning, write the meaning: which package owns a feature, which
package may import which.

### 2. Draft candidates

Write a flat list. One line per candidate, source beside it. Write no prose, no headings, no sections yet. Drafting and
cutting are different tasks, and a line written to fill a heading outlives the heading's reason.

### 3. Cut

Cut in a second pass, after the draft exists. Apply the gate line by line. Delete a whole line rather than trim its
wording. When a candidate needs a paragraph to justify it, the paragraph is the signal to drop the candidate. Group the
survivors under two or three plain headings; an empty heading goes.

### 4. Verify

- Run every command in the draft, once, in this repository.
- Run the repository's Markdown formatter on the result, when it has one.
- Check that every path exists.
- Compare with parent and child `AGENTS.md` files: additions only, no contradictions.
- Compare with `README.md`: delete every line that restates it, and point at the file instead.
- Compare the size with the harness limit. Codex reads 32 KiB for project instructions by default and drops the rest
  without a message. Claude Code reads on-demand files up to 40,000 characters in a 200K window.
- Measure what the cut removed: `grep -c '^[-*] '` on the draft and on the result. Line count is not a measure, because
  a Markdown formatter rewrites line breaks and moves the count while the content stays.

### 5. Deliver

Show a table of line to source, then the diff. Ask before you rewrite a file you did not write.

## Decline

When every candidate fails the gate, say so and stop. Report that no file is needed, and list the rejected candidates
with the reason. An absent file beats a file of true but useless lines: the true lines still cost steps, and the absent
file costs nothing.

## Audit an existing file

Read the file, then read the repository. Then:

1. Run its commands. Delete a command that fails, or that no longer matches CI.
2. Delete every line that fails the gate, and every line that a formatter, linter, or CI check now enforces.
3. Find contradictions inside the file, and against parent and child files.
4. When the cut removes most of the file, deliver a rewrite rather than a patch. These files grow by small appends, so
   the sediment is where the bloat lives, and a patch preserves it.
5. Repeat the size and path checks from Verify.

## Reference

`references/rewrites.md`: read it when cutting an existing file, or when a draft looks complete but reads long. It holds
one before/after rewrite with the reason for each deletion, a table of vague instructions replaced by usable ones, and
two files whose size shows the target.
