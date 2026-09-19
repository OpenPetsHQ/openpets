import { useState } from "react";
import { ProviderGatesSection } from "./ProviderGatesSection.js";
import { ProviderLibrary } from "./ProviderLibrary.js";
import { ProviderModal } from "./ProviderModal.js";
import { ProviderRoleOverview } from "./ProviderRoleOverview.js";
import type {
  ProviderControlCenterSnapshot,
  ProviderGates,
  ProviderProfileInput,
  ProviderProfilePatch,
  ProviderProfileSummary,
  ProviderRole,
} from "./types.js";

export type ProvidersSectionApi = {
  selectProviderProfile(role: ProviderRole, id: string | null): Promise<ProviderControlCenterSnapshot>;
  createProviderProfile(profile: ProviderProfileInput): Promise<ProviderControlCenterSnapshot>;
  updateProviderProfile(id: string, patch: ProviderProfilePatch): Promise<ProviderControlCenterSnapshot>;
  deleteProviderProfile(id: string): Promise<ProviderControlCenterSnapshot>;
  setProviderProfileCredential(id: string, value: string): Promise<ProviderControlCenterSnapshot>;
  deleteProviderProfileCredential(id: string): Promise<ProviderControlCenterSnapshot>;
  updateProviderGates(patch: Partial<ProviderGates>): Promise<ProviderControlCenterSnapshot>;
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
    void run("Selecting provider profile...", async () => {
      try {
        const next = await getApi().selectProviderProfile(role, profileId);
        onSnapshotChange(next);
        setMessage(profileId ? "Provider profile activated." : "Role disabled.");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to select profile.");
      }
    });
  }

  function handleDeleteProfile(id: string) {
    void run("Deleting provider profile...", async () => {
      try {
        const next = await getApi().deleteProviderProfile(id);
        onSnapshotChange(next);
        setMessage("Provider profile deleted.");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to delete profile.");
      }
    });
  }

  async function handleSaveCredential(id: string, value: string) {
    await run("Saving API credential...", async () => {
      try {
        const next = await getApi().setProviderProfileCredential(id, value);
        onSnapshotChange(next);
        setMessage("API credential saved securely.");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to save credential.");
      }
    });
  }

  async function handleDeleteCredential(id: string) {
    await run("Removing API credential...", async () => {
      try {
        const next = await getApi().deleteProviderProfileCredential(id);
        onSnapshotChange(next);
        setMessage("API credential removed.");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to delete credential.");
      }
    });
  }

  function handleUpdateGate(patch: Partial<ProviderGates>) {
    void run("Updating capability permissions...", async () => {
      try {
        const next = await getApi().updateProviderGates(patch);
        onSnapshotChange(next);
        setMessage("Capability permissions updated.");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to update permissions.");
      }
    });
  }

  async function handleModalSave({
    isEditing,
    profileId,
    payload,
    credentialValue,
    activatedRoles,
    deactivatedRoles,
  }: {
    readonly isEditing: boolean;
    readonly profileId: string;
    readonly payload: ProviderProfileInput | ProviderProfilePatch;
    readonly credentialValue?: string;
    readonly activatedRoles: readonly ProviderRole[];
    readonly deactivatedRoles: readonly ProviderRole[];
  }) {
    await run(isEditing ? "Updating profile..." : "Creating profile...", async () => {
      const api = getApi();
      let nextSnapshot: ProviderControlCenterSnapshot;

      // 1. Create or Update Profile
      if (isEditing) {
        nextSnapshot = await api.updateProviderProfile(profileId, payload);
      } else {
        nextSnapshot = await api.createProviderProfile(payload as ProviderProfileInput);
      }

      // 2. Set credential if provided
      if (credentialValue) {
        nextSnapshot = await api.setProviderProfileCredential(profileId, credentialValue);
      }

      // 3. Apply role deactivations
      for (const role of deactivatedRoles) {
        nextSnapshot = await api.selectProviderProfile(role, null);
      }

      // 4. Apply role activations
      for (const role of activatedRoles) {
        nextSnapshot = await api.selectProviderProfile(role, profileId);
      }

      onSnapshotChange(nextSnapshot);
      setMessage(
        isEditing
          ? "Provider profile updated successfully."
          : activatedRoles.length > 0
            ? "Provider profile created and activated."
            : "Provider profile created and saved to library."
      );
    });
  }

  const gates = snapshot?.gates ?? {
    allowPluginAudio: true,
    allowDynamicSpeech: false,
    allowPluginVoice: true,
    allowMicrophone: false,
    quietHours: { enabled: false, start: "22:00", end: "08:00" },
  };

  return (
    <div className="settings-section flex flex-col gap-5">
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">PROVIDERS & CAPABILITIES</p>
          <h2 className="settings-section-title">AI Models & Voice Providers</h2>
        </div>
      </div>
      <p className="text-sm text-slatecopy -mt-3 mb-1">
        Configure the AI models powering your desktop companion: choose your Pet Brain for intelligence and reasoning, speech recognition for voice input, and neural speech synthesis for spoken replies.
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

      {/* Host Capability Gates & Quiet Hours */}
      <ProviderGatesSection
        gates={gates}
        busy={busy}
        onUpdateGate={handleUpdateGate}
      />

      {/* Guided Setup Modal */}
      <ProviderModal
        isOpen={modalOpen}
        editingProfile={editingProfile}
        initialPresetId={initialPresetId}
        currentSelections={snapshot?.selections ?? { text: null, stt: null, tts: null }}
        busy={busy}
        onClose={() => setModalOpen(false)}
        onSave={handleModalSave}
      />
    </div>
  );
}
