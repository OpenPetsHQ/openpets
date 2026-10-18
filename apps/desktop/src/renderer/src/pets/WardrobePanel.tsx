import React, { useEffect, useMemo, useState } from "react";

import { useI18n } from "../i18n.js";
import { SpriteFrame, installedPetSpritesheetUrl } from "../components/PetSprite.js";
import { Button } from "../components/ui/Button.js";
import { StatusPill } from "../components/ui/StatusPill.js";
import type { PetSpriteLayout } from "../pet-preview-state.js";
import {
  defaultOutfitId,
  describeOutfitRule,
  emptyRuleDraft,
  ruleDraftFromRule,
  ruleFromDraft,
  weekdays,
  type OutfitRuleDraft,
  type PetWardrobeSnapshot,
  type PetWardrobeUpdate,
  type WardrobeRule,
} from "./wardrobe-state.js";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Wardrobe section of the pet detail dialog: pick an outfit to always wear,
 * or follow the schedule, and edit that schedule. Renders nothing for pets
 * without a wardrobe. All persistence goes through the main-process wardrobe
 * service; this view only holds unsaved rule-editor drafts.
 */
export function WardrobePanel({ petId, spriteLayout, load, update, installCatalogOutfits }: {
  readonly petId: string;
  readonly spriteLayout?: PetSpriteLayout;
  readonly load: (petId: string) => Promise<PetWardrobeSnapshot | null>;
  readonly update: (petId: string, patch: PetWardrobeUpdate) => Promise<PetWardrobeSnapshot | null>;
  /** Set when the catalog offers a first or newer wardrobe package than the installed copy. */
  readonly installCatalogOutfits?: () => Promise<unknown>;
}) {
  const { t, locale } = useI18n();
  const [wardrobe, setWardrobe] = useState<PetWardrobeSnapshot | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Index of the rule being edited; schedule.length means a new rule.
  const [editing, setEditing] = useState<{ readonly index: number; readonly draft: OutfitRuleDraft } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setWardrobe(undefined);
    setEditing(null);
    const refresh = (): void => {
      load(petId)
        .then((next) => { if (!cancelled) setWardrobe(next); })
        .catch((err: unknown) => { if (!cancelled) { setWardrobe(null); setError(errorMessage(err)); } });
    };
    refresh();
    // "Now wearing" follows the clock; the schedule has minute resolution.
    const timer = window.setInterval(refresh, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [petId, load, reloadToken]);

  const outfitName = useMemo(() => {
    const names = new Map((wardrobe?.outfits ?? []).map((outfit) => [outfit.id, outfit.displayName]));
    return (id: string): string => names.get(id) ?? t("pets.wardrobe.defaultOutfit");
  }, [wardrobe, t]);

  async function getCatalogOutfits(): Promise<void> {
    if (!installCatalogOutfits) return;
    setSaving(true);
    setError("");
    try {
      await installCatalogOutfits();
      setReloadToken((token) => token + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (wardrobe === undefined) return null;
  if (wardrobe === null) {
    if (!installCatalogOutfits) return error ? <p className="wardrobe-error" role="alert">{error}</p> : null;
    return (
      <section className="wardrobe wardrobe-offer" aria-label={t("pets.wardrobe.title")}>
        <div>
          <p className="eyebrow">{t("pets.wardrobe.eyebrow")}</p>
          <p className="wardrobe-offer-text">{t("pets.wardrobe.offer")}</p>
        </div>
        <Button variant="primary" size="compact" disabled={saving} onClick={() => void getCatalogOutfits()}>
          {saving ? t("pets.wardrobe.gettingOutfits") : t("pets.wardrobe.getOutfits")}
        </Button>
        {error && <p className="wardrobe-error" role="alert">{error}</p>}
      </section>
    );
  }

  async function apply(patch: PetWardrobeUpdate): Promise<boolean> {
    setSaving(true);
    setError("");
    try {
      const next = await update(petId, patch);
      setWardrobe(next);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveSchedule(schedule: readonly WardrobeRule[]): Promise<boolean> {
    return apply({ schedule });
  }

  const outfitIds = [defaultOutfitId, ...wardrobe.outfits.map((outfit) => outfit.id)];
  // A draft is tied to its rule index, so other rows stay locked while one is open.
  const rowsLocked = saving || editing !== null;
  const schedule = wardrobe.schedule;

  return (
    <section className="wardrobe" aria-label={t("pets.wardrobe.title")}>
      <header className="wardrobe-head">
        <div>
          <p className="eyebrow">{t("pets.wardrobe.eyebrow")}</p>
          <h3>{t("pets.wardrobe.title")}</h3>
        </div>
        <div className="wardrobe-head-actions">
          {installCatalogOutfits && (
            <Button variant="secondary" size="compact" disabled={saving} onClick={() => void getCatalogOutfits()}>{t("pets.wardrobe.updateOutfits")}</Button>
          )}
          <StatusPill tone="green">{t("pets.wardrobe.nowWearing", { outfit: outfitName(wardrobe.wearing) })}</StatusPill>
        </div>
      </header>

      <div className="wardrobe-outfits" role="radiogroup" aria-label={t("pets.wardrobe.alwaysWearLabel")}>
        {outfitIds.map((id) => {
          const chosen = wardrobe.choice === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={chosen}
              className={`wardrobe-outfit ${chosen ? "chosen" : ""} ${wardrobe.wearing === id ? "wearing" : ""}`}
              disabled={saving}
              title={chosen ? t("pets.wardrobe.followScheduleHint") : t("pets.wardrobe.alwaysWearHint", { outfit: outfitName(id) })}
              onClick={() => void apply({ outfit: chosen ? "auto" : id })}
            >
              <SpriteFrame src={installedPetSpritesheetUrl(petId, id)} label={outfitName(id)} spriteLayout={spriteLayout} size="mini" />
              <span className="wardrobe-outfit-name">{outfitName(id)}</span>
              {chosen ? <span className="wardrobe-outfit-tag">{t("pets.wardrobe.always")}</span> : wardrobe.wearing === id ? <span className="wardrobe-outfit-tag">{t("pets.wardrobe.wearing")}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="wardrobe-mode">
        {wardrobe.choice === "auto" ? (
          <p>{t("pets.wardrobe.followingSchedule", { outfit: outfitName(wardrobe.scheduled) })}</p>
        ) : (
          <>
            <p>{t("pets.wardrobe.alwaysWearing", { outfit: outfitName(wardrobe.choice) })}</p>
            <Button variant="secondary" size="compact" disabled={saving} onClick={() => void apply({ outfit: "auto" })}>{t("pets.wardrobe.followSchedule")}</Button>
          </>
        )}
      </div>

      <div className="wardrobe-schedule">
        <div className="wardrobe-schedule-head">
          <h4>{t("pets.wardrobe.schedule")}</h4>
          <StatusPill tone={wardrobe.scheduleCustomized ? "purple" : "slate"}>
            {wardrobe.scheduleCustomized ? t("pets.wardrobe.customized") : t("pets.wardrobe.creatorSchedule")}
          </StatusPill>
          {wardrobe.scheduleCustomized && (
            <Button variant="secondary" size="compact" disabled={saving} onClick={() => { setEditing(null); void apply({ schedule: null }); }}>{t("pets.wardrobe.resetSchedule")}</Button>
          )}
        </div>

        {schedule.length === 0 && !editing && <p className="wardrobe-empty">{t("pets.wardrobe.noRules")}</p>}

        <ol className="wardrobe-rules">
          {schedule.map((rule, index) => editing?.index === index ? (
            <li key={`edit-${index}`}>
              <RuleEditor
                draft={editing.draft}
                outfitIds={outfitIds}
                outfitName={outfitName}
                saving={saving}
                locale={locale}
                t={t}
                onChange={(draft) => setEditing({ index, draft })}
                onCancel={() => setEditing(null)}
                onSave={(nextRule) => void saveSchedule(schedule.map((current, i) => i === index ? nextRule : current)).then((ok) => { if (ok) setEditing(null); })}
              />
            </li>
          ) : (
            <li key={index} className={`wardrobe-rule ${rule.enabled === false ? "disabled" : ""} ${wardrobe.activeRuleIndex === index ? "active" : ""}`}>
              <input
                className="wardrobe-rule-toggle"
                type="checkbox"
                checked={rule.enabled !== false}
                disabled={rowsLocked}
                aria-label={t("pets.wardrobe.ruleEnabled")}
                onChange={(event) => void saveSchedule(schedule.map((current, i) => i === index ? toggleRule(current, event.target.checked) : current))}
              />
              <div className="wardrobe-rule-info">
                <strong>{outfitName(rule.outfit)}</strong>
                <small>{describeOutfitRule(rule, locale, t)}</small>
              </div>
              {wardrobe.activeRuleIndex === index && <StatusPill tone="green">{t("pets.wardrobe.activeNow")}</StatusPill>}
              <div className="wardrobe-rule-actions">
                <IconButton label={t("pets.wardrobe.moveUp")} disabled={rowsLocked || index === 0} onClick={() => void saveSchedule(move(schedule, index, -1))}><path d="m18 15-6-6-6 6" /></IconButton>
                <IconButton label={t("pets.wardrobe.moveDown")} disabled={rowsLocked || index === schedule.length - 1} onClick={() => void saveSchedule(move(schedule, index, 1))}><path d="m6 9 6 6 6-6" /></IconButton>
                <IconButton label={t("pets.wardrobe.editRule")} disabled={rowsLocked} onClick={() => setEditing({ index, draft: ruleDraftFromRule(rule) })}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></IconButton>
                <IconButton label={t("pets.wardrobe.deleteRule")} disabled={rowsLocked} onClick={() => void saveSchedule(schedule.filter((_, i) => i !== index))}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /></IconButton>
              </div>
            </li>
          ))}
          {editing?.index === schedule.length && (
            <li>
              <RuleEditor
                draft={editing.draft}
                outfitIds={outfitIds}
                outfitName={outfitName}
                saving={saving}
                locale={locale}
                t={t}
                onChange={(draft) => setEditing({ index: schedule.length, draft })}
                onCancel={() => setEditing(null)}
                onSave={(nextRule) => void saveSchedule([...schedule, nextRule]).then((ok) => { if (ok) setEditing(null); })}
              />
            </li>
          )}
        </ol>

        {!editing && (
          <Button variant="secondary" size="compact" disabled={saving || schedule.length >= 32} onClick={() => setEditing({ index: schedule.length, draft: emptyRuleDraft(wardrobe.outfits[0]?.id ?? defaultOutfitId) })}>
            {t("pets.wardrobe.addRule")}
          </Button>
        )}
        <p className="wardrobe-footnote">{t("pets.wardrobe.footnote")}</p>
      </div>

      {error && <p className="wardrobe-error" role="alert">{error}</p>}
    </section>
  );
}

function RuleEditor({ draft, outfitIds, outfitName, saving, locale, t, onChange, onCancel, onSave }: {
  readonly draft: OutfitRuleDraft;
  readonly outfitIds: readonly string[];
  readonly outfitName: (id: string) => string;
  readonly saving: boolean;
  readonly locale: string;
  readonly t: Translate;
  readonly onChange: (draft: OutfitRuleDraft) => void;
  readonly onCancel: () => void;
  readonly onSave: (rule: WardrobeRule) => void;
}) {
  const result = ruleFromDraft(draft);
  const set = (patch: Partial<OutfitRuleDraft>): void => onChange({ ...draft, ...patch });
  const months = useMemo(() => Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(2000, month, 1))), [locale]);
  const dayNames = useMemo(() => weekdays.map((_, index) => new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2023, 0, 1 + index))), [locale]);

  return (
    <div className="wardrobe-editor">
      <label className="wardrobe-editor-row">
        <span>{t("pets.wardrobe.wear")}</span>
        <select className="settings-select" value={draft.outfit} onChange={(event) => set({ outfit: event.target.value })}>
          {outfitIds.map((id) => <option key={id} value={id}>{outfitName(id)}</option>)}
        </select>
      </label>

      <fieldset className="wardrobe-editor-condition">
        <label className="wardrobe-editor-check">
          <input type="checkbox" checked={draft.useTime} onChange={(event) => set({ useTime: event.target.checked })} />
          <span>{t("pets.wardrobe.condition.time")}</span>
        </label>
        {draft.useTime && (
          <div className="wardrobe-editor-inline">
            <input className="settings-select" type="time" value={draft.timeFrom} aria-label={t("pets.wardrobe.from")} onChange={(event) => set({ timeFrom: event.target.value })} />
            <span>–</span>
            <input className="settings-select" type="time" value={draft.timeTo} aria-label={t("pets.wardrobe.to")} onChange={(event) => set({ timeTo: event.target.value })} />
          </div>
        )}
      </fieldset>

      <fieldset className="wardrobe-editor-condition">
        <label className="wardrobe-editor-check">
          <input type="checkbox" checked={draft.useDays} onChange={(event) => set({ useDays: event.target.checked })} />
          <span>{t("pets.wardrobe.condition.days")}</span>
        </label>
        {draft.useDays && (
          <div className="plugin-chip-list">
            {weekdays.map((day, index) => {
              const active = draft.days.includes(day);
              return (
                <button key={day} type="button" className={`plugin-chip ${active ? "active" : ""}`} aria-pressed={active}
                  onClick={() => set({ days: active ? draft.days.filter((candidate) => candidate !== day) : [...draft.days, day] })}>
                  {dayNames[index]}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      <fieldset className="wardrobe-editor-condition">
        <label className="wardrobe-editor-check">
          <input type="checkbox" checked={draft.useDates} onChange={(event) => set({ useDates: event.target.checked })} />
          <span>{t("pets.wardrobe.condition.dates")}</span>
        </label>
        {draft.useDates && (
          <div className="wardrobe-editor-inline">
            <MonthDayInput months={months} value={draft.dateFrom} label={t("pets.wardrobe.from")} onChange={(dateFrom) => set({ dateFrom })} />
            <span>–</span>
            <MonthDayInput months={months} value={draft.dateTo} label={t("pets.wardrobe.to")} onChange={(dateTo) => set({ dateTo })} />
          </div>
        )}
      </fieldset>

      {!result.ok && <p className="wardrobe-hint">{t(result.reason)}</p>}
      <div className="wardrobe-editor-actions">
        <Button variant="secondary" size="compact" disabled={saving} onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="primary" size="compact" disabled={saving || !result.ok} onClick={() => { if (result.ok) onSave(result.rule); }}>{t("pets.wardrobe.saveRule")}</Button>
      </div>
    </div>
  );
}

function MonthDayInput({ months, value, label, onChange }: { readonly months: readonly string[]; readonly value: string; readonly label: string; readonly onChange: (value: string) => void }) {
  const [month, day] = value.split("-");
  const daysInMonth = new Date(2000, Number(month), 0).getDate();
  return (
    <span className="wardrobe-month-day" role="group" aria-label={label}>
      <select className="settings-select" value={month} onChange={(event) => {
        const nextMonth = event.target.value;
        const maxDay = new Date(2000, Number(nextMonth), 0).getDate();
        onChange(`${nextMonth}-${String(Math.min(Number(day), maxDay)).padStart(2, "0")}`);
      }}>
        {months.map((name, index) => <option key={name} value={String(index + 1).padStart(2, "0")}>{name}</option>)}
      </select>
      <select className="settings-select" value={day} onChange={(event) => onChange(`${month}-${event.target.value}`)}>
        {Array.from({ length: daysInMonth }, (_, index) => String(index + 1).padStart(2, "0")).map((option) => <option key={option} value={option}>{Number(option)}</option>)}
      </select>
    </span>
  );
}

function IconButton({ label, disabled, onClick, children }: { readonly label: string; readonly disabled?: boolean; readonly onClick: () => void; readonly children: React.ReactNode }) {
  return (
    <button type="button" className="wardrobe-icon-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
    </button>
  );
}

function toggleRule(rule: WardrobeRule, enabled: boolean): WardrobeRule {
  const { enabled: _previous, ...rest } = rule;
  return enabled ? rest : { ...rest, enabled: false };
}

function move<T>(items: readonly T[], index: number, delta: number): T[] {
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(index + delta, 0, item);
  return next;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : String(error);
}
