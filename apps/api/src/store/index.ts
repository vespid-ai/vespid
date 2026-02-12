import type { AppStore } from "../types.js";
import { MemoryAppStore } from "./memory-store.js";
import { PgAppStore } from "./pg-store.js";

export function createStore(): AppStore {
  if (process.env.DATABASE_URL) {
    return new PgAppStore(process.env.DATABASE_URL);
  }
  if (process.env.NODE_ENV === "test") {
    return new MemoryAppStore();
  }
  throw new Error("DATABASE_URL is required outside test mode");
}

export { MemoryAppStore, PgAppStore };
