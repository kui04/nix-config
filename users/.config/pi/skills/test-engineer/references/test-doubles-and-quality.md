# Test Doubles, Structure, and Quality

## Test doubles — precise vocabulary (Meszaros)

"Mock" gets used as a catch-all in casual conversation, but Gerard Meszaros' *xUnit Test Patterns: Refactoring Test Code* — still the definitive reference on test construction patterns — distinguishes five kinds of test double, and using the right word makes intent clearer to reviewers and to yourself later:

| Double | What it does | Example |
|---|---|---|
| **Dummy** | Passed around to satisfy a signature but never actually used | A `Logger` argument the code under test never calls |
| **Fake** | A working, lighter-weight implementation, not suitable for production | An in-memory database standing in for a real one |
| **Stub** | Returns canned answers to calls made during the test; doesn't respond to anything not programmed | A payment gateway stub that always returns `success` |
| **Spy** | A stub that also records how it was called, so the test can verify calls after the fact | A stub email sender the test later asks "was `send` called once?" |
| **Mock** | Pre-programmed with expectations about calls it will receive; verifies those expectations itself, often failing the test if an expected call didn't happen | A mock repository that asserts `save` was called exactly once with a specific argument |

**When to use which, by level** (see `test-types.md` for the levels themselves): unit tests typically use dummies/stubs/mocks for all externals; integration tests use fakes for the database and stubs for external APIs; system tests use real components with only external services faked; E2E tests use everything real.

**Over-mocking** — mocking the very collaborator whose interaction you're supposed to be verifying, so the test ends up checking that your mocks return what you told them to — is one of the most common ways a test suite gives false confidence. If a test would still pass after deleting the production code it's meant to protect, look hard at whether it's over-mocked.

## AAA / Given-When-Then — structuring an individual test

**Arrange-Act-Assert**, a naming popularized by Bill Wake, structures a test in three clearly separated parts:

```typescript
test('method_scenario_expected', () => {
    // Arrange - set up test data and collaborators
    const input = createTestInput();
    const sut = new SystemUnderTest();

    // Act - execute the behavior under test
    const result = sut.execute(input);

    // Assert - verify the result
    expect(result).toBe(expected);
});
```

**Given-When-Then**, from the Behavior-Driven Development tradition (Dan North), is the same three-part shape phrased as a scenario narrative — preferred when the framework or team writes tests as executable specifications (Cucumber/Gherkin-style, or plain BDD-flavored unit tests): *Given* some initial context, *When* an action occurs, *Then* an outcome is expected.

Either way: one clearly separated setup/action/verification per test, and one behavior asserted per test — resist the urge to bundle several behaviors into one test "for efficiency," since it makes failures harder to diagnose.

## FIRST principles

Popularized in Robert C. Martin's *Clean Code* (the unit-testing chapter, contributed by Tim Ottinger and Jeff Langr), FIRST is a compact checklist for whether a test is actually good:

- **F**ast — tests run quickly, or they stop getting run.
- **I**ndependent — tests don't depend on each other's side effects or run order.
- **R**epeatable — same result every time, in any environment (no reliance on network availability, system clock, or execution order).
- **S**elf-validating — a test produces a clear pass/fail with no manual log-reading required.
- **T**imely — written close to the production code it covers, not weeks later as an afterthought.

## Test smells to avoid (Meszaros)

*xUnit Test Patterns* also catalogues recurring problems in test suites — worth checking a test against before considering it done:

- **Fragile Test** — a test that breaks when unrelated production code changes, usually from asserting on implementation detail rather than observable behavior.
- **Obscure Test** — hard to understand what's being verified or why it failed, often from too much setup logic inlined without explanation.
- **Test Code Duplication** — the same setup/assertion logic copy-pasted across many tests instead of factored into shared helpers or fixtures.
- **Conditional Test Logic** — `if`/loops inside a test, which makes the test itself something that can have bugs and obscures what's actually being checked.
- **Mystery Guest** — a test that depends on external data (a file, a shared DB fixture) that isn't visible in the test itself, making it unclear what setup the test actually relies on.
- **Slow Tests** — tests slow enough that people stop running them locally, which erodes the whole suite's value over time.
- **Interacting/Order-Dependent Tests** — tests that only pass if run in a particular order or alongside specific others, violating Independent from FIRST.

## Test-first vs. test-after (TDD)

Kent Beck's *Test-Driven Development: By Example* describes the red-green-refactor cycle: write a failing test for behavior that doesn't exist yet (red), write the minimum code to pass it (green), then improve the code's structure with the safety net of the passing test (refactor). This skill doesn't mandate test-first development — many teams write tests after the implementation, which is fine — but when the user is designing new behavior from scratch rather than adding coverage to existing code, offer test-first as an option: it tends to produce more testable interfaces, because the test is the first "user" of the code.

## Characterization tests for legacy/untested code

When code has **no existing tests** and unclear or undocumented intended behavior, Michael Feathers' *Working Effectively with Legacy Code* recommends writing characterization tests first: tests that describe what the code *actually does right now*, written by observing its current behavior rather than by guessing what it "should" do. This gives a safety net before refactoring or extending the code, and surfaces surprising existing behavior for a human to confirm is intentional (or file as a bug) before it's locked in by a test.
