# -*- coding: utf-8 -*-
"""Cetli's Python bridge: runs TodoPaper-style Python plugins and console commands.

Cetli starts this script with the installed Python (2.7 preferred, because TodoPaper's
plugins were Python 2) and exchanges one JSON message per line over stdin/stdout.

A `Plugins` module compatible with TodoPaper 1.1.5's is provided (PluginProvider,
PluginMount, PluginInterface, menu_item, mount_point), so plugin files written for
TodoPaper load unchanged. The editor object forwards method calls (TodoPaper's
Scintilla methods and TodoPaper's own) to Cetli and returns the results.

Messages from Cetli:  load {files}, run {plugin, item}, mount {name}, console {code},
                      tag {tag, line, deleted}
Messages to Cetli:    ready {version}, loaded {plugins}, done {output?, error?}, call {name, args, kwargs?}
Replies from Cetli to a call:  result {value} or result {error}
"""
from __future__ import print_function

import json
import marshal
import os
import re
import sys
import traceback
import types

CHANNEL = sys.stdout  # protocol channel
sys.stdout = sys.stderr  # stray prints (e.g. while a plugin file loads) must never reach the channel


def send(msg):
    """Send one message to Cetli."""
    CHANNEL.write(json.dumps(msg) + "\n")
    CHANNEL.flush()


def receive():
    """Read one message from Cetli (exit when Cetli closes the pipe)."""
    line = sys.stdin.readline()
    if not line:
        sys.exit(0)
    return json.loads(line)


def call(name, args, kwargs=None):
    """Ask Cetli to run an editor method and wait for its result."""
    msg = {"type": "call", "name": name, "args": list(args)}
    if kwargs:
        msg["kwargs"] = kwargs
    send(msg)
    msg = receive()
    if msg.get("error"):
        raise RuntimeError(msg["error"])
    return msg.get("value")


TAG_CALLBACKS = {}


class Editor(object):
    """TodoPaper's editor control; every method call is forwarded to Cetli."""

    def tag_register_callback(self, tag, callback):
        """Call callback(editor, line, tag, deleted=...) when the tag is added to or removed from a line."""
        TAG_CALLBACKS[tag] = [callback]
        call("tag_register_callback", [tag])

    def tag_unregister_callbacks(self, tag):
        """Stop calling back for a tag."""
        TAG_CALLBACKS.pop(tag, None)
        call("tag_unregister_callbacks", [tag])

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)

        def method(*args, **kwargs):
            return call(name, args, kwargs)

        method.__name__ = str(name)
        return method


EDITOR = Editor()


class Frame(object):
    """Stand-in for TodoPaper's editor frame (passed to the on_start mount point)."""

    def __init__(self):
        self.activeEditor = EDITOR
        self.mainEditor = EDITOR
        self.editors = [EDITOR]

    def getActiveEditor(self):
        return EDITOR


FRAME = Frame()


class PluginInterface(object):
    """TodoPaper's plugin interface: access to the editors."""

    editors = []

    def __init__(self, editor_frame=None):
        self.editor_frame = editor_frame or FRAME
        self.get_editors()

    def get_editors(self):
        self.editors = [EDITOR]
        return self.editors

    def get_current_editor(self):
        return EDITOR


class PluginMount(type):
    """TodoPaper's plugin metaclass: subclasses of PluginProvider register themselves."""

    def __init__(cls, name, bases, attrs):
        type.__init__(cls, name, bases, attrs)
        if not hasattr(cls, "plugins"):
            cls.plugins = []
            cls.mounts = {}
            cls.mounted_plugins = {}
            cls.plugin_instances = {}
            return
        cls.plugins.append(cls)
        if attrs.get("menu_items") is not None:
            cls.menu_items = list(attrs["menu_items"])  # set by the plugin itself, as in TodoPaper
        else:
            decorated = sorted(f._cetli_menu + (f,) for f in attrs.values() if hasattr(f, "_cetli_menu"))
            cls.menu_items = [(label, key, fn) for _order, label, key, fn in decorated]
        cls.menu_mappings = {}
        if not attrs.get("plugin_name"):
            cls.plugin_name = name
        if hasattr(cls, "mount_points"):
            for point in cls.mount_points:
                cls.mounted_plugins[point] = cls
        elif hasattr(cls, "mount_point"):
            cls.mounted_plugins[cls.mount_point] = cls

    def get_mount_points(cls):
        return sorted(cls.mounted_plugins.keys())

    def register_plugin(cls, mount_point, plugin, override=False):
        if override or mount_point not in cls.mounted_plugins:
            cls.mounted_plugins[mount_point] = plugin

    def unregister_plugin(cls, mount_point):
        cls.mounted_plugins.pop(mount_point, None)

    def clear_plugins(cls):
        cls.plugins = []
        cls.mounts = {}
        cls.mounted_plugins = {}
        cls.plugin_instances = {}

    def run_mount_point(cls, mount_point, *args, **kwargs):
        """Run the actions registered for a mount point (TodoPaper semantics)."""
        if mount_point in cls.mounts:
            result = None
            for action, plugin in cls.mounts[mount_point]:
                result = action(plugin, *args, **kwargs)
            return result
        if mount_point in cls.mounted_plugins:
            plugin = cls.mounted_plugins[mount_point]
            if hasattr(plugin, "plugins"):
                instance = plugin()
                action = "action_%s" % mount_point
                if hasattr(instance, action):
                    return getattr(instance, action)(*args, **kwargs)
                if hasattr(instance, "mount_action"):
                    return instance.mount_action(*args, **kwargs)
            else:
                return plugin(*args, **kwargs)
        return None


PluginProvider = PluginMount("PluginProvider", (object,), {
    "__doc__": "Mount point for plugins: subclass it and decorate methods with menu_item / mount_point.",
    "plugin_name": "",
    "menu_items": [],
    "__init__": lambda self, *args, **kwargs: None,
})

MODULE_ITEMS = []  # every decorated menu function, in definition order


def menu_item(label, accelerator="", clear=False):
    """Add the decorated function to the Plugins menu (TodoPaper's decorator).

    Like TodoPaper it collects the item in PluginProvider.menu_items (which `clear`
    resets); each plugin class gets its own decorated functions in definition order.
    """

    def decorator(fn):
        item = (label, accelerator, fn)
        if clear:
            PluginProvider.menu_items = [item]
        elif item not in PluginProvider.menu_items:
            PluginProvider.menu_items.append(item)
        fn._cetli_menu = (len(MODULE_ITEMS), label, accelerator)
        MODULE_ITEMS.append(item)
        return fn

    return decorator


def mount_point(name, index=None):
    """Run the decorated function at a mount point such as "on_start" (TodoPaper's decorator)."""

    def decorator(fn):
        value = (fn, None)
        slot = PluginProvider.mounts.setdefault(name, [])
        if index is not None:
            slot.insert(index, value)
        else:
            slot.append(value)
        return fn

    return decorator


PLUGINS_MODULE = types.ModuleType("Plugins")
for _name in ("PluginInterface", "PluginMount", "PluginProvider", "menu_item", "mount_point"):
    setattr(PLUGINS_MODULE, _name, globals()[_name])
sys.modules["Plugins"] = PLUGINS_MODULE


class Capture(object):
    """Collects text printed by plugins and console commands."""

    def __init__(self):
        self.parts = []

    def write(self, text):
        self.parts.append(text)

    def flush(self):
        pass

    def text(self):
        return "".join(self.parts)


class PluginEntry(object):
    """A menu group shown under Tools > Plugins."""

    def __init__(self, name, items, owner):
        self.name = name
        self.items = items  # (label, accelerator, function)
        self.owner = owner  # plugin class or None for module-level functions


ENTRIES = []


MODULES = []  # loaded plugin modules; kept alive, since Python 2 clears the globals of collected modules


WX_APP = []  # the wx application, created once a plugin uses wxPython
WX_IMPORT = re.compile(br"^\s*(import|from)\s+wx\b", re.M)


def ensure_wx_app():
    """Create a wx application (once), so dialogs of plugins using wxPython work."""
    import wx  # noqa: imported only for plugins that use it
    if not WX_APP and wx.GetApp() is None:
        WX_APP.append(wx.App(False))


def bytecode_magic():
    """Magic number at the start of this Python's compiled files."""
    if sys.version_info[0] == 2:
        import imp
        return imp.get_magic()
    import importlib.util
    return importlib.util.MAGIC_NUMBER


def compiled_code(data, path):
    """Code object of a compiled plugin (*.todopaper.plugin), as TodoPaper loaded it."""
    if data[:4] != bytecode_magic():
        raise ImportError("%s was compiled for another Python version (TodoPaper used Python 2.5); "
                          "use the plugin's .py source" % os.path.basename(path))
    header = 8 if sys.version_info < (3, 3) else 12 if sys.version_info < (3, 7) else 16
    return marshal.loads(data[header:])


def load_file(path):
    """Execute one plugin file (source or compiled) in its own module, as TodoPaper loaded plugins."""
    module = types.ModuleType("loaded_plugins")
    module.__file__ = path
    MODULES.append(module)
    sys.modules["loaded_plugins"] = module
    handle = open(path, "rb")
    try:
        data = handle.read()
    finally:
        handle.close()
    if path.lower().endswith(".todopaper.plugin"):
        code = compiled_code(data, path)
        uses_wx = "wx" in repr(code.co_consts) or "wx" in code.co_names
    else:
        code = compile(data, path, "exec", 0, True)  # do not inherit the bridge's __future__ flags
        uses_wx = WX_IMPORT.search(data) is not None
    if uses_wx:
        try:
            ensure_wx_app()
        except ImportError:
            pass  # wxPython is not installed: the plugin reports it when it imports wx
    exec(code, module.__dict__)


def load(files):
    """Load plugin files and report the resulting menu groups and errors."""
    report = []
    for path in files:
        classes_before = len(PluginProvider.plugins)
        items_before = len(MODULE_ITEMS)
        name = os.path.basename(path).split(".")[0]
        try:
            load_file(path)
        except Exception:
            report.append({"name": name, "path": path, "items": [], "error": traceback.format_exc().strip().splitlines()[-1]})
            continue
        claimed = set()
        for cls in PluginProvider.plugins[classes_before:]:
            ENTRIES.append(PluginEntry(cls.plugin_name, list(cls.menu_items), cls))
            claimed.update(id(i[2]) for i in cls.menu_items)
            report.append(entry_report(len(ENTRIES) - 1, path))
        loose = [i for i in MODULE_ITEMS[items_before:] if id(i[2]) not in claimed]
        if loose:
            ENTRIES.append(PluginEntry(name, loose, None))
            report.append(entry_report(len(ENTRIES) - 1, path))
    return report


def entry_report(index, path):
    """Describe a menu group for Cetli."""
    entry = ENTRIES[index]
    return {"index": index, "name": entry.name, "path": path, "items": [{"label": i[0], "key": i[1]} for i in entry.items]}


class Holder(object):
    """Carries the plugin interface for module-level menu functions."""

    def __init__(self):
        self.interface = PluginInterface(FRAME)


def captured(action):
    """Run an action while capturing its prints; returns (output, error)."""
    capture = Capture()
    previous = sys.stdout
    sys.stdout = capture
    try:
        action()
        return capture.text(), None
    except Exception:
        return capture.text(), traceback.format_exc()
    finally:
        sys.stdout = previous


def run_item(index, item):
    """Run a plugin menu function like TodoPaper: function(plugin) with plugin.interface set."""
    entry = ENTRIES[index]
    fn = entry.items[item][2]
    target = entry.owner if entry.owner is not None else Holder()
    target.interface = PluginInterface(FRAME)
    return captured(lambda: fn(target))


CONSOLE = {"__name__": "__console__", "self": EDITOR, "editor": EDITOR, "Plugins": PLUGINS_MODULE}


def run_console(code):
    """Run console code with `self` being the editor, as in TodoPaper's console."""
    compiled = compile(code.replace("\r\n", "\n") + "\n", "<console>", "exec", 0, True)
    output, error = captured(lambda: exec_in(compiled, CONSOLE))
    return output + (error or "Command completed successfully")


def exec_in(code, namespace):
    """Execute compiled code in a namespace (works on Python 2 and 3)."""
    exec(code, namespace)


def tag_callbacks(tag):
    """Callbacks registered for a tag such as "@today" (names compared without "@" and case)."""
    name = tag.lstrip("@").lower()
    return [fn for key, fns in TAG_CALLBACKS.items() if key.lstrip("@").lower() == name for fn in fns]


def run_tag_callbacks(tag, line, deleted):
    """Run the callbacks for a tag change, as TodoPaper's editor did."""
    for fn in tag_callbacks(tag):
        fn(EDITOR, line, tag, deleted=deleted)


def main():
    send({"type": "ready", "version": "%d.%d.%d" % sys.version_info[:3]})
    while True:
        msg = receive()
        kind = msg.get("type")
        if kind == "load":
            send({"type": "loaded", "plugins": load(msg.get("files", []))})
        elif kind == "run":
            output, error = run_item(msg["plugin"], msg["item"])
            send({"type": "done", "output": output, "error": error})
        elif kind == "mount":
            output, error = captured(lambda: PluginProvider.run_mount_point(msg["name"], FRAME))
            send({"type": "done", "output": output, "error": error})
        elif kind == "console":
            try:
                send({"type": "done", "output": run_console(msg.get("code", ""))})
            except SyntaxError:
                send({"type": "done", "output": traceback.format_exc()})
        elif kind == "tag":
            output, error = captured(lambda: run_tag_callbacks(msg["tag"], msg["line"], msg["deleted"]))
            send({"type": "done", "output": output, "error": error})
        elif kind == "quit":
            return


if __name__ == "__main__":
    main()
