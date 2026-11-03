import { isAnnouncementId } from "./announcements-core.js";
import type { AnnouncementsService } from "./announcements-service.js";

type Event = { readonly sender: { readonly id: number } };
type Channel = "openpets:announcements-get" | "openpets:announcements-dismiss" | "openpets:announcements-open-link";
type Handler = (event: Event, ...args: unknown[]) => unknown | Promise<unknown>;

export function installControlCenterAnnouncementsIpcHandlers(options: {
  registerHandle: (channel: Channel, handler: Handler) => void;
  authorizeSender: (event: Event) => void;
  getService: () => AnnouncementsService;
}): void {
  options.registerHandle("openpets:announcements-get", (event) => {
    options.authorizeSender(event);
    return options.getService().get();
  });
  options.registerHandle("openpets:announcements-dismiss", (event, id) => {
    options.authorizeSender(event);
    if (!isAnnouncementId(id)) throw new Error("Invalid announcement ID.");
    return options.getService().dismiss(id);
  });
  options.registerHandle("openpets:announcements-open-link", (event, id) => {
    options.authorizeSender(event);
    if (!isAnnouncementId(id)) throw new Error("Invalid announcement ID.");
    return options.getService().openLink(id);
  });
}
