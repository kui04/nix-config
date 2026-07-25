<!-- Source: rust-unofficial/patterns — https://rust-unofficial.github.io/patterns/ -->

# Structural Patterns (Rust Design Patterns)

# Structural Patterns

From [Wikipedia](https://en.wikipedia.org/wiki/Structural_pattern):

> Design patterns that ease the design by identifying a simple way to realize
> relationships among entities.

# Struct decomposition for independent borrowing

## Description

Sometimes a large struct will cause issues with the borrow checker - although
fields can be borrowed independently, sometimes the whole struct ends up being
used at once, preventing other uses. A solution might be to decompose the struct
into several smaller structs. Then compose these together into the original
struct. Then each struct can be borrowed separately and have more flexible
behaviour.

This will often lead to a better design in other ways: applying this design
pattern often reveals smaller units of functionality.

## Example

Here is a contrived example of where the borrow checker foils us in our plan to
use a struct:

```rust,ignore
struct Database {
    connection_string: String,
    timeout: u32,
    pool_size: u32,
}

fn print_database(database: &Database) {
    println!("Connection string: {}", database.connection_string);
    println!("Timeout: {}", database.timeout);
    println!("Pool size: {}", database.pool_size);
}

fn main() {
    let mut db = Database {
        connection_string: "initial string".to_string(),
        timeout: 30,
        pool_size: 100,
    };

    let connection_string = &mut db.connection_string;
    print_database(&db);
    *connection_string = "new string".to_string();
}
```

The compiler throws following errors:

```ignore
let connection_string = &mut db.connection_string;
                        ------------------------- mutable borrow occurs here
print_database(&db);
               ^^^ immutable borrow occurs here
*connection_string = "new string".to_string();
------------------ mutable borrow later used here
```

We can apply this design pattern and refactor `Database` into three smaller
structs, thus solving the borrow checking issue:

```rust
// Database is now composed of three structs - ConnectionString, Timeout and PoolSize.
// Let's decompose it into smaller structs
#[derive(Debug, Clone)]
struct ConnectionString(String);

#[derive(Debug, Clone, Copy)]
struct Timeout(u32);

#[derive(Debug, Clone, Copy)]
struct PoolSize(u32);

// We then compose these smaller structs back into `Database`
struct Database {
    connection_string: ConnectionString,
    timeout: Timeout,
    pool_size: PoolSize,
}

// print_database can then take ConnectionString, Timeout and Poolsize struct instead
fn print_database(connection_str: ConnectionString, timeout: Timeout, pool_size: PoolSize) {
    println!("Connection string: {connection_str:?}");
    println!("Timeout: {timeout:?}");
    println!("Pool size: {pool_size:?}");
}

fn main() {
    // Initialize the Database with the three structs
    let mut db = Database {
        connection_string: ConnectionString("localhost".to_string()),
        timeout: Timeout(30),
        pool_size: PoolSize(100),
    };

    let connection_string = &mut db.connection_string;
    print_database(connection_string.clone(), db.timeout, db.pool_size);
    *connection_string = ConnectionString("new string".to_string());
}
```

## Motivation

This pattern is most useful, when you have a struct that ended up with a lot of
fields that you want to borrow independently. Thus having a more flexible
behaviour in the end.

## Advantages

Decomposition of structs lets you work around limitations in the borrow checker.
And it often produces a better design.

## Disadvantages

It can lead to more verbose code. And sometimes, the smaller structs are not
good abstractions, and so we end up with a worse design. That is probably a
'code smell', indicating that the program should be refactored in some way.

## Discussion

This pattern is not required in languages that don't have a borrow checker, so
in that sense is unique to Rust. However, making smaller units of functionality
often leads to cleaner code: a widely acknowledged principle of software
engineering, independent of the language.

This pattern relies on Rust's borrow checker to be able to borrow fields
independently of each other. In the example, the borrow checker knows that `a.b`
and `a.c` are distinct and can be borrowed independently, it does not try to
borrow all of `a`, which would make this pattern useless.

# Prefer small crates

## Description

Prefer small crates that do one thing well.

Cargo and crates.io make it easy to add third-party libraries, much more so than
in say C or C++. Moreover, since packages on crates.io cannot be edited or
removed after publication, any build that works now should continue to work in
the future. We should take advantage of this tooling, and use smaller, more
fine-grained dependencies.

## Advantages

- Small crates are easier to understand, and encourage more modular code.
- Crates allow for re-using code between projects. For example, the `url` crate
  was developed as part of the Servo browser engine, but has since found wide
  use outside the project.
- Since the compilation unit of Rust is the crate, splitting a project into
  multiple crates can allow more of the code to be built in parallel.

## Disadvantages

- This can lead to "dependency hell", when a project depends on multiple
  conflicting versions of a crate at the same time. For example, the `url` crate
  has both versions 1.0 and 0.5. Since the `Url` from `url:1.0` and the `Url`
  from `url:0.5` are different types, an HTTP client that uses `url:0.5` would
  not accept `Url` values from a web scraper that uses `url:1.0`.
- Packages on crates.io are not curated. A crate may be poorly written, have
  unhelpful documentation, or be outright malicious.
- Two small crates may be less optimized than one large one, since the compiler
  does not perform link-time optimization (LTO) by default.

## Examples

The [`url`](https://crates.io/crates/url) crate provides tools for working with
URLs.

The [`num_cpus`](https://crates.io/crates/num_cpus) crate provides a function to
query the number of CPUs on a machine.

The [`ref_slice`](https://crates.io/crates/ref_slice) crate provides functions
for converting `&T` to `&[T]`. (Historical example)

## See also

- [crates.io: The Rust community crate host](https://crates.io/)

# Contain unsafety in small modules

## Description

If you have `unsafe` code, create the smallest possible module that can uphold
the needed invariants to build a minimal safe interface upon the unsafety. Embed
this into a larger module that contains only safe code and presents an ergonomic
interface. Note that the outer module can contain unsafe functions and methods
that call directly into the unsafe code. Users may use this to gain speed
benefits.

## Advantages

- This restricts the unsafe code that must be audited
- Writing the outer module is much easier, since you can count on the guarantees
  of the inner module

## Disadvantages

- Sometimes, it may be hard to find a suitable interface.
- The abstraction may introduce inefficiencies.

## Examples

- The [`toolshed`](https://docs.rs/toolshed) crate contains its unsafe
  operations in submodules, presenting a safe interface to users.
- `std`'s `String` class is a wrapper over `Vec<u8>` with the added invariant
  that the contents must be valid UTF-8. The operations on `String` ensure this
  behavior. However, users have the option of using an `unsafe` method to create
  a `String`, in which case the onus is on them to guarantee the validity of the
  contents.

## See also

- [Ralf Jung's Blog about invariants in unsafe code](https://www.ralfj.de/blog/2018/08/22/two-kinds-of-invariants.html)

# Use custom traits to avoid complex type bounds

## Description

Trait bounds can become somewhat unwieldy, especially if one of the `Fn` traits[^fn-traits]
is involved and there are specific requirements on the output type. In such
cases the introduction of a new trait may help reduce verbosity, eliminate some
type parameters and thus increase expressiveness. Such a trait can be
accompanied with a generic `impl` for all types satisfying the original bound.

## Example

Let's imagine some sort of monitoring or information gathering system. The
system retrieves values of various types from diverse sources. It may derive
from them some sort of status indicating issues. For example, the total amount
of free memory should be above a certain theshold, and the user with the id `0`
should always be named "root".

For management reasons, we probably want type erasure on the top level. However,
we also need to provide specific (user configurable) assesments for specific
types of data sources (e.g. thresholds and ranges for numerical types). And
since sources for these values are diverse, we may choose to supply data sources
as closures that return a value when called. Because we are probably getting
those values from the operating system, we are likely confronted with operations
that may fail.

We thus may have settled on the following types and traits for handling specific
values:

```rust
use std::fmt::Display;

struct Value<G: FnMut() -> Result<T, Error>, S: Fn(&T) -> Status, T: Display> {
    value: Option<T>,
    getter: G,
    status: S,
}

impl<G: FnMut() -> Result<T, Error>, S: Fn(&T) -> Status, T: Display> Value<G, S, T> {
    pub fn update(&mut self) -> Result<(), Error> {
        (self.getter)().map(|v| self.value = Some(v))
    }

    pub fn value(&self) -> Option<&T> {
        self.value.as_ref()
    }

    pub fn status(&self) -> Option<Status> {
        self.value().map(&self.status)
    }
}

// ...

enum Status {
    // ...
}

struct Error {
    // ...
}
```

With these types, we will need to repeat the trait bounds for `G` in at least a
few places. Readability suffers, partially due the the fact that the getter
returns a `Result`. Introducing a bound for "getters" allows a more expressive
bound and eliminate one of the type parameters:

```rust
# use std::fmt::Display;
trait Getter {
    type Output: Display;

    fn get_value(&mut self) -> Result<Self::Output, Error>;
}

impl<F: FnMut() -> Result<T, Error>, T: Display> Getter for F {
    type Output = T;

    fn get_value(&mut self) -> Result<Self::Output, Error> {
        self()
    }
}

struct Value<G: Getter, S: Fn(&G::Output) -> Status> {
    value: Option<G::Output>,
    getter: G,
    status: S,
}

// ...
# enum Status {}
# struct Error;
```

## Advantages

Introducing a new trait can help simplify type bounds, particularly via the
elimination of type parameters. A good name for the new trait will also make the
bound more expressive. The new trait, an abstraction, also offers opportunities
in itself, including:

- additional, specialized types implementing the new trait (e.g. representing an
  idendity of some sort) as well as other useful traits such as `Default` and
- additional methods, as long as they can be implemented for all relevant types.

## Disadvantages

Introducing new items such as the trait means we need to find an appropriate
name and place for it. It also means one more item users of the original
functionality need to investigate[^read-docs]. Depending on presentation, it may
not be obvious right away that a simple closure may be used as a `Getter` in the
example above.

[^fn-traits]: i.e. `Fn`, `FnOnce` and `FnMut`

[^read-docs]: meaning they may need to read more documentation
