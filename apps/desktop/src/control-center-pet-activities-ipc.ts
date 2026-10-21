import type { PetActivitiesSnapshot } from "./pet-activities-types.js";

type Event = { readonly sender: { readonly id: number } };
type Channel = "openpets:get-pet-activities" | "openpets:set-pet-activity-enabled" | "openpets:play-pet-activity";

export function installControlCenterPetActivitiesIpcHandlers(options: {
  readonly registerHandle: (channel: Channel, handler: (event: Event, payload: unknown) => Promise<PetActivitiesSnapshot>) => void;
  readonly authorizeSender: (event: Event) => void;
  readonly getPetActivities: (petId: string) => Promise<PetActivitiesSnapshot>;
  readonly setPetActivityEnabled: (petId: string, activityId: string, enabled: boolean) => Promise<PetActivitiesSnapshot>;
  readonly playPetActivity: (petId: string, activityId: string) => Promise<PetActivitiesSnapshot>;
}): void {
  options.registerHandle("openpets:get-pet-activities", async (event, petId) => {
    options.authorizeSender(event);
    if (typeof petId !== "string") throw new Error("Invalid pet id.");
    return options.getPetActivities(petId);
  });
  options.registerHandle("openpets:set-pet-activity-enabled", async (event, payload) => {
    options.authorizeSender(event);
    const { petId, activityId, enabled } = parseActivityRequest(payload);
    if (typeof enabled !== "boolean") throw new Error("Invalid activity preference.");
    return options.setPetActivityEnabled(petId, activityId, enabled);
  });
  options.registerHandle("openpets:play-pet-activity", async (event, payload) => {
    options.authorizeSender(event);
    const { petId, activityId } = parseActivityRequest(payload);
    return options.playPetActivity(petId, activityId);
  });
}

function parseActivityRequest(payload: unknown): { readonly petId: string; readonly activityId: string; readonly enabled: unknown } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error("Invalid activity request.");
  const { petId, activityId, enabled } = payload as Record<string, unknown>;
  if (typeof petId !== "string" || typeof activityId !== "string") throw new Error("Invalid pet activity id.");
  return { petId, activityId, enabled };
}
