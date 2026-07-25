<!-- Source: rust-lang/rust src/doc/style-guide @ da86f4d0726be475afbbffe40cb2f65741c51ad3 -->

# `Cargo.toml` conventions

## Formatting conventions

Use the same line width and indentation as Rust code.

Put a blank line between the last key-value pair in a section and the header of
the next section. Do not place a blank line between section headers and the
key-value pairs in that section, or between key-value pairs in a section.

Version-sort key names within each section, with the exception of the
`[package]` section. Put the `[package]` section at the top of the file; put
the `name` and `version` keys in that order at the top of that section,
followed by the remaining keys other than `description` in order, followed by
the `description` at the end of that section.

Don't use quotes around any standard key names; use bare keys. Only use quoted
keys for non-standard keys whose names require them, and avoid introducing such
key names when possible.  See the [TOML
specification](https://toml.io/en/v1.0.0#keys) for details.

Put a single space both before and after the `=` between a key and value. Do
not indent any key names; start all key names at the start of a line.

Use multi-line strings (rather than newline escape sequences) for any string
values that include multiple lines, such as the crate description.

For array values, such as a list of features, put the entire list on the same
line as the key, if it fits. Otherwise, use block indentation: put a newline
after the opening square bracket, indent each item by one indentation level,
put a comma after each item (including the last), and put the closing square
bracket at the start of a line by itself after the last item.

```rust
some_feature = [
    "another_feature",
    "yet_another_feature",
    "some_dependency?/some_feature",
]
```

For table values, such as a crate dependency with a path, write the entire
table using curly braces and commas on the same line as the key if it fits. If
the entire table does not fit on the same line as the key, separate it out into
a separate section with key-value pairs:

```toml
[dependencies]
crate1 = { path = "crate1", version = "1.2.3" }

[dependencies.extremely_long_crate_name_goes_here]
path = "extremely_long_path_name_goes_right_here"
version = "4.5.6"
```

## Metadata conventions

The authors list, if present, should consist of strings that each contain an
author name followed by an email address in angle brackets: `Full Name
<email@address>`. It should not contain bare email addresses, or names without
email addresses. (The authors list may also include a mailing list address
without an associated name.)

The license field must contain a valid [SPDX
expression](https://spdx.org/spdx-specification-21-web-version#h.jxpfx0ykyb60),
using valid [SPDX license names](https://spdx.org/licenses/). (As an exception,
by widespread convention, the license field may use `/` in place of ` OR `; for
example, `MIT/Apache-2.0`.)

The homepage field, if present, must consist of a single URL, including the
scheme (e.g. `https://example.org/`, not just `example.org`.)

Within the description field, wrap text at 80 columns. Don't start the
description field with the name of the crate (e.g. "cratename is a ..."); just
describe the crate itself. If providing a multi-sentence description, the first
sentence should go on a line by itself and summarize the crate, like the
subject of an email or commit message; subsequent sentences can then describe
the crate in more detail.


# Rust style editions

The default Rust style evolves over time, as Rust does. However, to avoid
breaking established code style, and CI jobs checking code style, changes to
the default Rust style only appear in *style editions*.

Code written in a given
[Rust edition](https://doc.rust-lang.org/edition-guide/)
uses the corresponding Rust style edition by default. To make it easier to
migrate code style separately from the semantic changes between Rust editions,
formatting tools such as `rustfmt` allow updating the style edition separately
from the Rust edition.

The current version of the style guide describes the latest Rust style edition.
Each distinct past style will have a corresponding archived version of the
style guide.

Note that archived versions of the style guide do not document formatting for
newer Rust constructs that did not exist at the time that version of the style
guide was archived. However, each style edition will still format all
constructs valid in that Rust edition, with the style of newer constructs
coming from the first subsequent style edition providing formatting rules for
that construct (without any of the systematic/global changes from that style
edition).

Not all Rust editions have corresponding changes to the Rust style. For
instance, Rust 2015, Rust 2018, and Rust 2021 all use the same style edition.

## Rust next style edition

- Never break within a nullary function call `func()` or a unit literal `()`.

## Rust 2024 style edition

This style guide describes the Rust 2024 style edition. The Rust 2024 style
edition is currently nightly-only and may change before the release of Rust
2024.

For a full history of changes in the Rust 2024 style edition, see the git
history of the style guide. Notable changes in the Rust 2024 style edition
include:

- Miscellaneous `rustfmt` bugfixes.
- Use version-sort (sort `x8`, `x16`, `x32`, `x64`, `x128` in that order).
- Change "ASCIIbetical" sort to Unicode-aware "non-lowercase before lowercase".

## Rust 2015/2018/2021 style edition

The archived version of the style guide at
<https://github.com/rust-lang/rust/tree/37343f4a4d4ed7ad0891cb79e8eb25acf43fb821/src/doc/style-guide/src>
describes the style edition corresponding to Rust 2015, Rust 2018, and Rust
2021.


# Nightly

This chapter documents style and formatting for nightly-only syntax. The rest of the style guide documents style for stable Rust syntax; nightly syntax only appears in this chapter. Each section here includes the name of the feature gate, so that searches (e.g. `git grep`) for a nightly feature in the Rust repository also turn up the style guide section.

Style and formatting for nightly-only syntax should be removed from this chapter and integrated into the appropriate sections of the style guide at the time of stabilization.

There is no guarantee of the stability of this chapter in contrast to the rest of the style guide. Refer to the style team policy for nightly formatting procedure regarding breaking changes to this chapter.

### Frontmatter

*Location: Placed before comments and attributes in the [root](index.html).*

*Tracking issue: [#136889](https://github.com/rust-lang/rust/issues/136889)*

*Feature gate: `frontmatter`*

There should be no blank lines between the frontmatter and either the start of the file or a shebang.
There can be zero or one line between the frontmatter and any following content.

The frontmatter fences should use the minimum number of dashes necessary for the contained content (one more than the longest series of initial dashes in the
content, with a minimum of 3 to be recognized as frontmatter delimiters).
If an infostring is present after the opening fence, there should be one space separating them.
The frontmatter fence lines should not have trailing whitespace.

```rust
#!/usr/bin/env cargo
--- cargo
[dependencies]
regex = "1"
---

fn main() {}
```
