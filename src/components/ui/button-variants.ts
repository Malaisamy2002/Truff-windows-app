import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium cursor-pointer transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_6px_18px_-8px_var(--primary)] hover:bg-primary/90 hover:shadow-[0_10px_24px_-10px_var(--primary)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "frost-soft border border-border/70 shadow-sm hover:bg-accent/60 hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent/70 hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-10 rounded-xl px-8",
        icon: "h-9 w-9",
        /** Mirrors Android's `touch` size so shared-domain components (e.g.
         * `RecordActionRow.tsx`) that default to `size="touch"` compile and
         * render sensibly here too. Desktop has no 48dp touch-target
         * requirement, so this is just square-icon sizing like `icon`
         * rather than Android's actual 48px bump. */
        touch: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
