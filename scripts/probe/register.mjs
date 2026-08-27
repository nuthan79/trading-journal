/* Installs the resolver hook before anything under src/ is imported. */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./resolve.mjs", pathToFileURL(import.meta.filename));
