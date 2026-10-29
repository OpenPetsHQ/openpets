import { useEffect, useState } from "react";
import type { CompanionSnapshot, SceneSettings } from "../protocol.js";

interface Props {
  snapshot: CompanionSnapshot;
  pending: boolean;
  onSelect(id: string): void;
  onRename(id: string, name: string): void;
  onRemove(id: string): void;
  onAdd(id: string): void;
  onGallery(): void;
  onSettings(changes: Partial<SceneSettings>): void;
}

export function SceneControls({
  snapshot,
  pending,
  onSelect,
  onRename,
  onRemove,
  onAdd,
  onGallery,
  onSettings,
}: Props) {
  const selected = snapshot.instances.find(
    (instance) => instance.id === snapshot.selectedInstanceId,
  );
  const [draft, setDraft] = useState(selected?.name ?? "");
  const [adding, setAdding] = useState(false);
  useEffect(
    () => setDraft(selected?.name ?? ""),
    [selected?.id, selected?.name],
  );
  const trimmed = draft.trim();
  const validName = trimmed.length > 0 && Array.from(trimmed).length <= 40;
  const full = snapshot.instances.length >= 6;
  return (
    <div className="scene-controls">
      <div className="scene-control-heading">
        <h3>Companions</h3>
        <span className="muted small-text">
          {snapshot.instances.length} / 6
        </span>
      </div>
      {snapshot.instances.length > 0 && (
        <div className="instance-list" aria-label="Select a companion">
          {snapshot.instances.map((instance) => (
            <button
              key={instance.id}
              className="instance-chip"
              aria-pressed={instance.id === snapshot.selectedInstanceId}
              disabled={pending}
              onClick={() => onSelect(instance.id)}
            >
              {instance.name}
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="instance-inspector">
          <form
            className="rename-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (validName && trimmed !== selected.name)
                onRename(selected.id, trimmed);
            }}
          >
            <label htmlFor="companion-name" className="control-label">
              Name
            </label>
            <input
              id="companion-name"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              className="button secondary"
              disabled={pending || !validName || trimmed === selected.name}
            >
              Save
            </button>
          </form>
          {!validName && (
            <p className="error-text small-text">Use 1–40 characters.</p>
          )}
          {selected.problem && (
            <p className="error-text small-text">{selected.problem}</p>
          )}
          <div className="inspector-actions">
            <span className="muted small-text">
              {selected.appearance.outfitName}
            </span>
            <button
              className="text-button"
              disabled={pending}
              onClick={() => onRemove(selected.id)}
            >
              Remove from scene
            </button>
          </div>
        </div>
      )}
      {full && (
        <p className="muted small-text" role="status">
          Scene is full. Remove a companion to add another.
        </p>
      )}
      <button
        className="button secondary"
        disabled={pending || full}
        onClick={() => setAdding(!adding)}
      >
        {adding ? "Close picker" : "Add companion"}
      </button>
      {adding && (
        <div className="asset-picker">
          <p className="muted small-text">
            Choose an installed pet. You can add the same pet more than once.
          </p>
          {snapshot.installedPets.map((pet) => (
            <button
              key={pet.id}
              className="button secondary"
              disabled={pending || full}
              onClick={() => {
                onAdd(pet.id);
                setAdding(false);
              }}
            >
              {pet.displayName}
            </button>
          ))}
          <button className="text-button" onClick={onGallery}>
            Browse gallery
          </button>
        </div>
      )}
      <details className="scene-settings">
        <summary>Scene settings</summary>
        <div className="settings-row">
          <span className="control-label">Motion</span>
          <div className="segmented wide-segment">
            {(["still", "calm", "playful"] as const).map((motion) => (
              <button
                key={motion}
                disabled={pending}
                aria-pressed={snapshot.settings.motion === motion}
                onClick={() => onSettings({ motion })}
              >
                {motion[0].toUpperCase() + motion.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="control-label">Size</span>
          <div className="segmented">
            {(["small", "medium", "large"] as const).map((size, index) => (
              <button
                key={size}
                title={`${size} (${[48, 72, 96][index]}px)`}
                disabled={pending}
                aria-pressed={snapshot.settings.size === size}
                onClick={() => onSettings({ size })}
              >
                {["S", "M", "L"][index]}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="control-label">Backdrop</span>
          <div className="segmented wide-segment">
            {(["plain", "dots"] as const).map((backdrop) => (
              <button
                key={backdrop}
                disabled={pending}
                aria-pressed={snapshot.settings.backdrop === backdrop}
                onClick={() => onSettings({ backdrop })}
              >
                {backdrop === "plain" ? "Plain" : "Dots"}
              </button>
            ))}
          </div>
        </div>
        <button
          className="button secondary"
          disabled={pending}
          onClick={() => onSettings({ paused: !snapshot.settings.paused })}
        >
          {snapshot.settings.paused ? "Resume" : "Pause"}
        </button>
      </details>
    </div>
  );
}
