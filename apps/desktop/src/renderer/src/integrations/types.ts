export type AgentSetupAction =
  | "configure"
  | "replace"
  | "remove"
  | "install-memory"
  | "doctor-hooks"
  | "install-hooks"
  | "uninstall-hooks"
  | "opencode-install"
  | "opencode-remove"
  | "cursor-install"
  | "cursor-replace"
  | "cursor-remove"
  | "openclaw-install"
  | "openclaw-update"
  | "openclaw-remove"
  | "zed-install"
  | "zed-replace"
  | "zed-remove";

export type AgentSetupPetOption = {
  readonly id: string;
  readonly displayName: string;
  readonly default: boolean;
};

export type ClaudeCodeStatus = {
  readonly state: "detected" | "not_detected" | "configured" | "needs_setup" | "error";
  readonly label: string;
  readonly details: string;
  readonly claudeCommand?: string;
  readonly version?: string;
  readonly mcpListWorks: boolean;
  readonly openPetsEntry: {
    readonly present: boolean;
    readonly verified: boolean;
    readonly matchesExpected: boolean;
  };
  readonly canConfigure: boolean;
  readonly canReplace: boolean;
  readonly canRemove: boolean;
};

export type ClaudeHookDoctorResult = {
  readonly status: "installed" | "needs_setup" | "error" | "custom" | "conflict";
  readonly settingsPath: string;
  readonly exists: boolean;
  readonly valid: boolean;
  readonly message: string;
  readonly preview: Record<string, unknown>;
  readonly asyncSupported: boolean;
  readonly backupPath?: string;
};

export type ClaudeOpenPetsMemoryStatus = {
  readonly state: "installed" | "needs_setup" | "error";
  readonly label: string;
  readonly details: string;
  readonly claudeMdPath: string;
  readonly openPetsMemoryPath: string;
  readonly canInstall: boolean;
};

export type OpenCodeSetupStatus = {
  readonly state: "configured" | "needs_setup" | "not_detected" | "error";
  readonly label: string;
  readonly details: string;
  readonly configDir: string;
  readonly canInstall: boolean;
  readonly canRemove: boolean;
};

export type OpenCodeSetupPreview = {
  readonly global: true;
  readonly configDir: string;
  readonly configPath: string;
  readonly cleanupConfigPaths: string[];
  readonly mcpCommand: string[];
  readonly plugin: unknown[] | string;
  readonly instructionPath: string;
  readonly configPreview: Record<string, unknown>;
};

export type CursorSetupStatus = {
  readonly state: "configured" | "needs_setup" | "not_detected" | "error" | "conflict" | "needs_update";
  readonly label: string;
  readonly details: string;
  readonly configPath: string;
  readonly canInstall: boolean;
  readonly canReplace: boolean;
  readonly canRemove: boolean;
};

export type CursorSetupPreview = {
  readonly global: true;
  readonly configPath: string;
  readonly mcpEntry: Record<string, unknown>;
  readonly rulesPath: string;
  readonly rulesContent: string;
  readonly commandMode: "published" | "local" | "bundled";
};

export type OpenClawSetupState =
  | "unavailable"
  | "unsupported-host"
  | "management-disabled"
  | "not-installed"
  | "installed-disabled"
  | "installed-enabled"
  | "invalid"
  | "conflict"
  | "indeterminate";

export type OpenClawPluginStatus = {
  readonly state: OpenClawSetupState;
  readonly label: string;
  readonly details: string;
  readonly version?: string;
  readonly installedVersion?: string;
  readonly trackedSource?: "official-package" | "custom-source" | "untracked";
  readonly canInstall: boolean;
  readonly canUpdate: boolean;
  readonly canEnable: boolean;
  readonly canRemove: boolean;
};

export type OpenClawSetupPreview = {
  readonly command: string;
  readonly install: readonly string[];
  readonly enable: readonly string[];
  readonly update: readonly string[];
  readonly remove: readonly string[];
  readonly targetVersion: string;
};

export type ZedSetupStatus = {
  readonly state: "configured" | "needs_setup" | "disabled" | "needs_update" | "conflict" | "error";
  readonly label: string;
  readonly details: string;
  readonly settingsPath: string;
  readonly canInstall: boolean;
  readonly canReplace: boolean;
  readonly canRemove: boolean;
};

export type ZedSetupPreview = {
  readonly global: true;
  readonly settingsPath: string;
  readonly mcpEntry: Record<string, unknown>;
  readonly commandMode: "published" | "local" | "bundled";
};

export type AgentSetupCommandPaths = {
  readonly claude: string;
  readonly node: string;
  readonly opencode: string;
  readonly openclaw: string;
};

export type AgentSetupActionResult = {
  readonly ok: boolean;
  readonly action: AgentSetupAction;
  readonly message: string;
  readonly changed: boolean;
};

export type AgentSetupSnapshot = {
  readonly selectedPetId?: string;
  readonly commandMode: "published" | "local" | "bundled";
  readonly localDevAvailable: boolean;
  readonly petOptions: AgentSetupPetOption[];
  readonly preview: {
    readonly displayCommand: string;
    readonly mcpJson: Record<string, unknown>;
  };
  readonly status: ClaudeCodeStatus;
  readonly hookStatus: ClaudeHookDoctorResult;
  readonly memoryStatus: ClaudeOpenPetsMemoryStatus;
  readonly opencodeStatus: OpenCodeSetupStatus;
  readonly opencodePreview: OpenCodeSetupPreview;
  readonly cursorStatus: CursorSetupStatus;
  readonly cursorPreview: CursorSetupPreview;
  readonly openclawStatus: OpenClawPluginStatus;
  readonly openclawPreview: OpenClawSetupPreview;
  readonly zedStatus: ZedSetupStatus;
  readonly zedPreview: ZedSetupPreview;
  readonly commandPaths: AgentSetupCommandPaths;
  readonly busy: boolean;
  readonly lastAction?: AgentSetupActionResult;
};

export type IntegrationsApi = {
  getIntegrationsState(selectedPetId?: string, commandMode?: "published" | "local" | "bundled"): Promise<AgentSetupSnapshot>;
  runIntegrationAction(action: AgentSetupAction, selectedPetId?: string, commandMode?: "published" | "local" | "bundled"): Promise<AgentSetupSnapshot>;
  updateIntegrationCommandPaths(patch: Partial<AgentSetupCommandPaths>): Promise<AgentSetupCommandPaths>;
};

export type IntegrationStatusTone = "green" | "yellow" | "red" | "blue" | "slate" | "orange";

export type PathFieldProps = {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly onSave: (value: string) => void;
  readonly disabled?: boolean;
};

export type IntegrationIconProps = {
  readonly id: string;
};

export type IntegrationsViewProps = {
  readonly api?: IntegrationsApi;
};
