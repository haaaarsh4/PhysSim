import { defineConfig } from "vite";

// The app entry (frontend/index.html) lives inside frontend/, but it imports
// modules from ../simulation, ../solvers, ../geometry, etc. - sibling
// top-level folders, per the project's module layout. Vite's dev server
// normally refuses to serve files outside its `root`, so we widen
// server.fs.allow to the repo root instead of flattening the folder
// structure to please the bundler.
export default defineConfig({
  root: "frontend",
  server: {
    fs: { allow: [".."] },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
