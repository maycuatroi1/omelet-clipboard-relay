# omelet-clipboard-relay

The signaling and relay server for the omelet-clipboard cluster. Per the cluster map, this service is a phone book, not a mailbox: it learns who is reachable, never what was sent. Built with Bun, Hono, and TypeScript. Postgres holds accounts and devices; a process-memory Map buffers the rare relay fallback and is deleted on ACK or a 60s TTL.
