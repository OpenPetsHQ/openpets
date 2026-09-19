export type PetAssistantArchivedMessage = {
  readonly id: string;
  readonly conversationId: "openpets-control-center-current";
  readonly turnId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: number;
};

export type ConversationArchiveSectionApi = {
  getConversationHistory(): Promise<readonly PetAssistantArchivedMessage[]>;
  deleteConversationHistoryMessage(id: string): Promise<{ deleted: boolean }>;
  clearConversationHistory(): Promise<{ cleared: true }>;
};

export type ConversationArchiveSectionProps = {
  readonly busy?: string;
  readonly run?: (label: string, fn: () => Promise<void>) => Promise<void>;
  readonly setMessage?: (msg: string) => void;
  readonly setError?: (err: string) => void;
  readonly api?: ConversationArchiveSectionApi;
};
