# TyDD Modeling Patterns & Guardrails

## Contents

1. [Parse, Don't Validate](#1-parse-dont-validate)
2. [Make Illegal States Unrepresentable & Cardinality Audits](#2-make-illegal-states-unrepresentable--cardinality-audits)
3. [Newtypes, Brands, and Smart Constructors](#3-newtypes-brands-and-smart-constructors)
4. [Defeating Boolean Blindness](#4-defeating-boolean-blindness)
5. [Typestate and Protocol-Safe Lifecycles](#5-typestate-and-protocol-safe-lifecycles)
6. [Phantom Types and Proof Tokens](#6-phantom-types-and-proof-tokens)
7. [Parametricity, Totality, and Exhaustiveness](#7-parametricity-totality-and-exhaustiveness)
8. [Workflow Pipelines and Explicit Error Sums](#8-workflow-pipelines-and-explicit-error-sums)
9. [Strangler Type Boundaries for Legacy Codebases](#9-strangler-type-boundaries-for-legacy-codebases)
10. [Anti-Patterns and the Over-Typing Guardrail](#10-anti-patterns-and-the-over-typing-guardrail)

---

## 1. Parse, Don't Validate

Avoid **shotgun parsing** — mixing input validation and business processing throughout a codebase:

- **Validation** checks a value and returns `void` or `bool`, leaving the input's type unchanged. Every downstream
  caller must either re-check the invariant or rely on comments and convention.
- **Parsing** consumes a less-structured type (such as `string`, `unknown`, `[]byte`, or a raw DTO) and produces either
  a failure or a **more-structured domain type** whose existence is static proof that the invariant holds.

### Rule of thumb

Strengthen the input type of internal functions rather than returning `Option`/`Result` from deep inside business logic
for preconditions that belong at the boundary.

```text
Shotgun validation (avoid):
  rawEmail: string  -->  validateEmail(rawEmail): void  -->  sendWelcome(rawEmail: string)
                                                             (must re-check or pray)

Boundary parsing (prefer):
  rawEmail: string  -->  parseEmail(rawEmail): Result<EmailAddress, EmailError>
                                                             -->  sendWelcome(email: EmailAddress)
                                                             (cannot be called with unparsed input)
```

### Practical checklist

- Place parsers at every **trust boundary**: HTTP/gRPC handlers, CLI arg parsing, config/env loaders, file/DB readers,
  and untyped third-party SDK responses.
- Keep raw wire DTOs separate from domain types; convert DTO -> Domain at ingress and Domain -> DTO at egress
  (**Anti-Corruption Layer**).
- Prefer returning `NonEmptyList<T>` over validating `list.length > 0` before calling `first(list)`.

---

## 2. Make Illegal States Unrepresentable & Cardinality Audits

Every type defines a finite (or countable) set of representable values — its **cardinality** `|T|`. Algebraic data types
follow elementary arithmetic:

- **Unit** (`()` / `void` / empty marker): `|Unit| = 1`
- **Never / Bottom** (`never` / `!` / `Void`): `|Never| = 0`
- **Boolean**: `|Bool| = 2`
- **Product type** (struct / record / tuple `A × B`): `|A × B| = |A| × |B|`
- **Sum type** (enum / tagged union `A + B`): `|A + B| = |A| + |B|`
- **Optional** (`Option<A>` = `A + 1`): `|Option<A>| = |A| + 1`

### How to run a Cardinality Audit

When designing a record or state object, compute how many combinations the type permits versus how many the domain
actually allows. Large gaps between representable states and legal states are where runtime bugs hide.

**Before (product of flags and optionals):**

```text
OrderStatusRecord:
  isDraft: bool        (2)
  isPaid: bool         (2)
  isShipped: bool      (2)
  paidAt: Option<Time> (T + 1)
  trackingNo: Option<TrackingId> (K + 1)
```

Even ignoring `Time` and `TrackingId`, the 3 booleans allow `2 × 2 × 2 = 8` combinations (such as
`isDraft=true, isShipped=true`), and `isPaid=true` with `paidAt=None` is also representable.

**After (sum of products):**

```text
OrderState =
  | Draft
  | Paid { paidAt: Time, receiptId: ReceiptId }
  | Shipped { paidAt: Time, receiptId: ReceiptId, trackingNo: TrackingId }
  | Cancelled { cancelledAt: Time, reason: CancelReason }
```

Now `4` mutually exclusive states exist; every state carries exactly the fields valid in that state. No null checks or
cross-field assertions are needed inside downstream handlers.

### Common structural smells to collapse

| Smell                                                   | Algebraic fix                                             |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `data?: T; error?: E; loading: boolean` (remote fetch)  | Sum type: `Idle \| Loading \| Succeeded<T> \| Failed<E>`  |
| Mutually exclusive optional IDs (`userId?`, `guestId?`) | Sum type: `Authenticated(UserId) \| Guest(GuestToken)`    |
| Two parallel arrays that must stay the same length      | Single array of paired records `Array<{ key, value }>`    |
| `startDate` and `endDate` checked everywhere            | Smart-constructed `DateRange` guaranteeing `start <= end` |
| `amount: number` + `currency: string` added blindly     | `Money` value object with checked same-currency ops       |

---

## 3. Newtypes, Brands, and Smart Constructors

Using raw `string`/`int`/`float` for distinct domain concepts is **Primitive Obsession**. Passing `(orgId, userId)` in
the wrong order compiles silently when both are `string` or `u64`.

### When to create a Newtype / Brand

Wrap a primitive whenever:

1. **Confusion is costly**: distinct IDs (`UserId`, `TenantId`, `OrderId`), units (`Milliseconds`, `Seconds`, `Bytes`,
   `Cents`, `BasisPoints`), or encodings (`PlainText`, `HtmlEscaped`, `SqlIdentifier`, `Sha256Hex`).
2. **An invariant restricts the domain**: `NonEmptyString`, `EmailAddress`, `PortNumber` (`1..=65535`), `Percentage`
   (`0..=100`), `PositiveDecimal`.

Do **not** wrap primitives that have no distinct semantics or confusion risk (e.g., an internal loop counter or a local
temporary label).

### Smart Constructor pattern

To prevent callers from forging an invalid value object, combine **encapsulation** with a **fallible constructor**:

1. Hide the raw representation (private field, unexported constructor, or module-private brand symbol).
2. Expose a single parsing constructor (e.g., `EmailAddress.parse(raw)` -> `Result<EmailAddress, EmailError>`) that
   normalizes and checks the invariant once.
3. Expose read-only accessors (`asStr()`, `.value`) so callers can inspect or serialize without mutating the inner value
   into an illegal state.
4. Keep deserializers (`serde`, Pydantic, Zod, Jackson) routed through the smart constructor so JSON/DB deserialization
   cannot bypass invariants.

---

## 4. Defeating Boolean Blindness

A `bool` has only two inhabitants and carries **zero provenance** about _why_ it is true or false. Checking
`if (user.isAdmin())` or `if (!items.isEmpty())` forces the caller to track the proof mentally while the type checker
forgets it on the next line.

### Replace bare booleans in three places

1. **Predicate-then-unwrap pairs** -> return an option/sum carrying the evidence:
   - Avoid: `if (cache.has(k)) { use(cache.get(k)!); }`
   - Prefer: `match cache.get(k) { Some(v) => use(v), None => ... }`
   - Avoid: `if (canApprove(user, doc)) { approve(doc); }`
   - Prefer: `match authorizeApproval(user, doc) { Ok(approvalToken) => approve(approvalToken), Err(reason) => ... }`
2. **Boolean function parameters** (mystery flags at call sites like `export(data, true, false)`):
   - Replace with a two-variant domain enum (`Compression::Gzip | Compression::None`,
     `Overwrite::Replace | Overwrite::FailIfExists`). Self-documenting at every call site and impossible to transpose.
3. **Correlated boolean fields** on structs/classes:
   - Replace with a discriminated sum type (see Section 2).

---

## 5. Typestate and Protocol-Safe Lifecycles

Use typestate when an object obeys a **strict temporal protocol** where calling operations out of order is a bug (for
example: network handshake `Disconnected -> Connecting -> Authenticated -> Closed`; multi-step builder with required
fields; database transaction `Active -> Committed | RolledBack`; file handle `Open -> Closed`).

### Two levels of state encoding

1. **State-per-type / Generic typestate (compile-time protocol)**:
   - Each state is a distinct type (or type parameter `Session<Disconnected>`, `Session<Authenticated>`).
   - Transition functions consume the old state (in affine/linear languages like Rust, by move `self`) and return the
     new state.
   - Operations only exist on states where they are legal (`send()` exists only on `Session<Authenticated>`).
   - Best when: the state transitions are known statically at compile time in the caller's control flow (builders,
     pipelines, handshakes, middleware setup).
2. **Runtime tagged state machine (sum type enum)**:
   - One enum `Connection = Disconnected(...) | Authenticated(...) | Closed`, transitioned via `match (state, event)`.
   - Best when: states are driven by external/runtime events (network packets, UI events, persisted DB rows, collections
     of heterogeneous entities in different states).

**Critical trade-off**: Do not force compile-time generic typestate onto a runtime-event-driven state machine (such as
storing heterogeneous orders in one `Vec`). Doing so forces dynamic wrappers anyway; use a tagged sum type for
runtime-driven machines and typestate for statically sequenced protocols.

---

## 6. Phantom Types and Proof Tokens

A **phantom type** is a type parameter that appears on the left side of a type definition (e.g., `Html<Sanitized>` vs.
`Html<Raw>`, `Amount<Usd>` vs. `Amount<Eur>`, `Document<Verified>`) without occupying runtime memory.

- **Use phantom types when** the runtime representation is identical across variants, but mixing them is a serious bug
  (sanitized vs. raw strings, currency units, validated vs. unvalidated IDs, read-only vs. read-write handles).
- **Keep phantom markers sealed / unforgeable** outside the trusted boundary module so callers cannot arbitrarily cast
  `Raw` to `Sanitized`.
- **Stop early** if you need value-dependent proofs (e.g., proving `i < n` across arbitrary runtime arithmetic in a
  language without dependent types) — use a bounds-checked API or runtime check at the boundary instead.

---

## 7. Parametricity, Totality, and Exhaustiveness

### Parametricity

By **parametricity**, the more **polymorphic** (abstract) a function's type signature is, the fewer implementations can
satisfy it — yielding behavioral guarantees directly from the signature:

- A function `dedup<T: Eq>(items: List<T>) -> List<T>` cannot invent fake elements, mutate domain fields, or hardcode
  special cases for `"admin"` because it knows nothing about `T` except equality.
- **Design rule**: Give every function the _narrowest capability_ it needs (principle of least privilege in types). Pass
  `EmailAddress` rather than `User` if only the email is needed; pass a read-only slice/interface rather than a mutable
  repository if the function only reads.

### Totality and Exhaustiveness

A **total function** produces a valid output (including an explicit `Option`/`Result` failure) for _every_ inhabitant of
its input type — no unhandled branches, no unexpected `null` dereference, no silent `undefined`, no unchecked panic on
reachable input.

Two ways to make a partial function total:

1. **Strengthen the input type** (prefer when caller should know the invariant): `head(NonEmptyList<T>) -> T`.
2. **Weaken the output type** (prefer when absence is genuinely expected): `first(List<T>) -> Option<T>`.

Enforce **exhaustiveness checking** on every sum type switch/match. Never add a default/wildcard fallback (`default:`,
`_ =>`) on a closed domain enum just to appease the compiler — explicit cases guarantee that adding a new domain variant
produces a compile error at every site that must decide how to handle it.

---

## 8. Workflow Pipelines and Explicit Error Sums

1. **Model each business workflow as a typed pipeline** where each step's output type is the next step's input type:
   ```text
   UnvalidatedOrder
     --[validate]--> Result<ValidatedOrder, ValidationError>
     --[price]-----> Result<PricedOrder, PricingError>
     --[ack]-------> Result<AcknowledgedOrder, AckError>
   ```
   Every intermediate step becomes self-documenting, testable in isolation, and impossible to run out of order.
2. **Separate domain errors from infrastructure failures and bugs**:
   - _Domain errors_ (insufficient funds, expired coupon, duplicate order) -> explicit sum type in the return value
     (`Result<T, DomainError>`). Callers must handle them.
   - _Infrastructure errors_ (timeout, DB unreachable) -> explicitly typed at the I/O boundary (or propagated via the
     project's standard error mechanism, never swallowed).
   - _Programming bugs_ (broken internal invariant) -> fail fast (panic/assertion); do not disguise bugs as recoverable
     user errors unless the boundary specifically requires isolation.
3. **Functional Core, Imperative Shell**: Keep decision logic in pure functions over rich domain types; push I/O (DB
   reads, HTTP calls, clocks, randomness) to thin outer adapters. Inject impure dependencies as narrow
   function/interface parameters at the shell so the core stays deterministic and easy to type-check and test.

---

## 9. Strangler Type Boundaries for Legacy Codebases

Real codebases rarely start clean. Never attempt to rewrite an entire legacy codebase into strict types for a localized
task. Instead, build a **Strangler Type Boundary** around the slice you are touching:

1. **Draw a clean seam** at the entry point of the module or feature being changed.
2. **Parse inward at the seam**: Convert legacy loosely typed inputs (`dict`, `any`, nullable God-objects, raw strings)
   into tight domain types right at the module boundary via a small dedicated adapter function.
3. **Keep the interior pure and tight**: Write all new or refactored logic inside the seam using strong TyDD types with
   zero escape hatches.
4. **Serialize outward at the exit seam**: Convert back to the legacy shape only at the boundary required by existing
   callers, isolating the compatibility glue in one obvious place.
5. **Expand incrementally**: Leave unrelated legacy modules untouched; report out-of-scope type debt noticed along the
   way rather than silently refactoring outside the task.

---

## 10. Anti-Patterns and the Over-Typing Guardrail

Bad TyDD is just as harmful as weak typing. Reject these anti-patterns during Steps 2–4:

| Anti-pattern                          | Symptom                                                                 | Correction                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Type gymnastics**                   | Recursive conditional types, HKT hacks, 10-line compiler error novels   | Keep types readable by a teammate in 10 seconds; move complex rules to runtime parsers + tests |
| **Wrapper explosion**                 | Single-use newtypes for every field (`FirstName`, `MiddleName`, `Note`) | Wrap only where confusion is risky or an invariant exists                                      |
| **Leaky wire coupling**               | Domain types directly tied to JSON/ORM/DB annotations everywhere        | Separate boundary DTOs from core domain types                                                  |
| **Stringly-typed enums**              | `status: string` with magic constants `"PENDING"`, `"PAID"`             | Closed union / enum parsed once at boundary                                                    |
| **Boolean & null soup**               | Struct with 4 booleans and 5 optional fields                            | Discriminated union per valid state                                                            |
| **Shotgun parsing**                   | Same validation repeated in controller, service, and repository         | Parse once at trust boundary into a proof-carrying type                                        |
| **Silent escape hatches**             | `as any`, `unwrap()`, `# type: ignore`, `default: return null`          | Fix root cause, parse at boundary, or isolate one audited adapter                              |
| **Typestate for runtime collections** | Fighting generics to hold heterogeneous states in one list              | Use a runtime tagged sum type (enum) instead                                                   |

### The Over-Typing Test

Before adding a complex type construct (deep generics, phantom proofs, conditional types, typestate), check:

1. _What concrete bug class does this make impossible at compile time?_
2. _Will a teammate understand the compiler error when they violate it?_
3. _Does the language support this idiom natively, or does it fight the compiler?_

If (1) is vague or (2)/(3) is "no", downgrade to a simpler type (smart constructor + runtime check + property test).
