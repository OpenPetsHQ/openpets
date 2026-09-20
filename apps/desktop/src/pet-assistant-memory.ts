import {
  PET_ASSISTANT_ARCHIVED_CONTEXT_MAX_BYTES,
  PET_ASSISTANT_ARCHIVED_CONTEXT_MAX_MESSAGES,
  PET_ASSISTANT_CONVERSATION_ID,
  type PetAssistantArchivedMessage,
  type PetAssistantConversationArchive,
} from "./pet-assistant-archive.js";
import type { PetAssistantMessage, PetAssistantTurnResult } from "./pet-assistant-types.js";

type StoredTurn = {
  readonly archiveTurnId: string;
  readonly messages: readonly PetAssistantMessage[];
};

type ArchiveErrorObserver = (error: unknown) => void;

/** Owns completed active context and its optional terminal-text archive seam. */
export class PetAssistantMemory {
  readonly #maxConversationTurns: number;
  readonly #conversationArchive?: PetAssistantConversationArchive;
  readonly #onConversationArchiveError?: ArchiveErrorObserver;
  readonly #conversations = new Map<string, StoredTurn[]>();

  constructor(
    maxConversationTurns: number,
    conversationArchive?: PetAssistantConversationArchive,
    onConversationArchiveError?: ArchiveErrorObserver,
  ) {
    if (!Number.isInteger(maxConversationTurns) || maxConversationTurns < 1) {
      throw new Error("Invalid assistant conversation-turn limit.");
    }
    this.#maxConversationTurns = maxConversationTurns;
    this.#conversationArchive = conversationArchive;
    this.#onConversationArchiveError = onConversationArchiveError;
  }

  /** Commit a completed turn before attempting its best-effort archive append. */
  commitCompletedTurn(
    conversationId: string,
    archiveTurnId: string,
    result: PetAssistantTurnResult,
    messages: readonly PetAssistantMessage[] | undefined,
  ): void {
    if (result.status !== "completed" || !messages || messages.length === 0) return;

    const turns = this.#conversations.get(conversationId) ?? [];
    turns.push({ archiveTurnId, messages: Object.freeze([...messages]) });
    while (turns.length > this.#maxConversationTurns) turns.shift();
    this.#conversations.set(conversationId, turns);

    this.#archiveTerminalText(conversationId, archiveTurnId, messages);
  }

  /** Return archive context followed by active context for the next prompt. */
  getPromptContext(conversationId: string): readonly PetAssistantMessage[] {
    const history = this.#conversations.get(conversationId) ?? [];
    const activeArchiveTurnIds = new Set(history.map((turn) => turn.archiveTurnId));
    return [
      ...this.#getArchivedContext(conversationId, activeArchiveTurnIds),
      ...history.flatMap((turn) => turn.messages),
    ];
  }

  /** Clear only active context; persisted archive history is managed separately. */
  clearConversation(conversationId: string): void {
    this.#conversations.delete(conversationId);
  }

  getConversationHistory(): readonly PetAssistantArchivedMessage[] {
    if (!this.#conversationArchive) return [];
    return this.#conversationArchive.list();
  }

  deleteConversationHistoryMessage(id: string): boolean {
    return this.#conversationArchive?.deleteMessage(id) ?? false;
  }

  clearConversationHistory(): void {
    this.#conversationArchive?.clear();
  }

  #archiveTerminalText(
    conversationId: string,
    archiveTurnId: string,
    messages: readonly PetAssistantMessage[],
  ): void {
    if (!this.#conversationArchive || conversationId !== PET_ASSISTANT_CONVERSATION_ID) return;
    const user = messages.find((message): message is Extract<PetAssistantMessage, { readonly role: "user" }> => message.role === "user");
    const assistant = [...messages].reverse().find((message): message is Extract<PetAssistantMessage, { readonly role: "assistant" }> => message.role === "assistant"
      && message.toolCalls === undefined && typeof message.content === "string" && message.content.trim() !== "");
    const archived = [
      user && { turnId: archiveTurnId, role: "user" as const, text: user.content },
      assistant && { turnId: archiveTurnId, role: "assistant" as const, text: assistant.content! },
    ].filter((message): message is { readonly turnId: string; readonly role: "user" | "assistant"; readonly text: string } => Boolean(message));
    if (archived.length === 0) return;
    try {
      this.#conversationArchive.append(archived);
    } catch (error) {
      this.#onConversationArchiveError?.(error);
    }
  }

  #getArchivedContext(conversationId: string, activeArchiveTurnIds: ReadonlySet<string>): PetAssistantMessage[] {
    if (!this.#conversationArchive || conversationId !== PET_ASSISTANT_CONVERSATION_ID) return [];
    try {
      return selectArchivedContext(this.#conversationArchive.list(), activeArchiveTurnIds);
    } catch (error) {
      this.#onConversationArchiveError?.(error);
      return [];
    }
  }
}

function selectArchivedContext(messages: readonly PetAssistantArchivedMessage[], activeArchiveTurnIds: ReadonlySet<string>): PetAssistantMessage[] {
  const selected = messages
    .filter((message) => !activeArchiveTurnIds.has(message.turnId))
    .slice(-PET_ASSISTANT_ARCHIVED_CONTEXT_MAX_MESSAGES)
    .map((message): PetAssistantMessage => deepFreeze({ role: message.role, content: message.text }));
  while (selected.length > 0 && jsonByteLength(selected) > PET_ASSISTANT_ARCHIVED_CONTEXT_MAX_BYTES) selected.shift();
  return selected;
}

function byteLength(value: string): number { return Buffer.byteLength(value, "utf8"); }

function jsonByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Assistant data is not JSON-compatible.");
  return byteLength(serialized);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
