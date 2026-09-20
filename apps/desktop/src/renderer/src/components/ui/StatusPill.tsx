import React from "react";

export const statusPillToneClass = {
  blue: "pill-blue",
  green: "pill-green",
  orange: "pill-orange",
  purple: "pill-purple",
  yellow: "pill-yellow",
  red: "pill-red",
  slate: "pill-slate",
} as const;

export type StatusPillTone = keyof typeof statusPillToneClass;
export type StatusTone = StatusPillTone;

export interface StatusPillProps {
  readonly children: React.ReactNode;
  readonly tone?: StatusPillTone;
}

export function StatusPill({
  children,
  tone = "blue",
}: StatusPillProps) {
  return <span className={`pill ${statusPillToneClass[tone]}`}>{children}</span>;
}
