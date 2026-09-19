export interface VoicePrivacyIndicatorSurface {
  show(): void;
  hide(): void;
  destroy(): void;
}

/** Tracks live microphone ownership and owns the optional host indicator surface. */
export class VoicePrivacyIndicator {
  readonly #createSurface: (() => VoicePrivacyIndicatorSurface) | null;
  #surface: VoicePrivacyIndicatorSurface | null = null;
  #liveTracks = 0;

  constructor(createSurface?: () => VoicePrivacyIndicatorSurface) {
    this.#createSurface = createSurface ?? null;
  }

  get liveTracks(): number {
    return this.#liveTracks;
  }

  trackStarted(): void {
    this.#liveTracks += 1;
    if (this.#liveTracks !== 1 || !this.#createSurface) return;
    try {
      this.#surface ??= this.#createSurface();
      this.#surface.show();
    } catch {
      const surface = this.#surface;
      this.#surface = null;
      try { surface?.destroy(); } catch { /* best effort */ }
    }
  }

  trackStopped(): void {
    if (this.#liveTracks === 0) return;
    this.#liveTracks -= 1;
    if (this.#liveTracks !== 0) return;
    try { this.#surface?.hide(); } catch { /* best effort */ }
  }

  shutdown(): void {
    this.#liveTracks = 0;
    const surface = this.#surface;
    this.#surface = null;
    try { surface?.destroy(); } catch { /* best effort */ }
  }
}
