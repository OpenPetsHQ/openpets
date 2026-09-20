import claudeLogoUrl from "../../../../assets/integrations/claude.svg";
import opencodeLogoUrl from "../../../../assets/integrations/opencode.svg";
import cursorLogoUrl from "../../../../assets/integrations/cursor.svg";
import piLogoUrl from "../../../../assets/integrations/pi.svg";
import vscodeLogoUrl from "../../../../assets/integrations/vscode.svg";
import windsurfLogoUrl from "../../../../assets/integrations/windsurf.svg";
import zedLogoUrl from "../../../../assets/integrations/zed.svg";
import type { IntegrationIconProps } from "./types.js";

export function PluginGlyph({ className = "plugin-glyph" }: { readonly className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2 3 6.5l9 4.5 9-4.5z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 17.5 9 4.5 9-4.5" />
    </svg>
  );
}

const INTEGRATION_LOGOS: Record<string, string> = {
  claude: claudeLogoUrl,
  opencode: opencodeLogoUrl,
  cursor: cursorLogoUrl,
  pi: piLogoUrl,
  vscode: vscodeLogoUrl,
  windsurf: windsurfLogoUrl,
  zed: zedLogoUrl,
};

export function IntegrationIcon({ id }: IntegrationIconProps) {
  const src = INTEGRATION_LOGOS[id];
  if (src) {
    return <img src={src} className="integration-logo" alt="" draggable="false" />;
  }
  return <PluginGlyph />;
}
