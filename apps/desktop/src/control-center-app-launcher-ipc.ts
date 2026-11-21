import type { AppLauncherService } from "./app-launcher-service.js";

export interface ControlCenterAppLauncherIpcEvent {
  readonly sender: { readonly id: number };
}

export type ControlCenterAppLauncherIpcHandler = (
  event: ControlCenterAppLauncherIpcEvent,
  ...args: unknown[]
) => unknown | Promise<unknown>;

export interface ControlCenterAppLauncherIpcOptions {
  readonly registerHandle: (channel: string, handler: ControlCenterAppLauncherIpcHandler) => void;
  readonly authorizeSender: (event: ControlCenterAppLauncherIpcEvent) => void;
  readonly service: AppLauncherService;
  readonly pickTarget: (event: ControlCenterAppLauncherIpcEvent) => Promise<string | undefined>;
}

export function installControlCenterAppLauncherIpcHandlers(options: ControlCenterAppLauncherIpcOptions): void {
  options.registerHandle("openpets:app-launchers-get", (event) => {
    options.authorizeSender(event);
    return options.service.list();
  });

  options.registerHandle("openpets:app-launcher-add", async (event, name) => {
    options.authorizeSender(event);
    const targetPath = await options.pickTarget(event);
    if (targetPath !== undefined) await options.service.add(name, targetPath);
    return options.service.list();
  });

  options.registerHandle("openpets:app-launcher-rename", (event, id, name) => {
    options.authorizeSender(event);
    return options.service.rename(id, name);
  });

  options.registerHandle("openpets:app-launcher-change-target", async (event, id) => {
    options.authorizeSender(event);
    const targetPath = await options.pickTarget(event);
    if (targetPath !== undefined) await options.service.replaceTarget(id, targetPath);
    return options.service.list();
  });

  options.registerHandle("openpets:app-launcher-move", (event, id, direction) => {
    options.authorizeSender(event);
    return options.service.move(id, direction);
  });

  options.registerHandle("openpets:app-launcher-remove", (event, id) => {
    options.authorizeSender(event);
    return options.service.remove(id);
  });
}
