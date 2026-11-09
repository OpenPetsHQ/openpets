import React, { useState, useEffect, useRef, useMemo } from "react";
import { formatMarketplaceReleaseDate } from "../../../plugin-marketplace-format.js";
import { useI18n } from "../i18n.js";
import type { MarketplacePlugin, MarketplaceDetail, MarketplacePage, MarketplaceQuery } from "../../../plugin-marketplace-types.js";

export type MarketplaceBrowserApi = {
  readonly getMarketplacePlugins: (query?: MarketplaceQuery) => Promise<MarketplacePage>;
  readonly getMarketplacePlugin: (id: string) => Promise<MarketplaceDetail>;
};

export type MarketplaceBrowserProps = {
  readonly installed: ReadonlyArray<{
    readonly id: string;
    readonly version: string;
    readonly bundled?: boolean;
    readonly source?: string;
    readonly enabled?: boolean;
  }>;
  readonly api: MarketplaceBrowserApi;
  readonly onInstall: (id: string) => Promise<void>;
  readonly onUpdate: (id: string) => Promise<void>;
  readonly onOpenExternal: (url: string) => void;
};

export function MarketplaceBrowser({
  installed,
  api,
  onInstall,
  onUpdate,
  onOpenExternal,
}: MarketplaceBrowserProps): React.ReactElement {
  const { t, locale } = useI18n();
  const categories = [
    { id: "", label: t("marketplace.category.all") },
    { id: "extension", label: t("marketplace.category.extension") },
    { id: "theme", label: t("marketplace.category.theme") },
    { id: "utility", label: t("marketplace.category.utility") },
    { id: "companion", label: t("marketplace.category.companion") },
  ];
  const sorts = [
    { id: "popular", label: t("marketplace.sort.popular") },
    { id: "newest", label: t("marketplace.sort.newest") },
    { id: "rating", label: t("marketplace.sort.rating") },
    { id: "name", label: t("marketplace.sort.name") },
  ];
  const categoryLabel = (id: string) => categories.find((category) => category.id === id)?.label ?? id;
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSort, setSelectedSort] = useState<"popular" | "newest" | "rating" | "name">("popular");
  const [offset, setOffset] = useState(0);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const limit = 24;

  const [pageData, setPageData] = useState<MarketplacePage | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<MarketplaceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);

  const fetchGenerationRef = useRef(0);
  const detailGenerationRef = useRef(0);

  const installedMap = useMemo(() => {
    const map = new Map<string, { version: string; bundled?: boolean; source?: string; enabled?: boolean }>();
    for (const item of installed) {
      map.set(item.id, { version: item.version, bundled: item.bundled, source: item.source, enabled: item.enabled });
    }
    return map;
  }, [installed]);

  // Fetch list of plugins
  useEffect(() => {
    const generation = ++fetchGenerationRef.current;
    setLoadingList(true);
    setListError(null);

    const timer = setTimeout(async () => {
      try {
        const result = await api.getMarketplacePlugins({
          q: query.trim() || undefined,
          category: selectedCategory || undefined,
          sort: selectedSort,
          offset,
          limit,
        });
        if (generation === fetchGenerationRef.current) {
          setPageData(result);
          setLoadingList(false);
        }
      } catch (err: unknown) {
        if (generation === fetchGenerationRef.current) {
          setListError(err instanceof Error ? err.message : t("marketplace.error.list"));
          setLoadingList(false);
        }
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      fetchGenerationRef.current++;
    };
  }, [query, selectedCategory, selectedSort, offset, refreshCounter, api, limit, locale]);

  // Fetch detail for selected plugin
  useEffect(() => {
    if (!selectedId) {
      setDetailData(null);
      setLoadingDetail(false);
      setDetailError(null);
      return;
    }

    const generation = ++detailGenerationRef.current;
    setLoadingDetail(true);
    setDetailError(null);

    api
      .getMarketplacePlugin(selectedId)
      .then((detail) => {
        if (generation === detailGenerationRef.current) {
          setDetailData(detail);
          setLoadingDetail(false);
        }
      })
      .catch((err: unknown) => {
        if (generation === detailGenerationRef.current) {
          setDetailError(err instanceof Error ? err.message : t("marketplace.error.detail"));
          setLoadingDetail(false);
        }
      });

    return () => {
      detailGenerationRef.current++;
    };
  }, [selectedId, refreshCounter, api, locale]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setOffset(0);
  };

  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(cat);
    setOffset(0);
  };

  const handleSortChange = (sort: "popular" | "newest" | "rating" | "name") => {
    setSelectedSort(sort);
    setOffset(0);
  };

  const handleAction = async (pluginId: string, isUpdate: boolean) => {
    setActionInProgress(pluginId);
    setActionError(null);
    try {
      if (isUpdate) {
        await onUpdate(pluginId);
      } else {
        await onInstall(pluginId);
      }
      setRefreshCounter((c) => c + 1);
      if (selectedId === pluginId) {
        const generation = ++detailGenerationRef.current;
        const fresh = await api.getMarketplacePlugin(pluginId);
        if (generation === detailGenerationRef.current) {
          setDetailData(fresh);
        }
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : t("marketplace.error.action"));
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-stone-950 text-stone-100 overflow-hidden font-sans">
      {/* Top Banner / Header */}
      <div className="flex items-center justify-between border-b border-stone-800 bg-stone-900/60 px-6 py-4 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/20 text-white font-bold text-lg">
            ✦
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-stone-100">{t("marketplace.title")}</h1>
            <p className="text-xs text-stone-400">{t("marketplace.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => onOpenExternal("https://openpets.dev/plugins/publish")}
            className="flex items-center space-x-1.5 rounded-lg border border-stone-700 bg-stone-800/80 px-3 py-1.5 text-xs font-medium text-stone-300 hover:bg-stone-700 hover:text-white transition-all shadow-sm"
          >
            <span>{t("marketplace.publish")}</span>
            <span className="text-stone-500">↗</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Column: Explorer / Search / Grid */}
        <div className={`flex flex-1 flex-col overflow-hidden transition-all duration-300 ${selectedId ? "w-1/2 lg:w-3/5 border-r border-stone-800" : "w-full"}`}>
          {/* Controls bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-800/80 bg-stone-900/30 px-6 py-3">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-stone-500">🔍</span>
              <input
                type="text"
                value={query}
                onChange={handleSearchChange}
                placeholder={t("marketplace.search")}
                aria-label={t("marketplace.search")}
                className="w-full rounded-lg border border-stone-800 bg-stone-900/80 py-2 pl-9 pr-4 text-xs text-stone-200 placeholder-stone-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={t("marketplace.category.label")}
                value={selectedCategory}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="rounded-lg border border-stone-800 bg-stone-900 px-3 py-1.5 text-xs text-stone-300 focus:border-violet-500 focus:outline-none"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("marketplace.sort.label")}
                value={selectedSort}
                onChange={(e) => handleSortChange(e.target.value as "popular" | "newest" | "rating" | "name")}
                className="rounded-lg border border-stone-800 bg-stone-900 px-3 py-1.5 text-xs text-stone-300 focus:border-violet-500 focus:outline-none"
              >
                {sorts.map((sort) => (
                  <option key={sort.id} value={sort.id}>
                    {sort.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Action notification banner */}
          {actionError && (
            <div className="flex items-center justify-between bg-red-950/50 border-b border-red-800/50 px-6 py-2.5 text-xs text-red-200">
              <span>{actionError}</span>
              <button aria-label={t("marketplace.dismissError")} onClick={() => setActionError(null)} className="text-red-400 hover:text-red-200">✕</button>
            </div>
          )}

          {/* List scroll view */}
          <div className="flex-1 overflow-y-auto p-6">
            {loadingList && !pageData ? (
              <div className="flex h-64 items-center justify-center">
                <div className="flex flex-col items-center space-y-3">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
                  <p className="text-xs text-stone-400">{t("marketplace.loadingList")}</p>
                </div>
              </div>
            ) : listError ? (
              <div className="flex h-64 flex-col items-center justify-center space-y-3 text-center">
                <p className="text-sm text-red-400">{listError}</p>
                <button
                  onClick={() => setRefreshCounter((c) => c + 1)}
                  className="rounded-lg bg-stone-800 px-4 py-2 text-xs font-medium text-stone-200 hover:bg-stone-700"
                >
                  {t("marketplace.retry")}
                </button>
              </div>
            ) : pageData?.plugins.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center space-y-2 text-center">
                <p className="text-sm text-stone-300 font-medium">{t("marketplace.empty")}</p>
                <p className="text-xs text-stone-500 max-w-sm">{t("marketplace.emptyHint")}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {pageData?.plugins.map((plugin: MarketplacePlugin) => {
                    const installedRecord = installedMap.get(plugin.id);
                    const isInstalled = !!installedRecord;
                    const isBundled = installedRecord?.bundled;
                    const isLocal = installedRecord?.source === "local";
                    const hasUpdate = isInstalled && !isLocal && installedRecord.version !== plugin.version;
                    const isSelected = selectedId === plugin.id;
                    const isActionActive = actionInProgress === plugin.id;

                    return (
                      <div
                        key={plugin.id}
                        className={`group relative flex flex-col justify-between rounded-2xl border p-4 transition-all duration-200 cursor-pointer ${
                          isSelected
                            ? "border-violet-500/80 bg-violet-950/20 shadow-lg shadow-violet-950/50"
                            : "border-stone-800/80 bg-stone-900/40 hover:border-stone-700 hover:bg-stone-900/70"
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center space-x-3">
                              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-stone-800 border border-stone-700/60 overflow-hidden shadow-inner">
                                {plugin.iconUrl ? (
                                  <img src={plugin.iconUrl} alt={plugin.name} className="h-full w-full object-cover" />
                                ) : (
                                  <span className="text-lg font-bold text-violet-400">{plugin.name.charAt(0)}</span>
                                )}
                              </div>
                              <div>
                                <h3 className="text-sm font-bold text-stone-100 group-hover:text-violet-300 transition-colors line-clamp-1">
                                  <button
                                    type="button"
                                    className="text-left"
                                    aria-label={t("marketplace.openDetails", { name: plugin.name })}
                                    onClick={() => setSelectedId(plugin.id)}
                                  >
                                    {plugin.name}
                                  </button>
                                </h3>
                                <div className="flex items-center space-x-2 text-[11px] text-stone-400 mt-0.5">
                                  <span>{plugin.publisher.displayName}</span>
                                  {plugin.publisher.publisherType === "official" && (
                                    <span className="rounded bg-violet-500/20 px-1.5 py-0.2 text-[10px] font-semibold text-violet-300 border border-violet-500/30">
                                      {t("marketplace.official")}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          <p className="mt-3 text-xs text-stone-300 line-clamp-2 leading-relaxed">
                            {plugin.description}
                          </p>

                          <div className="mt-3 flex flex-wrap gap-1">
                            <span className="rounded-md bg-stone-800/80 px-2 py-0.5 text-[10px] font-medium text-stone-300 border border-stone-700/50">
                              {categoryLabel(plugin.category)}
                            </span>
                            {plugin.tags.slice(0, 2).map((tag: string) => (
                              <span key={tag} className="rounded-md bg-stone-900 px-2 py-0.5 text-[10px] text-stone-400 border border-stone-800">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between border-t border-stone-800/60 pt-3">
                          <div className="flex items-center space-x-3 text-[11px] text-stone-400">
                            <span className="flex items-center space-x-1">
                              <span>❤️</span>
                              <span>{plugin.heartCount}</span>
                            </span>
                            {plugin.ratingAverage != null && (
                              <span className="flex items-center space-x-1">
                                <span>⭐</span>
                                <span>{plugin.ratingAverage.toFixed(1)}</span>
                              </span>
                            )}
                            <span className="text-stone-500">v{plugin.version}</span>
                          </div>

                          <div>
                            {isBundled ? (
                              <span className="rounded-lg bg-stone-800 px-2.5 py-1 text-[11px] font-medium text-stone-400 border border-stone-700">
                                {t("marketplace.appManaged")}
                              </span>
                            ) : isLocal ? (
                              <span className="rounded-lg bg-stone-800 px-2.5 py-1 text-[11px] font-medium text-amber-400/90 border border-stone-700">
                                {t("marketplace.localDev")}
                              </span>
                            ) : hasUpdate ? (
                              <button
                                disabled={isActionActive}
                                onClick={() => handleAction(plugin.id, true)}
                                className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-violet-500 disabled:opacity-50 transition-all"
                              >
                                 {t(isActionActive ? "marketplace.checking" : "marketplace.checkUpdates")}
                              </button>
                            ) : isInstalled ? (
                              <span className="rounded-lg bg-emerald-950/60 px-2.5 py-1 text-[11px] font-medium text-emerald-300 border border-emerald-800/50">
                                {t("marketplace.installed")}
                              </span>
                            ) : (
                              <button
                                disabled={isActionActive}
                                onClick={() => handleAction(plugin.id, false)}
                                className="rounded-lg bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-900 shadow hover:bg-white disabled:opacity-50 transition-all"
                              >
                                {t(isActionActive ? "marketplace.installing" : "marketplace.install")}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination Controls */}
                {pageData && pageData.total > limit && (
                  <div className="mt-8 flex items-center justify-between border-t border-stone-800/80 pt-4 text-xs text-stone-400">
                    <div>
                      {t("marketplace.pagination", { start: offset + 1, end: Math.min(offset + limit, pageData.total), total: pageData.total })}
                    </div>
                    <div className="flex space-x-2">
                      <button
                        disabled={offset === 0}
                        onClick={() => setOffset(Math.max(0, offset - limit))}
                        className="rounded-lg border border-stone-800 bg-stone-900 px-3 py-1 text-stone-300 hover:bg-stone-800 disabled:opacity-40"
                      >
                        {t("marketplace.previous")}
                      </button>
                      <button
                        disabled={offset + limit >= pageData.total}
                        onClick={() => setOffset(offset + limit)}
                        className="rounded-lg border border-stone-800 bg-stone-900 px-3 py-1 text-stone-300 hover:bg-stone-800 disabled:opacity-40"
                      >
                        {t("marketplace.next")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Column: Detailed Inspector */}
        {selectedId && (
          <div className="flex w-1/2 lg:w-2/5 flex-col bg-stone-950/80 overflow-y-auto border-l border-stone-800/80 animate-in fade-in duration-200">
            {loadingDetail ? (
              <div className="flex h-full items-center justify-center p-8">
                <div className="flex flex-col items-center space-y-3">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
                  <p className="text-xs text-stone-400">{t("marketplace.loadingDetail")}</p>
                </div>
              </div>
            ) : detailError ? (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center space-y-3">
                <p className="text-sm text-red-400">{detailError}</p>
                <button
                  onClick={() => setRefreshCounter((c) => c + 1)}
                  className="rounded-lg bg-stone-800 px-4 py-2 text-xs font-medium text-stone-200 hover:bg-stone-700"
                >
                  {t("marketplace.retry")}
                </button>
              </div>
            ) : detailData ? (
              <div className="flex flex-col p-6 space-y-6">
                {/* Header & Close */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-stone-900 border border-stone-800 overflow-hidden shadow-md">
                      {detailData.iconUrl ? (
                        <img src={detailData.iconUrl} alt={detailData.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-2xl font-bold text-violet-400">{detailData.name.charAt(0)}</span>
                      )}
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-stone-100">{detailData.name}</h2>
                      <div className="flex items-center space-x-2 text-xs text-stone-400 mt-1">
                        <span>{t("marketplace.by", { name: detailData.publisher.displayName })}</span>
                        {detailData.publisher.publisherType === "official" && (
                          <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300 border border-violet-500/30">
                            {t("marketplace.official")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    aria-label={t("marketplace.closeDetails")}
                    onClick={() => setSelectedId(null)}
                    className="rounded-lg bg-stone-900 p-2 text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition-colors"
                  >
                    ✕
                  </button>
                </div>

                {/* Primary Action Button */}
                <div className="flex items-center space-x-3">
                  {(() => {
                    const installedRecord = installedMap.get(detailData.id);
                    const isInstalled = !!installedRecord;
                    const isBundled = installedRecord?.bundled;
                    const isLocal = installedRecord?.source === "local";
                    const hasUpdate = isInstalled && !isLocal && installedRecord.version !== detailData.version;
                    const isActionActive = actionInProgress === detailData.id;

                    if (isBundled) {
                      return (
                        <div className="flex-1 rounded-xl bg-stone-900 border border-stone-800 py-3 text-center text-xs font-medium text-stone-400">
                          {t("marketplace.bundledDetail")}
                        </div>
                      );
                    }
                    if (isLocal) {
                      return (
                        <div className="flex-1 rounded-xl bg-stone-900 border border-stone-800 py-3 text-center text-xs font-medium text-amber-400/90">
                          {t("marketplace.localDetail")}
                        </div>
                      );
                    }
                    if (hasUpdate) {
                      return (
                        <button
                          disabled={isActionActive}
                          onClick={() => handleAction(detailData.id, true)}
                          className="flex-1 rounded-xl bg-violet-600 py-3 text-xs font-semibold text-white shadow-lg shadow-violet-600/30 hover:bg-violet-500 disabled:opacity-50 transition-all"
                        >
                           {t(isActionActive ? "marketplace.checkingCompatible" : "marketplace.checkForUpdates")}
                        </button>
                      );
                    }
                    if (isInstalled) {
                      return (
                        <div className="flex-1 rounded-xl bg-emerald-950/40 border border-emerald-800/50 py-3 text-center text-xs font-semibold text-emerald-300">
                          {t("marketplace.installedVersion", { version: installedRecord.version })}
                        </div>
                      );
                    }
                    return (
                      <button
                        disabled={isActionActive}
                        onClick={() => handleAction(detailData.id, false)}
                        className="flex-1 rounded-xl bg-stone-100 py-3 text-xs font-semibold text-stone-900 shadow-lg hover:bg-white disabled:opacity-50 transition-all"
                      >
                         {t(isActionActive ? "marketplace.installing" : "marketplace.installCompatible")}
                      </button>
                    );
                  })()}
                </div>

                {/* Metadata Grid */}
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-stone-800/80 bg-stone-900/30 p-4 text-xs">
                  <div>
                    <span className="text-stone-500 block">{t("marketplace.category.label")}</span>
                    <span className="font-medium text-stone-200 mt-0.5 block">{categoryLabel(detailData.category)}</span>
                  </div>
                  <div>
                    <span className="text-stone-500 block">{t("marketplace.downloads")}</span>
                    <span className="font-medium text-stone-200 mt-0.5 block">{detailData.downloadCount.toLocaleString(locale)}</span>
                  </div>
                  <div>
                    <span className="text-stone-500 block">{t("marketplace.rating")}</span>
                    <span className="font-medium text-stone-200 mt-0.5 block">
                      {detailData.ratingAverage != null ? `${detailData.ratingAverage.toFixed(1)} ⭐ (${detailData.ratingCount})` : t("marketplace.noRatings")}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-500 block">{t("marketplace.license")}</span>
                    <span className="font-medium text-stone-200 mt-0.5 block">{detailData.license || t("marketplace.standard")}</span>
                  </div>
                </div>

                {/* External links */}
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => onOpenExternal(`https://openpets.dev/plugins/${encodeURIComponent(detailData.id)}`)}
                    className="flex items-center space-x-1.5 rounded-lg border border-stone-800 bg-stone-900 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-800 hover:text-white"
                  >
                    <span>{t("marketplace.projectLinks")}</span>
                    <span className="text-stone-500">↗</span>
                  </button>
                </div>

                {/* Screenshots Gallery */}
                {detailData.screenshots.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-3">{t("marketplace.screenshots")}</h3>
                    <div className="flex space-x-3 overflow-x-auto pb-2">
                      {detailData.screenshots.map((shot: string, idx: number) => (
                        <button
                          type="button"
                          key={idx}
                          aria-label={t("marketplace.openScreenshot", { number: idx + 1, name: detailData.name })}
                          onClick={() => setSelectedScreenshot(shot)}
                          className="flex-shrink-0 h-32 w-56 rounded-xl border border-stone-800 overflow-hidden bg-stone-900 cursor-pointer hover:border-violet-500/60 transition-colors shadow-md"
                        >
                          <img src={shot} alt="" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* README Markdown Source */}
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-3">{t("marketplace.about")}</h3>
                  <div className="rounded-2xl border border-stone-800/80 bg-stone-900/40 p-4 text-xs text-stone-300 leading-relaxed whitespace-pre-wrap font-mono">
                    {detailData.readme}
                  </div>
                </div>

                {/* Changelog */}
                {detailData.changelog && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-3">{t("marketplace.changelog")}</h3>
                    <div className="rounded-2xl border border-stone-800/80 bg-stone-900/40 p-4 text-xs text-stone-300 leading-relaxed whitespace-pre-wrap font-mono">
                      {detailData.changelog}
                    </div>
                  </div>
                )}

                {/* Releases list */}
                {detailData.releases.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-3">{t("marketplace.approvedReleases")}</h3>
                    <div className="space-y-2">
                      {detailData.releases.map((rel: MarketplaceDetail["releases"][number]) => (
                        <div key={rel.releaseId} className="flex items-center justify-between rounded-xl border border-stone-800 bg-stone-900/40 p-3 text-xs">
                          <div className="flex items-center space-x-3">
                            <span className="font-bold text-stone-200">v{rel.version}</span>
                            <span className="text-stone-500 text-[11px]">{formatMarketplaceReleaseDate(rel.createdAt, locale)}</span>
                          </div>
                          <span className="rounded bg-violet-500/20 px-2 py-0.5 text-[10px] font-medium text-violet-300 border border-violet-500/30">
                            {t("marketplace.approved")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Screenshot Modal Viewer */}
      {selectedScreenshot && (
        <div
          onClick={() => setSelectedScreenshot(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6"
        >
          <div className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-2xl border border-stone-800 bg-stone-900 shadow-2xl">
            <img src={selectedScreenshot} alt={t("marketplace.enlargedScreenshot")} className="max-h-[85vh] max-w-[85vw] object-contain" />
            <button
              aria-label={t("marketplace.closeScreenshot")}
              onClick={() => setSelectedScreenshot(null)}
              className="absolute top-3 right-3 rounded-lg bg-stone-950/80 p-2 text-stone-300 hover:bg-stone-900 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
