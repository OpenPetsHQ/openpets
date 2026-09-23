export type TalkSnapshot = {
  readonly status?: string;
  readonly activity?: string | null;
  readonly muted?: boolean;
  readonly canSubmitRecording?: boolean;
};

export type TalkButtonAction = "toggle" | "none";

export type TalkButtonPresentation = {
  readonly action: TalkButtonAction;
  readonly disabled: boolean;
  readonly active: boolean;
  readonly processing: boolean;
  readonly label: string;
  readonly ariaLabel: string;
  readonly title: string;
};

/** Derive the semantic action represented by the on-pet Talk button. */
export function deriveTalkButtonPresentation(snapshot: TalkSnapshot | null | undefined): TalkButtonPresentation {
  const status = snapshot?.status;
  const isEnded = !snapshot || status === "idle" || status === "ended" || !status;
  if (isEnded) {
    return {
      action: "toggle",
      disabled: false,
      active: false,
      processing: false,
      label: "Talk",
      ariaLabel: "Talk to companion",
      title: "Talk to companion",
    };
  }

  if (snapshot?.canSubmitRecording === true) {
    return {
      action: "toggle",
      disabled: false,
      active: true,
      processing: false,
      label: "Stop recording and send",
      ariaLabel: "Stop recording and send",
      title: "Stop recording and send",
    };
  }

  const label = snapshot?.activity === "speaking"
    ? "Speaking..."
    : snapshot?.activity === "thinking"
      ? "Thinking..."
      : snapshot?.activity === "acting"
        ? "Acting..."
        : "Processing...";

  return {
    action: "none",
    disabled: true,
    active: false,
    processing: true,
    label,
    ariaLabel: label,
    title: label,
  };
}

export type FullPanelVoiceAction = "start" | "retry" | "unmute" | "mute";

/** Full-panel voice controls have their own action contract, separate from on-pet Talk. */
export function deriveFullPanelVoiceAction(snapshot: TalkSnapshot | null | undefined): FullPanelVoiceAction {
  const status = snapshot?.status;
  if (!snapshot || status === "idle" || status === "ended" || !status) return "start";
  if (status === "paused") return "retry";
  if (snapshot.muted === true) return "unmute";
  return "mute";
}

export type ConversationSnapshotOrder = {
  readonly sequence: number;
  readonly revision: number;
};

export function conversationSnapshotOrder(snapshot: { readonly lastSequence: number; readonly revision: number }): ConversationSnapshotOrder {
  return { sequence: snapshot.lastSequence, revision: snapshot.revision };
}

export function shouldAcceptConversationSnapshot(
  previous: ConversationSnapshotOrder,
  snapshot: { readonly lastSequence: number; readonly revision: number },
): boolean {
  const next = conversationSnapshotOrder(snapshot);
  return next.sequence > previous.sequence
    || (next.sequence === previous.sequence && next.revision > previous.revision);
}

export type TalkSnapshotOrder = {
  readonly sessionId: number;
  readonly sequence: number;
};

export function talkSnapshotOrder(sessionId: number, sequence: number): TalkSnapshotOrder {
  return { sessionId, sequence };
}

export function shouldAcceptTalkSnapshot(previous: TalkSnapshotOrder, sessionId: number, sequence: number): boolean {
  return sessionId > previous.sessionId
    || (sessionId === previous.sessionId && sequence > previous.sequence);
}

/**
 * Prompt suggestions are conversation starters: only offered on an empty,
 * idle conversation. Once any message exists they would crowd the transcript.
 */
export function shouldShowPromptSuggestions(
  snapshot: { readonly activity?: unknown; readonly items?: readonly unknown[] } | null | undefined,
  suggestionCount: number,
): boolean {
  if (!snapshot || suggestionCount <= 0) return false;
  const isEmpty = (snapshot.items?.length ?? 0) === 0;
  return snapshot.activity === "idle" && isEmpty;
}

export function assistantDisplayName(displayName?: unknown, assetName?: unknown): string {
  for (const value of [displayName, assetName]) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "Assistant";
}

export type ChatDraftState = {
  readonly draft: string;
  readonly expanded: boolean;
  readonly compactOpen: boolean;
};

export type ChatDraftTransition =
  | { readonly type: "draft-changed"; readonly draft: string }
  | { readonly type: "expanded-changed"; readonly expanded: boolean }
  | { readonly type: "compact-changed"; readonly compactOpen: boolean };

/** Keep draft preservation rules in one small, renderer-independent helper. */
export function transitionChatDraft(state: ChatDraftState, transition: ChatDraftTransition): ChatDraftState {
  switch (transition.type) {
    case "draft-changed":
      return { ...state, draft: transition.draft };
    case "expanded-changed":
      return { ...state, expanded: transition.expanded };
    case "compact-changed":
      return { ...state, compactOpen: transition.compactOpen };
  }
}
