# Test Types — Definitions & When To Use Each

Use this to decide *which* levels and *which* purposes a given change actually needs — not every change needs every level below. Three complementary frameworks are used together here because they answer different questions: the pyramid answers "how many tests at each level," the quadrants answer "what is this test even for," and test size answers "what is this test allowed to touch."

## The ISTQB test-level / test-type taxonomy (foundational vocabulary)

The ISTQB Foundation syllabus is the closest thing the industry has to a shared vocabulary, and it's worth using precisely:

- **Test levels** (grouped by *when/where* in the lifecycle): component (unit), integration, system, acceptance.
- **Test types** (grouped by *test objective*, cutting across levels): functional (does it do the right thing), non-functional (performance, usability, reliability, security — the "-ilities"), structural/white-box (is the code itself adequately exercised — statement/branch coverage), and change-related (regression testing, re-testing after a fix).
- **Static vs. dynamic testing**: static testing (code review, static analysis, walkthroughs) finds defects *without executing the code*; dynamic testing (everything else in this document) executes it. Don't forget static testing exists — a thorough code review often catches things a test suite can't (unclear names, dead code, missed requirements).

## Testing pyramid — how many, at which level

An idea popularized by Mike Cohn (*Succeeding with Agile*) and explained further since by Martin Fowler: put the largest number of tests at the fastest, most isolated level, and shrink each layer as it gets slower and broader.

### Unit tests

**Scope:** a single function, method, or class, in isolation. All external collaborators (DB, network, filesystem, clock, other services) are replaced with test doubles (see `test-doubles-and-quality.md`).
**Write when:** the code has non-trivial logic, branching, calculations, or business rules worth pinning down.
**Skip/lighten when:** the code is a trivial pass-through (a one-line getter, a straight re-export) — a unit test here is noise, not signal.
**Naming fallback (no existing convention):**
```
[ClassName]Tests.cs          # C#
[ClassName].test.ts          # TypeScript/JS
test_[module].py             # Python
[module]_test.go             # Go
[Module]Test.java            # Java
method_scenario_expectedResult()   # test method name pattern, any language
should_[behavior]_when_[condition]()
```

### Integration tests

**Scope:** a small number of real collaborators working together — e.g., real repository/DAO code against a real (often containerized/in-memory) database, or a real internal module boundary. External third-party services are still faked or stubbed.
**Write when:** correctness depends on how components actually interact — a query's real SQL, a serialization boundary, an internal API contract between modules.
**Skip when:** the interaction is trivial or already fully covered by a unit test with a well-justified test double.

### Component tests (frontend-specific)

**Scope:** one UI component rendered via a test renderer (e.g., Testing Library, Storybook interaction tests, Cypress/Playwright Component Testing), asserting on rendered output and user-observable behavior — not internal state or implementation details.
**Write when:** the component has meaningful logic, conditional rendering, or user interaction (form validation, toggles, async loading states).
**Principle:** query by role/text/label the way a user would (`getByRole`, `getByLabelText`), not by CSS class or internal test IDs unless nothing else is stable — this keeps tests resilient to refactors.

### End-to-end (E2E) / UI journey tests

**Scope:** a full user journey through the real (or near-real) system — real browser or app driver, ideally close-to-real backend.
**Write when:** the journey is business-critical (login, checkout, payment, primary conversion flow) and a regression there would be high-impact.
**Keep deliberately few:** they're the slowest and most flaki-prone layer. Prefer resilient selectors (`data-testid` or accessible roles, not brittle CSS paths), explicit waits over `sleep()`, isolated/disposable test data, and cleanup after the run. Never run destructive tests against production data.

## The Agile Testing Quadrants — what is this test *for*

Originally Brian Marick's four-quadrant model, developed further by Lisa Crispin & Janet Gregory in *Agile Testing: A Practical Guide for Testers and Agile Teams*. Two axes: business-facing vs. technology-facing, and supporting the team (guiding development) vs. critiquing the product (evaluating what was built).

- **Q1 — technology-facing, supports the team:** unit and component tests, automated. This is most of the pyramid's base.
- **Q2 — business-facing, supports the team:** functional tests expressed as examples/story tests — acceptance criteria turned into checks, often automated (e.g. Given–When–Then style).
- **Q3 — business-facing, critiques the product:** exploratory testing, usability testing, user acceptance testing — largely manual, human-judgment-driven. Don't let an automated-test-only plan silently skip this quadrant; genuinely new or ambiguous behavior benefits from a short exploratory session (session-based test management, per Cem Kaner / James Bach) in addition to scripted cases.
- **Q4 — technology-facing, critiques the product:** performance, load, security, and other non-functional ("-ilities") testing — often needs specialized tools, but at minimum flag when a change touches a hot path or trust boundary.

Use the quadrants as a checklist after drafting a pyramid-shaped plan: does this change need anything from Q3 or Q4 that a purely pyramid-shaped plan would miss?

## Test size (a third, independent axis)

The small/medium/large classification used at Google (see *Software Engineering at Google*, Winters, Manshreck & Tannenbaum) classifies a test by *what it's allowed to touch* — small (single process, no network/disk/sleep), medium (single machine, e.g. localhost network or a local DB), large (multiple machines, real external systems) — independent of which pyramid layer or quadrant it belongs to. This is a useful lens for CI design: it determines whether a test can run in a fast, parallel, hermetic shard, or needs a slower, more realistic environment.

## Contract / API tests

**Scope:** verifying that a service honors its published interface (REST/GraphQL/gRPC schema, request/response shape, status codes, error format) — often via schema validation or consumer-driven contract tests (e.g. Pact-style).
**Write when:** the change touches a public/internal API boundary that other services or clients depend on, especially before a breaking-change risk.

## Non-functional tests (Quadrant 4 / ISTQB non-functional testing) — call these out even if not asked

- **Performance/load:** when the change touches a hot path, a loop over large collections, or a query that could scale badly — flag it and suggest a benchmark or load test rather than silently skipping.
- **Security-relevant:** when code parses external/user input, handles auth, or touches a trust boundary — test for injection-shaped input, oversized payloads, and auth-bypass attempts *at the level of "does the code reject/handle this safely,"* not by crafting a working exploit.
- **Accessibility (frontend):** for user-facing components, note whether accessibility checks (e.g. `axe`-based assertions) exist or should be added.
- **Visual regression:** for pixel/layout-sensitive UI, note whether snapshot/visual-diff tooling exists in the project and use it consistently rather than introducing screenshot tests ad hoc.

## Putting the three lenses together

For a given change, ask, in order: (1) pyramid — what level(s) does the logic itself call for; (2) quadrants — does this also need a Q3 exploratory pass or a Q4 non-functional check; (3) test size — given CI constraints, does each planned test need to be small, medium, or large. Adjust the overall shape to the project: a component-heavy frontend will have a thicker component-test layer; a data-pipeline service will lean more on integration tests over unit tests. There is no single correct ratio — only a defensible one, given the risk of what you're building.
