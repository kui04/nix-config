# Test Case Design Techniques

These are the "what should I actually test" tools — use them to derive a case list systematically, instead of writing whatever happy-path case comes to mind first. ISTQB groups techniques this way, and it's a useful frame for choosing among them: **black-box** (derived from a specification/behavior, without looking at the code), **white-box/structural** (derived from the code's internal structure), and **experience-based** (derived from tester intuition and history of past defects). Use black-box techniques first, add white-box coverage analysis to find gaps, and finish with experience-based error guessing.

## The seven ISTQB testing principles — why these techniques look the way they do

The ISTQB Foundation syllabus compresses decades of testing experience into seven principles. Every technique below is downstream of one of them, so check your plan against this list before committing to it:

1. **Testing shows the presence of defects, never their absence** — a green suite is evidence, not proof; report coverage honestly and never claim a system is "fully tested."
2. **Exhaustive testing is impossible** — everything in this file exists to sample intelligently instead of testing everything.
3. **Early testing saves time and money** — designing cases from the spec before the code exists makes defects cheapest to fix (see the TDD section in `references/test-doubles-and-quality.md`).
4. **Defects cluster together** — most failures come from a small number of modules; bug history concentrates effort where it pays (the empirical basis of risk-based prioritization below).
5. **Beware the pesticide paradox** — the same tests, run repeatedly, stop finding new defects; refresh stale suites with new cases and periodic exploratory sessions instead of only rerunning the regression set.
6. **Testing is context dependent** — no universally correct technique mix or layer ratio exists; e-commerce checkout and embedded firmware deserve different strategies.
7. **Absence of errors is a fallacy** — defect-free software can still fail the user; finding bugs and verifying user intent are different jobs.

## Black-box techniques

### Equivalence partitioning

Introduced by Glenford Myers in *The Art of Software Testing* as one of the foundational systematic techniques. Split the input space into partitions where every value in a partition should behave the same way, then test one representative per partition — not every value. Myers' method, in order:

1. Partition **every input** — including invalid ones the spec doesn't mention (wrong type, out of range) — and partition the **output domain** too; Myers is explicit that output classes matter as much as input classes.
2. Make partitions disjoint and collectively exhaustive: every possible input lands in exactly one.
3. Pick one representative per partition; boundary values (next section) are the highest-yield representatives.

Myers' classic worked example — the **triangle program**: read three integers a, b, c as the sides of a triangle; report scalene (no equal sides), isosceles (exactly two equal), equilateral (all equal), or not-a-triangle (any side fails `a + b > c`, in any permutation). A naive list gets three cases; systematic partitioning exposes what the naive list misses:

- Non-integer, zero, or negative sides → rejected.
- `a + b ≤ c` in some permutation → not a triangle, *including* two-equal-side cases like `1, 2, 1` — these catch implementations that test side equality before triangle validity.
- Valid scalene; valid isosceles in all three arrangements (`a=b`, `b=c`, `a=c` — buggy if/else chains often handle only the first arrangement); valid equilateral.

### Boundary value analysis

Also from Myers, and almost always paired with equivalence partitioning: bugs cluster at boundaries. Partitions tell you *what* to test; boundaries tell you *which values*. For every range or limit — inputs, outputs, and internal limits like array capacities and loop counts — test the boundary value itself, one just inside, and one just outside. A field allowing 1–10 items → test `0`, `1`, `10`, `11` (and often `-1` for negative-boundary sanity).

### Decision tables (and cause-effect graphing)

Covered in depth by both Myers and Paul Jorgensen (*Software Testing: A Craftsman's Approach*), who argues they're the most rigorous of the functional techniques because the table can be forced to be complete, mechanically — a completed decision table *is* the proof that no combination was skipped. Build one:

1. List the **conditions** — each independently true/false.
2. List the possible **actions**.
3. Enumerate every condition combination (n booleans → 2^n columns — the point is that you *see* all of them).
4. Assign each combination's action from the spec.
5. Merge columns where a condition is a don't-care — where the outcome is identical regardless — and mark it `–`.
6. Write one test per surviving rule (column).

Discount example (member? coupon? total > 100?) — 8 raw combinations collapse to 6 rules after merging:

| Member | Coupon | >100 | Discount |
|---|---|---|---|
| Y | Y | – | 25% |
| Y | N | Y | 15% |
| Y | N | N | 10% |
| N | Y | – | 10% |
| N | N | Y | 5% |
| N | N | N | 0% |

Each `–` is two raw columns merged because the outcome doesn't depend on that condition. In ad hoc testing these combinations are exactly the ones that get skipped — a discount function driven by `isMember AND hasCoupon AND total > threshold` has 8 combinations worth enumerating, not the 1–2 obvious ones.

### State transition testing

Detailed by Jorgensen as the technique for anything with an explicit state machine (order status, auth session, a UI wizard). The model's elements: states, events, transitions, guard conditions, actions. What to derive from it:

- **Every valid transition** — one test each: given the current state and event, the machine moves to the right next state.
- **Every invalid transition** — the diagram only draws valid transitions, so build the state *table* (every state × every event) and test that each forbidden cell refuses gracefully with no side effects.
- **Reachability** — every state is actually reachable, and terminal states are reachable.

Coverage is measured in transition *sequences* (Chow's N-switch coverage, 1978, covered by Jorgensen): 0-switch = every single transition covered; 1-switch = every *pair* of consecutive transitions covered. 1-switch is what catches bugs 0-switch cannot — behavior that depends on *how* a state was reached, not just that it was reached. Test counts grow geometrically with N; in practice, full 0-switch plus risk-selected 1-switch journeys is the feasible budget.

### Pairwise / combinatorial testing

When several independent parameters each have multiple values (e.g. browser × OS × locale), testing every combination explodes combinatorially. Pairwise testing picks a much smaller set that still covers every *pair* of parameter values at least once. The empirical basis is unusually strong: NIST's studies of real failure reports (Kuhn & Reilly 2002; Kuhn, Wallace & Gallo, IEEE TSE 2004) across browsers, servers, medical devices, and NASA planning software found roughly 70–97% of reported failures were triggered by the interaction of only one or two parameter values, and no observed failure required more than six. Use pairwise instead of "test everything" (too slow) or "test one combination" (under-tested) when there are 3+ largely-independent parameters. The same research supplies the caveat: a few domains needed 4-way interactions to reach the last faults — raise strength (3-way, 4-way) for security-critical or high-risk configuration surfaces instead of assuming pairwise is always enough.

## White-box / structural techniques

Boris Beizer's *Software Testing Techniques* is the classic reference for structural coverage criteria, arranged in a hierarchy of increasing rigor: statement coverage (every line executed at least once) → branch/decision coverage (every branch taken both ways) → condition coverage (every boolean sub-condition evaluated both ways) → path coverage (every possible route through the code, usually only tractable for small units); data-flow coverage (every variable definition reaches every use) is a complementary criterion alongside this hierarchy rather than its top rung — it neither subsumes path coverage nor is subsumed by it.

The subtlety worth knowing: **condition coverage does not imply decision coverage.** For `if (a || b)`, the two tests `(a=F, b=T)` and `(a=T, b=F)` flip both sub-conditions, yet the decision is true in both — its false branch never executes. When both dimensions matter, use decision/condition coverage (or MC/DC in safety-critical domains such as aviation tooling standards). Use structural coverage *after* black-box design, to find gaps the specification-based cases missed — not as a target to satisfy by writing tests that merely execute lines without asserting meaningful behavior (coverage percentage is a diagnostic, not a goal in itself).

## Experience-based techniques

### Error guessing

Named explicitly by Myers: beyond systematic techniques, deliberately think like an attacker/careless user based on experience of where bugs commonly hide — empty input, extremely long input, wrong type, duplicate submissions, double-clicks, network drop mid-request, clock/timezone edge cases (DST transitions, leap years, leap seconds), unicode/emoji/right-to-left text, null bytes, very large numbers near type limits (integer overflow), concurrent writes to the same resource. The highest-value input is the project's own defect history: past bugs predict future ones (ISTQB principle 4).

### Exploratory testing

Simultaneous learning, test design, and test execution rather than pre-scripted cases — championed by Cem Kaner, James Bach, and Bret Pettichord (*Lessons Learned in Software Testing*). When behavior is new or ambiguous, or the automated cases feel like they might be missing something a human would notice immediately: time-box a short session against a specific **charter** — "explore the checkout flow's error handling for 60–90 minutes" — and close with a debrief (what was learned, issues found, new risks, open questions). Charters guide exploration; they do not script it.

## Property-based testing

Instead of enumerating example inputs, state a property that should hold for *all* valid inputs and let the tool generate many random/edge-case inputs trying to falsify it. Originates with QuickCheck (Claessen & Hughes, ICFP 2000), whose two defining mechanics later tools all kept:

- **Declarative generators** describe the input domain; the tool samples hundreds of cases from it, including combinations no human would think to write.
- **Shrinking** — when a case fails, the tool greedily minimizes the input into a small, reproducible counterexample. This is the feature that makes property failures *debuggable*: the minimal failing input usually points directly at the bug.

Available in most ecosystems (Hypothesis for Python, proptest/quickcheck for Rust, fast-check for JS/TS, jqwik for Java). Reach for this for pure functions with a large or hard-to-enumerate input domain — properties like "sorting twice is the same as sorting once" or "serialize then deserialize returns the original value" — on top of, not instead of, a few concrete example-based tests for readability.

## Metamorphic testing — the practical response when no direct oracle exists

Sometimes there is no direct oracle: the correct output is expensive or impossible to specify exactly (rankings, search relevance, ML predictions, pipeline statistics). Barr, Harman, McMinn, Shahbaz & Yoo (*The Oracle Problem in Software Testing: A Survey*, IEEE TSE) classify oracle sources into **specified oracles** (human-written expectations — most tests), **derived oracles** (from other executions or artifacts: regression expectations, pseudo/differential oracles), **implicit oracles** (properties expected of *any* correct program: no crash, no exception, no hang, no leak), and **human oracles** (no automatable oracle — the goal becomes reducing the human's workload). Metamorphic testing (Chen et al., which the survey places with derived oracles) is the most automatable of these: instead of predicting the output, assert a **relation between two outputs**. Execute a source case, transform the input in a way whose effect on the output is predictable, and check the relation:

- Idempotence: `sort(sort(x)) == sort(x)`.
- Permutation invariance: shuffling input items doesn't change the result set.
- Subset consistency: adding a filter yields a subset of the unfiltered results.
- Round-trip: serialize then deserialize is the identity.
- Scaling: doubling every input doubles every output.

Reach for a metamorphic relation whenever exact expected values are infeasible — the relation itself becomes the oracle, and it still catches real regressions.

## Risk-based prioritization

Not everything can or should be tested equally. ISTQB frames this as prioritizing by `(likelihood of failure) × (impact if it fails)`: business-critical paths and code with a history of bugs get the most thorough case coverage; low-risk, rarely-changed, low-impact code gets a lighter pass. Say so explicitly when scoping down coverage on a large change, rather than silently under-testing.

## Putting it together — a per-unit checklist

For any non-trivial function/component under test, before writing code, run through:
1. What are the equivalence partitions of each input? One case per partition.
2. What are the boundaries of each range/limit? Test on, just-inside, and just-outside each.
3. Are there several conditions combining? Consider a decision table.
4. Is there an explicit state machine involved? Enumerate transitions.
5. After drafting cases, would structural coverage analysis reveal an untested branch?
6. What would a careless or malicious user do? Add error-guessing cases.
7. Given the risk, is this worth a property-based test, a metamorphic relation, or a short exploratory session in addition to examples?
8. Given time constraints, what's actually worth writing, given risk × impact?