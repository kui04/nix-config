---
name: readme-for-agents
description: 'Create, review, or improve AGENTS.md files — the open "README for agents" format (agents.md) that gives AI coding agents a predictable place for project context: setup/build/test commands, code style, testing and PR conventions. Use whenever the user asks to write, scaffold, audit, or fix an AGENTS.md, add agent instructions to a repository, onboard coding agents (Codex, Cursor, Copilot coding agent, Aider, Gemini CLI, Jules, Amp, etc.), migrate AGENT.md or tool-specific rule files to AGENTS.md, set up nested AGENTS.md files in a monorepo, or make a repo "agent-friendly" — even if they never mention AGENTS.md by name.'
---

# readme-for-agents

Write and maintain AGENTS.md files: a simple, open, vendor-neutral format for guiding
coding agents, stewarded by the Agentic AI Foundation (Linux Foundation) and used by
60k+ open-source projects.

## What AGENTS.md is

- **A README for agents.** Plain Markdown at a predictable location. There are no
  required fields and no schema — use any headings you like; the agent simply parses
  the text you provide.
- **A complement to README.md, not a replacement.** READMEs are for humans (quick
  starts, project descriptions, contribution guidelines). AGENTS.md holds the extra,
  sometimes detailed operational context agents need — build steps, tests, conventions —
  that would clutter a README or isn't relevant to human contributors.
- **Hierarchical.** One file at the repo root; in monorepos, additional AGENTS.md files
  inside packages. Agents read the nearest file in the directory tree, so the closest
  AGENTS.md to the edited file wins. Explicit user chat prompts override everything.

## Creating an AGENTS.md

1. **Mine the repo for facts first — never invent commands.** Every command you list
   must exist and run. Check: `package.json` scripts, `pyproject.toml`, `Cargo.toml`,
   `go.mod`, `Makefile`/`justfile`/`Taskfile`, CI workflows (`.github/workflows/`,
   `.gitlab-ci.yml`), `CONTRIBUTING.md`, README, `.pre-commit-config.yaml`, lint/format
   configs, `docker-compose.yml`, codegen scripts.
2. **Pick sections the project actually needs.** The canonical set: project overview,
   dev environment/setup, build and test commands, code style, testing instructions,
   PR/commit conventions, security considerations. See `references/sections.md` for
   what belongs in each and where to mine it.
3. **Draft from `assets/AGENTS.md.template`**, filling in the real commands you found.
   Keep placeholders like `<project_name>` where commands are parametrized.
4. **Verify before shipping.** Run the commands you listed (or at minimum confirm they
   exist in scripts/CI). Agents will execute what you list and try to fix failures
   before finishing — a wrong command sends every future agent down a hole.
5. **Monorepo:** root AGENTS.md for shared context plus a nested AGENTS.md per package
   with tailored instructions. Keep package-specific commands out of the root file.

## Reviewing an existing AGENTS.md

Work through this checklist; report findings before rewriting:

- [ ] Every command still exists and runs (stale commands are the #1 failure mode)
- [ ] Commands are exact and copy-pasteable, with placeholders marked `<like_this>`
- [ ] No content duplicated from README.md that belongs there (project pitch, human quick start)
- [ ] Regeneration steps documented ("if you change X, run Y; CI verifies drift")
- [ ] Environment constraints stated (sandbox limits, "never run pytest on host, use X")
- [ ] No secrets, tokens, or machine-specific absolute paths
- [ ] Monorepo: package-specific instructions live in nested AGENTS.md files, not the root
- [ ] Concise — every line competes for the agent's context window

## Writing principles

- **Agents execute what you list.** Per the format's semantics, the agent will attempt
  relevant programmatic checks and fix failures before finishing the task. So make
  commands exact, non-interactive, and idempotent — and don't list destructive commands
  without explicit guardrails.
- **Write for a new teammate on day one.** Anything you'd tell a new hire belongs here:
  commit/PR conventions, security gotchas, large datasets, deployment steps, which
  tools to install first, non-obvious repo layout.
- **Explain the why for conventions.** "Avoid `#[async_trait]`; prefer native RPITIT —
  see <link>" generalizes better than bare prohibitions, because agents reason.
- **Prefer executable rules over prose.** "Run `pnpm vitest run -t "<name>"` to focus
  one test" beats "we use Vitest for testing".
- **Keep it a living document.** Update it in the same PR that changes a command or
  convention. Some projects mark auto-generated regions with HTML comments
  (`<!-- START generated-commands -->`) so tooling can refresh them.

## Gotchas

- **No required fields.** Don't invent frontmatter or schema — it's just Markdown with
  any headings. Clients ignore anything they don't parse.
- **Don't duplicate the README.** If a human quick start already covers it, one line
  ("See README for X") beats copying paragraphs that will drift.
- **Don't list commands you haven't verified.** See step 4 above — this is the most
  common and most damaging mistake.
- **Precedence when instructions conflict:** nearest AGENTS.md to the edited file wins;
  explicit user prompts in chat override everything. Don't try to "lock down" behavior
  against the user — you can't.
- **Filename is exactly `AGENTS.md`** (plural, uppercase). For migrating older or
  tool-specific files (`AGENT.md`, `.cursorrules`, etc.) and per-tool configuration
  (Aider, Gemini CLI), see `references/tooling.md`.
- **Some tools read it automatically, some need config.** Codex, Cursor, Copilot coding
  agent, Jules, Amp, Zed, and ~20 others support it; Aider and Gemini CLI need a
  one-line config. `references/tooling.md` has the snippets.

## Reference files

Load these on demand:

- `references/sections.md` — catalog of canonical sections: what to put in each, where
  to mine the facts, and phrasing patterns
- `references/examples.md` — the minimal and full canonical examples from agents.md,
  plus distilled patterns from real files (openai/codex, apache/airflow)
- `references/tooling.md` — cross-agent compatibility, per-tool configuration snippets,
  migration commands, precedence rules
- `assets/AGENTS.md.template` — starter template to copy when scaffolding a new file