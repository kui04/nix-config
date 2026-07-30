# Zellij CLI Reference (condensed, task-oriented)

Everything here is reached through two entry points: top-level session
commands (`zellij list-sessions`, `zellij attach`, `zellij kill-session`,
`zellij delete-session`, `zellij kill-all-sessions`) and
`zellij [--session <name>] action <subcommand> [...]`. Add `--session <name>`
before `action` to target a background session instead of "whatever session
this shell is inside" (which, for an agent, is normally none — always pass
`--session` explicitly).

## Detecting a nested session

Every pane started by Zellij gets three environment variables:

- `ZELLIJ` — set to `0` (just a presence marker) when the shell is running
  inside a Zellij pane.
- `ZELLIJ_SESSION_NAME` — the name of the enclosing session.
- `ZELLIJ_PANE_ID` — the bare numeric id of the pane itself (equivalent to
  `terminal_<id>`).

`ZELLIJ_SESSION_NAME` is *not* updated in already-running panes if the
session is later renamed with `rename-session` — only new panes see the
new name. If a session was recently renamed, re-resolve the name via
`zellij action current-tab-info` from a fresh pane rather than trusting a
stale environment variable.

## Session lifecycle

| Goal | Command |
|---|---|
| Create a headless session (no terminal attaches) | `zellij attach --create-background <name>` |
| ...with a starting layout | `zellij attach --create-background <name> options --default-layout <name-or-path>` |
| List sessions | `zellij list-sessions` / `zellij list-sessions --short` |
| Kill (stop) a session | `zellij kill-session <name>` |
| Delete a session's resurrection metadata | `zellij delete-session <name>` (`--force` to kill first if still running) |
| Kill everything | `zellij kill-all-sessions --yes` |

Zellij keeps a dead session's pane/tab layout around for possible
"resurrection" (`session_serialization`) unless it's explicitly deleted —
worth knowing if `list-sessions` shows sessions that aren't actually running.

## Creating panes and tabs

`new-pane` (alias: `zellij run`) and `new-tab` both print the created
resource's ID on stdout, which is how scripts chain follow-up commands.

Key `new-pane` flags:

- `-- <command>` — run this instead of the default shell (bypasses shell
  quoting; makes exit status observable).
- `-n/--name <name>` — label shown on the pane frame.
- `--cwd <dir>` — working directory.
- `-f/--floating` (with `--x/--y/--width/--height`, values are integers or
  percentages) vs `-d/--direction right|down` vs default (largest free
  space) vs `--tab-id <id>` (open in a specific tab without switching to it).
- `-c/--close-on-exit` — pane disappears the instant its command exits.
- Blocking: `--blocking` (wait for the pane to be closed by hand),
  `--block-until-exit` (wait for the command to exit, any status),
  `--block-until-exit-success` / `--block-until-exit-failure` (wait for a
  specific exit status; on the "wrong" status the pane stays open showing
  the failure and the caller can retry by sending `Enter` to that pane —
  `zellij action send-keys --pane-id <id> "Enter"`).

`new-tab` takes the same trailing `-- <command>`, plus `--layout <path>`,
`--layout-string '<kdl>'`, `--cwd`, `--name`, and the same
`--block-until-*` flags for its initial pane.

## Sending input

- `paste --pane-id <id> "<text>"` — bracketed-paste mode; handles multi-line
  text safely. Does **not** press Enter.
- `send-keys --pane-id <id> "Enter" "ctrl c" ...` — named keys, space
  separated (`"Ctrl a"`, `"F1"`, `"Alt Shift b"`).
- `write-chars --pane-id <id> "<text>"` — character-by-character; slower,
  mainly useful when an app doesn't handle bracketed paste correctly.
- `write --pane-id <id> <byte> <byte> ...` — raw bytes, for control
  sequences that have no named key.

## Reading output

- `dump-screen [--pane-id <id>] [--full] [--ansi] [--path <file>]` —
  one-shot snapshot of the current viewport; `--full` includes scrollback;
  `--ansi` keeps color/styling codes (otherwise plain text); no `--path`
  means stdout. Good for polling loops and "read the final result". If
  `--pane-id` is omitted it defaults to whatever pane is currently
  *focused* — always pass `--pane-id` explicitly for automation, otherwise
  a read can silently return whatever tab a human happens to be looking at
  instead of the intended one. Verified against Zellij 0.44.3: with
  `--pane-id` given, `dump-screen` returns that pane's real content
  correctly even while a different tab is focused — targeting genuinely
  does not depend on focus, only the omitted-flag default does.
- `zellij [--session <name>] subscribe --pane-id <id> [--pane-id <id> ...] \`
  `[--format raw|json] [--scrollback [<n>]] [--ansi]` — delivers the current
  viewport immediately, then streams every subsequent change; exits once all
  watched panes close. `--format json` emits NDJSON:
  `{"event":"pane_update","pane_id":...,"viewport":[...],"is_initial":bool}`
  and `{"event":"pane_closed","pane_id":...}` — pipe into `jq` to filter
  (e.g. `select(.event=="pane_update") | .viewport[] | select(test("ERROR"))`).
  Use `dump-screen` for "what's on screen right now / poll every few
  seconds"; use `subscribe` for "tell me the moment X happens".

## Querying state as structured data

- `list-panes [--json] [--all|-t -c -s -g]` — every pane's id, title,
  command, cwd, focus/floating/exited state, geometry, owning tab.
- `list-tabs [--json] [--all|-s -d -p -l]` — every tab's id, position, name,
  active/fullscreen/sync-panes/floating-visible state, pane counts.
- `current-tab-info [--json]` — same shape as one `list-tabs` entry, for
  the active tab.
- `list-clients` — connected clients, their focused pane, and what's
  running there.
- `query-tab-names` — plain-text list of tab names.

Typical use: `list-panes --json | jq '.[] | select(.id==5) | .exited'` to
poll whether a directly-launched command has finished (pairs with
`new-pane -- <command>`, as an alternative to `--block-until-exit*`).

## Floating panes as an "out of the way" background slot

Floating panes can be shown/hidden as a group without closing anything —
handy for a long task you want out of sight most of the time:

```
zellij action new-pane --floating --name "watch" -- <command>
zellij action hide-floating-panes     # tuck it away
zellij action show-floating-panes     # bring it back to check progress
zellij action are-floating-panes-visible   # exit 0 = visible, 1 = hidden
```

`toggle-pane-embed-or-floating --pane-id <id>` moves a single pane between
tiled and floating. `change-floating-pane-coordinates` repositions/resizes
one after creation. `--borderless true` plus `--pinned true` on `new-pane`
turns a floating pane into a frameless, always-on-top overlay — the pattern
used for tiny live status widgets (a resource meter, a git-branch readout)
that sit on top of everything else without looking like a "pane" at all.

## Layouts

- `new-tab --layout <path-or-name>` / `--layout-string '<kdl>'` — start a
  tab from a layout file or an inline KDL string (no temp file needed for
  small/dynamic layouts).
- `override-layout <path> [--layout-string ...] [--retain-existing-terminal-panes] [--retain-existing-plugin-panes] [--apply-only-to-active-tab]`
  — swap the active tab's layout at runtime.
- `dump-layout` — print the current session's layout as KDL (useful for
  capturing a hand-built arrangement to reuse later).

A layout is the fastest way to stand up a whole multi-pane environment
(editor + server + logs + shell) with a single `new-tab --layout ...` call
instead of several `new-pane` calls.

## Tabs always take focus

Unlike `new-pane` (which has `--tab-id` to add a pane to another tab
without switching to it), `new-tab` has no equivalent "create without
focusing" flag — the newly created tab always becomes the active one. If
that's disruptive (e.g. it would yank a human's attention away from
whatever tab they're currently looking at), read which tab is currently
active *before* creating the new one, and jump back right after:

```
CUR=$(zellij action list-tabs --json | jq -r '[.[] | select(.active==true)] | first | .tab_id // empty')
NEW=$(zellij action new-tab --name "task" -- <command>)
[ -n "$CUR" ] && zellij action go-to-tab-by-id "$CUR"
```

Prefer `list-tabs` (as above) over `current-tab-info` for this: the latter
errors ("No active tab found for current client") when no real client is
attached, e.g. in a purely headless background session with nobody looking
at it — `list-tabs`'s `active` field is simply empty/absent in that case,
which is easy to handle and means "no one to disturb, skip the restore".

The new tab keeps running regardless of which tab is focused — focus only
affects what's on screen, not whether a pane's process is alive.

## Addressing tabs/panes by name instead of numeric ID

Numeric pane/tab IDs returned by `new-pane`/`new-tab` are only useful
within the same calling process — they won't be remembered by a *separate*
later tool invocation unless something explicitly persists them. Names
are the durable handle instead:

- `list-tabs --json | jq '.[] | select(.name == "build")'` — find a tab by
  name; take `.tab_id`.
- `list-panes --json | jq '.[] | select(.tab_id == <id> and .is_plugin == false)'`
  — find that tab's terminal pane; take `.id`. A freshly spawned task tab
  has exactly one such pane.
- `go-to-tab-name <name> [--create]` — switch focus to a tab by name
  directly (optionally creating it if missing), no ID lookup needed at all
  when the goal is just "look at this tab", as opposed to reading/writing
  its content programmatically.
- `close-tab [--tab-id <id>]` (defaults to current tab) / `close-tab-by-id
  <id>` — both work; `close-tab --tab-id <id>` doesn't require the target
  tab to be focused first.
- `focus-pane-id <id>` — focus a specific pane (and its tab) by ID.

## First-run overlays in a freshly created session

The first time Zellij ever creates a session on a machine, and again right
after a version upgrade, it can add a focused, floating plugin pane to the
default tab — a "First Run Setup Wizard" or "Release Notes" overlay.
Confirmed on 0.44.3: right after `attach --create-background`, `list-panes
--json` can show two entries with `is_focused: true` at once (one floating
plugin pane, one tiled terminal pane — floating and tiled panes track focus
independently). This lives only in the original default tab, never in a
tab your own automation creates, so it doesn't interfere with a
name-addressed workflow — but it can surprise anything that assumes "the
session's first/focused pane is my shell". Run `zellij setup --dump-config
> ~/.config/zellij/config.kdl` once per machine to suppress it entirely.

## Shell portability: /bin/sh vs bash

Some tool runners execute shell commands via `/bin/sh`, which on Debian/
Ubuntu-based systems (and this sandbox, confirmed by checking `$0`/`/proc/
$$/exe`) is `dash`, not `bash`. Dash doesn't support `<<<` here-strings,
`[[ ]]`, arrays, or `local`. A snippet like
`read -r TAB_ID PANE_ID <<< "$(cmd)"` typed directly as a top-level command
fails with a syntax error under dash, silently breaking whatever came after
it in the same line (e.g. leaving a variable unset, which then causes a
following `--pane-id "$PANE_ID"` to be passed as an empty flag, which some
CLIs interpret as "unset", falling back to a focus-dependent default). A
script file with a `#!/usr/bin/env bash` shebang is unaffected *when
invoked directly* (`scripts/spawn.sh ...`) — the kernel honors the shebang
regardless of the calling shell. It's typing bash-only syntax straight into
a raw multi-line command that's the risk, not the scripts themselves.

## Concurrency notes

Each `zellij action ...` invocation is a short-lived process: it connects,
sends one message, disconnects. Chained actions (`&&`) are processed in
order. Actions from independent concurrent processes have no ordering
guarantee relative to each other, but reads (`list-panes`, `dump-screen`,
etc.) are always safe to issue mid-mutation — they return a consistent
snapshot. Avoid two processes writing to the same pane at once; funnel
writes to a given pane through one caller.
