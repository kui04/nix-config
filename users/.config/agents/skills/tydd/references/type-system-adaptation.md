# Cross-Language Type System Adaptation

Principles in TyDD are universal; syntax and ceilings are language-specific. Never force idioms from a Tier 1 language
onto a Tier 3 or Tier 4 language when doing so produces unreadable boilerplate. Match the host language's native
strengths and pair types with runtime guards where the static type system stops.

## Contents

1. [Capability Matrix by Language Tier](#1-capability-matrix-by-language-tier)
2. [Tier 1 — Rich ADT & Ownership / Pure FP (Rust, Haskell, OCaml, F#, Scala 3)](#2-tier-1--rich-adt--ownership--pure-fp)
3. [Tier 2 — Mainstream Static & Structural (TypeScript, Java 17+, Kotlin, Swift, C#)](#3-tier-2--mainstream-static--structural)
4. [Tier 3 — Minimal Static Systems (Go, C/C++)](#4-tier-3--minimal-static-systems)
5. [Tier 4 — Gradual / Dynamic with Static Checkers (Python, Ruby, JS)](#5-tier-4--gradual--dynamic-with-static-checkers)
6. [Escape-Hatch Audit Table](#6-escape-hatch-audit-table)

---

## 1. Capability Matrix by Language Tier

| Pattern            | Tier 1 (Rust, Haskell, OCaml, F#, Scala 3) | Tier 2 (TS, Java 17+, Kotlin, Swift, C#)                                                  | Tier 3 (Go)                                         | Tier 4 (Python mypy/pyright)                        |
| ------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| **Newtype/Brand**  | Zero-cost `struct Id(T)` / `newtype`       | TS branded intersection; Java `record`; Kotlin `value class`; Swift `struct`              | `type UserId string` (distinct nominal type)        | `typing.NewType` or `@dataclass(frozen=True)`       |
| **Sum type (ADT)** | Native `enum` / `data` / `type`            | TS discriminated union; Java `sealed interface` + `record`; Kotlin `sealed`; Swift `enum` | Interface + unexported marker method (open to nil!) | `Union[A, B]` + `Literal[...]` tag dataclasses      |
| **Exhaustiveness** | Native compiler error                      | TS `never` helper; Java/Kotlin/Swift exhaustive `switch`/`when`                           | External linter (`exhaustive` / `go-check-sumtype`) | `typing.assert_never` + `match/case` (3.10+)        |
| **Typestate**      | Native + affine move enforcement (Rust)    | Possible via distinct classes/interfaces (no linear/move guarantee)                       | Separate structs per phase (no move guarantee)      | Distinct classes/Protocols (no move guarantee)      |
| **Error sum**      | Native `Result<T, E>` / `Either`           | Explicit `Result` union or typed sealed return (follow repo idiom)                        | Explicit `(T, error)` + sentinel/typed errors       | Union return `Success \| Failure` or typed `Result` |
| **Typed hole**     | `todo!()` (Rust), `_` / `undefined` (HS)   | `throw new Error("TODO")` (`never`), `TODO()` (Kotlin), `fatalError("TODO")` (Swift)      | `panic("TODO")`                                     | `raise NotImplementedError` / `...` (`Ellipsis`)    |

---

## 2. Tier 1 — Rich ADT & Ownership / Pure FP

**Languages**: Rust, Haskell, OCaml, F#, Scala 3 (and dependently typed languages like Idris, Lean, Agda).

### Idiomatic strengths

- **Zero-cost newtypes + module privacy**: Make the inner field private so construction is forced through a smart
  constructor (`pub struct Email(String);` with `impl Email { pub fn parse(...) -> Result<Self, EmailError> }`).
  - Watch out in Rust for `#[derive(Deserialize)]` on newtypes: by default serde deserializes directly into the inner
    field, bypassing the smart constructor! Use `#[serde(try_from = "String")]` or a custom `Deserialize` impl so wire
    deserialization obeys the same invariant.
- **Native typestate (Rust)**: Use move semantics (`fn connect(self) -> Client<Connected>`) and zero-sized marker types
  (`PhantomData<State>`) so reusing a previous state is a compile error. Seal the state trait
  (`mod private { pub trait Sealed {} }`) so external callers cannot invent illegal states.
- **Exhaustive `match` without `_` wildcards**: Avoid catch-all arms on domain enums; enable
  `#[deny(unreachable_patterns)]` and avoid `#[non_exhaustive]` on internal domain enums where you want compiler-driven
  refactoring.
- **Typed holes**: Use `todo!()` in Rust (type `!`, unifies with any return type), `_hole` in Haskell
  (`-fdefer-typed-holes` or GHC hole diagnostics), `???` in Scala, `?hole` in Idris.

### Strictness checks to verify

- Rust: `cargo check --all-targets`, `cargo clippy --all-targets -- -D warnings` (check workspace `Cargo.toml` lints).
- Haskell: `-Wall -Wincomplete-patterns -Wincomplete-uni-patterns -Wpartial-fields`.
- OCaml: strict warning flags (`-w +a-4-...`, keeping partial-match warning 8 fatal).
- F#: `--warnaserror+` with incomplete pattern match warnings enabled.

---

## 3. Tier 2 — Mainstream Static & Structural

**Languages**: TypeScript, Java 17+, Kotlin, Swift, C#.

### TypeScript (structural type system)

Because TypeScript is **structural** and erased at runtime, two distinct traps matter most:

1. **Branded / opaque nominal types** prevent primitive swaps:

   ```ts
   declare const UserIdBrand: unique symbol;
   export type UserId = string & { readonly [UserIdBrand]: "UserId" };

   export function parseUserId(raw: string): Result<UserId, UserIdError> {
     const trimmed = raw.trim();
     if (!UUID_RE.test(trimmed)) return { ok: false, error: { kind: "InvalidFormat", raw } };
     return { ok: true, value: trimmed as UserId }; // single isolated cast after proof
   }
   ```

   The cast (`as UserId`) is allowed **only** inside the smart constructor right after the invariant check.

2. **Runtime boundary parsing is mandatory**: TypeScript types vanish at runtime. Never type an `HTTP`/`JSON.parse`
   response with `as MyDomainType`. Parse it at the boundary using the project's schema library (Zod, Valibot, ArkType,
   Effect Schema, io-ts) or a handwritten `unknown -> Result<Domain, ParseError>` decoder.
3. **Exhaustiveness via `never`**:
   ```ts
   function assertNever(x: never): never {
     throw new Error(`Unhandled variant: ${JSON.stringify(x)}`);
   }
   ```
   Call `assertNever(state)` in the `default:` branch of switches over discriminated unions.
4. **Strictness baseline to check in `tsconfig.json`**:
   - `"strict": true` (includes `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`)
   - `"noUncheckedIndexedAccess": true` (indexing arrays/records returns `T | undefined`, closing a major totality hole)
   - `"exactOptionalPropertyTypes": true` (distinguishes missing property from `undefined`)
   - `"noImplicitReturns": true`, `"noFallthroughCasesInSwitch": true`
   - Flag missing strict flags to the user in Step 4 if they weaken the guarantees of the new types.

### Java 17+, Kotlin, Swift, C#

- **Sum types**: Java `sealed interface` + `record` (`permits ...`) with exhaustive `switch` expressions (Java 21+);
  Kotlin `sealed interface`/`sealed class` + `when` as expression; Swift `enum` with associated values; C# records +
  discriminated hierarchy (or OneOf/analyzer-checked switches).
- **Smart constructors**: Java compact record constructors validate invariants on creation (or private constructor +
  static factory returning `Result`/sealed outcome when failure is expected rather than exceptional). Kotlin
  `value class` with private constructor + companion `parse()` factory gives zero/low-overhead newtypes.
- **Nullability**: Keep nullable types (`T?`, `Optional<T>`) out of core domain invariants; narrow once at ingress. In
  Java, respect the repo's nullness annotations (JSpecify / JetBrains / NullAway) rather than mixing styles.
- **No linear/move semantics for typestate**: In GC languages, a caller can still hold a reference to a pre-transition
  object after calling `connect()`. Make pre-transition state objects **immutable value snapshots** (so calling
  `connect()` again is either idempotent or safely rejected by runtime state check inside a single guarded handle), and
  state this limitation honestly in the invariant allocation table.

---

## 4. Tier 3 — Minimal Static Systems

**Languages**: Go (and C/C++ where applicable).

### Go idiomatic TyDD

Go intentionally omits native sum types, exhaustive type switches, and non-nullable pointers. Fighting Go with heavy
generic encodings hurts readability; instead, maximize what Go _does_ enforce and document the remaining boundary:

1. **Nominal newtypes work natively**: `type UserId string` and `type OrderId string` cannot be mixed accidentally. For
   invariant-bearing types, use an unexported inner field (`type Email struct { value string }`) with
   `ParseEmail(s string) (Email, error)` and a `String() string` accessor.
   - **Zero-value hazard in Go**: Every struct in Go has an accessible zero value (`Email{}`). Either make the zero
     value useful/safe (Go proverb), check `IsZero()` at boundaries, or return a pointer/opaque handle from a package
     that owns all transitions. Explicitly document zero-value safety in Step 4!
2. **Closed sum types via unexported marker method**:
   ```go
   type PaymentEvent interface {
       isPaymentEvent()
   }
   type PaymentAuthorized struct { AuthCode string }
   func (PaymentAuthorized) isPaymentEvent() {}
   ```
   Pair with the `go-check-sumtype` / `exhaustive` linter if configured in CI; always note that Go interfaces can still
   be `nil` at runtime, so handle `nil` at the boundary.
3. **Phase structs for workflows**: Pass `ValidatedOrder` into `PriceOrder(ValidatedOrder) (PricedOrder, error)` rather
   than mutating a single giant `Order` struct with optional pointers.
4. **Error handling**: Use Go's idiomatic `(T, error)` with typed error values (`errors.Is` / `errors.As`) instead of
   inventing a foreign `Result[T, E]` wrapper unless the repository already uses one.

---

## 5. Tier 4 — Gradual / Dynamic with Static Checkers

**Languages**: Python (`pyright` / `basedpyright` / `mypy`), Ruby (`Sorbet` / `RBS`), JavaScript (JSDoc +
`tsc --checkJs`).

### Python idiomatic TyDD

Python's type annotations are **erased at runtime** (except when inspected by libraries like Pydantic, attrs, or
beartype). Treat static checking and runtime boundary parsing as a mandatory pair:

1. **Strictness baseline**: Check `pyproject.toml`, `pyrightconfig.json`, or `mypy.ini` for
   `typeCheckingMode = "strict"` (pyright) or `strict = true` / `disallow_untyped_defs = true` /
   `warn_return_any = true` (mypy). Note missing strictness settings in Step 4.
2. **ADTs and exhaustiveness**:

   ```python
   from dataclasses import dataclass
   from typing import Literal, assert_never

   @dataclass(frozen=True, slots=True)
   class Draft:
       kind: Literal["draft"] = "draft"

   @dataclass(frozen=True, slots=True)
   class Paid:
       receipt_id: ReceiptId
       kind: Literal["paid"] = "paid"

   OrderState = Draft | Paid
   ```

   Use `match state:` with a final `case _ as unreachable: assert_never(unreachable)` (Python 3.11+
   `typing.assert_never`, or `typing_extensions.assert_never`).

3. **Newtypes and smart constructors**:
   - Use `typing.NewType("UserId", str)` for zero-overhead distinct identifiers, wrapped by a single `parse_user_id`
     factory function.
   - Use `@dataclass(frozen=True)` with validation (or a classmethod `parse()`) when multiple fields or rich invariants
     must be enforced at runtime too.
4. **Boundary parsing**: Use the project's existing boundary parser (e.g., Pydantic `TypeAdapter` / `BaseModel` with
   `ConfigDict(frozen=True, extra="forbid")`, `cattrs`, `msgspec`, or explicit parsers) at API/CLI/config ingress, then
   pass frozen domain types into the core.
5. **Typed holes**: Use `raise NotImplementedError("TODO: ...")` (which has inferred type `NoReturn` / `Never`, unifying
   cleanly with any return annotation during Step 3 skeleton checks).

---

## 6. Escape-Hatch Audit Table

During Step 5 verification, inspect your diff for every language-specific escape hatch below. Any surviving occurrence
must be at an explicit, documented interop boundary — never inside domain logic to silence a type mismatch.

| Language    | Forbidden silent escape hatches                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript  | `any`, `as T` (outside smart constructor), `as unknown as T`, `!` non-null, `@ts-ignore`, `@ts-expect-error`, `Function`, `object`      |
| Rust        | `.unwrap()`, `.expect()` (in library/domain paths), `unsafe`, `transmute`, `#[allow(...)]` hiding type/match warnings                   |
| Python      | `Any` (outside raw boundary ingress), `# type: ignore`, `cast()`, unannotated `def` params/returns, `dict[str, object]` as domain model |
| Go          | `any` / `interface{}` for domain values, unchecked type assertions `v.(T)` without `, ok`, ignoring `err` (`_`)                         |
| Java/Kotlin | Raw types (`List`), `@SuppressWarnings("unchecked")`, unchecked casts `(T) x`, Kotlin `!!` operator                                     |
| Swift       | Force unwrap `!`, force try `try!`, force cast `as!`, `Any` for domain values                                                           |
| Haskell/ML  | `unsafeCoerce`, `undefined` (left in final code), `error` on reachable input, `Obj.magic`, partial functions (`head`, `fromJust`)       |
