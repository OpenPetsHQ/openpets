# packages/mcp/src/

## Responsibility

Source implementation for the OpenPets MCP stdio and shared Streamable HTTP transports, including argument parsing, lease-aware tool execution, input validation, and sanitized structured responses.

## Design/Patterns

- **Small Server Factory**: `server.ts` centralizes tool registration and MCP metadata; tool logic stays in `tools.ts`.
- **Lease-Aware Tool Context**: `index.ts` acquires/heartbeats a pet lease and `tools.ts` reuses or reacquires it before mutating pet state. HTTP requests share one default-pet lease.
- **Loopback HTTP Boundary**: `http-server.ts` creates stateless per-request Streamable HTTP transports, binds only to `127.0.0.1`, and checks a bearer token, exact Host, and same-origin/absent Origin without enabling CORS.
- **Strict Input Schemas**: Zod schemas constrain reactions and speech; `saySchema` rejects multiline/code/URL/path/secret-like content before calling the desktop client.
- **Sanitized Error Boundary**: User-facing tool errors redact IPC paths, tokens, socket names, and local filesystem details.

## Data & Control Flow

1. `index.ts` parses transport options, creates a client-backed tool context, and starts stdio by default or one shared loopback HTTP listener.
2. Stdio uses one MCP server/lease per process; HTTP mode creates a stateless MCP transport per request while reusing the process-wide default-pet lease.
3. Heartbeats keep the lease alive. Shutdown stops the HTTP listener and drains active requests before joining startup/recovery and releasing the lease, preventing pool-pet leaks.
4. `server.ts` registers `openpets_status`, `openpets_react`, and `openpets_say` against handlers in `tools.ts`.
5. Handlers validate input, wait for lease readiness, acquire/reacquire a lease if needed, call `@open-pets/client`, and return text plus structured content.

## Integration Points

- `@open-pets/client`: IPC client, reactions, leases, status, speech.
- `@modelcontextprotocol/sdk`: MCP server, stdio transport, and Streamable HTTP transport.
- `zod`: tool input schemas.
- `@open-pets/cli`: launches this package via the `openpets mcp` wrapper.

## Files

- **index.ts**: Main entry. Argument parsing, transport selection, lease acquisition, heartbeat management, signal handling, graceful shutdown.
- **server.ts**: MCP server factory (32 lines). `createOpenPetsMcpServer()` registers `openpets_status`, `openpets_react`, `openpets_say` tools with metadata.
- **tools.ts**: Tool implementations. Zod schemas, `handleStatus()`, `handleReact()`, `handleSay()`, `createToolContext()`, `createMcpStatus()`, lease reacquisition, structured content, and error sanitization.
- **args.ts**: CLI argument parsing. `parseMcpArgs()`, `validatePetId()`, `createHelpText()`.
- **http-server.ts**: Authenticated loopback Streamable HTTP server, stateless request handlers, and safe shutdown.
- **ensure-executable.ts**: Post-build chmod for Unix (9 lines).
- **check-mcp-contract.ts**: Contract validation (excluded from detailed documentation).
