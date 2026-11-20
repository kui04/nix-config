# AGENTS.md

Scope: `users/.config/pi/extensions/zellij/` (human overview lives in [README.md](./README.md)).

## Validation

- Run `devenv shell -- npm run check` from `users/.config/pi/` (`tsc --noEmit`, `eslint .`, and `prettier --check .`);
  there is no local `package.json` script in this directory.
- Run `devenv shell -- node --test extensions/zellij/test/*.test.ts` from `users/.config/pi/` to verify the `bash`
  guard, identifier checks, and JSON parsers.

## Extension Runtime Constraints

- Keep `index.ts` at this directory root as a thin re-export of `./src/index.ts`; Pi's loader (`loader.js`) discovers
  `extensions/*/index.ts` without needing a `package.json` manifest.
- Keep imports from `@earendil-works/pi-coding-agent` type-only (`import type`); runtime imports from its barrel add
  ~250ms to startup (see `../rtk.ts`).
- Keep the `PI_ZELLIJ_SUBAGENT=1` early return in `src/index.ts` and env prefix in `src/tools.ts` so child `pi`
  subagents do not run a nested orchestrator.
- Do not dispose `PaneWatcher` on `session_before_switch`; other extensions can cancel the switch, so tear down only in
  `session_shutdown`.
- Keep `registerZellijTools` wiring the pane-finalized listener and keep `suppressPaneNotify`/`releasePaneNotify`
  balanced; they wake waits on manager-side closes and prevent duplicate followUps.
- Keep finished-pane retention bounded: `rememberFinishedPane` must delete the evicted pane's `logPath` and `briefPath`.

## Zellij 0.46.0 CLI Invariants

- Wrap `new-tab` and `new-pane` in `withTemporaryClient` with `ZELLIJ*` env vars stripped; Zellij 0.46 drops tabs or
  rejects `new-pane` when zero clients are attached.
- Keep the `new-pane` + `stack-panes` fallback in `src/session.ts`; Zellij 0.46 can report `No room for a new pane` on
  `--stacked` for unfocused tabs after client detach.
- Always pass `--` before positional arguments to `zellij action write-chars`, `send-keys`, and `rename-pane`.
- Pass `--no-pane-name --no-tab-name` to `zellij prompt notify` and resolve `ZELLIJ_PANE_ID` from an attached user
  client row in `list-clients` (excluding the persistent helper client); `zellij prompt notify` fails when
  `ZELLIJ_PANE_ID` is unset or non-numeric.
- Omit `--notify` (`watch-pane`) on `service` and `rpc` subagent panes, and treat `attention` events with
  `from_watch: true` (or `source === "Watch"` with `text === "went quiet"`) as quiet-watch timers that require
  `INTERACTIVE_PROMPT_RE` verification.
