import { app } from "electron";
import { spawn } from "node:child_process";

import {
  planLinuxBackendBootstrap,
  selectReplacementProcessMode,
  superviseReplacement,
  waitForReplacementBootstrap,
} from "./startup-backend-policy.js";

async function bootstrap(): Promise<void> {
  const plan = planLinuxBackendBootstrap(process.platform, process.argv, process.env);
  if (plan.action === "relaunch") {
    const executable = app.isPackaged && process.env.APPIMAGE ? process.env.APPIMAGE : process.execPath;
    const mode = selectReplacementProcessMode(app.isPackaged);
    const detach = mode === "detached";
    const child = spawn(executable, plan.args.slice(1), {
      detached: detach,
      stdio: detach ? ["ignore", "ignore", "ignore", "ipc"] : ["ignore", "inherit", "inherit", "ipc"],
    });

    await waitForReplacementBootstrap(child, () => child.kill());
    if (child.connected) child.disconnect();
    if (detach) {
      child.unref();
      app.exit(0);
      return;
    }

    const exitCode = await superviseReplacement(child, process);
    app.exit(exitCode);
    return;
  }

  await import("./main.js");
  await notifyParent({ type: "openpets-bootstrap-ready" });
}

await bootstrap().catch(async (error: unknown) => {
  console.error("OpenPets startup bootstrap failed; refusing to start with an unintended Linux display backend.", error);
  try {
    await notifyParent({
      type: "openpets-bootstrap-failed",
      message: error instanceof Error ? error.message : String(error),
    });
  } catch (notifyError) {
    console.error("Could not notify the original process about replacement startup failure.", notifyError);
  }
  app.exit(1);
});

type BootstrapHandoffMessage = { type: "openpets-bootstrap-ready" } | { type: "openpets-bootstrap-failed"; message: string };

function notifyParent(message: BootstrapHandoffMessage): Promise<void> {
  if (typeof process.send !== "function") return Promise.resolve();
  return new Promise((resolve, reject) => {
    process.send?.(message, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
