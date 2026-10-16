"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { PublicRuntimeConfig } from "@/lib/publicRuntimeConfig";

const Context = createContext<PublicRuntimeConfig | null>(null);

export default function PublicRuntimeConfigProvider({ config, children }: {
  config: PublicRuntimeConfig;
  children: ReactNode;
}) {
  return <Context.Provider value={config}>{children}</Context.Provider>;
}

export function usePublicRuntimeConfig(): PublicRuntimeConfig {
  const config = useContext(Context);
  if (!config) throw new Error("Public runtime configuration provider is missing.");
  return config;
}
