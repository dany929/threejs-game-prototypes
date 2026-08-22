import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viewerRoot = path.join(root, "model-viewer");
const generatedModelDir = path.join(viewerRoot, "public", "models", "industrial-staircase");
const exportDir = path.join(root, "exports", "industrial-staircase-obj");
const outputDir = path.join(root, "docs");

await rm(generatedModelDir, { recursive: true, force: true });
await mkdir(path.dirname(generatedModelDir), { recursive: true });
await cp(exportDir, generatedModelDir, { recursive: true });

await build({
  root: viewerRoot,
  base: "./",
  publicDir: path.join(viewerRoot, "public"),
  build: {
    outDir: outputDir,
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
});

console.log(`Model QA viewer built at ${outputDir}`);
