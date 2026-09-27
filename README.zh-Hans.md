<p align="center">
  <img src="assets/openpets.png" alt="OpenPets 桌面伴侣平台" width="100%" />
</p>

<p align="center">
  <strong>一款带有宠物、插件和可选本地智能体集成的桌面伴侣平台。</strong>
</p>

<p align="center">
  OpenPets 在您的桌面上放置一个动画伴侣，然后让插件将其转变为专注伙伴、提醒系统、小游戏、启动器或编码智能体助手。
</p>

<p align="center">
  <img src="assets/intro.png" alt="OpenPets 在多个编码智能体会话中的反应" width="100%" />
</p>

<div align="center">
  <p><sub>by <b>Boring Dystopia Development</b></sub></p>
  <p>
    <a href="https://boringdystopia.ai/"><img src="https://img.shields.io/badge/boringdystopia.ai-111111?style=for-the-badge&logo=vercel&logoColor=white" alt="boringdystopia.ai"></a>&nbsp;
    <a href="https://x.com/alvinunreal"><img src="https://img.shields.io/badge/X-@alvinunreal-000000?style=for-the-badge&logo=x&logoColor=white" alt="X @alvinunreal"></a>&nbsp;
    <a href="https://t.me/boringdystopiadevelopment"><img src="https://img.shields.io/badge/Telegram-Join%20channel-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram Join channel"></a>&nbsp;
  </p>
</div>

<p align="center">
  其他语言版本：<a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.zh-Hans.md">简体中文</a> | <a href="README.zh-Hant.md">繁體中文</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.es-419.md">Español (LatAm)</a>
</p>

---

## 下载 OpenPets

**[下载最新的 OpenPets 桌面版本](https://github.com/OpenPetsHQ/openpets/releases/latest)** 并启动它。宠物会立即出现；无需设置智能体。

- **桌面宠物**：在桌面上闲逛、漫游、做出反应，并防止您的工作空间显得空荡荡的动画伴侣。
- **官方插件**：专注计时器、提醒、情绪记录、小游戏、启动快捷方式、喝水提醒和虚拟宠物属性。
- **Plugin SDK v3**：用于构建全新宠物能力的沙箱化 JavaScript/TypeScript 运行时，支持权限、配额、存储、计划任务、命令、面板、事件、音频、通知等功能。
- **可选智能体层**：Claude Code、OpenCode、Cursor、Pi 和 MCP 客户端可以驱动本地的宠物反应，而无需在对话气泡中暴露提示词、代码、路径、日志或密钥。

---

## 给 OpenPets 点亮星星

如果 OpenPets 让您的编码设置或桌面工作空间变得更有趣，请给这个仓库一个 Star。

<p align="center">
  <img src="assets/star-repo.gif" alt="给 OpenPets 仓库点亮星星" width="100%" />
</p>

---

## 用户指南：开始使用

您不需要是开发者，也不需要连接任何 AI 智能体即可享受 OpenPets。桌面应用程序开箱即用，内置官方插件系列，功能完整。

### 1. 安装 OpenPets 桌面端

从 [OpenPets Releases](https://github.com/OpenPetsHQ/openpets/releases/latest) 下载适用于您操作系统的安装包：

- **macOS Apple Silicon**：`OpenPets-*-mac-arm64.dmg`
- **macOS Intel**：`OpenPets-*-mac-x64.dmg`
- **Windows**：`OpenPets-*-win-x64-setup.exe`
- **Linux**：`OpenPets-*-linux-x86_64.AppImage`

> 注意：当前构建版本可能未签名。如果 macOS 因安全警告阻止运行，请通过终端清除 quarantine 隔离标志：
> ```bash
> xattr -dr com.apple.quarantine /Applications/OpenPets.app
> ```

### 2. 管理和自定义宠物

在内置的**宠物画廊**中浏览已安装的宠物、预览其动画帧，并配置由哪个宠物来监控各个工作空间或智能体窗口。

<p align="center">
  <img src="assets/manage-pets.png" alt="在 OpenPets 桌面应用中管理宠物" width="100%" />
</p>

### 3. 启用官方插件

OpenPets v3 附带了一个模块化的**官方插件目录**。您可以通过桌面控制中心启用或配置插件，以添加专注计时器、提醒和小互动游戏。

#### 内置官方插件列表

- **Day Routine**：跟踪习惯并提醒您拉伸身体或走动走动。
- **Focus Buddy**：番茄钟风格的专注计时器，用于管理工作周期。
- **Fortune Cookie**：开启随机的每日建议与智慧之言。
- **Launch Buddy**：允许注册快捷命令，以快速打开本地文件夹、项目或应用程序。
- **Magic 8 Ball**：向您的宠物提问，并获得好玩的、随机的回答。
- **Mood Check-in**：定期检查您的情绪，以支持情绪健康。
- **Reminders**：渲染可稍后提醒的铃声警报通知，并伴有自定义音效。
- **Virtual Pet**：将您的桌面伴侣变成拓麻歌子 (Tamagotchi) 风格的宠物，通过实时状态钉 (live status pin) 跟踪饥饿值、好感度和精力值。
- **Water Reminder**：通过定期且可自定义的饮水提示让您保持水分。

---

## 插件平台与 SDK v3

OpenPets 插件系统提供了一个安全且开发者友好的 SDK (`@open-pets/plugin-sdk`)，用于创建自定义伴侣行为。

### 安全与架构
- **沙箱化运行时 (Sandboxed Runtime)**：每个 JS 插件都在沙箱化的 BrowserWindow 宿主环境中运行。
- **宿主渲染 UI (Host-Rendered UI)**：插件声明动作、HUD 和通知；桌面宿主负责渲染它们。HTML/JS 代码无法在宠物窗口内渲染原始 HTML 或执行任意脚本。
- **权限模型 (Permissions Model)**：必须在清单 (manifest) 中声明权限，并在安装时由用户批准。被标记为敏感的 API（如 `voice:listen`、`clipboard` 和 `pet:speak:dynamic`）需要用户手动开启显式同意。
- **SSRF 与私有主机防御**：网络 fetch 请求仅限于开发者声明的主机名，并防范本地 SSRF。

### SDK 接口 (`ctx`)
插件通过 `ctx` 对象接入桌面环境，该对象暴露了：
- `ctx.pets` / `ctx.pet`：管理 default 和 spawned 宠物实例：生成 (spawn)、移动、播放动画和做出反应。
- `ctx.ui`：警报、临时/固定气泡、自定义菜单、面板和状态 HUD。固定的迷你 HUD 气泡支持紧凑的 2x2 网格布局和进度条，例如 Virtual Pet 的属性统计。
- `ctx.audio`：触发宿主管理的警报音或用户导入的自定义音频。
- `ctx.schedule`：设置精准的定时器钩子（`once`、`every`、`daily`、`cron`、`at`）。
- `ctx.ai` / `ctx.secrets`：接入用户在宿主端配置的 AI 提供商（Anthropic、OpenAI、Ollama），而无需向插件源码暴露 API 密钥。
- `ctx.storage`：带有变更订阅的简单 JSON 键值存储。
- 其他 API：`events`、`assets`、`bus`、`net`（支持流式传输）、`notify`、`voice`（TTS 和按住说话 STT）、`auth`（PKCE 浏览器流程）、`files`（安全选择的系统对话框）、`system`、`commands`、`status` 和 `log`。

### 开发者工具与命令

使用官方 CLI 创建、验证和测试插件。

#### 1. 脚手架新插件
从任何官方布局（`blank`、`reminder`、`ambient`、`ai-chat`、`tamagotchi`、`calendar`）创建模板：
```bash
npx @open-pets/cli plugin new "My Plugin" --template tamagotchi
```

#### 2. 验证
在打包前验证清单布局、权限和配置模式 (schemas)：
```bash
npx @open-pets/cli plugin validate ./my-plugin
```

#### 3. 测试工具包 (Test harness)
无需启动桌面应用即可编写确定性的测试。使用 `@open-pets/plugin-sdk/testing` 中的 `createTestHarness`，您可以模拟宿主、推进时钟、触发动作并验证反应：
```javascript
import { createTestHarness } from "@open-pets/plugin-sdk/testing";
import { register } from "./index.js";

const h = createTestHarness(register, { permissions: ["pet:speak", "schedule"] });
await h.start();
h.expectScheduled("decay");
await h.clock.advance("30m");
h.expectSpoke(/need attention/i);
```
在您的插件项目中运行插件测试：
```bash
npm test
```

---

## 高级：智能体集成

如果您希望您的开发智能体（development agent）驱动您的桌面伴侣，OpenPets 提供了可选的本地 MCP (Model Context Protocol) 集成层。

<p align="center">
  <img src="assets/integrations.png" alt="OpenPets 桌面集成界面" width="100%" />
</p>

### 工作原理
当您配置好智能体时，OpenPets 会暴露标准的 MCP 工具。智能体可以触发动画、更改状态并在本地显示对话气泡：
1. **Claude Code**：安装 OpenPets MCP，在 `~/.claude/CLAUDE.md` 中写入记忆指令，并在 `~/.claude/settings.json` 中配置钩子。
2. **OpenCode**：安装 OpenPets MCP、自定义项目指令文件以及 `@open-pets/opencode` 自动挂钩插件。
3. **Cursor / 其他 MCP 客户端**：将 OpenPets 注册为标准的 stdio 或 TCP MCP 服务端。

<p align="center">
  <img src="assets/claude.png" alt="Claude Code 与 OpenPets 的集成" width="100%" />
</p>

### MCP 服务端配置
要将 OpenPets 作为 MCP 工具运行，请将该服务端添加到您的智能体配置中：
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
*提示：若要针对特定宠物，请传递 `--pet <petId>` 参数。*

### 可用 MCP 工具
- `openpets_status`：获取目标宠物 ID 并检查运行时连接状态。
- `openpets_react`：设置宠物反应动画（例如：`thinking`、`editing`、`testing`、`success`、`error`）。
- `openpets_say`：显示一个简短的对话气泡。

### 本地隐私与安全
- 所有自动化的反应都运行在静态的本地触发器上（例如：当运行命令或写入文件时）。
- 对话内容会经过验证，以防止泄漏敏感变量、路径、密钥或多行代码片段。
- 实时交互需要本地的发现令牌 (discovery token) 的写入/读取，以保护 IPC 桥免受外部网络触发。

---

## 开发工作空间

用于参与 OpenPets 代码库贡献、测试更改或在本地构建桌面安装包。

### 前提条件
- **Node.js**：20 或更高版本
- **pnpm**：11 或更高版本
- **TypeScript**：编译器支持

### 命令

安装项目工作空间依赖项：
```bash
pnpm install
```

在本地开发模式下启动 Electron 应用程序：
```bash
pnpm dev:desktop
```

启动并加载和监控实时的官方插件：
```bash
pnpm dev:desktop:plugins
```

运行工作空间类型检查、代码规范性验证 and 测试：
```bash
pnpm check
pnpm typecheck
pnpm test
```

打包桌面应用程序：
```bash
# 构建并打包到目标操作系统目录
pnpm package:desktop:dir

# 构建并打包成最终的安装程序 / 安装包归档
pnpm package:desktop
```

### 工作空间结构
```text
apps/desktop              Electron 桌面应用程序
packages/client           @open-pets/client (IPC 助手库)
packages/mcp              @open-pets/mcp (Model Context Protocol stdio 服务端)
packages/claude           @open-pets/claude (Claude 集成、记忆与钩子)
packages/opencode         @open-pets/opencode (OpenCode 插件与指令配置)
packages/pi               @open-pets/pi (Pi CLI 扩展集成)
packages/agent-events     共享清理器 (sanitizers) 和事件助手包
packages/cli              @open-pets/cli (用于配置和脚手架的用户入口 CLI)
packages/sdk              @open-pets/plugin-sdk (插件 SDK v3 声明与测试工具包)
packages/pet-format       @open-pets/pet-format (宠物清单和 Schema 类型)
plugins/official          官方第一方插件工作空间（与宿主目录打包在一起）
docs/                     技术规范与架构文档
```

---

## 文档

探索 `docs/` 文件夹中详细的架构和平台文档：
- [`docs/plugins.md`](docs/plugins.md) - 插件平台 SDK v3 清单、权限及测试工具包。
- [`docs/claude-integration.md`](docs/claude-integration.md) - 与 Claude Code 的集成（记忆、钩子、MCP）。
- [`docs/opencode.md`](docs/opencode.md) - 与 OpenCode 工作空间的集成。
- [`docs/wsl-ipc.md`](docs/wsl-ipc.md) - 设置 WSL 到 Windows 的 TCP 桥接。
- [`docs/testing.md`](docs/testing.md) - 工作空间测试与一致性策略。
- [`docs/release.md`](docs/release.md) - 应用程序打包与发布流程。
- [`docs/workflow.md`](docs/workflow.md) - 核心开发与贡献工作流。

---

## 安全与隐私

- **仅限本地 (Local-Only)**：OpenPets IPC 使用本地套接字/命名管道工作，并使用每次运行随机的安全令牌进行保护。
- **SSRF 安全**：插件的网络连接仅限于批准的域名，并阻止对本地网络/私有 IP 的访问。
- **动态内容净化 (Dynamic Content Sanitization)**：任何动态 AI 对话文本都会通过严格的本地过滤器，以过滤脱敏路径、URL、密钥或多行代码片段。
- **敏感权限同意**：访问剪贴板、麦克风或动态 AI 响应的功能默认关闭，需要用户显式授权。
