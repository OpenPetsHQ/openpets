import assert from "node:assert/strict";

import { findCalendarVerificationTicket, parseCalendarVerificationLink } from "../src/calendar-callback-protocol.js";

const ticket = "T".repeat(43);
const valid = `openpets://calendar/verify?ticket=${ticket}`;

assert.equal(parseCalendarVerificationLink(valid), ticket);
assert.equal(findCalendarVerificationTicket(["--other", valid]), ticket);
for (const invalid of [
  "https://calendar/verify?ticket=" + ticket,
  `openpets://teams/verify?ticket=${ticket}`,
  `openpets://calendar/verify?ticket=${ticket}&profile=other`,
  `openpets://calendar/verify?ticket=${ticket}&session_uri=provider-secret`,
  "openpets://calendar/verify?ticket=short",
  `openpets://calendar.evil.test/verify?ticket=${ticket}`,
  `openpets://calendar/verify?ticket=${ticket}#fragment`,
]) {
  assert.equal(parseCalendarVerificationLink(invalid), null, invalid);
}
assert.equal(parseCalendarVerificationLink("x".repeat(257)), null);

console.log("calendar callback protocol: all checks passed.");
