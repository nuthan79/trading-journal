"use client";

import { createContext, useContext } from "react";

export const JournalContext = createContext(null);

export function useJournal() {
  const ctx = useContext(JournalContext);
  if (!ctx) throw new Error("useJournal must be used within the (app) layout");
  return ctx;
}
