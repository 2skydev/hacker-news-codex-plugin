import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function FieldSet({ className, ...props }: ComponentProps<"fieldset">) {
  return <fieldset data-slot="field-set" className={cn("min-w-0", className)} {...props} />;
}

function FieldLegend({ className, ...props }: ComponentProps<"legend">) {
  return (
    <legend
      data-slot="field-legend"
      className={cn("mb-2 text-base font-semibold", className)}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn("@container/field-group flex min-w-0 flex-col gap-4", className)}
      {...props}
    />
  );
}

const fieldVariants = cva("group/field flex min-w-0", {
  variants: {
    orientation: {
      vertical: "flex-col gap-1.5",
      horizontal: "items-center justify-between gap-4",
      responsive:
        "flex-col items-start gap-2 @sm/field-group:flex-row @sm/field-group:items-center @sm/field-group:justify-between @sm/field-group:gap-4",
    },
  },
});

function Field({
  className,
  orientation = "vertical",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  );
}

function FieldContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn("flex min-w-0 flex-1 flex-col gap-1", className)}
      {...props}
    />
  );
}

const fieldLabel = "text-sm font-medium leading-snug group-data-[disabled=true]/field:opacity-60";

function FieldLabel({
  children,
  className,
  htmlFor,
  ...props
}: ComponentProps<"label"> & { htmlFor: string }) {
  return (
    <label
      data-slot="field-label"
      htmlFor={htmlFor}
      className={cn(fieldLabel, className)}
      {...props}
    >
      {children}
    </label>
  );
}

function FieldTitle({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field-title" className={cn(fieldLabel, className)} {...props} />;
}

function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-sm break-keep text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
};
