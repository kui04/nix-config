---
description:
    Universal parallel clean-room code review using two independent sub-agents, followed by lead verification and
    synthesis
---

# Universal Parallel Clean-Room Code Review

Conduct a rigorous, read-only review using two completely independent sub-agents running in parallel, then independently
verify and synthesize their findings.

## Step 0: Resolve Scope & Preconditions

1. **Determine Review Target** from user input (`$@`):
    - **If `$@` specifies targets or focus areas** (files, directories, git ranges/commits, PRs, or specific concerns):
      use them directly. This may be either a _change/diff review_ or a _static audit of existing code_.
    - **If `$@` is empty**:
        - If inside a git repository with uncommitted changes (`git status`, `git diff`, `git diff --cached`, or
          relevant untracked files): review those uncommitted changes.
        - If inside a git repository with a clean working tree: review the latest commit (`HEAD`).
        - If not a git repository and no target was given: stop and ask me what to review.
2. **Strict Read-Only Mode**: Neither you nor any sub-agent may edit, create, or delete files, or run state-mutating
   commands. Do **NOT** apply fixes until I approve the action plan.
3. **No Simulated Sub-Agents**: You MUST dispatch real parallel sub-agents using the available sub-agent tool. Do
   **NOT** role-play or simulate multiple reviewers inside your own context. If no sub-agent capability is available,
   stop and tell me.

---

## Phase 1: Parallel Independent Dispatch

Dispatch **2 completely independent sub-agents in parallel** in a single step.

### Clean-Room Isolation Rules (Critical)

- **Zero Authoring Bias**: Pass **ONLY** the resolved target scope (plus any explicit focus criteria from `$@`) and the
  respective sub-agent prompt below. Do **NOT** pass our conversation history, implementation rationale, trade-offs we
  discussed, or your own preliminary analysis.
- **No Cross-Talk**: Sub-agents must run independently and must not see each other's outputs.
- **Ground Every Claim**: Both sub-agents must inspect surrounding code, callers/consumers, types/schemas, configs, and
  tests directly before reporting any issue.

### Sub-Agent A — Execution, Correctness & Edge Cases

> You are an independent senior engineer performing a clean-room, read-only review. You have no prior context about how
> or why this code was written. Do not modify any files.
>
> **Review Target & Focus**: {INSERT_RESOLVED_SCOPE_AND_USER_FOCUS}
>
> **Method**: First identify the language(s), runtime, and domain of the target (e.g., application code, systems code,
> frontend/UI, scripts, queries, configs/IaC), then apply the failure modes that actually matter for that stack.
>
> **Audit exclusively for**:
>
> 1. **Functional Correctness & Invariants**: Broken logic, wrong conditions, state corruption, unintended side effects,
>    or behavioral regressions in existing callers/workflows.
> 2. **Boundary Conditions & Failure Handling**: Empty/null/extreme inputs, error propagation, partial failures,
>    idempotency, ordering/concurrency/timing hazards, and cleanup or shutdown edge cases.
> 3. **Resource & Efficiency Risks**: Leaks, unbounded growth/work, unnecessary blocking, or disproportionate cost on
>    hot/critical paths.
> 4. **Verification & Test Gaps**: High-risk behaviors or failure paths in the target scope that lack meaningful
>    automated verification.
>
> **Rules**:
>
> - Read surrounding source files and call sites to verify assumptions; never speculate from isolated snippets or diff
>   hunks alone.
> - Ignore formatting, naming preferences, or linter-level style nits unless they directly cause defects or
>   misinterpretation.
> - For each finding, report: `Severity (CRITICAL | MAJOR | MINOR)`, `Confidence (0-100)`, `Location (File:Line)`,
>   `Failure Scenario` (concrete input, state, or sequence that triggers the issue), and `Suggested Fix`.
> - If no substantive issues exist, respond only with: `No substantive issues found.` Do not invent issues to fill
>   space.

### Sub-Agent B — Design, Safety & System Integration

> You are an independent principal architect performing a clean-room, read-only review. You have no prior context about
> how or why this code was written. Do not modify any files.
>
> **Review Target & Focus**: {INSERT_RESOLVED_SCOPE_AND_USER_FOCUS}
>
> **Method**: First identify the language(s), architecture, and project conventions (via nearby modules, docs, and
> config files), then evaluate how safely and cleanly this code fits into the wider system.
>
> **Audit exclusively for**:
>
> 1. **Safety & Trust Boundaries**: Security vulnerabilities, unsafe handling of untrusted input, privilege/permission
>    mistakes, secret/data exposure, unsafe defaults, or destructive blast radius.
> 2. **Contracts & Compatibility**: Breaking or undocumented changes to interfaces, protocols, schemas, CLI/config
>    formats, types, or assumptions relied on by external/internal consumers.
> 3. **Architecture & Simplicity**: Unnecessary complexity, leaky abstractions, duplicated logic, misplaced
>    responsibilities, dead code, or friction with established codebase patterns.
> 4. **Operability & Diagnostics**: Swallowed errors, ambiguous failure messages, or missing context needed to debug
>    issues when things go wrong.
>
> **Rules**:
>
> - Inspect neighboring modules, docs, and project configs before claiming a convention or contract violation.
> - Ignore trivial linter-level style nits.
> - For each finding, report: `Severity (CRITICAL | MAJOR | MINOR)`, `Confidence (0-100)`, `Location (File:Line)`,
>   `Evidence & Impact`, and `Suggested Fix`.
> - If no substantive issues exist, respond only with: `No substantive issues found.` Do not invent issues to fill
>   space.

---

## Phase 2: Lead Verification & Synthesis

Wait for both sub-agents to finish. Do **NOT** blindly merge or repeat their outputs. Act as the Lead Reviewer:

1. **Verify Directly**: Open and inspect the referenced files/lines yourself to confirm each claim holds true in the
   actual codebase.
2. **Filter Noise**: Drop false positives, issues already guarded elsewhere in the execution path, style nitpicks, and
   speculative/unverified claims (including verified confidence below 80).
3. **Deduplicate & Mark Consensus**: Merge overlapping findings and tag issues caught independently by both reviewers as
   `[Consensus]` (highest signal).
4. **Resolve Trade-offs**: If the reviewers disagree (e.g., performance vs. simplicity), evaluate both sides in the
   context of this codebase and state a clear engineering decision.

---

## Phase 3: Final Report

Write the final report in the language of `$@` (or match our current conversation language if `$@` is empty), keeping
code identifiers and file paths intact. Use this exact structure:

### Verdict

- **Status**: `APPROVE` | `APPROVE WITH MINOR COMMENTS` | `REQUEST CHANGES`
- **Scope Reviewed**: 1 line stating exactly what was inspected.
- **Summary**: 2–3 sentences covering overall quality and top risks.

### Verified Findings

Group under `CRITICAL`, `MAJOR`, then `MINOR` (omit empty tiers). For each item:

- **[Severity] Short Title** `path/to/file:line` `[Consensus | Agent A | Agent B]`
    - **Problem**: Root cause and concrete failure/impact scenario.
    - **Fix**: Specific, actionable recommendation.

_(If no findings survive verification, explicitly state that no substantive issues were found.)_

### Filtered / Rejected Claims

- 1-line bullet per discarded sub-agent claim with the concrete reason it was rejected (or `None`).

### Proposed Action Plan

- Numbered, priority-ordered list of recommended fixes (or state that no changes are needed). Ask for my confirmation
  before modifying any files.
