<!-- Source: rust-unofficial/patterns — https://rust-unofficial.github.io/patterns/ -->

# FFI Patterns (Rust Design Patterns)

# FFI Patterns

Writing FFI code is an entire course in itself. However, there are several
idioms here that can act as pointers, and avoid traps for inexperienced users of
unsafe Rust.

This section contains design patterns that may be useful when doing FFI.

1. [Object-Based API](./export.md) design that has good memory safety
   characteristics, and a clean boundary of what is safe and what is unsafe

2. [Type Consolidation into Wrappers](./wrappers.md) - group multiple Rust types
   together into an opaque "object"

# Object-Based APIs

## Description

When designing APIs in Rust which are exposed to other languages, there are some
important design principles which are contrary to normal Rust API design:

1. All Encapsulated types should be *owned* by Rust, *managed* by the user, and
   *opaque*.
2. All Transactional data types should be *owned* by the user, and
   *transparent*.
3. All library behavior should be functions acting upon Encapsulated types.
4. All library behavior should be encapsulated into types not based on
   structure, but *provenance/lifetime*.

## Motivation

Rust has built-in FFI support to other languages. It does this by providing a
way for crate authors to provide C-compatible APIs through different ABIs
(though that is unimportant to this practice).

Well-designed Rust FFI follows C API design principles, while compromising the
design in Rust as little as possible. There are three goals with any foreign
API:

1. Make it easy to use in the target language.
2. Avoid the API dictating internal unsafety on the Rust side as much as
   possible.
3. Keep the potential for memory unsafety and Rust `undefined behaviour` as
   small as possible.

Rust code must trust the memory safety of the foreign language beyond a certain
point. However, every bit of `unsafe` code on the Rust side is an opportunity
for bugs, or to exacerbate `undefined behaviour`.

For example, if a pointer provenance is wrong, that may be a segfault due to
invalid memory access. But if it is manipulated by unsafe code, it could become
full-blown heap corruption.

The Object-Based API design allows for writing shims that have good memory
safety characteristics, and a clean boundary of what is safe and what is
`unsafe`.

## Code Example

The POSIX standard defines the API to access an on-file database, known as
[DBM](https://web.archive.org/web/20210105035602/https://www.mankier.com/0p/ndbm.h).
It is an excellent example of an "object-based" API.

Here is the definition in C, which hopefully should be easy to read for those
involved in FFI. The commentary below should help explain it for those who miss
the subtleties.

```C
struct DBM;
typedef struct { void *dptr, size_t dsize } datum;

int     dbm_clearerr(DBM *);
void    dbm_close(DBM *);
int     dbm_delete(DBM *, datum);
int     dbm_error(DBM *);
datum   dbm_fetch(DBM *, datum);
datum   dbm_firstkey(DBM *);
datum   dbm_nextkey(DBM *);
DBM    *dbm_open(const char *, int, mode_t);
int     dbm_store(DBM *, datum, datum, int);
```

This API defines two types: `DBM` and `datum`.

The `DBM` type was called an "encapsulated" type above. It is designed to
contain internal state, and acts as an entry point for the library's behavior.

It is completely opaque to the user, who cannot create a `DBM` themselves since
they don't know its size or layout. Instead, they must call `dbm_open`, and that
only gives them *a pointer to one*.

This means all `DBM`s are "owned" by the library in a Rust sense. The internal
state of unknown size is kept in memory controlled by the library, not the user.
The user can only manage its life cycle with `open` and `close`, and perform
operations on it with the other functions.

The `datum` type was called a "transactional" type above. It is designed to
facilitate the exchange of information between the library and its user.

The database is designed to store "unstructured data", with no pre-defined
length or meaning. As a result, the `datum` is the C equivalent of a Rust slice:
a bunch of bytes, and a count of how many there are. The main difference is that
there is no type information, which is what `void` indicates.

Keep in mind that this header is written from the library's point of view. The
user likely has some type they are using, which has a known size. But the
library does not care, and by the rules of C casting, any type behind a pointer
can be cast to `void`.

As noted earlier, this type is *transparent* to the user. But also, this type is
*owned* by the user. This has subtle ramifications, due to that pointer inside
it. The question is, who owns the memory that pointer points to?

The answer for best memory safety is, "the user". But in cases such as
retrieving a value, the user does not know how to allocate it correctly (since
they don't know how long the value is). In this case, the library code is
expected to use the heap that the user has access to -- such as the C library
`malloc` and `free` -- and then *transfer ownership* in the Rust sense.

This may all seem speculative, but this is what a pointer means in C. It means
the same thing as Rust: "user defined lifetime." The user of the library needs
to read the documentation in order to use it correctly. That said, there are
some decisions that have fewer or greater consequences if users do it wrong.
Minimizing those are what this best practice is about, and the key is to
*transfer ownership of everything that is transparent*.

## Advantages

This minimizes the number of memory safety guarantees the user must uphold to a
relatively small number:

1. Do not call any function with a pointer not returned by `dbm_open` (invalid
   access or corruption).
2. Do not call any function on a pointer after close (use after free).
3. The `dptr` on any `datum` must be `NULL`, or point to a valid slice of memory
   at the advertised length.

In addition, it avoids a lot of pointer provenance issues. To understand why,
let us consider an alternative in some depth: key iteration.

Rust is well known for its iterators. When implementing one, the programmer
makes a separate type with a bounded lifetime to its owner, and implements the
`Iterator` trait.

Here is how iteration would be done in Rust for `DBM`:

```rust,ignore
struct Dbm { ... }

impl Dbm {
    /* ... */
    pub fn keys<'it>(&'it self) -> DbmKeysIter<'it> { ... }
    /* ... */
}

struct DbmKeysIter<'it> {
    owner: &'it Dbm,
}

impl<'it> Iterator for DbmKeysIter<'it> { ... }
```

This is clean, idiomatic, and safe. thanks to Rust's guarantees. However,
consider what a straightforward API translation would look like:

```rust,ignore
#[no_mangle]
pub extern "C" fn dbm_iter_new(owner: *const Dbm) -> *mut DbmKeysIter {
    // THIS API IS A BAD IDEA! For real applications, use object-based design instead.
}
#[no_mangle]
pub extern "C" fn dbm_iter_next(
    iter: *mut DbmKeysIter,
    key_out: *const datum
) -> libc::c_int {
    // THIS API IS A BAD IDEA! For real applications, use object-based design instead.
}
#[no_mangle]
pub extern "C" fn dbm_iter_del(*mut DbmKeysIter) {
    // THIS API IS A BAD IDEA! For real applications, use object-based design instead.
}
```

This API loses a key piece of information: the lifetime of the iterator must not
exceed the lifetime of the `Dbm` object that owns it. A user of the library
could use it in a way which causes the iterator to outlive the data it is
iterating on, resulting in reading uninitialized memory.

This example written in C contains a bug that will be explained afterwards:

```C
int count_key_sizes(DBM *db) {
    // DO NOT USE THIS FUNCTION. IT HAS A SUBTLE BUT SERIOUS BUG!
    datum key;
    int len = 0;

    if (!dbm_iter_new(db)) {
        dbm_close(db);
        return -1;
    }

    int l;
    while ((l = dbm_iter_next(owner, &key)) >= 0) { // an error is indicated by -1
        free(key.dptr);
        len += key.dsize;
        if (l == 0) { // end of the iterator
            dbm_close(owner);
        }
    }
    if l >= 0 {
        return -1;
    } else {
        return len;
    }
}
```

This bug is a classic. Here's what happens when the iterator returns the
end-of-iteration marker:

1. The loop condition sets `l` to zero, and enters the loop because `0 >= 0`.
2. The length is incremented, in this case by zero.
3. The if statement is true, so the database is closed. There should be a break
   statement here.
4. The loop condition executes again, causing a `next` call on the closed
   object.

The worst part about this bug? If the Rust implementation was careful, this code
will work most of the time! If the memory for the `Dbm` object is not
immediately reused, an internal check will almost certainly fail, resulting in
the iterator returning a `-1` indicating an error. But occasionally, it will
cause a segmentation fault, or even worse, nonsensical memory corruption!

None of this can be avoided by Rust. From its perspective, it put those objects
on its heap, returned pointers to them, and gave up control of their lifetimes.
The C code simply must "play nice".

The programmer must read and understand the API documentation. While some
consider that par for the course in C, a good API design can mitigate this risk.
The POSIX API for `DBM` did this by *consolidating the ownership* of the
iterator with its parent:

```C
datum   dbm_firstkey(DBM *);
datum   dbm_nextkey(DBM *);
```

Thus, all the lifetimes were bound together, and such unsafety was prevented.

## Disadvantages

However, this design choice also has a number of drawbacks, which should be
considered as well.

First, the API itself becomes less expressive. With POSIX DBM, there is only one
iterator per object, and every call changes its state. This is much more
restrictive than iterators in almost any language, even though it is safe.
Perhaps with other related objects, whose lifetimes are less hierarchical, this
limitation is more of a cost than the safety.

Second, depending on the relationships of the API's parts, significant design
effort may be involved. Many of the easier design points have other patterns
associated with them:

- [Wrapper Type Consolidation](./wrappers.md) groups multiple Rust types
  together into an opaque "object"

- [FFI Error Passing](../../idioms/ffi/errors.md) explains error handling with
  integer codes and sentinel return values (such as `NULL` pointers)

- [Accepting Foreign Strings](../../idioms/ffi/accepting-strings.md) allows
  accepting strings with minimal unsafe code, and is easier to get right than
  [Passing Strings to FFI](../../idioms/ffi/passing-strings.md)

However, not every API can be done this way. It is up to the best judgement of
the programmer as to who their audience is.

# Type Consolidation into Wrappers

## Description

This pattern is designed to allow gracefully handling multiple related types,
while minimizing the surface area for memory unsafety.

One of the cornerstones of Rust's aliasing rules is lifetimes. This ensures that
many patterns of access between types can be memory safe, data race safety
included.

However, when Rust types are exported to other languages, they are usually
transformed into pointers. In Rust, a pointer means "the user manages the
lifetime of the pointee." It is their responsibility to avoid memory unsafety.

Some level of trust in the user code is thus required, notably around
use-after-free which Rust can do nothing about. However, some API designs place
higher burdens than others on the code written in the other language.

The lowest risk API is the "consolidated wrapper", where all possible
interactions with an object are folded into a "wrapper type", while keeping the
Rust API clean.

## Code Example

To understand this, let us look at a classic example of an API to export:
iteration through a collection.

That API looks like this:

1. The iterator is initialized with `first_key`.
2. Each call to `next_key` will advance the iterator.
3. Calls to `next_key` if the iterator is at the end will do nothing.
4. As noted above, the iterator is "wrapped into" the collection (unlike the
   native Rust API).

If the iterator implements `nth()` efficiently, then it is possible to make it
ephemeral to each function call:

```rust,ignore
struct MySetWrapper {
    myset: MySet,
    iter_next: usize,
}

impl MySetWrapper {
    pub fn first_key(&mut self) -> Option<&Key> {
        self.iter_next = 0;
        self.next_key()
    }
    pub fn next_key(&mut self) -> Option<&Key> {
        if let Some(next) = self.myset.keys().nth(self.iter_next) {
            self.iter_next += 1;
            Some(next)
        } else {
            None
        }
    }
}
```

As a result, the wrapper is simple and contains no `unsafe` code.

## Advantages

This makes APIs safer to use, avoiding issues with lifetimes between types. See
[Object-Based APIs](./export.md) for more on the advantages and pitfalls this
avoids.

## Disadvantages

Often, wrapping types is quite difficult, and sometimes a Rust API compromise
would make things easier.

As an example, consider an iterator which does not efficiently implement
`nth()`. It would definitely be worth putting in special logic to make the
object handle iteration internally, or to support a different access pattern
efficiently that only the Foreign Function API will use.

### Trying to Wrap Iterators (and Failing)

To wrap any type of iterator into the API correctly, the wrapper would need to
do what a C version of the code would do: erase the lifetime of the iterator,
and manage it manually.

Suffice it to say, this is *incredibly* difficult.

Here is an illustration of just *one* pitfall.

A first version of `MySetWrapper` would look like this:

```rust,ignore
struct MySetWrapper {
    myset: MySet,
    iter_next: usize,
    // created from a transmuted Box<KeysIter + 'self>
    iterator: Option<NonNull<KeysIter<'static>>>,
}
```

With `transmute` being used to extend a lifetime, and a pointer to hide it, it's
ugly already. But it gets even worse: *any other operation can cause Rust
`undefined behaviour`*.

Consider that the `MySet` in the wrapper could be manipulated by other functions
during iteration, such as storing a new value to the key it was iterating over.
The API doesn't discourage this, and in fact some similar C libraries expect it.

A simple implementation of `myset_store` would be:

```rust,ignore
pub mod unsafe_module {

    // other module content

    pub fn myset_store(myset: *mut MySetWrapper, key: datum, value: datum) -> libc::c_int {
        // DO NOT USE THIS CODE. IT IS UNSAFE TO DEMONSTRATE A PROBLEM.

        let myset: &mut MySet = unsafe {
            // SAFETY: whoops, UB occurs in here!
            &mut (*myset).myset
        };

        /* ...check and cast key and value data... */

        match myset.store(casted_key, casted_value) {
            Ok(_) => 0,
            Err(e) => e.into(),
        }
    }
}
```

If the iterator exists when this function is called, we have violated one of
Rust's aliasing rules. According to Rust, the mutable reference in this block
must have *exclusive* access to the object. If the iterator simply exists, it's
not exclusive, so we have `undefined behaviour`! [^1]

To avoid this, we must have a way of ensuring that mutable reference really is
exclusive. That basically means clearing out the iterator's shared reference
while it exists, and then reconstructing it. In most cases, that will still be
less efficient than the C version.

Some may ask: how can C do this more efficiently? The answer is, it cheats.
Rust's aliasing rules are the problem, and C simply ignores them for its
pointers. In exchange, it is common to see code that is declared in the manual
as "not thread safe" under some or all circumstances. In fact, the
[GNU C library](https://manpages.debian.org/buster/manpages/attributes.7.en.html)
has an entire lexicon dedicated to concurrent behavior!

Rust would rather make everything memory safe all the time, for both safety and
optimizations that C code cannot attain. Being denied access to certain
shortcuts is the price Rust programmers need to pay.

[^1]: For the C programmers out there scratching their heads, the iterator need
    not be read *during* this code to cause the UB. The exclusivity rule also
    enables compiler optimizations which may cause inconsistent observations by
    the iterator's shared reference (e.g. stack spills or reordering
    instructions for efficiency). These observations may happen *any time after*
    the mutable reference is created.
