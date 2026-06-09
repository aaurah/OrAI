import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, FolderKanban, Rocket, Settings, TerminalSquare, Menu, X, Shield, Github } from "lucide-react";

const links = [
  { href: "/",            label: "Dashboard",   icon: LayoutDashboard },
  { href: "/projects",    label: "Projects",    icon: FolderKanban },
  { href: "/deployments", label: "Deployments", icon: Rocket },
  { href: "/github",      label: "GitHub",      icon: Github },
  { href: "/settings",    label: "Settings",    icon: Settings },
  { href: "/admin",       label: "Admin",       icon: Shield },
];

function NavLinks({ onNav }: { onNav?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className="flex-1 p-3 space-y-1">
      {links.map((link) => {
        const isActive = location === link.href || (link.href !== "/" && location.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNav}
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium ${
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            }`}
          >
            <link.icon size={16} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  return (
    <div className="w-64 border-r border-border bg-sidebar flex flex-col h-full">
      <div className="p-4 border-b border-sidebar-border flex items-center gap-2">
        <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground shrink-0">
          <TerminalSquare size={18} />
        </div>
        <span className="font-bold text-foreground tracking-tight">CloudIDE</span>
      </div>
      <NavLinks />
      <div className="p-4 border-t border-sidebar-border text-xs text-muted-foreground flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500 shrink-0"></div>
        System Operational
      </div>
    </div>
  );
}

export function MobileHeader({ title }: { title?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Top bar */}
      <div className="flex md:hidden h-12 border-b border-border bg-card items-center px-4 gap-3 shrink-0 z-40">
        <div className="w-7 h-7 rounded bg-primary flex items-center justify-center text-primary-foreground shrink-0">
          <TerminalSquare size={14} />
        </div>
        <span className="font-bold text-sm tracking-tight flex-1">{title ?? "CloudIDE"}</span>
        <button
          onClick={() => setOpen(true)}
          className="text-muted-foreground hover:text-foreground p-1"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
      </div>

      {/* Slide-out drawer — backdrop behind panel so panel links are always tappable */}
      {open && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Sidebar panel — rendered FIRST so it's at the left */}
          <div className="relative z-10 w-72 bg-sidebar flex flex-col h-full shadow-2xl">
            <div className="p-4 border-b border-sidebar-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground">
                  <TerminalSquare size={18} />
                </div>
                <span className="font-bold text-foreground tracking-tight">CloudIDE</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>
            <NavLinks onNav={() => setOpen(false)} />
            <div className="p-4 border-t border-sidebar-border text-xs text-muted-foreground flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              System Operational
            </div>
          </div>

          {/* Backdrop — comes AFTER the panel in DOM, covers only the right remainder */}
          <div
            className="flex-1 bg-black/60"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          />
        </div>
      )}
    </>
  );
}

/** Bottom tab bar shown on mobile for all Layout pages */
function BottomTabBar() {
  const [location] = useLocation();
  // Show only the 5 most important tabs at the bottom (Admin via hamburger)
  const tabLinks = links.slice(0, 5);
  return (
    <nav className="flex md:hidden h-16 border-t border-border bg-card items-stretch shrink-0 z-30 safe-area-pb">
      {tabLinks.map((link) => {
        const isActive = location === link.href || (link.href !== "/" && location.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors py-1 ${
              isActive
                ? "text-primary"
                : "text-muted-foreground"
            }`}
          >
            <link.icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:flex flex-col w-64 shrink-0 h-full">
        <Sidebar />
      </div>

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <MobileHeader />
        <main className="flex-1 overflow-auto ide-scroll">
          {children}
        </main>
        <BottomTabBar />
      </div>
    </div>
  );
}
