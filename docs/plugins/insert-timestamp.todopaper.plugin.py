# -*- coding: utf-8 -*-
"""Example TodoPaper-style Python plugin for Cetli.

Adds Tools > Plugins > Timestamp > Insert Timestamp (Ctrl+Alt+D), which replaces
the selection with the current date and time, and "Tag Selected Lines @review",
which appends a tag to every selected line using TodoPaper's editor methods.
Runs with Python 2.7 and Python 3. Copy it into Cetli's plugins folder.
"""
import time

from Plugins import PluginProvider, menu_item


class Timestamp(PluginProvider):
    """The "Timestamp" submenu."""

    plugin_name = "Timestamp"

    @menu_item("Insert Timestamp", "Ctrl+Alt+D")
    def insert_timestamp(self):
        """Replace the selection with the current date and time."""
        editor = self.interface.get_current_editor()
        editor.ReplaceSelection(time.strftime("%Y-%m-%d %H:%M"))

    @menu_item("Tag Selected Lines @review")
    def tag_review(self):
        """Append @review to each selected line that does not have it yet."""
        editor = self.interface.get_current_editor()
        for line in editor.getSelectedLines():
            if "@review" not in editor.getLineText(line):
                editor.InsertText(editor.GetLineEndPosition(line), " @review")
