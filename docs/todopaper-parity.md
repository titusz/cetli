# TodoPaper 1.1.5 → Cetli parity

This audit maps every command and behaviour of TodoPaper 1.1.5.2 to its Cetli counterpart: menus and shortcuts,
editing, search, Quick Log, preferences, the file format and the plugin interface, as the original program behaves.

Test references:

- `unit`: `tests/unit/*.test.ts`
- `e2e`: `tests/e2e/*.spec.ts`, the UI in a browser
- `desktop`: `tests/desktop/desktop.spec.ts`, the real desktop app
- `real`: `tests/desktop/realfile.spec.ts`, a read-only run against a real TodoPaper document

## File menu

| TodoPaper | Shortcut | Cetli | Verified by |
|---|---|---|---|
| New | Ctrl+N | New | e2e: new document asks to save |
| New View | Ctrl+Alt+T | New View | e2e: views keep their own search |
| New Window | Ctrl+Alt+N | New Window | desktop: New Window …; e2e |
| Open | Ctrl+O | Open… | e2e: backup offered on open |
| Open Recent | | Open Recent (+ Clear) | real: recent files imported |
| Reload file from disk | | Reload File from Disk | unit/e2e: external change reload |
| Close | Ctrl+W | Close (view, else file) | e2e: views; saving: closing removes backup |
| Save | Ctrl+S | Save | e2e saving; desktop |
| Save As… | | Save As… (Ctrl+Shift+S) | |
| Page Setup… | | Page Setup… (orientation, margins, title) | e2e: Page Setup is used when printing |
| Print… | | Print… (visible lines, as filtered) | e2e: print renders the visible lines |
| Exit | Ctrl+Q | Exit (all windows) | |

## Edit menu

| TodoPaper | Shortcut | Cetli | Verified by |
|---|---|---|---|
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z | Undo / Redo | desktop: real keystrokes (Ctrl+Z) |
| Cut / Copy / Paste | Ctrl+X/C/V, Ctrl+Insert, Shift+Insert | same | |
| Cut Line | Ctrl+K | Cut Line (text, empty line stays) | unit |
| Select All | Ctrl+A | Select All | |
| Select Line | Alt+S | Select Line | unit |
| Select Hierarchy | Alt+H | Select Hierarchy | unit |
| Search… | Ctrl+Alt+S | Search… (also Ctrl+E) | |
| Find and Replace | Ctrl+F | Find and Replace | e2e; desktop: real Ctrl+F |
| Preferences… | | Preferences… | e2e: theme switch, cancel reverts |

## View menu

| TodoPaper | Shortcut | Cetli | Verified by |
|---|---|---|---|
| Show Document Outline | Alt+O | same (Projects / Tags) | e2e: outline sidebar |
| Jump to Previous / Next Project | Ctrl+PgUp / PgDn | same | unit |
| Expand / Collapse All Project Folds | Ctrl+< / Ctrl+> (also Ctrl+, / Ctrl+.) | same | e2e: collapse all and expand all |
| Fold/Unfold Current Project | Ctrl+M | same | unit |
| Hide Done Tasks | Ctrl+H | same (toggles `NOT @done`) | e2e; desktop: real Ctrl+H |
| Move to Previous / Next View | Ctrl+Shift+Tab / Ctrl+Tab | same | e2e: views |
| Less / More / Reset Transparency | Ctrl+Shift+0 / 9 / 8 | same, steps of 15 | e2e; desktop: native layered alpha |
| Increase / Decrease / Reset Font Zoom | Ctrl+= / Ctrl+- / Ctrl+0 | same (+ Ctrl+wheel) | e2e |
| Toggle Console | Ctrl+` (Ctrl+Shift+F2 in the editor) | Console… (Ctrl+`, Ctrl+Shift+F2): Python with `self` as the editor, or JavaScript | unit: Python console; desktop: Python console; e2e: JavaScript console |

## Tools menu

| TodoPaper | Shortcut | Cetli | Verified by |
|---|---|---|---|
| New Project | Ctrl+P | same ("New Project:" above, name selected) | unit; e2e; desktop: real Ctrl+P |
| New Task | Ctrl+T | same | unit; e2e |
| New Tag | Ctrl+G | same (@tag selected, autocompletion) | unit; e2e |
| Move Line Up / Down | Ctrl+Up / Down | same | unit; e2e |
| Move Line and Children Up / Down | Ctrl+Alt+Up / Down | same | unit; e2e |
| Tag Done | Ctrl+D | same (`@done(date)` per date format) | unit; e2e; desktop |
| Tag Date | Ctrl+U | same (`@date(date)`, exact-tag toggle) | unit; e2e |
| Tag Today | Ctrl+Y | same | unit; e2e |
| Tag Priority › Level 1–9 | Ctrl+1…9 | same (exact-tag toggle) | unit; e2e |
| Archive Selected Lines | Ctrl+Shift+A | same (`@archive(Project_Name)` under Archive:) | unit |
| Archive Done Tasks | Ctrl+Shift+D | same | unit; e2e; real (in memory) |
| Search History › Back / Forward | | same (also Alt+Left / Right) | |
| Reset Search | Ctrl+R | same | desktop: real Ctrl+R |
| Plugins › … | plugin-defined | Plugins › … (TodoPaper Python plugins in the installed Python, plus JavaScript plugins) | unit: TodoPaper plugin in Python 2.7, example in 2.7 and 3; desktop: Python and JavaScript plugins |

## Help menu

| TodoPaper | Cetli |
|---|---|
| Documentation | Documentation (in-app guide) and Keyboard Shortcuts (F1) |
| About TodoPaper | About Cetli |
| Show Debug Information (Ctrl+Shift+F10) | same (environment, document format, plugins, warning/error log) |
| Registration, Check for Updates, Visit the Widefido Website | not applicable (free software; the Widefido site no longer exists) |

## Context menu (right click)

| TodoPaper | Cetli | Verified by |
|---|---|---|
| Spelling… (suggestions, Add Word to Dictionary) | same, Windows spell checking service | e2e; desktop: Windows spell checker |
| Show This Project / Select This Entire Project | same | |
| Open Link in Default Browser | Open Link | |
| Remove this tag | Remove @tag (+ Filter by @tag) | unit |
| Tag line(s)… / Move line(s) to… / Archive line(s) | same | e2e: move a line to another project |
| Undo, Redo, Cut, Copy, Paste, Select All | same | |

## Editing and mouse behaviour

| TodoPaper | Cetli | Verified by |
|---|---|---|
| Line classification (projects, tasks, notes, tags, done) | same rules, quirks included | unit: parser incl. quirks |
| Enter rules (task continuation, empty task outdent/clear, Shift/Ctrl+Enter, project line) | same | unit; e2e |
| Tab / Shift+Tab indent lines | same | e2e |
| Escape: close completion, reset search, else quit (or hide to tray) | same | |
| Tag autocompletion after `@` (Tab/Enter) | same | e2e |
| Ctrl+B wraps selection in `*bold*`; bold styling | same | unit |
| Margin: checkbox toggles done; arrow folds; click on a note makes a task | same | e2e |
| Ctrl+click tag / project toggles it in the search; Ctrl+click link opens it | same | e2e |
| Drop files → `file:///` links; drop text | same | e2e; desktop: real disk paths |
| Editing a filtered view keeps edited and new lines visible; refresh button | same | unit; e2e |

## Search

| TodoPaper | Cetli | Verified by |
|---|---|---|
| Live filter; matching lines with their (direct) project | same | unit; e2e |
| `NOT`/`!`, `OR`/`|`, `AND`/`&`, operator stays active | same | unit |
| `<Project>` restricts to lines containing "Project:" | same | unit |
| Saved searches (Enter), search history, dropdown menu | same | e2e |
| Per-view search, views remembered per file | same | e2e |

## Files and saving

| TodoPaper | Cetli | Verified by |
|---|---|---|
| Reads UTF-8 / UTF-16; writes UTF-8, CRLF (LF for .taskpaper) | same | unit; desktop; real (byte-identical round trip) |
| Autosave: `name (autosave).ext` backup every interval; restore offer on open; removed on close | same | e2e saving; desktop |
| File changed on disk → reload prompt (while active) | same (silent reload optional) | e2e saving; desktop |
| Reopen last file on start; recent files; single instance | same | real |

## Quick Log

| TodoPaper | Cetli | Verified by |
|---|---|---|
| Global hotkey (default Ctrl+Space; configurable, e.g. Ctrl+<) | same, incl. the ISO `<>` key | desktop: native hotkey |
| Popup with "- " prefilled, project chooser (Inbox default), Enter logs, Shift+Enter new line, Esc cancels | same | e2e; desktop |
| File chooser with several windows, last file remembered | same | desktop: logs into the second window |
| Item appended after the project's last child, project created at the top if missing | same | unit |

## Preferences

| TodoPaper option | Cetli |
|---|---|
| Reopen last file, auto indent, word wrap, open outline | same |
| Minimize to tray, always show tray icon | same |
| Auto-tag done date, date format, default tags, inbox name | same |
| Quick log on/off and hotkey | same (hotkey taken over when freed) |
| Autosave and interval | same (+ optional "save the file itself") |
| Spell check and language | same (installed Windows dictionaries) |
| Default styles (projects, tasks, notes, done, tags; strike-out; highlight tags; caret line) | same |
| Themes (3 built in) | same 3 + Cetli theme |
| Custom styles (lines containing text; colors, bold/italic/underline/strike, whole line, size, font) | same |
| Automatically check for updates | not applicable |

## Migration

On first start Cetli imports `%APPDATA%\TodoPaper\todopaper.settings`, plus recent files, saved searches, zoom and
opacity from the registry. Verified by unit tests (settings parser and mapping) and by the `real` test.

## Plugins

| TodoPaper (`Plugins` module, editor object) | Cetli | Verified by |
|---|---|---|
| `*.todopaper.plugin.py` loaded from the `plugins` folder | `*.py` from Cetli's plugins folder, run in the installed Python (2.7 preferred, else 3) | unit; desktop |
| Compiled `*.todopaper.plugin` files | same, when compiled for the Python in use; a clear error otherwise (TodoPaper's are Python 2.5 bytecode) | unit (2.7 and 3) |
| `BeginUndoAction` / `EndUndoAction` (Scintilla undo groups) | same: one undo step, nested groups | unit |
| wxPython dialogs inside plugins | work when wxPython is installed in that Python (modal dialogs, parent `None`) | unit (with wxPython) |
| `PluginProvider`, `PluginMount`, `PluginInterface`, `menu_item`, `mount_point` | same names and behaviour | unit |
| Menu functions called as `fn(plugin)` with `plugin.interface`; errors: "There was an error running your plugin" | same | unit; desktop |
| `run_mount_point('on_start', frame)` after startup | same (`frame.activeEditor` is the editor) | unit; desktop |
| `tag_register_callback(tag, fn)` → `fn(editor, line, tag, deleted=...)` | same | unit; desktop |
| Editor methods: Scintilla positions (UTF-8 bytes, CRLF counted), 0-based lines | same for the methods listed in docs/plugins | unit |
| Console: `exec` with `self` as the editor | same, in the plugin bridge | unit; desktop |

## Differences

- **Plugins and console:** TodoPaper had its own embedded Python 2.5. Cetli uses the Python installed on the computer.
  - Why Python isn't bundled: TodoPaper's interpreter is 32-bit and built into its own program, so a 64-bit app
    cannot load it. Bundling Python 2.7 (end-of-life, no official embeddable build) would multiply the download size.
  - Plugins run in a separate process. Their wxPython dialogs need wxPython installed and a `None` parent, and
    non-modal wx windows are not supported.
  - TodoPaper's own compiled plugin files are Python 2.5 bytecode, which no current Python runs; their `.py` source
    works.
  - JavaScript plugins are an addition.
- **Additions:** Cetli also opens Windows-1252 files and runs on macOS and Linux, neither of which TodoPaper could do.
  These change nothing about TodoPaper's own behaviour.
