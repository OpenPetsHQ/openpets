export type SearchPetEntry = {
  id: string;
  displayName: string;
  category?: "western" | "asian";
  original?: boolean;
  featured?: boolean;
  spriteVersionNumber?: 2;
  searchText?: string;
  catalogPage?: number;
};

export type CatalogSearchStatus = "idle" | "loading" | "success" | "error";

export interface CatalogSearchState {
  readonly status: CatalogSearchStatus;
  readonly pets: SearchPetEntry[] | null;
  readonly error: string | null;
}

export const initialCatalogSearchState: CatalogSearchState = {
  status: "idle",
  pets: null,
  error: null,
};

function processCatalogSearchResult(result: { pets?: SearchPetEntry[]; error?: string }): CatalogSearchState {
  if (result.error) {
    return {
      status: "error",
      pets: null,
      error: result.error,
    };
  }
  return {
    status: "success",
    pets: result.pets ?? [],
    error: null,
  };
}

function processCatalogSearchError(error: unknown): CatalogSearchState {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: "error",
    pets: null,
    error: message,
  };
}

function shouldFetchCatalogSearch(state: CatalogSearchState, currentRoute: string): boolean {
  return currentRoute === "pets" && state.status === "idle";
}

function handleRouteTransition(state: CatalogSearchState, nextRoute: string): CatalogSearchState {
  if (nextRoute !== "pets" && (state.status === "error" || state.status === "loading")) {
    return {
      status: "idle",
      pets: null,
      error: null,
    };
  }
  return state;
}

export interface CatalogSearchFetchController {
  getState(): CatalogSearchState;
  shouldFetch(currentRoute: string): boolean;
  startFetch(currentRoute: string, fetcher: () => Promise<{ pets?: SearchPetEntry[]; error?: string }>): Promise<CatalogSearchState | null>;
  cancelPending(): void;
  retry(): CatalogSearchState;
  onRouteTransition(nextRoute: string): CatalogSearchState;
}

export function createCatalogSearchController(
  initialState: CatalogSearchState = initialCatalogSearchState,
  onStateChange?: (state: CatalogSearchState) => void,
): CatalogSearchFetchController {
  let currentState = initialState;
  let currentRequestId = 0;

  function updateState(nextState: CatalogSearchState): CatalogSearchState {
    currentState = nextState;
    onStateChange?.(nextState);
    return currentState;
  }

  return {
    getState() {
      return currentState;
    },
    shouldFetch(currentRoute: string) {
      return shouldFetchCatalogSearch(currentState, currentRoute);
    },
    async startFetch(currentRoute, fetcher) {
      if (!shouldFetchCatalogSearch(currentState, currentRoute)) {
        return null;
      }
      const requestId = ++currentRequestId;
      updateState({ ...currentState, status: "loading" });
      try {
        const result = await fetcher();
        if (requestId !== currentRequestId) {
          return null;
        }
        return updateState(processCatalogSearchResult(result));
      } catch (err) {
        if (requestId !== currentRequestId) {
          return null;
        }
        return updateState(processCatalogSearchError(err));
      }
    },
    cancelPending() {
      currentRequestId++;
      if (currentState.status === "loading") {
        updateState({ status: "idle", pets: null, error: null });
      }
    },
    retry() {
      currentRequestId++;
      return updateState({ status: "idle", pets: null, error: null });
    },
    onRouteTransition(nextRoute: string) {
      if (nextRoute !== "pets") {
        currentRequestId++;
      }
      return updateState(handleRouteTransition(currentState, nextRoute));
    },
  };
}
