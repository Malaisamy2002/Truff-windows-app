import { useState, type ReactNode } from "react";
import { Trash2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Trash-icon button that confirms before deleting. Several destructive actions
 * across the app (bills, expenses, snack sales, turf bookings) used to fire a
 * single-tap delete straight to the mutation with no way back, inconsistent
 * with the AlertDialog-gated deletes elsewhere (customers, backups, archive).
 * This centralizes that confirmation so every delete goes through the same gate.
 *
 * `icon`/`confirmLabel` are optional so every existing call site (a plain
 * delete) keeps its exact prior look with no changes — they only exist so a
 * different destructive-but-not-delete action (e.g. voiding a bill, see
 * `useVoidBill` in data.ts) can reuse the same confirm-dialog gate instead of
 * a second bespoke component.
 */
export function ConfirmDeleteButton({
  title,
  description,
  onConfirm,
  ariaLabel,
  size = "icon",
  className,
  iconClassName = "h-4 w-4",
  disabled,
  icon: Icon = Trash2,
  confirmLabel = "Delete",
}: {
  title: string;
  description: ReactNode;
  onConfirm: () => void;
  ariaLabel: string;
  size?: "icon" | "sm" | "default";
  className?: string;
  iconClassName?: string;
  disabled?: boolean;
  icon?: LucideIcon;
  confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size={size}
        className={className}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Icon className={iconClassName} />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setOpen(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
