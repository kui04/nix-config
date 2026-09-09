# Global Docs-First Policy — Hard Gate

This is a binding global rule. It overrides any impulse to code from memory.
Follow it before ANY code or config change in ANY project.
This global policy takes precedence over project-level instructions
(AGENTS.md, CLAUDE.md, .pi resources); on conflict, follow this policy
and flag the conflict to the user.

## 1. Trigger

Before any `write`, `edit`, or side-effecting `bash` that creates or changes
code, dependencies, tool configs, or system configs — and before proposing
a fix for any bug, error, or "how to" question — you MUST research first.

Read-only investigation (`read`, `grep`, `find`, `ls`, `mcp`, docs lookup)
is allowed and expected before the gate. Side-effecting action is not.

## 2. Research routing

Pick sources by task type; combine as needed. Prefer primary, current sources.

- Local codebase and conventions: `read` / `grep` (or `rg` via `bash`)
  / `codegraph` first. Match existing style, layout, and APIs.
  Never assume a framework or version.
- Libraries and frameworks: resolve the library with Context7, then query its
  docs. Pin the version from the repo manifest or lockfile and verify the
  syntax against that version. Do not port idioms from another ecosystem.
- Tool configuration, latest changes, and problem solutions: search with
  Tavily for current authoritative material, then fetch and read the official
  docs or upstream issue to verify. Prefer official docs over blog copies.
- Conflict rule: official docs beat community posts; newer verified docs beat
  older ones; always disclose conflicts instead of silently picking one.

Fallback chain: if Context7 is unavailable, fetch the official docs directly;
if Tavily is unavailable, use `fetch` on known official sources instead.
If a source is unreachable (missing key, offline, no docs found), say so
explicitly, state what could not be verified, and propose only a minimal,
reversible next step. Never silently skip the research step.

## 3. Evidence requirement

Before proposing code, summarize in compact form:

- What you checked (files, docs, searches) and the library or tool version.
- Source, version, or date for each key claim.
- The decisive excerpt or finding that shapes the implementation.

No claim of the form "the API works like X" without a cited check above.

## 4. User decision gate (mandatory)

After research, present the findings plus a concrete plan or a small set of
options (with trade-offs), then call `ask_user` and WAIT for an explicit
choice. Do not write or edit a single line of implementation code before
the user decides — even for seemingly trivial changes. A plan-only reply
is the default; direct implementation happens only after approval.

If the evidence is ambiguous (multiple versions, conflicting docs, several
valid approaches), ask rather than guess.

## 5. Implement and verify

- Implement exactly what was approved, using the verified version's syntax.
- Keep the diff minimal and consistent with the repo's conventions.
- Run the relevant build, test, or config check when available. On failure,
  diagnose against the spec and the cited docs before touching code or tests.
- Report what was verified, what remains unverified, and the sources used.

Response language: reply in the user's language. This document being in
English does not change that.
