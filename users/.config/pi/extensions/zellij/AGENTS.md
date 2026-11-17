# AGENTS.md

Scope: `users/.config/pi/extensions/zellij/` (human overview lives in [README.md](./README.md)).

## Validation

- Run `devenv shell -- npm run check` from `users/.config/pi/` (`tsc --noEmit`, `eslint .`, and `prettier --check .`);
  there is no local `package.json` in this directory.

## Extension Runtime Constraints

- Keep `index.ts` as the only extension entry point in this folder; Pi's loader (`loader.js`) discovers
  `extensions/*/index.ts` and does not recurse deeper.
- Keep imports from `@earendil-works/pi-coding-agent` type-only (`import type`); runtime imports from its barrel add
  ~250ms to startup (see `../rtk.ts`).
- Keep the `PI_ZELLIJ_SUBAGENT=1` early return in `index.ts` and env prefix in `tools.ts` so child `pi` subagents do not
  run a nested orchestrator.
- Do not dispose `PaneWatcher` on `session_before_switch`; other extensions can cancel the switch, so tear down only in
  `session_shutdown`.

## Zellij 0.46.0 CLI Invariants

- Wrap `new-tab` and `new-pane` in `withTemporaryClient` with `ZELLIJ*` env vars stripped; Zellij 0.46 drops tabs or
  rejects `new-pane` when zero clients are attached.
- Keep the `new-pane` + `stack-panes` fallback in `session.ts`; Zellij 0.46 can report `No room for a new pane` on
  `--stacked` for unfocused tabs after client detach.
- Always pass `--` before positional arguments to `zellij action write-chars`, `send-keys`, and `rename-pane`.
