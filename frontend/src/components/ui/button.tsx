import { forwardRef } from "react";
import { cn } from "../../lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type ButtonSize = "sm" | "md" | "icon";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

// 项目内统一按钮组件：用 variant/size 固化常用样式，业务组件只关心语义和事件。
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full border font-medium transition focus:outline-none focus:ring-2 focus:ring-ring/35 focus:ring-offset-1 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "border-primary bg-primary text-primary-foreground shadow-sm hover:brightness-95",
        variant === "secondary" && "border-secondary bg-secondary text-secondary-foreground hover:bg-accent",
        variant === "ghost" && "border-transparent bg-transparent text-foreground hover:bg-muted",
        variant === "outline" && "border-border bg-card text-foreground hover:bg-muted",
        variant === "danger" && "border-destructive bg-destructive text-destructive-foreground",
        size === "sm" && "h-8 px-2.5 text-xs",
        size === "md" && "h-10 px-3 text-sm",
        size === "icon" && "h-9 w-9 p-0",
        className,
      )}
      {...props}
    />
  ),
);

Button.displayName = "Button";
