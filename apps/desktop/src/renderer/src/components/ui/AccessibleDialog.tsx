import React, { useEffect, useRef } from "react";

// Modal dialog shell shared by Control Center views: traps focus, closes on
// Escape/backdrop (unless busy), and restores focus to the opener on close.
export function AccessibleDialog({
  isOpen,
  onClose,
  titleId,
  descriptionId,
  ariaLabel,
  closeOnBackdropClick = true,
  preventEscapeClose = false,
  isBusy = false,
  children,
  className = "max-w-md",
  role = "dialog",
}: {
  isOpen: boolean;
  onClose?: () => void;
  titleId?: string;
  descriptionId?: string;
  ariaLabel?: string;
  closeOnBackdropClick?: boolean;
  preventEscapeClose?: boolean;
  isBusy?: boolean;
  children: React.ReactNode;
  className?: string;
  role?: "dialog" | "alertdialog";
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

    requestAnimationFrame(() => {
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      if (firstFocusable) {
        firstFocusable.focus();
      } else if (dialogRef.current) {
        dialogRef.current.focus();
      }
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!preventEscapeClose && !isBusy && onClose) {
          event.preventDefault();
          onClose();
        }
        return;
      }

      if (event.key !== "Tab") return;
      const dialogNode = dialogRef.current;
      if (!dialogNode) return;

      const focusable = Array.from(dialogNode.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedElementRef.current?.focus();
    };
  }, [isOpen, preventEscapeClose, isBusy, onClose]);

  if (!isOpen) return null;

  return (
    <div className="plugin-config-overlay">
      <div
        className="plugin-config-backdrop"
        onClick={() => {
          if (closeOnBackdropClick && !isBusy && onClose) {
            onClose();
          }
        }}
      />
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`plugin-inspector bg-white p-6 rounded-[24px] border border-blue-200 shadow-2xl relative z-10 flex flex-col gap-4 focus:outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
