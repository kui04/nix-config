---
name: agents-md
description: >-
  Create, update, audit, and maintain robust, graceful AGENTS.md files following the official agents.md specification
  (https://github.com/agentsmd/agents.md). Use whenever the user asks to create, scaffold, initialize, update, review,
  refactor, audit, or sync an AGENTS.md file (root or nested monorepo files), migrate or link legacy agent instruction
  files (AGENT.md, CLAUDE.md, .cursorrules, .github/copilot-instructions.md) to AGENTS.md, or document repository build,
  test, lint, architecture, and workflow rules for AI coding agents — even when the user says "document this repo for
  agents", "add agent instructions", or "keep agent docs in sync" without naming AGENTS.md explicitly.
---

# AGENTS.md — Authoring & Maintenance Guide

Create, update, and maintain `AGENTS.md` files that follow the official specification from
`https://github.com/agentsmd/agents.md` (commit `d001185`, Agentic AI Foundation) and proven patterns from its featured
repositories (`openai/codex`, `apache/airflow`, `temporalio/sdk-java`).

## Purpose: `README.md` vs. `AGENTS.md`

`README.md` is for humans: project overview, quick start, screenshots, and community links.

`AGENTS.md` is a **README for coding agents**: a dedicated, predictable place for the operational context an agent needs
to work safely and fast without cluttering human docs:

- Exact environment, build, lint, format, and test commands (especially fast, file-scoped or package-scoped commands).
- Repository directory map and architecture boundaries.
- Non-obvious code conventions, invariants, and workflow traps that linters do not catch automatically.
- Commit, pull request, and operational boundaries (what to do automatically, what requires confirmation, and what to
  never do).

## Core Specification (`agentsmd/agents.md`)

1. **Standard Markdown, no required schema**: `AGENTS.md` is plain Markdown. Do not add YAML frontmatter or proprietary
   metadata blocks to `AGENTS.md`. Any clear heading structure works; agents parse the text directly.
2. **Directory hierarchy and precedence**:
   - Place the primary `AGENTS.md` at the root of the repository.
   - In monorepos or multi-package repositories, place nested `AGENTS.md` files inside subproject directories
     (`<package>/AGENTS.md`).
   - **Conflict resolution**:
     1. Explicit user chat prompts override everything.
     2. The closest `AGENTS.md` to the edited file takes precedence over parent `AGENTS.md` files.
3. **Executable verification commands**: Coding agents automatically run the test, lint, and type-check commands listed
   in `AGENTS.md` and attempt to fix failures before finishing a task. Every command in `AGENTS.md` must be accurate,
   non-interactive, and safe to run inside an agent session.
4. **Living documentation**: Update `AGENTS.md` whenever build tools, directory paths, or conventions change.
5. **Operational guide, not a security sandbox**: Because user prompts and nested `AGENTS.md` files override parent
   instructions, `AGENTS.md` guides cooperative agents on conventions and boundaries; it does not replace OS, container,
   or CI security enforcement.

## Qualities of a Robust and Graceful `AGENTS.md`

- **Evidence-based (Robust)**: Every command, flag, and path in `AGENTS.md` comes from verified files in the repository
  (manifests, lockfiles, CI workflows, Git hooks), never from guesswork.
- **High signal, low token cost (Graceful)**: A root `AGENTS.md` loads into context on almost every turn. Keep root
  files compact (typically 40 to 150 lines; rarely above 250 lines). Prefer imperative one-line bullets and compact
  command tables over long paragraphs.
- **Fast, scoped commands first**: Always list how to run a single test, lint a single file, or check a single package
  before the full-suite command. Agents iterate faster and use less context when checks run in seconds.
- **Traps and invariants over boilerplate**: Do not paste standard language tutorials or repeat 100 lines of rules that
  a formatter already enforces. Tell the agent how to run the formatter and document the traps a tool cannot catch (for
  example: "Use `pnpm dev`; do not run `pnpm build` during an interactive session because it overwrites `.next` and
  breaks HMR").
- **End-state only**: Document current rules and architecture. Never include changelogs, PR diaries, or meta narratives
  about how the documentation was written.

## Workflow

Identify which mode matches the user's request: **Create**, **Update**, or **Maintain (Audit)**.

### Mode 1 — Create `AGENTS.md`

#### Step 1: Inspect the repository for ground truth

Before writing a single line, read the repository's real configuration:

- **Manifests & task runners**: `flake.nix`, `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Makefile`,
  `justfile`, `BUILD.bazel`, `build.gradle` / `gradlew`.
- **Lockfiles (to confirm the exact package manager)**:
  - `pnpm-lock.yaml` -> `pnpm`
  - `yarn.lock` -> `yarn`
  - `bun.lockb` / `bun.lock` -> `bun`
  - `package-lock.json` -> `npm`
  - `uv.lock` -> `uv`
  - `poetry.lock` -> `poetry`
  - `Cargo.lock` -> `cargo`
  - `flake.lock` -> `nix`
- **CI and Git hooks**: `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.pre-commit-config.yaml`, `hooks/`, `.husky/`. CI
  workflows show the exact commands and flags that gate merges.
- **Existing docs and agent configs**: `README.md`, `CONTRIBUTING.md`, `AGENT.md`, `CLAUDE.md`, `.cursorrules`,
  `.github/copilot-instructions.md`, `.aider.conf.yml`, `.gemini/settings.json`.

If a critical command (such as how to run tests) has no evidence in the repo, ask the user rather than inventing one.

#### Step 2: Choose root vs. nested structure

- **Single-package repository**: Create one `AGENTS.md` at the repository root.
- **Monorepo / multi-package repository**:
  - Put workspace-wide navigation (`turbo`, `pnpm --filter`, `cargo -p`, `uv --project`, `nix`), shared architecture
    boundaries, and commit/PR rules in the root `AGENTS.md`.
  - Create a nested `<subproject>/AGENTS.md` only when a subproject has its own toolchain, framework, or local state
    invariants that do not apply to the rest of the repository.
  - Do not repeat root instructions inside nested `AGENTS.md` files.

#### Step 3: Draft the sections that earn their place

Include only sections that hold real, project-specific rules. Read `references/examples.md` for templates and real-world
reference files.

1. **Overview & Repository Layout**:
   - 1 to 2 sentences naming the tech stack and workspace structure.
   - A compact list of key directories and entrypoints so the agent navigates directly to files instead of scanning the
     tree with `ls` or `find`.
2. **Environment & Setup**:
   - Required environment runners (`nix develop`, `direnv`, `uv run`, container/dev-env shims) and dependency sync rules
     (for example, how to update lockfiles).
3. **Commands (Build, Test, Lint, Format)**:
   - Single-test and single-package commands first, then full-suite commands.
   - Exact formatter and linter commands to run immediately after editing files.
   - Commands the agent **must not** run in interactive sessions (for example, production builds that break dev-server
     state, or host commands that must run inside a sandbox/container).
4. **Architecture & Code Conventions**:
   - Module boundaries (what may import or call what, database/network access rules).
   - Naming rules, error-handling idioms, state management, and comment discipline.
   - Generated-file rules (which files are generated and the command that regenerates them).
5. **Commits, PRs & Operational Boundaries**:
   - Commit message and PR title conventions, plus required pre-commit checks (`nix fmt`, `pnpm lint`, `cargo clippy`).
   - Explicit boundary tiers when helpful:
     - **Always**: run formatters/tests on touched files; keep lockfiles and docs in sync.
     - **Ask first**: add dependencies, change public APIs or schemas, run cross-package refactors, or stage/commit/push
       if the user's workflow requires review first.
     - **Never**: commit secrets/tokens, hand-edit generated files, weaken tests to make them pass, or run destructive
       git/database commands without explicit permission.

#### Step 4: Configure cross-tool compatibility (when migrating or requested)

When migrating existing agent files or setting up multi-tool repositories, follow the official `agents.md` patterns:

- **Symlink legacy filenames**: Rename the existing file to `AGENTS.md` and create a relative symlink for backward
  compatibility:
  ```bash
  mv AGENT.md AGENTS.md && ln -s AGENTS.md AGENT.md
  ```
  Use the same pattern (`ln -s AGENTS.md CLAUDE.md`) when a project wants one canonical file for both `AGENTS.md` and
  Claude Code.
- **Aider** (`.aider.conf.yml`):
  ```yaml
  read: AGENTS.md
  ```
- **Gemini CLI** (`.gemini/settings.json`):
  ```json
  {
    "context": {
      "fileName": "AGENTS.md"
    }
  }
  ```

### Mode 2 — Update `AGENTS.md`

1. **Read before editing**: Read the target `AGENTS.md` and any parent or child `AGENTS.md` files that cover the same
   path.
2. **Respect generated blocks**: Check for HTML comment markers such as `<!-- START generated-commands ... -->` /
   `<!-- END generated-commands -->`. If a block is auto-generated, update its generator script or place manual
   instructions outside the markers.
3. **Put the rule at the narrowest matching scope**:
   - If the rule applies to the whole repository, put it in the root `AGENTS.md`.
   - If the rule applies only to one package or directory, put it in that directory's `AGENTS.md` (or under a clearly
     scoped subsection if the repo uses a single file).
4. **Integrate, do not append**:
   - Place the new bullet inside the existing section for that topic, matching the file's heading level, bullet style,
     and tone.
   - Never tack a new "Miscellaneous" or "Updates" section onto the end of the file.
   - Delete or update any existing bullet that the new instruction supersedes so the file never contradicts itself.

### Mode 3 — Maintain & Audit `AGENTS.md`

Run this checklist when asked to review, clean up, or sync an existing `AGENTS.md`:

1. **Verify every path**: Check that every file path, directory, and doc link in `AGENTS.md` still exists in the working
   tree. Update moved paths and remove deleted ones.
2. **Verify every command**: Compare all commands in `AGENTS.md` against current manifests (`package.json` scripts,
   `flake.nix` outputs, `Cargo.toml`, `pyproject.toml`, `Makefile`/`justfile`) and CI workflows. Fix stale flags,
   renamed scripts, or changed package managers.
3. **Eliminate contradictions and duplicates**:
   - Resolve conflicting rules within the file or between root and nested `AGENTS.md` files.
   - Merge duplicate bullets that state the same rule in different sections.
4. **Prune noise and bloat**:
   - Remove generic filler ("write clean, maintainable code", "follow best practices") that carries no
     repository-specific information.
   - Rewrite multi-sentence paragraphs into concise, scannable bullets.
   - If a root `AGENTS.md` exceeds ~250 lines because of subsystem-specific detail, split the subsystem rules into
     nested `<package>/AGENTS.md` files or move deep reference tables into `docs/` and link to them.
5. **Run the repository formatter**: Format the updated `AGENTS.md` with the project's Markdown formatter (for example,
   `nix fmt` or `prettier`) so line wrapping and table alignment match the repository standard.

## Anti-Patterns to Avoid

| Anti-pattern                                              | Graceful replacement                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Guessing `npm test` or `pytest` without checking the repo | Inspect lockfiles, manifests, and CI first (`pnpm`, `uv`, `breeze`, `nix`, `cargo`). |
| Listing only slow full-suite test commands                | Put single-test and single-package commands first, full-suite commands second.       |
| Pasting linter rule tables or language tutorials          | Give the exact linter/formatter command and list only rules linters cannot check.    |
| Vague advice ("write good tests", "keep code fast")       | State concrete, verifiable rules ("add a regression test for every bug fix").        |
| Appending dated notes or design history                   | Keep `AGENTS.md` timeless; document only current state and active rules.             |
| Hardcoding machine-local absolute paths (`/home/user/..`) | Use repository-relative paths (`packages/api/`, `scripts/check.sh`).                 |
| Duplicating root rules in every nested `AGENTS.md`        | Keep shared rules in root `AGENTS.md`; put only local overrides/additions in nested. |

## Reference Files

- `references/examples.md` — Read when scaffolding a new `AGENTS.md`, structuring nested monorepo `AGENTS.md` files, or
  comparing against canonical examples from `agentsmd/agents.md`, `apache/airflow`, `temporalio/sdk-java`, and
  `openai/codex`.
