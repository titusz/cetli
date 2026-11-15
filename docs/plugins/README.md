# Cetli plugins

Cetli runs two kinds of plugins:

- **TodoPaper's Python plugins** (`*.py`, or compiled `*.todopaper.plugin`), in the Python installed on the computer.
- **JavaScript plugins** (`*.js`), which need nothing installed.

Both kinds work the same way:

- **Location:** plugins are loaded at startup from Cetli's plugins folder. Open the folder with
  **Tools › Plugins › Open Plugins Folder**. On Windows it is `%APPDATA%\org.cetli.app\plugins`.
- **Reloading:** after changing a plugin, choose **Tools › Plugins › Reload Plugins**.
  - Python plugins restart in a fresh Python process, so their `on_start` runs again.
  - JavaScript start hooks (`onStart`) run only when Cetli starts.
- **Menus:** each plugin gets a submenu under **Tools › Plugins**.

## Python plugins (TodoPaper)

Copy your `*.todopaper.plugin.py` files into the plugins folder. TodoPaper also loaded compiled `*.todopaper.plugin`
files; Cetli loads them when they were compiled for the Python in use. TodoPaper's own were compiled for Python 2.5,
so use their `.py` source.

TodoPaper ran plugins in its own embedded Python 2.5. Cetli looks for an installed Python:

- It tries `py -2`, then `python2`, so plugins written for TodoPaper (Python 2 syntax) run unchanged.
- Otherwise it uses Python 3 (`py -3`, `python3`, `python`).
- Help › Show Debug Information shows which Python is used.
- Python starts only when there are Python plugins or the console runs Python.

```python
from Plugins import PluginProvider, menu_item, mount_point

def on_today(editor, line, tag, deleted=False):
    if not deleted:
        editor.AddToInbox(u"look at line %d" % (line + 1))

class Hello(PluginProvider):
    plugin_name = "Hello"

    @menu_item("Add Greeting", "Ctrl+Alt+H")
    def add_greeting(self):
        editor = self.interface.get_current_editor()
        editor.AddToProject(u"hello", "Inbox")      # appends "- hello" to Inbox

@mount_point("on_start")
def started(plugin, frame):
    frame.activeEditor.tag_register_callback("@today", on_today)
```

Cetli provides TodoPaper's own plugin interface:

- **`Plugins` module:**
  - `PluginProvider`: subclass it and set `plugin_name`, which becomes the submenu.
  - `@menu_item(label, accelerator)`: accelerators use wxWidgets syntax such as `"Ctrl+Alt+H"`.
  - `@mount_point("on_start")`: the function runs as `fn(plugin, frame)` after startup, and
    `frame.activeEditor` is the editor.
  - `PluginInterface`.
  - A class can also list its items itself in `menu_items = [(label, accelerator, function), ...]`.
- **Menu functions** are called with the plugin class. `self.interface.get_current_editor()` returns the editor.
- **Tag callbacks:** `editor.tag_register_callback("@today", fn)` calls `fn(editor, line, tag, deleted=...)` whenever
  a line gains or loses the tag.
- **Positions:** editor methods use TodoPaper's (Scintilla's) conventions. Positions are UTF-8 byte offsets that count
  the file's line endings (CRLF on Windows), and line numbers start at 0. Plugin code computes the same numbers it
  did in TodoPaper.
- **Output and errors:** `print` output goes to the log in Help › Show Debug Information. An exception shows
  TodoPaper's "There was an error running your plugin" message.
- **Undo:** as in TodoPaper (Scintilla), each edit is its own undo step. Edits between `BeginUndoAction()` and
  `EndUndoAction()` become one step, and groups nest. A group a plugin leaves open is closed when its command ends.
- **wxPython:** a plugin that imports `wx` gets a wx application, so its dialogs (`wx.MessageBox`,
  `wx.TextEntryDialog`, ...) work when wxPython is installed in that Python. Plugins run in their own process, so a
  dialog's parent must be `None`, and windows that need a running event loop (non-modal frames) are not supported.

### Editor methods

| Kind | Methods |
|---|---|
| Text | `GetText`, `SetText`, `GetValue`, `SetValue`, `ClearAll`, `GetLength`, `GetTextLength`, `GetLineCount`, `GetLine`, `getLineText`, `GetCurLine`, `GetSelectedText`, `GetTextRange` |
| Positions | `GetCurrentPos`, `SetCurrentPos`, `GetAnchor`, `SetAnchor`, `SetPos`, `GotoPos`, `GotoLine`, `GetCurrentLine`, `LineFromPosition`, `PositionFromLine`, `GetLineStartPosition`, `GetLineEndPosition`, `getLineSpan`, `LineLength` |
| Selection | `GetSelection`, `SetSelection`, `GetSelectionStart`, `GetSelectionEnd`, `SetSelectionStart`, `SetSelectionEnd`, `ClearSelection`, `SelectAll`, `SelectLine`, `DocumentStart`, `DocumentEnd`, `getSelectedLines` |
| Editing | `AddText`, `InsertText`, `AppendText`, `ReplaceSelection`, `Clear`, `LineDelete`, `deleteLine`, `replaceLine`, `insertLine`, `Undo`, `Redo`, `CanUndo`, `CanRedo`, `BeginUndoAction`, `EndUndoAction` |
| TodoPaper | `AddToProject(text, project, makeTask=True)`, `AddToInbox`, `GetInboxName`, `getAllTags`, `getAllProjects`, `getProjectNameFromLine`, `GetIndentLevel`, `isLineTask`, `isLineTitle`, `markTag`, `toggleTag`, `doTagDone`, `GetAllVisibleLines`, `GetAllVisibleText`, `tag_register_callback`, `tag_unregister_callbacks` |
| Commands | `tagDone`, `tagDate`, `tagToday`, `tagPriority(level)`, `insertTask`, `insertProject`, `insertTag`, `ArchiveDoneTasks`, `ArchiveCurrentLine(s)`, `toggleDoneTasks`, `toggleCurrentProject`, `ShowAllFolds(show)`, `ScrollToPrevProject`, `ScrollToNextProject`, `MoveCurrentLineUp/Down(group)`, `CutLine`, `Search(text)`, `SearchReset`, `SearchRefresh`, `ZoomIn`, `ZoomOut`, `ZoomNormal`, `Save`, `OpenConsole` |

Calling any other method raises an error naming it ("Editor method … is not available in Cetli").

See [insert-timestamp.todopaper.plugin.py](insert-timestamp.todopaper.plugin.py) for a complete example.

## JavaScript plugins

A JavaScript plugin is an ES module. Its default export receives the plugin API, and an optional
`export const name = "..."` sets the menu name:

```js
export const name = "My Plugin";

export default function (cetli) {
  cetli.addMenuItem("Do Something", () => cetli.toast("Hello"), "Mod-Alt-h");
}
```

### Plugin API

| Member | Description |
|---|---|
| `addMenuItem(label, run, key?)` | Adds an item under Tools › Plugins › *name*, with an optional shortcut such as `"Mod-Alt-d"` |
| `onStart(fn)` | Runs `fn` after Cetli has started and opened its document (TodoPaper's `on_start` mount point) |
| `onTagChange(tag, fn)` | Calls `fn({tag, line, text, added})` when a line gains or loses the tag |
| `getText()` / `setText(text)` | Reads or replaces the whole document |
| `lineCount()`, `getLine(n)`, `replaceLine(n, text)` | Line access, with 1-based line numbers |
| `insertText(text)` | Replaces the selection with text |
| `selectedLines()` | Numbers of the selected lines |
| `addToProject(text, project)` | Appends an item to a project, like Quick Log |
| `search(query)` | Sets the search filter |
| `runAction(id)` | Runs a built-in command, e.g. `"tagDone"` or `"archiveDone"` |
| `toast(message)` | Shows a short notification |
| `view`, `app` | The CodeMirror `EditorView` and the Cetli app object, for advanced use |

See [insert-timestamp.js](insert-timestamp.js) for a complete example.

## Console

The **Console** (``Ctrl+` ``, or TodoPaper's `Ctrl+Shift+F2`) runs code against the document. Choose the language
next to the Run button:

- **Python** is the default when Python is installed. As in TodoPaper's console, `self` is the editor, for example
  `print(self.GetLineCount())`.
- **JavaScript** has the plugin API available as `cetli`, for example `return cetli.lineCount()`.
