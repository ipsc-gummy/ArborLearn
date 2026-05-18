import type { ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
  transitionKey: string;
  variant: "landing" | "dashboard" | "workspace" | "restoring";
}

export function PageTransition({ children, transitionKey, variant }: PageTransitionProps) {
  return (
    <div key={transitionKey} className={`tl-page-enter tl-page-enter-${variant}`}>
      {children}
    </div>
  );
}
