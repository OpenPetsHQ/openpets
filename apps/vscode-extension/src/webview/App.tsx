import { useEffect, useRef, useState } from "react";
import type { CompanionSnapshot, SurfaceState } from "../protocol.js";
import { WebviewBackend } from "./backend.js";

export function App({ backend }: { backend: WebviewBackend }) {
  const [snapshot, setSnapshot] = useState<CompanionSnapshot>();
  const [surface, setSurface] = useState<SurfaceState>();
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const offSnapshot = backend.onSnapshot((next) =>
      setSnapshot((current) =>
        !current || next.revision > current.revision ? next : current,
      ),
    );
    const offSurface = backend.onSurface((next) =>
      setSurface((current) =>
        !current || next.sequence > current.sequence ? next : current,
      ),
    );
    void backend.ready().then(
      (ready) => {
        if (!alive) return;
        setSnapshot((current) =>
          !current || ready.snapshot.revision > current.revision
            ? ready.snapshot
            : current,
        );
        setSurface((current) =>
          !current || ready.surface.sequence > current.sequence
            ? ready.surface
            : current,
        );
      },
      (reason: unknown) => {
        if (alive) setError(String(reason));
      },
    );
    return () => {
      alive = false;
      offSnapshot();
      offSurface();
      backend.dispose();
    };
  }, [backend]);
  useEffect(() => {
    if (!snapshot || !surface?.playbackEnabled || !canvas.current) return;
    const target = canvas.current;
    const image = new Image();
    image.onload = () => {
      const context = target.getContext("2d");
      context?.drawImage(
        image,
        0,
        0,
        snapshot.active.sprite.layout.frameWidth,
        snapshot.active.sprite.layout.frameHeight,
        0,
        0,
        target.width,
        target.height,
      );
    };
    image.onerror = () => setError("Could not load the bundled companion.");
    image.src = snapshot.active.sprite.uri;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [snapshot, surface]);
  if (error) return <p>{error}</p>;
  if (!snapshot || !surface) return <p>Loading OpenPets…</p>;
  const scale =
    snapshot.size === "small" ? 0.5 : snapshot.size === "medium" ? 0.75 : 1;
  return (
    <main>
      <h1>OpenPets</h1>
      {snapshot.notice && <p>{snapshot.notice}</p>}
      {surface.playbackEnabled ? (
        <canvas
          ref={canvas}
          width={192 * scale}
          height={208 * scale}
          aria-label="Hoodie Cat"
        />
      ) : (
        <p>Companion is active in the editor pet space.</p>
      )}
      <p>Foundation preview: catalog and outfits are not yet available.</p>
      <label>
        Size{" "}
        <select
          value={snapshot.size}
          onChange={(event) => {
            const size = event.target.value;
            if (size === "small" || size === "medium" || size === "large")
              void backend
                .setSize(size)
                .catch((reason: unknown) => setError(String(reason)));
          }}
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </label>
      {surface.kind === "view" ? (
        <button
          onClick={() =>
            void backend
              .openEditor()
              .catch((reason: unknown) => setError(String(reason)))
          }
        >
          Open pet space
        </button>
      ) : (
        <button
          onClick={() =>
            void backend
              .showSidebar()
              .catch((reason: unknown) => setError(String(reason)))
          }
        >
          Show sidebar
        </button>
      )}
    </main>
  );
}
