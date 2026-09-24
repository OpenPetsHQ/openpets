import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import {
  planLinuxBackendBootstrap,
  readOzonePlatformSwitch,
  selectReplacementProcessMode,
  superviseReplacement,
  waitForReplacementBootstrap,
} from "../src/startup-backend-policy.js";

const executable = "/Applications/OpenPets App/electron";
const appPath = "/Applications/OpenPets App/resources/app.asar";

describe("replacement process mode", () => {
  it("supervises unpackaged launches, including SSH development, and detaches packaged launches", () => {
    assert.equal(selectReplacementProcessMode(false), "supervised");
    assert.equal(selectReplacementProcessMode(true), "detached");
  });
});

describe("early Linux backend bootstrap policy", () => {
  it("forces X11 while preserving packaged app arguments and deep links", () => {
    const argv = [executable, appPath, "openpets://teams/enroll?intent=abc", "--trace-warnings"];
    const plan = planLinuxBackendBootstrap("linux", argv, {});

    assert.deepEqual(plan, {
      action: "relaunch",
      args: [executable, appPath, "openpets://teams/enroll?intent=abc", "--trace-warnings", "--ozone-platform=x11"],
      backend: "x11",
      reason: "positioning-default",
    });
  });

  it("does not relaunch if the original invocation already requests X11", () => {
    const argv = [executable, appPath, "--ozone-platform=x11"];
    assert.deepEqual(planLinuxBackendBootstrap("linux", argv, {}), {
      action: "launch",
      args: argv,
      backend: "x11",
      reason: "positioning-default-already-effective",
    });
  });

  it("replaces conflicting and repeated Ozone switches with exactly one X11 switch", () => {
    const argv = [executable, appPath, "--ozone-platform", "wayland", "--ozone-platform=auto", "--ozone-platform=x11", "--verbose"];
    const plan = planLinuxBackendBootstrap("linux", argv, {});
    assert.equal(plan.action, "relaunch");
    assert.deepEqual(plan.args, [executable, appPath, "--ozone-platform=x11", "--verbose"]);
  });

  it("normalizes only Electron options before the separator", () => {
    const argv = [executable, appPath, "--", "--ozone-platform=wayland", "payload with spaces"];
    const plan = planLinuxBackendBootstrap("linux", argv, {});
    assert.deepEqual(plan.args, [executable, appPath, "--ozone-platform=x11", "--", "--ozone-platform=wayland", "payload with spaces"]);
    assert.equal(readOzonePlatformSwitch(argv), null);
  });

  it("honors the explicit Wayland opt-out without changing the invocation", () => {
    const argv = [executable, appPath, "--ozone-platform=wayland"];
    assert.deepEqual(planLinuxBackendBootstrap("linux", argv, { OPENPETS_ALLOW_WAYLAND: "1" }), {
      action: "launch",
      args: argv,
      backend: "wayland",
      reason: "wayland-opt-out",
    });
    assert.equal(planLinuxBackendBootstrap("linux", [executable, appPath], { OPENPETS_ALLOW_WAYLAND: "1" }).action, "launch");
  });

  it("forces native Wayland early for layer-shell mode unless Ozone was explicit", () => {
    const argv = [executable, appPath];
    assert.deepEqual(planLinuxBackendBootstrap("linux", argv, { OPENPETS_NATIVE_WAYLAND: "1" }), {
      action: "relaunch",
      args: [executable, appPath, "--ozone-platform=wayland"],
      backend: "wayland",
      reason: "layer-shell-default",
    });

    const explicitArgv = [executable, appPath, "--ozone-platform=x11"];
    assert.deepEqual(planLinuxBackendBootstrap("linux", explicitArgv, { OPENPETS_NATIVE_WAYLAND: "1" }), {
      action: "launch",
      args: explicitArgv,
      backend: "system",
      reason: "layer-shell-explicit-ozone",
    });
  });

  it("makes normalized relaunch arguments idempotent", () => {
    const first = planLinuxBackendBootstrap("linux", [executable, appPath, "--ozone-platform=wayland"], {});
    assert.equal(first.action, "relaunch");
    const second = planLinuxBackendBootstrap("linux", first.args, {});
    assert.equal(second.action, "launch");
    assert.deepEqual(second.args, first.args);
  });

  it("leaves non-Linux invocations unchanged", () => {
    const argv = [executable, appPath, "--ozone-platform=wayland"];
    assert.deepEqual(planLinuxBackendBootstrap("darwin", argv, {}), {
      action: "launch",
      args: argv,
      backend: "system",
      reason: "non-linux",
    });
  });
});

describe("replacement bootstrap handoff", () => {
  it("keeps a ready replacement alive and cleans up handoff listeners", async () => {
    const child = new EventEmitter();
    let terminated = false;
    const handoff = waitForReplacementBootstrap(child, () => { terminated = true; }, 100);

    child.emit("spawn");
    child.emit("message", { type: "openpets-bootstrap-ready" });
    await handoff;

    assert.equal(terminated, false);
    assert.equal(child.listenerCount("message"), 0);
    assert.equal(child.listenerCount("disconnect"), 0);
  });

  it("terminates a replacement that never acknowledges startup", async () => {
    const child = new EventEmitter();
    let terminated = false;
    const handoff = waitForReplacementBootstrap(child, () => { terminated = true; }, 5);

    await assert.rejects(handoff, /timed out/);
    assert.equal(terminated, true);
    assert.equal(child.listenerCount("message"), 0);
  });

  it("terminates on premature IPC disconnect or process exit", async () => {
    for (const failure of ["disconnect", "exit"] as const) {
      const child = new EventEmitter();
      let terminated = false;
      const handoff = waitForReplacementBootstrap(child, () => { terminated = true; }, 100);
      if (failure === "disconnect") child.emit("disconnect");
      else child.emit("exit", 1, null);
      await assert.rejects(handoff);
      assert.equal(terminated, true);
      assert.equal(child.listenerCount("message"), 0);
    }
  });
});

describe("attached replacement supervision", () => {
  it("forwards parent termination and propagates the child exit code", async () => {
    class FakeChild extends EventEmitter {
      readonly signals: NodeJS.Signals[] = [];

      kill(signal?: NodeJS.Signals): boolean {
        if (signal) this.signals.push(signal);
        return true;
      }
    }

    const child = new FakeChild();
    const parent = new EventEmitter();
    const exit = superviseReplacement(child, parent);

    parent.emit("SIGINT");
    parent.emit("SIGTERM");
    assert.deepEqual(child.signals, ["SIGINT", "SIGTERM"]);

    child.emit("exit", 7, null);
    assert.equal(await exit, 7);
    assert.equal(parent.listenerCount("SIGINT"), 0);
    assert.equal(parent.listenerCount("SIGTERM"), 0);
    assert.equal(child.listenerCount("exit"), 0);
  });

  it("uses a failing exit status when the replacement exits by signal", async () => {
    class FakeChild extends EventEmitter {
      kill(): boolean {
        return true;
      }
    }

    const child = new FakeChild();
    const exit = superviseReplacement(child, new EventEmitter());
    child.emit("exit", null, "SIGTERM");
    assert.equal(await exit, 1);
  });
});
