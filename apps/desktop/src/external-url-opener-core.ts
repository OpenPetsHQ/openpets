export interface ExternalUrlOpenerDependencies {
  readonly platform: NodeJS.Platform;
  readonly environment: NodeJS.ProcessEnv;
  readonly openWithXdg: (url: string, environment: NodeJS.ProcessEnv) => Promise<void>;
  readonly openWithShell: (url: string) => Promise<void>;
  readonly onXdgFailure: (error: unknown) => void;
}

export function createExternalUrlOpener(dependencies: ExternalUrlOpenerDependencies): (url: string) => Promise<void> {
  return async (url: string): Promise<void> => {
    if (dependencies.platform === "linux") {
      const browserEnvironment = { ...dependencies.environment };
      delete browserEnvironment.GDK_BACKEND;

      try {
        await dependencies.openWithXdg(url, browserEnvironment);
        return;
      } catch (error) {
        dependencies.onXdgFailure(error);
      }
    }

    await dependencies.openWithShell(url);
  };
}
