import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n.js";
import type {
  ConversationArchiveSectionApi,
  ConversationArchiveSectionProps,
  PetAssistantArchivedMessage,
} from "./types.js";

function HistoryShieldIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ArchiveEmptyIcon() {
  return (
    <svg className="h-10 w-10 text-slatecopy/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function formatTimestamp(timestamp: number): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(timestamp);
  }
}

export function ConversationArchiveSection({
  busy: externalBusy,
  run: externalRun,
  setMessage: externalSetMessage,
  setError: externalSetError,
  api: injectedApi,
}: ConversationArchiveSectionProps) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<readonly PetAssistantArchivedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [localError, setLocalError] = useState("");

  const getApi = (): ConversationArchiveSectionApi => {
    if (injectedApi) return injectedApi;
    return (window as unknown as { openPetsControlCenter: ConversationArchiveSectionApi }).openPetsControlCenter;
  };

  const handleSetError = (err: string) => {
    setLocalError(err);
    externalSetError?.(err);
  };

  const handleSetMessage = (msg: string) => {
    externalSetMessage?.(msg);
  };

  async function loadArchive() {
    setLoading(true);
    setLocalError("");
    try {
      const history = await getApi().getConversationHistory();
      setMessages(history);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load conversation archive.";
      handleSetError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadArchive();
  }, []);

  async function handleDeleteMessage(id: string) {
    if (deletingId || clearing) return;
    setDeletingId(id);
    setLocalError("");
    try {
      const result = await getApi().deleteConversationHistoryMessage(id);
      if (result.deleted) {
        // Observable state refresh after delete
        const fresh = await getApi().getConversationHistory();
        setMessages(fresh);
        handleSetMessage(t("settings.archive.toast.deleted") || "Archived message deleted.");
      } else {
        handleSetError("Message could not be deleted from archive.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete archived message.";
      handleSetError(msg);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleClearArchive() {
    if (clearing) return;
    setClearing(true);
    setLocalError("");
    try {
      await getApi().clearConversationHistory();
      // Observable state refresh after clear
      const fresh = await getApi().getConversationHistory();
      setMessages(fresh);
      setShowClearConfirm(false);
      handleSetMessage(t("settings.archive.toast.cleared") || "Conversation archive cleared.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to clear conversation archive.";
      handleSetError(msg);
    } finally {
      setClearing(false);
    }
  }

  const filteredMessages = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return messages;
    return messages.filter((msg) =>
      msg.text.toLowerCase().includes(query)
      || msg.role.toLowerCase().includes(query)
      || msg.turnId.toLowerCase().includes(query)
    );
  }, [messages, searchQuery]);

  const isBusy = Boolean(externalBusy) || loading || clearing || Boolean(deletingId);

  return (
    <div className="settings-section">
      <p className="eyebrow">{t("settings.archive.eyebrow") || "Conversation"}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="settings-section-title">{t("settings.archive.title") || "Conversation Archive"}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={() => void loadArchive()}
            disabled={isBusy}
            title={t("settings.archive.refresh") || "Refresh"}
          >
            <span className="btn-icon-wrapper mr-1 inline-flex items-center justify-center">
              <RefreshIcon />
            </span>
            <span className="btn-text">{t("settings.archive.refresh") || "Refresh"}</span>
          </button>
          <button
            type="button"
            className="btn btn-danger btn-compact"
            onClick={() => setShowClearConfirm(true)}
            disabled={isBusy || messages.length === 0}
            title={t("settings.archive.clear") || "Clear Archive"}
          >
            <span className="btn-icon-wrapper mr-1 inline-flex items-center justify-center">
              <TrashIcon />
            </span>
            <span className="btn-text">{t("settings.archive.clear") || "Clear Archive"}</span>
          </button>
        </div>
      </div>
      <p className="text-sm text-slatecopy -mt-2 mb-2">
        {t("settings.archive.description") || "Manage the persisted local conversation history used for assistant context."}
      </p>

      {localError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {localError}
        </div>
      )}

      {/* Privacy & Retention Semantics Banner */}
      <div className="personality-boundary">
        <HistoryShieldIcon />
        <div>
          <strong>{t("settings.archive.boundary.title") || "Local-only conversation archive"}</strong>
          <p>
            {t("settings.archive.boundary.description")
              || "Archived turns are saved locally in openpets-conversation-history.json (up to 200 messages / 30 days / 512 KiB). Up to 24 recent messages provide context for upcoming turns. The in-pet companion transcript is transient current-session history, separate from this persisted archive. No cloud sync or provider calls are used to read or delete this archive."}
          </p>
        </div>
      </div>

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="plugin-config-overlay" role="dialog" aria-modal="true" aria-labelledby="archive-clear-title">
          <button
            type="button"
            className="plugin-config-backdrop"
            onClick={() => !clearing && setShowClearConfirm(false)}
            tabIndex={-1}
            aria-label="Close"
          />
          <div className="plugin-inspector max-w-lg bg-white p-6 dark:bg-slate-900 rounded-3xl border border-blue-200 shadow-2xl dark:border-slate-800">
            <h3 id="archive-clear-title" className="m-0 font-monoDisplay text-xl font-black text-navy dark:text-white">
              {t("settings.archive.clearConfirm.title") || "Clear conversation archive?"}
            </h3>
            <p className="mt-2 text-sm text-slatecopy dark:text-slate-300 leading-relaxed">
              {t("settings.archive.clearConfirm.description")
                || "This will permanently delete all persisted conversation history from disk. The current in-memory companion session is unaffected."}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowClearConfirm(false)}
                disabled={clearing}
              >
                {t("common.cancel") || "Cancel"}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void handleClearArchive()}
                disabled={clearing}
              >
                {clearing ? (t("common.deleting") || "Clearing...") : (t("settings.archive.clear") || "Clear Archive")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar & Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <SearchIcon />
          </div>
          <input
            type="text"
            className="settings-select w-full pl-9 pr-3 text-xs"
            placeholder={t("settings.archive.searchPlaceholder") || "Filter archived messages..."}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            disabled={loading}
          />
        </div>
        <div className="text-xs font-semibold text-slatecopy">
          {filteredMessages.length === messages.length
            ? `${messages.length} ${messages.length === 1 ? "message" : "messages"} (max 200)`
            : `${filteredMessages.length} of ${messages.length} messages`}
        </div>
      </div>

      {/* Archive Message List */}
      <div className="settings-group">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-12 text-slatecopy text-sm font-semibold">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent mb-3" />
            Loading archive...
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-12 text-center text-slatecopy">
            <ArchiveEmptyIcon />
            <div>
              <strong className="block text-sm font-bold text-navy dark:text-white">
                {messages.length === 0
                  ? (t("settings.archive.empty.title") || "No archived messages")
                  : "No matching messages found"}
              </strong>
              <p className="m-0 mt-1 max-w-sm text-xs leading-relaxed">
                {messages.length === 0
                  ? (t("settings.archive.empty.description") || "Terminal user and assistant messages from your companion conversations will be persisted here automatically.")
                  : "Try changing your search term to see other archived messages."}
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-blue-50 dark:divide-slate-800">
            {filteredMessages.map((message) => {
              const isUser = message.role === "user";
              const isDeleting = deletingId === message.id;

              return (
                <div
                  key={message.id}
                  className="flex flex-col gap-3 p-4 sm:p-5 transition-colors hover:bg-white/70 dark:hover:bg-slate-800/50"
                  data-archive-message-id={message.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase ${
                          isUser
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200"
                            : "bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200"
                        }`}
                      >
                        {isUser
                          ? (t("settings.archive.user") || "You")
                          : (t("settings.archive.assistant") || "Assistant")}
                      </span>
                      <span className="font-mono text-[10px] text-slatecopy/70 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                        turn:{message.turnId.slice(0, 8)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <time className="text-xs text-slatecopy font-medium">
                        {formatTimestamp(message.createdAt)}
                      </time>
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact text-xs text-red-600 hover:text-red-700 dark:text-red-400"
                        onClick={() => void handleDeleteMessage(message.id)}
                        disabled={isBusy}
                        title={t("settings.archive.delete") || "Delete message"}
                        aria-label={`Delete message from ${formatTimestamp(message.createdAt)}`}
                      >
                        <span className="btn-icon-wrapper mr-1 inline-flex items-center justify-center">
                          <TrashIcon />
                        </span>
                        <span className="btn-text">
                          {isDeleting ? "..." : (t("settings.archive.delete") || "Delete")}
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="text-sm font-normal text-navy dark:text-slate-100 whitespace-pre-wrap break-words leading-relaxed pl-1">
                    {message.text}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
