import type { AppStore } from "../types.js";
import { MemoryAppStore } from "./memory-store.js";
import { PgAppStore } from "./pg-store.js";

export function createStore(): AppStore {
  if (process.env.DATABASE_URL) {
    return new PgAppStore(process.env.DATABASE_URL);
  }
  return new MemoryAppStore();
}

export { MemoryAppStore, PgAppStore };
