/**
 * storage/io.js - browser-safe persistence.
 *
 * Import this from frontend/ code. It never touches Node's `fs`, so it's
 * safe inside the Vite bundle. Two mechanisms:
 *   - downloadJSON / uploadJSONFile: the browser's actual file system,
 *     a real save-as / open-file dialog, via a Blob and an <input type=file>.
 *   - localStorage helpers: same-origin persistence across reloads,
 *     useful for "remember my last scene" without any download at all.
 *
 * For Node-side persistence (used by experiments/*.js when run via
 * `node experiments/...`), see storage/io.node.js instead - that file is
 * never imported by the frontend bundle.
 */

/**
 * Save a table as CSV - the one format a lab report, a spreadsheet and a
 * plotting script all accept without an argument.
 *
 * @param {string} filename
 * @param {string[]} columns header row
 * @param {Array<Array<string|number>>} rows one array per row, in column order
 */
export function downloadCSV(filename, columns, rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [columns, ...rows].map((row) => row.map(cell).join(",")).join("\n");
  const blob = new Blob([`${body}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Opens a file picker and resolves with the parsed JSON, or null if cancelled. */
export function uploadJSONFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(reader.result)); }
        catch (err) { console.error("invalid JSON checkpoint file", err); resolve(null); }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}

export function saveToLocalStorage(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

export function loadFromLocalStorage(key) {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}
