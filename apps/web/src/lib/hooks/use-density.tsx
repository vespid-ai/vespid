"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { applyDensityToDocument, readPreferredDensity, writePreferredDensity, type Density } from "../preferences";

type DensityContextValue = {
  density: Density;
  setDensity: (next: Density) => void;
  toggleDensity: () => void;
};

const DensityContext = createContext<DensityContextValue | null>(null);

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>(() => "comfortable");

  useEffect(() => {
    const preferred = readPreferredDensity();
    setDensityState(preferred);
    applyDensityToDocument(preferred);
  }, []);

  function setDensity(next: Density) {
    setDensityState(next);
    writePreferredDensity(next);
    applyDensityToDocument(next);
  }

  function toggleDensity() {
    setDensity(density === "compact" ? "comfortable" : "compact");
  }

  const value = useMemo<DensityContextValue>(() => ({ density, setDensity, toggleDensity }), [density]);

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity(): DensityContextValue {
  const ctx = useContext(DensityContext);
  if (!ctx) {
    throw new Error("useDensity must be used within DensityProvider");
  }
  return ctx;
}
