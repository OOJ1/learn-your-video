import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

/* ---------------- Button ---------------- */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-slate-800 to-slate-900 text-primary-foreground shadow-[0_1px_2px_rgba(15,23,42,0.24),0_4px_12px_rgba(15,23,42,0.16)] hover:shadow-[0_1px_2px_rgba(15,23,42,0.28),0_6px_16px_rgba(15,23,42,0.22)] hover:brightness-110",
        outline:
          "border border-white/70 bg-white/50 text-foreground shadow-sm backdrop-blur hover:bg-white/70 hover:border-white",
        secondary:
          "border border-white/60 bg-white/45 text-foreground shadow-sm backdrop-blur hover:bg-white/65",
        ghost: "hover:bg-white/55",
        destructive: "bg-destructive text-white hover:bg-destructive/90 shadow-sm",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";

/* ---------------- Card ---------------- */
export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "rounded-2xl border border-white/60 bg-white/55 text-card-foreground backdrop-blur-xl shadow-[0_1px_1px_rgba(15,23,42,0.04),0_4px_10px_rgba(15,23,42,0.06),0_16px_36px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.7)]",
      className
    )}
    {...props}
  />
);
export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1 p-4", className)} {...props} />
);
export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("text-sm font-semibold leading-none tracking-tight", className)} {...props} />
);
export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-4 pt-0", className)} {...props} />
);

/* ---------------- Input / Textarea ---------------- */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-white/70 bg-white/55 px-3 py-1 text-sm shadow-sm backdrop-blur placeholder:text-muted-foreground/70 transition-all focus-visible:outline-none focus-visible:border-indigo-400/60 focus-visible:ring-2 focus-visible:ring-indigo-500/25 focus-visible:bg-white/75 disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-white/70 bg-white/55 px-3 py-2 text-sm shadow-sm backdrop-blur placeholder:text-muted-foreground/70 transition-all focus-visible:outline-none focus-visible:border-indigo-400/60 focus-visible:ring-2 focus-visible:ring-indigo-500/25 focus-visible:bg-white/75 disabled:opacity-50",
        className
      )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/* ---------------- Badge ---------------- */
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors backdrop-blur",
  {
    variants: {
      variant: {
        default: "border-transparent bg-foreground/80 text-background",
        secondary: "border-white/60 bg-white/50 text-foreground",
        outline: "border-white/60 text-foreground",
        success: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700",
        warn: "border-amber-500/30 bg-amber-500/15 text-amber-700",
        danger: "border-red-500/30 bg-red-500/15 text-red-700",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/* ---------------- Progress ---------------- */
export function Progress({ value = 0, className }: { value?: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/40", className)}>
      <div
        className="h-full rounded-full bg-primary transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

/* ---------------- Tabs ---------------- */
export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: string; label: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-white/50 bg-white/40 p-1 backdrop-blur">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            value === t.value
              ? "bg-white/85 shadow-[0_1px_3px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.9)]"
              : "text-muted-foreground hover:text-foreground hover:bg-white/40"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
