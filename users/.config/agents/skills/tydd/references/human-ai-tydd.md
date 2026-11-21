# Human-AI Collaboration in TyDD

Types are the highest-leverage interface between a human engineer and a coding agent. A human cannot reliably audit
hundreds of lines of defensive runtime checks for subtle invariant drift, and an LLM loses track of implicit global
invariants across large contexts. When invariants live in the type system:

- **The human reviews intent, not boilerplate** — a 30–60 line type contract exposes domain rules, legal states, and
  failure modes at a glance.
- **The AI gets context-free local proofs** — function signatures tell the agent exactly what preconditions hold and
  what state transitions are legal without re-reading the whole repository.
- **The compiler closes the feedback loop** — type errors provide deterministic, semantic diagnostics instead of vague
  runtime failures.

## Contents

1. [Role Division Protocol](#1-role-division-protocol)
2. [Type Contract Review Template (Step 4 Gate)](#2-type-contract-review-template-step-4-gate)
3. [Typed-Hole Decomposition](#3-typed-hole-decomposition)
4. [Strangler Type Boundaries for Legacy Codebases](#4-strangler-type-boundaries-for-legacy-codebases)
5. [Types + Properties: Handoff to Testing](#5-types--properties-handoff-to-testing)
6. [Type-Error Diagnosis Playbook](#6-type-error-diagnosis-playbook)

---

## 1. Role Division Protocol

Keep ownership crisp throughout the session:

| Concern                                          | Owner                       | Why                                                                     |
| ------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------- |
| Ubiquitous language & business rules             | Human                       | Only the human knows true product intent and acceptable edge behavior   |
| Invariant boundaries (what is illegal vs. legal) | Human approves, AI drafts   | AI surfaces cardinality gaps and missing states; human decides truth    |
| Over-typing vs. pragmatism trade-offs            | Human approves, AI flags    | Team readability and maintenance budget are human judgments             |
| Type skeleton & typed holes                      | AI                          | Fast, systematic translation of domain rules into language idioms       |
| Implementation inside approved type constraints  | AI                          | Compiler constrains generation and catches out-of-order / missing cases |
| Mechanical verification (type checker + tests)   | AI                          | Deterministic check before handing back                                 |
| Contract refinements discovered during `Define`  | AI proposes, Human approves | Changing an agreed public type changes the specification                |

---

## 2. Type Contract Review Template (Step 4 Gate)

When pausing at Step 4 before filling function bodies, present a concise, scannable contract in this structure (adapt
headers to the user's language while preserving all four parts):

```markdown
### Type Contract Proposal

#### 1. Type & Signature Skeleton

<concise code block with domain types, smart constructor signatures, state transitions, error sums, and typed holes>

#### 2. Invariant Allocation

| Invariant / Rule                          | Enforced where      | Mechanism / Notes                                       |
| ----------------------------------------- | ------------------- | ------------------------------------------------------- |
| Order ID cannot be confused with User ID  | Compile time        | Distinct newtype / brand `OrderId` vs `UserId`          |
| Email has valid syntax and lowercase form | Boundary parse time | `EmailAddress.parse(raw)` at API ingress                |
| Paid order always has receipt & timestamp | Compile time        | Sum variant `OrderState::Paid { receiptId, paidAt }`    |
| Discount total never exceeds subtotal     | Runtime + Tests     | Arithmetic constraint; checked in `applyDiscount` + PBT |

#### 3. Trade-offs & Assumptions

- <e.g., Used tagged union instead of generic typestate because orders are loaded dynamically from DB>
- <e.g., `tsconfig.json` lacks `noUncheckedIndexedAccess`; noted as a strictness gap>
- <any isolated boundary cast/adapter and why it is sound>

#### 4. Ready to proceed?

Confirm this type contract to begin filling the typed holes, or tell me which types, invariants, or trade-offs to refine
first.
```

### Why every section matters

- **Invariant Allocation** prevents silent gaps: neither human nor AI mistakenly assumes the compiler checked a rule
  that was actually deferred to runtime/tests.
- **Trade-offs & Assumptions** gives the human real leverage before implementation starts, avoiding wasted rounds.

---

## 3. Typed-Hole Decomposition

Adapted from Edwin Brady's interactive hole-driven workflow (_Type-Driven Development with Idris_):

When a task spans multiple steps or modules, do not jump straight to a monolithic implementation:

1. **Skeleton pass (Type)**: Write all domain types, error sums, and top-level workflow signatures with typed holes
   (`todo!()`, `throw new Error("TODO")`, `raise NotImplementedError`, `panic("TODO")`). Run the type checker to prove
   the pipeline stages compose (`Stage1 -> Stage2 -> Stage3`).
2. **Boundary pass (Define ingress)**: Fill smart constructors and trust-boundary parsers first. Run the type checker.
3. **Core pass (Define pure logic)**: Fill pure domain transformations one hole at a time. When a hole is still large,
   split it into two smaller typed helper signatures with their own holes before implementing either. Run the type
   checker after each slice.
4. **Shell pass (Define I/O adapters)**: Connect DB/HTTP/CLI adapters at the edges, translating external errors into the
   explicit domain/boundary error types.
5. **Hole audit**: Confirm zero remaining typed holes (`todo!()`, `TODO`, `NotImplementedError`, `unimplemented!()`) and
   run the full type checker + test suite.

---

## 4. Strangler Type Boundaries for Legacy Codebases

Real codebases rarely start clean. Never attempt to rewrite an entire legacy codebase into strict types for a localized
task. Instead, build a **Strangler Type Boundary** around the slice you are touching:

1. **Draw a clean seam** at the entry point of the module or feature you own.
2. **Parse inward at the seam**: Convert legacy loosely typed inputs (`dict`, `any`, nullable God-objects, raw strings)
   into tight domain types right at the module boundary via a small dedicated adapter function.
3. **Keep the interior pure and tight**: Write all new or refactored logic inside the seam using strong TyDD types with
   zero escape hatches.
4. **Serialize outward at the exit seam**: Convert back to the legacy shape only at the boundary required by existing
   callers, isolating the compatibility glue in one obvious place.
5. **Expand incrementally**: Each future task moves the seam one layer outward. Name legacy type-debt you noticed
   outside your scope rather than silently refactoring unrelated modules.

---

## 5. Types + Properties: Handoff to Testing

Mark Seemann (_"Types + Properties = Software"_) emphasizes that **types and tests are complementary, not rivals**:

- **Static types** prove _structural invariants_ across all possible executions (impossible states cannot be
  constructed, exhaustiveness holds, wrong IDs cannot be swapped, protocols are called in order).
- **Tests (unit, property-based, integration)** prove _behavioral invariants_ across values within legal types (the
  discount formula is accurate, sorting is idempotent, parser round-trips with serializer, DB transactions commit
  atomically).

### Division of responsibility

| Property to verify                                       | Primary tool                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Illegal state combinations cannot exist                  | Type system (ADTs, newtypes)                                                                        |
| Callers handle every domain outcome / variant            | Type system (exhaustiveness)                                                                        |
| Boundary parser accepts valid inputs & rejects malformed | Unit tests + boundary / fuzz tests                                                                  |
| Round-trip (`parse(format(x)) == Ok(x)`)                 | Property-based testing (PBT)                                                                        |
| Arithmetic / business calculations & ordering rules      | Unit tests + PBT                                                                                    |
| Cross-aggregate uniqueness, concurrency, I/O persistence | Integration tests                                                                                   |
| Compile-time rejection of illegal states (API libraries) | Compile-fail tests (e.g., `trybuild`, `@ts-expect-error` in type-test files, `mypy` negative tests) |

When finishing Step 5, explicitly hand off the non-type-checked invariants as a short list of recommended test targets
(for example, pairing naturally with the `test-engineer` skill).

---

## 6. Type-Error Diagnosis Playbook

When the type checker fails during `Define` or `Refine`, use this structured triage before editing any signature:

1. **Mismatch on a domain newtype / brand** (e.g., `Expected UserId, found string`):
   - _Good!_ The type system just caught unparsed or misrouted data. Trace back to the trust boundary and parse there,
     or pass the already-parsed value down. Never unwrap to `string` or add a cast inside core logic.
2. **Non-exhaustive match error after adding a variant**:
   - _Good!_ The compiler is giving you an exact refactoring checklist. Visit every reported site and decide the true
     domain behavior for the new variant. Never add `_ =>` / `default:` to make it go away.
3. **Mismatch between two workflow stages**:
   - Check whether a missing intermediate state or error conversion belongs in the pipeline. If the approved contract
     missed a legitimate transition, pause and propose a **Refine** update to the human.
4. **Variance or mutability error** (e.g., `List<Sub>` not assignable to `List<Base>`, or Rust borrow-checker conflict):
   - Usually signals a design flaw in ownership or mutability. Prefer immutable/read-only views (`ReadonlyArray<T>`,
     `Sequence[T]`, slices `&[T]`) or split read vs. write structs instead of forcing casts or `unsafe`.
5. **Untyped external boundary** (JSON payload, untyped JS/Python library, FFI pointer):
   - Isolate the untyped call in one small adapter function, validate the runtime shape immediately into a domain type
     (returning a `Result` / error on failure), and document why any single narrowing assertion is sound.
