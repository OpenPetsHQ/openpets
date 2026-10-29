import { useEffect, useRef, useState } from "react";
import type {
  CatalogPetView,
  CompanionSnapshot,
  SurfaceState,
} from "../protocol.js";
import { CompanionRequestError, WebviewBackend } from "./backend.js";
import {
  acceptSnapshot,
  acceptSurface,
  projectCatalogInstallations,
} from "./view-state.js";
import { SceneStage } from "./SceneStage.js";
import { SceneControls } from "./SceneControls.js";
import { Gallery } from "./Gallery.js";
import { Wardrobe } from "./Wardrobe.js";

export function App({ backend }: { backend: WebviewBackend }) {
  const [savedUiState] = useState(() => backend.readUiState());
  const [snapshot, setSnapshot] = useState<CompanionSnapshot>();
  const [surface, setSurface] = useState<SurfaceState>();
  const [error, setError] = useState("");
  const [dismissedNoticeRevision, setDismissedNoticeRevision] =
    useState<number>();
  const notice =
    snapshot?.revision === dismissedNoticeRevision
      ? undefined
      : snapshot?.notice;
  const [activeTab, setActiveTab] = useState(savedUiState.activeTab);
  const [searchQuery, setSearchQuery] = useState(savedUiState.searchQuery);
  const [catalogPage, setCatalogPage] = useState(savedUiState.catalogPage);
  const [catalogItems, setCatalogItems] = useState<readonly CatalogPetView[]>(
    [],
  );
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogPages, setCatalogPages] = useState(1);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [wardrobeInstallingId, setWardrobeInstallingId] = useState<
    string | null
  >(null);
  const [pending, setPending] = useState(false);
  const [importing, setImporting] = useState(false);
  const [studioError, setStudioError] = useState("");
  const studioRetryRef = useRef<(() => void) | undefined>(undefined);
  const pendingRef = useRef(false);
  const aliveRef = useRef(true);
  const retryRef = useRef<(() => void) | undefined>(undefined);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const unknownOutcomeRef = useRef(false);
  const [catalogReload, setCatalogReload] = useState(0);

  useEffect(() => {
    let alive = true;
    aliveRef.current = true;
    const offSnapshot = backend.onSnapshot((next) => {
      if (!alive) return;
      setSnapshot((current) => acceptSnapshot(current, next));
    });
    const offSurface = backend.onSurface((next) => {
      if (!alive) return;
      setSurface((current) => acceptSurface(current, next));
    });
    void backend.ready().then(
      (ready) => {
        if (!alive) return;
        setSnapshot((current) => acceptSnapshot(current, ready.snapshot));
        setSurface((current) => acceptSurface(current, ready.surface));
      },
      (reason: unknown) => {
        if (alive)
          setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      alive = false;
      aliveRef.current = false;
      offSnapshot();
      offSurface();
      backend.dispose();
    };
  }, [backend]);

  useEffect(() => {
    backend.writeUiState({ activeTab, searchQuery, catalogPage });
  }, [backend, activeTab, searchQuery, catalogPage]);

  useEffect(() => {
    if (activeTab !== "gallery") return;
    let alive = true;
    setCatalogLoading(true);
    setCatalogError("");
    void backend.listCatalog(searchQuery, catalogPage).then(
      (listing) => {
        if (!alive) return;
        setCatalogItems(listing.pets);
        setCatalogPage(listing.page);
        setCatalogTotal(listing.total);
        setCatalogPages(listing.pageCount);
        setCatalogLoading(false);
      },
      (reason: unknown) => {
        if (!alive) return;
        setCatalogError(
          reason instanceof Error ? reason.message : String(reason),
        );
        setCatalogLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [backend, activeTab, searchQuery, catalogPage, catalogReload]);

  // Mutations share one admission gate; host snapshots remain the only saved truth.
  const run = (
    operation: () => Promise<CompanionSnapshot | void>,
    completed?: () => void,
  ) => {
    if (pendingRef.current || unknownOutcomeRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    setUnknownOutcome(false);
    retryRef.current = () => run(operation, completed);
    void operation()
      .then((next) => {
        if (!aliveRef.current) return;
        if (next) setSnapshot((current) => acceptSnapshot(current, next));
        completed?.();
      })
      .catch((reason: unknown) => {
        if (aliveRef.current) {
          const unknown =
            reason instanceof CompanionRequestError &&
            reason.outcome === "unknown";
          unknownOutcomeRef.current = unknown;
          setUnknownOutcome(unknown);
          setError(
            unknown
              ? "Result unknown. Refresh to check before retrying."
              : reason instanceof Error
                ? reason.message
                : String(reason),
          );
        }
      })
      .finally(() => {
        pendingRef.current = false;
        if (!aliveRef.current) return;
        setPending(false);
        setInstallingId(null);
        setWardrobeInstallingId(null);
        setImporting(false);
      });
  };

  if (!snapshot || !surface) {
    return (
      <div className="startup-state" role="status">
        <h1>OpenPets</h1>
        {error ? (
          <>
            <p className="error-text">{error}</p>
            <button className="button" onClick={() => window.location.reload()}>
              Retry connection
            </button>
          </>
        ) : (
          <>
            <span className="spinner" />
            <p>Loading your companion…</p>
          </>
        )}
      </div>
    );
  }

  const addPet = (id: string) => {
    const pet = snapshot.installedPets.find((item) => item.id === id);
    if (!pet) {
      retryRef.current = undefined;
      setError("This pet is no longer installed. Refresh and try again.");
      return;
    }
    run(
      () => backend.addInstance(id, pet.displayName),
      () => setActiveTab("companion"),
    );
  };
  const refresh = () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    void backend
      .ready()
      .then((ready) => {
        if (!aliveRef.current) return;
        setSnapshot((current) => acceptSnapshot(current, ready.snapshot));
        setSurface((current) => acceptSurface(current, ready.surface));
        setError("");
        unknownOutcomeRef.current = false;
        setUnknownOutcome(false);
      })
      .catch((reason: unknown) => {
        if (aliveRef.current)
          setError(
            `Refresh failed: ${reason instanceof Error ? reason.message : String(reason)}`,
          );
      })
      .finally(() => {
        pendingRef.current = false;
        if (aliveRef.current) setPending(false);
      });
  };
  const importPet = (targetPetId?: string) => {
    if (pendingRef.current || unknownOutcomeRef.current) return;
    setImporting(true);
    run(async () => {
      const result = await backend.importPetPackage(
        targetPetId ? { targetPetId } : {},
      );
      return result.status === "installed" ? result.snapshot : undefined;
    });
    retryRef.current = () => importPet(targetPetId);
  };
  const openStudio = (petId?: string) => {
    const retry = () => openStudio(petId);
    studioRetryRef.current = retry;
    setStudioError("");
    void backend.openStudio(petId ? { intent: "outfit", petId } : { intent: "pet" })
      .catch((reason: unknown) => {
        if (aliveRef.current) setStudioError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  return (
    <div className="openpets-app">
      <header className="app-header">
        <h1>OpenPets</h1>
        <span className="surface-label">
          {surface.kind === "view" ? "Companion" : "Pet space"}
        </span>
      </header>
      <nav className="app-tabs" aria-label="OpenPets">
        {(["companion", "gallery", "wardrobe"] as const).map((tab) => (
          <button
            key={tab}
            aria-current={activeTab === tab ? "page" : undefined}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "companion"
              ? "Companion"
              : tab === "gallery"
                ? "Gallery"
                : "Outfits"}
          </button>
        ))}
      </nav>
      {notice && (
        <div className="notice" role="status">
          <p>{notice}</p>
          <button
            className="text-button"
            aria-label="Dismiss notice"
            onClick={() => setDismissedNoticeRevision(snapshot.revision)}
          >
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="inline-error app-error" role="alert">
          <p>{error}</p>
          <div className="error-actions">
            <button
              className="button secondary"
              disabled={pending}
              onClick={() =>
                unknownOutcome || !retryRef.current
                  ? refresh()
                  : retryRef.current()
              }
            >
              {unknownOutcome || !retryRef.current ? "Refresh" : "Retry"}
            </button>
            <button
              className="text-button"
              disabled={unknownOutcome}
              onClick={() => setError("")}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {studioError && (
        <div className="inline-error app-error" role="alert">
          <p>Could not open Studio: {studioError}</p>
          <div className="error-actions">
            <button className="button secondary" onClick={() => studioRetryRef.current?.()}>Retry</button>
            <button className="text-button" onClick={() => setStudioError("")}>Dismiss</button>
          </div>
        </div>
      )}
      <main
        className={
          activeTab === "companion" ? "app-main companion-main" : "app-main"
        }
      >
        {activeTab === "companion" && (
          <section className="companion-page" aria-label="Your companion">
            <div className="companion-heading">
              <h2>Your companions</h2>
              <p className="muted">
                {unknownOutcome
                  ? "Refresh to interact with your companions."
                  : pending
                    ? "Please wait before interacting with your companions."
                    : "Click to interact. Drag to move."}
              </p>
            </div>
            <SceneStage
              instances={snapshot.instances}
              settings={snapshot.settings}
              selectedInstanceId={snapshot.selectedInstanceId}
              playbackEnabled={surface.playbackEnabled && surface.visible}
              canInteract={() =>
                !pendingRef.current && !unknownOutcomeRef.current && !pending && !unknownOutcome
              }
              onSelect={(id) => {
                if (id !== snapshot.selectedInstanceId)
                  run(() => backend.selectInstance(id));
              }}
            />
            <SceneControls
              snapshot={snapshot}
              pending={pending || unknownOutcome}
              onSelect={(id) => run(() => backend.selectInstance(id))}
              onRename={(id, name) =>
                run(() => backend.renameInstance(id, name))
              }
              onRemove={(id) => run(() => backend.removeInstance(id))}
              onAdd={addPet}
              onGallery={() => setActiveTab("gallery")}
              onSettings={(changes) =>
                run(() => backend.setSceneSettings(changes))
              }
            />
            <button
              className="button secondary surface-action"
              disabled={pending || unknownOutcome}
              onClick={() =>
                run(() =>
                  surface.kind === "view"
                    ? backend.openEditor()
                    : backend.showSidebar(),
                )
              }
            >
              {surface.kind === "view" ? "Open pet space" : "Show in sidebar"}
            </button>
          </section>
        )}
        {activeTab === "gallery" && (
          <Gallery
            searchQuery={searchQuery}
            catalogPage={catalogPage}
            catalogItems={projectCatalogInstallations(catalogItems, snapshot)}
            catalogTotal={catalogTotal}
            catalogPages={catalogPages}
            catalogLoading={catalogLoading}
            catalogError={catalogError}
            installingId={installingId}
            pending={pending || unknownOutcome}
            importing={importing}
            localPetIds={snapshot.installedPets
              .filter((pet) => pet.source === "local")
              .map((pet) => pet.id)}
            onCreatePet={() => openStudio()}
            onImportPet={() => importPet()}
            onSearch={(query) => {
              setSearchQuery(query);
              setCatalogPage(0);
            }}
            onPageChange={setCatalogPage}
            atCapacity={snapshot.instances.length >= 6}
            onAddPet={addPet}
            onInstallPet={(id) => {
              if (pendingRef.current) return;
              setInstallingId(id);
              run(
                () => backend.installPet(id),
                () => setCatalogReload((current) => current + 1),
              );
            }}
            onRetry={() => setCatalogReload((current) => current + 1)}
          />
        )}
        {activeTab === "wardrobe" && (
          <Wardrobe
            snapshot={snapshot}
            pending={pending || unknownOutcome}
            importing={importing}
            onGallery={() => setActiveTab("gallery")}
            onCreateOutfit={openStudio}
            onImportPet={importPet}
            wardrobeInstallingId={wardrobeInstallingId}
            onSelectInstance={(id) => run(() => backend.selectInstance(id))}
            onRefreshWardrobe={(id) => run(() => backend.refreshWardrobe(id))}
            onInstallWardrobe={(id) => {
              if (pendingRef.current) return;
              setWardrobeInstallingId(id);
              run(() => backend.installWardrobe(id));
            }}
            onSelectOutfit={(instanceId, outfitId) =>
              run(() => backend.setInstanceOutfit(instanceId, outfitId))
            }
          />
        )}
      </main>
    </div>
  );
}
