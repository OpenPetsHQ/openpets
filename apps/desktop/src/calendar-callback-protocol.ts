const ticketPattern = /^[A-Za-z0-9_-]{43}$/;

/** Parse only the one-time verifier handoff emitted by the first-party broker. */
export function parseCalendarVerificationLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 256) return null;
  let url: URL;
  try { url = new URL(value); }
  catch { return null; }
  if (
    url.protocol !== "openpets:"
    || url.hostname !== "calendar"
    || url.pathname !== "/verify"
    || url.port
    || url.username
    || url.password
    || url.hash
  ) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "ticket") return null;
  const ticket = url.searchParams.get("ticket");
  return ticket && ticketPattern.test(ticket) ? ticket : null;
}

export function findCalendarVerificationTicket(argv: readonly unknown[]): string | null {
  for (const value of argv) {
    const ticket = parseCalendarVerificationLink(value);
    if (ticket) return ticket;
  }
  return null;
}
