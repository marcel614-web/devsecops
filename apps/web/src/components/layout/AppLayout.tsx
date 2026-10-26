import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppLayout() {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  // Nouvelle page : on revient en haut du contenu
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-slate-800 dark:text-slate-200">
      {/* Lien d'évitement : navigation clavier / lecteurs d'écran */}
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Aller au contenu principal
      </a>

      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="scrollbar-thin flex-1 overflow-y-auto focus:outline-none"
        >
          <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
