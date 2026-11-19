# Code Editor for Obsidian

Open and edit real code files inside Obsidian: syntax highlighting, autocomplete, auto-indent, bracket matching, folding, search, and formatting.

## Build
```bash
npm install
npm run build        # produces main.js
```
Copy `main.js`, `manifest.json`, `styles.css` into `<your vault>/.obsidian/plugins/code-editor/`, then enable the plugin in Settings → Community plugins.
(For development use `npm run dev` for watch mode.)

## Use
- Ribbon icon / command **Create new code file** (e.g. `main.py`), or open any existing code file from the file explorer.
- **Format**: `Shift+Alt+F`, or command palette → *Format current code file*. Optional *format on save* in settings.
- **Autocomplete**: appears as you type (language keywords/scope + words in the file). `Ctrl+Space` to force, `Enter`/`Tab` to accept.
- Built-in Prettier: JS, TS, JSX/TSX, JSON, CSS/SCSS/LESS, HTML, Vue, YAML.
- Other languages (Python, Go, Rust, ...): configure an external formatter in settings, e.g. `{"py": "black -q -", "go": "gofmt"}`. Without one, it just re-indents.
