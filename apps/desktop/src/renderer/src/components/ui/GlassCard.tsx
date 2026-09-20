import React from "react";

export interface GlassCardProps {
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function GlassCard({
  children,
  className = "",
}: GlassCardProps) {
  return <section className={`glass ${className}`}>{children}</section>;
}
