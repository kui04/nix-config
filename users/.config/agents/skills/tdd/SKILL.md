---
name: tdd
description: >-
  Design systematic test cases and drive implementation through strict Test-Driven Development (Test List -> Red ->
  Green -> Refactor). Use whenever implementing features, fixing bugs, adding or improving test coverage, designing test
  cases before coding, or diagnosing failing and flaky tests—even if the user never says "TDD" or "test" (for example,
  "make sure this cannot break", "fix this bug", "add coverage", or "why does this keep failing"). Works in any language
  and test framework. Do not use for prose-only edits, visual styling, or tasks without executable behavior.
---

# TDD — Test Design & Test-Driven Development

## Role

Treat tests as executable specifications of observable behavior, never as after-the-fact confirmation of code you
already wrote. Derive test cases systematically before writing production code, then drive implementation in small **Red
-> Green -> Refactor** increments. Keep rules language-agnostic and realize them idiomatically in the project's actual
test framework.

## Core workflow

Follow the loop below for features and bug fixes. For **adding tests to existing code** (characterization or coverage
gaps), run Steps 1–4, then write behavior-based tests against the public contract without modifying production code
unless a real bug is uncovered. For **bug fixes**, Step 3 starts with a single failing test that reproduces the reported
bug before touching production code.

### Step 1 — Establish the test framework and runner from evidence

Never guess test syntax or invent a framework. Gather evidence in this order:

1. If the user named the framework, runner, or assertion library, use it.
2. Otherwise, inspect manifests, lockfiles, runner configs, and existing test files to identify:
   - The active test framework, runner command, and how to run a single test file or case fast.
   - Existing test file placement, naming conventions, fixtures, and assertion style.
3. If the tool or version is unfamiliar, check its `--help` output or local docs before writing test code.
4. Only ask the user if the repo has no test setup and no manifest indicating one.

### Step 2 — Choose test levels by what can actually break

Match each behavior to the lowest test level that exercises the real failure mode. Do not duplicate the same logic
across every layer.

| What is under test                                       | Test level  | Boundary rule                                                           |
| -------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| Pure logic, calculations, parsers, state machines        | Unit        | In-process only; no network, disk, or real clock                        |
| DB queries, repositories, serialization, HTTP handlers   | Integration | Real local dependency (in-memory/container/tmp dir); fake external APIs |
| Interactive UI components (forms, controls, state views) | Component   | Render component; assert visible output and user events, not internals  |
| Critical end-to-end user journeys (auth, checkout, sync) | E2E         | Keep count minimal; cover happy path and highest-risk failure           |

If the change crosses a trust boundary (parsing untrusted input, auth, permissions) or a hot path, include targeted
malformed-input or contract cases in the Test List even if the user did not ask explicitly.

### Step 3 — Derive the Test List systematically

Before writing any test or production code, build a concrete **Test List** of one-behavior items. Apply every technique
below that fits the domain—do not stop at happy paths:

| Signal in requirements / code                         | Technique              | Concrete cases to add                                                               |
| ----------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| Input ranges, lengths, counts, thresholds             | Equivalence + Boundary | One representative per valid class; empty, `0`, `1`, `min-1`, `min`, `max`, `max+1` |
| Multiple interacting conditions or flags              | Decision table         | One case per distinct condition combination that changes the outcome                |
| Lifecycle or workflow phases (`Draft -> Paid -> ...`) | State transition       | Every valid transition plus illegal transitions that must be rejected               |
| Invalid, missing, or untrusted external inputs        | Error / Negative paths | Malformed shape, missing required fields, wrong type, explicit error contract       |
| Algebraic rules (codec, sort, merge, arithmetic)      | Property / Invariant   | Round-trip `decode(encode(x)) == x`, idempotency `f(f(x)) == f(x)`, ordering        |
| Async ordering, retries, timeouts, shared state       | Concurrency / Timing   | Out-of-order completion, duplicate delivery, timeout/cancellation                   |

Order the Test List from simplest core behavior to edge cases and error paths. Prioritize by risk (impact x likelihood).
When production code does not exist yet, derive expected outputs strictly from the user's spec, types, or
contracts—never invent undocumented business rules.

### Step 4 — Conditional gate: Confirm the Test List when warranted

Pause and present the Test List (grouped by test level) for user confirmation **before writing code** whenever:

- The task is non-trivial (multiple behaviors, modules, or state transitions), OR
- Expected behavior, error semantics, or edge-case rules are ambiguous.

Skip the pause and proceed directly to Step 5 when the change is small and unambiguous (e.g., a single clear bug fix or
pure helper) or when the user explicitly says to implement directly.

### Step 5 — Execute Red -> Green -> Refactor, one item at a time

Work through the Test List **one item per cycle**. Never dump a whole test file and full implementation in one turn.

1. **Red — Write one failing test:**
   - Do not modify production code during this step (except minimal type/stub declarations required to compile in
     statically typed languages).
   - Structure the test with **AAA** (Arrange, Act, Assert) separated clearly, testing exactly **one behavior** with
     self-evident test data.
   - Run the test runner targeting the new test.
   - **Verify the failure reason:** the test must fail because the behavior is missing or wrong—not because of a syntax
     error, missing import, or broken fixture. Fix setup issues before moving to Green.
2. **Green — Write the minimum code to pass:**
   - Implement only what is needed to make the current failing test (and all existing tests) pass.
   - Do not add speculative options, extra error branches, or unrequested abstractions not demanded by a test.
   - Run the relevant test suite and confirm 100% pass.
3. **Refactor — Clean up while Green:**
   - Remove duplication, clarify naming, and tighten structure in both production code and tests without changing
     observable behavior.
   - Re-run tests after each refactor step to confirm everything stays green.
4. **Repeat** from Step 5.1 until the Test List is empty (add newly discovered edge cases to the list instead of
   sneaking them into the current cycle).
5. **Final verification:** run the full relevant test suite (and type checker/linter if configured) and report what
   passed, what levels were covered, and any untestable/deferred risks.

## Test quality & doubles rules

Every test must satisfy **FIRST**:

- **Fast:** runs quickly enough to execute on every cycle.
- **Isolated:** zero shared mutable state between tests; passes in any execution order.
- **Repeatable:** deterministic across machines and runs; no dependency on wall-clock time, live network, or unseeded
  randomness.
- **Self-validating:** binary pass/fail via explicit assertions; never rely on manual log inspection.
- **Timely:** written immediately before the production code it specifies.

Follow **behavior-focused (classical) testing** for test doubles and assertions:

- **Assert on public contracts and observable outcomes** (return values, returned errors, persisted state, rendered UI,
  emitted external messages)—never on private helpers, internal data structures, or call sequences of internal
  functions.
- **Prefer real collaborators** for in-process domain objects.
- **Use Fakes or Stubs only at uncontrolled or external boundaries** (network/HTTP, system clock, randomness,
  third-party SDKs, slow I/O, environment variables).
- **Use Spies/Mocks only when an outbound command or event IS the public contract** (e.g., verifying an email/webhook
  adapter is invoked with the expected payload). Never mock internal modules just to isolate a unit from its own
  helpers.

## Failure diagnosis & anti-cheating rules

When a test fails unexpectedly (during Green, Refactor, or maintenance), diagnose before editing the test:

1. **Read the full failure output** — diff expected vs. actual, stack trace, and isolation context.
2. **Classify the root cause:**
   - _Implementation bug_ -> fix production code; keep the test intact.
   - _Broken setup or test flakiness_ (shared state, leaked env, wall-clock dependency, race) -> fix isolation or
     determinism without weakening the assertion.
   - _Contract or requirement change_ -> confirm the new expected behavior with the user before updating the test.
3. **Never take these shortcuts to get a green run:**
   - Weakening assertions (e.g., replacing exact value/error checks with `toBeDefined()` / `is not None` / `!= nil`).
   - Deleting, commenting out, or skipping (`.skip`, `#[ignore]`, `@pytest.mark.skip`) a failing test without explicit
     user approval.
   - Hardcoding test-specific inputs in production code to satisfy a single case.
   - Writing tautological tests that mirror implementation lines or assert only that mocks were called as configured.
   - Suppressing flakiness with arbitrary `sleep()` delays instead of synchronization, deterministic clocks, or
     isolation.
4. **Report every resolution explicitly** — state whether the fix was a production bug, a test-isolation fix, or a
   confirmed contract update.
