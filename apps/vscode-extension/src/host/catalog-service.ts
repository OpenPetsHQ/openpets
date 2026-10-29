import {
  createCatalogV3Client,
  isCuratedCatalogPet,
  type CatalogV3Client,
} from "@open-pets/pet-format/catalog-v3";
import type { CatalogPetV3 } from "@open-pets/pet-format/catalog-validation";
import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import type { HostListing } from "./companion-service.js";

// Package features, not the extension release version.
export const supportedPetPackageVersion = "4.1.0";

export function compatibilityProblem(pet: CatalogPetV3): string | undefined {
  if (!pet.minOpenPetsVersion) return;
  const required = pet.minOpenPetsVersion.split(".").map(Number);
  const supported = supportedPetPackageVersion.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (required[index] > supported[index])
      return `Requires pet package compatibility ${pet.minOpenPetsVersion}.`;
    if (required[index] < supported[index]) return;
  }
}

export class CatalogService {
  private readonly client: CatalogV3Client;
  private readonly injected: boolean;
  private readonly known = new Map<string, CatalogPetV3>();
  constructor(signal: AbortSignal, client?: CatalogV3Client) {
    this.client = client ?? createCatalogV3Client({ signal });
    this.injected = client !== undefined;
  }
  knownPet(id: string): CatalogPetV3 | undefined {
    return this.known.get(id);
  }
  async find(id: string, signal?: AbortSignal): Promise<CatalogPetV3> {
    signal?.throwIfAborted();
    const client =
      signal && !this.injected
        ? createCatalogV3Client({ signal })
        : this.client;
    const index = await client.getIndex();
    const hit = (await client.getSearch(index)).find(
      (pet) => pet.id === id && isCuratedCatalogPet(pet),
    );
    if (!hit) throw new Error("Pet is not available in the catalog.");
    const pet = (await client.getPage(hit.catalogPage, index)).find(
      (entry) => entry.id === id && isCuratedCatalogPet(entry),
    );
    if (!pet) throw new Error("Catalog entry could not be loaded.");
    signal?.throwIfAborted();
    this.known.set(id, pet);
    return pet;
  }
  async list(
    query: string,
    page: number,
    installed: ReadonlySet<string>,
  ): Promise<HostListing> {
    const index = await this.client.getIndex();
    const normalized = query.trim().toLocaleLowerCase();
    const hits = (await this.client.getSearch(index)).filter(
      (pet) =>
        isCuratedCatalogPet(pet) &&
        (!normalized ||
          `${pet.displayName} ${pet.searchText}`
            .toLocaleLowerCase()
            .includes(normalized)),
    );
    const pageSize = 24 as const;
    const total = hits.length;
    const pageCount = Math.ceil(total / pageSize);
    const current = pageCount ? Math.min(page, pageCount - 1) : 0;
    const selected = hits.slice(current * pageSize, (current + 1) * pageSize);
    const pageNumbers = [...new Set(selected.map((hit) => hit.catalogPage))];
    const pages = await Promise.all(
      pageNumbers.map((number) => this.client.getPage(number, index)),
    );
    const byPage = new Map(
      pageNumbers.map((number, position) => [number, pages[position]]),
    );
    const pets = selected.map((hit) => {
      const pet = byPage
        .get(hit.catalogPage)
        ?.find((entry) => entry.id === hit.id && isCuratedCatalogPet(entry));
      if (!pet) throw new Error(`Catalog entry ${hit.id} could not be loaded.`);
      this.known.set(pet.id, pet);
      const unavailableReason = compatibilityProblem(pet);
      return {
        id: pet.id,
        displayName: pet.displayName,
        description: pet.description,
        thumbnailUri: { kind: "remote" as const, url: pet.thumbnail },
        sprite: {
          uri: { kind: "remote" as const, url: pet.spritesheet },
          layout: getPetSpriteLayout(pet),
        },
        category: pet.category,
        original: pet.original === true,
        featured: pet.featured === true,
        installed: installed.has(pet.id),
        hasWardrobe: Boolean(pet.wardrobeZip),
        canInstall: !unavailableReason,
        ...(unavailableReason ? { unavailableReason } : {}),
      };
    });
    return { query, page: current, pageSize, total, pageCount, pets };
  }
}
