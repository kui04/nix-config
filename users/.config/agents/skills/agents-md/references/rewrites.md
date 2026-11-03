# Cutting an AGENTS.md

Read this when a draft looks complete but reads long, or when an existing file needs a rewrite. It shows what a cut
removes, why the removed lines were worthless, and where the surviving facts come from.

## One rewrite

The repository: a web app, a Python API, a generated TypeScript client, `pnpm` workspaces.

Before, 41 lines. The shape of it:

```markdown
# AGENTS.md

## Overview

<4 lines about the product and its users>

## Repository layout

- `apps/web/` — the frontend
- `apps/api/` — the Python API
- `packages/ui/` — shared components
- `packages/client/` — generated client
- `scripts/` — developer scripts

## Tech stack

<3 lines: React, FastAPI, Postgres, pnpm>

## Code style

- 2-space indent, single quotes, no semicolons
- Prefer functional components
- Name booleans with `is` or `has`
- Keep files under 300 lines

## Testing

- Write tests for every change
- Use Vitest for the frontend and pytest for the API
- Aim for high coverage

## Boundaries

- Never commit secrets
- Never force-push
- Ask before adding dependencies
- Do not edit generated code
```

After, 7 lines:

```markdown
# AGENTS.md

- Use `pnpm`, not `npm` or `yarn`. The lockfile and the workspace filters depend on it.
- `packages/client/` is generated. Change `schemas/openapi.yaml`, then run `pnpm generate:client`. CI fails when the two
  disagree.
- Frontend tests: `pnpm --filter web test`. API tests: `pnpm --filter api pytest`. Run the affected one while you work,
  both before you finish.
- `apps/web/src/legacy/` is still served but must not be copied: new screens go in `apps/web/src/screens/`.
- Deploys run from `main` through CI. Do not tag or publish from a workstation.
```

What the cut removed, and why:

| Removed                                 | Why it was worthless                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| Overview, tech stack                    | The agent reads `package.json`, the source tree, and the imports.                |
| Repository layout                       | Same. The directory names already say which app is which.                        |
| Code style, four rules                  | A formatter and a linter enforce these; the agent reads existing files anyway.   |
| "Write tests for every change"          | Adds steps to every task and prevents no specific mistake.                       |
| "Never commit secrets", "no force-push" | The model already holds these; the harness blocks most of them.                  |
| "Ask before adding dependencies"        | Too broad to act on. Name the dependency rule that this project has, or drop it. |

What the cut added, and where it came from: the package manager (the lockfile), the generated client and its check (the
generation script and CI), the per-app test commands (the workspace scripts), the legacy directory (a code comment and
`git log`), the deploy path (the CI workflow).

## Vague lines, usable lines

| Vague                       | What it leaves undecided           | Usable                                                                                                        |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Run the tests.              | Which tests, where, when?          | From `services/api`, run the affected pytest file. Run `pytest tests/` before you finish an API change.       |
| Do not edit generated code. | Which code is generated?           | Do not edit `packages/client/generated/`. Change `schemas/openapi.yaml`, then run `pnpm generate:client`.     |
| Follow existing patterns.   | Which implementation is canonical? | New HTTP handlers follow `services/api/routes/users.py`, validation and error handling included.              |
| Follow the architecture.    | Which boundary must hold?          | `packages/core` must not import from `packages/ui`. Shared code belongs in `packages/core`.                   |
| Use the standard build.     | What is standard here?             | Run `make build` from the repository root. Do not use `go build`: the wrapper supplies required linker flags. |

## Two sizes that work

A root file for a repository whose default commands are wrong. Five lines is enough when the repository is small:

```markdown
# AGENTS.md

- Run `make test`, not `python -m pytest`: the target sets `PYTHONPATH=src`.
- `src/app/_schema.py` is generated from `schema/api.json` by `make gen`. `make gen-check` fails on drift.
- Run `make ci` before you finish; it repeats what the merge gate runs.
```

A nested file for one package inside a monorepo. It adds rules and repeats nothing from the root:

```markdown
# services/payments

- Test with `make test-payments`. The shared root target runs the whole workspace instead.
- Rotating an API key needs a notice in `#payments` first; the key is live in three deployments.
```

Both files name a command the agent would otherwise get wrong. Neither describes the code.
