# Test Case Design Techniques

These are the "what should I actually test" tools — use them to derive a case list systematically, instead of writing whatever happy-path case comes to mind first. ISTQB groups techniques this way, and it's a useful frame for choosing among them: **black-box** (derived from a specification/behavior, without looking at the code), **white-box/structural** (derived from the code's internal structure), and **experience-based** (derived from tester intuition and history of past defects). Use black-box techniques first, add white-box coverage analysis to find gaps, and finish with experience-based error guessing.

## Black-box techniques

### Equivalence partitioning

Introduced by Glenford Myers in *The Art of Software Testing* as one of the foundational systematic techniques. Split the input space into partitions where every value in a partition should behave the same way, then test one representative per partition (not every value). Example: a function accepting an age accepts `0-150` — partitions are "negative" (invalid), "0-150" (valid), "151+" (invalid). Test one value from each partition rather than every possible age.

### Boundary value analysis

Also from Myers, and almost always paired with equivalence partitioning: bugs cluster at boundaries. For every range or limit, test the boundary value itself, one just inside it, and one just outside it. Example: a field allowing 1–10 items → test `0`, `1`, `10`, `11` (and often `-1` for negative-boundary sanity).

### Decision tables (and cause-effect graphing)

Covered in depth by both Myers and Paul Jorgensen (*Software Testing: A Craftsman's Approach*). For logic driven by combinations of several boolean/enum conditions, build a table of condition-combinations → expected outcome, and write one test per row. This catches missed combinations that ad hoc testing skips — e.g. a discount function depending on `isMember AND hasCoupon AND cartTotal > threshold` has 8 combinations worth enumerating, not just the 1-2 obvious ones.

### State transition testing

Detailed by Jorgensen as a technique for anything with an explicit state machine (order status, auth session, a UI wizard): enumerate every valid transition (does it move to the right next state), every invalid transition (does it correctly refuse/error), and reachability of terminal states. Draw or list the states and transitions first, then map each to a test.

### Pairwise / combinatorial testing

When several independent parameters each have multiple values (e.g. browser × OS × locale), testing every combination explodes combinatorially. Pairwise testing picks a much smaller set of combinations that still covers every *pair* of parameter values at least once — use this instead of either "test everything" (too slow) or "test one combination" (under-tested) when there are 3+ largely-independent parameters.

## White-box / structural techniques

Boris Beizer's *Software Testing Techniques* is the classic reference for structural coverage criteria, arranged in a hierarchy of increasing rigor: statement coverage (every line executed at least once) → branch/decision coverage (every branch taken both ways) → condition coverage (every boolean sub-condition evaluated both ways) → path coverage (every possible route through the code, usually only tractable for small units) → data-flow coverage (every variable definition reaches every use). Use structural coverage *after* black-box design, to find gaps the specification-based cases missed — not as a target to satisfy by writing tests that merely execute lines without asserting meaningful behavior (coverage percentage is a diagnostic, not a goal in itself).

## Experience-based techniques

### Error guessing

Named explicitly by Myers: beyond systematic techniques, deliberately think like an attacker/careless user based on experience of where bugs commonly hide — empty input, extremely long input, wrong type, duplicate submissions, double-clicks, network drop mid-request, clock/timezone edge cases (DST transitions, leap years, leap seconds), unicode/emoji/right-to-left text, null bytes, very large numbers near type limits (integer overflow), concurrent writes to the same resource.

### Exploratory testing

Simultaneous learning, test design, and test execution rather than pre-scripted cases — championed by Cem Kaner, James Bach, and Bret Pettichord (*Lessons Learned in Software Testing*). Time-box a short session against a specific "charter" (e.g. "explore the checkout flow's error handling for 30 minutes") when behavior is new, ambiguous, or the automated cases feel like they might be missing something a human would notice immediately.

## Property-based testing

Instead of enumerating example inputs, state a property that should hold for *all* valid inputs (e.g. "sorting twice is the same as sorting once," "serialize then deserialize returns the original value") and let the tool generate many random/edge-case inputs to try to falsify it — an approach that originates with QuickCheck (Claessen & Hughes) and is available in most ecosystems today (Hypothesis for Python, proptest/quickcheck for Rust, fast-check for JS/TS, jqwik for Java). Reach for this for pure functions with a large or hard-to-enumerate input domain, on top of — not instead of — a few concrete example-based tests for readability.

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
7. Given the risk, is this worth a property-based test in addition to examples, or a short exploratory session?
8. Given time constraints, what's actually worth writing, given risk × impact?
