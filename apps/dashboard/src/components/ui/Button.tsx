import { type ButtonHTMLAttributes, forwardRef } from "react"

export type ButtonSize =
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "icon-xs"
  | "icon-sm"
  | "icon-md"
  | "icon-lg"

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "success"

const sizeClasses: Record<ButtonSize, string> = {
  xs: "h-6 px-1.5 text-[11px] gap-1 rounded",
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  md: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  lg: "h-9 px-3.5 text-sm gap-2 rounded-md",
  "icon-xs": "h-6 w-6 rounded",
  "icon-sm": "h-7 w-7 rounded-md",
  "icon-md": "h-8 w-8 rounded-md",
  "icon-lg": "h-9 w-9 rounded-lg",
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-blue-600 text-white font-medium shadow-sm hover:bg-blue-500",
  secondary:
    "border border-gray-700 bg-gray-800/80 text-gray-300 hover:bg-gray-700 hover:text-gray-200",
  ghost: "text-gray-400 hover:text-gray-200 hover:bg-gray-800",
  danger:
    "border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
  success:
    "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20",
}

const baseClasses =
  "inline-flex items-center justify-center whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none"

export function buttonVariants(
  size: ButtonSize = "sm",
  variant: ButtonVariant = "secondary",
): string {
  return `${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]}`
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize
  variant?: ButtonVariant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ size = "sm", variant = "secondary", className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={className ? `${buttonVariants(size, variant)} ${className}` : buttonVariants(size, variant)}
        {...props}
      />
    )
  },
)

Button.displayName = "Button"
