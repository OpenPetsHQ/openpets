---
description: API-owned plugin publication, immutable reviewed releases, shared Studio identity and desktop discovery.
---

# Plugin marketplace

## Direction and ownership

The marketplace uses the existing Studio account and session. Studio's service
owns marketplace records and immutable artifacts on its durable data volume;
the Nuxt website and desktop are consumers. Pet generation, credits and pet
social records remain separate concerns. GitHub/source links are optional.

Every plugin release requires an administrator's review. Approval binds the
exact package checksum and the submitted listing, README, changelog and media
snapshot. Publishing a new version must not mutate the currently public version.
Installed plugins remain usable without the marketplace or a signed-in account.

## Implementation contract

This section is the shared implementation contract for the new service and its
clients. API paths below are relative to the existing Studio API origin. JSON
uses camelCase. Errors follow Studio's HTTP status and `{detail}` convention.
Private routes reuse its Bearer session; admin routes reuse its team allowlist.

### Public records

`PluginSummary` contains `id`, `name`, `description`, `category`, `tags`,
`publisher` (`id`, `username`, `displayName`, `publisherType`), `iconUrl`,
`version`, `runtime`, `sdkVersion`, `minOpenPetsVersion`, `maxOpenPetsVersion`, `permissions`, `network`,
`downloadUrl`, `sha256`, `releaseId`, `heartCount`, `ratingAverage`,
`ratingCount`, `downloadCount`, `hearted`, and `myRating`.

`PluginDetail` extends the summary with `readme`, `screenshots` (URL strings),
`sourceUrl`, `homepageUrl`, `license`, `changelog`, and `releases`.
`Release` contains `id`, `pluginId`, `version`, `status`, `sha256`,
`downloadUrl`, `runtime`, `sdkVersion`, `minOpenPetsVersion`, `maxOpenPetsVersion`, `permissions`, `network`,
`changelog`, `createdAt`, `reviewedAt`, and `reviewNote` where authorized.
Public release responses contain approved releases only.

Runtime and compatibility fields are manifest-derived; absent minimum/maximum
application bounds are omitted. Clients select the numerically highest approved
release satisfying supported runtime, SDK and application bounds, not simply the
last reviewed version. New submission versions use canonical stable semver.

`Comment` contains `id`, `pluginId`, `author` (public publisher/profile shape),
`body`, `createdAt`, and `canDelete`. Comments are flat, paginated discussions;
ratings are one editable integer from 1 through 5 per account and plugin.

### Public endpoints

- `GET /api/marketplace/plugins?q=&sort=&category=&offset=0&limit=24`
  returns `{plugins, total, offset, limit}`; sorts: `popular`, `newest`, `rating`, `name`.
- `GET /api/marketplace/plugins/{id}` returns `PluginDetail`.
- `GET /api/marketplace/plugins/{id}/releases/{version}/download` serves the
  immutable approved ZIP anonymously, with a bounded filename and checksum ETag.
- `GET /api/marketplace/media/{digest}` serves approved referenced media only.
- `GET /api/marketplace/plugins/{id}/comments?offset=0&limit=20` returns
  `{comments, total, offset, limit}`.
- `GET /api/marketplace/catalog.v2.json` projects current approved install
  records into the existing strict desktop catalog v2 contract.

### Publisher and engagement endpoints

- `GET /api/marketplace/publisher/plugins` returns `{plugins}` including owned
  unpublished listings and their releases/review notes.
- `POST /api/marketplace/publisher/plugins` accepts `{id}` and reserves a
  stable plugin ID for the current account; returns its publisher record.
- `POST /api/marketplace/publisher/plugins/{id}/releases` accepts multipart
  `package` (ZIP), `metadata` (JSON string), optional `icon` (image), and
  repeated `screenshots` (images). It validates and creates an immutable pending
  submission; returns `Release`. Metadata fields: `name`, `description`,
  `category`, `tags`, `readme`, `changelog`, `sourceUrl`, `homepageUrl`, `license`.
  Runtime/version/permissions/compatibility come from the validated manifest,
  never browser-supplied install metadata. A rejected version requires a new
  submission identity; no approved version's bytes may be replaced.
- `PUT /api/marketplace/plugins/{id}/heart` accepts `{on: boolean}`.
- `PUT /api/marketplace/plugins/{id}/rating` accepts `{rating: 1..5}`.
  Engagement writes return the updated plugin detail.
- `POST /api/marketplace/plugins/{id}/comments` accepts `{body}` and returns
  the new comment. `DELETE /api/marketplace/comments/{id}` permits its author
  or an administrator to remove it.
- `POST /api/marketplace/plugins/{id}/reports` accepts `{reason}` for review.

### Administration

- `GET /api/marketplace/admin/reviews?status=pending` returns `{releases}`;
  queue entries include the submitted listing snapshot and validation report.
- `GET /api/marketplace/admin/releases/{releaseId}` returns the full private
  submission, bounded review media/package URLs and validation report.
- `POST /api/marketplace/admin/releases/{releaseId}/review` accepts
  `{decision: "approve" | "reject", note}`; decisions are transactional and
  concurrent stale/conflicting decisions return 409.
- `POST /api/marketplace/admin/releases/{releaseId}/withdraw` accepts `{note}`;
  removes that version from future discovery/download and selects the highest
  compatible remaining approved version, or hides the listing if none remains.
- `GET /api/marketplace/admin/reports` returns `{reports}`; admins can resolve
  reports and remove offending comments through the same domain API.
- `POST /api/marketplace/admin/reports/{reportId}/resolve` accepts `{note}`.
- `POST /api/marketplace/admin/import/{pluginId}` accepts the same multipart
  package/media fields as submission, preserving exact previously reviewed ZIPs.
  Only reserved legacy IDs are accepted; a matching retry is idempotent and a
  changed published snapshot conflicts. Historical official/community attribution
  is independent of the ID prefix. Admin-only import metadata may include reviewed
  minimum/maximum app bounds from the old catalog; those live separately from
  the original manifest and never change package bytes.

## Durable invariants

Plugin IDs remain installation/config/storage identities. Existing official and
community IDs are preserved by an explicit, repeatable admin import; ownership
must never be claimable by an unrelated account. New IDs use a reserved publisher
namespace, with `openpets.*` restricted to the team.

Semver, SDK/app compatibility, archive bounds and paths, manifests, declared
assets/locales, hashes and permissions are validated at the package boundary.
The Python API calls a bounded portable Node validator built from the existing
authoritative validation code rather than maintaining a second rule set.

Content-addressed artifacts are flushed and atomically promoted before any DB
record can expose them. Approval is the visibility commit. No public route
serves pending, rejected, withdrawn or orphaned artifacts. Private review
downloads require the existing admin authorization. A newer approval cannot
downgrade the current release by review ordering. Ratings/hearts are unique per
account. Account deletion does not destroy packages already installed elsewhere
or accidentally transfer a publisher identity.

Uploads are admitted before multipart parsing, with two active uploads per
service process, immediate busy responses and a 60 MiB aggregate request limit.
Packages are capped at 16 MiB, images at 5 MiB and screenshots at eight per
submission. Native package validation has separate concurrency/time/output
bounds. Durable artifact admission uses a cross-process lock and a 2 GiB default
budget (`STUDIO_MARKETPLACE_STORAGE_BYTES`), including orphaned/staging bytes;
capacity exhaustion fails without publishing a partial record. Back up the
database and artifacts together. Grace-period orphan collection is operational
follow-up work, not permission to exceed the configured budget.

Desktop discovers approved releases anonymously, validates checksum AND expected
plugin ID/version before replacement, preserves config/storage/enabled state,
and prompts only for additional end-user permissions. Administrator review of
every version is separate from end-user permission approval.

## Rollout and validation

Legacy catalog URLs are retained only as a versioned boundary for released apps;
current runtime and website use the marketplace. Import and deployment are
explicit operations, not application startup side effects. No website deployment
is required for an ordinary approved plugin release.

Validation must demonstrate submission isolation, owner/admin authorization,
review races, immutable approved bytes/metadata, rollback and version ordering,
withdrawal visibility, social uniqueness/moderation, and desktop manifest/hash
binding with retained local state. Local API and real UI smoke checks complement
unit tests; production readiness additionally requires deployment and a live
submission-to-install check.
