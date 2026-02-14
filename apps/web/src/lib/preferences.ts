export type Density = "comfortable" | "compact";

const DENSITY_STORAGE_KEY = "vespid.ui.density";

export function normalizeDensity(value: unknown): Density {
  return value === "compact" ? "compact" : "comfortable";
}

export function readPreferredDensity(): Density {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return "comfortable";
  }
  return normalizeDensity(window.localStorage.getItem(DENSITY_STORAGE_KEY));
}

export function writePreferredDensity(density: Density): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
}

export function applyDensityToDocument(density: Density): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.density = density;
}
