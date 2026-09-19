/** Tracks live microphone ownership without creating a renderer or Electron window. */
export class VoicePrivacyIndicator {
  #liveTracks = 0;

  get liveTracks(): number {
    return this.#liveTracks;
  }

  trackStarted(): void {
    this.#liveTracks += 1;
  }

  trackStopped(): void {
    if (this.#liveTracks === 0) return;
    this.#liveTracks -= 1;
  }

  shutdown(): void {
    this.#liveTracks = 0;
  }
}
