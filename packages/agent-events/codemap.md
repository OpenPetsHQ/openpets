# packages/agent-events/

Speech pools and validation for agent feedback messages.

## Responsibility

Provides categorized speech pools (thinking, success, error, permission, question) and validation logic for agent-facing messages. Ensures messages are safe (no code, URLs, paths, secrets) and appropriately sized (1-140 chars, single line).

## Design

**Category-Based Pools**: Five speech categories with curated message pools:
- `thinking`: "Thinking it through", "Let me check", etc.
- `success`: "Done", "That worked", etc.
- `error`: "Something failed", "Needs another look", etc.
- `permission`: "Approval needed"
- `question`: "Question for you", "Quick question", "Need your input"

**Validation Strategy**: Regex-based validation rejecting:
- Multi-line content (`\r|\n`)
- Code-like patterns (backticks, keywords, braces)
- URLs (`https?://`, `www.`)
- File paths (slashes, drive letters)
- Secrets (`api_key`, `secret`, `password`, `token`)

**Random Selection**: `pickHookSpeech()` uses bounded random index selection with fallback chains.

## Flow

```
Agent Event → pickHookSpeech(category, randomFn) → validateHookSpeech(message) → Safe message
```

## Integration Points

**Consumers**:
- `@open-pets/claude` - Hook message generation
- `@open-pets/opencode` - Plugin speech events

**Exports**:
- `hookSpeechPools` - Readonly record of message arrays
- `pickHookSpeech()` - Random selection with bounds checking
- `validateHookSpeech()` - Security validation
- `HookSpeechCategory` - Type union for categories
