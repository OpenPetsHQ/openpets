import type { AvailablePetActivity } from "./pet-activity-contract.js";
import { nextActivityOpportunityMs, selectIdlePetActivity } from "./pet-activity-policy.js";

export interface PetActivityCarrier {
  readonly id: number;
  readonly petId: string;
  readonly outfitId: string;
  /** Changes whenever the committed artwork or install revision changes. */
  readonly revision: string;
  readonly failureRevision: string;
  readonly activities: readonly AvailablePetActivity[];
  readonly availabilityReason: () => string | null;
  readonly play: (activity: AvailablePetActivity, generation: number) => void;
  readonly stop: (activity: AvailablePetActivity, generation: number) => void;
  readonly variation?: () => void;
}

interface ActiveActivity {
  readonly activity: AvailablePetActivity;
  readonly generation: number;
  readonly deadline: number;
  readonly carrier: PetActivityCarrier;
  started: boolean;
}

interface CarrierEntry {
  carrier: PetActivityCarrier;
  opportunityAt: number | null;
  active: ActiveActivity | null;
}

interface PetHistory {
  readonly playedAt: Map<string, number>;
  lastId: string | null;
}

/** One scheduler and at most one reservation per pet, independent of artwork format. */
export class PetActivityService {
  private readonly carriers = new Map<number, CarrierEntry>();
  private readonly history = new Map<string, PetHistory>();
  private generation = 0;

  constructor(private readonly options: {
    readonly now: () => number;
    readonly random: () => number;
    readonly enabledIds: (petId: string) => readonly string[];
    readonly onFailure: (petId: string, activityId: string, outfitId: string, revision: string) => void;
  }) {}

  register(carrier: PetActivityCarrier): void {
    const previous = this.carriers.get(carrier.id);
    if (
      previous
      && previous.carrier.petId === carrier.petId
      && previous.carrier.outfitId === carrier.outfitId
      && previous.carrier.revision === carrier.revision
    ) {
      previous.carrier = carrier;
      return;
    }
    if (previous) {
      this.cancel(carrier.id);
    }
    this.carriers.set(carrier.id, { carrier, active: null, opportunityAt: null });
  }

  remove(id: number): void {
    this.cancel(id);
    this.carriers.delete(id);
  }

  forgetPet(petId: string): void {
    for (const [id, entry] of this.carriers) {
      if (entry.carrier.petId === petId) {
        this.remove(id);
      }
    }
    this.history.delete(petId);
  }

  cancel(id: number): void {
    const entry = this.carriers.get(id);
    if (!entry) {
      return;
    }
    const active = entry.active;
    entry.active = null;
    entry.opportunityAt = null;
    if (active) {
      active.carrier.stop(active.activity, active.generation);
    }
  }

  cancelAll(): void {
    for (const id of this.carriers.keys()) {
      this.cancel(id);
    }
  }

  stop(): void {
    this.cancelAll();
    this.carriers.clear();
    this.history.clear();
  }

  getPlayingActivityId(petId: string): string | null {
    for (const entry of this.carriers.values()) {
      if (entry.carrier.petId === petId && entry.active) {
        return entry.active.activity.id;
      }
    }
    return null;
  }

  isCurrent(id: number, generation: number, activityId?: string): boolean {
    const active = this.carriers.get(id)?.active;
    return active?.generation === generation && (activityId === undefined || active.activity.id === activityId);
  }

  getAvailabilityReason(petId: string, windowId?: number): string | null {
    const entries = [...this.carriers.values()].filter((entry) => {
      return entry.carrier.petId === petId && (windowId === undefined || entry.carrier.id === windowId);
    });
    if (entries.length === 0) {
      return "Show this pet on the desktop to play an activity.";
    }
    if (this.getPlayingActivityId(petId)) {
      return "An activity is already playing.";
    }
    const reasons = entries.map((entry) => entry.carrier.availabilityReason());
    return reasons.some((reason) => reason === null) ? null : reasons[0] ?? null;
  }

  play(petId: string, activityId: string, windowId: number): void {
    const reason = this.getAvailabilityReason(petId, windowId);
    if (reason) {
      throw new Error(reason);
    }
    const entry = this.carriers.get(windowId);
    const activity = entry?.carrier.activities.find((candidate) => candidate.id === activityId);
    if (!entry || entry.carrier.petId !== petId || !activity) {
      throw new Error("This activity is unavailable for the current outfit.");
    }
    this.start(entry, activity);
  }

  result(id: number, generation: number, activityId: string, outcome: "started" | "completed" | "cancelled" | "failed"): void {
    const entry = this.carriers.get(id);
    const active = entry?.active;
    if (!entry || !active || active.generation !== generation || active.activity.id !== activityId) {
      return;
    }
    if (outcome === "started") {
      if (active.started) {
        return;
      }
      active.started = true;
      const history = this.getHistory(active.carrier.petId);
      history.lastId = activityId;
      history.playedAt.set(activityId, this.options.now());
      return;
    }
    entry.active = null;
    entry.opportunityAt = null;
    if (outcome === "failed") {
      this.fail(active);
    }
  }

  tick(): void {
    const now = this.options.now();
    for (const entry of this.carriers.values()) {
      if (entry.carrier.availabilityReason()) {
        this.cancel(entry.carrier.id);
        continue;
      }
      if (entry.active) {
        if (now >= entry.active.deadline) {
          const active = entry.active;
          this.cancel(entry.carrier.id);
          this.fail(active);
        }
        continue;
      }
      if (this.getPlayingActivityId(entry.carrier.petId)) {
        entry.opportunityAt = null;
        continue;
      }
      if (entry.opportunityAt === null) {
        entry.opportunityAt = now + nextActivityOpportunityMs(this.options.random);
      }
      if (now < entry.opportunityAt) {
        continue;
      }
      const history = this.getHistory(entry.carrier.petId);
      const activity = selectIdlePetActivity(
        entry.carrier.activities,
        this.options.enabledIds(entry.carrier.petId),
        history.playedAt,
        history.lastId,
        now,
        this.options.random,
      );
      if (activity) {
        this.start(entry, activity);
      } else {
        entry.opportunityAt = now + nextActivityOpportunityMs(this.options.random);
        entry.carrier.variation?.();
      }
    }
  }

  private getHistory(petId: string): PetHistory {
    let history = this.history.get(petId);
    if (!history) {
      history = { playedAt: new Map(), lastId: null };
      this.history.set(petId, history);
    }
    return history;
  }

  private fail(active: ActiveActivity): void {
    for (const entry of this.carriers.values()) {
      if (
        entry.carrier.petId === active.carrier.petId
        && entry.carrier.outfitId === active.carrier.outfitId
        && entry.carrier.failureRevision === active.carrier.failureRevision
      ) {
        entry.carrier = {
          ...entry.carrier,
          activities: entry.carrier.activities.filter((activity) => activity.id !== active.activity.id),
        };
      }
    }
    this.options.onFailure(active.carrier.petId, active.activity.id, active.carrier.outfitId, active.carrier.failureRevision);
  }

  private start(entry: CarrierEntry, activity: AvailablePetActivity): void {
    const generation = ++this.generation;
    entry.active = {
      activity,
      generation,
      deadline: this.options.now() + activity.durationMs + 5_000,
      carrier: entry.carrier,
      started: false,
    };
    entry.opportunityAt = null;
    entry.carrier.play(activity, generation);
  }
}
