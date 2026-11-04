"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type UserRole = "forecaster" | "ml_engineer" | "admin";

export interface RoleConfigItem {
  id: UserRole;
  label: string;
  badge: string;
  description: string;
  allowedRoutes: string[];
}

export const ROLE_CONFIG: Record<UserRole, RoleConfigItem> = {
  forecaster: {
    id: "forecaster",
    label: "Hydrologist",
    badge: "Forecaster",
    description:
      "Monitor river gauges, simulate storms on the interactive map, generate discharge forecasts, and query the Vector DB Vault.",
    allowedRoutes: ["/", "/today", "/map", "/predict", "/vault", "/stations", "/chat"],
  },
  ml_engineer: {
    id: "ml_engineer",
    label: "ML Engineer",
    badge: "ML & Models",
    description:
      "Benchmark LightGBM, XGBoost & CatBoost models, run spatial & tabular inference, inspect the RAG Vector DB, and train new runs.",
    allowedRoutes: ["/", "/today", "/map", "/predict", "/vault", "/models", "/train", "/chat"],
  },
  admin: {
    id: "admin",
    label: "Operations Lead",
    badge: "Full Access",
    description:
      "Full access across spatial storm mapping, station telemetry, live forecasting, Simulation Vault & RAG, model leaderboard, and training.",
    allowedRoutes: [
      "/",
      "/today",
      "/map",
      "/predict",
      "/vault",
      "/stations",
      "/models",
      "/train",
      "/chat",
    ],
  },
};

interface RoleContextValue {
  role: UserRole;
  setRole: (role: UserRole) => void;
  roleInfo: RoleConfigItem;
  canAccess: (path: string) => boolean;
}

const RoleContext = createContext<RoleContextValue>({
  role: "admin",
  setRole: () => {},
  roleInfo: ROLE_CONFIG.admin,
  canAccess: () => true,
});

export function useRole() {
  return useContext(RoleContext);
}

const STORAGE_KEY = "floodcast-role";

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<UserRole>("admin");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as UserRole | null;
      if (stored && stored in ROLE_CONFIG) {
        setRoleState(stored);
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  const setRole = (nextRole: UserRole) => {
    if (!(nextRole in ROLE_CONFIG)) return;
    setRoleState(nextRole);
    try {
      localStorage.setItem(STORAGE_KEY, nextRole);
    } catch {
      // Ignore storage access errors
    }
  };

  const roleInfo = ROLE_CONFIG[role] || ROLE_CONFIG.admin;

  const canAccess = (path: string): boolean => {
    if (path === "/") {
      return roleInfo.allowedRoutes.includes("/");
    }
    return roleInfo.allowedRoutes.some(
      (route) =>
        route !== "/" && (path === route || path.startsWith(`${route}/`))
    );
  };

  return (
    <RoleContext.Provider value={{ role, setRole, roleInfo, canAccess }}>
      {children}
    </RoleContext.Provider>
  );
}
