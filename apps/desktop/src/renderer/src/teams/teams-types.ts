export type TeamPetEntry = {
  readonly id: string;
  readonly displayName: string;
  readonly source: "team";
};

export type TeamPluginEntry = {
  readonly id: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly policy: "required" | "optional";
  readonly source: "team";
};

export type TeamsSnapshot = {
  readonly enrolled: boolean;
  readonly organizationId: string | null;
  readonly organizationName: string | null;
  readonly pendingEnrollment: boolean;
  readonly installationId: string | null;
  readonly pendingRevision: number;
  readonly appliedRevision: number;
  readonly lastSyncAt?: string;
  readonly lastError?: string;
  readonly teamPets: readonly TeamPetEntry[];
  readonly teamPlugins: readonly TeamPluginEntry[];
};

export type TeamsApi = {
  getTeamsSnapshot(): Promise<TeamsSnapshot>;
  submitTeamsEnrollment(displayName: string): Promise<TeamsSnapshot>;
  syncTeamsNow(): Promise<TeamsSnapshot>;
  leaveTeams(): Promise<TeamsSnapshot>;
};

export type TeamsViewProps = {
  readonly api: TeamsApi;
  readonly onNavigate?: (route: "dashboard" | "conversation" | "pets" | "settings" | "plugins" | "integrations" | "teams") => void;
};
