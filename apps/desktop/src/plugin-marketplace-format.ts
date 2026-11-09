export function formatMarketplaceReleaseDate(timestampSeconds: number | null, locale?: string): string {
  if (timestampSeconds === null || !Number.isFinite(timestampSeconds)) return "";
  const date = new Date(timestampSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString(locale);
}
