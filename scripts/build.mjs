import { build as bundle } from "esbuild";
import { build as viteBuild } from "vite";
await bundle({
  entryPoints: ["backend/src/workspace.ts", "backend/src/validation.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outdir: "backend/dist",
  outExtension: { ".js": ".mjs" },
});
await viteBuild({ configFile: "frontend/vite.config.ts" });
