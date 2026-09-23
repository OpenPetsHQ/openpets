import React from "react";

export interface GlassCardProps extends React.HTMLAttributes<HTMLElement> {
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function GlassCard({ children, className = "", ...attributes }: GlassCardProps) {
  return <section className={`glass ${className}`} {...attributes}>{children}</section>;
}
