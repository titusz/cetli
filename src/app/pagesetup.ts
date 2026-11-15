/** File > Page Setup: paper orientation, margins and the title header used when printing. */

import type { App } from "./app";
import { openModal } from "./modal";

export interface PageSetup {
  orientation: "portrait" | "landscape";
  marginMm: number;
  header: boolean;
}

export const DEFAULT_PAGE_SETUP: PageSetup = { orientation: "portrait", marginMm: 15, header: true };

/** CSS @page rule for a page setup. */
export function pageCss(setup: PageSetup): string {
  const margin = Math.max(0, Math.min(60, setup.marginMm));
  return `@page { size: ${setup.orientation}; margin: ${margin}mm; }${setup.header ? "" : " .print-title { display: none; }"}`;
}

/** Open the Page Setup dialog and store the result in the app state. */
export async function showPageSetup(app: App): Promise<void> {
  const setup = { ...app.state.pageSetup };
  const body = document.createElement("div");
  body.className = "pref-panel page-setup";
  body.innerHTML = `
    <label class="pref-field"><span class="pref-label">Orientation</span>
      <select name="orientation"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
    <label class="pref-field"><span class="pref-label">Margins (mm)</span><input name="margin" type="number" min="0" max="60" step="1"></label>
    <label class="pref-check"><input name="header" type="checkbox"> Print the file name above the list</label>`;
  const orientation = body.querySelector<HTMLSelectElement>("[name=orientation]")!;
  const margin = body.querySelector<HTMLInputElement>("[name=margin]")!;
  const header = body.querySelector<HTMLInputElement>("[name=header]")!;
  orientation.value = setup.orientation;
  margin.value = String(setup.marginMm);
  header.checked = setup.header;
  const result = await openModal(body, [
    { id: "cancel", label: "Cancel" },
    { id: "ok", label: "OK", primary: true },
  ], { title: "Page Setup" });
  if (result !== "ok") return;
  app.state.pageSetup = {
    orientation: orientation.value === "landscape" ? "landscape" : "portrait",
    marginMm: Number(margin.value) || 0,
    header: header.checked,
  };
  app.saveState();
}
