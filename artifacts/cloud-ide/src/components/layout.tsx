import React from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, FolderKanban, Rocket, Settings, TerminalSquare } from "lucide-react";

export function Sidebar() {
  const [location] = useLocation();

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/projects", label: "Projects", icon: FolderKanban },
    { href: "/deployments", label: "Deployments", icon: Rocket },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="w-64 border-r border-border bg-sidebar flex flex-col h-full">
      <div className="p-4 border-b border-sidebar-border flex items-center gap-2">
        <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground">
          <TerminalSquare size={18} />
        </div>
        <span className="font-bold text-foreground tracking-tight">CloudIDE</span>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {links.map((link) => {
          const isActive = location === link.href || (link.href !== "/" && location.startsWith(link.href));
          return (
            <Link
              key={link.href}
              href={link.href}
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
      <div className="p-4 border-t border-sidebar-border text-xs text-muted-foreground flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500"></div>
        System Operational
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto ide-scroll">
        {children}
      </main>
    </div>
  );
}
