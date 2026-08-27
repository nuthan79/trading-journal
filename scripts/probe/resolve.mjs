/**
 * Lets a probe import the app's own modules with no build step.
 *
 * `src/` is written for Next: `@/lib/foo` aliases and imports with no file
 * extension. Node resolves neither, which is why every probe run during
 * development meant copying files to a scratch directory and rewriting their
 * imports with sed — a step that silently tested a COPY, and one nobody would
 * repeat often enough for the probes to be worth having.
 *
 * A resolver hook fixes it in twenty lines and adds no dependency. The probes
 * import the real files, so a probe cannot pass against a stale copy.
 */

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * Modules a probe must never really load.
 *
 * `db.js` opens a Supabase client at import time and every module that talks
 * to the network reaches it eventually. The stub keeps the same exported
 * shape — notably that `apiFetch` returns a RESPONSE rather than a parsed
 * body, which is the contract measure.js got wrong and shipped.
 */
const STUBS = {
  [path.join(ROOT, "src/lib/db")]: path.join(ROOT, "scripts/probe/stubs/db.js"),
};

const EXTS = ["", ".js", ".mjs", "/index.js"];

export async function resolve(specifier, context, nextResolve) {
  let base = null;
  if (specifier.startsWith("@/")) {
    base = path.join(ROOT, "src", specifier.slice(2));
  } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    base = fileURLToPath(new URL(specifier, context.parentURL));
  }
  if (base) {
    const stub = STUBS[base] || STUBS[base.replace(/\.js$/, "")];
    if (stub) return { url: pathToFileURL(stub).href, shortCircuit: true, format: "module" };
    for (const ext of EXTS) {
      const full = base + ext;
      if (full && existsSync(full) && !full.endsWith("/")) {
        return { url: pathToFileURL(full).href, shortCircuit: true, format: "module" };
      }
    }
  }
  return nextResolve(specifier, context);
}
