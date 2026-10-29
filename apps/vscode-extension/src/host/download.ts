import { defaultPetZipLimits } from "@open-pets/pet-format/node/archive";

export async function downloadPetZip(
  url: string,
  signal: AbortSignal,
  fetchImpl = fetch,
): Promise<Buffer> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Pet download timed out.")),
    30_000,
  );
  let response: Response | undefined;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "zip.openpets.dev" ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      !parsed.pathname.startsWith("/pets/")
    )
      throw new Error("Pet archive URL is not allowed.");
    response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
    });
    if (response.url !== url || !response.ok || !response.body)
      throw new Error("Pet archive download failed.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > defaultPetZipLimits.maxZipDownloadBytes)
          throw new Error("Pet archive is too large.");
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks, total);
  } catch (error) {
    controller.abort();
    if (response?.body && !response.body.locked)
      void response.body.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
