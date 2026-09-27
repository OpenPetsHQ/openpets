<p align="center">
  <img src="assets/openpets.png" alt="OpenPets desktop companion platform" width="100%" />
</p>

<p align="center">
  <strong>Una plataforma de compañero de escritorio con mascotas, plugins e integraciones opcionales de agentes locales.</strong>
</p>

<p align="center">
  OpenPets coloca un compañero animado en tu escritorio y luego permite que los plugins lo conviertan en un compañero de enfoque, sistema de recordatorios, minijuego, lanzador o asistente de agente de programación.
</p>

<p align="center">
  <img src="assets/intro.png" alt="OpenPets reacting across multiple coding agent sessions" width="100%" />
</p>

<div align="center">
  <p><sub>por <b>Boring Dystopia Development</b></sub></p>
  <p>
    <a href="https://boringdystopia.ai/"><img src="https://img.shields.io/badge/boringdystopia.ai-111111?style=for-the-badge&logo=vercel&logoColor=white" alt="boringdystopia.ai"></a>&nbsp;
    <a href="https://x.com/alvinunreal"><img src="https://img.shields.io/badge/X-@alvinunreal-000000?style=for-the-badge&logo=x&logoColor=white" alt="X @alvinunreal"></a>&nbsp;
    <a href="https://t.me/boringdystopiadevelopment"><img src="https://img.shields.io/badge/Telegram-Join%20channel-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram Join channel"></a>&nbsp;
  </p>
</div>

<p align="center">
  Leer en: <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.zh-Hans.md">简体中文</a> | <a href="README.zh-Hant.md">繁體中文</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.es-419.md">Español (LatAm)</a>
</p>

---

## Descargar OpenPets

**[Descarga la última versión de OpenPets para escritorio](https://github.com/OpenPetsHQ/openpets/releases/latest)** e iníciala. Aparecerá una mascota de inmediato; no se requiere configuración de agentes.

- **Mascotas de escritorio**: compañeros animados que reposan, deambulan, reaccionan y evitan que tu espacio de trabajo se sienta vacío.
- **Plugins oficiales**: temporizadores de enfoque, recordatorios, controles de estado de ánimo, minijuegos, atajos de lanzamiento, alertas de hidratación y estadísticas de mascotas virtuales.
- **Plugin SDK v3**: un entorno de ejecución (runtime) aislado (sandboxed) de JavaScript/TypeScript para crear nuevas habilidades para tus mascotas con permisos, cuotas, almacenamiento, programaciones, comandos, paneles, eventos, audio, notificaciones y más.
- **Capa de agente opcional**: los clientes de Claude Code, OpenCode, Cursor, Pi y MCP pueden controlar las reacciones de la mascota local sin exponer prompts, código, rutas, registros (logs) o secretos en burbujas de diálogo.

---

## Dale una estrella a OpenPets

Si OpenPets hace que tu entorno de programación o espacio de trabajo de escritorio sea un poco más divertido, por favor dale una estrella al repositorio.

<p align="center">
  <img src="assets/star-repo.gif" alt="Starring the OpenPets repository" width="100%" />
</p>

---

## Para usuarios: Primeros pasos

No necesitas ser desarrollador ni conectar ningún agente de IA para disfrutar de OpenPets. La aplicación de escritorio es completamente funcional desde el primer momento con la selección de plugins oficiales.

### 1. Instalar OpenPets para escritorio

Descarga el paquete para tu sistema operativo desde los [lanzamientos de OpenPets](https://github.com/OpenPetsHQ/openpets/releases/latest):

- **macOS Apple Silicon**: `OpenPets-*-mac-arm64.dmg`
- **macOS Intel**: `OpenPets-*-mac-x64.dmg`
- **Windows**: `OpenPets-*-win-x64-setup.exe`
- **Linux**: `OpenPets-*-linux-x86_64.AppImage`

> Nota: Las compilaciones actuales pueden no estar firmadas. Si macOS bloquea la ejecución con una advertencia de seguridad, elimina la marca de cuarentena a través de la terminal:
> ```bash
> xattr -dr com.apple.quarantine /Applications/OpenPets.app
> ```

### 2. Administrar y personalizar mascotas

Explora las mascotas instaladas, previsualiza sus fotogramas de animación y configura qué mascota supervisa cada espacio de trabajo o ventana de agente desde la **Galería de mascotas** integrada.

<p align="center">
  <img src="assets/manage-pets.png" alt="Managing pets in the OpenPets desktop app" width="100%" />
</p>

### 3. Habilitar plugins oficiales

OpenPets v3 incluye un **Catálogo de plugins oficiales** modular. Habilita o configura plugins a través del Centro de control de escritorio para agregar temporizadores de enfoque, recordatorios y minijuegos interactivos.

#### Selección oficial incluida

- **Day Routine**: Realiza un seguimiento de tus hábitos y te recuerda estirarte o alejarte de la pantalla.
- **Focus Buddy**: Temporizadores de enfoque al estilo Pomodoro para gestionar los ciclos de trabajo.
- **Fortune Cookie**: Revela consejos y sabiduría diaria de forma aleatoria.
- **Launch Buddy**: Permite registrar comandos de atajo para abrir rápidamente carpetas locales, proyectos o aplicaciones.
- **Magic 8 Ball**: Haz preguntas y recibe respuestas lúdicas y aleatorias de tu mascota.
- **Mood Check-in**: Evalúa periódicamente tu estado de ánimo para apoyar tu bienestar emocional.
- **Reminders**: Muestra notificaciones con alertas de campana posponibles y tonos de audio personalizados.
- **Virtual Pet**: Convierte a tu compañero de escritorio en una mascota al estilo Tamagotchi con niveles de hambre, afecto y energía mediante un indicador de estado en tiempo real.
- **Water Reminder**: Te mantiene hidratado con recordatorios de consumo de agua regulares y configurables.

---

## Plataforma de plugins y SDK v3

El sistema de plugins de OpenPets ofrece un SDK seguro y fácil de usar para desarrolladores (`@open-pets/plugin-sdk`) para crear comportamientos personalizados para los compañeros.

### Seguridad y arquitectura
- **Entorno de ejecución aislado (Sandboxed Runtime)**: Cada plugin de JS se ejecuta dentro de un entorno de host BrowserWindow aislado (sandboxed).
- **Interfaz de usuario renderizada por el host (Host-Rendered UI)**: Los plugins describen acciones, HUD y notificaciones; el host de escritorio se encarga de renderizarlos. El código HTML/JS no puede renderizar HTML puro ni ejecutar scripts arbitrarios dentro de una ventana de mascota.
- **Modelo de permisos**: Los permisos deben declararse en el manifiesto y ser aprobados por el usuario durante la instalación. Las API marcadas como sensibles (como `voice:listen`, `clipboard` y `pet:speak:dynamic`) requieren interruptores de consentimiento explícitos.
- **Protecciones contra SSRF y hosts privados**: Las solicitudes de red (fetch) se limitan a los nombres de host declarados por el desarrollador y están protegidas contra SSRF local.

### La superficie del SDK (`ctx`)
Los plugins se conectan al entorno de escritorio a través del objeto `ctx`, exponiendo:
- `ctx.pets` / `ctx.pet`: Administra las instancias de mascotas predeterminadas y creadas: crearlas (spawn), moverlas, animarlas y hacer que reaccionen.
- `ctx.ui`: Alertas, burbujas temporales/fijadas, menús personalizados, paneles y HUD de estado. Las miniburbujas de HUD fijadas admiten diseños de cuadrícula compactos de 2x2 con barras de progreso, como las estadísticas de Virtual Pet.
- `ctx.audio`: Activa tonos de alerta administrados por el host o audio personalizado importado por el usuario.
- `ctx.schedule`: Configura ganchos de temporizador precisos (`once`, `every`, `daily`, `cron`, `at`).
- `ctx.ai` / `ctx.secrets`: Se conecta al proveedor de IA configurado por el usuario en el host (Anthropic, OpenAI, Ollama) sin exponer las claves de API en el código fuente del plugin.
- `ctx.storage`: Almacenamiento simple de clave-valor en formato JSON con suscripciones a cambios.
- Otras API: `events`, `assets`, `bus`, `net` (con soporte de transmisión/streaming), `notify`, `voice` (TTS y STT push-to-talk), `auth` (flujo de navegador PKCE), `files` (diálogos seguros del sistema operativo), `system`, `commands`, `status` y `log`.

### Herramientas y comandos de desarrollo

Crea, valida y prueba plugins utilizando la CLI oficial.

#### 1. Crear la estructura de un nuevo plugin
Crea una plantilla a partir de cualquiera de los diseños oficiales (`blank`, `reminder`, `ambient`, `ai-chat`, `tamagotchi`, `calendar`):
```bash
npx @open-pets/cli plugin new "My Plugin" --template tamagotchi
```

#### 2. Validar
Verifica el diseño del manifiesto, los permisos y los esquemas de configuración antes de empaquetar:
```bash
npx @open-pets/cli plugin validate ./my-plugin
```

#### 3. Entorno de pruebas (Test harness)
Escribe pruebas deterministas sin iniciar la aplicación de escritorio. Usando `createTestHarness` de `@open-pets/plugin-sdk/testing`, puedes imitar (mock) el host, adelantar relojes, activar acciones y verificar reacciones:
```javascript
import { createTestHarness } from "@open-pets/plugin-sdk/testing";
import { register } from "./index.js";

const h = createTestHarness(register, { permissions: ["pet:speak", "schedule"] });
await h.start();
h.expectScheduled("decay");
await h.clock.advance("30m");
h.expectSpoke(/need attention/i);
```
Ejecuta las pruebas de plugins desde el proyecto de tu plugin:
```bash
npm test
```

---

## Avanzado: Integraciones de agentes

Si deseas que tu agente de desarrollo controle a tu compañero de escritorio, OpenPets proporciona una capa opcional de integración local mediante MCP (Model Context Protocol).

<p align="center">
  <img src="assets/integrations.png" alt="OpenPets desktop integrations screen" width="100%" />
</p>

### Cómo funciona
Al configurar un agente, OpenPets expone herramientas estándar de MCP. El agente puede activar animaciones, cambiar el estado y mostrar burbujas de texto de forma local:
1. **Claude Code**: Instala OpenPets MCP, instrucciones de memoria en `~/.claude/CLAUDE.md` y enlaces (hooks) en `~/.claude/settings.json`.
2. **OpenCode**: Instala OpenPets MCP, archivos de instrucciones de proyectos personalizados y el plugin de enlace automático `@open-pets/opencode`.
3. **Cursor / Otros clientes MCP**: Registra OpenPets como un servidor MCP estándar a través de stdio o TCP.

<p align="center">
  <img src="assets/claude.png" alt="Claude Code integration with OpenPets" width="100%" />
</p>

### Configuración del servidor MCP
Para ejecutar OpenPets como una herramienta MCP, agrega el servidor a la configuración de tu agente:
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
*Consejo: Para dirigirte a una mascota específica, pasa el argumento `--pet <petId>`.*

### Herramientas MCP disponibles
- `openpets_status`: Recupera el ID de la mascota objetivo y verifica la conectividad en tiempo de ejecución.
- `openpets_react`: Establece las animaciones de reacción de la mascota (por ejemplo, `thinking`, `editing`, `testing`, `success`, `error`).
- `openpets_say`: Muestra una burbuja de diálogo corta.

### Privacidad y seguridad local
- Todas las reacciones automatizadas se ejecutan mediante disparadores (triggers) locales estáticos (por ejemplo, cuando se ejecuta un comando o se escribe un archivo).
- El contenido del diálogo se valida para evitar la filtración de variables sensibles, rutas, secretos o fragmentos de código de varias líneas.
- La interacción en tiempo real requiere la escritura/lectura de un token de descubrimiento local, protegiendo el puente IPC de disparadores de red externos.

---

## Espacio de trabajo de desarrollo

Para contribuir a la base de código de OpenPets, probar cambios o compilar localmente los paquetes de escritorio.

### Requisitos previos
- **Node.js**: versión 20 o superior
- **pnpm**: versión 11 o superior
- **TypeScript**: soporte de compilador

### Comandos

Instala las dependencias del espacio de trabajo del proyecto:
```bash
pnpm install
```

Inicia la aplicación de Electron en modo de desarrollo local:
```bash
pnpm dev:desktop
```

Inicia con los plugins oficiales cargados y supervisados en tiempo real:
```bash
pnpm dev:desktop:plugins
```

Ejecuta la verificación de tipos del espacio de trabajo, validaciones de conformidad del código y pruebas:
```bash
pnpm check
pnpm typecheck
pnpm test
```

Empaqueta la aplicación de escritorio:
```bash
# Compila y empaqueta en el directorio del sistema operativo objetivo
pnpm package:desktop:dir

# Compila y empaqueta en los archivos de instalación / instalador final
pnpm package:desktop
```

### Estructura del espacio de trabajo
```text
apps/desktop              Aplicación de escritorio Electron
packages/client           @open-pets/client (Biblioteca auxiliar de IPC)
packages/mcp              @open-pets/mcp (Servidor stdio de Model Context Protocol)
packages/claude           @open-pets/claude (Integraciones, memoria y ganchos de Claude)
packages/opencode         @open-pets/opencode (Plugins de OpenCode y configuraciones de instrucciones)
packages/pi               @open-pets/pi (Integración de extensión de CLI para Pi)
packages/agent-events     Paquete compartido de sanitizadores y auxiliares de eventos
packages/cli              @open-pets/cli (CLI de punto de entrada de usuario para configuración y estructuración)
packages/sdk              @open-pets/plugin-sdk (Declaraciones de SDK de plugins v3 y entorno de pruebas)
packages/pet-format       @open-pets/pet-format (Manifiesto de mascotas y tipos de esquemas)
plugins/official          Espacio de trabajo de plugins oficiales de primera mano (incluido con el catálogo del host)
docs/                     Especificaciones técnicas y documentación de arquitectura
```

---

## Documentación

Explora la documentación detallada sobre la arquitectura y la plataforma dentro de la carpeta `docs/`:
- [`docs/plugins.md`](docs/plugins.md) - Manifiesto del SDK v3 de la plataforma de plugins, permisos y kit de pruebas.
- [`docs/claude-integration.md`](docs/claude-integration.md) - Integración con Claude Code (memoria, ganchos/hooks, MCP).
- [`docs/opencode.md`](docs/opencode.md) - Integración con espacios de trabajo de OpenCode.
- [`docs/wsl-ipc.md`](docs/wsl-ipc.md) - Configuración del puente TCP de WSL a Windows.
- [`docs/testing.md`](docs/testing.md) - Estrategia de pruebas y conformidad del espacio de trabajo.
- [`docs/release.md`](docs/release.md) - Procesos de empaquetado y lanzamiento de la aplicación.
- [`docs/workflow.md`](docs/workflow.md) - Flujo de trabajo principal de desarrollo y contribuciones.

---

## Seguridad y privacidad

- **Solo local (Local-Only)**: El IPC de OpenPets funciona mediante un socket local/tubería con nombre (named pipe), protegido con un token de seguridad aleatorio por ejecución.
- **Seguridad contra SSRF**: Las conexiones de red de los plugins están restringidas a dominios aprobados y bloqueadas para el acceso a redes locales o direcciones IP privadas.
- **Sanitización de contenido dinámico**: Cualquier texto de diálogo de IA dinámico pasa por filtros locales estrictos para censurar/redactar rutas, URL, secretos o fragmentos de código de varias líneas.
- **Consentimiento para permisos sensibles**: Las funciones que acceden al portapapeles, el micrófono o las respuestas dinámicas de IA están desactivadas por defecto y requieren la autorización explícita del usuario.
