"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Waves,
  Activity,
  Database,
  MapPin,
  Cpu,
  Layers,
  ShieldAlert,
  BarChart3,
  Play,
  CheckCircle2,
  BookOpen,
  AlertTriangle,
  Menu,
  X,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/problem", label: "Problem", icon: Waves },
  { href: "/data", label: "Data", icon: Database },
  { href: "/stations", label: "Stations", icon: MapPin },
  { href: "/features", label: "Features", icon: Layers },
  { href: "/models", label: "Models", icon: Cpu },
  { href: "/train", label: "Train Gate", icon: ShieldAlert },
  { href: "/evaluate", label: "Evaluate", icon: BarChart3 },
  { href: "/predict", label: "Predict", icon: Play },
  { href: "/submission", label: "Submission", icon: CheckCircle2 },
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/limitations", label: "Limitations", icon: AlertTriangle },
];

export default function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-cyan-500/20 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Brand */}
        <Link
          href="/"
          className="group flex items-center gap-3 focus:outline-none focus:ring-2 focus:ring-cyan-400 rounded-lg"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-500/10 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)] transition group-hover:border-cyan-400 group-hover:bg-cyan-500/20">
            <Waves className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-base font-bold tracking-wider text-slate-100">
                FLOODCAST
              </span>
              <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-cyan-300">
                USGS 00060
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Predict the Surge Before It Strikes
            </p>
          </div>
        </Link>

        {/* Desktop Nav */}
        <nav
          aria-label="Primary Navigation"
          className="hidden xl:flex items-center gap-1"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                  active
                    ? "border border-cyan-400/40 bg-cyan-500/15 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                    : "text-slate-300 hover:bg-slate-900 hover:text-cyan-300"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Status Pill & Mobile Toggle */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-mono text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>CUTOFF: 2022-12-31</span>
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation menu"
            className="xl:hidden rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Tablet / Mobile Drawer */}
      {mobileOpen && (
        <div className="xl:hidden border-t border-slate-800/80 bg-slate-950/95 px-4 py-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition ${
                    active
                      ? "border border-cyan-400/40 bg-cyan-500/15 text-cyan-300"
                      : "border border-slate-900 bg-slate-900/50 text-slate-300 hover:border-slate-700 hover:text-cyan-300"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-cyan-400" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}
