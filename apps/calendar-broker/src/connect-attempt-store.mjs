/** D1-backed state for the single project-wide Composio callback stream. */
export function createD1ConnectAttemptStore(db) {
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
    throw new Error("calendar_connection_verification_not_configured");
  }

  return {
    async create(attempt, now) {
      const results = await db.batch([
        db.prepare("DELETE FROM calendar_connect_cancellations WHERE expires_at <= ?").bind(now),
        db.prepare(`DELETE FROM calendar_connect_attempts WHERE updated_at < ?
          AND state IN ('verified','cancelled','expired','failed')`).bind(now - 90 * 24 * 60 * 60_000),
        db.prepare(`INSERT INTO calendar_connect_attempts
          (attempt_id, request_id_hash, profile_id, plugin_id, provider, user_id, state, expires_at, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM calendar_connect_lock WHERE singleton = 1 AND expires_at > ?)
            AND NOT EXISTS (SELECT 1 FROM calendar_connect_cancellations WHERE request_id_hash = ? AND profile_id = ? AND plugin_id = ? AND provider = ? AND expires_at > ?)`)
          .bind(attempt.attemptId, attempt.requestIdHash, attempt.profileId, attempt.pluginId, attempt.provider, attempt.userId, attempt.expiresAt, now, now, now, attempt.requestIdHash, attempt.profileId, attempt.pluginId, attempt.provider, now),
        db.prepare(`INSERT INTO calendar_connect_lock (singleton, attempt_id, expires_at)
          SELECT 1, attempt_id, expires_at FROM calendar_connect_attempts WHERE attempt_id = ? AND state = 'creating'
          ON CONFLICT(singleton) DO UPDATE SET attempt_id = excluded.attempt_id, expires_at = excluded.expires_at
          WHERE calendar_connect_lock.expires_at <= ?`)
          .bind(attempt.attemptId, now),
      ]);
      const created = changed(results[2]) === 1;
      const locked = changed(results[3]) === 1;
      if (created && !locked) {
        await this.setState(attempt.attemptId, "failed", now);
      }
      return created && locked;
    },

    async setLink(attemptId, accountId, expiresAt, now) {
      const results = await db.batch([
        db.prepare(`UPDATE calendar_connect_attempts SET connected_account_id = ?, expires_at = ?, state = 'link_opened', updated_at = ?
          WHERE attempt_id = ? AND state = 'creating' AND expires_at > ?`)
          .bind(accountId, expiresAt, now, attemptId, now),
        db.prepare(`UPDATE calendar_connect_lock SET expires_at = ? WHERE singleton = 1 AND attempt_id = ?`)
          .bind(expiresAt, attemptId),
      ]);
      return changed(results[0]) === 1 && changed(results[1]) === 1;
    },

    async getCurrent(now) {
      return db.prepare(`SELECT a.* FROM calendar_connect_attempts a JOIN calendar_connect_lock l ON l.attempt_id = a.attempt_id
        WHERE l.singleton = 1 AND l.expires_at > ? AND a.expires_at > ? AND a.state IN ('creating','link_opened','callback_ready','verifying','completion_unknown')`)
        .bind(now, now).first();
    },

    async getLatest(profileId, pluginId, provider) {
      return db.prepare(`SELECT * FROM calendar_connect_attempts WHERE profile_id = ? AND plugin_id = ? AND provider = ?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`).bind(profileId, pluginId, provider).first();
    },

    async getByRequestIdHash(requestIdHash, profileId, pluginId, provider) {
      return db.prepare(`SELECT * FROM calendar_connect_attempts WHERE request_id_hash = ? AND profile_id = ? AND plugin_id = ? AND provider = ?`)
        .bind(requestIdHash, profileId, pluginId, provider).first();
    },

    async isRequestCancelled(requestIdHash, profileId, pluginId, provider, now) {
      const row = await db.prepare(`SELECT 1 AS cancelled FROM calendar_connect_cancellations
        WHERE request_id_hash = ? AND profile_id = ? AND plugin_id = ? AND provider = ? AND expires_at > ?`)
        .bind(requestIdHash, profileId, pluginId, provider, now).first();
      return Boolean(row);
    },

    async cancelRequest(request, now, expiresAt, verifyingBefore) {
      const results = await db.batch([
        db.prepare("DELETE FROM calendar_connect_cancellations WHERE expires_at <= ?").bind(now),
        db.prepare(`INSERT INTO calendar_connect_cancellations (request_id_hash, profile_id, plugin_id, provider, expires_at)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(request_id_hash) DO NOTHING`)
          .bind(request.requestIdHash, request.profileId, request.pluginId, request.provider, expiresAt),
        db.prepare(`UPDATE calendar_connect_attempts SET state = 'cancelled', session_cipher = NULL, ticket_hash = NULL, updated_at = ?
          WHERE request_id_hash = ? AND profile_id = ? AND plugin_id = ? AND provider = ?
            AND (state IN ('creating','link_opened','callback_ready','completion_unknown') OR (state = 'verifying' AND updated_at <= ?))`)
          .bind(now, request.requestIdHash, request.profileId, request.pluginId, request.provider, verifyingBefore),
        db.prepare(`DELETE FROM calendar_connect_lock WHERE singleton = 1 AND attempt_id = (
          SELECT attempt_id FROM calendar_connect_attempts WHERE request_id_hash = ? AND profile_id = ? AND plugin_id = ? AND provider = ? AND state = 'cancelled'
        )`).bind(request.requestIdHash, request.profileId, request.pluginId, request.provider),
      ]);
      if (changed(results[2]) === 1) return true;
      const row = await this.getByRequestIdHash(request.requestIdHash, request.profileId, request.pluginId, request.provider);
      return row?.state === "verifying" && row.updated_at > verifyingBefore;
    },

    async verifyIfNotCancelled(attemptId, now) {
      const results = await db.batch([
        db.prepare(`UPDATE calendar_connect_attempts SET state = 'verified', session_cipher = NULL, ticket_hash = NULL, updated_at = ?
          WHERE attempt_id = ? AND state = 'completion_unknown' AND NOT EXISTS (
            SELECT 1 FROM calendar_connect_cancellations c WHERE c.request_id_hash = calendar_connect_attempts.request_id_hash
              AND c.profile_id = calendar_connect_attempts.profile_id AND c.plugin_id = calendar_connect_attempts.plugin_id
              AND c.provider = calendar_connect_attempts.provider AND c.expires_at > ?
          )`).bind(now, attemptId, now),
        db.prepare("DELETE FROM calendar_connect_lock WHERE singleton = 1 AND attempt_id = ?").bind(attemptId),
      ]);
      return changed(results[0]) === 1;
    },

    async listForProfile(profileId, pluginId, provider) {
      const result = await db.prepare(`SELECT * FROM calendar_connect_attempts WHERE profile_id = ? AND plugin_id = ? AND provider = ?`)
        .bind(profileId, pluginId, provider).all();
      return Array.isArray(result?.results) ? result.results : [];
    },

    async storeCallback(attemptId, sessionCipher, ticketHash, now) {
      return db.prepare(`UPDATE calendar_connect_attempts SET state = 'callback_ready', session_cipher = ?, ticket_hash = ?, callback_count = callback_count + 1, updated_at = ?
        WHERE attempt_id = ? AND state = 'link_opened' AND expires_at > ? AND ticket_hash IS NULL AND callback_count < 3`)
        .bind(sessionCipher, ticketHash, now, attemptId, now).run().then((result) => changed(result) === 1);
    },

    async getByTicketHash(ticketHash) {
      return db.prepare("SELECT * FROM calendar_connect_attempts WHERE ticket_hash = ?").bind(ticketHash).first();
    },

    async claimTicket(attemptId, profileId, ticketHash, now) {
      return db.prepare(`UPDATE calendar_connect_attempts SET state = 'verifying', ticket_hash = NULL, updated_at = ?
        WHERE attempt_id = ? AND profile_id = ? AND ticket_hash = ? AND state = 'callback_ready' AND expires_at > ?`)
        .bind(now, attemptId, profileId, ticketHash, now).run().then((result) => changed(result) === 1);
    },

    async restoreLink(attemptId, now) {
      return db.prepare(`UPDATE calendar_connect_attempts SET state = 'link_opened', session_cipher = NULL, ticket_hash = NULL, updated_at = ?
        WHERE attempt_id = ? AND state = 'verifying' AND expires_at > ? AND callback_count < 3
          AND EXISTS (SELECT 1 FROM calendar_connect_lock WHERE singleton = 1 AND attempt_id = ? AND expires_at > ?)`)
        .bind(now, attemptId, now, attemptId, now).run().then((result) => changed(result) === 1);
    },

    async setState(attemptId, state, now) {
      const terminal = ["verified", "cancelled", "expired", "failed"].includes(state);
      const discardSession = terminal || state === "completion_unknown";
      const results = await db.batch([
        db.prepare(`UPDATE calendar_connect_attempts SET state = ?, updated_at = ?,
          session_cipher = CASE WHEN ? THEN NULL ELSE session_cipher END,
          ticket_hash = CASE WHEN ? THEN NULL ELSE ticket_hash END
          WHERE attempt_id = ?`)
          .bind(state, now, discardSession ? 1 : 0, discardSession ? 1 : 0, attemptId),
        ...(terminal ? [db.prepare("DELETE FROM calendar_connect_lock WHERE singleton = 1 AND attempt_id = ?").bind(attemptId)] : []),
      ]);
      return changed(results[0]) === 1;
    },
  };
}

function changed(result) {
  return Number(result?.meta?.changes ?? 0);
}
