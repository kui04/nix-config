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

**When to use which, by level** (see `references/test-types.md` for the levels themselves): unit tests typically use dummies/stubs/mocks for all externals; integration tests exercise a real database (often containerized or in-memory) alongside stubs for external third-party APIs; system tests use real components with only external services faked; E2E tests use everything real.

**Over-mocking** — mocking the very collaborator whose interaction you're supposed to be verifying, so the test ends up checking that your mocks return what you told them to — is one of the most common ways a test suite gives false confidence. If a test would still pass after deleting the production code it's meant to protect, look hard at whether it's over-mocked.

## State vs. behavior verification — choose the assertion style deliberately

Meszaros' other high-value distinction from *xUnit Test Patterns*:

- **State (result) verification** — invoke the code under test, then assert on the resulting state or return value. This is the default: it pins observable behavior and survives internal refactors.
- **Behavior (interaction) verification** — assert on *how* the code under test interacted with its collaborators, via a mock or spy. Reserve it for cases where the interaction itself is the requirement: "the email was sent exactly once, with this payload," "no query ran inside the loop." Every behavior assertion couples the test to implementation detail; suites built mostly on interaction assertions shatter on every refactor (the Fragile Test smell below).

Rule of thumb: state verification checks *what happened*; behavior verification checks *what was called*. If you can assert the former, prefer it.

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
- **Obscure Test** — hard to understand what is being verified or why it failed, often from too much setup logic inlined without explanation.
- **Test Code Duplication** — the same setup/assertion logic copy-pasted across many tests instead of factored into shared helpers or fixtures.
- **Conditional Test Logic** — `if`/loops inside a test, which makes the test itself something that can have bugs and obscures what is actually being checked.
- **Mystery Guest** — a test that depends on external data (a file, a shared DB fixture) that isn't visible in the test itself, making it unclear what setup the test actually relies on.
- **Slow Tests** — tests slow enough that people stop running them locally, which erodes the whole suite's value over time.
- **Interacting/Order-Dependent Tests** — tests that only pass if run in a particular order or alongside specific others, violating Independent from FIRST.

## Test-first vs. test-after (TDD)

Kent Beck's *Test-Driven Development: By Example* describes the red-green-refactor cycle, and its discipline is the actual content worth knowing: write a failing test for behavior that doesn't exist yet (**red** — and confirm it fails for the *right* reason, which proves the test can fail at all); write the minimum code to make it pass (**green** — no building ahead for imagined future requirements); then improve the code's structure with the passing test as the safety net (**refactor**). This skill doesn't mandate test-first development — many teams write tests after the implementation, which is fine — but when the user is designing new behavior from scratch rather than adding coverage to existing code, offer test-first as an option: it tends to produce more testable interfaces, because the test is the first "user" of the code.

## Characterization tests for legacy/untested code

Michael Feathers' *Working Effectively with Legacy Code* defines legacy code simply as **code without tests** — without tests, no one can verify quickly whether a change made things better or worse. When such code's intent is also undocumented, his remedy is the characterization test: a test that describes what the code *actually does right now*, written by observing its current behavior rather than by guessing what it "should" do. Feathers' loop for producing one:

1. Write a test that calls the unit with one specific input, and an assertion you *know is wrong*.
2. Run it and read the actual value from the failure output.
3. Replace the wrong expectation with the observed value.
4. Rename the test to describe the behavior it now documents.
5. Re-run to green; repeat for the next input.

Two disciplines keep this safe. First, the test documents observed reality — deployed behavior is, in effect, its own specification until a human decides otherwise — so never nudge the observed value toward what you wish the code did; when a surprise surfaces, pin the actual behavior and ask the user whether it's intended or a bug before locking it in. Second, when dependencies make the loop impossible (can't call the code in isolation, can't observe its output), look for a **seam** — Feathers' term for a place where you can vary the program's behavior *without editing in that place* (a substitutable object is the most common seam in object-oriented languages). Seams are the enabling move that gets untestable code under test without a rewrite.