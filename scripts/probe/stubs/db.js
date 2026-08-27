/**
 * Stands in for src/lib/db.js, which opens a Supabase client on import.
 *
 * `apiFetch` returns the RESPONSE, unparsed, exactly as the real one does.
 * That is not a detail: measure.js treated it as the parsed body, so every
 * symbol came back unreadable with no error, and a stub that returned a plain
 * object would have made the probe agree with the bug.
 */
export const apiFetch = async (path, init = {}) =>
  globalThis.fetch(path, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: "Bearer probe" },
  });

export const savePaths = async (rows) => rows.length;
export const saveStops = async (rows) => rows.length;
export const track = () => {};
export const supabase = null;
