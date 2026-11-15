# Cetli

**Cetli** is a snappy, cross-platform, open source todo list editor for plain text files. It reimplements (and slightly
improves) the much-loved but abandoned **TodoPaper** desktop app by Widefido, using the same TaskPaper file format.

*"Cetli" is Hungarian for a slip of paper.*

Your list stays a plain text file you can sync, grep, and edit anywhere:

```text
Inbox:
- call Bob about the launch @today
- write the quarterly report @priority(1)
	Include numbers from https://example.com/stats
- fix printer @done(2026-11-10)

Archive:
- old task @done(2026-10-01) @archive(Work)
```

- A line ending with `:` is a **project**. Tags may follow the colon.
- A line starting with `- ` is a **task**.
- Any other line is a **note**.
- `@tag` and `@tag(value)` are **tags**. `@done` marks an item as finished.

## Features

- **Styled plain-text editing:** projects, tasks, notes, done items (struck through), tags, links and `*bold*`.
- **Checkboxes and fold arrows** in the margin. Click a checkbox to toggle `@done(date)`. Click an arrow to fold the project.
- **TodoPaper keyboard behaviour:**
  - `Enter` continues tasks.
  - `Enter` at the end of a project line starts its first task.
  - `Enter` on an empty task outdents it.
  - `Tab` / `Shift+Tab` indent and outdent.
- **Live search filter** with TodoPaper syntax: `@today`, `<Project Name>`, `NOT @done`, `a OR b`, `"exact phrase"`.
  - Lines you edit in a filtered view stay visible until you refresh.
  - Saved searches and per-view search history.
- **Views:** tabs on the same document, each with its own search and folds. They are remembered per file.
- **Outline sidebar** (`Alt+O`) listing projects or tags. Click to jump, double-click to filter.
- **Tag commands:**
  - `Ctrl+D` done (with date).
  - `Ctrl+U` date.
  - `Ctrl+Y` today.
  - `Ctrl+1`…`9` priority.
  - Tag autocompletion as you type `@`.
- **Archive:** selected lines or all done tasks move under `Archive:` as `… @archive(Project_Name)`.
- **Move lines** (`Ctrl+Up/Down`), with their children (`Ctrl+Alt+Up/Down`), or to another project from the context menu.
- **Quick Log:** a global hotkey opens a small popup that adds an item to your Inbox (or any project) from anywhere.
  With several documents open, it lets you pick the file.
- **Multiple document windows** (`Ctrl+Alt+N`), each with its own file, views and search.
- **Autosave, TodoPaper style:** every minute a `name (autosave).ext` backup of unsaved changes is written.
  - After a crash, opening the file offers to restore it. Closing the file removes the backup.
  - Optional: save the file itself right after each edit.
- **Files changed on disk** (sync clients, other editors) are detected: Cetli asks before reloading, or reloads silently
  if you enable that.
  - Files are written as TodoPaper wrote them, so documents TodoPaper saved round-trip byte for byte.
- **Window transparency** (`Ctrl+Shift+9` / `0` / `8`) in TodoPaper's steps of 15.
- **Drop files** from the file manager onto the text to insert `file:///` links; `Ctrl`+click opens them.
- **Plugins and console:** TodoPaper's Python plugins (`*.todopaper.plugin.py`) run in the Python installed on the
  computer. JavaScript plugins work too. Both add commands under Tools › Plugins and react to startup and tag changes.
  - The console (``Ctrl+` ``) runs Python with `self` as the editor, as TodoPaper's did, or JavaScript.
  - See [docs/plugins](docs/plugins/README.md).
- **Find & Replace** (`Ctrl+F`), font zoom (`Ctrl+=`/`-`, Ctrl+mouse wheel), Page Setup and printing of the visible lines.
- **Spell checking** with suggestions and "Add Word to Dictionary" in the context menu, using the installed Windows
  dictionaries.
- **Themes:** Cetli, plus TodoPaper's Classic, Clean and Dark themes.
  - Every text style is configurable.
  - Custom styles for lines containing a given text.
- **System tray** icon and minimize-to-tray (optional). Single instance, with `.taskpaper` / `.todopaper` file associations.
- **TodoPaper migration:** on first start Cetli imports an existing TodoPaper installation. That covers its preferences
  and styles, the Quick Log hotkey, inbox name, date format, default tags, autosave interval, recent files, saved
  searches, zoom level and window transparency. It then reopens your last file.

Press `F1` in the app for the full shortcut list.

### How Cetli groups lines

Like TodoPaper, a top-level project owns every following line up to the next top-level project, even unindented
tasks. So this works without indenting the tasks:

```text
Work:
- task one
- task two
Home:
- task three
```

Indented children (TaskPaper style) work too. In general, a project at indentation level *L* owns the following lines
until a project at level ≤ *L*, or a non-project line at a level < *L*.

## Compatibility with TodoPaper

Cetli reimplements TodoPaper 1.1.5's behaviour. The reference was the original program itself, which is abandonware.
That covers:

- **Format and display:** the line classification is a port of TodoPaper's lexer. Tags are whitespace-free words;
  `@done` is detected as TodoPaper did.
- **Editing:** the menus and shortcuts, the Enter/Tab rules, and tag toggling.
- **Search and archive:** search semantics (`NOT`/`OR` stay active for the following terms; `<Project>` matches
  "Project:" anywhere) and archiving.
- **Files:** written the way TodoPaper wrote them: UTF-8, with CRLF line endings, or LF for `.taskpaper`.
- **Window behaviour:** Escape quits (or hides to the tray), backup autosave (`name (autosave).ext`, removed when the
  file is closed) and the reload prompt.
- **Quick Log hotkey:** works with the same key, `Ctrl+<` included. If a still-running TodoPaper holds the key, Cetli
  takes it over as soon as TodoPaper exits.

Two opt-in preferences offer modern alternatives:

- **Autosave writes:** the file itself, instead of a backup copy.
- **Reload files changed on disk without asking:** applies when there are no unsaved changes.

Cetli also has a few additions. TodoPaper's own behaviour is unchanged by them:

- It opens Windows-1252 files, which TodoPaper refused; they are saved as UTF-8 like every TodoPaper file.
- It also runs on macOS and Linux (TodoPaper was Windows-only). There, line endings are kept as found and window
  transparency is not available.

Plugins need one extra step. TodoPaper ran plugins and its console in its own embedded Python 2.5. Cetli runs them in
the Python installed on the computer:

- It prefers Python 2.7, so plugins written for TodoPaper run unchanged. Otherwise it uses Python 3.
- Python plugins get TodoPaper's `Plugins` module and its editor methods, with the same positions (UTF-8 bytes,
  CRLF included) and 0-based line numbers.
- Copy `*.todopaper.plugin.py` files into Cetli's plugins folder. Compiled `*.todopaper.plugin` files load too when they
  were compiled for the Python in use. TodoPaper's own were compiled for Python 2.5, so use their source instead.
- `BeginUndoAction`/`EndUndoAction` group a plugin's edits into one undo step, as in TodoPaper.
- Plugin dialogs made with wxPython work when wxPython is installed in that Python.
- Python is not bundled. TodoPaper's interpreter is a 32-bit Python 2.5 inside its own program, which a 64-bit app
  cannot load. Bundling Python 2.7 (end-of-life, with no official embeddable build) would multiply the download size
  for a feature few people use.
- JavaScript plugins are an addition and need nothing installed.

Left out on purpose: registration, the trial dialog and update checks. The complete command-by-command audit
is in [docs/todopaper-parity.md](docs/todopaper-parity.md).

## Building

Requirements: [Node.js](https://nodejs.org/) 20+, [Rust](https://rustup.rs/) 1.80+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS (WebView2 on Windows, which ships with Windows 10/11).

```sh
npm install
npm run app:dev      # run the desktop app with hot reload
npm run app:build    # build the app and installers (src-tauri/target/release/bundle)
npm run dev          # run the UI in a plain browser (in-memory sample file) on http://127.0.0.1:45834
```

## Testing

```sh
npm test                                   # unit tests (parser, outline, search, commands, settings, Python plugins with the installed Python)
npx playwright test                        # end-to-end tests of the UI in a browser (uses installed Edge; PW_CHANNEL=chrome to switch)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust: file encoding round trips, hotkey parsing, Python bridge
npx tauri build --debug --no-bundle --config src-tauri/tauri.dev.conf.json && npx playwright test -c playwright.desktop.config.ts
                                           # Windows: drives the real desktop app (disk I/O, quick log, global hotkey, real keystrokes)
```

Set `CETLI_REAL_FILE=/path/to/todo.txt` to also run read-only checks against a real document: the performance test
(`npm test`) and, after the dev build above, `npx playwright test -c playwright.desktop.config.ts realfile`. That one
opens it in the isolated dev build with your TodoPaper settings imported, verifies a byte-identical round trip through Cetli's
writer into a temporary copy, and asserts that the document itself is untouched.

## Project structure

```text
src/core/       pure logic: line parser, project hierarchy, search queries, dates, paths, Python-literal parser, Scintilla positions
src/editor/     CodeMirror 6 integration: outline state, filtering/folding, styling, gutter, commands, keymaps
src/app/        application shell: controller, actions and menus, preferences, quick log, plugins (JavaScript, Python), console, settings and themes
src/platform/   host abstraction: Tauri desktop implementation and an in-memory browser implementation
src-tauri/      Rust shell: file I/O preserving encodings, config, TodoPaper import, windows, tray, Windows hotkeys/transparency/file drops,
                Python plugin host (src/python.rs runs src/python/cetli_bridge.py)
tests/          unit (Vitest), e2e (Playwright, browser) and desktop (Playwright over WebView2 CDP) tests
```

## License

MIT. Cetli is an independent project, not affiliated with Widefido. TodoPaper is a trademark of its respective owner.
