import type { PetSpriteLayout } from "../pet-preview-state.js";
export type TeamPetEntry = {
  readonly id: string;
  readonly displayName: string;
  readonly source: "team";
};

/** How an installed plugin presents itself: its translated name and icon. */
export type TeamPluginPresentation = {
  readonly name?: string;
  readonly iconDataUrl?: string;
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

export type ManagerCheckInRecurrence =
  | { readonly kind: "daily"; readonly intervalDays: number; readonly startsOn: string }
  | { readonly kind: "weekly"; readonly intervalWeeks: number; readonly startsOn: string; readonly weekdays: readonly number[] }
  | { readonly kind: "monthly"; readonly intervalMonths: number; readonly startsOn: string; readonly dates: readonly number[] }
  | { readonly kind: "monthly"; readonly intervalMonths: number; readonly startsOn: string; readonly lastDay: true }
  | { readonly kind: "quarterly"; readonly startsOn: string; readonly quarterMonths: readonly number[]; readonly dates: readonly number[] }
  | { readonly kind: "quarterly"; readonly startsOn: string; readonly quarterMonths: readonly number[]; readonly lastDay: true };

export type ManagerCheckInSchedule = {
  readonly id: string;
  readonly revision: number;
  readonly name: string;
  readonly enabled: boolean;
  readonly recurrence: ManagerCheckInRecurrence;
  readonly title: string;
  readonly introduction: string;
  readonly acknowledgement: string;
  readonly notePlaceholder: string;
  readonly labels: Readonly<Record<ManagerCheckInFeelingCode, string>>;
};

export type ManagerCheckInScheduleSnapshot = {
  readonly scheduleId: string;
  readonly scheduleName: string;
  readonly scheduleRevision: number;
  readonly recurrence: ManagerCheckInRecurrence;
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
  readonly scheduleId: string;
  readonly scheduleRevision: number;
  readonly cycleId: string;
  readonly cycleLocalDate: string;
  readonly feelingCode: ManagerCheckInFeelingCode;
  readonly note: string | null;
  readonly submittedAt: string;
  readonly scheduleSnapshot: ManagerCheckInScheduleSnapshot;
};

export type ManagerCheckInSnapshot = {
  readonly availability: "unavailable" | "unenrolled" | "available";
  readonly unavailableReason?: "secure_storage_unavailable" | "employee_identity_required";
  readonly organization: { readonly id: string; readonly name: string } | null;
  readonly visibilityNotice: { readonly version: 1; readonly text: string } | null;
  readonly schedules: readonly ManagerCheckInSchedule[];
  readonly submissions: readonly ManagerCheckInSubmission[];
  readonly devicePaused: boolean;
  readonly lastSyncAt?: string;
  readonly lastError?: string;
};

export type ManagerCheckInHistoryPage = {
  readonly submissions: readonly ManagerCheckInSubmission[];
  readonly nextCursor: string | null;
};

export type TeamsApi = {
  getTeamsSnapshot(): Promise<TeamsSnapshot>;
  getPetsState?(): Promise<{ readonly pets: { readonly installed: readonly { readonly id: string; readonly spriteLayout?: PetSpriteLayout }[] } }>;
  getPluginsSnapshot?(): Promise<{ readonly plugins: readonly { readonly id: string; readonly name?: string; readonly iconDataUrl?: string }[] }>;
  submitTeamsEnrollment(displayName: string): Promise<TeamsSnapshot>;
  syncTeamsNow(): Promise<TeamsSnapshot>;
  leaveTeams(): Promise<TeamsSnapshot>;
  openOrganizationsPage?(): Promise<void>;
  approveTeamPluginPermissions?(id: string, approvalToken?: string): Promise<TeamsSnapshot>;
  setTeamPluginEnabled?(id: string, enabled: boolean): Promise<TeamsSnapshot>;
  onRouteChange?(callback: (route: string) => void): () => void;
  getManagerCheckInsSnapshot?(): Promise<ManagerCheckInSnapshot>;
  syncManagerCheckIns?(): Promise<ManagerCheckInSnapshot>;
  getManagerCheckInsHistory?(cursor?: string): Promise<ManagerCheckInHistoryPage>;
  setManagerCheckInDevicePaused?(paused: boolean): Promise<ManagerCheckInSnapshot>;
  onManagerCheckInsRefresh?(callback: () => void): () => void;
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
