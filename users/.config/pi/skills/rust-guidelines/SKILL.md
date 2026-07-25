---
name: rust-guidelines
description: Idiomatic Rust playbook merging Microsoft's Pragmatic Rust Guidelines with the official Rust API Guidelines, Rust Style Guide, Rust Design Patterns, and the Rust Reference's undefined-behavior rules. Use for any Rust work — writing, reviewing, refactoring, or designing code; crate and API design; naming; error handling; unsafe and FFI; macros; async; performance; rustdoc; workspace layout — and trigger even when the user never mentions guidelines and only asks to write, fix, review, optimize, or make Rust code more idiomatic.
---

# Rust Guidelines

A consolidated rulebook for idiomatic, scalable Rust, built verbatim from five sources:

| ID prefix | Source | Content |
|-----------|--------|---------|
| `M-*` | [Pragmatic Rust Guidelines](https://microsoft.github.io/rust-guidelines) (Microsoft, v2026.6) | pragmatic design rules for libraries, apps, FFI, correctness, performance |
| `C-*` | [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/checklist.html) (rust-lang) | official library API conventions |
| — | [Rust Style Guide](https://doc.rust-lang.org/nightly/style-guide/) | formatting rules beyond what rustfmt enforces |
| — | [Rust Design Patterns](https://rust-unofficial.github.io/patterns/) | idioms, patterns, anti-patterns |
| — | [Rust Reference — Undefined Behavior](https://doc.rust-lang.org/reference/behavior-considered-undefined.html) | what is and is not UB |

The full text lives under `references/`; load only the files relevant to the task with the `read` tool.

## How to use this skill

- **Writing or designing code**: before writing a public API, crate, or module, `read` the matching files from the routing table below and design to satisfy them. Cite the rule ID (e.g. `C-GETTER`, `M-FROM-ERROR`) in comments or explanations when a non-obvious choice follows from one.
- **Reviewing code**: walk the master checklist below; for anything touched by the diff, load the corresponding reference file and check the full rules. Report violations with their ID and *why* (each guideline states its rationale in a `<why>` block or "Advantages/Disadvantages" section).
- **Golden rule**: each rule exists for a reason; the spirit counts, not the letter. Understand why a rule exists before working around it, and do not follow a rule blindly when doing so would violate its underlying motivation. Project-local config (`rustfmt.toml`, `clippy.toml`, CONTRIBUTING) outranks these books.

## Routing table — which reference file to load

**Pragmatic Rust Guidelines** (`references/pragmatic/`):

| File | Load when |
|------|-----------|
| `universal.md` | any Rust code — naming, weasel words, docs of magic values, structured logging, static verification, lint policy |
| `libs-ux.md` | designing library APIs: canonical error structs, builders, module layout, `async fn`, inherent vs trait methods |
| `libs-interop.md` | public types and trait impls: `Send`, `AsRef`, `RangeBounds`, sans-IO generics, re-exports |
| `libs-resilience.md` | testability, strong types/newtypes, avoiding statics, integration tests, mockable syscalls |
| `libs-building.md` | cargo features, `-sys` crates, out-of-the-box builds |
| `macros.md` | writing or reviewing declarative or proc macros |
| `apps.md` | binaries: anyhow-style errors, mimalloc, target-cpu |
| `ffi.md` | FFI boundary crates, DLL state, FFI naming |
| `correctness.md` | **always load when `unsafe` or panics are involved** — soundness, UB, panic policy |
| `performance.md` | hot paths, allocation reuse, hashers, capacity, async stack size, yield points |
| `project.md` | workspace layout, Cargo.toml inheritance, editions, MSRV |
| `docs.md` | writing rustdoc: first sentence, module docs, canonical sections |
| `ai.md` | AI-assisted codebases: single-item paths, LLM-consumable design, non-tautological tests |

**Rust API Guidelines** (`references/api-guidelines/`):

| File | Load when |
|------|-----------|
| `checklist.md` | full `C-*` checklist — start here for any library/API review |
| `naming.md` | naming anything: casing, `as_`/`to_`/`into_`, getters, iterators, features |
| `interoperability.md` | common traits, `From`/`AsRef`, serde, error types, `Send`/`Sync`, `Read`/`Write` |
| `predictability.md` | constructors, smart pointers, `Deref`, operator overloads, `into_inner()` |
| `flexibility.md` | generic vs dyn, borrowed arguments, minimal trait bounds, object safety |
| `type-safety.md` | newtypes, builders, validation, dropping invariants |
| `dependability.md` | argument validation, destructors that must not fail |
| `debuggability.md` | `Debug`/`Display` on public types |
| `documentation.md` | rustdoc: examples, panics/errors/safety sections, links |
| `macros.md` | macro API etiquette: evocative input, item placement, `macro_rules` hygiene |
| `future-proofing.md` | sealed traits, `non_exhaustive`, semver-proofing, prelude design |
| `necessities.md` | stability guarantees, licensing, versioning baseline |

**Rust Style Guide** (`references/style-guide/`) — only for what rustfmt does *not* already enforce:

| File | Load when |
|------|-----------|
| `general.md` | core formatting principles and general advice |
| `items.md` | laying out fn/struct/enum/impl/trait definitions, imports, attributes |
| `expressions.md` | formatting expressions, chains, control flow, matches |
| `statements.md` | `let`/`let-else`, assignments, single-line vs blocks |
| `types.md` | formatting type annotations and bounds |
| `cargo-and-editions.md` | Cargo.toml style, edition-specific idioms, nightly-only rustfmt options |

**Rust Design Patterns** (`references/patterns/`):

| File | Load when |
|------|-----------|
| `idioms.md` | everyday code: constructors, `Default`, borrowed args, `mem::take/replace`, temp mutability, on-stack dispatch |
| `idioms-ffi.md` | passing/accepting strings and errors across FFI |
| `patterns-behavioural.md` | Command, Interpreter, Newtype, RAII guards, Strategy, Visitor |
| `patterns-creational.md` | Builder, Fold |
| `patterns-structural.md` | composing structs, small crates, containing unsafety, trait-for-bounds |
| `patterns-ffi.md` | object-based FFI APIs, handle wrappers |
| `anti-patterns.md` | clone-to-satisfy-borrow-checker, `#![deny(warnings)]`, Deref polymorphism |
| `functional.md` | generics as type classes, optics/lenses, FP paradigms in Rust |
| `design-principles.md` | SOLID and general design principles mapped to Rust |

**Rust Reference** (`references/`):

| File | Load when |
|------|-----------|
| `undefined-behavior.md` | mandatory before/while writing or reviewing any `unsafe`; also lists what is *not* UB |

## Master checklist — Pragmatic Rust Guidelines

Compact version of the full checklist; details and rationale live in the `references/pragmatic/` file named in each header.

- **Universal** (`universal.md`)
  - [ ] Follow the upstream guidelines (M-UPSTREAM-GUIDELINES)
  - [ ] Use static verification — clippy, rustc lints (M-STATIC-VERIFICATION)
  - [ ] Lint overrides should use `#[expect]` (M-LINT-OVERRIDE-EXPECT)
  - [ ] Public types are Debug (M-PUBLIC-DEBUG)
  - [ ] Public types meant to be read are Display (M-PUBLIC-DISPLAY)
  - [ ] If in doubt, split the crate (M-SMALLER-CRATES)
  - [ ] Names are free of weasel words (M-WEASEL-WORDS)
  - [ ] Names of items are short (M-SHORT-NAMES)
  - [ ] Prefer regular over associated functions (M-REGULAR-FN)
  - [ ] Magic values are documented (M-DOCUMENTED-MAGIC)
  - [ ] Use structured logging with message templates (M-LOG-STRUCTURED)
- **Library / Interoperability** (`libs-interop.md`)
  - [ ] Types are Send (M-TYPES-SEND)
  - [ ] Native escape hatches (M-ESCAPE-HATCHES)
  - [ ] Don't leak external types (M-DONT-LEAK-TYPES)
  - [ ] Items come from their original crate (M-FOREIGN-REEXPORTS)
  - [ ] Accept `impl AsRef<>` where feasible (M-IMPL-ASREF)
  - [ ] Accept `impl RangeBounds<>` where feasible (M-IMPL-RANGEBOUNDS)
  - [ ] Accept `impl 'IO'` where feasible, "sans IO" (M-IMPL-IO)
- **Library / UX** (`libs-ux.md`)
  - [ ] Abstractions don't visibly nest (M-SIMPLE-ABSTRACTIONS)
  - [ ] Avoid smart pointers and wrappers in APIs (M-AVOID-WRAPPERS)
  - [ ] Prefer types over generics, generics over dyn traits (M-DI-HIERARCHY)
  - [ ] Errors are canonical structs (M-ERRORS-CANONICAL-STRUCTS)
  - [ ] Canonical error conversion uses `From`, not `map_err` (M-FROM-ERROR)
  - [ ] Complex type construction has builders (M-INIT-BUILDER)
  - [ ] Complex type initialization hierarchies are cascaded (M-INIT-CASCADED)
  - [ ] Services are Clone (M-SERVICES-CLONE)
  - [ ] Essential functionality should be inherent (M-ESSENTIAL-FN-INHERENT)
  - [ ] Modules are balanced in size and scope (M-BALANCED-MODULES)
  - [ ] Don't define preludes (M-NO-PRELUDE)
  - [ ] Parameter ordering is consistent (M-PARAMETER-CONSISTENCY)
  - [ ] Collections implement the appropriate iter traits (M-COLLECTION-TRAITS)
  - [ ] Functions are `async` over returning a Future (M-ASYNC-FN)
- **Library / Resilience** (`libs-resilience.md`)
  - [ ] I/O and system calls are mockable (M-MOCKABLE-SYSCALLS)
  - [ ] Test utilities are feature gated (M-TEST-UTIL)
  - [ ] Integration tests live under `tests/` (M-INTEGRATION-TESTS)
  - [ ] Use the proper type family (M-STRONG-TYPES)
  - [ ] Newtypes guard their invariants (M-STRONG-TYPES-GUARD)
  - [ ] Builders validate in final `.build()` (M-BUILD-RESULT)
  - [ ] Don't glob re-export items (M-NO-GLOB-REEXPORTS)
  - [ ] Avoid statics (M-AVOID-STATICS)
  - [ ] Production code uses telemetry, not println (M-LOG-NOT-PRINT)
- **Library / Building** (`libs-building.md`)
  - [ ] Libraries work out of the box (M-OOBE)
  - [ ] Native `-sys` crates compile without dependencies (M-SYS-CRATES)
  - [ ] Features are additive (M-FEATURES-ADDITIVE)
- **Macros** (`macros.md`)
  - [ ] Macros are a last resort (M-MACRO-LAST-RESORT)
  - [ ] Prefer macros-by-example over proc macros (M-EXAMPLE-OVER-PROC)
  - [ ] Macros don't lie about signatures (M-MACROS-DONT-LIE)
  - [ ] Macros assume main crate (M-MACRO-MAIN-CRATE)
  - [ ] Third party items come from hidden `_private` module (M-MACRO-HELPERS)
  - [ ] Proc macros have a separate impl crate incl. tests (M-PROC-IMPL)
  - [ ] Proc macros don't produce implied or hidden items (M-PROC-IMPLIED-ITEMS)
- **Applications** (`apps.md`)
  - [ ] Use mimalloc for apps (M-MIMALLOC-APPS)
  - [ ] Applications may use Anyhow or derivatives (M-APP-ERROR)
  - [ ] Applications target highest viable target-cpu (M-TARGET-CPU)
- **FFI** (`ffi.md`)
  - [ ] Isolate DLL state between FFI libraries (M-ISOLATE-DLL-STATE)
  - [ ] Business logic belongs in core crates, FFI only translates (M-FFI-TRANSLATES)
  - [ ] FFI crates follow established naming conventions (M-FFI-NAMING)
- **Correctness** (`correctness.md`)
  - [ ] Unsafe needs reason, should be avoided (M-UNSAFE)
  - [ ] Unsafe implies undefined behavior (M-UNSAFE-IMPLIES-UB)
  - [ ] All code must be sound (M-UNSOUND)
  - [ ] Panic means "stop the program" (M-PANIC-IS-STOP)
  - [ ] Detected programming bugs are panics, not errors (M-PANIC-ON-BUG)
  - [ ] Panic continuation is last resort (M-PANIC-CONTINUATION)
  - [ ] Custom panics have a helpful message (M-PANIC-MESSAGE)
- **Performance** (`performance.md`)
  - [ ] Optimize for throughput, avoid empty cycles (M-THROUGHPUT)
  - [ ] Identify, profile, optimize the hot path early (M-HOTPATH)
  - [ ] Long-running tasks should have yield points (M-YIELD-POINTS)
  - [ ] Reuse allocations where possible (M-MEM-REUSE)
  - [ ] Library telemetry does not tank performance (M-LOG-OVERHEAD)
  - [ ] Nested type hierarchies avoid needless indirection (M-AVOID-INDIRECTION)
  - [ ] Boxed slices and strings for immutable owned sequences (M-BOX-DST)
  - [ ] Shrink collections to fit after building (M-SHRINK-TO-FIT)
  - [ ] Use a fast hasher where possible (M-FAST-HASHER)
  - [ ] Collections are created with sufficient initial capacity (M-INITIAL-CAPACITY)
  - [ ] Hot `async` functions reduce stack size (M-ASYNC-STACK-SIZE)
- **Project** (`project.md`)
  - [ ] Common settings come from the workspace Cargo.toml (M-CARGO-WORKSPACE)
  - [ ] The workspace lists and versions all crates (M-CRATES-IN-WORKSPACE)
  - [ ] All crates are siblings in one folder (M-CRATES-FLAT-FOLDER)
  - [ ] New crates target latest edition (M-LATEST-EDITION)
  - [ ] MSRV is conservatively updated (M-MSRV)
- **Documentation** (`docs.md`)
  - [ ] First sentence is one line, approx. 15 words (M-FIRST-DOC-SENTENCE)
  - [ ] Comprehensive module documentation (M-MODULE-DOCS)
  - [ ] Documentation has canonical sections (M-CANONICAL-DOCS)
  - [ ] Mark `pub use` items with `#[doc(inline)]` (M-DOC-INLINE)
- **AI** (`ai.md`)
  - [ ] Design with AI use in mind (M-DESIGN-FOR-AI)
  - [ ] Items are only visible through one path (M-SINGLE-ITEM-PATH)
  - [ ] Avoid meta design documentation (M-NO-META-DESIGN-DOCUMENTATION)
  - [ ] Tests do not assert ground truth (M-TAUTOLOGICAL-TESTS)
  - [ ] Rust code solves Rust problems (M-RUST-SHAPED)

## Upstream highlights — frequently forgotten API rules

From M-UPSTREAM-GUIDELINES; the full `C-*` list is in `references/api-guidelines/checklist.md`:

- [ ] Ad-hoc conversions follow `as_`, `to_`, `into_` conventions (C-CONV)
- [ ] Getter names follow Rust convention — `foo()`, not `get_foo()` (C-GETTER)
- [ ] Types eagerly implement common traits (C-COMMON-TRAITS): `Copy`, `Clone`, `Eq`, `PartialEq`, `Ord`, `PartialOrd`, `Hash`, `Default`, `Debug`, plus `Display` where the type wants to be displayed
- [ ] Constructors are static, inherent methods (C-CTOR) — have `Foo::new()` even if `Foo::default()` exists
- [ ] Feature names are free of placeholder words like `use-`, `with-`, `support` (C-FEATURE)

## Gotchas

- **rustfmt first**: run rustfmt; consult `references/style-guide/` only for layout rustfmt cannot decide (e.g. chain breaking, import granularity with nightly options) — and check the project's `rustfmt.toml` before advising changes.
- **`unsafe` discipline**: every `unsafe` block needs a written safety justification (M-UNSAFE), and unsafe code that can cause UB from safe callers is unsound (M-UNSOUND). When judging whether something is UB, load `references/undefined-behavior.md` — do not guess from memory; the list is precise and includes provenance, aliasing, and invalid-value rules.
- **Deref polymorphism feels clever but is an anti-pattern** (`references/patterns/anti-patterns.md`); only smart pointers implement `Deref`/`DerefMut` (C-DEREF).
- **`#![deny(warnings)]` in library code is an anti-pattern** — it breaks downstream builds on newer compilers; gate warnings in CI instead (M-STATIC-VERIFICATION uses `#[expect]`, not blanket allows).
- **Panics are for bugs, not recoverable failures** (M-PANIC-IS-STOP, M-PANIC-ON-BUG); libraries return canonical error structs convertible with `From` (M-ERRORS-CANONICAL-STRUCTS, M-FROM-ERROR), applications may use anyhow (M-APP-ERROR).
- **Naming**: no `get_` prefixes (C-GETTER), no weasel words like `Manager`/`Util`/`Helper` (M-WEASEL-WORDS), conversions pick `as_`/`to_`/`into_` by cost and ownership (C-CONV).
- **Use pattern names in explanations** (e.g. "this is a Newtype", "use an RAII guard") so reviews stay searchable against `references/patterns/`.
- **Books evolve**: rule IDs are stable, but when a suggestion seems to conflict between sources, prefer the more specific rule and state the conflict to the user rather than silently picking one.
