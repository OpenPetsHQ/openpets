export interface McpCliOptions {
  readonly petId?: string;
  readonly transport: "stdio" | "http";
  readonly port: number;
  readonly help: boolean;
  readonly version: boolean;
}

/** Explicit `builtin` bypasses pool routing and always selects the desktop default pet. */
export function getMcpLeaseRequestedPetId(options: Pick<McpCliOptions, "petId" | "transport">): string | undefined {
  return options.transport === "http" ? "builtin" : options.petId;
}

export function parseMcpArgs(argv: readonly string[]): McpCliOptions {
  let petId: string | undefined;
  let transport: "stdio" | "http" = "stdio";
  let port = 7901;
  let portProvided = false;
  let help = false;
  let version = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      version = true;
      continue;
    }
    if (arg === "--transport") {
      const next = argv[index + 1];
      if (next !== "stdio" && next !== "http") throw new Error("--transport must be stdio or http.");
      transport = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--transport=")) {
      const next = arg.slice("--transport=".length);
      if (next !== "stdio" && next !== "http") throw new Error("--transport must be stdio or http.");
      transport = next;
      continue;
    }
    if (arg === "--port") {
      port = parsePort(argv[index + 1]);
      portProvided = true;
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      port = parsePort(arg.slice("--port=".length));
      portProvided = true;
      continue;
    }
    if (arg === "--pet") {
      const next = argv[index + 1];
      if (!next) throw new Error("--pet requires a pet id.");
      petId = validateRawPetArg(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--pet=")) {
      petId = validateRawPetArg(arg.slice("--pet=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (transport === "http" && petId !== undefined) {
    throw new Error("--pet is available with stdio transport only; HTTP transport shares the default pet.");
  }
  if (transport !== "http" && portProvided) {
    throw new Error("--port requires --transport http.");
  }

  return { petId, transport, port, help, version };
}

function parsePort(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) throw new Error("--port requires a number between 1 and 65535.");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port requires a number between 1 and 65535.");
  }
  return port;
}

export function validatePetId(value: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) || value === "builtin") {
    throw new Error(`Invalid pet id: ${value}`);
  }
  return value;
}

export function validateRawPetArg(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 1) throw new Error("--pet requires a non-empty pet id.");
  if (Buffer.byteLength(trimmed, "utf8") > 128 || /[\x00-\x1F\x7F/\\]/.test(trimmed)) {
    throw new Error("--pet value is outside OpenPets CLI bounds.");
  }
  return trimmed;
}

export function createHelpText(): string {
  return `OpenPets MCP server\n\nUsage:\n  open-pets-mcp [--pet <petId>]\n  open-pets-mcp --transport http [--port <port>]\n\nOptions:\n  --pet <petId>       Request an installed OpenPets pet for local stdio IPC; remote mode rejects --pet.\n  --transport <mode>  Use stdio (default) or a shared loopback Streamable HTTP server.\n  --port <port>       HTTP port (default: 7901). HTTP binds only to 127.0.0.1.\n  --help              Show this help.\n  --version           Show package version.\n\nHTTP mode shares the desktop default-pet lease. OPENPETS_MCP_HTTP_TOKEN can set a persistent bearer token; otherwise a random token is printed to stderr.\n`;
}
