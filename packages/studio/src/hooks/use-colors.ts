import type { Theme } from "./use-theme";

export function useColors(_theme: Theme) {
  return {
    card: "border-border hover:border-border/70 transition-all duration-200",
    cardStatic: "border-border",
    surface: "bg-card",
    muted: "text-muted-foreground",
    subtle: "text-muted-foreground",
    link: "hover:text-[color:var(--studio-state-text)] transition-colors cursor-pointer",
    input: "bg-input/40 border border-border text-foreground focus:border-[color:var(--studio-chip-border)] focus:ring-2 focus:ring-[color:var(--studio-state-text)]/20 transition-all duration-200",
    btnPrimary: "studio-cta transition-all shadow-sm",
    btnSecondary: "studio-chip transition-all",
    btnSuccess: "studio-badge-ok",
    btnDanger: "bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity",
    tableHeader: "bg-muted/60 text-muted-foreground text-xs uppercase tracking-wider font-medium",
    tableDivide: "divide-border",
    tableHover: "hover:bg-muted/40 transition-colors",
    error: "border-destructive/50 bg-destructive/10 text-destructive",
    info: "border-brand/35 bg-brand/12 text-foreground",
    code: "bg-muted text-foreground/80 font-mono",
    active: "studio-status-dot-ok",
    paused: "studio-status-dot-warn",
    mono: "font-mono text-sm",
    accent: "text-[color:var(--studio-state-text)]",
  };
}
