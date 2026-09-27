<p align="center">
  <img src="assets/openpets.png" alt="OpenPets desktop companion platform" width="100%" />
</p>

<p align="center">
  <strong>一個包含寵物、外掛程式（Plugins）和可選本地代理（Agent）整合的桌面伴侶平台。</strong>
</p>

<p align="center">
  OpenPets 將一個會動的伴侶帶到您的桌面上，並允許透過外掛程式將其變成專注夥伴、提醒系統、小遊戲、啟動器或編程代理助手。
</p>

<p align="center">
  <img src="assets/intro.png" alt="OpenPets reacting across multiple coding agent sessions" width="100%" />
</p>

<div align="center">
  <p><sub>由 <b>Boring Dystopia Development</b> 製作</sub></p>
  <p>
    <a href="https://boringdystopia.ai/"><img src="https://img.shields.io/badge/boringdystopia.ai-111111?style=for-the-badge&logo=vercel&logoColor=white" alt="boringdystopia.ai"></a>&nbsp;
    <a href="https://x.com/alvinunreal"><img src="https://img.shields.io/badge/X-@alvinunreal-000000?style=for-the-badge&logo=x&logoColor=white" alt="X @alvinunreal"></a>&nbsp;
    <a href="https://t.me/boringdystopiadevelopment"><img src="https://img.shields.io/badge/Telegram-Join%20channel-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram Join channel"></a>&nbsp;
  </p>
</div>

<p align="center">
  其他語言版本：<a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.zh-Hans.md">简体中文</a> | <a href="README.zh-Hant.md">繁體中文</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.es-419.md">Español (LatAm)</a>
</p>

---

## 下載 OpenPets

**[下載最新的 OpenPets 桌面版發行版本](https://github.com/OpenPetsHQ/openpets/releases/latest)**並啟動它。寵物會立即出現；無需設定任何代理（Agent）。

- **桌面寵物**：動作生動的桌面伴侶，會閒置、漫遊、做出反應，讓您的工作空間不再顯得空蕩。
- **官方外掛程式**：專注計時器、提醒事項、心情打卡、迷你遊戲、啟動捷徑、喝水提醒和虛擬寵物數值。
- **外掛程式 SDK v3**：沙盒化的 JavaScript/TypeScript 執行階段，用於建立新的寵物能力，支援權限、配額、儲存空間、排程、指令、面板、事件、音訊、通知等。
- **可選代理層**：Claude Code、OpenCode、Cursor、Pi 及 MCP 用戶端可以驅動本地寵物反應，且不會在對話氣泡中洩露提示詞、程式碼、路徑、日誌或秘密資訊。

---

## 為 OpenPets 點亮星星

如果 OpenPets 讓您的編程環境或桌面工作空間多了一份樂趣，請給本專案一個 Star。

<p align="center">
  <img src="assets/star-repo.gif" alt="Starring the OpenPets repository" width="100%" />
</p>

---

## 使用者指南：開始使用

您不需要是開發人員，也不需要連接任何 AI 代理即可享受 OpenPets。桌面應用程式開箱即可搭配官方外掛程式陣容完全正常運作。

### 1. 安裝 OpenPets 桌面版

從 [OpenPets Releases](https://github.com/OpenPetsHQ/openpets/releases/latest) 下載適用於您作業系統的套件：

- **macOS Apple Silicon**：`OpenPets-*-mac-arm64.dmg`
- **macOS Intel**：`OpenPets-*-mac-x64.dmg`
- **Windows**：`OpenPets-*-win-x64-setup.exe`
- **Linux**：`OpenPets-*-linux-x86_64.AppImage`

> 注意：目前的建置版本可能尚未簽章。如果 macOS 因安全性警告而封鎖執行，請透過終端機移除隔離標記：
> ```bash
> xattr -dr com.apple.quarantine /Applications/OpenPets.app
> ```

### 2. 管理與自訂寵物

透過內建的 **寵物展示館 (Pet Gallery)** 瀏覽已安裝的寵物、預覽其動畫畫面，並配置哪隻寵物監控每個工作空間或代理視窗。

<p align="center">
  <img src="assets/manage-pets.png" alt="Managing pets in the OpenPets desktop app" width="100%" />
</p>

### 3. 啟用官方外掛程式

OpenPets v3 隨附了模組化的**官方外掛程式目錄 (Official Plugin Catalog)**。您可以透過桌面控制中心（Control Center）啟用或設定外掛程式，以加入專注計時器、提醒事項和互動小遊戲。

#### 隨附的官方陣容

- **Day Routine**：追蹤習慣，並提醒您伸展身體或暫時離開。
- **Focus Buddy**：番茄鐘風格的專注計時器，用於管理工作週期。
- **Fortune Cookie**：隨機拆開每日建議與智慧語錄。
- **Launch Buddy**：允許註冊快速鍵指令，以快速開啟本地資料夾、專案或應用程式。
- **Magic 8 Ball**：向您的寵物提問並獲得趣味、隨機的回答。
- **Mood Check-in**：定期記錄您的心情，以支援情緒健康。
- **Reminders**：轉譯出可延期的鈴聲警示通知，並可自訂音效。
- **Virtual Pet**：將您的桌面伴侶變成電子雞風格的寵物，並透過即時狀態釘選追蹤飢餓度、好感度和精力值。
- **Water Reminder**：透過定期且可自訂的飲水提示，讓您保持充足水分。

---

## 外掛程式平台與 SDK v3

OpenPets 外掛程式系統提供了一個安全、開發人員友好的 SDK (`@open-pets/plugin-sdk`)，用於建立自訂伴侶行為。

### 安全性與編製架構
- **沙盒化執行階段**：每個 JS 外掛程式都執行在沙盒化的 BrowserWindow 宿主環境中。
- **宿主轉譯的 UI**：外掛程式宣告動作、HUD 與通知；桌面宿主則負責將其轉譯。HTML/JS 程式碼無法在寵物視窗內轉譯原始 HTML 或執行任意指令碼。
- **權限模型**：權限必須在資訊清單（Manifest）中宣告，並在安裝時由使用者核准。被標記為敏感的 API（例如 `voice:listen`、`clipboard` 及 `pet:speak:dynamic`）需要明確的同意切換開關。
- **SSRF 與私有主機防護**：網路 fetch 請求僅限於開發人員宣告的主機名稱，並針對本地 SSRF 進行防禦。

### SDK 介面 (`ctx`)
外掛程式透過 `ctx` 物件與桌面環境對接，提供：
- `ctx.pets` / `ctx.pet`：管理預設及產生的寵物執行個體：產生、移動、播放動畫和做出反應。
- `ctx.ui`：警示、暫時/釘選的氣泡框、自訂選單、面板和狀態 HUD。釘選的微型 HUD 氣泡支援具有進度條的緊湊 2x2 網格版面配置，例如虛擬寵物數值。
- `ctx.audio`：觸發宿主管理的警示音效，或使用者匯入的自訂音效。
- `ctx.schedule`：設定精確的計時器掛鉤（`once`、`every`、`daily`、`cron`、`at`）。
- `ctx.ai` / `ctx.secrets`：對接使用者在宿主端設定的 AI 提供商（Anthropic、OpenAI、Ollama），而不會向外掛程式原始碼洩露 API 金鑰。
- `ctx.storage`：支援變更訂閱的簡易 JSON 鍵值（Key-Value）儲存空間。
- 其他 API：`events`、`assets`、`bus`、`net`（支援串流）、`notify`、`voice`（TTS 與隨按即說 STT）、`auth`（PKCE 瀏覽器流程）、`files`（安全選取的作業系統對話框）、`system`、`commands`、`status` 及 `log`。

### 開發人員工具與指令

使用官方 CLI 建立、驗證和測試外掛程式。

#### 1. 建立新外掛程式的主架構
從任何官方版面配置（`blank`、`reminder`、`ambient`、`ai-chat`、`tamagotchi`、`calendar`）建立範本：
```bash
npx @open-pets/cli plugin new "My Plugin" --template tamagotchi
```

#### 2. 驗證
在封裝前驗證資訊清單版面配置、權限和設定結構（Schema）：
```bash
npx @open-pets/cli plugin validate ./my-plugin
```

#### 3. 測試治具
無需啟動桌面應用程式即可撰寫決定性的測試。使用 `@open-pets/plugin-sdk/testing` 的 `createTestHarness`，您可以模擬宿主、前進時鐘、觸發動作並驗證反應：
```javascript
import { createTestHarness } from "@open-pets/plugin-sdk/testing";
import { register } from "./index.js";

const h = createTestHarness(register, { permissions: ["pet:speak", "schedule"] });
await h.start();
h.expectScheduled("decay");
await h.clock.advance("30m");
h.expectSpoke(/need attention/i);
```
從您的外掛程式專案中執行外掛程式測試：
```bash
npm test
```

---

## 進階：代理（Agent）整合

如果您希望您的開發代理驅動您的桌面伴侶，OpenPets 提供了一個選用的本地 MCP (Model Context Protocol) 整合層。

<p align="center">
  <img src="assets/integrations.png" alt="OpenPets desktop integrations screen" width="100%" />
</p>

### 運作原理
當您設定代理時，OpenPets 會公開標準的 MCP 工具。代理可以在本地觸發動畫、變更狀態並顯示文字對話氣泡：
1. **Claude Code**：安裝 OpenPets MCP、`~/.claude/CLAUDE.md` 中的記憶指令，以及 `~/.claude/settings.json` 中的掛鉤。
2. **OpenCode**：安裝 OpenPets MCP、自訂專案指令檔案，以及 `@open-pets/opencode` 自動掛鉤外掛程式。
3. **Cursor / 其他 MCP 用戶端**：將 OpenPets 註冊為標準的 stdio 或 TCP MCP 伺服器。

<p align="center">
  <img src="assets/claude.png" alt="Claude Code integration with OpenPets" width="100%" />
</p>

### MCP 伺服器設定
若要將 OpenPets 作為 MCP 工具執行，請將該伺服器加入您的代理設定中：
```json
{
  "mcpServers": {
    "openpets": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@open-pets/mcp@latest"]
    }
  }
}
```
*提示：若要指定特定的寵物，請傳遞 `--pet <petId>` 引數。*

### 可用的 MCP 工具
- `openpets_status`：獲取目標寵物 ID 並檢查執行階段連線狀態。
- `openpets_react`：設定寵物反應動畫（例如 `thinking`、`editing`、`testing`、`success`、`error`）。
- `openpets_say`：顯示簡短的對話氣泡框。

### 本地隱私與安全
- 所有自動反應都基於靜態本地觸發條件執行（例如：當執行某個指令或寫入某個檔案時）。
- 對話內容經過驗證，以防止洩露敏感變數、路徑、秘密資訊或多行程式碼片段。
- 即時互動需要寫入/讀取本地探索權杖（Discovery Token），以保護 IPC 橋接免受外部網路觸發。

---

## 開發工作空間

用於對 OpenPets 程式碼庫做出貢獻、測試變更，或在本地建置桌面套件。

### 先決條件
- **Node.js**：版本 20 或更高
- **pnpm**：版本 11 或更高
- **TypeScript**：編譯器支援

### 指令

安裝專案工作空間相依性：
```bash
pnpm install
```

在本地開發模式下啟動 Electron 應用程式：
```bash
pnpm dev:desktop
```

啟動並載入與監控即時的官方外掛程式：
```bash
pnpm dev:desktop:plugins
```

執行工作空間類型檢查、程式碼合規性驗證及測試：
```bash
pnpm check
pnpm typecheck
pnpm test
```

封裝桌面應用程式：
```bash
# 建置並封裝至目標作業系統的目錄中
pnpm package:desktop:dir

# 建置並封裝成最終的安裝程式 / 安裝封存檔
pnpm package:desktop
```

### 工作空間結構
```text
apps/desktop              Electron 桌面應用程式
packages/client           @open-pets/client (IPC 協助程式庫)
packages/mcp              @open-pets/mcp (Model Context Protocol stdio 伺服器)
packages/claude           @open-pets/claude (Claude 整合、記憶與掛鉤)
packages/opencode         @open-pets/opencode (OpenCode 外掛程式與指令設定)
packages/pi               @open-pets/pi (Pi CLI 擴充功能整合)
packages/agent-events     共享的篩選器與事件協助程式套件
packages/cli              @open-pets/cli (用於設定與架構建立的使用者進入點 CLI)
packages/sdk              @open-pets/plugin-sdk (外掛程式 SDK v3 宣告與測試治具)
packages/pet-format       @open-pets/pet-format (寵物資訊清單與結構類型)
plugins/official          官方第一方外掛程式工作空間（與宿主目錄搭售）
docs/                     技術規格與架構文件
```

---

## 文件

在 `docs/` 資料夾中探索詳細的架構與平台文件：
- [`docs/plugins.md`](docs/plugins.md) - 外掛程式平台 SDK v3 資訊清單、權限與測試套件。
- [`docs/claude-integration.md`](docs/claude-integration.md) - 與 Claude Code 整合（記憶、掛鉤、MCP）。
- [`docs/opencode.md`](docs/opencode.md) - 與 OpenCode 工作空間整合。
- [`docs/wsl-ipc.md`](docs/wsl-ipc.md) - 設定 WSL 至 Windows 的 TCP 橋接。
- [`docs/testing.md`](docs/testing.md) - 工作空間測試與合規性策略。
- [`docs/release.md`](docs/release.md) - 應用程式封裝與發行程序。
- [`docs/workflow.md`](docs/workflow.md) - 核心開發與貢獻工作流程。

---

## 安全與隱私

- **僅限本地執行**：OpenPets IPC 使用本地通訊端（Socket）/命名管道（Named pipe）運作，並透過每次執行時產生的隨機安全性權杖來確保安全。
- **SSRF 安全防護**：外掛程式網路連線限制在已核准的網域，並封鎖對本地網路/私有 IP 的存取。
- **動態內容淨化**：任何動態 AI 對話文字都會通過嚴格的本地篩選器，以遮蔽路徑、URL、秘密資訊或多行程式碼片段。
- **敏感權限同意**：存取剪貼簿、麥克風或動態 AI 回應的功能預設為關閉，並需要使用者明確選擇加入。