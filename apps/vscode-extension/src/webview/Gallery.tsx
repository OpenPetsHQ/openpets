import { useState } from "react";
import type { CatalogPetView } from "../protocol.js";
import { SpritePreview } from "./SpritePreview.js";

interface GalleryProps {
  searchQuery: string;
  catalogPage: number;
  catalogItems: readonly CatalogPetView[];
  catalogTotal: number;
  catalogPages: number;
  catalogLoading: boolean;
  catalogError: string;
  installingId: string | null;
  pending: boolean;
  onSearch(query: string): void;
  onPageChange(page: number): void;
  onAddPet(id: string): void;
  atCapacity: boolean;
  onInstallPet(id: string): void;
  onRetry(): void;
}

function CatalogPreview({ pet }: { pet: CatalogPetView }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="catalog-art">
      {failed || !pet.thumbnailUri ? (
        <SpritePreview sprite={pet.sprite} label={pet.displayName} />
      ) : (
        <img
          src={pet.thumbnailUri}
          alt={pet.displayName}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export function Gallery({
  searchQuery,
  catalogPage,
  catalogItems,
  catalogTotal,
  catalogPages,
  catalogLoading,
  catalogError,
  installingId,
  pending,
  onSearch,
  onPageChange,
  onAddPet,
  atCapacity,
  onInstallPet,
  onRetry,
}: GalleryProps) {
  return (
    <section className="collection-page" aria-label="Pet gallery">
      <div className="page-heading">
        <div>
          <h2>Find your companion</h2>
          <p className="muted">Install a pet, then choose when to use it.</p>
        </div>
      </div>
      {atCapacity && (
        <p className="muted small-text" role="status">
          Scene is full. Remove a companion to add another.
        </p>
      )}
      <div className="search-row">
        <label className="search-field">
          <svg className="search-mark" aria-hidden="true" viewBox="0 0 24 24">
            <path
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0m18 11l-6-6"
            />
          </svg>
          <input
            type="search"
            aria-label="Search pets"
            placeholder="Search pets"
            value={searchQuery}
            onChange={(event) => onSearch(event.target.value)}
          />
        </label>
        <span className="result-count" role="status">
          {catalogLoading
            ? "Loading…"
            : catalogError
              ? ""
              : `${catalogTotal} ${catalogTotal === 1 ? "pet" : "pets"}`}
        </span>
      </div>
      {catalogLoading && (
        <div className="loading-state" role="status">
          <span className="spinner" />
          Loading pets…
        </div>
      )}
      {catalogError && (
        <div className="inline-error" role="alert">
          <p>{catalogError}</p>
          <button className="button secondary" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {!catalogLoading && !catalogError && catalogItems.length === 0 && (
        <div className="empty-state">
          <h3>No pets found</h3>
          <p className="muted">Try another name or clear your search.</p>
          <button className="button secondary" onClick={() => onSearch("")}>
            Clear search
          </button>
        </div>
      )}
      {!catalogLoading && !catalogError && (
        <div className="catalog-grid">
          {catalogItems.map((pet) => (
            <article className="catalog-card" key={pet.id}>
              <CatalogPreview pet={pet} />
              <div className="catalog-detail">
                <h3>{pet.displayName}</h3>
                <p className="pet-description">{pet.description}</p>
                <div className="card-action">
                  <span className="muted">
                    {pet.installed
                      ? "Installed"
                      : pet.hasWardrobe
                        ? "Outfits available"
                        : ""}
                  </span>
                  <button
                    className={pet.installed ? "button secondary" : "button"}
                    disabled={
                      pending || (pet.installed ? atCapacity : !pet.canInstall)
                    }
                    onClick={() =>
                      pet.installed ? onAddPet(pet.id) : onInstallPet(pet.id)
                    }
                  >
                    {installingId === pet.id
                      ? "Installing…"
                      : pet.installed
                        ? "Add to scene"
                        : pet.canInstall
                          ? "Install"
                          : "Unavailable"}
                  </button>
                </div>
                {pet.unavailableReason && (
                  <p className="error-text small-text">
                    {pet.unavailableReason}
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {!catalogError && catalogPages > 1 && (
        <nav className="pagination" aria-label="Catalog pages">
          <button
            className="button secondary"
            disabled={catalogLoading || catalogPage <= 0}
            onClick={() => onPageChange(catalogPage - 1)}
          >
            Previous
          </button>
          <span>
            {catalogPage + 1} / {catalogPages}
          </span>
          <button
            className="button secondary"
            disabled={catalogLoading || catalogPage >= catalogPages - 1}
            onClick={() => onPageChange(catalogPage + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
