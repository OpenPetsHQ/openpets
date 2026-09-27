<p align="center">
  <img src="assets/openpets.png" alt="OpenPets desktop companion platform" width="100%" />
</p>

<p align="center">
  <strong>デスクトップにペットやプラグイン、オプションのローカルエージェント連携機能を追加する、デスクトップコンパニオンプラットフォーム。</strong>
</p>

<p align="center">
  OpenPetsは、デスクトップ上にアニメーションするコンパニオンを配置します。さらにプラグインを使用することで、作業集中タイマー、リマインダーシステム、ミニゲーム、ランチャー、あるいはコーディングエージェントの相棒へと進化させることができます。
</p>

<p align="center">
  <img src="assets/intro.png" alt="OpenPets reacting across multiple coding agent sessions" width="100%" />
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
  他の言語で読む: <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.zh-Hans.md">简体中文</a> | <a href="README.zh-Hant.md">繁體中文</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.es-419.md">Español (LatAm)</a>
</p>

---

## OpenPetsのダウンロード

**[最新のOpenPetsデスクトップリリースをダウンロード](https://github.com/OpenPetsHQ/openpets/releases/latest)**して起動します。エージェントのセットアップは不要で、すぐにペットが表示されます。

- **Desktop pets**: アイドリング、徘徊、リアクションを行い、ワークスペースの寂しさを和らげるアニメーションコンパニオンです。
- **Official plugins**: 集中タイマー、リマインダー、気分チェックイン、ミニゲーム、起動ショートカット、水分補給の促し、バーチャルペットのステータス機能などがあります。
- **Plugin SDK v3**: 権限、クォータ、ストレージ、スケジュール、コマンド、パネル、イベント、オーディオ、通知などを備えた、新しいペットの機能を構築するためのサンドボックス化されたJavaScript/TypeScriptランタイムです。
- **Optional agent layer**: Claude Code、OpenCode、Cursor、Pi、およびMCPクライアントは、プロンプト、コード、パス、ログ、またはシークレット情報を吹き出しに公開することなく、ローカルなペットのリアクションをトリガーできます。

---

## OpenPetsにスターを送る

OpenPetsによってコーディング環境やデスクトップのワークスペースが少しでも楽しくなったら、ぜひこのリポジトリにスターをお願いします。

<p align="center">
  <img src="assets/star-repo.gif" alt="Starring the OpenPets repository" width="100%" />
</p>

---

## ユーザー向け: はじめに

OpenPetsを楽しむために、開発者である必要や、AIエージェントと接続する必要はありません。デスクトップアプリは、公式プラグインのラインナップとともに、インストールしてすぐに完全に動作します。

### 1. Install OpenPets Desktop

[OpenPets Releases](https://github.com/OpenPetsHQ/openpets/releases/latest)から、お使いのオペレーティングシステム用のパッケージをダウンロードします。

- **macOS Apple Silicon**: `OpenPets-*-mac-arm64.dmg`
- **macOS Intel**: `OpenPets-*-mac-x64.dmg`
- **Windows**: `OpenPets-*-win-x64-setup.exe`
- **Linux**: `OpenPets-*-linux-x86_64.AppImage`

> Note: 現在のビルドは署名されていない場合があります。macOSでセキュリティ警告により実行がブロックされた場合は、ターミナルから以下のコマンドを実行して隔離フラグ（quarantine flag）を削除してください。
> ```bash
> xattr -dr com.apple.quarantine /Applications/OpenPets.app
> ```

### 2. Manage and Customize Pets

インストール済みのペットのブラウズ、アニメーションフレームのプレビュー、および各ワークスペースまたはエージェントウィンドウを監視するペットの設定を、内蔵の **Pet Gallery** から行うことができます。

<p align="center">
  <img src="assets/manage-pets.png" alt="Managing pets in the OpenPets desktop app" width="100%" />
</p>

### 3. Enable Official Plugins

OpenPets v3には、モジュール式の **Official Plugin Catalog** が同梱されています。デスクトップのコントロールセンターを介してプラグインを有効化または設定し、集中タイマー、リマインダー、インタラクティブなミニゲームを追加できます。

#### Shipped official lineup

- **Day Routine**: 習慣をトラックし、ストレッチや休憩を促します。
- **Focus Buddy**: 作業サイクルを管理するためのポモドーロスタイルの集中タイマーです。
- **Fortune Cookie**: ランダムな日々の運勢やアドバイスを表示します。
- **Launch Buddy**: ショートカットコマンドを登録して、ローカルフォルダ、プロジェクト、またはアプリケーションを素早く開くことができます。
- **Magic 8 Ball**: 質問をすると、ペットから遊び心のあるランダムな回答を受け取ることができます。
- **Mood Check-in**: 定期的に気分をチェックし、心の健康をサポートします。
- **Reminders**: スヌーズ可能なベル警告通知を、カスタムオーディオトーンで表示します。
- **Virtual Pet**: デスクトップコンパニオンをたまごっちスタイルのペットにし、空腹度、なつき度、エネルギーレベルをライブステータスピンで追跡します。
- **Water Reminder**: 定期的かつカスタマイズ可能な水分補給の促しによって、水分摂取をサポートします。

---

## Plugin Platform & SDK v3

OpenPetsのプラグインシステムは、カスタムコンパニオンの動作を作成するための、安全で開発者に優しいSDK（`@open-pets/plugin-sdk`）を提供します。

### Security & Architecture
- **Sandboxed Runtime**: 各JSプラグインは、サンドボックス化されたBrowserWindowホスト環境の内部で実行されます。
- **Host-Rendered UI**: プラグインはアクション、HUD、および通知を定義し、デスクトップホストがそれらを描画します。HTML/JSコードは、ペットウィンドウ内で生のHTMLを描画したり、任意のスクリプトを実行したりすることはできません。
- **Permissions Model**: 必要な権限はマニフェストに宣言し、インストール時にユーザーが承認する必要があります。フラグが設定された機微なAPI（`voice:listen`、`clipboard`、`pet:speak:dynamic`など）には、明示的な同意トグルが必要です。
- **SSRF & Private Host Guards**: ネットワークのfetchリクエストは、開発者が宣言したホスト名に制限され、ローカルなSSRFに対してガードされます。

### The SDK surface (`ctx`)
プラグインは `ctx` オブジェクトを介してデスクトップ環境と連携し、以下を提供します。
- `ctx.pets` / `ctx.pet`: デフォルトおよび生成されたペットインスタンスの管理（生成、移動、アニメーション、リアクション）。
- `ctx.ui`: アラート、一時的/ピン留めされた吹き出し、カスタムメニュー、パネル、およびステータスHUD。ピン留めされたミニHUD吹き出しは、Virtual Petステータスのような進行状況バーを含むコンパクトな2x2グリッドレイアウトをサポートします。
- `ctx.audio`: ホストが管理するアラートトーンまたはユーザーがインポートしたカスタムオーディオをトリガーします。
- `ctx.schedule`: 正確なタイマーフック（`once`、`every`、`daily`、`cron`、`at`）を設定します。
- `ctx.ai` / `ctx.secrets`: プラグインソースにAPIキーを公開することなく、ユーザーがホスト側で設定したAIプロバイダー（Anthropic、OpenAI、Ollama）と連携します。
- `ctx.storage`: 変更の購読機能を備えたシンプルなJSONキーバリューストア。
- その他のAPI: `events`、`assets`、`bus`、`net`（ストリーミングサポート付き）、`notify`、`voice`（TTSおよびプッシュトーク式STT）、`auth`（PKCEブラウザフロー）、`files`（安全に選択されたOSダイアログ）、`system`、`commands`、`status`、および `log`。

### Developer Tools & Commands

公式CLIを使用して、プラグインの作成、検証、テストを行います。

#### 1. Scaffold a new plugin
公式レイアウト（`blank`、`reminder`、`ambient`、`ai-chat`、`tamagotchi`、`calendar`）のいずれかからテンプレートを作成します。
```bash
npx @open-pets/cli plugin new "My Plugin" --template tamagotchi
```

#### 2. Validate
パッケージ化する前に、マニフェストのレイアウト、権限、および構成スキーマを検証します。
```bash
npx @open-pets/cli plugin validate ./my-plugin
```

#### 3. Test harness
デスクトップアプリを起動することなく、決定論的なテストを記述できます。`@open-pets/plugin-sdk/testing` の `createTestHarness` を使用して、ホストのモック、クロックの進捗、アクションのトリガー、およびリアクションの検証を行うことができます。
```javascript
import { createTestHarness } from "@open-pets/plugin-sdk/testing";
import { register } from "./index.js";

const h = createTestHarness(register, { permissions: ["pet:speak", "schedule"] });
await h.start();
h.expectScheduled("decay");
await h.clock.advance("30m");
h.expectSpoke(/need attention/i);
```
プラグインプロジェクトからプラグインのテストを実行します。
```bash
npm test
```

---

## Advanced: Agent Integrations

開発エージェントがデスクトップコンパニオンを操作できるようにしたい場合、OpenPetsはオプションのローカルMCP（Model Context Protocol）連携レイヤーを提供します。

<p align="center">
  <img src="assets/integrations.png" alt="OpenPets desktop integrations screen" width="100%" />
</p>

### How it works
エージェントを設定すると、OpenPetsは標準的なMCPツールを公開します。エージェントはアニメーションをトリガーし、ステータスを変更し、ローカルでテキストの吹き出しを表示できます。
1. **Claude Code**: OpenPets MCP、`~/.claude/CLAUDE.md` 内のメモリー指示文、および `~/.claude/settings.json` 内のフックをインストールします。
2. **OpenCode**: OpenPets MCP、カスタムプロジェクトの指示ファイル、および `@open-pets/opencode` 自動フックプラグインをインストールします。
3. **Cursor / Other MCP Clients**: OpenPetsを標準のstdioまたはTCPのMCPサーバーとして登録します。

<p align="center">
  <img src="assets/claude.png" alt="Claude Code integration with OpenPets" width="100%" />
</p>

### MCP Server Configuration
OpenPetsをMCPツールとして実行するには、エージェントの設定にサーバーを追加します。
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
*Tip: 特定のペットを対象にするには、`--pet <petId>` 引数を渡します。*

### Available MCP Tools
- `openpets_status`: 対象のペットIDを取得し、ランタイムの接続状態を確認します。
- `openpets_react`: ペットのリアクションアニメーションを設定します（例: `thinking`、`editing`、`testing`、`success`、`error`）。
- `openpets_say`: 短い吹き出しを表示します。

### Local Privacy & Safety
- すべての自動リアクションは、静的なローカルトリガー（コマンドの実行やファイルの書き込みなど）に基づいて実行されます。
- 発言内容は、機微な変数、パス、シークレット情報、または複数行のコードスニペットの漏洩を防ぐために検証されます。
- リアルタイムのやり取りにはローカルのディスカバリトークンの読み書きが必要であり、外部ネットワークのトリガーからIPCブリッジを保護します。

---

## Development Workspace

OpenPetsコードベースへの貢献、変更のテスト、またはデスクトップパッケージのローカルビルドを行うためのセクションです。

### Prerequisites
- **Node.js**: バージョン 20 以上
- **pnpm**: バージョン 11 以上
- **TypeScript**: コンパイラサポート

### Commands

プロジェクトワークスペースの依存関係をインストールします。
```bash
pnpm install
```

Electronアプリケーションをローカルの開発者モードで起動します。
```bash
pnpm dev:desktop
```

ロードおよび監視されたライブ公式プラグインを使用して起動します。
```bash
pnpm dev:desktop:plugins
```

ワークスペースの型チェック、コード適合性検証、およびテストを実行します。
```bash
pnpm check
pnpm typecheck
pnpm test
```

デスクトップアプリケーションをパッケージ化します。
```bash
# 対象のOSディレクトリへのビルド & パッケージ化
pnpm package:desktop:dir

# 最終的なインストーラー/セットアップアーカイブへのビルド & パッケージ化
pnpm package:desktop
```

### Workspace Structure
```text
apps/desktop              Electron デスクトップアプリケーション
packages/client           @open-pets/client (IPC ヘルパーライブラリ)
packages/mcp              @open-pets/mcp (Model Context Protocol stdio サーバー)
packages/claude           @open-pets/claude (Claude 連携、メモリー、& フック)
packages/opencode         @open-pets/opencode (OpenCode プラグイン & 指示文設定)
packages/pi               @open-pets/pi (Pi CLI 拡張機能連携)
packages/agent-events     共有サニタイザーおよびイベントヘルパーパッケージ
packages/cli              @open-pets/cli (設定 & 雛形作成用ユーザーエントリーポイント CLI)
packages/sdk              @open-pets/plugin-sdk (Plugin SDK v3 宣言 & テストハーネス)
packages/pet-format       @open-pets/pet-format (ペットのマニフェストとスキーマタイプ)
plugins/official          公式のファーストパーティプラグインワークスペース（ホストカタログにバンドル）
docs/                     技術仕様およびアーキテクチャドキュメント
```

---

## Documentation

`docs/` フォルダ内にある詳細なアーキテクチャおよびプラットフォームドキュメントをご覧ください。
- [`docs/plugins.md`](docs/plugins.md) - プラグインプラットフォーム SDK v3 マニフェスト、権限、およびテストキット。
- [`docs/claude-integration.md`](docs/claude-integration.md) - Claude Codeとの連携（メモリー、フック、MCP）。
- [`docs/opencode.md`](docs/opencode.md) - OpenCode ワークスペースとの連携。
- [`docs/wsl-ipc.md`](docs/wsl-ipc.md) - WSLからWindowsへのTCPブリッジの設定。
- [`docs/testing.md`](docs/testing.md) - ワークスペースのテストおよび適合性検証戦略。
- [`docs/release.md`](docs/release.md) - アプリケーションのパッケージングおよびリリースプロセス。
- [`docs/workflow.md`](docs/workflow.md) - コア開発および貢献ワークフロー。

---

## Safety and Privacy

- **Local-Only**: OpenPetsのIPCはローカルソケット/名前付きパイプを使用して動作し、実行ごとに生成されるランダムなセキュリティトークンで保護されています。
- **SSRF Safety**: プラグインのネットワーク接続は承認されたドメインに制限され、ローカルネットワークやプライベートIPへのアクセスはブロックされます。
- **Dynamic Content Sanitization**: AIによる動的な発言テキストは、厳格なローカルフィルターを通過し、パス、URL、シークレット情報、または複数行のコードスニペットが編集（マスク）されます。
- **Sensitive Permission Consent**: クリップボード、マイク、または動的なAI応答にアクセスする機能はデフォルトで無効になっており、ユーザーによる明示的なオプトインが必要です。
