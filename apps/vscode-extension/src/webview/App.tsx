import { useEffect, useRef, useState } from "react";
import type {
  CatalogPetView,
  CompanionSnapshot,
  SurfaceState,
} from "../protocol.js";
import { WebviewBackend } from "./backend.js";
import { acceptSnapshot, acceptSurface, projectCatalogInstallations } from "./view-state.js";
import { CompanionStage } from "./CompanionStage.js";
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
  const pendingRef = useRef(false);
  const aliveRef = useRef(true);
  const retryRef = useRef<(() => void) | undefined>(undefined);
  const [dragOffset, setDragOffset] = useState(savedUiState.dragOffset);
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
    backend.writeUiState({ activeTab, searchQuery, catalogPage, dragOffset });
  }, [backend, activeTab, searchQuery, catalogPage, dragOffset]);

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
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    retryRef.current = () => run(operation, completed);
    void operation()
      .then((next) => {
        if (!aliveRef.current) return;
        if (next) setSnapshot((current) => acceptSnapshot(current, next));
        completed?.();
      })
      .catch((reason: unknown) => {
        if (aliveRef.current)
          setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        pendingRef.current = false;
        if (!aliveRef.current) return;
        setPending(false);
        setInstallingId(null);
        setWardrobeInstallingId(null);
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

  const currentPet = snapshot.installedPets.find(
    (pet) => pet.id === snapshot.active.petId,
  );
  const currentOutfit = currentPet?.outfits.find(
    (outfit) => outfit.id === snapshot.active.outfitId,
  );

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
              onClick={() => retryRef.current?.()}
            >
              Retry
            </button>
            <button className="text-button" onClick={() => setError("")}>
              Dismiss
            </button>
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
              <h2>{currentPet?.displayName ?? "Your companion"}</h2>
              <p className="muted">Click to interact. Drag to move.</p>
            </div>
            <CompanionStage
              sprite={snapshot.active.sprite}
              size={snapshot.size}
              enabled={surface.playbackEnabled && surface.visible}
              petName={currentPet?.displayName ?? "Companion"}
              outfitName={currentOutfit?.displayName}
              initialPosition={dragOffset}
              onPositionChange={setDragOffset}
              onShowSidebar={
                surface.kind === "view"
                  ? () => run(() => backend.showSidebar())
                  : undefined
              }
            />
            <footer className="companion-controls">
              <div className="size-control">
                <span className="control-label">Size</span>
                <div className="segmented" aria-label="Companion size">
                  {(["small", "medium", "large"] as const).map((size) => (
                    <button
                      key={size}
                      aria-pressed={snapshot.size === size}
                      disabled={pending}
                      onClick={() => run(() => backend.setSize(size))}
                    >
                      {size === "small" ? "S" : size === "medium" ? "M" : "L"}
                      <span className="sr-only"> — {size}</span>
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="button secondary surface-action"
                disabled={pending}
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
            </footer>
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
            pending={pending}
            onSearch={(query) => {
              setSearchQuery(query);
              setCatalogPage(0);
            }}
            onPageChange={setCatalogPage}
            onSelectPet={(id) =>
              run(
                () => backend.selectPet(id),
                () => setActiveTab("companion"),
              )
            }
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
            pending={pending}
            wardrobeInstallingId={wardrobeInstallingId}
            onSelectPet={(id) => run(() => backend.selectPet(id))}
            onInstallWardrobe={(id) => {
              if (pendingRef.current) return;
              setWardrobeInstallingId(id);
              run(() => backend.installWardrobe(id));
            }}
            onSelectOutfit={(petId, outfitId) =>
              run(async () => {
                const next = await backend.selectOutfit(petId, outfitId);
                if (!aliveRef.current) return;
                setSnapshot((current) => acceptSnapshot(current, next));
                if (next.active.petId === petId) return next;
                return backend.selectPet(petId);
              })
            }
          />
        )}
      </main>
    </div>
  );
}
