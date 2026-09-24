# @open-pets/dsh

Cordis plugin connecting the [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) agent runtime directly to the [OpenPets](https://openpets.dev) desktop companion.

## Features

- **Lifecycle Reactions**: Synchronizes DSH agent status (`running` ⇄ `idle`), errors, and approval requests with companion emotions.
- **Status Stream Awareness**: Extracts `⏵` status lines from assistant stream chunks and displays them in companion speech bubbles.
- **Tool Operation Reactions**: Maps `bash` executions (`running`), `edit`/`write` operations (`editing`), and `read` operations (`working`).
- **Toggleable Configuration**: Enable or disable per profile or dynamically via Cordis plugin configuration.
- **Safe & Fail-safe**: Automatically sanitizes paths and messages, strips URLs/secrets, throttles speech rate, and isolates IPC failures so the agent loop never stalls.

## Installation

Add to your DSH profile or user configuration (`~/.dsh/cordis.patch.yml`):

```yaml
- insert:
    - id: plugin-openpets-dsh
      name: '@open-pets/dsh'
      disabled: false
      config:
        enabled: true
        minSpeechIntervalMs: 1200
        enableStatusLineStream: true
        enableToolEvents: true
        enableApprovalEvents: true
```

## Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master switch to enable or disable listener registration. |
| `minSpeechIntervalMs` | `number` | `1200` | Minimum interval (in ms) between speech bubble notifications. |
| `enableStatusLineStream` | `boolean` | `true` | Forward `⏵` status lines from assistant stream chunks. |
| `enableToolEvents` | `boolean` | `true` | React to tool executions (`bash`, `edit`, `write`, `read`). |
| `enableApprovalEvents` | `boolean` | `true` | Announce when an approval request is waiting for human permission. |

## Event Mappings

| DSH Event | OpenPets Reaction | Speech Behavior |
|---|---|---|
| `agent/status: running` | `thinking` | Curated thinking speech |
| `agent/status: idle` | `success` | Curated success speech (suppressed for 5s after errors) |
| `agent/error` | `error` | Curated error speech |
| `approval/request` | `waiting` | Curated permission speech |
| `agent/assistant-stream` | `working` | Sanitized `⏵` status line |
| `tools/result (bash)` | `running` | Sanitized tool description |
| `tools/result (edit/write)` | `editing` | Sanitized file action |
| `tools/result (read)` | `working` | Sanitized read action |

## License

MIT
