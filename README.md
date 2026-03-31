# Sidebar Presets

Obsidian plugin to toggle between two right sidebar layout presets.

## Features

- **Two preset slots (1 / 2)**: Save different right sidebar configurations and switch instantly
- **Per-preset width**: Each preset remembers its own sidebar width
- **No view reload**: Uses CSS-based visibility toggling — views stay alive, no re-initialization
- **Toggle button**: Appears in the right sidebar header, next to the collapse button
- **Command palette**: "우측 사이드바 프리셋 전환" command with hotkey support
- **Persistent across restarts**: Preset assignments and widths are saved to `data.json`

## Usage

1. Enable the plugin
2. Your current right sidebar becomes **Preset 1**
3. Click the `1` button (or use the command) to switch to **Preset 2**
4. Preset 2 starts empty — drag any views into it (e.g., Claudian, a markdown file)
5. Click `2` to switch back to Preset 1
6. Each preset remembers its own layout and width independently

## How it works

Instead of destroying and recreating views on each toggle, this plugin:

1. Tags each tab group with `data-sidebar-preset="A"` or `"B"`
2. Sets `data-active-preset` on the sidebar container
3. CSS `display: none` hides the inactive preset's tab groups
4. The sidebar collapse button is moved to the active preset's first tab group

This means heavy plugins like Claudian don't need to reload when switching presets.

## Installation

### Manual
1. Download `main.js`, `manifest.json`, `styles.css`
2. Create `.obsidian/plugins/sidebar-presets/` in your vault
3. Place the files there
4. Enable "Sidebar Presets" in Settings → Community plugins

## License

MIT
