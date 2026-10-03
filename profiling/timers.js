/**
 * profiling/timers.js - where does the frame time actually go?
 *
 * A Profiler accumulates named timing samples via `time(name, fn)`,
 * which runs `fn`, records how long it took, and returns `fn`'s return
 * value - so it drops into simulation/fluid_solver.js's pipeline with no
 * change to control flow. Uses `performance.now()`, which is a global in
 * both the browser and modern Node, so this file needs no environment
 * detection at all.
 */
export class Profiler {
  constructor(historyLen = 240) {
    this.historyLen = historyLen;
    this.timings = new Map(); // name -> number[]
  }

  time(name, fn) {
    const t0 = performance.now();
    const result = fn();
    const ms = performance.now() - t0;
    let hist = this.timings.get(name);
    if (!hist) { hist = []; this.timings.set(name, hist); }
    hist.push(ms);
    if (hist.length > this.historyLen) hist.shift();
    return result;
  }

  mean(name) {
    const hist = this.timings.get(name);
    if (!hist || !hist.length) return 0;
    return hist.reduce((a, b) => a + b, 0) / hist.length;
  }

  totalMean() {
    let total = 0;
    for (const name of this.timings.keys()) total += this.mean(name);
    return total;
  }

  summary() {
    const out = {};
    for (const name of this.timings.keys()) out[name] = this.mean(name);
    return out;
  }

  printSummary() {
    const total = this.totalMean();
    const rows = Object.entries(this.summary()).sort((a, b) => b[1] - a[1]);
    for (const [name, ms] of rows) {
      const pct = total > 0 ? (100 * ms) / total : 0;
      console.log(`  ${name.padEnd(22)} ${ms.toFixed(3).padStart(7)} ms  (${pct.toFixed(1).padStart(4)}%)`);
    }
    console.log(`  ${"TOTAL".padEnd(22)} ${total.toFixed(3).padStart(7)} ms`);
  }
}
