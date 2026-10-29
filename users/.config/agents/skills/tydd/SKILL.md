---
name: tydd
description: >-
  Enforces a strict two-phase Type-Driven Development (TyDD) workflow where the agent designs domain types, data
  structures, interfaces, function signatures, and semantic skeleton comments (`TODO`, `FIXME`, `SAFETY-INVARIANT`)
  FIRST, verifies that the skeleton type-checks, and pauses for user review and sign-off before writing implementation
  logic. Use whenever the user mentions Type-Driven Development, TyDD, `tydd`, types-first coding, signature-first
  design, designing types or interfaces before implementation, reviewing data models or API contracts before coding, or
  asks not to write all implementation code in one shot (e.g., "stub out the types and signatures first", "let me review
  the types before you implement", "model the domain first").
---

# Type-Driven Development (TyDD)

## Role & Philosophy

Type-Driven Development (TyDD) treats types as executable specifications and the primary design language of software.
Instead of generating hundreds of lines of implementation code in a single turn — which often bakes in flawed domain
assumptions, primitive obsession, or leaky abstractions that are expensive to untangle — collaborate with the user in
**two gated phases**:

1. **Phase 1: Type Modeling & Semantic Skeleton (Stop for Review)** — Define precise domain types, state transitions,
   interfaces/traits, and function signatures with type-checkable holes and structured skeleton comments, verify that
   the skeleton compiles/type-checks, and **stop for user feedback**.
2. **Phase 2: Hole-Driven Implementation** — Only after the user approves or refines the types and signatures, fill in
   the runtime implementation logic step by step.

The judgment calls below are grounded in established type-systems literature — Edwin Brady (_Type-Driven Development
with Idris_), Yaron Minsky (Jane Street), Scott Wlaschin (_Domain Modeling Made Functional_), Alexis King (_"Parse,
don't validate"_), and Will Crichton (_Type-Driven API Design in Rust_). Full language-specific patterns and complete
Before/After Phase 1 examples are in `references/principles-and-patterns.md`.

## Core Design Principles

Apply these four foundational principles whenever modeling types in Phase 1:

1. **Make Illegal States Unrepresentable (Yaron Minsky & Scott Wlaschin)**: Replace loosely coupled boolean flags,
   nullable fields, and stringly-typed status codes with **sum types** (tagged unions / enums) and **product types**
   (structs / records) whose cardinality matches the exact set of valid domain states. If a field only exists in one
   state (e.g., `tracking_number` only exists when an order is `Shipped`), attach it to that variant instead of making
   it optional on a flat record.
2. **Parse, Don't Validate (Alexis King)**: Do not write validation functions that check raw primitives (`string`,
   `int`, `list`) and return `void` or `bool`, discarding the proof that the check succeeded ("shotgun parsing"). Parse
   unstructured input at the system boundary into **refined domain types** (newtypes, branded types, non-empty
   collections, or smart constructors with private fields) that carry the invariant in the type system.
3. **Avoid Primitive Obsession & Cardinality Mismatch (Will Crichton)**: Wrap domain identifiers (`UserId`, `OrderId`),
   quantities (`CentAmount`, `Ratio`), and verified inputs (`EmailAddress`) in distinct types so callers cannot swap
   them accidentally. Encode sequential protocol order via typestates (`Invoice<Draft>` -> `Invoice<Approved>`) when
   operations are only legal in specific lifecycle stages.
4. **Total Signatures & Typed Holes (Edwin Brady)**: Every signature should be **total** — every possible input maps to
   a valid output or an explicit domain error variant in the return type (`Result<T, DomainError>`), never an
   undocumented exception or boolean. Populate function bodies with language-native typed holes so the compiler verifies
   data flow across module boundaries before you write algorithm details.

## The Two-Phase Workflow

### Phase 1: Domain Types, Signatures & Semantic Skeleton (MANDATORY STOP)

When given a feature, module, refactoring, or coding request under TyDD, **do not write runtime business logic or
algorithm bodies in your first turn**. Execute Steps 1–5 and pause:

#### Step 1 — Inspect the project's type system & conventions

Before writing any types, establish the target language, compiler/type-checker, and idioms from repository evidence:

- Check existing modules for error-handling conventions (`thiserror`, custom `Result` types, union returns), naming
  style, visibility rules, and serialization boundaries.
- If the request is standalone (no repo or file specified), match the language specified in the user's prompt.

#### Step 2 — Model the domain types & interfaces

1. **Domain primitives & smart constructors**: Define newtypes, branded types, or private-field structs with `parse` /
   `try_new` constructors for boundary inputs that have invariants (non-empty strings, bounded numbers, validated IDs).
2. **State & entity sum types**: Model mutually exclusive states and domain lifecycles as enums or discriminated unions
   with state-specific payloads.
3. **Explicit error sum types**: Define domain-specific error enums/unions for each boundary or operation so failure
   modes are self-documenting in the signature.
4. **Traits / Interfaces / Protocols & Function Signatures**: Write top-level function, method, and interface signatures
   connecting the domain types. Prefer small, consumer-focused interfaces and pure domain functions separated from I/O.

#### Step 3 — Populate bodies with typed holes & structured skeleton comments

Replace every runtime implementation body (smart constructors, parsers, state transitions, and business logic) with a
**type-checkable hole** (`todo!("...")` in Rust, `throw new Error("TODO")` in TypeScript,
`raise NotImplementedError("...")` in Python, `panic("TODO")` in Go, `_` in Haskell — see
`references/principles-and-patterns.md` for language idioms). Trivial one-line read-only field accessors (`&self.0`,
`return self._value`) and `Protocol`/trait method signatures (`...`) do not need `todo!()` stubs.

Inside each stubbed function (and above non-obvious types), write 2–5 concise, high-signal comments using this taxonomy
(adjusting comment syntax `//` or `#` to the language):

- `TODO(domain): <core invariant, state transition, or business rule the implementation will enforce>`
- `TODO(edge-case): <specific boundary condition, concurrency hazard, idempotency rule, or failure mode to handle>`
- `TODO(perf): <algorithmic complexity, zero-copy, batching, or allocation constraint — include only when relevant>`
- `FIXME(design-question): <open trade-off, ambiguity, or policy question that needs the user's decision before Phase 2>`
- `SAFETY-INVARIANT: <why a smart constructor or private field guarantees an invariant that static types alone cannot express>`

#### Step 4 — Verify that the skeleton compiles / type-checks

If you are working in a codebase or environment with a type-checker (`cargo check`, `tsc --noEmit`, `mypy --strict` /
`pyright`, `go vet` / `go build`), run it on the Phase 1 skeleton and fix any type, lifetime, or import errors before
presenting the skeleton to the user.

#### Step 5 — Present the Phase 1 design brief & stop for user sign-off

Conclude your turn with a concise **Phase 1 Design Brief**:

1. **Illegal states eliminated**: Briefly list which invalid combinations or primitive traps the new types prevent at
   compile time.
2. **Open design questions (`FIXME(design-question)`)**: Surface any trade-offs or domain ambiguities Marked in the
   skeleton so the user can decide them directly.
3. **Explicit pause**: Ask the user to review the types and signatures, answer any open questions, and confirm when to
   proceed to Phase 2. **Stop your turn here.**

---

### Phase 2: Hole-Driven Implementation (After User Sign-Off)

Proceed to Phase 2 **only** after the user approves the Phase 1 skeleton (or if the user explicitly instructed you to
skip the review gate):

1. **Apply type refinements first**: If the user requested changes to types, variants, or signatures, update the type
   definitions first and let the compiler guide call-site updates.
2. **Fill holes iteratively**: Replace each typed hole with runtime logic that satisfies the approved signature and its
   `TODO(domain)` / `TODO(edge-case)` specifications.
3. **Clean up temporary skeleton markers**: Delete resolved `TODO(...)` and `FIXME(...)` comments once the code itself
   expresses that logic. Keep only permanent `SAFETY-INVARIANT` or rustdoc/docstring comments that explain _why_ a
   non-obvious invariant holds.
4. **Preserve type safety**: Never weaken Phase 1 types during Phase 2 with `any`, `as unknown as T`, unchecked casts,
   `unsafe`, or `.unwrap()` on fallible domain operations unless explicitly justified and approved.
5. **Verify**: Run the compiler, type-checker, and test suite to confirm all contracts hold.

## Anti-Patterns to Avoid

| Anti-Pattern                                            | TyDD Replacement                                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Writing types and full implementation in the first turn | Stop after Phase 1 skeleton; wait for user sign-off unless explicitly told to skip review.                      |
| Trivial comments (`// TODO: implement this`)            | Write specific `TODO(domain)` and `TODO(edge-case)` rules that the user can audit before coding.                |
| 50 lines of commented-out pseudo-code inside a stub     | Keep stubs to 2–5 high-signal comment lines plus the language's typed hole expression.                          |
| Returning `bool` or `void` from a validator             | Parse into a refined type (`Result<VerifiedEmail, EmailError>`) so the proof is preserved.                      |
| Flat structs with mutually exclusive optional fields    | Use a sum type (enum / discriminated union) where each variant holds only its valid fields.                     |
| Unreadable type-level gymnastics for simple constraints | Prefer private fields with smart constructors (`parse` / `try_new`) when type-level encoding hurts readability. |

## Reference Files

- `references/principles-and-patterns.md` — Read when modeling complex state machines/typestates, looking up
  language-specific typed holes (Rust, TypeScript, Python, Go, Haskell/Idris), or reviewing complete Before/After Phase
  1 skeleton transformations.
