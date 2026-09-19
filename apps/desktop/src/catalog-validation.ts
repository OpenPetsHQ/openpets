export interface CatalogV2 {
  readonly version: 2;
  readonly generatedAt: string;
  readonly pets: readonly CatalogPetV2[];
}

export interface CatalogPetV2 {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly preview: string;
  readonly zip: string;
  readonly spritesheet?: string;
  readonly category?: "western" | "asian";
  readonly subcategory?: string;
  readonly original?: boolean;
  readonly featured?: boolean;
  readonly spriteVersionNumber?: 2;
}

export interface CatalogV3Index {
  readonly version: 3;
  readonly generatedAt: string;
  readonly total: number;
  readonly pageSize: number;
  readonly search: string;
  readonly filters: {
    readonly categories: readonly CatalogV3Category[];
    readonly originalsCount?: number;
    readonly featuredCount?: number;
  };
  readonly pages: readonly string[];
}

export interface CatalogV3Category {
  readonly id: "western" | "asian";
  readonly label: string;
  readonly count: number;
}

export interface CatalogV3Page {
  readonly version: 3;
  readonly page: number;
  readonly pageSize: number;
  readonly pets: readonly CatalogPetV3[];
}

export interface CatalogV3SearchIndex {
  readonly version: 3;
  readonly generatedAt: string;
  readonly total: number;
  readonly pageSize: number;
  readonly pages: readonly string[];
}

export interface CatalogV3SearchPage {
  readonly version: 3;
  readonly page: number;
  readonly pageSize: number;
  readonly pets: readonly CatalogV3SearchPet[];
}

export interface CatalogV3SearchPet {
  readonly id: string;
  readonly displayName: string;
  readonly searchText: string;
  readonly category: "western" | "asian";
  readonly catalogPage: number;
  readonly original?: boolean;
  readonly featured?: boolean;
  readonly spriteVersionNumber?: 2;
}

export interface CatalogPetV3 {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly thumbnail: string;
  readonly spritesheet: string;
  readonly zip: string;
  readonly category: "western" | "asian";
  readonly subcategory?: string;
  readonly original?: boolean;
  readonly featured?: boolean;
  readonly spriteVersionNumber?: 2;
}

export function validateCatalogV2(value: unknown): CatalogV2 {
  if (!isRecord(value)) throw new Error("Catalog must be an object.");
  if (value.version !== 2) throw new Error("Catalog version must be 2.");
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) throw new Error("Catalog generatedAt must be a valid date string.");
  if (!Array.isArray(value.pets)) throw new Error("Catalog pets must be an array.");
  if (value.pets.length > 1000) throw new Error("Catalog has too many pets.");

  const ids = new Set<string>();
  const pets = value.pets.map((pet) => validateCatalogPet(pet, ids));

  return {
    version: 2,
    generatedAt: value.generatedAt,
    pets,
  };
}

export function validateCatalogV3Index(value: unknown): CatalogV3Index {
  if (!isRecord(value)) throw new Error("Catalog v3 index must be an object.");
  if (value.version !== 3) throw new Error("Catalog v3 index version must be 3.");
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) throw new Error("Catalog v3 generatedAt must be a valid date string.");
  const total = validateInteger(value.total, "Catalog v3 total", 0, 10_000);
  const pageSize = validateInteger(value.pageSize, "Catalog v3 pageSize", 1, 500);
  const search = validateCatalogUrl(value.search, "catalog");
  if (!isRecord(value.filters) || !Array.isArray(value.filters.categories)) throw new Error("Catalog v3 filters are invalid.");
  const categories = value.filters.categories.map(validateCatalogV3Category);
  if (!Array.isArray(value.pages)) throw new Error("Catalog v3 pages must be an array.");
  const expectedPages = Math.ceil(total / pageSize);
  if (value.pages.length !== expectedPages) throw new Error("Catalog v3 page count does not match total.");
  const pages = value.pages.map((page) => validateCatalogUrl(page, "catalog"));

  return {
    version: 3,
    generatedAt: value.generatedAt,
    total,
    pageSize,
    search,
    filters: {
      categories,
      ...(value.filters.originalsCount === undefined ? {} : { originalsCount: validateCount(value.filters.originalsCount) }),
      ...(value.filters.featuredCount === undefined ? {} : { featuredCount: validateCount(value.filters.featuredCount) }),
    },
    pages,
  };
}

export function validateCatalogV3Page(value: unknown, expectedPage: number): CatalogV3Page {
  if (!isRecord(value)) throw new Error("Catalog v3 page must be an object.");
  if (value.version !== 3) throw new Error("Catalog v3 page version must be 3.");
  if (value.page !== expectedPage) throw new Error("Catalog v3 page index mismatch.");
  const pageSize = validateInteger(value.pageSize, "Catalog v3 pageSize", 1, 500);
  if (!Array.isArray(value.pets)) throw new Error("Catalog v3 pets must be an array.");
  if (value.pets.length > pageSize) throw new Error("Catalog v3 page has too many pets.");
  const ids = new Set<string>();
  const pets = value.pets.map((pet) => validateCatalogV3Pet(pet, ids));

  return {
    version: 3,
    page: expectedPage,
    pageSize,
    pets,
  };
}

export function validateCatalogV3SearchIndex(value: unknown): CatalogV3SearchIndex {
  if (!isRecord(value)) throw new Error("Catalog v3 search index must be an object.");
  if (value.version !== 3) throw new Error("Catalog v3 search index version must be 3.");
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) throw new Error("Catalog v3 search generatedAt must be a valid date string.");
  const total = validateInteger(value.total, "Catalog v3 search total", 0, 10_000);
  const pageSize = validateInteger(value.pageSize, "Catalog v3 search pageSize", 1, 1000);
  if (!Array.isArray(value.pages)) throw new Error("Catalog v3 search pages must be an array.");
  const expectedPages = Math.ceil(total / pageSize);
  if (value.pages.length !== expectedPages) throw new Error("Catalog v3 search page count does not match total.");
  return {
    version: 3,
    generatedAt: value.generatedAt,
    total,
    pageSize,
    pages: value.pages.map((page) => validateCatalogUrl(page, "catalog")),
  };
}

export function validateCatalogV3SearchPage(value: unknown, expectedPage: number, catalogPageCount: number): CatalogV3SearchPage {
  if (!isRecord(value)) throw new Error("Catalog v3 search page must be an object.");
  if (value.version !== 3) throw new Error("Catalog v3 search page version must be 3.");
  if (value.page !== expectedPage) throw new Error("Catalog v3 search page index mismatch.");
  const pageSize = validateInteger(value.pageSize, "Catalog v3 search pageSize", 1, 1000);
  if (!Array.isArray(value.pets)) throw new Error("Catalog v3 search pets must be an array.");
  if (value.pets.length > pageSize) throw new Error("Catalog v3 search page has too many pets.");
  return {
    version: 3,
    page: expectedPage,
    pageSize,
    pets: value.pets.map((pet) => validateCatalogV3SearchPet(pet, catalogPageCount)),
  };
}

function validateCatalogPet(value: unknown, ids: Set<string>): CatalogPetV2 {
  if (!isRecord(value)) throw new Error("Catalog pet must be an object.");
  const id = validateId(value.id);

  if (ids.has(id)) throw new Error(`Duplicate catalog pet id: ${id}`);
  ids.add(id);

  return {
    id,
    displayName: validateString(value.displayName, "displayName", 120),
    description: validateString(value.description, "description", 500),
    preview: validateCatalogUrl(value.preview, "preview"),
    zip: validateCatalogUrl(value.zip, "zip"),
    ...(value.spriteVersionNumber === undefined ? {} : { spriteVersionNumber: validateSpriteVersionNumber(value.spriteVersionNumber) }),
  };
}

function validateCatalogV3Pet(value: unknown, ids: Set<string>): CatalogPetV3 {
  if (!isRecord(value)) throw new Error("Catalog v3 pet must be an object.");
  const id = validateId(value.id);
  if (ids.has(id)) throw new Error(`Duplicate catalog v3 pet id on page: ${id}`);
  ids.add(id);
  const category = validateCategory(value.category);
  const entry: CatalogPetV3 = {
    id,
    displayName: validateString(value.displayName, "displayName", 120),
    description: validateString(value.description, "description", 500),
    thumbnail: validateCatalogUrl(value.thumbnail, "preview"),
    spritesheet: validateCatalogUrl(value.spritesheet, "preview"),
    zip: validateCatalogUrl(value.zip, "zip"),
    category,
    ...(value.spriteVersionNumber === undefined ? {} : { spriteVersionNumber: validateSpriteVersionNumber(value.spriteVersionNumber) }),
  };
  const withSubcategory = value.subcategory === undefined ? entry : { ...entry, subcategory: validateString(value.subcategory, "subcategory", 80) };
  return withCatalogMeta(withSubcategory, value);
}

function validateCatalogV3Category(value: unknown): CatalogV3Category {
  if (!isRecord(value)) throw new Error("Catalog v3 category must be an object.");
  return {
    id: validateCategory(value.id),
    label: validateString(value.label, "category label", 40),
    count: validateCount(value.count),
  };
}

function validateCatalogV3SearchPet(value: unknown, catalogPageCount: number): CatalogV3SearchPet {
  if (!isRecord(value)) throw new Error("Catalog v3 search pet must be an object.");
  const catalogPage = validateInteger(value.catalogPage, "Catalog v3 search catalogPage", 0, Math.max(0, catalogPageCount - 1));
  return withCatalogMeta({
    id: validateId(value.id),
    displayName: validateString(value.displayName, "displayName", 120),
    searchText: validateString(value.searchText, "searchText", 400),
    category: validateCategory(value.category),
    catalogPage,
    ...(value.spriteVersionNumber === undefined ? {} : { spriteVersionNumber: validateSpriteVersionNumber(value.spriteVersionNumber) }),
  }, value);
}

export function toCatalogPetV2Compat(pet: CatalogPetV3): CatalogPetV2 {
  const entry: CatalogPetV2 = {
    id: pet.id,
    displayName: pet.displayName,
    description: pet.description,
    preview: pet.thumbnail,
    spritesheet: pet.spritesheet,
    zip: pet.zip,
    category: pet.category,
  };
  return {
    ...entry,
    ...(pet.subcategory ? { subcategory: pet.subcategory } : {}),
    ...(pet.original === undefined ? {} : { original: pet.original }),
    ...(pet.featured === undefined ? {} : { featured: pet.featured }),
    ...(pet.spriteVersionNumber === undefined ? {} : { spriteVersionNumber: pet.spriteVersionNumber }),
  };
}

function withCatalogMeta<T extends object>(entry: T, value: Record<string, unknown>): T & { readonly original?: boolean; readonly featured?: boolean } {
  return {
    ...entry,
    ...(value.original === undefined ? {} : { original: validateBoolean(value.original, "original") }),
    ...(value.featured === undefined ? {} : { featured: validateBoolean(value.featured, "featured") }),
  };
}

function validateBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Catalog pet ${field} must be a boolean.`);
  return value;
}

function validateSpriteVersionNumber(value: unknown): 2 {
  if (value !== 2) throw new Error("Catalog pet spriteVersionNumber must be 2 when provided.");
  return 2;
}

function validateCategory(value: unknown): "western" | "asian" {
  if (value === "western" || value === "asian") return value;
  throw new Error(`Invalid catalog category: ${String(value)}`);
}

function validateCount(value: unknown): number {
  return validateInteger(value, "Catalog category count", 0, 10_000);
}

function validateInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${field} is invalid.`);
  return value;
}

function validateId(value: unknown): string {
  if (typeof value !== "string") throw new Error("Catalog pet id must be a string.");
  if (value === "builtin") throw new Error("Catalog pet id 'builtin' is reserved.");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) throw new Error(`Invalid catalog pet id: ${value}`);
  return value;
}

function validateString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`Catalog pet ${field} must be a string.`);
  if (value.length > maxLength) throw new Error(`Catalog pet ${field} is too long.`);
  return value;
}

function validateCatalogUrl(value: unknown, field: "preview" | "zip" | "catalog"): string {
  const raw = validateString(value, field, 2048);
  const url = new URL(raw);

  if (url.protocol !== "https:") throw new Error(`${field} URL must use https.`);
  if (url.username || url.password) throw new Error(`${field} URL cannot include credentials.`);
  if (url.port) throw new Error(`${field} URL cannot include a custom port.`);

  if (field === "preview") {
    if (url.hostname !== "openpets.dev" || !url.pathname.startsWith("/pets/")) throw new Error("Preview URL host/path is not allowed.");
  } else if (field === "catalog") {
    if (url.hostname !== "openpets.dev" || !url.pathname.startsWith("/pets/catalog.v3/")) throw new Error("Catalog URL host/path is not allowed.");
  } else if (url.hostname !== "zip.openpets.dev" || !url.pathname.startsWith("/pets/")) {
    throw new Error("Zip URL host/path is not allowed.");
  }

  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
