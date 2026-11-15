// Example Cetli plugin: copy this file into Cetli's plugins folder
// (Tools > Plugins > Open Plugins Folder) and choose Tools > Plugins > Reload Plugins.

export const name = "Timestamps";

export default function (cetli) {
  // Tools > Plugins > Timestamps > Insert Timestamp (Ctrl+Alt+D)
  cetli.addMenuItem("Insert Timestamp", () => cetli.insertText(new Date().toLocaleString()), "Mod-Alt-d");

  // Tools > Plugins > Timestamps > Count Open Tasks
  cetli.addMenuItem("Count Open Tasks", () => {
    let open = 0;
    for (let n = 1; n <= cetli.lineCount(); n++) {
      const line = cetli.getLine(n).trim();
      if (line.startsWith("- ") && !/@done\b/.test(line)) open++;
    }
    cetli.toast(`${open} open tasks`);
  });

  // react when a line gets tagged @today
  cetli.onTagChange("today", (e) => {
    if (e.added) cetli.toast(`Line ${e.line} is due today`);
  });
}
