---
name: rust-guidelines
description: >-
  Write, review, refactor, and design Rust code. Applies Microsoft's Pragmatic Rust Guidelines as a pick-what-fits
  checklist with on-demand rule references. Use whenever the work touches Rust: writing or reviewing code, refactoring,
  API and error design, debugging panics or unsafe code, performance tuning, async, macros, FFI, rustdoc, Cargo
  workspaces - even when the user never mentions guidelines, review, or style. Also when the user asks to "make this
  idiomatic", "review my PR", or "is this safe". Not for non-Rust code.
---

# Rust Guidelines

Agent version of Microsoft's Pragmatic Rust Guidelines. Built from `src/guidelines/` of
https://github.com/microsoft/rust-guidelines (commit `19723b3`, retrieved 2026-10-06). To see upstream changes since,
diff `src/guidelines/` in that repo against a newer commit.

The full text (90 guidelines) is split by topic into `references/`. This file is the router and the master checklist:
work through the checklist on every Rust task, then load only the reference files the task needs. Do not read all
references at once.

## Usage

1. Classify the task: write code, review code, API design, refactor, docs, performance, FFI, macros.
2. Work through the checklist below. Pick the groups that match the task; Universal applies to almost every change.
3. For each relevant item, judge the code against its one-line title. Read the full guideline only when the title is not
   enough to act on: open the group's reference file and search for the `M-ID`.
4. In output, cite the `M-ID` of each guideline you applied or found violated, so the user can look it up.

Guideline sections in reference files start with `## Title (M-ID) { #M-ID }`, so an `M-ID` search lands on the exact
section.

## Checklist

Verbatim from the upstream checklist. Pick the groups that match the task; Universal applies to almost every change. For
the full rule, rationale, and examples, open the group reference file and search for the `M-ID`.

### Universal (`references/universal.md`)

Baseline for almost every change: naming, lint hygiene, logging, public trait impls, static verification.

- [ ] Follow the upstream guidelines ([M-UPSTREAM-GUIDELINES])
- [ ] Use static verification ([M-STATIC-VERIFICATION])
- [ ] Lint overrides should use `#[expect]` ([M-LINT-OVERRIDE-EXPECT])
- [ ] Public types are Debug ([M-PUBLIC-DEBUG])
- [ ] Public types meant to be read are Display ([M-PUBLIC-DISPLAY])
- [ ] If in doubt, split the crate ([M-SMALLER-CRATES])
- [ ] Names are free of weasel words ([M-WEASEL-WORDS])
- [ ] Names of items are short ([M-SHORT-NAMES])
- [ ] Prefer regular over associated functions ([M-REGULAR-FN])
- [ ] Magic values are documented ([M-DOCUMENTED-MAGIC])
- [ ] Use structured logging with message templates ([M-LOG-STRUCTURED])

### Library / Interoperability (`references/lib-interop.md`)

API boundaries: parameter shapes, re-exports, `Send`, external types.

- [ ] Types are Send ([M-TYPES-SEND])
- [ ] Native escape hatches ([M-ESCAPE-HATCHES])
- [ ] Don't leak external types ([M-DONT-LEAK-TYPES])
- [ ] Items come from their original crate ([M-FOREIGN-REEXPORTS])
- [ ] Accept `impl AsRef<>` where feasible ([M-IMPL-ASREF])
- [ ] Accept `impl RangeBounds<>` where feasible ([M-IMPL-RANGEBOUNDS])
- [ ] Accept `impl 'IO'` where feasible ('sans IO') ([M-IMPL-IO])

### Library / UX (`references/lib-ux.md`)

API ergonomics: errors, builders, modules, services, generics.

- [ ] Abstractions don't visibly nest ([M-SIMPLE-ABSTRACTIONS])
- [ ] Avoid smart pointers and wrappers in APIs ([M-AVOID-WRAPPERS])
- [ ] Prefer types over generics, generics over dyn traits ([M-DI-HIERARCHY])
- [ ] Errors are canonical structs ([M-ERRORS-CANONICAL-STRUCTS])
- [ ] Canonical error conversion uses `From`, not `map_err` ([M-FROM-ERROR])
- [ ] Complex type construction has builders ([M-INIT-BUILDER])
- [ ] Complex type initialization hierarchies are cascaded ([M-INIT-CASCADED])
- [ ] Services are Clone ([M-SERVICES-CLONE])
- [ ] Essential functionality should be inherent ([M-ESSENTIAL-FN-INHERENT])
- [ ] Modules are balanced in size and scope ([M-BALANCED-MODULES])
- [ ] Don't define preludes ([M-NO-PRELUDE])
- [ ] Parameter ordering is consistent ([M-PARAMETER-CONSISTENCY])
- [ ] Collections implement the appropriate iter traits ([M-COLLECTION-TRAITS])
- [ ] Functions are `async` over returning a Future ([M-ASYNC-FN])

### Library / Resilience (`references/lib-resilience.md`)

Testability, statics, strong types, telemetry.

- [ ] I/O and system calls are mockable ([M-MOCKABLE-SYSCALLS])
- [ ] Test utilities are feature gated ([M-TEST-UTIL])
- [ ] Integration tests live under `tests/` ([M-INTEGRATION-TESTS])
- [ ] Use the proper type family ([M-STRONG-TYPES])
- [ ] Newtypes guard their invariants ([M-STRONG-TYPES-GUARD])
- [ ] Builders validate in final `.build()` ([M-BUILD-RESULT])
- [ ] Don't glob re-export items ([M-NO-GLOB-REEXPORTS])
- [ ] Avoid statics ([M-AVOID-STATICS])
- [ ] Production code uses telemetry, not println ([M-LOG-NOT-PRINT])

### Library / Building (`references/lib-building.md`)

Features, out-of-the-box experience, native `-sys` crates.

- [ ] Libraries work out of the box ([M-OOBE])
- [ ] Native `-sys` crates compile without dependencies ([M-SYS-CRATES])
- [ ] Features are additive ([M-FEATURES-ADDITIVE])

### Macros (`references/macros.md`)

Macro design and proc-macro crate layout.

- [ ] Macros are a last resort ([M-MACRO-LAST-RESORT])
- [ ] Prefer 'macros by example' over proc macros ([M-EXAMPLE-OVER-PROC])
- [ ] Macros don't lie about signatures ([M-MACROS-DONT-LIE])
- [ ] Macros assume main crate ([M-MACRO-MAIN-CRATE])
- [ ] Pin supporting proc macro crates ([M-MACRO-VERSION-PIN])
- [ ] Third party items come from hidden `_private` module ([M-MACRO-HELPERS])
- [ ] Proc macros should have separate impl crate incl. tests ([M-PROC-IMPL])
- [ ] Proc macros don't produce implied or hidden items ([M-PROC-IMPLIED-ITEMS])

### Applications (`references/apps.md`)

Binary and application crates: error handling, allocator, target CPU.

- [ ] Use mimalloc for apps ([M-MIMALLOC-APPS])
- [ ] Applications may use Anyhow or derivatives ([M-APP-ERROR])
- [ ] Applications target highest viable target-cpu ([M-TARGET-CPU])

### FFI (`references/ffi.md`)

FFI crate naming, the translation layer, DLL state.

- [ ] Isolate DLL state between FFI libraries ([M-ISOLATE-DLL-STATE])
- [ ] Business logic belongs in core crates, FFI only translates ([M-FFI-TRANSLATES])
- [ ] FFI crates follow established naming conventions ([M-FFI-NAMING])

### Correctness (`references/correctness.md`)

Panics, unsafe code, soundness.

- [ ] Unsafe needs reason, should be avoided ([M-UNSAFE])
- [ ] Unsafe implies undefined behavior ([M-UNSAFE-IMPLIES-UB])
- [ ] All code must be sound ([M-UNSOUND])
- [ ] Panic means 'stop the program' ([M-PANIC-IS-STOP])
- [ ] Detected programming bugs are panics, not errors ([M-PANIC-ON-BUG])
- [ ] Panic continuation is last resort ([M-PANIC-CONTINUATION])
- [ ] Custom panics have a helpful message ([M-PANIC-MESSAGE])

### Performance (`references/performance.md`)

Throughput, allocations, async overhead, hot paths.

- [ ] Optimize for throughput, avoid empty cycles ([M-THROUGHPUT])
- [ ] Identify, profile, optimize the hot path early ([M-HOTPATH])
- [ ] Long-running tasks should have yield points ([M-YIELD-POINTS])
- [ ] Reuse allocations where possible ([M-MEM-REUSE])
- [ ] Library telemetry does not tank performance ([M-LOG-OVERHEAD])
- [ ] Nested type hierarchies should avoid needless indirection ([M-AVOID-INDIRECTION])
- [ ] Use boxed slices and strings for immutable owned sequences ([M-BOX-DST])
- [ ] Shrink collections to fit after building ([M-SHRINK-TO-FIT])
- [ ] Use a fast hasher where possible ([M-FAST-HASHER])
- [ ] Collections are created with sufficient initial capacity ([M-INITIAL-CAPACITY])
- [ ] Hot `async` functions reduce stack size ([M-ASYNC-STACK-SIZE])

### Project (`references/project.md`)

Workspace layout, crate folder layout, editions, MSRV.

- [ ] Common settings come from the workspace Cargo.toml ([M-CARGO-WORKSPACE])
- [ ] The workspace lists and versions all crates ([M-CRATES-IN-WORKSPACE])
- [ ] All crates are siblings in one folder ([M-CRATES-FLAT-FOLDER])
- [ ] New crates target latest edition ([M-LATEST-EDITION])
- [ ] MSRV is conservatively updated ([M-MSRV])

### Documentation (`references/docs.md`)

Rustdoc structure and style.

- [ ] First sentence is one line; approx. 15 words ([M-FIRST-DOC-SENTENCE])
- [ ] Has comprehensive module documentation ([M-MODULE-DOCS])
- [ ] Documentation has canonical sections ([M-CANONICAL-DOCS])
- [ ] Mark `pub use` items with `#[doc(inline)]` ([M-DOC-INLINE])

### AI (`references/ai.md`)

API and documentation shape that makes AI assistance on the code base effective.

- [ ] Design with AI use in mind ([M-DESIGN-FOR-AI])
- [ ] Items are only visible through one path ([M-SINGLE-ITEM-PATH])
- [ ] Avoid meta design documentation ([M-NO-META-DESIGN-DOCUMENTATION])
- [ ] Tests do not assert ground truth ([M-TAUTOLOGICAL-TESTS])
- [ ] Rust code solves Rust problems ([M-RUST-SHAPED])

## Files

| File                           | Load when                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `references/universal.md`      | Almost always. Naming, lint hygiene, logging, `Debug`/`Display`, static verification, crate size. |
| `references/correctness.md`    | Panics, `unsafe`, soundness, error vs panic decisions.                                            |
| `references/docs.md`           | Writing or fixing rustdoc.                                                                        |
| `references/project.md`        | Workspace layout, crate folders, editions, MSRV.                                                  |
| `references/apps.md`           | Binary or application crates.                                                                     |
| `references/ai.md`             | Making a code base work well for AI agents; meta documentation; test tautologies.                 |
| `references/ffi.md`            | FFI crates, C interfaces, DLL state.                                                              |
| `references/macros.md`         | Writing macros or proc macros.                                                                    |
| `references/performance.md`    | Hot paths, allocations, async overhead, hashing, logging cost.                                    |
| `references/lib-building.md`   | Library features, out-of-the-box behavior, `-sys` crates.                                         |
| `references/lib-interop.md`    | Public API boundaries: parameter shapes, re-exports, `Send`, foreign types.                       |
| `references/lib-resilience.md` | Testability, mocking, statics, newtypes, telemetry.                                               |
| `references/lib-ux.md`         | API ergonomics: errors, builders, modules, services, generics vs types.                           |

## Gotchas

- This skill deploys to a read-only location. Never modify its files; report needed fixes to the user.
- Reference code blocks are marked `rust,ignore`. They are illustrative and often do not compile (bodies written as
  `...`, imports omitted). Copy the shape, not the text.
- `M-*` IDs are stable keys. To find a rule fast, grep `references/` for the ID instead of browsing.
- `<why>` tags in reference files are the guideline's rationale, not HTML to render. Read them before relaxing a rule;
  they show what trade-off the rule buys.
- Where the user's own conventions conflict with a guideline, the user's conventions win. Say which `M-ID` you skipped
  and why.
- The upstream book has more chapters (FAQ, changelog, safety). This skill covers the guideline corpus only.
