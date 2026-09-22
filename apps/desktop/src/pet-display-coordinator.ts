export type DisplayChangeReason = "display-added" | "display-removed" | "display-metrics-changed";

export interface PetDisplayEventSource<Display> {
  on(event: DisplayChangeReason, listener: (event: unknown, display: Display) => void): void;
  removeListener(event: DisplayChangeReason, listener: (event: unknown, display: Display) => void): void;
}

export interface PetPowerEventSource {
  on(event: "resume", listener: () => void): void;
  removeListener(event: "resume", listener: () => void): void;
}

type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface PetDisplayCoordinatorTimers {
  readonly setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  readonly clearTimeout: (timer: TimerHandle) => void;
}

export interface PetDisplayCoordinatorOptions<Display> {
  readonly displaySource: PetDisplayEventSource<Display>;
  readonly powerSource: PetPowerEventSource;
  readonly invalidateDisplayCache: () => void;
  readonly reclampDefaultPetWindow: (reason: DisplayChangeReason, changedDisplay?: Display) => void;
  readonly reclampAgentPetWindows: (reason: DisplayChangeReason) => void;
  readonly reclampLanVisitingPetWindows: () => void;
  readonly reclampPluginPetWindows: (reason: DisplayChangeReason) => void;
  readonly recoverDefaultPetMouseInterop: (reason: string) => void;
  readonly timers?: PetDisplayCoordinatorTimers;
}

const displayChangeReasons: readonly DisplayChangeReason[] = [
  "display-added",
  "display-removed",
  "display-metrics-changed",
];

const realTimers: PetDisplayCoordinatorTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

/** Coordinates native display/power events without owning any Electron runtime dependency. */
export class PetDisplayCoordinator<Display> {
  private readonly options: PetDisplayCoordinatorOptions<Display>;
  private readonly timers: PetDisplayCoordinatorTimers;
  private readonly displayListeners = new Map<DisplayChangeReason, (event: unknown, display: Display) => void>();
  private readonly displayTimers = new Map<DisplayChangeReason, TimerHandle>();
  private readonly latestDisplays = new Map<DisplayChangeReason, Display>();
  private readonly resumeTimers = new Set<TimerHandle>();
  private started = false;
  private readonly resumeListener = (): void => {
    if (!this.started) return;

    this.options.recoverDefaultPetMouseInterop("power-resume");

    let timer: TimerHandle;
    timer = this.timers.setTimeout(() => {
      if (!this.started || !this.resumeTimers.delete(timer)) return;
      this.options.recoverDefaultPetMouseInterop("power-resume+500ms");
    }, 500);
    this.resumeTimers.add(timer);
    if (typeof timer !== "number") timer.unref?.();
  };

  public constructor(options: PetDisplayCoordinatorOptions<Display>) {
    this.options = options;
    this.timers = options.timers ?? realTimers;
    for (const reason of displayChangeReasons) {
      this.displayListeners.set(reason, (_event, display) => this.handleDisplayChange(reason, display));
    }
  }

  public start(): void {
    if (this.started) return;
    this.started = true;
    for (const reason of displayChangeReasons) {
      this.options.displaySource.on(reason, this.displayListeners.get(reason)!);
    }
    this.options.powerSource.on("resume", this.resumeListener);
  }

  public stop(): void {
    if (!this.started) return;
    this.started = false;
    for (const reason of displayChangeReasons) {
      this.options.displaySource.removeListener(reason, this.displayListeners.get(reason)!);
      const timer = this.displayTimers.get(reason);
      if (timer !== undefined) this.timers.clearTimeout(timer);
    }
    this.options.powerSource.removeListener("resume", this.resumeListener);
    this.displayTimers.clear();
    this.latestDisplays.clear();
    this.clearResumeTimers();
  }

  private handleDisplayChange(reason: DisplayChangeReason, display: Display): void {
    if (!this.started) return;
    this.latestDisplays.set(reason, display);
    this.options.invalidateDisplayCache();

    const existingTimer = this.displayTimers.get(reason);
    if (existingTimer !== undefined) this.timers.clearTimeout(existingTimer);

    let timer: TimerHandle;
    timer = this.timers.setTimeout(() => {
      if (!this.started || this.displayTimers.get(reason) !== timer) return;
      this.displayTimers.delete(reason);
      const latestDisplay = this.latestDisplays.get(reason);
      this.latestDisplays.delete(reason);
      this.fanoutDisplayChange(reason, latestDisplay);
    }, 200);
    this.displayTimers.set(reason, timer);
  }

  private fanoutDisplayChange(reason: DisplayChangeReason, changedDisplay: Display | undefined): void {
    this.options.reclampDefaultPetWindow(reason, changedDisplay);
    this.options.reclampAgentPetWindows(reason);
    this.options.reclampLanVisitingPetWindows();
    this.options.reclampPluginPetWindows(reason);
  }

  private clearResumeTimers(): void {
    for (const timer of this.resumeTimers) this.timers.clearTimeout(timer);
    this.resumeTimers.clear();
  }
}
