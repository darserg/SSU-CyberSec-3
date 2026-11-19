import {
  App, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting,
  TextFileView, TFile, TFolder, WorkspaceLeaf,
} from "obsidian";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView, drawSelection, dropCursor, highlightActiveLine,
  highlightActiveLineGutter, keymap, lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  LanguageDescription, bracketMatching, foldGutter, foldKeymap,
  indentOnInput, indentRange, indentUnit, syntaxHighlighting,
} from "@codemirror/language";
import {
  autocompletion, closeBrackets, closeBracketsKeymap, completeAnyWord,
} from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { languages } from "@codemirror/language-data";
import { classHighlighter } from "@lezer/highlight";

import * as prettier from "prettier/standalone";
import * as babel from "prettier/plugins/babel";
import * as estree from "prettier/plugins/estree";
import * as typescript from "prettier/plugins/typescript";
import * as postcss from "prettier/plugins/postcss";
import * as html from "prettier/plugins/html";
import * as markdown from "prettier/plugins/markdown";
import * as yaml from "prettier/plugins/yaml";

const VIEW_TYPE = "code-editor-view";

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

interface CodeEditorSettings {
  tabSize: number;
  formatOnSave: boolean;
  lineWrap: boolean;
  /** extension -> shell command that reads code on stdin and prints formatted code on stdout */
  externalFormatters: Record<string, string>;
}

const DEFAULT_SETTINGS: CodeEditorSettings = {
  tabSize: 2,
  formatOnSave: false,
  lineWrap: false,
  externalFormatters: {},
};

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const PRETTIER_PARSERS: Record<string, string> = {
  js: "babel", jsx: "babel", mjs: "babel", cjs: "babel",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  json: "json", json5: "json5", jsonc: "json",
  css: "css", scss: "scss", less: "less",
  html: "html", htm: "html", vue: "vue",
  yaml: "yaml", yml: "yaml",
};

function runExternal(cmd: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!Platform.isDesktopApp) return reject(new Error("External formatters only work on desktop"));
    const { spawn } = (window as any).require("child_process");
    const p = spawn(cmd, { shell: true });
    let out = "", err = "";
    p.stdout.on("data", (d: Buffer) => (out += d));
    p.stderr.on("data", (d: Buffer) => (err += d));
    p.on("error", reject);
    p.on("close", (code: number) => (code === 0 ? resolve(out) : reject(new Error(err || `exit code ${code}`))));
    p.stdin.write(input);
    p.stdin.end();
  });
}

/** Returns formatted code, or null when no formatter exists for this extension. */
async function formatCode(code: string, ext: string, s: CodeEditorSettings): Promise<string | null> {
  ext = ext.toLowerCase();
  const external = s.externalFormatters[ext];
  if (external) return runExternal(external, code);

  const parser = PRETTIER_PARSERS[ext];
  if (!parser) return null;
  return prettier.format(code, {
    parser,
    plugins: [babel, estree, typescript, postcss, html, markdown, yaml] as any[],
    tabWidth: s.tabSize,
  });
}

/* ------------------------------------------------------------------ */
/* The editor view                                                     */
/* ------------------------------------------------------------------ */

class CodeView extends TextFileView {
  private editor: EditorView | null = null;
  private lang = new Compartment();
  private wrap = new Compartment();
  private loading = false;

  constructor(leaf: WorkspaceLeaf, private plugin: CodeEditorPlugin) {
    super(leaf);
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.file?.name ?? "Code"; }
  getIcon() { return "file-code"; }

  async onOpen() {
    this.contentEl.addClass("code-editor-view");
  }

  async onClose() {
    this.editor?.destroy();
    this.editor = null;
  }

  getViewData() {
    return this.editor?.state.doc.toString() ?? "";
  }

  setViewData(data: string, clear: boolean) {
    if (!this.editor) {
      this.editor = new EditorView({ state: this.makeState(data), parent: this.contentEl });
    } else if (clear) {
      this.editor.setState(this.makeState(data)); // fresh undo history for a new file
    } else if (data !== this.getViewData()) {
      this.loading = true;
      this.editor.dispatch({ changes: { from: 0, to: this.editor.state.doc.length, insert: data } });
      this.loading = false;
    }
    if (clear) void this.loadLanguage();
  }

  clear() {
    this.editor?.setState(this.makeState(""));
  }

  private async loadLanguage() {
    if (!this.file) return;
    const desc = LanguageDescription.matchFilename(languages, this.file.name);
    if (!desc) return;
    const support = await desc.load();
    this.editor?.dispatch({ effects: this.lang.reconfigure(support) });
  }

  async formatDocument() {
    const view = this.editor;
    if (!view || !this.file) return;
    const code = view.state.doc.toString();
    try {
      const out = await formatCode(code, this.file.extension, this.plugin.settings);
      if (out === null) {
        // No formatter for this language: just fix indentation using the language's own rules.
        view.dispatch({ changes: indentRange(view.state, 0, view.state.doc.length) });
        return;
      }
      if (out !== code) {
        view.dispatch({
          changes: { from: 0, to: code.length, insert: out },
          selection: { anchor: Math.min(view.state.selection.main.head, out.length) },
        });
      }
    } catch (e: any) {
      new Notice(`Format failed: ${String(e?.message ?? e).split("\n")[0]}`, 6000);
    }
  }

  private async saveWithOptionalFormat() {
    if (this.plugin.settings.formatOnSave) await this.formatDocument();
    await this.save();
  }

  applySettings() {
    this.editor?.dispatch({
      effects: this.wrap.reconfigure(this.plugin.settings.lineWrap ? EditorView.lineWrapping : []),
    });
  }

  private makeState(doc: string) {
    const s = this.plugin.settings;
    return EditorState.create({
      doc,
      extensions: [
        keymap.of([
          { key: "Mod-s", run: () => { void this.saveWithOptionalFormat(); return true; } },
          { key: "Shift-Alt-f", run: () => { void this.formatDocument(); return true; } },
        ]),
        lineNumbers(),
        foldGutter(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        dropCursor(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        syntaxHighlighting(classHighlighter),
        EditorState.tabSize.of(s.tabSize),
        indentUnit.of(" ".repeat(s.tabSize)),

        // Autocomplete: language-specific completions (from the language pack)
        // plus every word already in the file as a fallback.
        autocompletion({ activateOnTyping: true }),
        EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),

        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        this.lang.of([]),
        this.wrap.of(s.lineWrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !this.loading) this.requestSave();
        }),
      ],
    });
  }
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

export default class CodeEditorPlugin extends Plugin {
  settings: CodeEditorSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new CodeView(leaf, this));

    // Claim every extension CodeMirror has a language for (except ones Obsidian already owns).
    const skip = new Set(["md", "markdown", "txt", "svg", "canvas", "base"]);
    const exts = new Set(languages.flatMap((l) => l.extensions).filter((e) => !skip.has(e)));
    for (const ext of exts) {
      try { this.registerExtensions([ext], VIEW_TYPE); } catch { /* already owned by another plugin */ }
    }

    this.addCommand({
      id: "format-code",
      name: "Format current code file",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(CodeView);
        if (!view) return false;
        if (!checking) void view.formatDocument();
        return true;
      },
    });

    this.addCommand({
      id: "new-code-file",
      name: "Create new code file",
      callback: () => new NewFileModal(this.app, (name) => this.createCodeFile(name)).open(),
    });

    this.addRibbonIcon("file-code", "New code file", () =>
      new NewFileModal(this.app, (name) => this.createCodeFile(name)).open());

    this.addSettingTab(new CodeEditorSettingTab(this.app, this));
  }

  async createCodeFile(name: string) {
    const active = this.app.workspace.getActiveFile();
    const folder: TFolder = this.app.fileManager.getNewFileParent(active?.path ?? "");
    const path = `${folder.path === "/" ? "" : folder.path + "/"}${name}`;
    try {
      const file = await this.app.vault.create(path, "");
      await this.app.workspace.getLeaf(true).openFile(file as TFile);
    } catch (e: any) {
      new Notice(`Could not create ${path}: ${e?.message ?? e}`);
    }
  }

  applySettingsToViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => (l.view as CodeView).applySettings());
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.applySettingsToViews();
  }
}

/* ------------------------------------------------------------------ */
/* UI bits                                                             */
/* ------------------------------------------------------------------ */

class NewFileModal extends Modal {
  constructor(app: App, private onSubmit: (name: string) => void) { super(app); }

  onOpen() {
    this.titleEl.setText("New code file");
    let value = "";
    const submit = () => { if (value.trim()) { this.close(); this.onSubmit(value.trim()); } };
    new Setting(this.contentEl)
      .setName("File name")
      .setDesc("Include the extension, e.g. script.py or utils.ts")
      .addText((t) => {
        t.setPlaceholder("main.py").onChange((v) => (value = v));
        t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
        setTimeout(() => t.inputEl.focus(), 0);
      });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Create").setCta().onClick(submit));
  }

  onClose() { this.contentEl.empty(); }
}

class CodeEditorSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CodeEditorPlugin) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Tab size").addSlider((s) =>
      s.setLimits(2, 8, 2).setValue(this.plugin.settings.tabSize).setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.tabSize = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Format on save")
      .setDesc("Run the formatter whenever you press Ctrl/Cmd+S in a code file.")
      .addToggle((t) => t.setValue(this.plugin.settings.formatOnSave)
        .onChange(async (v) => { this.plugin.settings.formatOnSave = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Wrap long lines").addToggle((t) =>
      t.setValue(this.plugin.settings.lineWrap)
        .onChange(async (v) => { this.plugin.settings.lineWrap = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("External formatters (desktop only)")
      .setDesc(
        "JSON map of file extension → shell command that reads code on stdin and writes formatted code to stdout. " +
        'Example: {"py": "black -q -", "go": "gofmt", "rs": "rustfmt --emit stdout"}. ' +
        "JS/TS/JSON/CSS/HTML/YAML are handled by built-in Prettier."
      )
      .addTextArea((t) => {
        t.setValue(JSON.stringify(this.plugin.settings.externalFormatters, null, 2));
        t.inputEl.rows = 6;
        t.inputEl.style.width = "100%";
        t.onChange(async (v) => {
          try {
            this.plugin.settings.externalFormatters = JSON.parse(v || "{}");
            t.inputEl.style.borderColor = "";
            await this.plugin.saveSettings();
          } catch {
            t.inputEl.style.borderColor = "var(--text-error)";
          }
        });
      });
  }
}
