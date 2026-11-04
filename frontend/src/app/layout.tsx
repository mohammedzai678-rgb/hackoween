import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { RoleProvider } from "@/components/RoleProvider";

export const metadata: Metadata = {
  title: "FLOODCAST | River Discharge Prediction System",
  description:
    "Predict daily river discharge across USGS gauge stations using ML-powered hydrological forecasting.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const theme = localStorage.getItem('floodcast-theme');
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (theme === 'light' || (!theme && !prefersDark)) {
                  document.documentElement.classList.remove('dark');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col font-sans">
        <ThemeProvider>
          <RoleProvider>
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white"
            >
              Skip to main content
            </a>

            <Navbar />

            <main
              id="main-content"
              className="flex-1 mx-auto w-full max-w-[1680px] px-4 py-6 sm:px-6 lg:px-8 xl:px-10"
            >
              {children}
            </main>

            <footer className="mt-12 border-t border-[var(--border-primary)] py-6">
              <div className="mx-auto max-w-[1680px] px-4 sm:px-6 lg:px-8 xl:px-10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
                <span className="font-mono font-semibold text-[var(--accent)]">
                  FLOODCAST v1.0
                </span>
                <span>
                  USGS NWIS · Open-Meteo · LightGBM / XGBoost / CatBoost Ensemble
                </span>
              </div>
            </footer>
          </RoleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
