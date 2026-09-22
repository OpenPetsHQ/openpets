export type LanEdge = "left" | "right" | "up" | "down";
export type LanMode = "off" | "server" | "client";

export type LanTopology = Readonly<Record<string, Readonly<Partial<Record<LanEdge, string>>>>>;

export type LanTopologyIssue = {
  readonly code: "self_reference" | "missing_reverse";
  readonly host: string;
  readonly edge: LanEdge;
  readonly neighbor: string;
};

export type LanPoint = {
  readonly x: number;
  readonly y: number;
};

export type LanClientRecord = {
  readonly host: string;
  readonly lastSeen: number;
  readonly position?: LanPoint;
  readonly petId?: string;
};

export type LanPetRecord = {
  readonly ownerHost: string;
  readonly petId: string;
  readonly currentHost: string;
  readonly position?: LanPoint;
  readonly activity?: LanPetActivity;
};

export type LanPetActivity = {
  readonly kind: "work";
  readonly sequence: number;
  readonly createdAt: number;
};

export type LanState = {
  readonly enabled: true;
  readonly currentHost: string | null;
  readonly clients: readonly LanClientRecord[];
  readonly pets?: readonly LanPetRecord[];
  readonly updatedAt: number;
};

export function normalizeLanHost(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 80) : null;
}

export function normalizeLanPoint(value: unknown): LanPoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: Math.round(x), y: Math.round(y) };
}

export function normalizeLanEdge(value: unknown): LanEdge | null {
  return value === "left" || value === "right" || value === "up" || value === "down" ? value : null;
}

export function normalizeLanPetId(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) ? value : null;
}

export function normalizeLanTopology(value: unknown): LanTopology {
  if (!value || typeof value !== "object") return {};
  const topology: Record<string, Partial<Record<LanEdge, string>>> = {};
  for (const [hostValue, neighborsValue] of Object.entries(value as Record<string, unknown>)) {
    const host = normalizeLanHost(hostValue);
    if (!host || !neighborsValue || typeof neighborsValue !== "object") continue;
    const neighbors: Partial<Record<LanEdge, string>> = {};
    for (const edge of ["left", "right", "up", "down"] as const) {
      const neighbor = normalizeLanHost((neighborsValue as Record<string, unknown>)[edge]);
      if (neighbor) neighbors[edge] = neighbor;
    }
    if (Object.keys(neighbors).length > 0) topology[host] = neighbors;
  }
  return topology;
}

const oppositeLanEdge: Record<LanEdge, LanEdge> = {
  left: "right",
  right: "left",
  up: "down",
  down: "up",
};

export function countLanTopologyLinks(topology: LanTopology): number {
  return Object.values(topology).reduce((count, neighbors) => count + Object.keys(neighbors).length, 0);
}

export function validateLanTopology(topology: LanTopology): readonly LanTopologyIssue[] {
  const issues: LanTopologyIssue[] = [];
  for (const [host, neighbors] of Object.entries(topology)) {
    for (const edge of ["left", "right", "up", "down"] as const) {
      const neighbor = neighbors[edge];
      if (!neighbor) continue;
      if (neighbor === host) {
        issues.push({ code: "self_reference", host, edge, neighbor });
        continue;
      }
      const reverseEdge = oppositeLanEdge[edge];
      if (topology[neighbor]?.[reverseEdge] !== host) {
        issues.push({ code: "missing_reverse", host, edge, neighbor });
      }
    }
  }
  return issues;
}
