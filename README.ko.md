<p align="center">
  <img src="assets/openpets.png" alt="OpenPets 데스크톱 컴패니언 플랫폼" width="100%" />
</p>

<p align="center">
  <strong>데스크톱 펫, 플러그인, 그리고 선택적인 로컬 에이전트 연동을 지원하는 데스크톱 컴패니언 플랫폼.</strong>
</p>

<p align="center">
  OpenPets는 데스크톱에 움직이는 컴패니언을 띄워 주며, 플러그인을 통해 집중 도우미, 알림 시스템, 미니 게임, 런처, 또는 코딩 에이전트 조수 등으로 다양하게 변신시킬 수 있습니다.
</p>

<p align="center">
  <img src="assets/intro.png" alt="여러 코딩 에이전트 세션에 걸쳐 반응하는 OpenPets" width="100%" />
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
  다른 언어로 읽기: <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.zh-Hans.md">简体中文</a> | <a href="README.zh-Hant.md">繁體中文</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.es-419.md">Español (LatAm)</a>
</p>

---

## Download OpenPets

**[최신 OpenPets 데스크톱 릴리스 다운로드](https://github.com/OpenPetsHQ/openpets/releases/latest)** 후 실행해 보세요. 에이전트 설정 없이도 펫이 즉시 나타납니다.

- **데스크톱 펫**: 대기, 배회, 반응 등의 모션으로 작업 공간을 심심하지 않게 채워주는 움직이는 컴패니언입니다.
- **공식 플러그인**: 집중 타이머, 알림, 감정 상태 체크인, 미니 게임, 실행 바로가기, 수분 섭취 미리 알림, 가상 펫 스탯 기능을 제공합니다.
- **플러그인 SDK v3**: 권한(permissions), 쿼터(quotas), 스토리지, 스케줄러, 명령어, 패널, 이벤트, 오디오, 알림 기능 등을 사용하여 새로운 펫 능력을 개발할 수 있는 샌드박스화된 JavaScript/TypeScript 런타임입니다.
- **선택적인 에이전트 레이어**: Claude Code, OpenCode, Cursor, Pi 및 MCP 클라이언트가 프롬프트, 코드, 경로, 로그, 보안 비밀번호(secrets) 등을 말풍선에 노출하지 않고도 로컬 펫의 반응을 트리거할 수 있도록 지원합니다.

---

## Star OpenPets

OpenPets가 개발 환경이나 데스크톱 작업 공간을 더 즐겁게 만들어 주었다면 저장소에 스타(Star)를 눌러 주세요.

<p align="center">
  <img src="assets/star-repo.gif" alt="OpenPets 저장소 스타(Star) 하기" width="100%" />
</p>

---

## For Users: Getting Started

OpenPets를 즐기기 위해 개발자이거나 AI 에이전트를 연결할 필요는 없습니다. 데스크톱 앱은 공식 플러그인 라인업과 함께 설치 즉시 완벽하게 작동합니다.

### 1. Install OpenPets Desktop

[OpenPets 릴리스](https://github.com/OpenPetsHQ/openpets/releases/latest)에서 운영체제에 맞는 패키지를 다운로드하세요:

- **macOS Apple Silicon**: `OpenPets-*-mac-arm64.dmg`
- **macOS Intel**: `OpenPets-*-mac-x64.dmg`
- **Windows**: `OpenPets-*-win-x64-setup.exe`
- **Linux**: `OpenPets-*-linux-x86_64.AppImage`

> 참고: 현재 빌드는 서명되지 않았을 수 있습니다. macOS에서 보안 경고로 실행을 차단하는 경우, 터미널에서 아래 명령어를 실행하여 격리(quarantine) 플래그를 제거해 주세요:
> ```bash
> xattr -dr com.apple.quarantine /Applications/OpenPets.app
> ```

### 2. Manage and Customize Pets

내장된 **펫 갤러리(Pet Gallery)**에서 설치된 펫을 둘러보고, 애니메이션 프레임을 미리 보며, 각 작업 공간이나 에이전트 창을 모니터링할 펫을 설정할 수 있습니다.

<p align="center">
  <img src="assets/manage-pets.png" alt="OpenPets 데스크톱 앱에서 펫 관리하기" width="100%" />
</p>

### 3. Enable Official Plugins

OpenPets v3는 모듈형 **공식 플러그인 카탈로그(Official Plugin Catalog)**와 함께 제공됩니다. 데스크톱 컨트롤 센터(Control Center)에서 플러그인을 활성화하거나 설정하여 집중 타이머, 알림, 인터랙티브 미니 게임 등을 추가할 수 있습니다.

#### 기본 탑재된 공식 라인업

- **Day Routine**: 습관을 추적하고 스트레칭을 하거나 자리에서 일어나도록 상기시켜 줍니다.
- **Focus Buddy**: 작업 주기를 관리할 수 있는 포모도로 스타일의 집중 타이머입니다.
- **Fortune Cookie**: 무작위로 오늘의 조언과 지혜가 담긴 문구를 보여줍니다.
- **Launch Buddy**: 단축키 명령어를 등록하여 로컬 폴더, 프로젝트 또는 애플리케이션을 빠르게 열 수 있도록 지원합니다.
- **Magic 8 Ball**: 질문을 던지면 펫이 장난스럽고 무작위적인 답변을 건넵니다.
- **Mood Check-in**: 정기적으로 기분 상태를 확인하여 정서적 웰빙을 돕습니다.
- **Reminders**: 사용자 지정 오디오 알림음과 함께 다시 알림(snooze)이 가능한 벨소리 알림을 띄워줍니다.
- **Virtual Pet**: 데스크톱 컴패니언을 다마고치 스타일의 펫으로 변신시킵니다. 실시간 상태 핀을 통해 포만감, 친밀도, 에너지 레벨이 추적됩니다.
- **Water Reminder**: 설정 가능한 주기적인 물 마시기 알림으로 수분 섭취를 유지하도록 도와줍니다.

---

## Plugin Platform & SDK v3

OpenPets 플러그인 시스템은 커스텀 컴패니언 동작을 개발할 수 있도록 안전하고 개발자 친화적인 SDK(`@open-pets/plugin-sdk`)를 제공합니다.

### 보안 및 아키텍처
- **샌드박스화된 런타임**: 각 JS 플러그인은 샌드박스 처리된 BrowserWindow 호스트 환경 내부에서 실행됩니다.
- **호스트 렌더링 UI**: 플러그인은 액션, HUD, 알림을 정의하고 데스크톱 호스트가 이를 직접 렌더링합니다. HTML/JS 코드가 raw HTML을 렌더링하거나 펫 창 내부에서 임의의 스크립트를 실행할 수 없습니다.
- **권한 모델(Permissions Model)**: 권한은 매니페스트에 선언되어야 하며 설치 시 사용자의 승인을 받아야 합니다. 민감한 API(예: `voice:listen`, `clipboard`, `pet:speak:dynamic`)는 명시적으로 동의를 토글해야 합니다.
- **SSRF 및 프라이빗 호스트 방어**: 네트워크 fetch 요청은 개발자가 선언한 호스트네임으로 제한되며 로컬 SSRF로부터 보호됩니다.

### SDK 인터페이스 (`ctx`)
플러그인은 `ctx` 객체를 통해 데스크톱 환경에 연결되며 아래와 같은 기능을 노출합니다:
- `ctx.pets` / `ctx.pet`: 기본 및 생성된 펫 인스턴스를 관리합니다: 생성, 이동, 애니메이션 및 반응 제어.
- `ctx.ui`: 경고창, 임시/고정 말풍선, 커스텀 메뉴, 패널 및 상태 HUD. 고정된 미니 HUD 말풍선은 Virtual Pet 스탯과 같이 진행 상황 표시줄이 포함된 조밀한 2x2 그리드 레이아웃을 지원합니다.
- `ctx.audio`: 호스트가 관리하는 경고음 또는 사용자가 가져온 커스텀 오디오를 트리거합니다.
- `ctx.schedule`: 정밀한 타이머 훅을 설정합니다 (`once`, `every`, `daily`, `cron`, `at`).
- `ctx.ai` / `ctx.secrets`: 플러그인 소스 코드에 API 키를 노출하지 않고 사용자가 호스트에 설정한 AI 제공자(Anthropic, OpenAI, Ollama)와 연결합니다.
- `ctx.storage`: 변경 구독 기능이 포함된 간단한 JSON 키-값(key-value) 저장소입니다.
- 기타 API: `events`, `assets`, `bus`, `net`(스트리밍 지원 포함), `notify`, `voice`(TTS 및 push-to-talk STT), `auth`(PKCE 브라우저 플로우), `files`(보안 처리된 OS 파일 선택 다이얼로그), `system`, `commands`, `status`, `log`.

### 개발자 도구 & 명령어

공식 CLI를 사용하여 플러그인을 생성, 검증 및 테스트할 수 있습니다.

#### 1. 새 플러그인 뼈대(Scaffold) 생성
공식 레이아웃(`blank`, `reminder`, `ambient`, `ai-chat`, `tamagotchi`, `calendar`) 중 하나를 템플릿으로 삼아 생성합니다:
```bash
npx @open-pets/cli plugin new "My Plugin" --template tamagotchi
```

#### 2. 검증(Validate)
패키징 전에 매니페스트 레이아웃, 권한 및 설정 스키마를 검증합니다:
```bash
npx @open-pets/cli plugin validate ./my-plugin
```

#### 3. 테스트 하네스(Test harness)
데스크톱 앱을 실행하지 않고도 결정론적(deterministic) 테스트를 작성할 수 있습니다. `@open-pets/plugin-sdk/testing`의 `createTestHarness`를 사용하여 호스트를 모킹(mock)하고, 시각을 앞으로 넘기고, 액션을 트리거하여 반응을 검증할 수 있습니다:
```javascript
import { createTestHarness } from "@open-pets/plugin-sdk/testing";
import { register } from "./index.js";

const h = createTestHarness(register, { permissions: ["pet:speak", "schedule"] });
await h.start();
h.expectScheduled("decay");
await h.clock.advance("30m");
h.expectSpoke(/need attention/i);
```
플러그인 프로젝트에서 플러그인 테스트를 실행합니다:
```bash
npm test
```

---

## Advanced: Agent Integrations

개발 에이전트가 데스크톱 컴패니언을 제어하도록 하려면 OpenPets가 제공하는 선택적인 로컬 MCP (Model Context Protocol) 연동 레이어를 사용할 수 있습니다.

<p align="center">
  <img src="assets/integrations.png" alt="OpenPets 데스크톱 연동 화면" width="100%" />
</p>

### 동작 방식
에이전트를 구성하면 OpenPets가 표준 MCP 도구를 노출합니다. 에이전트는 로컬에서 애니메이션을 트리거하고, 상태를 변경하고, 말풍선을 띄울 수 있습니다:
1. **Claude Code**: OpenPets MCP, `~/.claude/CLAUDE.md` 내의 메모리 지침, 그리고 `~/.claude/settings.json` 내의 훅을 설치합니다.
2. **OpenCode**: OpenPets MCP, 커스텀 프로젝트 지침 파일, 그리고 `@open-pets/opencode` 자동 훅 플러그인을 설치합니다.
3. **Cursor / 기타 MCP 클라이언트**: OpenPets를 표준 stdio 또는 TCP MCP 서버로 등록합니다.

<p align="center">
  <img src="assets/claude.png" alt="Claude Code와 OpenPets의 연동" width="100%" />
</p>

### MCP 서버 설정
OpenPets를 MCP 도구로 실행하려면 에이전트 설정에 서버를 추가하세요:
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
*팁: 특정 펫을 지정하려면 `--pet <petId>` 인자를 전달하세요.*

### 사용 가능한 MCP 도구
- `openpets_status`: 대상 펫 ID를 가져오고 런타임 연결 상태를 확인합니다.
- `openpets_react`: 펫 반응 애니메이션을 설정합니다 (예: `thinking`, `editing`, `testing`, `success`, `error`).
- `openpets_say`: 짧은 말풍선을 표시합니다.

### 로컬 프라이버시 및 보안
- 모든 자동화 반응은 정적인 로컬 트리거(예: 명령어 실행 또는 파일 쓰기)를 기반으로 작동합니다.
- 대화 내용은 민감한 변수, 경로, 비밀번호(secrets) 또는 여러 줄의 코드 스니펫이 유출되는 것을 방지하기 위해 유효성 검사를 거칩니다.
- 실시간 상호작용은 로컬 디스커버리 토큰 쓰기/읽기를 필요로 하므로, 외부 네트워크 트리거로부터 IPC 브릿지를 보호합니다.

---

## Development Workspace

OpenPets 코드베이스에 기여하거나, 변경 사항을 테스트하거나, 로컬에서 데스크톱 패키지를 빌드하기 위한 방법입니다.

### 사전 요구사항
- **Node.js**: 버전 20 이상
- **pnpm**: 버전 11 이상
- **TypeScript**: 컴파일러 지원

### 명령어

프로젝트 워크스페이스 의존성 설치:
```bash
pnpm install
```

로컬 개발 모드에서 Electron 애플리케이션 실행:
```bash
pnpm dev:desktop
```

라이브 상태의 공식 플러그인들을 로드하고 모니터링하며 실행:
```bash
pnpm dev:desktop:plugins
```

워크스페이스 타입 검사, 코드 적합성 검증 및 테스트 실행:
```bash
pnpm check
pnpm typecheck
pnpm test
```

데스크톱 애플리케이션 패키징:
```bash
# Build & package into target OS directory
pnpm package:desktop:dir

# Build & package into final installer / setup archives
pnpm package:desktop
```

### 워크스페이스 구조
```text
apps/desktop              Electron 데스크톱 애플리케이션
packages/client           @open-pets/client (IPC 헬퍼 라이브러리)
packages/mcp              @open-pets/mcp (Model Context Protocol stdio 서버)
packages/claude           @open-pets/claude (Claude 연동, 메모리 및 훅)
packages/opencode         @open-pets/opencode (OpenCode 플러그인 및 지침 설정)
packages/pi               @open-pets/pi (Pi CLI 확장 프로그램 연동)
packages/agent-events     공유 새니타이저(sanitizers) 및 이벤트 헬퍼 패키지
packages/cli              @open-pets/cli (설정 및 스캐폴딩용 사용자 엔트리 포인트 CLI)
packages/sdk              @open-pets/plugin-sdk (플러그인 SDK v3 선언 및 테스트 하네스)
packages/pet-format       @open-pets/pet-format (펫 매니페스트 및 스키마 타입)
plugins/official          공식 퍼스트 파티 플러그인 워크스페이스 (호스트 카탈로그에 번들됨)
docs/                     기술 사양 및 아키텍처 문서
```

---

## Documentation

`docs/` 폴더 안의 상세한 아키텍처 및 플랫폼 문서를 확인해 보세요:
- [`docs/plugins.md`](docs/plugins.md) - 플러그인 플랫폼 SDK v3 매니페스트, 권한 및 테스트 키트.
- [`docs/claude-integration.md`](docs/claude-integration.md) - Claude Code 연동 (메모리, 훅, MCP).
- [`docs/opencode.md`](docs/opencode.md) - OpenCode 워크스페이스 연동.
- [`docs/wsl-ipc.md`](docs/wsl-ipc.md) - WSL-Windows TCP 브릿지 설정.
- [`docs/testing.md`](docs/testing.md) - 워크스페이스 테스트 및 적합성 전략.
- [`docs/release.md`](docs/release.md) - 애플리케이션 패키징 및 릴리스 프로세스.
- [`docs/workflow.md`](docs/workflow.md) - 코어 개발 및 기여 워크플로우.

---

## Safety and Privacy

- **로컬 전용(Local-Only)**: OpenPets IPC는 로컬 소켓/네임드 파이프(named pipe)를 사용하여 작동하며, 실행 시마다 임의로 생성되는 보안 토큰으로 보호됩니다.
- **SSRF 방어**: 플러그인의 네트워크 연결은 승인된 도메인으로 제한되며, 로컬 네트워크 및 사설 IP 주소로의 접근은 차단됩니다.
- **동적 콘텐츠 정화(Sanitization)**: AI가 말하는 임의의 텍스트는 로컬 필터를 거치며 경로, URL, 비밀번호(secrets) 또는 여러 줄의 코드 스니펫이 가려집니다.
- **민감한 권한 동의**: 클립보드, 마이크 또는 동적 AI 응답에 접근하는 기능은 기본적으로 꺼져 있으며, 사용자의 명시적인 동의를 필요로 합니다.
