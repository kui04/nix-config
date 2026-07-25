<!-- Source: rust-unofficial/patterns — https://rust-unofficial.github.io/patterns/ -->

# Behavioural Patterns (Rust Design Patterns)

# Behavioural Patterns

From [Wikipedia](https://en.wikipedia.org/wiki/Behavioral_pattern):

> Design patterns that identify common communication patterns among objects. By
> doing so, these patterns increase flexibility in carrying out communication.

# Command

## Description

The basic idea of the Command pattern is to separate out actions into its own
objects and pass them as parameters.

## Motivation

Suppose we have a sequence of actions or transactions encapsulated as objects.
We want these actions or commands to be executed or invoked in some order later
at different time. These commands may also be triggered as a result of some
event. For example, when a user pushes a button, or on arrival of a data packet.
In addition, these commands might be undoable. This may come in useful for
operations of an editor. We might want to store logs of executed commands so
that we could reapply the changes later if the system crashes.

## Example

Define two database operations `create table` and `add field`. Each of these
operations is a command which knows how to undo the command, e.g., `drop table`
and `remove field`. When a user invokes a database migration operation then each
command is executed in the defined order, and when the user invokes the rollback
operation then the whole set of commands is invoked in reverse order.

## Approach: Using trait objects

We define a common trait which encapsulates our command with two operations
`execute` and `rollback`. All command `structs` must implement this trait.

```rust
pub trait Migration {
    fn execute(&self) -> &str;
    fn rollback(&self) -> &str;
}

pub struct CreateTable;
impl Migration for CreateTable {
    fn execute(&self) -> &str {
        "create table"
    }
    fn rollback(&self) -> &str {
        "drop table"
    }
}

pub struct AddField;
impl Migration for AddField {
    fn execute(&self) -> &str {
        "add field"
    }
    fn rollback(&self) -> &str {
        "remove field"
    }
}

struct Schema {
    commands: Vec<Box<dyn Migration>>,
}

impl Schema {
    fn new() -> Self {
        Self { commands: vec![] }
    }

    fn add_migration(&mut self, cmd: Box<dyn Migration>) {
        self.commands.push(cmd);
    }

    fn execute(&self) -> Vec<&str> {
        self.commands.iter().map(|cmd| cmd.execute()).collect()
    }
    fn rollback(&self) -> Vec<&str> {
        self.commands
            .iter()
            .rev() // reverse iterator's direction
            .map(|cmd| cmd.rollback())
            .collect()
    }
}

fn main() {
    let mut schema = Schema::new();

    let cmd = Box::new(CreateTable);
    schema.add_migration(cmd);
    let cmd = Box::new(AddField);
    schema.add_migration(cmd);

    assert_eq!(vec!["create table", "add field"], schema.execute());
    assert_eq!(vec!["remove field", "drop table"], schema.rollback());
}
```

## Approach: Using function pointers

We could follow another approach by creating each individual command as a
different function and store function pointers to invoke these functions later
at a different time. Since function pointers implement all three traits `Fn`,
`FnMut`, and `FnOnce` we could as well pass and store closures instead of
function pointers.

```rust
type FnPtr = fn() -> String;
struct Command {
    execute: FnPtr,
    rollback: FnPtr,
}

struct Schema {
    commands: Vec<Command>,
}

impl Schema {
    fn new() -> Self {
        Self { commands: vec![] }
    }
    fn add_migration(&mut self, execute: FnPtr, rollback: FnPtr) {
        self.commands.push(Command { execute, rollback });
    }
    fn execute(&self) -> Vec<String> {
        self.commands.iter().map(|cmd| (cmd.execute)()).collect()
    }
    fn rollback(&self) -> Vec<String> {
        self.commands
            .iter()
            .rev()
            .map(|cmd| (cmd.rollback)())
            .collect()
    }
}

fn add_field() -> String {
    "add field".to_string()
}

fn remove_field() -> String {
    "remove field".to_string()
}

fn main() {
    let mut schema = Schema::new();
    schema.add_migration(|| "create table".to_string(), || "drop table".to_string());
    schema.add_migration(add_field, remove_field);
    assert_eq!(vec!["create table", "add field"], schema.execute());
    assert_eq!(vec!["remove field", "drop table"], schema.rollback());
}
```

## Approach: Using `Fn` trait objects

Finally, instead of defining a common command trait we could store each command
implementing the `Fn` trait separately in vectors.

```rust
type Migration<'a> = Box<dyn Fn() -> &'a str>;

struct Schema<'a> {
    executes: Vec<Migration<'a>>,
    rollbacks: Vec<Migration<'a>>,
}

impl<'a> Schema<'a> {
    fn new() -> Self {
        Self {
            executes: vec![],
            rollbacks: vec![],
        }
    }
    fn add_migration<E, R>(&mut self, execute: E, rollback: R)
    where
        E: Fn() -> &'a str + 'static,
        R: Fn() -> &'a str + 'static,
    {
        self.executes.push(Box::new(execute));
        self.rollbacks.push(Box::new(rollback));
    }
    fn execute(&self) -> Vec<&str> {
        self.executes.iter().map(|cmd| cmd()).collect()
    }
    fn rollback(&self) -> Vec<&str> {
        self.rollbacks.iter().rev().map(|cmd| cmd()).collect()
    }
}

fn add_field() -> &'static str {
    "add field"
}

fn remove_field() -> &'static str {
    "remove field"
}

fn main() {
    let mut schema = Schema::new();
    schema.add_migration(|| "create table", || "drop table");
    schema.add_migration(add_field, remove_field);
    assert_eq!(vec!["create table", "add field"], schema.execute());
    assert_eq!(vec!["remove field", "drop table"], schema.rollback());
}
```

## Discussion

If our commands are small and may be defined as functions or passed as a closure
then using function pointers might be preferable since it does not exploit
dynamic dispatch. But if our command is a whole struct with a bunch of functions
and variables defined as separated module then using trait objects would be more
suitable. A case of application can be found in [`actix`](https://actix.rs/),
which uses trait objects when it registers a handler function for routes. In
case of using `Fn` trait objects we can create and use commands in the same way
as we used in case of function pointers.

As performance, there is always a trade-off between performance and code
simplicity and organisation. Static dispatch gives faster performance, while
dynamic dispatch provides flexibility when we structure our application.

## See also

- [Command pattern](https://en.wikipedia.org/wiki/Command_pattern)

- [Another example for the `command` pattern](https://web.archive.org/web/20210223131236/https://chercher.tech/rust/command-design-pattern-rust)

# Interpreter

## Description

If a problem occurs very often and requires long and repetitive steps to solve
it, then the problem instances might be expressed in a simple language and an
interpreter object could solve it by interpreting the sentences written in this
simple language.

Basically, for any kind of problems we define:

- A
  [domain specific language](https://en.wikipedia.org/wiki/Domain-specific_language),
- A grammar for this language,
- An interpreter that solves the problem instances.

## Motivation

Our goal is to translate simple mathematical expressions into postfix
expressions (or
[Reverse Polish notation](https://en.wikipedia.org/wiki/Reverse_Polish_notation))
For simplicity, our expressions consist of ten digits `0`, ..., `9` and two
operations `+`, `-`. For example, the expression `2 + 4` is translated into
`2 4 +`.

## Context Free Grammar for our problem

Our task is translating infix expressions into postfix ones. Let's define a
context free grammar for a set of infix expressions over `0`, ..., `9`, `+`, and
`-`, where:

- Terminal symbols: `0`, `...`, `9`, `+`, `-`
- Non-terminal symbols: `exp`, `term`
- Start symbol is `exp`
- And the following are production rules

```ignore
exp -> exp + term
exp -> exp - term
exp -> term
term -> 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
```

**NOTE:** This grammar should be further transformed depending on what we are
going to do with it. For example, we might need to remove left recursion. For
more details please see
[Compilers: Principles,Techniques, and Tools](https://en.wikipedia.org/wiki/Compilers:_Principles,_Techniques,_and_Tools)
(aka Dragon Book).

## Solution

We simply implement a recursive descent parser. For simplicity's sake, the code
panics when an expression is syntactically wrong (for example `2-34` or `2+5-`
are wrong according to the grammar definition).

```rust
pub struct Interpreter<'a> {
    it: std::str::Chars<'a>,
}

impl<'a> Interpreter<'a> {
    pub fn new(infix: &'a str) -> Self {
        Self { it: infix.chars() }
    }

    fn next_char(&mut self) -> Option<char> {
        self.it.next()
    }

    pub fn interpret(&mut self, out: &mut String) {
        self.term(out);

        while let Some(op) = self.next_char() {
            if op == '+' || op == '-' {
                self.term(out);
                out.push(op);
            } else {
                panic!("Unexpected symbol '{op}'");
            }
        }
    }

    fn term(&mut self, out: &mut String) {
        match self.next_char() {
            Some(ch) if ch.is_digit(10) => out.push(ch),
            Some(ch) => panic!("Unexpected symbol '{ch}'"),
            None => panic!("Unexpected end of string"),
        }
    }
}

pub fn main() {
    let mut intr = Interpreter::new("2+3");
    let mut postfix = String::new();
    intr.interpret(&mut postfix);
    assert_eq!(postfix, "23+");

    intr = Interpreter::new("1-2+3-4");
    postfix.clear();
    intr.interpret(&mut postfix);
    assert_eq!(postfix, "12-3+4-");
}
```

## Discussion

There may be a wrong perception that the Interpreter design pattern is about
design grammars for formal languages and implementation of parsers for these
grammars. In fact, this pattern is about expressing problem instances in a more
specific way and implementing functions/classes/structs that solve these problem
instances. Rust language has `macro_rules!` that allow us to define special
syntax and rules on how to expand this syntax into source code.

In the following example we create a simple `macro_rules!` that computes
[Euclidean length](https://en.wikipedia.org/wiki/Euclidean_distance) of `n`
dimensional vectors. Writing `norm!(x,1,2)` might be easier to express and more
efficient than packing `x,1,2` into a `Vec` and calling a function computing the
length.

```rust
macro_rules! norm {
    ($($element:expr),*) => {
        {
            let mut n = 0.0;
            $(
                n += ($element as f64)*($element as f64);
            )*
            n.sqrt()
        }
    };
}

fn main() {
    let x = -3f64;
    let y = 4f64;

    assert_eq!(3f64, norm!(x));
    assert_eq!(5f64, norm!(x, y));
    assert_eq!(0f64, norm!(0, 0, 0));
    assert_eq!(1f64, norm!(0.5, -0.5, 0.5, -0.5));
}
```

## See also

- [Interpreter pattern](https://en.wikipedia.org/wiki/Interpreter_pattern)
- [Context free grammar](https://en.wikipedia.org/wiki/Context-free_grammar)
- [macro_rules!](https://doc.rust-lang.org/rust-by-example/macros.html)

# Newtype

What if in some cases we want a type to behave similar to another type or
enforce some behaviour at compile time when using only type aliases would not be
enough?

For example, if we want to create a custom `Display` implementation for `String`
due to security considerations (e.g. passwords).

For such cases we could use the `Newtype` pattern to provide **type safety** and
**encapsulation**.

## Description

Use a tuple struct with a single field to make an opaque wrapper for a type.
This creates a new type, rather than an alias to a type (`type` items).

## Example

```rust
use std::fmt::Display;

// Create Newtype Password to override the Display trait for String
struct Password(String);

impl Display for Password {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "****************")
    }
}

fn main() {
    let unsecured_password: String = "ThisIsMyPassword".to_string();
    let secured_password: Password = Password(unsecured_password.clone());
    println!("unsecured_password: {unsecured_password}");
    println!("secured_password: {secured_password}");
}
```

```shell
unsecured_password: ThisIsMyPassword
secured_password: ****************
```

## Motivation

The primary motivation for newtypes is abstraction. It allows you to share
implementation details between types while precisely controlling the interface.
By using a newtype rather than exposing the implementation type as part of an
API, it allows you to change implementation backwards compatibly.

Newtypes can be used for distinguishing units, e.g., wrapping `f64` to give
distinguishable `Miles` and `Kilometres`.

## Advantages

The wrapped and wrapper types are not type compatible (as opposed to using
`type`), so users of the newtype will never 'confuse' the wrapped and wrapper
types.

Newtypes are a zero-cost abstraction - there is no runtime overhead.

The privacy system ensures that users cannot access the wrapped type (if the
field is private, which it is by default).

## Disadvantages

The downside of newtypes (especially compared with type aliases), is that there
is no special language support. This means there can be *a lot* of boilerplate.
You need a 'pass through' method for every method you want to expose on the
wrapped type, and an impl for every trait you want to also be implemented for
the wrapper type.

## Discussion

Newtypes are very common in Rust code. Abstraction or representing units are the
most common uses, but they can be used for other reasons:

- restricting functionality (reduce the functions exposed or traits
  implemented),
- making a type with copy semantics have move semantics,
- abstraction by providing a more concrete type and thus hiding internal types,
  e.g.,

```rust,ignore
pub struct Foo(Bar<T1, T2>);
```

Here, `Bar` might be some public, generic type and `T1` and `T2` are some
internal types. Users of our module shouldn't know that we implement `Foo` by
using a `Bar`, but what we're really hiding here is the types `T1` and `T2`, and
how they are used with `Bar`.

## See also

- [Advanced Types in the book](https://doc.rust-lang.org/book/ch19-04-advanced-types.html?highlight=newtype#using-the-newtype-pattern-for-type-safety-and-abstraction)
- [Newtypes in Haskell](https://wiki.haskell.org/Newtype)
- [Type aliases](https://doc.rust-lang.org/stable/book/ch19-04-advanced-types.html#creating-type-synonyms-with-type-aliases)
- [derive_more](https://crates.io/crates/derive_more), a crate for deriving many
  builtin traits on newtypes.
- [The Newtype Pattern In Rust](https://web.archive.org/web/20230519162111/https://www.worthe-it.co.za/blog/2020-10-31-newtype-pattern-in-rust.html)

# RAII with guards

## Description

[RAII][wikipedia] stands for "Resource Acquisition is Initialisation" which is a
terrible name. The essence of the pattern is that resource initialisation is
done in the constructor of an object and finalisation in the destructor. This
pattern is extended in Rust by using a RAII object as a guard of some resource
and relying on the type system to ensure that access is always mediated by the
guard object.

## Example

Mutex guards are the classic example of this pattern from the std library (this
is a simplified version of the real implementation):

```rust,ignore
use std::ops::Deref;

struct Foo {}

struct Mutex<T> {
    // We keep a reference to our data: T here.
    //..
}

struct MutexGuard<'a, T: 'a> {
    data: &'a T,
    //..
}

// Locking the mutex is explicit.
impl<T> Mutex<T> {
    fn lock(&self) -> MutexGuard<T> {
        // Lock the underlying OS mutex.
        //..

        // MutexGuard keeps a reference to self
        MutexGuard {
            data: self,
            //..
        }
    }
}

// Destructor for unlocking the mutex.
impl<'a, T> Drop for MutexGuard<'a, T> {
    fn drop(&mut self) {
        // Unlock the underlying OS mutex.
        //..
    }
}

// Implementing Deref means we can treat MutexGuard like a pointer to T.
impl<'a, T> Deref for MutexGuard<'a, T> {
    type Target = T;

    fn deref(&self) -> &T {
        self.data
    }
}

fn baz(x: Mutex<Foo>) {
    let xx = x.lock();
    xx.foo(); // foo is a method on Foo.
              // The borrow checker ensures we can't store a reference to the underlying
              // Foo which will outlive the guard xx.

    // x is unlocked when we exit this function and xx's destructor is executed.
}
```

## Motivation

Where a resource must be finalised after use, RAII can be used to do this
finalisation. If it is an error to access that resource after finalisation, then
this pattern can be used to prevent such errors.

## Advantages

Prevents errors where a resource is not finalised and where a resource is used
after finalisation.

## Discussion

RAII is a useful pattern for ensuring resources are properly deallocated or
finalised. We can make use of the borrow checker in Rust to statically prevent
errors stemming from using resources after finalisation takes place.

The core aim of the borrow checker is to ensure that references to data do not
outlive that data. The RAII guard pattern works because the guard object
contains a reference to the underlying resource and only exposes such
references. Rust ensures that the guard cannot outlive the underlying resource
and that references to the resource mediated by the guard cannot outlive the
guard. To see how this works it is helpful to examine the signature of `deref`
without lifetime elision:

```rust,ignore
fn deref<'a>(&'a self) -> &'a T {
    //..
}
```

The returned reference to the resource has the same lifetime as `self` (`'a`).
The borrow checker therefore ensures that the lifetime of the reference to `T`
is shorter than the lifetime of `self`.

Note that implementing `Deref` is not a core part of this pattern, it only makes
using the guard object more ergonomic. Implementing a `get` method on the guard
works just as well.

## See also

[Finalisation in destructors idiom](../../idioms/dtor-finally.md)

RAII is a common pattern in C++:
[cppreference.com](http://en.cppreference.com/w/cpp/language/raii),
[wikipedia][wikipedia].

[wikipedia]: https://en.wikipedia.org/wiki/Resource_Acquisition_Is_Initialization

[Style guide entry](https://doc.rust-lang.org/1.0.0/style/ownership/raii.html)
(currently just a placeholder).

# Strategy (aka Policy)

## Description

The [Strategy design pattern](https://en.wikipedia.org/wiki/Strategy_pattern) is
a technique that enables separation of concerns. It also allows to decouple
software modules through
[Dependency Inversion](https://en.wikipedia.org/wiki/Dependency_inversion_principle).

The basic idea behind the Strategy pattern is that, given an algorithm solving a
particular problem, we define only the skeleton of the algorithm at an abstract
level, and we separate the specific algorithm’s implementation into different
parts.

In this way, a client using the algorithm may choose a specific implementation,
while the general algorithm workflow remains the same. In other words, the
abstract specification of the class does not depend on the specific
implementation of the derived class, but specific implementation must adhere to
the abstract specification. This is why we call it "Dependency Inversion".

## Motivation

Imagine we are working on a project that generates reports every month. We need
the reports to be generated in different formats (strategies), e.g., in `JSON`
or `Plain Text` formats. But things vary over time, and we don't know what kind
of requirement we may get in the future. For example, we may need to generate
our report in a completely new format, or just modify one of the existing
formats.

## Example

In this example our invariants (or abstractions) are `Formatter` and `Report`,
while `Text` and `Json` are our strategy structs. These strategies have to
implement the `Formatter` trait.

```rust
use std::collections::HashMap;

type Data = HashMap<String, u32>;

trait Formatter {
    fn format(&self, data: &Data, buf: &mut String);
}

struct Report;

impl Report {
    // Write should be used but we kept it as String to ignore error handling
    fn generate<T: Formatter>(g: T, s: &mut String) {
        // backend operations...
        let mut data = HashMap::new();
        data.insert("one".to_string(), 1);
        data.insert("two".to_string(), 2);
        // generate report
        g.format(&data, s);
    }
}

struct Text;
impl Formatter for Text {
    fn format(&self, data: &Data, buf: &mut String) {
        for (k, v) in data {
            let entry = format!("{k} {v}\n");
            buf.push_str(&entry);
        }
    }
}

struct Json;
impl Formatter for Json {
    fn format(&self, data: &Data, buf: &mut String) {
        buf.push('[');
        for (k, v) in data.into_iter() {
            let entry = format!(r#"{{"{}":"{}"}}"#, k, v);
            buf.push_str(&entry);
            buf.push(',');
        }
        if !data.is_empty() {
            buf.pop(); // remove extra , at the end
        }
        buf.push(']');
    }
}

fn main() {
    let mut s = String::from("");
    Report::generate(Text, &mut s);
    assert!(s.contains("one 1"));
    assert!(s.contains("two 2"));

    s.clear(); // reuse the same buffer
    Report::generate(Json, &mut s);
    assert!(s.contains(r#"{"one":"1"}"#));
    assert!(s.contains(r#"{"two":"2"}"#));
}
```

## Advantages

The main advantage is separation of concerns. For example, in this case `Report`
does not know anything about specific implementations of `Json` and `Text`,
whereas the output implementations does not care about how data is preprocessed,
stored, and fetched. The only thing they have to know is a specific trait to
implement and its method defining the concrete algorithm implementation
processing the result, i.e., `Formatter` and `format(...)`.

## Disadvantages

For each strategy there must be implemented at least one module, so number of
modules increases with number of strategies. If there are many strategies to
choose from then users have to know how strategies differ from one another.

## Discussion

In the previous example all strategies are implemented in a single file. Ways of
providing different strategies includes:

- All in one file (as shown in this example, similar to being separated as
  modules)
- Separated as modules, E.g. `formatter::json` module, `formatter::text` module
- Use compiler feature flags, E.g. `json` feature, `text` feature
- Separated as crates, E.g. `json` crate, `text` crate

Serde crate is a good example of the `Strategy` pattern in action. Serde allows
[full customization](https://serde.rs/custom-serialization.html) of the
serialization behavior by manually implementing `Serialize` and `Deserialize`
traits for our type. For example, we could easily swap `serde_json` with
`serde_cbor` since they expose similar methods. Having this makes the helper
crate `serde_transcode` much more useful and ergonomic.

However, we don't need to use traits in order to design this pattern in Rust.

The following toy example demonstrates the idea of the Strategy pattern using
Rust `closures`:

```rust
struct Adder;
impl Adder {
    pub fn add<F>(x: u8, y: u8, f: F) -> u8
    where
        F: Fn(u8, u8) -> u8,
    {
        f(x, y)
    }
}

fn main() {
    let arith_adder = |x, y| x + y;
    let bool_adder = |x, y| {
        if x == 1 || y == 1 {
            1
        } else {
            0
        }
    };
    let custom_adder = |x, y| 2 * x + y;

    assert_eq!(9, Adder::add(4, 5, arith_adder));
    assert_eq!(0, Adder::add(0, 0, bool_adder));
    assert_eq!(5, Adder::add(1, 3, custom_adder));
}
```

In fact, Rust already uses this idea for `Options`'s `map` method:

```rust
fn main() {
    let val = Some("Rust");

    let len_strategy = |s: &str| s.len();
    assert_eq!(4, val.map(len_strategy).unwrap());

    let first_byte_strategy = |s: &str| s.bytes().next().unwrap();
    assert_eq!(82, val.map(first_byte_strategy).unwrap());
}
```

## See also

- [Strategy Pattern](https://en.wikipedia.org/wiki/Strategy_pattern)
- [Dependency Injection](https://en.wikipedia.org/wiki/Dependency_injection)
- [Policy Based Design](https://en.wikipedia.org/wiki/Modern_C++_Design#Policy-based_design)
- [Implementing a TCP server for Space Applications in Rust using the Strategy Pattern](https://web.archive.org/web/20231003171500/https://robamu.github.io/posts/rust-strategy-pattern/)

# Visitor

## Description

A visitor encapsulates an algorithm that operates over a heterogeneous
collection of objects. It allows multiple different algorithms to be written
over the same data without having to modify the data (or their primary
behaviour).

Furthermore, the visitor pattern allows separating the traversal of a collection
of objects from the operations performed on each object.

## Example

```rust,ignore
// The data we will visit
mod ast {
    pub enum Stmt {
        Expr(Expr),
        Let(Name, Expr),
    }

    pub struct Name {
        value: String,
    }

    pub enum Expr {
        IntLit(i64),
        Add(Box<Expr>, Box<Expr>),
        Sub(Box<Expr>, Box<Expr>),
    }
}

// The abstract visitor
mod visit {
    use ast::*;

    pub trait Visitor<T> {
        fn visit_name(&mut self, n: &Name) -> T;
        fn visit_stmt(&mut self, s: &Stmt) -> T;
        fn visit_expr(&mut self, e: &Expr) -> T;
    }
}

use ast::*;
use visit::*;

// An example concrete implementation - walks the AST interpreting it as code.
struct Interpreter;
impl Visitor<i64> for Interpreter {
    fn visit_name(&mut self, n: &Name) -> i64 {
        panic!()
    }
    fn visit_stmt(&mut self, s: &Stmt) -> i64 {
        match *s {
            Stmt::Expr(ref e) => self.visit_expr(e),
            Stmt::Let(..) => unimplemented!(),
        }
    }

    fn visit_expr(&mut self, e: &Expr) -> i64 {
        match *e {
            Expr::IntLit(n) => n,
            Expr::Add(ref lhs, ref rhs) => self.visit_expr(lhs) + self.visit_expr(rhs),
            Expr::Sub(ref lhs, ref rhs) => self.visit_expr(lhs) - self.visit_expr(rhs),
        }
    }
}
```

One could implement further visitors, for example a type checker, without having
to modify the AST data.

## Motivation

The visitor pattern is useful anywhere that you want to apply an algorithm to
heterogeneous data. If data is homogeneous, you can use an iterator-like
pattern. Using a visitor object (rather than a functional approach) allows the
visitor to be stateful and thus communicate information between nodes.

## Discussion

It is common for the `visit_*` methods to return void (as opposed to in the
example). In that case it is possible to factor out the traversal code and share
it between algorithms (and also to provide noop default methods). In Rust, the
common way to do this is to provide `walk_*` functions for each datum. For
example,

```rust,ignore
pub fn walk_expr(visitor: &mut Visitor, e: &Expr) {
    match *e {
        Expr::IntLit(_) => {}
        Expr::Add(ref lhs, ref rhs) => {
            visitor.visit_expr(lhs);
            visitor.visit_expr(rhs);
        }
        Expr::Sub(ref lhs, ref rhs) => {
            visitor.visit_expr(lhs);
            visitor.visit_expr(rhs);
        }
    }
}
```

In other languages (e.g., Java) it is common for data to have an `accept` method
which performs the same duty.

## See also

The visitor pattern is a common pattern in most OO languages.

[Wikipedia article](https://en.wikipedia.org/wiki/Visitor_pattern)

The [fold](../creational/fold.md) pattern is similar to visitor but produces a
new version of the visited data structure.
