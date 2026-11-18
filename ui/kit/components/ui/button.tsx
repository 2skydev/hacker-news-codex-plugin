import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:opacity-(--control-disabled-opacity) data-[disabled='']:opacity-(--control-disabled-opacity) data-[disabled=true]:opacity-(--control-disabled-opacity) disabled:pointer-events-none data-[disabled='']:pointer-events-none data-[disabled=true]:pointer-events-none aria-invalid:border-destructive aria-invalid:outline-destructive",
    "border border-transparent text-sm transition-all focus-visible:outline-offset-0 group/button inline-flex shrink-0 items-center justify-center bg-clip-padding font-medium whitespace-nowrap select-none disabled:pointer-events-none aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default:
          "border-border bg-primary text-primary-foreground hover:bg-foreground/80 aria-expanded:bg-foreground/80 data-popup-open:bg-foreground/80",
        outline:
          "border-border bg-control-soft text-foreground hover:bg-accent aria-expanded:bg-accent data-popup-open:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-foreground/10 aria-expanded:bg-foreground/10 data-popup-open:bg-foreground/10",
        ghost:
          "bg-transparent text-foreground hover:bg-accent aria-expanded:bg-accent data-popup-open:bg-accent",
        destructive: "bg-destructive-subtle text-destructive-foreground hover:bg-destructive-hover",
        link: "bg-transparent text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 gap-1 px-4",
        xs: "h-6 gap-1 px-2 text-xs leading-4 font-base",
        sm: "h-7 gap-1 px-3 leading-5",
        lg: "h-9 gap-1 px-4",
        icon: "size-8 p-0",
        "icon-xs": "size-6 p-0",
        "icon-sm": "size-7 p-0",
        "icon-lg": "size-9 p-0",
      },
      radius: {
        default: "rounded-lg",
        full: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      radius: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  radius = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-radius={radius}
      className={cn(buttonVariants({ variant, size, radius, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
