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
  readonly permissionBlocked?: boolean;
  readonly approvalToken?: string;
  readonly requestedPermissions?: readonly string[];
  readonly requestedNetworkHosts?: readonly string[];
};

export type TeamsSnapshot = {
  readonly enrolled: boolean;
  readonly organizationId: string | null;
  readonly organizationName: string | null;
  readonly pendingEnrollment: boolean;
  readonly pendingOrganizationId?: string | null;
  readonly pendingOrganizationName?: string | null;
  readonly pendingEnrollmentStatus?: "started" | "accepted" | "completed" | null;
  readonly pendingEnrollmentExpiresAt?: string | null;
  readonly installationId: string | null;
  readonly pendingRevision: number;
  readonly appliedRevision: number;
  readonly lastSyncAt?: string;
  readonly lastError?: string;
  readonly teamPets: readonly TeamPetEntry[];
  readonly teamPlugins: readonly TeamPluginEntry[];
};

export const managerCheckInFeelingCodes = [
  "good",
  "steady",
  "stretched",
  "struggling",
  "need_support",
] as const;

export type ManagerCheckInFeelingCode = (typeof managerCheckInFeelingCodes)[number];

export type ManagerCheckInSettings = {
  readonly revision: number;
  readonly weeklyEnabled: boolean;
  readonly weeklyDay: number;
  readonly title: string;
  readonly introduction: string;
  readonly acknowledgement: string;
  readonly notePlaceholder: string;
  readonly labels: Readonly<Record<ManagerCheckInFeelingCode, string>>;
};

export type ManagerCheckInPromptSnapshot = {
  readonly title: string;
  readonly introduction: string;
  readonly acknowledgement: string;
  readonly notePlaceholder: string;
  readonly labels: Readonly<Record<ManagerCheckInFeelingCode, string>>;
  readonly visibilityNotice: { readonly version: 1; readonly text: string };
};

export type ManagerCheckInSubmission = {
  readonly id: string;
  readonly clientGeneratedId: string;
  readonly feelingCode: ManagerCheckInFeelingCode;
  readonly note: string | null;
  readonly submittedAt: string;
  readonly settingsRevision: number;
  readonly promptSnapshot: ManagerCheckInPromptSnapshot;
};

export type ManagerCheckInSnapshot = {
  readonly availability: "unavailable" | "unenrolled" | "available";
  readonly unavailableReason?: "secure_storage_unavailable" | "employee_identity_required";
  readonly organization: { readonly id: string; readonly name: string } | null;
  readonly visibilityNotice: { readonly version: 1; readonly text: string } | null;
  readonly settings: ManagerCheckInSettings | null;
  readonly submissions: readonly ManagerCheckInSubmission[];
  readonly scheduledOffersPaused: boolean;
  readonly dueScheduledOffer: boolean;
  readonly lastSyncAt?: string;
  readonly lastError?: string;
};

export type ManagerCheckInHistoryPage = {
  readonly submissions: readonly ManagerCheckInSubmission[];
  readonly nextCursor: string | null;
};

export type ManagerCheckInSubmitInput = {
  readonly feelingCode: ManagerCheckInFeelingCode;
  readonly note?: string | null;
  readonly settingsRevision: number;
};

export type TeamsApi = {
  getTeamsSnapshot(): Promise<TeamsSnapshot>;
  submitTeamsEnrollment(displayName: string): Promise<TeamsSnapshot>;
  syncTeamsNow(): Promise<TeamsSnapshot>;
  leaveTeams(): Promise<TeamsSnapshot>;
  approveTeamPluginPermissions?(id: string, approvalToken?: string): Promise<TeamsSnapshot>;
  setTeamPluginEnabled?(id: string, enabled: boolean): Promise<TeamsSnapshot>;
  onRouteChange?(callback: (route: string) => void): () => void;
  getManagerCheckInsSnapshot?(): Promise<ManagerCheckInSnapshot>;
  syncManagerCheckIns?(): Promise<ManagerCheckInSnapshot>;
  getManagerCheckInsHistory?(cursor?: string): Promise<ManagerCheckInHistoryPage>;
  submitManagerCheckIn?(input: ManagerCheckInSubmitInput): Promise<ManagerCheckInSnapshot>;
  setManagerCheckInScheduledOffersPaused?(paused: boolean): Promise<ManagerCheckInSnapshot>;
};

export type TeamsNavigationRoute =
  | "dashboard"
  | "pets"
  | "settings"
  | "plugins"
  | "integrations"
  | "teams";

export type TeamsViewProps = {
  readonly api: TeamsApi;
  readonly onNavigate?: (route: TeamsNavigationRoute) => void;
};

export type PermissionTone = "red" | "orange" | "blue" | "slate";
