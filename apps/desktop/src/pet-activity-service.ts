import { getPetActivityDurationMs, type PetActivity } from "./pet-activities-core.js";
import { nextActivityOpportunityMs, selectIdlePetActivity } from "./pet-activity-policy.js";

export interface PetActivityCarrier {
  readonly id: number;
  readonly petId: string;
  readonly activities: readonly PetActivity[];
  readonly outfitId: string;
  readonly availabilityReason: () => string | null;
  readonly play: (activity: PetActivity, generation: number) => void;
  readonly stop: (generation: number) => void;
}

interface CarrierEntry {
  carrier: PetActivityCarrier;
  opportunityAt: number | null;
  generation: number;
  active: { readonly activity: PetActivity; readonly generation: number; readonly deadline: number } | null;
}

interface PetHistory {
  readonly playedAt: Map<string, number>;
  lastId: string | null;
}

/** One owner per window, one active playback/history lane per pet. No Electron. */
export class PetActivityService {
  private readonly carriers = new Map<number, CarrierEntry>();
  private readonly history = new Map<string, PetHistory>();
  private generation = 0;

  constructor(private readonly options: {
    readonly now: () => number;
    readonly random: () => number;
    readonly enabledIds: (petId: string) => readonly string[];
    readonly onFailure: (petId: string, activityId: string) => void;
  }) {}

  register(carrier: PetActivityCarrier): void {
    const previous = this.carriers.get(carrier.id);
    if (previous) this.cancel(carrier.id);
    this.carriers.set(carrier.id, { carrier, generation: ++this.generation, active: null, opportunityAt: null });
  }

  remove(id: number): void {
    this.cancel(id);
    this.carriers.delete(id);
  }

  forgetPet(petId: string): void {
    for (const [id, entry] of this.carriers) {
      if (entry.carrier.petId === petId) this.remove(id);
    }
    this.history.delete(petId);
  }

  cancel(id: number): void {
    const entry = this.carriers.get(id);
    if (!entry) return;
    const active = entry.active;
    entry.active = null;
    entry.opportunityAt = null;
    entry.generation = ++this.generation;
    if (active) entry.carrier.stop(active.generation);
  }

  cancelAll(): void {
    for (const id of this.carriers.keys()) this.cancel(id);
  }

  stop(): void {
    this.cancelAll();
    this.carriers.clear();
    this.history.clear();
  }

  getPlayingActivityId(petId: string): string | null {
    for (const entry of this.carriers.values()) {
      if (entry.carrier.petId === petId && entry.active) return entry.active.activity.id;
    }
    return null;
  }

  isCurrent(id: number, generation: number): boolean {
    return this.carriers.get(id)?.active?.generation === generation;
  }

  getAvailabilityReason(petId: string): string | null {
    const entries = [...this.carriers.values()].filter((entry) => entry.carrier.petId === petId);
    if (entries.length === 0) return "Show this pet on the desktop to play an activity.";
    if (this.getPlayingActivityId(petId)) return "An activity is already playing.";
    const reasons = entries.map((entry) => this.carrierReason(entry));
    if (reasons.some((reason) => reason === null)) return null;
    return reasons[0] ?? null;
  }

  play(petId: string, activityId: string): void {
    const reason = this.getAvailabilityReason(petId);
    if (reason) throw new Error(reason);
    const entry = [...this.carriers.values()].find((candidate) => {
      return candidate.carrier.petId === petId
        && this.carrierReason(candidate) === null
        && candidate.carrier.activities.some((activity) => activity.id === activityId);
    });
    const activity = entry?.carrier.activities.find((candidate) => candidate.id === activityId);
    if (!entry || !activity) throw new Error("This activity is unavailable. Reinstall the pet to restore its activity asset.");
    this.start(entry, activity);
  }

  complete(id: number, generation: number, failed = false): void {
    const entry = this.carriers.get(id);
    if (!entry?.active || entry.active.generation !== generation) return;
    const activityId = entry.active.activity.id;
    this.cancel(id);
    if (failed) {
      for (const candidate of this.carriers.values()) {
        if (candidate.carrier.petId !== entry.carrier.petId) continue;
        candidate.carrier = {
          ...candidate.carrier,
          activities: candidate.carrier.activities.filter((activity) => activity.id !== activityId),
        };
      }
      this.options.onFailure(entry.carrier.petId, activityId);
    }
  }

  tick(): void {
    const now = this.options.now();
    for (const entry of this.carriers.values()) {
      if (this.carrierReason(entry)) {
        this.cancel(entry.carrier.id);
        continue;
      }
      if (entry.active) {
        if (now >= entry.active.deadline) this.complete(entry.carrier.id, entry.active.generation, true);
        continue;
      }
      if (this.getPlayingActivityId(entry.carrier.petId)) {
        entry.opportunityAt = null;
        continue;
      }
      if (entry.opportunityAt === null) entry.opportunityAt = now + nextActivityOpportunityMs(this.options.random);
      if (now < entry.opportunityAt) continue;
      const history = this.getHistory(entry.carrier.petId);
      const activity = selectIdlePetActivity(entry.carrier.activities, this.options.enabledIds(entry.carrier.petId), history.playedAt, history.lastId, now, this.options.random);
      if (activity) {
        this.start(entry, activity);
      } else {
        entry.opportunityAt = now + nextActivityOpportunityMs(this.options.random);
      }
    }
  }

  private carrierReason(entry: CarrierEntry): string | null {
    if (entry.carrier.outfitId !== "default") return "Activities are available only while wearing the default outfit.";
    return entry.carrier.availabilityReason();
  }

  private getHistory(petId: string): PetHistory {
    let history = this.history.get(petId);
    if (!history) {
      history = { playedAt: new Map(), lastId: null };
      this.history.set(petId, history);
    }
    return history;
  }

  private start(entry: CarrierEntry, activity: PetActivity): void {
    const now = this.options.now();
    const generation = ++this.generation;
    entry.active = { activity, generation, deadline: now + getPetActivityDurationMs(activity) + 5_000 };
    entry.opportunityAt = null;
    const history = this.getHistory(entry.carrier.petId);
    history.lastId = activity.id;
    history.playedAt.set(activity.id, now);
    entry.carrier.play(activity, generation);
  }
}
