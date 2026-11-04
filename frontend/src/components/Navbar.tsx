"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "./ThemeProvider";
import { useRole, ROLE_CONFIG, UserRole } from "./RoleProvider";
import {
  Waves,
  Activity,
  MapPin,
  Globe,
  Database,
  Cpu,
  Play,
  Sliders,
  Menu,
  X,
  Sun,
  Moon,
  Shield,
  Clock,
  Bot,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: Activity },
  { href: "/today", label: "Today", icon: Clock },
  { href: "/map", label: "Storm Map", icon: Globe },
  { href: "/predict", label: "Predict", icon: Play },
  { href: "/vault", label: "Vault & RAG", icon: Database },
  { href: "/chat", label: "Chatbot", icon: Bot },
  { href: "/stations", label: "Stations", icon: MapPin },
  { href: "/models", label: "Models", icon: Cpu },
  { href: "/train", label: "Train", icon: Sliders },
];

const ROLE_ORDER: UserRole[] = ["admin", "forecaster", "ml_engineer"];

export default function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { role, setRole, roleInfo, canAccess } = useRole();

  const visibleNavItems = NAV_ITEMS.filter((item) => canAccess(item.href));

  return (
    <header className="sticky top-0 z-50 border-b bg-[var(--bg-primary)]/95 border-[var(--border-primary)] backdrop-blur-md">
      <div className="mx-auto flex max-w-[1680px] items-center justify-between px-4 py-3 sm:px-6 lg:px-8 xl:px-10">
        {/* Brand */}
        <Link
          href="/"
          className="group flex items-center gap-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-white shadow-sm">
            <Waves className="h-5 w-5" />
          </div>
          <div>
            <span className="font-mono text-base font-bold tracking-wider text-[var(--text-primary)]">
              FLOODCAST
            </span>
            <p className="text-[11px] text-[var(--text-muted)] hidden sm:block">
              River Discharge Prediction System
            </p>
          </div>
        </Link>

        {/* Desktop Nav */}
        <nav
          aria-label="Primary Navigation"
          className="hidden md:flex items-center gap-1"
        >
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-[var(--accent-light)] text-[var(--accent)] dark:text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right side: Role Switcher + Theme toggle + Mobile menu */}
        <div className="flex items-center gap-2">
          {/* Role Switcher */}
          <div
            className="hidden sm:flex items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs"
            title={roleInfo.description}
          >
            <Shield className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
            <label htmlFor="navbar-role-select" className="sr-only">
              Active user role
            </label>
            <select
              id="navbar-role-select"
              aria-label="Active user role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="bg-transparent font-medium text-[var(--text-primary)] focus:outline-none cursor-pointer pr-1"
            >
              {ROLE_ORDER.map((rKey) => {
                const cfg = ROLE_CONFIG[rKey];
                return (
                  <option
                    key={cfg.id}
                    value={cfg.id}
                    className="bg-[var(--bg-card)] text-[var(--text-primary)]"
                  >
                    {cfg.label} ({cfg.badge})
                  </option>
                );
              })}
            </select>
          </div>

          {/* Dark / Light Mode Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            title={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            {theme === "dark" ? (
              <>
                <Sun className="h-4 w-4 text-amber-400" />
                <span className="hidden lg:inline">Light</span>
              </>
            ) : (
              <>
                <Moon className="h-4 w-4 text-sky-600" />
                <span className="hidden lg:inline">Dark</span>
              </>
            )}
          </button>

          {/* Mobile Drawer Toggle */}
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation menu"
            className="md:hidden rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] transition-colors"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-3 space-y-3">
          <div className="flex flex-col gap-1">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-[var(--accent-light)] text-[var(--accent)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>

          {/* Mobile Role Switcher */}
          <div className="border-t border-[var(--border-primary)] pt-3">
            <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Workspace Role
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {ROLE_ORDER.map((rKey) => {
                const cfg = ROLE_CONFIG[rKey];
                const isSelected = role === cfg.id;
                return (
                  <button
                    key={cfg.id}
                    type="button"
                    onClick={() => setRole(cfg.id)}
                    className={`rounded-lg px-2 py-1.5 text-xs font-medium text-center transition-colors border ${
                      isSelected
                        ? "border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]"
                        : "border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
