import { isAbsolute } from "node:path";

interface StorageUri {
  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;
}

/** Validate VS Code's documented native storage path against its storage URI. */
export function validateLocalStoragePath(
  uri: StorageUri,
  nativePath: string,
  nativeFileUriPath: string,
): string {
  if (
    (uri.scheme !== "file" && uri.scheme !== "vscode-userdata") ||
    uri.authority !== "" ||
    uri.query !== "" ||
    uri.fragment !== "" ||
    !isAbsolute(nativePath) ||
    uri.path !== nativeFileUriPath
  ) {
    throw new Error(
      `Unsupported global storage URI: scheme=${uri.scheme}, authority=${uri.authority || "(empty)"}. OpenPets requires local UI extension storage.`,
    );
  }
  return nativePath;
}
