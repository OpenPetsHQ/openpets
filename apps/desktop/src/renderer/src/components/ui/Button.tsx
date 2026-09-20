import React from "react";

export const buttonVariantClass = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  success: "btn-success",
  warning: "btn-warning",
  accent: "btn-accent",
} as const;

export type ButtonVariant = keyof typeof buttonVariantClass;
export type ButtonSize = "normal" | "compact";
export type ButtonIconPosition = "left" | "right";
export type ButtonHtmlType = "button" | "submit" | "reset";

export interface ButtonProps {
  readonly children: React.ReactNode;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly icon?: React.ReactNode;
  readonly iconPosition?: ButtonIconPosition;
  readonly fullWidth?: boolean;
  readonly ariaLabel?: string;
  readonly title?: string;
  readonly type?: ButtonHtmlType;
}

export function Button({
  children,
  variant = "primary",
  size = "normal",
  onClick,
  disabled,
  icon,
  iconPosition = "left",
  fullWidth,
  ariaLabel,
  title,
  type = "button",
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn ${buttonVariantClass[variant]} ${size === "compact" ? "btn-compact" : ""} ${fullWidth ? "w-full" : ""} ${icon ? "has-icon" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
    >
      {icon && iconPosition === "left" && (
        <span className="btn-icon-wrapper mr-1.5 inline-flex items-center justify-center">{icon}</span>
      )}
      <span className="btn-text">{children}</span>
      {icon && iconPosition === "right" && (
        <span className="btn-icon-wrapper ml-1.5 inline-flex items-center justify-center">{icon}</span>
      )}
    </button>
  );
}
