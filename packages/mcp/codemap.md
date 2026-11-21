# packages/mcp/

MCP (Model Context Protocol) server for OpenPets integration.

## Responsibility

Implements stdio and Streamable HTTP MCP transports exposing OpenPets status, reactions, and short messages to AI agents.

## Design/Patterns

**MCP Server Setup** (`server.ts`):
- `McpServer` from `@modelcontextprotocol/sdk`
- Three registered tools: `openpets_status`, `openpets_react`, `openpets_say`
- Tool annotations for read-only/idempotent hints
- Instructions for AI agents (safety guidelines)

**Tool Implementations** (`tools.ts`):
- Zod schemas for input validation (`saySchema`, `reactSchema`)
- Lease-aware operations (acquires lease on startup, heartbeat every 5s, and single-flight stale-lease recovery shared with lifecycle timers)
- Throttling integration for speech/reactions
- Error sanitization (hides IPC paths, tokens, sockets, and local paths)
- Structured MCP results: tools return `structuredContent` with status, routing, lease, and operation result metadata when available.

**Lifecycle Management** (`index.ts`):
- Startup lease acquisition
- Heartbeat timer (5s interval, unref'd)
- Graceful shutdown on SIGINT/SIGTERM (stop recovery sources, join startup/recovery, release retained lease IDs once, close server)
- Stdio transport via `StdioServerTransport` remains the default and supports `--pet` targeting.
- HTTP transport creates stateless Streamable HTTP requests around one shared default-pet lease; it binds only to loopback and checks bearer auth, host, and origin.

**Argument Parsing** (`args.ts`):
- `--pet <id>` for targeted pet selection
- `--transport http --port <port>` for a shared loopback server; HTTP mode rejects `--pet` and uses the default pet.
- `--help`, `--version` flags
- Pet ID validation (regex: `^[a-z0-9][a-z0-9_-]{0,63}$`)

**Build Integration** (`ensure-executable.ts`):
- Post-build chmod 0o755 for Unix binaries

## Data & Control Flow

```
main()
    ↓
parseMcpArgs() → { petId?, transport, port, help, version }
    ↓
createToolContext() → { client, configuredPetId }
    ↓
acquireStartupLease() → lease.lease set on success
    ├─ stdio: create MCP server → connect StdioServerTransport
    └─ HTTP: start loopback listener → each authenticated request gets a stateless MCP transport
    ↓
[Heartbeat] Every 5s: client.heartbeatLease()
    ↓
[Shutdown] SIGINT/SIGTERM or stdio close → mark lease context closing → stop HTTP acceptance/drain requests → stop timers → join startup/recovery → release retained lease IDs once → close server → exit once
```

## Integration Points

**Dependencies**:
- `@open-pets/client` - IPC communication
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `zod` - Schema validation

**CLI Integration**: Spawned by `@open-pets/cli` via `runMcp()` which forwards stdio and signals. Shared HTTP mode is started once with `openpets mcp --transport http` and clients connect to the loopback endpoint with its bearer token.

**Exports**:
- Binary: `open-pets-mcp` (stdio by default; optional shared HTTP transport)
- No programmatic exports (MCP server is standalone)
- Source map: [src/codemap.md](src/codemap.md)
