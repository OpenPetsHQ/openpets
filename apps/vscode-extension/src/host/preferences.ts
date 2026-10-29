import type { Memento } from "vscode";
import type { CompanionSize } from "../protocol.js";

export class Preferences {
  constructor(private readonly state: Memento) {}

  get size(): CompanionSize {
    const value = this.state.get<unknown>("openpets.size");
    return value === "small" || value === "large" ? value : "medium";
  }

  get selectedPetId(): string {
    const value = this.state.get<unknown>("openpets.selectedPetId");
    return typeof value === "string" && value.length > 0 ? value : "builtin";
  }

  outfit(petId: string): string {
    const value = this.state.get<unknown>(`openpets.outfit.${petId}`);
    return typeof value === "string" && value.length > 0 ? value : "default";
  }

  async setSize(size: CompanionSize): Promise<void> {
    await this.state.update("openpets.size", size);
  }
  async setPet(petId: string): Promise<void> {
    await this.state.update("openpets.selectedPetId", petId);
  }
  async setOutfit(petId: string, outfitId: string): Promise<void> {
    await this.state.update(`openpets.outfit.${petId}`, outfitId);
  }
}
