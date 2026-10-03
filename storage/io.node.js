/**
 * storage/io.node.js - filesystem persistence for Node-only scripts.
 *
 * Used exclusively by experiments/parameter_sweep.js, experiments/benchmarks.js,
 * and experiments/checkpoints.js when invoked via `npm run sweep` /
 * `npm run bench` / a Node CLI. Never imported by frontend/ - Vite would
 * have nothing sensible to do with Node's `fs` module in a browser
 * bundle, so keeping filesystem code in its own file avoids that problem
 * entirely rather than working around it with bundler config.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // project root

export async function saveJSON(relativePath, data) {
  const path = `${ROOT}/${relativePath}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
  return path;
}

export async function loadJSON(relativePath) {
  const path = `${ROOT}/${relativePath}`;
  const text = await readFile(path, "utf-8");
  return JSON.parse(text);
}
