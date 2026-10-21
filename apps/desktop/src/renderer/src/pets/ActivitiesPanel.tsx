import React, { useEffect, useRef, useState } from "react";

import { useI18n } from "../i18n.js";
import { Button } from "../components/ui/Button.js";
import { StatusPill } from "../components/ui/StatusPill.js";
import { safePetImage } from "../components/PetSprite.js";
import type { PetActivitiesSnapshot } from "../../../pet-activities-types.js";

interface ActivityRequestOwner {
  readonly petId: string;
  mounted: boolean;
  generation: number;
  pendingMutation: boolean;
  hasOperationError: boolean;
}

function ActivityPreview({
  src,
  label,
  frameCount,
  fps,
}: {
  readonly src: string | null;
  readonly label: string;
  readonly frameCount: number;
  readonly fps: number;
}) {
  const [failed, setFailed] = useState(false);
  const safeSrc = src ? safePetImage(src) : undefined;

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!safeSrc || failed) {
    return (
      <div className="w-[56px] h-[61px] rounded-xl bg-blue-100/40 dark:bg-slate-800/60 border border-blue-200/60 dark:border-slate-700/60 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-brand/60 dark:text-blue-400/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      </div>
    );
  }

  const frameWidth = 192;
  const frameHeight = 208;
  const durationSec = Math.max(0.5, frameCount / Math.max(1, fps));
  const xValues = Array.from({ length: frameCount }, (_, index) => String(-index * frameWidth)).join(";");

  return (
    <div className="w-[56px] h-[61px] rounded-xl bg-blue-50/60 dark:bg-slate-800/60 border border-blue-200/60 dark:border-slate-700/60 overflow-hidden flex items-center justify-center shrink-0">
      <svg
        className="max-w-none"
        width={56}
        height={61}
        viewBox={`0 0 ${frameWidth} ${frameHeight}`}
        role="img"
        aria-label={label}
      >
        <image
          href={safeSrc}
          x={0}
          y={0}
          width={frameWidth * frameCount}
          height={frameHeight}
          preserveAspectRatio="none"
          onError={() => setFailed(true)}
        >
          <animate
            attributeName="x"
            values={xValues}
            dur={`${durationSec}s`}
            repeatCount="indefinite"
            calcMode="discrete"
          />
        </image>
      </svg>
    </div>
  );
}

export function ActivitiesPanel({
  petId,
  load,
  setPetActivityEnabled,
  playPetActivity,
}: {
  readonly petId: string;
  readonly load: (petId: string) => Promise<PetActivitiesSnapshot | null>;
  readonly setPetActivityEnabled: (petId: string, activityId: string, enabled: boolean) => Promise<PetActivitiesSnapshot | null>;
  readonly playPetActivity: (petId: string, activityId: string) => Promise<PetActivitiesSnapshot | null>;
}) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<PetActivitiesSnapshot | null | undefined>(undefined);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const ownerRef = useRef<ActivityRequestOwner | null>(null);
  const currentPetIdRef = useRef(petId);
  currentPetIdRef.current = petId;

  function isCurrentRequest(owner: ActivityRequestOwner, generation: number): boolean {
    return ownerRef.current === owner
      && owner.mounted
      && owner.petId === currentPetIdRef.current
      && owner.generation === generation;
  }

  useEffect(() => {
    const owner: ActivityRequestOwner = {
      petId,
      mounted: true,
      generation: 0,
      pendingMutation: false,
      hasOperationError: false,
    };
    ownerRef.current = owner;
    setSnapshot(undefined);
    setSavingId(null);
    setPlayingId(null);
    setError("");

    const refresh = (): void => {
      if (owner.pendingMutation || !isCurrentRequest(owner, owner.generation)) return;
      const generation = ++owner.generation;
      load(petId)
        .then((next) => {
          if (!isCurrentRequest(owner, generation)) return;
          if (next && next.petId !== owner.petId) return;
          setSnapshot(next);
          if (!owner.hasOperationError) setError("");
        })
        .catch((err: unknown) => {
          if (!isCurrentRequest(owner, generation)) return;
          setSnapshot((current) => current === undefined ? null : current);
          if (!owner.hasOperationError) setError(errorMessage(err));
        });
    };

    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      owner.mounted = false;
      owner.generation += 1;
      window.clearInterval(timer);
    };
  }, [petId, load]);

  async function handleMutation(activityId: string, action: "toggle" | "play", currentEnabled = false): Promise<void> {
    const owner = ownerRef.current;
    if (!owner || owner.pendingMutation || !isCurrentRequest(owner, owner.generation)) return;
    const generation = ++owner.generation;
    owner.pendingMutation = true;
    owner.hasOperationError = false;
    if (action === "toggle") setSavingId(activityId);
    else setPlayingId(activityId);
    setError("");
    try {
      const next = action === "toggle"
        ? await setPetActivityEnabled(owner.petId, activityId, !currentEnabled)
        : await playPetActivity(owner.petId, activityId);
      if (!isCurrentRequest(owner, generation)) return;
      if (next && next.petId !== owner.petId) return;
      if (next) setSnapshot(next);
    } catch (err) {
      if (!isCurrentRequest(owner, generation)) return;
      owner.hasOperationError = true;
      setError(errorMessage(err));
    } finally {
      if (isCurrentRequest(owner, generation)) {
        owner.pendingMutation = false;
        setSavingId(null);
        setPlayingId(null);
      }
    }
  }

  async function handleToggleEnabled(activityId: string, currentEnabled: boolean): Promise<void> {
    await handleMutation(activityId, "toggle", currentEnabled);
  }

  async function handlePlay(activityId: string): Promise<void> {
    await handleMutation(activityId, "play");
  }

  async function handleRetry(): Promise<void> {
    const owner = ownerRef.current;
    if (!owner || owner.pendingMutation || !isCurrentRequest(owner, owner.generation)) return;
    const generation = ++owner.generation;
    owner.pendingMutation = true;
    owner.hasOperationError = false;
    setError("");
    setSnapshot(undefined);
    try {
      const next = await load(owner.petId);
      if (!isCurrentRequest(owner, generation)) return;
      if (next && next.petId !== owner.petId) return;
      setSnapshot(next);
    } catch (err) {
      if (!isCurrentRequest(owner, generation)) return;
      setError(errorMessage(err));
      setSnapshot(null);
    } finally {
      if (isCurrentRequest(owner, generation)) owner.pendingMutation = false;
    }
  }

  if (snapshot === undefined) return null;

  if (snapshot === null) {
    return (
      <section className="wardrobe activities-section mt-6" aria-label={t("pets.activities.title")}>
        <header className="wardrobe-head">
          <div>
            <p className="eyebrow">{t("pets.activities.eyebrow")}</p>
            <h3>{t("pets.activities.title")}</h3>
          </div>
        </header>
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs font-medium flex items-center justify-between gap-3">
          <span>{error || t("pets.activities.loadFailed")}</span>
          <Button variant="secondary" size="compact" icon={<RefreshIcon />} onClick={() => void handleRetry()}>
            {t("pets.detail.refresh")}
          </Button>
        </div>
      </section>
    );
  }

  if (snapshot.activities.length === 0) return null;

  const globalAvailability = snapshot.availabilityReason;

  return (
    <section className="wardrobe activities-section mt-6" aria-label={t("pets.activities.title")}>
      <header className="wardrobe-head">
        <div>
          <p className="eyebrow">{t("pets.activities.eyebrow")}</p>
          <h3>{t("pets.activities.title")}</h3>
        </div>
        <div className="wardrobe-head-actions">
          <StatusPill tone={globalAvailability ? "orange" : "purple"}>
            {globalAvailability ? t("pets.activities.statusUnavailable") : t("pets.activities.statusReady")}
          </StatusPill>
        </div>
      </header>

      {globalAvailability && (
        <div className="p-3 mb-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs font-medium flex items-center gap-2">
          <AlertIcon />
          <span>{globalAvailability}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        {snapshot.activities.map((activity) => {
          const isPlaying = snapshot.playingActivityId === activity.id || playingId === activity.id;
          const isBusy = savingId !== null || playingId !== null;
          const cardUnavailable = globalAvailability || activity.availabilityReason;

          return (
            <div
              key={activity.id}
              className={`p-4 rounded-2xl bg-white/70 dark:bg-slate-800/80 border border-blue-100 dark:border-slate-700/80 shadow-sm flex flex-col justify-between transition-all duration-300 hover:border-brand/40 dark:hover:border-blue-400/40 hover:bg-white dark:hover:bg-slate-800 ${
                activity.enabled ? "ring-1 ring-purple-500/40 bg-purple-50/40 dark:bg-purple-950/20" : ""
              }`}
            >
              <div className="flex items-start gap-3 mb-3">
                <ActivityPreview
                  src={activity.previewUrl}
                  label={activity.displayName}
                  frameCount={activity.frameCount}
                  fps={activity.fps}
                />
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold text-navy dark:text-slate-100 truncate">{activity.displayName}</h4>
                  <p className="text-xs text-slatecopy dark:text-slate-400 mt-1 line-clamp-2">
                    {t("pets.activities.cardSubtitle", { frames: activity.frameCount, fps: activity.fps })}
                  </p>
                </div>
                <div className="shrink-0">
                  <Button
                    variant={activity.enabled ? "primary" : "secondary"}
                    size="compact"
                    disabled={isBusy}
                    onClick={() => void handleToggleEnabled(activity.id, activity.enabled)}
                  >
                    {activity.enabled ? t("pets.activities.enabled") : t("pets.activities.enable")}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-blue-100/60 dark:border-slate-700/60 mt-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${activity.enabled ? "bg-emerald-500 dark:bg-emerald-400 animate-pulse" : "bg-blue-300 dark:bg-slate-600"}`} />
                  <span className="text-xs font-medium text-slatecopy dark:text-slate-400">
                    {activity.enabled ? t("pets.activities.autoIdleActive") : t("pets.activities.manualOnly")}
                  </span>
                </div>
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={isBusy || !!cardUnavailable}
                  title={cardUnavailable || t("pets.activities.playHint")}
                  icon={<PlayIcon />}
                  onClick={() => void handlePlay(activity.id)}
                >
                  {isPlaying ? t("pets.activities.playing") : t("pets.activities.play")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="p-3 mt-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs font-medium">
          {error}
        </div>
      )}
    </section>
  );
}

function PlayIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="w-4 h-4 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
