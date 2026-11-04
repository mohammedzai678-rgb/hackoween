import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Link from "next/link";

export const metadata: Metadata = {
  title: "FLOODCAST | Hydrological Observatory & Surge Prediction System",
  description:
    "24-Hour Hackathon Regression Challenge — Predict daily river discharge (cfs) across 32 USGS gauge stations using meteorological inputs, catchment attributes, and flood-peak-weighted LightGBM ensembles.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-cyan-500 focus:px-4 focus:py-2 focus:font-mono focus:text-sm focus:font-bold focus:text-slate-950"
        >
          Skip to main content
        </a>

        <Navbar />

        <main
          id="main-content"
          className="flex-1 mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
        >
          {children}
        </main>

        <footer className="mt-16 border-t border-slate-800/80 bg-slate-950/90 py-8">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-3">
              <span className="font-mono font-bold text-cyan-400">FLOODCAST v1.0</span>
              <span>·</span>
              <span>USGS NWIS (00060) + Open-Meteo Archive + GAGES-II/StreamStats</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 font-mono">
              <Link href="/problem" className="hover:text-cyan-300 transition">
                Problem
              </Link>
              <Link href="/data" className="hover:text-cyan-300 transition">
                Data
              </Link>
              <Link href="/stations" className="hover:text-cyan-300 transition">
                32 Stations
              </Link>
              <Link href="/train" className="hover:text-cyan-300 transition">
                Training Gate
              </Link>
              <Link href="/submission" className="hover:text-cyan-300 transition">
                Validator (PASS)
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
