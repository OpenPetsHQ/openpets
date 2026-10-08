export interface ExternalUrlOpenerDependencies {
  readonly platform: NodeJS.Platform;
  readonly environment: NodeJS.ProcessEnv;
  readonly xdgOpenTimeoutMs: number;
  readonly openWithXdg: (url: string, environment: NodeJS.ProcessEnv, signal: AbortSignal) => Promise<void>;
  readonly openWithShell: (url: string) => Promise<void>;
  readonly onXdgFailure: (error: unknown) => void;
}

export class ExternalUrlLaunchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`xdg-open did not finish within ${timeoutMs}ms`);
    this.name = "ExternalUrlLaunchTimeoutError";
  }
}

export function createExternalUrlOpener(dependencies: ExternalUrlOpenerDependencies): (url: string) => Promise<void> {
  return async (url: string): Promise<void> => {
    if (dependencies.platform === "linux") {
      const browserEnvironment = { ...dependencies.environment };
      delete browserEnvironment.GDK_BACKEND;

      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          dependencies.openWithXdg(url, browserEnvironment, controller.signal),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              reject(new ExternalUrlLaunchTimeoutError(dependencies.xdgOpenTimeoutMs));
              controller.abort();
            }, dependencies.xdgOpenTimeoutMs);
          }),
        ]);
        return;
      } catch (error) {
        dependencies.onXdgFailure(error);
        if (error instanceof ExternalUrlLaunchTimeoutError) {
          // A timed-out launcher may already have opened the URL. Do not launch
          // it a second time through Electron's shell fallback.
          throw error;
        }
      } finally {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      }
    }

    await dependencies.openWithShell(url);
  };
}
