import { useState } from "react";
import { useI18n } from "../../i18n.js";
import { ProviderLibrary } from "./ProviderLibrary.js";
import { ProviderModal } from "./ProviderModal.js";
import { ProviderRoleOverview } from "./ProviderRoleOverview.js";
import type {
  ProviderControlCenterSnapshot,
  ProviderProfileInput,
  ProviderProfilePatch,
  ProviderProfileSummary,
  ProviderRole,
  ProviderConfigurationSaveInput,
} from "./types.js";

// Plugin audio/microphone permission gates are deliberately NOT part of this
// section: they only govern plugins and live in the Plugin Platform tab.
export type ProvidersSectionApi = {
  selectProviderProfile(role: ProviderRole, id: string | null): Promise<ProviderControlCenterSnapshot>;
  createProviderProfile(profile: ProviderProfileInput): Promise<ProviderControlCenterSnapshot>;
  updateProviderProfile(id: string, patch: ProviderProfilePatch): Promise<ProviderControlCenterSnapshot>;
  saveProviderConfiguration(input: ProviderConfigurationSaveInput): Promise<ProviderControlCenterSnapshot>;
  deleteProviderProfile(id: string): Promise<ProviderControlCenterSnapshot>;
  setProviderProfileCredential(id: string, value: string): Promise<ProviderControlCenterSnapshot>;
  deleteProviderProfileCredential(id: string): Promise<ProviderControlCenterSnapshot>;
};

export type ProvidersSectionProps = {
  readonly snapshot: ProviderControlCenterSnapshot | null;
  readonly onSnapshotChange: (snapshot: ProviderControlCenterSnapshot) => void;
  readonly busy: string;
  readonly run: (label: string, fn: () => Promise<void>) => Promise<void>;
  readonly setMessage: (msg: string) => void;
  readonly setError: (err: string) => void;
  readonly api?: ProvidersSectionApi;
};

export function ProvidersSection({
  snapshot,
  onSnapshotChange,
  busy,
  run,
  setMessage,
  setError,
  api: injectedApi,
}: ProvidersSectionProps) {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ProviderProfileSummary | null>(null);
  const [initialPresetId, setInitialPresetId] = useState<string | undefined>(undefined);

  const getApi = (): ProvidersSectionApi => {
    if (injectedApi) return injectedApi;
    return (window as unknown as { openPetsControlCenter: ProvidersSectionApi }).openPetsControlCenter;
  };

  function handleOpenCreate(presetId?: string) {
    setEditingProfile(null);
    setInitialPresetId(presetId);
    setModalOpen(true);
  }

  function handleOpenEdit(profile: ProviderProfileSummary) {
    setEditingProfile(profile);
    setInitialPresetId(undefined);
    setModalOpen(true);
  }

  function handleSelectRole(role: ProviderRole, profileId: string | null) {
    void run(t("settings.providers.busy.selecting"), async () => {
      try {
        const next = await getApi().selectProviderProfile(role, profileId);
        onSnapshotChange(next);
        setMessage(
          profileId
            ? t("settings.providers.toast.profileActivated")
            : t("settings.providers.toast.roleDisabled")
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t("settings.providers.toast.selectFailed"));
      }
    });
  }

  function handleDeleteProfile(id: string) {
    void run(t("settings.providers.busy.deleting"), async () => {
      try {
        const next = await getApi().deleteProviderProfile(id);
        onSnapshotChange(next);
        setMessage(t("settings.providers.toast.profileDeleted"));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t("settings.providers.toast.deleteFailed"));
      }
    });
  }

  async function handleSaveCredential(id: string, value: string) {
    await run(t("settings.providers.busy.savingKey"), async () => {
      try {
        const next = await getApi().setProviderProfileCredential(id, value);
        onSnapshotChange(next);
        setMessage(t("settings.providers.toast.keySaved"));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t("settings.providers.toast.keySaveFailed"));
      }
    });
  }

  async function handleDeleteCredential(id: string) {
    await run(t("settings.providers.busy.removingKey"), async () => {
      try {
        const next = await getApi().deleteProviderProfileCredential(id);
        onSnapshotChange(next);
        setMessage(t("settings.providers.toast.keyRemoved"));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t("settings.providers.toast.keyRemoveFailed"));
      }
    });
  }

  async function handleModalSave(input: ProviderConfigurationSaveInput) {
    const { isEditing, activatedRoles } = input;
    let failure: unknown;
    let failed = false;
    await run(
      isEditing ? t("settings.providers.busy.updating") : t("settings.providers.busy.creating"),
      async () => {
      try {
        const nextSnapshot = await getApi().saveProviderConfiguration(input);
        onSnapshotChange(nextSnapshot);
        setMessage(
          isEditing
            ? t("settings.providers.toast.updated")
            : activatedRoles.length > 0
              ? t("settings.providers.toast.createdActivated")
              : t("settings.providers.toast.createdSaved")
        );
      } catch (error) {
        failed = true;
        failure = error;
        throw error;
      }
    });
    // `run` owns the page-level error state and deliberately swallows errors;
    // reject this modal action as well so the modal remains open and renders it.
    if (failed) throw failure;
  }

  return (
    <div className="settings-section flex flex-col gap-5">
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">{t("settings.providers.eyebrow")}</p>
          <h2 className="settings-section-title">{t("settings.providers.title")}</h2>
        </div>
      </div>
      <p className="text-sm text-slatecopy -mt-3 mb-1">
        {t("settings.providers.intro")}
      </p>

      {/* Role-First Overview */}
      <ProviderRoleOverview
        snapshot={snapshot}
        busy={busy}
        onSelectRole={handleSelectRole}
        onOpenCreate={handleOpenCreate}
        onOpenEdit={handleOpenEdit}
      />

      {/* Configured Profiles Library */}
      <ProviderLibrary
        snapshot={snapshot}
        busy={busy}
        onOpenCreate={handleOpenCreate}
        onOpenEdit={handleOpenEdit}
        onDeleteProfile={handleDeleteProfile}
        onSelectRole={handleSelectRole}
        onSaveCredential={handleSaveCredential}
        onDeleteCredential={handleDeleteCredential}
      />

      {/* Guided Setup Modal */}
      <ProviderModal
        isOpen={modalOpen}
        editingProfile={editingProfile}
        initialPresetId={initialPresetId}
        busy={busy}
        onClose={() => setModalOpen(false)}
        onSave={handleModalSave}
      />
    </div>
  );
}
