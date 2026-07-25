<!-- Source: rust-unofficial/patterns — https://rust-unofficial.github.io/patterns/ -->

# FFI Idioms (Rust Design Patterns)

# FFI Idioms

Writing FFI code is an entire course in itself. However, there are several
idioms here that can act as pointers, and avoid traps for inexperienced users of
`unsafe` Rust.

This section contains idioms that may be useful when doing FFI.

1. [Idiomatic Errors](./errors.md) - Error handling with integer codes and
   sentinel return values (such as `NULL` pointers)

2. [Accepting Strings](./accepting-strings.md) with minimal unsafe code

3. [Passing Strings](./passing-strings.md) to FFI functions

# Error Handling in FFI

## Description

In foreign languages like C, errors are represented by return codes. However,
Rust's type system allows much more rich error information to be captured and
propagated through a full type.

This best practice shows different kinds of error codes, and how to expose them
in a usable way:

1. Flat Enums should be converted to integers and returned as codes.
2. Structured Enums should be converted to an integer code with a string error
   message for detail.
3. Custom Error Types should become "transparent", with a C representation.

## Code Example

### Flat Enums

```rust,ignore
enum DatabaseError {
    IsReadOnly = 1,    // user attempted a write operation
    IOError = 2,       // user should read the C errno() for what it was
    FileCorrupted = 3, // user should run a repair tool to recover it
}

impl From<DatabaseError> for libc::c_int {
    fn from(e: DatabaseError) -> libc::c_int {
        (e as i8).into()
    }
}
```

### Structured Enums

```rust,ignore
pub mod errors {
    enum DatabaseError {
        IsReadOnly,
        IOError(std::io::Error),
        FileCorrupted(String), // message describing the issue
    }

    impl From<DatabaseError> for libc::c_int {
        fn from(e: DatabaseError) -> libc::c_int {
            match e {
                DatabaseError::IsReadOnly => 1,
                DatabaseError::IOError(_) => 2,
                DatabaseError::FileCorrupted(_) => 3,
            }
        }
    }
}

pub mod c_api {
    use super::errors::DatabaseError;
    use core::ptr;

    #[no_mangle]
    pub extern "C" fn db_error_description(
        e: Option<ptr::NonNull<DatabaseError>>,
    ) -> Option<ptr::NonNull<libc::c_char>> {
        // SAFETY: we assume that the lifetime of `e` is greater than
        // the current stack frame.
        let error = unsafe { e?.as_ref() };

        let error_str: String = match error {
            DatabaseError::IsReadOnly => {
                format!("cannot write to read-only database")
            }
            DatabaseError::IOError(e) => {
                format!("I/O Error: {e}")
            }
            DatabaseError::FileCorrupted(s) => {
                format!("File corrupted, run repair: {}", &s)
            }
        };

        let error_bytes = error_str.as_bytes();

        let c_error = unsafe {
            // SAFETY: copying error_bytes to an allocated buffer with a '\0'
            // byte at the end.
            let buffer = ptr::NonNull::<u8>::new(libc::malloc(error_bytes.len() + 1).cast())?;

            buffer
                .as_ptr()
                .copy_from_nonoverlapping(error_bytes.as_ptr(), error_bytes.len());
            buffer.as_ptr().add(error_bytes.len()).write(0_u8);
            buffer
        };

        Some(c_error.cast())
    }
}
```

### Custom Error Types

```rust,ignore
struct ParseError {
    expected: char,
    line: u32,
    ch: u16,
}

impl ParseError {
    /* ... */
}

/* Create a second version which is exposed as a C structure */
#[repr(C)]
pub struct parse_error {
    pub expected: libc::c_char,
    pub line: u32,
    pub ch: u16,
}

impl From<ParseError> for parse_error {
    fn from(e: ParseError) -> parse_error {
        let ParseError { expected, line, ch } = e;
        parse_error { expected, line, ch }
    }
}
```

## Advantages

This ensures that the foreign language has clear access to error information
while not compromising the Rust code's API at all.

## Disadvantages

It's a lot of typing, and some types may not be able to be converted easily to
C.

# Accepting Strings

## Description

When accepting strings via FFI through pointers, there are two principles that
should be followed:

1. Keep foreign strings "borrowed", rather than copying them directly.
2. Minimize the amount of complexity and `unsafe` code involved in converting
   from a C-style string to native Rust strings.

## Motivation

The strings used in C have different behaviours to those used in Rust, namely:

- C strings are null-terminated while Rust strings store their length
- C strings can contain any arbitrary non-zero byte while Rust strings must be
  UTF-8
- C strings are accessed and manipulated using `unsafe` pointer operations while
  interactions with Rust strings go through safe methods

The Rust standard library comes with C equivalents of Rust's `String` and `&str`
called `CString` and `&CStr`, that allow us to avoid a lot of the complexity and
`unsafe` code involved in converting between C strings and Rust strings.

The `&CStr` type also allows us to work with borrowed data, meaning passing
strings between Rust and C is a zero-cost operation.

## Code Example

```rust,ignore
pub mod unsafe_module {

    // other module content

    /// Log a message at the specified level.
    ///
    /// # Safety
    ///
    /// It is the caller's guarantee to ensure `msg`:
    ///
    /// - is not a null pointer
    /// - points to valid, initialized data
    /// - points to memory ending in a null byte
    /// - won't be mutated for the duration of this function call
    #[no_mangle]
    pub unsafe extern "C" fn mylib_log(msg: *const libc::c_char, level: libc::c_int) {
        let level: crate::LogLevel = match level { /* ... */ };

        // SAFETY: The caller has already guaranteed this is okay (see the
        // `# Safety` section of the doc-comment).
        let msg_str: &str = match std::ffi::CStr::from_ptr(msg).to_str() {
            Ok(s) => s,
            Err(e) => {
                crate::log_error("FFI string conversion failed");
                return;
            }
        };

        crate::log(msg_str, level);
    }
}
```

## Advantages

The example is written to ensure that:

1. The `unsafe` block is as small as possible.
2. The pointer with an "untracked" lifetime becomes a "tracked" shared reference

Consider an alternative, where the string is actually copied:

```rust,ignore
pub mod unsafe_module {

    // other module content

    pub extern "C" fn mylib_log(msg: *const libc::c_char, level: libc::c_int) {
        // DO NOT USE THIS CODE.
        // IT IS UGLY, VERBOSE, AND CONTAINS A SUBTLE BUG.

        let level: crate::LogLevel = match level { /* ... */ };

        let msg_len = unsafe { /* SAFETY: strlen is what it is, I guess? */
            libc::strlen(msg)
        };

        let mut msg_data = Vec::with_capacity(msg_len + 1);

        let msg_cstr: std::ffi::CString = unsafe {
            // SAFETY: copying from a foreign pointer expected to live
            // for the entire stack frame into owned memory
            std::ptr::copy_nonoverlapping(msg, msg_data.as_mut(), msg_len);

            msg_data.set_len(msg_len + 1);

            std::ffi::CString::from_vec_with_nul(msg_data).unwrap()
        }

        let msg_str: String = unsafe {
            match msg_cstr.into_string() {
                Ok(s) => s,
                Err(e) => {
                    crate::log_error("FFI string conversion failed");
                    return;
                }
            }
        };

        crate::log(&msg_str, level);
    }
}
```

This code is inferior to the original in two respects:

1. There is much more `unsafe` code, and more importantly, more invariants it
   must uphold.
2. Due to the extensive arithmetic required, there is a bug in this version that
   causes Rust `undefined behaviour`.

The bug here is a simple mistake in pointer arithmetic: the string was copied,
all `msg_len` bytes of it. However, the `NUL` terminator at the end was not.

The Vector then had its size *set* to the length of the *zero padded string* --
rather than *resized* to it, which could have added a zero at the end. As a
result, the last byte in the Vector is uninitialized memory. When the `CString`
is created at the bottom of the block, its read of the Vector will cause
`undefined behaviour`!

Like many such issues, this would be difficult issue to track down. Sometimes it
would panic because the string was not `UTF-8`, sometimes it would put a weird
character at the end of the string, sometimes it would just completely crash.

## Disadvantages

None?

# Passing Strings

## Description

When passing strings to FFI functions, there are four principles that should be
followed:

1. Make the lifetime of owned strings as long as possible.
2. Minimize `unsafe` code during the conversion.
3. If the C code can modify the string data, use `Vec` instead of `CString`.
4. Unless the Foreign Function API requires it, the ownership of the string
   should not transfer to the callee.

## Motivation

Rust has built-in support for C-style strings with its `CString` and `CStr`
types. However, there are different approaches one can take with strings that
are being sent to a foreign function call from a Rust function.

The best practice is simple: use `CString` in such a way as to minimize `unsafe`
code. However, a secondary caveat is that *the object must live long enough*,
meaning the lifetime should be maximized. In addition, the documentation
explains that "round-tripping" a `CString` after modification is UB, so
additional work is necessary in that case.

## Code Example

```rust,ignore
pub mod unsafe_module {

    // other module content

    extern "C" {
        fn seterr(message: *const libc::c_char);
        fn geterr(buffer: *mut libc::c_char, size: libc::c_int) -> libc::c_int;
    }

    fn report_error_to_ffi<S: Into<String>>(err: S) -> Result<(), std::ffi::NulError> {
        let c_err = std::ffi::CString::new(err.into())?;

        unsafe {
            // SAFETY: calling an FFI whose documentation says the pointer is
            // const, so no modification should occur
            seterr(c_err.as_ptr());
        }

        Ok(())
        // The lifetime of c_err continues until here
    }

    fn get_error_from_ffi() -> Result<String, std::ffi::IntoStringError> {
        let mut buffer = vec![0u8; 1024];
        unsafe {
            // SAFETY: calling an FFI whose documentation implies
            // that the input need only live as long as the call
            let written: usize = geterr(buffer.as_mut_ptr(), 1023).into();

            buffer.truncate(written + 1);
        }

        std::ffi::CString::new(buffer).unwrap().into_string()
    }
}
```

## Advantages

The example is written in a way to ensure that:

1. The `unsafe` block is as small as possible.
2. The `CString` lives long enough.
3. Errors with typecasts are always propagated when possible.

A common mistake (so common it's in the documentation) is to not use the
variable in the first block:

```rust,ignore
pub mod unsafe_module {

    // other module content

    fn report_error<S: Into<String>>(err: S) -> Result<(), std::ffi::NulError> {
        unsafe {
            // SAFETY: whoops, this contains a dangling pointer!
            seterr(std::ffi::CString::new(err.into())?.as_ptr());
        }
        Ok(())
    }
}
```

This code will result in a dangling pointer, because the lifetime of the
`CString` is not extended by the pointer creation, unlike if a reference were
created.

Another issue frequently raised is that the initialization of a 1k vector of
zeroes is "slow". However, recent versions of Rust actually optimize that
particular macro to a call to `zmalloc`, meaning it is as fast as the operating
system's ability to return zeroed memory (which is quite fast).

## Disadvantages

None?
