# AGENTS.md section catalog

No sections are required — AGENTS.md is plain Markdown. This catalog covers the
sections that appear most often in well-maintained files, what belongs in each, and
where in a repo to mine the facts. Pick only what the project needs; a lean file that
is all signal beats an exhaustive one.

## Project overview

**What:** 1–3 sentences on what the project is and how the repo is laid out. For
monorepos, a map of packages and how to navigate them.

**Mine from:** README intro, top-level directory listing, workspace config
(`pnpm-workspace.yaml`, `turbo.json`, `Cargo.toml` workspace members, `go.work`).

**Pattern:**
```markdown
- Use `pnpm dlx turbo run where <project_name>` to jump to a package instead of
  scanning with `ls`.
- Check the `name` field inside each package's package.json to confirm the right
  name—skip the top-level one.
```

## Dev environment / setup commands

**What:** One-time and per-session setup: dependency install, required tools, dev
server, code generation needed before anything compiles. Include tools the repo
relies on that may not be installed (`just`, `rg`, `uv`, `bun`…).

**Mine from:** README "Getting started", `CONTRIBUTING.md`, `package.json` scripts,
`pyproject.toml`/`uv.lock`, `.tool-versions`, `mise.toml`, devcontainer config.

**Pattern:**
```markdown
- Install deps: `pnpm install`
- Start dev server: `pnpm dev`
- Install any commands the repo relies on (for example `just`, `rg`, or
  `cargo-insta`) if they aren't already available before running instructions here.
```

## Build and test commands

**What:** The exact commands to build, run the full suite, run a single test, lint,
and typecheck. This is the highest-value section: agents will execute these and try
to fix failures before finishing, so they must be exact.

**Mine from:** CI workflow files (`.github/workflows/*.yml` is the ground truth —
it shows what "green" means), `package.json` scripts, `Makefile`/`justfile`,
`tox.ini`, `noxfile.py`.

**Patterns:**
```markdown
- Run tests: `pnpm test`
- Run `pnpm turbo run test --filter <project_name>` to run every check defined for
  that package.
- To focus on one step, add the Vitest pattern: `pnpm vitest run -t "<test name>"`.
- **Run a single test:** `uv run --project <PROJECT> pytest path/to/test.py::TestClass::test_method -xvs`
```
Note the parametrized `<PLACEHOLDER>` style — give the agent the shape of the
command, not just the all-tests variant.

## Testing instructions

**What:** Conventions beyond the commands: where tests live, what to add tests for,
coverage expectations, what "done" means before merge.

**Mine from:** `CONTRIBUTING.md`, existing test layout, CI required checks.

**Pattern:**
```markdown
- Find the CI plan in the .github/workflows folder.
- Fix any test or type errors until the whole suite is green.
- Add or update tests for the code you change, even if nobody asked.
```

## Code style guidelines

**What:** Rules a linter won't catch or that the agent would otherwise get wrong:
naming conventions, formatting choices, preferred idioms, deprecated patterns to
avoid. Link to rationale — agents generalize from reasons better than from bare
prohibitions.

**Mine from:** lint configs (`.eslintrc`, `ruff.toml`, `clippy.toml`, `.golangci.yml`),
formatter configs, style guides in `docs/`, recurring review comments.

**Patterns:**
```markdown
- TypeScript strict mode
- Single quotes, no semicolons
- Always collapse if statements per
  https://rust-lang.github.io/rust-clippy/master/index.html#collapsible_if
- Write **Dag** (title case) in all prose. Keep the all-caps spelling only when
  reproducing a literal code token.
```

## Regeneration / codegen steps

**What:** "If you change X, run Y to regenerate Z" rules, especially where CI
verifies drift. Agents routinely forget these and fail CI.

**Mine from:** CI drift-check jobs, `BUILD.bazel`/`compile_data` notes, schema files,
generated-code headers.

**Pattern:**
```markdown
- If you change Rust dependencies (`Cargo.toml` or `Cargo.lock`), run
  `just bazel-lock-update` from the repo root to refresh `MODULE.bazel.lock`, and
  include that lockfile update in the same change. CI verifies lockfile drift.
```
Large projects mark auto-maintained regions so tooling can refresh them:
`<!-- START generated-commands, please keep comment here to allow auto update -->`.

## Environment constraints and guardrails

**What:** Facts about the environment the agent runs in, and actions that must never
be taken (or must always go through a wrapper).

**Pattern:**
```markdown
- **Never run pytest, python, or airflow commands directly on the host** — always
  use `breeze`.
- You operate in a sandbox where `CODEX_SANDBOX_NETWORK_DISABLED=1` will be set…
  tests that check for it early-exit by design.
```

## PR and commit instructions

**What:** Title/branch formats, required pre-commit checks, sign-off or changelog
conventions.

**Mine from:** `CONTRIBUTING.md`, PR templates, commit lint config, CI checks.

**Pattern:**
```markdown
- Title format: [<project_name>] <Title>
- Always run `pnpm lint` and `pnpm test` before committing.
```

## Security considerations

**What:** Secret-handling rules, sensitive directories, dependency policy, anything
with a blast radius (migrations, deploys, force pushes).

## Deployment / release steps

**What:** Only if agents are expected to do release work: versioning scheme, release
commands, where artifacts go.
