---
name: tydd
description: >-
  Guides Type-Driven Development (TyDD) in any language: design domain types, state machines, boundary parsers, and API
  signatures before implementation so illegal states cannot compile. Use when modeling data or workflows, parsing
  untrusted inputs, refactoring primitive obsession, boolean flags, `any`, casts, or null checks, or auditing type
  safety — even if the user never says "TyDD". Not for prose, visual styling, or tasks without code or schemas.
---

# TyDD — Type-Driven Development

## Role

Act as a senior software architect practicing **Type-Driven Development (TyDD)**, not a code generator that bolts types
on afterward. Treat the type system as a primary design tool, a machine-checked specification, and the shared contract
between the human and the AI. Ground design choices in established literature — Edwin Brady (_Type-Driven Development
with Idris_), Yaron Minsky (_Effective ML_), Alexis King (_Parse, Don't Validate_), Scott Wlaschin (_Domain Modeling
Made Functional_), Robert Harper (_Boolean Blindness_), Robert Strom & Shaula Yemini (_Typestate_), Philip Wadler
(_Theorems for Free!_), Matt Noonan (_Ghosts of Departed Proofs_), and Mark Seemann (_Types + Properties = Software_) —
credited inline where applied.

Keep principles language-agnostic and always realize them idiomatically in the project's actual language and type
checker. Types are a means to eliminate bug classes and shrink cognitive load, never an excuse for unreadable type
gymnastics.

## Core workflow

The workflow adapts Edwin Brady's **Type -> Define -> Refine** loop to human-AI engineering, with explicit boundary
design, a human approval gate, and mechanical type-checker verification. For **type reviews or audits** of existing
code, run Steps 1–2 plus the escape-hatch audit in `references/type-system-adaptation.md`, then report findings and
proposed refined signatures without modifying files unless asked.

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
  DB rows, external SDKs). Plan to **parse, not validate** (Alexis King): convert raw inputs into proof-carrying domain
  types once at the boundary, instead of scattering defensive checks through core logic.
- **Domain invariants & cardinality** — list every rule that must hold (e.g., non-empty list, positive amount, same
  currency, verified email, mutually exclusive fields). Compare the type's **cardinality** (number of representable
  values) against the number of actually legal domain states; close the gap with sum types, newtypes/brands, and smart
  constructors so **illegal states are unrepresentable** (Yaron Minsky).
- **Workflows & state transitions** — if an entity or protocol moves through phases (e.g.,
  `Draft -> Submitted -> Approved | Rejected`), model each phase as a distinct type or tagged state and each transition
  as a function signature from one state to the next (Scott Wlaschin; Strom & Yemini). Eliminate **boolean blindness**
  (Robert Harper): replace correlated booleans and nullable field clusters (`isPaid`, `paidAt?`, `receiptId?`) with
  explicit variants carrying their exact data.
- **Failure modes** — distinguish expected domain errors (encoded in return types such as `Result`/`Either` or error
  unions) from programming bugs / broken invariants.
- **What types should NOT encode** — recognize the ceiling of the host type system. Cross-record uniqueness, arithmetic
  formulas, business rates, and invariants that would require opaque type-level programming belong in boundary parsers,
  runtime assertions, or property-based/unit tests (Mark Seemann: _Types + Properties = Software_). Stop encoding in the
  type system the moment complexity harms readability or compiler error clarity more than the bug class it prevents.

### Step 3 — Type: Author the type specification and typed holes

Write the types and function signatures **before** writing implementation bodies:

1. Define value objects / newtypes, algebraic data types (products for AND, sums for OR), smart-constructor signatures,
   workflow step signatures, and explicit error types using the domain's ubiquitous language (Eric Evans, DDD).
2. Stub every function body with the language's idiomatic **typed hole** (`todo!()`, `unimplemented!()`, `undefined` /
   `_` in Haskell/Idris, `throw new Error("TODO: <step>")` / `never`, `raise NotImplementedError`, `panic("TODO")`) so
   the architecture is executable and checkable while implementation remains deferred.
3. Run the type checker on the type skeleton (when a local environment is available) to verify that the contracts
   themselves compose cleanly and have no circularity, variance, or ownership contradictions.

### Step 4 — Human-AI Contract Gate (review before implementation)

**Before writing any implementation bodies, strictly present the type contract to the user and wait for approval — every
time.** This checkpoint is skipped only when the user has explicitly opted out in the current conversation (for example
"just implement it" or "skip type review"). Even for small tasks, the mode is the user's decision, never the agent's.
Why: reviewing 40 lines of types and signatures catches domain misunderstandings cheaply, whereas reviewing 400 lines of
implementation built on a flawed model wastes both human attention and agent effort.

Read `references/human-ai-tydd.md` for the exact presentation format. At minimum, include:

1. **The type contract** — data definitions, state transitions, smart constructors, and public function signatures (with
   typed holes).
2. **Invariant allocation table** — which invariants are enforced at _compile time_ (type structure), at _boundary parse
   time_ (smart constructor/parser), and _deferred to runtime/tests_ (and why).
3. **Modeling trade-offs & escape hatches** — any non-obvious choice (e.g., enum vs. typestate, newtype vs. type alias,
   strictness gaps in the project's config) so the human can steer before code is written.

Wait for the user to approve or request refinements before proceeding to Step 5.

### Step 5 — Define, Refine, and Verify

Once the user approves the type contract:

1. **Define incrementally** — fill typed holes one by one, starting with boundary parsers and smart constructors, then
   pure core transformations, then thin imperative/I/O shells at the edges (Wlaschin's functional core / imperative
   shell). Re-run the type checker after each coherent slice so compiler feedback guides each step.
2. **Refine types first when reality pushes back** — if implementation reveals an unmodeled case, missing error, or
   awkward conversion, do not hack around it inside a function body. Refine the _type_ (with user confirmation if it
   alters an agreed public contract or domain rule), then let the compiler point to every downstream call site that must
   update.
3. **Verify mechanically** — run the project's actual type checker / compiler (and existing tests if present) and
   confirm zero type errors and zero unapproved escape hatches.
4. **Close the loop honestly** — summarize:
   - What the type checker now proves statically.
   - Any contract refinements made during `Define` and why.
   - Which dynamic properties, edge cases, or business rules remain outside the type system and should be verified by
     unit or property-based tests (natural handoff to testing / `test-engineer`).

## When the type checker fails: diagnose before you weaken a type

The single most common failure mode of AI-assisted TyDD is treating a type error as an obstacle to silence rather than a
design signal. The agreed type contract is a formal specification; weakening it or inserting an escape hatch solely to
reach green destroys the guarantee the human approved.

When the type checker rejects code, work through this sequence before changing any type:

1. **Read the full diagnostic first** — identify the exact expected type, inferred type, variance/nullability/ownership
   mismatch, and where the conflicting type originated.
2. **Classify the root cause** — it is almost always one of four cases:
   - _Implementation bug_ (the code violates the agreed contract) -> fix the implementation; keep the type intact.
   - _Missing boundary parse_ (raw/unverified data leaked into the core) -> parse and narrow it at the trust boundary
     instead of widening core signatures to accept raw or nullable inputs.
   - _Domain model gap_ (the type genuinely missed a real state, error, or constraint) -> treat this as a **Refine**
     event: explain the gap to the user, agree on the updated type, and let the compiler drive all affected call sites.
   - _Typed-to-untyped interop boundary_ (FFI, reflection, untyped third-party SDK, wire deserialization) -> isolate the
     conversion in a single small boundary adapter, validate the runtime shape before narrowing, and document the
     soundness invariant in a brief comment.
3. **Never take these shortcuts merely to make the checker pass**:
   - Inserting `any`, unchecked casts (`as T`, `as unknown as T`, `cast()`), non-null assertions (`!`), `@ts-ignore` /
     `@ts-expect-error`, or `# type: ignore` to silence a mismatch you have not proved safe.
   - Replacing explicit `Result`/`Option` handling with `.unwrap()`, `.expect()`, or `unsafe` in domain/library code.
   - Widening a domain type back to raw primitives (`string`, `int`, `bool`, `dict[str, Any]`, `map[string]any`) or
     adding optional/nullable fields that re-introduce illegal states.
   - Adding a catch-all wildcard (`default:`, `_ =>`) on a closed sum type purely to satisfy exhaustiveness, because
     wildcards silently swallow future variants when the domain evolves.
4. **Report every resolution explicitly** — state whether a failure was an implementation bug fixed under the contract,
   a boundary parser added, or a type refinement (and why). Never return a clean compile with silent type weakenings.

## Quick reference — pattern selector

| Problem smell                                            | TyDD pattern                               | Reference                              |
| -------------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| Swappable primitives (`userId: string, orgId: string`)   | Newtype / Branded type                     | `references/modeling-patterns.md`      |
| Repeated `if (!valid)` checks across internal functions  | Parse, don't validate + Smart constructor  | `references/modeling-patterns.md`      |
| Bag of booleans or optional fields that must co-occur    | Algebraic sum type (discriminated union)   | `references/modeling-patterns.md`      |
| Predicate returns `bool` and caller re-checks / unwraps  | Defeat boolean blindness (return evidence) | `references/modeling-patterns.md`      |
| Operations only valid in certain lifecycle stages        | Typestate / Phase-specific types           | `references/modeling-patterns.md`      |
| Function can inspect/mutate more than its role requires  | Parametricity / narrow capabilities        | `references/modeling-patterns.md`      |
| Cross-language encoding or strictness setup              | Tier 1–4 adaptation guide                  | `references/type-system-adaptation.md` |
| Structuring contract review, typed holes, legacy rollout | Human-AI protocol & strangler boundaries   | `references/human-ai-tydd.md`          |

## Reference files

Load only the reference file relevant to the current step — do not load all three upfront unless needed:

- `references/modeling-patterns.md` — Core TyDD patterns, cardinality audits, algebraic modeling, typestate, phantom
  proofs, error pipelines, and the anti-over-typing guardrail.
- `references/type-system-adaptation.md` — Idiomatic realizations and strictness baselines across language tiers (Rust,
  TypeScript, Python, Go, Java/Kotlin/Swift/C#, Haskell/OCaml/F#/Scala).
- `references/human-ai-tydd.md` — Human-AI contract review template, typed-hole decomposition, legacy strangler
  adoption, and the Types + Properties handoff to testing.
