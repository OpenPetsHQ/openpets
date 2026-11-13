// Coordinates reads and mutations for one mounted pet panel.
export class WardrobeRequests {
  private valid = true;
  private readGeneration = 0;
  private mutation: object | null = null;
  private refreshPending = false;

  invalidate(): void {
    this.valid = false;
    this.readGeneration++;
    this.mutation = null;
    this.refreshPending = false;
  }

  beginRead(): number | null {
    if (!this.valid) return null;
    if (this.mutation) {
      this.refreshPending = true;
      return null;
    }
    return ++this.readGeneration;
  }

  ownsRead(generation: number): boolean {
    return this.valid && this.mutation === null && generation === this.readGeneration;
  }

  beginMutation(): object | null {
    if (!this.valid || this.mutation) return null;
    this.readGeneration++;
    this.mutation = {};
    return this.mutation;
  }

  ownsMutation(token: object): boolean {
    return this.valid && this.mutation === token;
  }

  finishMutation(token: object): boolean {
    if (!this.ownsMutation(token)) return false;
    this.mutation = null;
    const refresh = this.refreshPending;
    this.refreshPending = false;
    return refresh;
  }
}
