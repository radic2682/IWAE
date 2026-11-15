Local changes to tiny_http 0.12.0 (upstream: https://github.com/tiny-http/tiny-http):

1. `src/util/equal_reader.rs`: dropping a request whose body was not fully read used to allocate
   `vec![0; remaining]` with a client-chosen length (a `Content-Length` of 1 TB aborted the whole process).
   It now drains in 8 KiB chunks and gives up after 1 MiB.
2. `src/lib.rs`: every accepted socket gets a 15 second read timeout, so a client that stalls in the
   middle of headers or a body can no longer hold a thread forever (the existing 408 path handles it).
3. TLS support (ssl features) removed from `Cargo.toml`; IWAE only serves plain HTTP on 127.0.0.1.
4. `src/client.rs`: a non-ASCII header line answers 400 instead of closing the socket with no reply.
5. `Cargo.toml`: `[lints.rust]` allows `unused_imports` and `dead_code` (and `unexpected_cfgs`), so upstream code we do not edit stops warning in every build.
