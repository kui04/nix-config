# Type-Driven Development: Authoritative Principles & Language Patterns

## Table of Contents

1. [Foundational Principles](#1-foundational-principles)
2. [Structured Comment Taxonomy](#2-structured-comment-taxonomy)
3. [Language-Specific Type-Checkable Holes & Stubs](#3-language-specific-type-checkable-holes--stubs)
4. [Before & After Phase 1 Skeleton Examples](#4-before--after-phase-1-skeleton-examples)

## 1. Foundational Principles

### Types as Models Before Programs (Edwin Brady)

Originating in _Type-Driven Development with Idris_, Brady formulates programming as a conversation with the compiler
and the user:

1. **Type**: Express the domain model, state transitions, and function contracts in types first.
2. **Define**: Create the structure of the function or module using typed holes (placeholders that pass type-checking
   without full runtime logic).
3. **Refine**: Once the types and architecture are verified, iteratively replace holes with concrete implementations and
   tighten types as new requirements emerge.

### Make Illegal States Unrepresentable (Yaron Minsky & Scott Wlaschin)

Coined by Yaron Minsky (Jane Street) and expanded in Scott Wlaschin's _Domain Modeling Made Functional_, this principle
eliminates runtime defensive checks by matching the **cardinality** of your type to the cardinality of valid domain
states:

- **Anti-pattern (Boolean Flags & Loose Optionals)**:

  ```typescript
  interface Connection {
    isConnected: boolean;
    socket?: Socket; // Illegal state: isConnected = true, socket = undefined
    error?: Error; // Illegal state: isConnected = true, error = Error(...)
  }
  ```

- **Type-Driven Pattern (Sum Types / Discriminated Unions)**:
  ```typescript
  type Connection =
    | { readonly kind: "Disconnected" }
    | { readonly kind: "Connecting"; readonly startedAt: Instant }
    | { readonly kind: "Connected"; readonly socket: Socket; readonly sessionId: SessionId }
    | { readonly kind: "Failed"; readonly reason: ConnectionError; readonly retryAfter?: Duration };
  ```

### Parse, Don't Validate (Alexis King)

A validator checks a condition and returns `void` or `bool`, throwing away the proof that the check succeeded and
forcing downstream code to either trust blindly or repeat checks ("shotgun parsing"). A parser consumes unstructured
input at the system boundary and returns a **refined domain type** (or an explicit error sum type), preserving the
invariant in the type system:

- **Anti-pattern (Validation)**:

  ```rust
  fn validate_email(raw: &str) -> Result<(), EmailError> { ... }
  fn send_welcome(email: &str) { ... } // Can still be called with unvalidated &str!
  ```

- **Type-Driven Pattern (Parsing into a Smart Constructor)**:

  ```rust
  #[derive(Debug, Clone, PartialEq, Eq)]
  pub struct EmailAddress(String); // Inner field is private

  impl EmailAddress {
      pub fn parse(raw: &str) -> Result<Self, EmailParseError> {
          // TODO(domain): Trim whitespace, normalize domain case, and verify RFC 5322 format
          // TODO(edge-case): Reject empty local-part or missing '@' with specific EmailParseError variant
          todo!("Phase 1 stub")
      }

      pub fn as_str(&self) -> &str {
          // SAFETY-INVARIANT: Guaranteed valid RFC 5322 email by EmailAddress::parse
          &self.0
      }
  }

  pub fn send_welcome(email: &EmailAddress) -> Result<DeliveryReceipt, SmtpError> {
      // TODO(domain): Render welcome template and dispatch via SMTP; email is valid by construction
      todo!("Phase 1 stub")
  }
  ```

### Cardinality Alignment & Typestate (Will Crichton)

From _Type-Driven API Design in Rust_:

- **Avoid Under-Representation**: Do not return `bool` or `Option<T>` when an operation can fail for multiple distinct
  reasons; return a domain-specific error enum so callers can match exhaustively on each failure mode.
- **Encode Protocol Order via Typestate**: If an object must pass through sequential lifecycle stages (e.g.,
  `Unauthenticated -> Authenticated`, or `Draft -> Approved -> Settled`), encode the state as a distinct type or generic
  phantom type parameter (`Invoice<Draft>` vs `Invoice<Approved>`) so out-of-order method calls fail at compile time.

## 2. Structured Comment Taxonomy

During **Phase 1 (Type & Skeleton Design)**, function bodies must remain unimplemented stubs, but they must not be empty
black boxes. Annotate every stubbed function or tricky type constraint with high-signal markers so the user can review
the planned behavior before implementation begins:

- `TODO(domain): <invariant or business rule>` — Documents the core transformation, state transition, or post-condition
  the function will establish once implemented.
- `TODO(edge-case): <boundary condition>` — Highlights specific failure modes, empty inputs, concurrency races,
  idempotency rules, or overflow conditions that the implementation must handle.
- `TODO(perf): <complexity or allocation constraint>` — Notes algorithmic targets (e.g., zero-copy slicing, single-pass
  aggregation, bounded batching) when relevant.
- `FIXME(design-question): <open trade-off for user review>` — Flags an architectural ambiguity, upstream mismatch, or
  policy decision discovered while modeling types, prompting the user to confirm before Phase 2.
- `SAFETY-INVARIANT: <why this representation holds>` — Documents invariants that the type system cannot verify
  statically alone (e.g., a sorted slice or positive balance enforced by a private smart constructor).

## 3. Language-Specific Type-Checkable Holes & Stubs

Whenever possible, Phase 1 skeletons should pass the language's compiler or type-checker without implementing runtime
logic. Use the idiomatic typed hole for each ecosystem:

### Rust

Use `todo!("...")` or `unimplemented!("...")` inside function bodies. Both return the never type `!`, which coerces to
any return type and allows `cargo check` to verify all signatures, lifetimes, and trait bounds.

```rust
pub fn settle_invoice(
    invoice: Invoice<Approved>,
    gateway: &impl PaymentGateway,
) -> Result<Invoice<Settled>, SettlementError> {
    // TODO(domain): Idempotently charge invoice.total() via gateway using invoice.idempotency_key()
    // TODO(edge-case): Map gateway timeout to SettlementError::PendingReconciliation instead of failing hard
    todo!("Phase 1 stub: awaiting user sign-off on Invoice typestates")
}
```

### TypeScript

Declare exported `type`, `interface`, and `class` contracts. In stubbed functions or methods,
`throw new Error("TODO: ...")` (which has inferred return type `never`) so `tsc --noEmit` verifies return types and
parameter types without requiring fake return values.

```typescript
export type OrderId = string & { readonly __brand: unique symbol };

export type RefundPolicy =
  | { readonly kind: "FullRefund"; readonly deadline: Date }
  | { readonly kind: "PartialRefund"; readonly feeRatio: ValidRatio }
  | { readonly kind: "NonRefundable"; readonly reason: NonEmptyString };

export function evaluateRefund(order: SettledOrder, requestedAt: Date): Result<RefundQuote, RefundRejectionReason> {
  // TODO(domain): Compare requestedAt against order.policy and calculate net refundable amount
  // FIXME(design-question): Should PartialRefund feeRatio apply before or after tax deduction?
  throw new Error("TODO: Phase 1 type skeleton");
}
```

### Python (3.10+)

Use `@dataclass(frozen=True)`, `typing.Protocol`, `TypeAlias`, `NewType`, and union types (`A | B`). Use
`raise NotImplementedError("...")` in function bodies so `mypy --strict` or `pyright` validates all signatures without
requiring dummy return values.

```python
from dataclasses import dataclass
from typing import NewType, Protocol

UserId = NewType("UserId", int)
NonEmptyStr = NewType("NonEmptyStr", str)

@dataclass(frozen=True)
class VerifiedAccount:
    user_id: UserId
    email: NonEmptyStr

class NotificationSink(Protocol):
    def dispatch(self, recipient: VerifiedAccount, payload: bytes) -> None: ...

def onboard_user(raw_email: str, sink: NotificationSink) -> VerifiedAccount:
    # TODO(domain): Parse raw_email into NonEmptyStr, persist new user, and emit welcome event
    # TODO(edge-case): Raise DuplicateEmailError if normalized email already exists
    raise NotImplementedError("Phase 1 type skeleton")
```

### Go

Define domain structs, distinct value types, and small consumer-side `interface` definitions. End stubbed functions with
`panic("TODO: Phase 1 type skeleton")` so `go build` / `go vet` compiles cleanly without unused-variable or
missing-return errors.

```go
type CentAmount int64

type LedgerEntry struct {
	accountID AccountID
	delta     CentAmount // SAFETY-INVARIANT: Non-zero delta enforced by NewLedgerEntry
}

func PostTransaction(ctx context.Context, entries []LedgerEntry) (*TransactionReceipt, error) {
	// TODO(domain): Verify sum of entries delta == 0 (double-entry invariant) before committing
	// FIXME(design-question): Should an empty slice return ErrEmptyTransaction or a no-op receipt?
	panic("TODO: Phase 1 type skeleton")
}
```

### Haskell / Idris / Functional Languages

Use native typed holes (`_`, `_todo_settle`, or `undefined` in Haskell; `?hole_name` in Idris) so the compiler reports
the exact inferred type of each hole during Phase 1 verification.

## 4. Before & After Phase 1 Skeleton Examples

### Scenario: Password Reset Token Service (Rust)

#### Anti-Pattern (One-Shot Primitive-Obsessed Implementation)

An agent without TyDD immediately writes raw strings, boolean flags, and inline logic in a single turn:

```rust
// Anti-pattern: primitive obsession, illegal states representable, and premature implementation
pub struct ResetToken {
    pub token: String,
    pub user_id: String,
    pub is_used: bool,
    pub used_at: Option<u64>,     // Illegal state: is_used = false, used_at = Some(...)
    pub expires_at: u64,
}

pub fn reset_password(token: &str, new_password: &str) -> Result<bool, String> {
    if new_password.len() < 8 {
        return Err("too short".to_string());
    }
    // ... 60 lines of unreviewed database & hashing logic ...
    Ok(true)
}
```

#### TyDD Phase 1 Output (Domain Types + Semantic Skeleton + Design Brief)

An agent following TyDD models the domain invariants in types, stubs the transitions with semantic comments, and stops
for user review:

```rust
use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct UserId(uuid::Uuid);

/// A cryptographically random reset token, hashed at rest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenHash([u8; 32]);

/// A password that has passed length, entropy, and breach-list checks.
#[derive(Debug)]
pub struct ValidatedPassword(String); // SAFETY-INVARIANT: Non-empty, >= 12 chars, verified by ValidatedPassword::parse

impl ValidatedPassword {
    pub fn parse(raw: &str) -> Result<Self, PasswordPolicyError> {
        // TODO(domain): Enforce minimum 12-character length and reject known breached passwords
        // TODO(edge-case): Normalize Unicode (NFKC) before measuring character length
        todo!("Phase 1 stub")
    }
}

/// Lifecycle states of a password reset token; consumed or expired tokens cannot be reused.
#[derive(Debug, Clone)]
pub enum ResetTokenState {
    Active {
        token_hash: TokenHash,
        user_id: UserId,
        expires_at: SystemTime,
    },
    Consumed {
        token_hash: TokenHash,
        user_id: UserId,
        consumed_at: SystemTime,
    },
    Expired {
        token_hash: TokenHash,
        expired_at: SystemTime,
    },
}

/// Proof token returned only after verifying an `Active` token against the current clock.
#[derive(Debug)]
pub struct VerifiedActiveToken {
    token_hash: TokenHash,
    user_id: UserId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PasswordPolicyError {
    TooShort { min_chars: usize, actual_chars: usize },
    CompromisedPassword,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResetError {
    TokenNotFound,
    TokenAlreadyConsumed { consumed_at: SystemTime },
    TokenExpired { expired_at: SystemTime },
    StorageFailure(String),
}

pub trait TokenStore {
    fn verify_and_consume(
        &mut self,
        raw_token: &str,
        now: SystemTime,
    ) -> Result<VerifiedActiveToken, ResetError>;

    fn update_password_hash(
        &mut self,
        user_id: &UserId,
        password: &ValidatedPassword,
    ) -> Result<(), ResetError>;
}

pub fn execute_password_reset(
    store: &mut impl TokenStore,
    raw_token: &str,
    new_password: ValidatedPassword,
    now: SystemTime,
) -> Result<UserId, ResetError> {
    // TODO(domain): Atomically verify and consume raw_token via store, then update user's password hash
    // TODO(edge-case): Ensure token remains unconsumed if update_password_hash fails mid-transaction
    // FIXME(design-question): Should a successful password reset also revoke all active sessions for UserId?
    todo!("Phase 1 stub: awaiting user sign-off on ResetTokenState and session revocation policy")
}
```
