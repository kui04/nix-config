# AGENTS.md Examples & Templates

Use these canonical examples and templates from `https://github.com/agentsmd/agents.md` and its featured repositories as
structural models. Always replace commands, paths, and conventions with facts verified from the target repository.

## 1. Minimal Single-Project Template (`agentsmd/agents.md` Hero)

Use for small, single-package repositories where setup, test, and style conventions fit in 20 lines:

```markdown
# AGENTS.md

## Setup commands

- Install deps: `pnpm install`
- Start dev server: `pnpm dev`
- Run tests: `pnpm test`

## Code style

- TypeScript strict mode
- Single quotes, no semicolons
- Use functional patterns where possible
```

## 2. Monorepo / Workspace Template (`agentsmd/agents.md` Sample)

Use for workspace repositories (`pnpm`, `turbo`, `cargo`, `uv`, `nx`) where agents need package-navigation tips and
filtered test/lint commands:

```markdown
# AGENTS.md

## Dev environment tips

- Use `pnpm dlx turbo run where <project_name>` to jump to a package instead of scanning with `ls`.
- Run `pnpm install --filter <project_name>` to add the package to your workspace so Vite, ESLint, and TypeScript can
  see it.
- Check the `name` field inside each package's `package.json` to confirm the right name—skip the top-level one.

## Testing instructions

- Find the CI plan in the `.github/workflows` folder.
- Run `pnpm turbo run test --filter <project_name>` to run every check defined for that package.
- From the package root you can just call `pnpm test`. The commit should pass all tests before you merge.
- To focus on one step, add the Vitest pattern: `pnpm vitest run -t "<test name>"`.
- Fix any test or type errors until the whole suite is green.
- After moving files or changing imports, run `pnpm lint --filter <project_name>` to be sure ESLint and TypeScript rules
  still pass.
- Add or update tests for the code you change, even if nobody asked.

## PR instructions

- Title format: `[<project_name>] <Title>`
- Always run `pnpm lint` and `pnpm test` before committing.
```

## 3. Interactive Dev-Server Guardrails (`agentsmd/agents.md` Repository)

Use when a repository runs a hot-reloading development server (Next.js, Vite, Remix, Cargo watch) and certain commands
corrupt the interactive session state:

```markdown
# AGENTS Guidelines for This Repository

## 1. Use the Development Server, not `npm run build`

- Always use `npm run dev` (or `pnpm dev`) while iterating on the application. This starts Next.js in development mode
  with hot-reload enabled.
- Do not run `npm run build` inside the agent session. Running the production build switches the `.next` folder to
  production assets, which disables hot reload and leaves the development server in an inconsistent state.

## 2. Keep Dependencies in Sync

If you add or update dependencies:

1. Update the lockfile (`pnpm-lock.yaml`).
2. Restart the development server so Next.js picks up the changes.

## 3. Useful Commands Recap

| Command         | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| `pnpm run dev`  | Start the Next.js dev server with HMR.                    |
| `pnpm run lint` | Run ESLint checks.                                        |
| `pnpm run test` | Execute the test suite.                                   |
| `pnpm build`    | Production build — do not run during interactive sessions |
```

## 4. Large Production Repository Pattern (`apache/airflow` & `temporalio/sdk-java`)

Use for complex repositories with strict architecture boundaries, custom test runners, generated command blocks, and
explicit safety boundaries:

```markdown
# AGENTS.md

## Repository Layout

- `core/`: core engine, scheduler, and domain models.
- `sdk/`: public client SDK. Anything under `internal/` is private and may change freely; avoid changing public API
  signatures outside `internal/`.
- `providers/`: plugin packages, each with its own manifest.
- `scripts/ci/`: CI verification and pre-commit hook scripts.

## Environment & Commands

`<PACKAGE>` is the directory containing the target package manifest (for example, `core` or `providers/http`).

<!-- START generated-commands, please keep comment here to allow auto update -->

- **Run a single test**: `uv run --project <PACKAGE> pytest path/to/test.py::TestClass::test_name -xvs`
- **Run a test file**: `uv run --project <PACKAGE> pytest path/to/test.py -xvs`
- **Run package test suite**: `uv run --project <PACKAGE> pytest`
- **Format and lint a file (run immediately after every edit)**:
  `uv run ruff format <file> && uv run ruff check --fix <file>`
- **Type-check**: `prek run mypy-<PACKAGE> --all-files`
- **Run fast pre-commit checks**: `prek run --from-ref main --stage pre-commit`
<!-- END generated-commands, please keep comment here to allow auto update -->

## Architecture Boundaries

1. Workers execute tasks via `sdk` and communicate with the API server over the Execution API — workers never access the
   metadata database directly.
2. Scheduler reads serialized definitions and never executes user code.
3. Database cleanup queries in synchronous loops must batch writes with `LIMIT` and commit between batches.

## Coding & Testing Standards

- Comment only when context is not apparent from the code (record constraints, invariants, or compatibility traps; never
  narrate what the next line does).
- Target 100% test coverage of changed behavior. Every test must fail without the change.
- Mirror source paths in tests: `core/src/app/cli/parser.py` -> `core/tests/cli/test_parser.py`.

## Boundaries

- **Ask first**
  - Large cross-package refactors.
  - New dependencies with broad impact.
  - Destructive data or schema migration changes.
- **Never**
  - Commit secrets, credentials, or tokens.
  - Edit generated files by hand when a generation workflow exists.
  - Run destructive git operations unless explicitly requested.
```

## 5. Nested Subdirectory `AGENTS.md` (`openai/codex` Pattern)

Place a short `AGENTS.md` inside a subdirectory when a module has local state machines, generated artifacts, or doc
synchronization rules that only matter when editing files in that subtree. Keep it under 25 lines:

```markdown
# TUI bottom pane (state machines)

When changing the paste-burst or chat-composer state machines in this folder, keep the docs in sync:

- Update the relevant module docs (`chat_composer.rs` and/or `paste_burst.rs`) so they remain a readable, top-down
  explanation of the current behavior.
- Keep implementations and docstrings aligned unless a divergence is intentional and documented.

Practical check:

- After edits, verify that docs mention only APIs and behavior that exist in code (especially the Enter/newline paths
  and `disable_paste_burst` semantics).
```

## 6. Nix Flake / Declarative Configuration Template

Use for NixOS, Home Manager, or `flake.nix` repositories:

```markdown
# AGENTS.md

## Repository Layout

- `flake.nix` / `flake.lock`: flake inputs, outputs (`nixosConfigurations`, `homeConfigurations`, `formatter`).
- `hosts/<hostname>/`: machine-specific NixOS hardware and system modules.
- `users/<username>/`: Home Manager entrypoints; shared modules live in `users/.shared/` and dotfiles in
  `users/.config/`.
- `common/` & `services/`: reusable NixOS modules.
- `secrets/`: `agenix`-encrypted secrets (`*.age`).

## Commands

- **Format all files (Nix, Markdown, shell)**: `nix fmt`
- **Check formatting without writing**: `nix fmt -- --fail-on-change`
- **Verify flake evaluation**: `nix flake check --no-build`
- **Dry-build a NixOS host**: `nixos-rebuild dry-build --flake .#<hostname>`
- **Dry-build a Home Manager config**: `home-manager build --flake .#<username> --dry-run`

## Conventions & Boundaries

- Run `nix fmt` after editing `.nix`, `.md`, or `.sh` files (`nixfmt`, `prettier --print-width 120 --prose-wrap always`,
  `shfmt -i 4`).
- Never edit files inside `/nix/store` or generated symlink targets in `$HOME`; edit the source file under
  `users/.config/` or `users/.shared/`.
- **Ask first** before running `nixos-rebuild switch`, `home-manager switch`, `nix flake update`, or any git
  stage/commit command.
- **Never** commit plaintext secrets; all secrets belong in `secrets/*.age`.
```
