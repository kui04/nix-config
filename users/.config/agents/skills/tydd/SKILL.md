---
name: tydd
description: >-
  Design domain types, state machines, boundary parsers, and API signatures before writing implementation code so
  illegal states fail to compile. Apply this workflow when modeling data or workflows, parsing untrusted inputs,
  refactoring primitive obsession, boolean flags, `any`, casts, or null checks, or auditing type safety—even if the user
  never mentions "TyDD". Do not use for prose, visual styling, or tasks without code or schemas.
---

# TyDD — Type-Driven Development

## Role

Practice **Type-Driven Development (TyDD)**: treat the type system as a primary design tool and machine-checked
specification before writing implementation code, never as annotations bolted on afterward. Keep principles
language-agnostic and realize them idiomatically in the project's actual language and type checker. Use types to
eliminate entire bug classes and reduce cognitive load—never introduce unreadable type gymnastics.

## Core workflow

Follow the **Type -> Confirm -> Define & Refine -> Verify** loop below. For **type reviews or audits** of existing code,
run Steps 1–2 plus the escape-hatch audit in `references/type-system-adaptation.md`, then report findings and proposed
refined signatures without modifying files unless asked.

### Step 1 — Establish the language, type checker, and strictness baseline

Never invent type syntax or import idioms from a different language without checking what the project actually uses.
Gather evidence in this order:

1. If the user or conversation named the language, type checker, or schema library, treat that as authoritative.
2. Otherwise, inspect the project manifest, lockfile, and type-checker config (for example `tsconfig.json`,
   `Cargo.toml`, `pyproject.toml`, `pyrightconfig.json`, `mypy.ini`, `go.mod`, `pom.xml`, `build.gradle`, `*.cabal`)
   plus nearby source files to determine:
   - The active language version and static type checker (and how to invoke it locally).
   - Active strictness flags (e.g., TypeScript `strict` / `noUncheckedIndexedAccess`, Python `pyright` strictness or
     `mypy --strict`, Rust lints, Java/Kotlin nullability annotations).
   - Existing domain primitives, error/Result conventions, and boundary-parsing libraries (e.g., Zod, Valibot, Pydantic,
     serde, aeson) so new types fit the codebase rather than inventing a parallel style.
3. If no repo exists yet or the target language/toolchain is genuinely ambiguous, ask the user before writing types.
4. Load `references/type-system-adaptation.md` when choosing idiomatic encodings for the project's language tier (rich
   ADT, mainstream OOP/structural, minimal static like Go, or gradually typed like Python).

### Step 2 — Map boundaries, invariants, and state transitions

Before writing code, analyze the problem space and separate what belongs in types from what belongs elsewhere. Read
`references/modeling-patterns.md` for the full pattern catalog and anti-over-typing rules.

Identify five things explicitly:

- **Trust boundaries** — where untrusted, raw, or serialized data enters (HTTP/RPC payloads, CLI args, env vars, files,
  DB rows, external SDKs). **Parse, don't validate**: convert raw inputs into proof-carrying domain types once at the
  boundary, instead of scattering defensive checks through core logic.
- **Domain invariants & cardinality** — list every rule that must hold (e.g., non-empty list, positive amount, same
  currency, verified email, mutually exclusive fields). Compare the type's **cardinality** (number of representable
  values) against the number of legal domain states; close the gap with sum types, newtypes/brands, and smart
  constructors so **illegal states are unrepresentable**.
- **Workflows & state transitions** — if an entity or protocol moves through phases (e.g.,
  `Draft -> Submitted -> Approved | Rejected`), model each phase as a distinct type or tagged state and each transition
  as a function signature from one state to the next. Eliminate **boolean blindness**: replace correlated booleans and
  nullable field clusters (`isPaid`, `paidAt?`, `receiptId?`) with explicit variants carrying their exact data.
- **Failure modes** — distinguish expected domain errors (encoded in return types such as `Result`/`Either` or error
  unions) from programming bugs / broken invariants.
- **What types should NOT encode** — recognize the ceiling of the host type system. Cross-record uniqueness, arithmetic
  formulas, business rates, and invariants that require opaque type-level programming belong in boundary parsers,
  runtime assertions, or property-based/unit tests. Stop encoding in the type system the moment complexity harms
  readability or compiler error clarity more than the bug class it prevents.

### Step 3 — Type: Write the type skeleton and TODO stubs in the codebase

Write the domain types, function signatures, and `TODO` stubs directly in the target source files **before** writing any
implementation bodies (skip file edits only when no repository exists yet, for read-only audits, or when the user
explicitly asks for a design-only proposal in chat):

1. Define value objects / newtypes, algebraic data types (products for AND, sums for OR), smart-constructor signatures,
   workflow step signatures, and explicit error types using the domain's terminology.
2. Stub every function body with the language's idiomatic **typed hole** (`todo!()`, `unimplemented!()`, `undefined` /
   `_hole` in Haskell, `throw new Error("TODO: <step>")` in TypeScript, `raise NotImplementedError("TODO: <step>")` in
   Python, `panic("TODO: <step>")` in Go) so the architecture compiles and type-checks while implementation remains
   deferred. For large workflows, decompose complex functions into smaller typed helper signatures with their own `TODO`
   stubs.
3. Run the type checker or compiler on the type skeleton (when a local environment is available) to verify that the
   contracts compose cleanly with no circularity, variance, or ownership conflicts before review.

### Step 4 — Contract gate: Confirm with the user before implementing

**After the type skeleton passes the type checker, stop and present the type contract to the user for approval before
filling any `TODO` body — every time.** Skip this checkpoint only when the user has explicitly opted out in the current
conversation (for example "just implement it" or "skip type review"). Even for small tasks, let the user decide whether
to skip.

Present a concise, scannable summary:

1. **Type & signature summary** — point to the added or updated files (and include a concise snippet when useful)
   showing domain types, state transitions, smart constructors, and public signatures.
2. **Invariant allocation** — brief table or list showing which invariants are enforced at _compile time_ (type
   structure), at _boundary parse time_ (smart constructor/parser), and _deferred to runtime/tests_ (and why).
3. **Trade-offs & gaps** — any non-obvious modeling choice (e.g., tagged union vs. generic typestate, newtype vs. type
   alias), strictness gaps in the project's config, or isolated boundary adapters.

Wait for the user to approve or request changes before proceeding to Step 5.

### Step 5 — Define, refine, and verify

Once the user approves the type contract:

1. **Fill `TODO` stubs incrementally** — start with boundary parsers and smart constructors, then pure core
   transformations, then thin imperative/I/O adapters at the edges (functional core / imperative shell). Re-run the type
   checker after each coherent slice so compiler feedback guides every step.
2. **Refine types first when reality pushes back** — if implementation reveals an unmodeled case, missing error, or
   awkward conversion, do not hack around it inside a function body. Refine the _type_ (confirm with the user first if
   it alters an agreed public contract or domain rule), then let the compiler locate every downstream call site that
   must update.
3. **Verify mechanically** — confirm zero remaining `TODO` / typed-hole stubs and zero unapproved escape hatches (check
   the audit table in `references/type-system-adaptation.md`), then run the project's actual type checker / compiler and
   existing tests.
4. **Close the loop with testing handoff** — summarize:
   - What the type checker now proves statically (impossible state combinations, exhaustiveness, ID/unit separation,
     call ordering).
   - Any contract refinements made during implementation and why.
   - Which behavioral or dynamic invariants remain outside the type system and should be verified by unit,
     property-based, or integration tests (e.g., arithmetic formulas, ordering rules, parser round-trips
     `parse(format(x)) == Ok(x)`, cross-record uniqueness, concurrency, and persistence — natural handoff to testing /
     `test-engineer`).

## When the type checker fails: diagnose before weakening a type

Treat every type-checker error as a design signal, never as an obstacle to silence. An agreed type contract is a formal
specification; weakening a type or inserting an escape hatch solely to pass the checker destroys the guarantees
established in Steps 3–4.

When the type checker rejects code, work through this sequence before changing any type:

1. **Read the full diagnostic first** — identify the exact expected type, inferred type, variance/nullability/ownership
   mismatch, and where the conflicting type originated.
2. **Classify the root cause** — it is almost always one of four cases:
   - _Implementation bug_ (the code violates the agreed contract) -> fix the implementation; keep the type intact.
   - _Missing boundary parse_ (raw/unverified data leaked into the core) -> parse and narrow it at the trust boundary
     instead of widening core signatures to accept raw or nullable inputs.
   - _Domain model gap_ (the type genuinely missed a real state, error, or constraint) -> treat this as a **Refine**
     event: explain the gap to the user, agree on the updated type before altering public contracts, and let the
     compiler drive all affected call sites.
   - _Typed-to-untyped interop boundary_ (FFI, reflection, untyped third-party SDK, wire deserialization) -> isolate the
     conversion in a single small boundary adapter, validate the runtime shape before narrowing, and document the
     soundness invariant in a brief comment.
3. **Never take these shortcuts merely to make the checker pass**:
   - Inserting `any`, unchecked casts (`as T`, `as unknown as T`, `cast()`), non-null assertions (`!`), `@ts-ignore` /
     `@ts-expect-error`, or `# type: ignore` to silence a mismatch not proved safe.
   - Replacing explicit `Result`/`Option` handling with `.unwrap()`, `.expect()`, or `unsafe` in domain/library code.
   - Widening a domain type back to raw primitives (`string`, `int`, `bool`, `dict[str, Any]`, `map[string]any`) or
     adding optional/nullable fields that re-introduce illegal states.
   - Adding a catch-all wildcard (`default:`, `_ =>`) on a closed sum type purely to satisfy exhaustiveness, because
     wildcards silently swallow future variants when the domain evolves.
4. **Report every resolution explicitly** — state whether a failure was an implementation bug fixed under the contract,
   a boundary parser added, or a type refinement (and why). Never return a clean compile with silent type weakenings.

## Quick reference — pattern selector

| Problem smell                                            | TyDD pattern                              | Reference                              |
| -------------------------------------------------------- | ----------------------------------------- | -------------------------------------- |
| Swappable primitives (`userId: string, orgId: string`)   | Newtype / Branded type                    | `references/modeling-patterns.md`      |
| Repeated `if (!valid)` checks across internal functions  | Parse, don't validate + Smart constructor | `references/modeling-patterns.md`      |
| Bag of booleans or optional fields that must co-occur    | Algebraic sum type (discriminated union)  | `references/modeling-patterns.md`      |
| Predicate returns `bool` and caller re-checks / unwraps  | Defeat boolean blindness (return proof)   | `references/modeling-patterns.md`      |
| Operations only valid in certain lifecycle stages        | Typestate / Phase-specific types          | `references/modeling-patterns.md`      |
| Function can inspect/mutate more than its role requires  | Parametricity / narrow capabilities       | `references/modeling-patterns.md`      |
| Legacy codebase with loose types around the target slice | Strangler type boundary                   | `references/modeling-patterns.md`      |
| Cross-language encoding or strictness setup              | Tier 1–4 adaptation guide                 | `references/type-system-adaptation.md` |

## Reference files

Load only the reference file relevant to the current step — do not load both upfront unless needed:

- `references/modeling-patterns.md` — Core TyDD patterns, cardinality audits, algebraic modeling, typestate, phantom
  proofs, error pipelines, strangler boundaries for legacy code, and the anti-over-typing guardrail.
- `references/type-system-adaptation.md` — Idiomatic realizations and strictness baselines across language tiers (Rust,
  TypeScript, Python, Go, Java/Kotlin/Swift/C#, Haskell/OCaml/F#/Scala).
