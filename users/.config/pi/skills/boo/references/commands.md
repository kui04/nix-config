# boo command reference

Full flag reference for every boo subcommand. Read this when the core loop in SKILL.md isn't enough — e.g. you need session management (`attach`, `rename`, `ui`), exact exit codes, or installation details.

## Contents
- Installation
- Session lifecycle: `new`, `ls`, `attach`, `rename`, `kill`, `ui`
- Automation primitives: `send`, `wait`, `peek`
- Exit codes
- Design notes (why boo instead of screen/tmux)

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/coder/boo/main/install.sh | sh
```

- Set `BOO_VERSION` before running to pin a specific release instead of latest.
- Set `BOO_INSTALL_DIR` to change the install location. Default is `/usr/local/bin` if writable, otherwise `~/.local/bin`.
- Pre-built binaries are also published on the GitHub releases page for manual installation.

Run `boo help` for the full command overview, `boo help <command>` for flags and examples on one command, or `boo help --all` to print every help page at once.

## Session lifecycle

### `boo new [name] [-d] [-- command...]`
Creates a session.
- `boo new` — new session running `$SHELL`, attached to your current terminal.
- `boo new work` — same, but named `work` instead of an auto-generated name.
- `boo new work -d -- make` — create **detached** (headless, `-d`), running `make` instead of a shell. This is the form almost always used for automation.
- If you omit a name, boo names the session after the current working directory, falling back to the process id if that name is already taken or otherwise unusable.

### `boo ls [--json]`
Lists sessions. Add `--json` for machine-readable output when scripting decisions on session state.

### `boo attach <name>` (aliases: `at`, `a`)
Reattaches a human terminal to a running session. Not useful from an agent context without a TTY — use `peek` instead to read session state.

### `boo rename <old> <new>`
Renames a session.

### `boo kill <name>` / `boo kill --all`
Ends one session, or every session boo knows about. Always clean up sessions you created once you're done with them — they don't expire on their own.

### `boo ui` (alias: `i`)
Full-screen interactive UI for managing sessions. Human-facing only; not relevant for headless/agent use.

## Automation primitives

### `send` — typing into a session
```bash
boo send <name> --text '<literal text>' [--enter]
boo send <name> --key <KeyName>[,<KeyName>...]
```
- `--text` is **literal**: no escape processing, no implicit newline, no quoting layer to fight. What you pass is exactly what's typed.
- `--enter` submits the text (equivalent to pressing Enter after it).
- `--key` sends named control keys instead of literal text, e.g. `--key Enter`, `--key C-c` (Ctrl-C), `--key Up`. Multiple keys can be comma-separated: `--key C-c,Enter`.
- stdin mode is binary-safe, for piping raw bytes into a session if needed.

### `wait` — blocking until a condition is met
```bash
boo wait <name> --idle [--timeout <duration>]
boo wait <name> --text '<string>' [--timeout <duration>]
```
- `--idle` blocks until the session's output has been quiet for 2 seconds. Good default after sending a command whose completion you can't easily string-match.
- `--text '<string>'` blocks until the given string appears anywhere on the reconstructed screen. Prefer this over `--idle` whenever you know what the success or error output looks like — it's more precise and often faster.
- `--timeout <duration>` caps how long to wait; without it, `wait` can block forever. Accepts durations like `500ms`, `2s`, `1m`, `4h`, `1d`. On timeout, `wait` exits with code `4` rather than the process hanging.
- No more sleep-and-poll loops: this replaces manually sleeping and re-checking output.

### `peek` — reading session state
```bash
boo peek <name> [--scrollback] [--json]
```
- Prints the **rendered screen reconstructed from terminal state** — ordered, fully redrawn, and stable. This is not a raw byte log of everything the program ever printed; it's what would actually be visible on screen.
- `--scrollback` includes scroll history, not just the currently visible screen.
- `--json` adds structured metadata: terminal size, cursor position, and session title, in addition to content.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | error |
| 2 | usage error (bad flags/arguments) |
| 3 | no such session |
| 4 | `wait` timed out |

Check for `4` specifically when you want to distinguish "the condition never happened in time" from a genuine tool error (`1`) or a typo'd session name (`3`).

## Design notes

boo is architecturally similar to GNU screen — it parses all session output through its own terminal emulator and redraws from that reconstructed state on read/reattach, rather than storing a raw byte log. The difference is the emulator: boo uses `libghostty-vt` (Ghostty's VT core) instead of screen's much older one, so the reconstructed state matches what a modern terminal program actually emits, and terminal queries get answered even while a session is detached (so TUIs don't hang waiting for a response that never comes).

Compared to tmux: tmux solves general-purpose multiplexing well but isn't designed around scriptable automation. boo's `send` / `peek --json` / `wait --text|--idle` primitives replace the `-X stuff` / hardcopy-file / sleep-loop patterns you'd otherwise reach for when scripting against a screen or tmux session.