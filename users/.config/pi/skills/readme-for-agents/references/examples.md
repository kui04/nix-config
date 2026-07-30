# AGENTS.md examples

## Minimal example (from agents.md)

Good default for a small project — three sections, all executable:

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

## Full sample (from agents.md)

The canonical "monorepo package" shape:

```markdown
# Sample AGENTS.md file

## Dev environment tips
- Use `pnpm dlx turbo run where <project_name>` to jump to a package instead of scanning with `ls`.
- Run `pnpm install --filter <project_name>` to add the package to your workspace so Vite, ESLint, and TypeScript can see it.
- Use `pnpm create vite@latest <project_name> -- --template react-ts` to spin up a new React + Vite package with TypeScript checks ready.
- Check the name field inside each package's package.json to confirm the right name—skip the top-level one.

## Testing instructions
- Find the CI plan in the .github/workflows folder.
- Run `pnpm turbo run test --filter <project_name>` to run every check defined for that package.
- From the package root you can just call `pnpm test`. The commit should pass all tests before you merge.
- To focus on one step, add the Vitest pattern: `pnpm vitest run -t "<test name>"`.
- Fix any test or type errors until the whole suite is green.
- After moving files or changing imports, run `pnpm lint --filter <project_name>` to be sure ESLint and TypeScript rules still pass.
- Add or update tests for the code you change, even if nobody asked.

## PR instructions
- Title format: [<project_name>] <Title>
- Always run `pnpm lint` and `pnpm test` before committing.
```

## Patterns distilled from real-world files

### openai/codex (Rust) — nested, convention-heavy

The file lives at the repo root but is scoped ("In the codex-rs folder where the
rust code lives"). Notable patterns:

- **Scoped rules:** crate naming (`codex-` prefix), clippy-level style rules with
  links to the lint docs as rationale.
- **Environment constraints spelled out:** the agent runs in a sandbox with
  `CODEX_SANDBOX_NETWORK_DISABLED=1`; code that early-exits tests on that variable
  exists by design — "never add or modify" it.
- **Regeneration rules with CI teeth:** changing `Cargo.toml`/`Cargo.lock` → run
  `just bazel-lock-update` and include the lockfile in the same change, because CI
  verifies drift.
- **Build-system gotchas:** Bazel doesn't see source-tree files; adding
  `include_str!` requires updating `BUILD.bazel` or "Bazel may fail even when Cargo
  passes".
- **Review-taste rules:** "Do not create small helper methods that are referenced
  only once", "prefer comparing the equality of entire objects over fields one by
  one" in tests.

### apache/airflow (Python) — command catalog with guardrails

- **Hard guardrail up front:** "**Never run pytest, python, or airflow commands
  directly on the host** — always use `breeze`."
- **Placeholders defined before use:** `<PROJECT>` is the folder with the
  `pyproject.toml` of the package under test; `<target_branch>` is the PR's merge
  target.
- **Bold-labeled command list:** `**Run a single test:**`, `**Type-check
  (providers):**` — scannable, one line per intent.
- **Generated region marker:** `<!-- START generated-commands, please keep comment
  here to allow auto update -->` keeps the command list fresh via tooling.
- **Prose-level naming convention:** write "Dag" (title case) except when quoting
  literal code tokens — the kind of rule no linter enforces.

## Where to find more

- Featured on agents.md: `openai/codex`, `apache/airflow`, `temporalio/sdk-java`,
  `PlutoLang/Pluto` — all linked from the site.
- GitHub code search `path:AGENTS.md NOT is:fork NOT is:archived` — 60k+ files.
  Read a few in the same language/ecosystem as the target repo before drafting;
  conventions cluster by ecosystem (pnpm/turbo for JS monorepos, breeze/uv for
  large Python projects, just/cargo for Rust).
