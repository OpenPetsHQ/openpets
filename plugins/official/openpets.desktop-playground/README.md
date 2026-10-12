# Desktop Playground

Desktop Playground is an original OpenPets plugin that opens a standalone,
sandboxed desktop panel from the pet's plugin submenu. The panel provides a
small desktop-toy scene with Smash, Paint, Stamp, and Erase tools.

## Behavior

- The **Open playground** command opens or raises the panel; only one panel is
  active per plugin runtime.
- The panel receives the configured default tool, sound preference, and
  localized strings from the plugin through the SDK panel-message bridge.
- Configuration changes are sent to an open panel, and the panel can request
  initialization again after loading or becoming ready.
- Sound is synthesized by the panel. The plugin does not request pet-control or
  audio permissions and does not trigger unsolicited pet interactions.

## Configuration

- **Playful sound effects** controls the panel's synthesized sound preference.
- **Default playground tool** selects Smash, Paint, Stamp, or Erase.

The plugin is an OpenPets-authored implementation; it does not bundle or adapt
third-party code or assets.
