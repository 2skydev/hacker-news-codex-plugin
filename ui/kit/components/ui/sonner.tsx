"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const toastClassNames = {
  toast:
    "group/toast pointer-events-auto grid w-max max-w-full grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-start gap-y-2 rounded-xl border border-border bg-popover px-3 py-2 text-base leading-[1.4] text-foreground shadow-[0_4px_12px_#0000001a] data-[expanded=false]:data-[front=false]:[&>*]:opacity-0 data-[type=success]:border-success/20 data-[type=success]:bg-success-surface data-[type=success]:text-success data-[type=warning]:border-warning-outline data-[type=warning]:bg-warning-surface data-[type=warning]:text-warning data-[type=error]:border-destructive-border data-[type=error]:bg-destructive-surface data-[type=error]:text-destructive",
  content: "col-start-2 row-start-1 min-w-0 group-has-[[data-description]]/toast:col-span-3",
  title: "flex min-h-6 items-center text-start font-medium whitespace-pre-wrap",
  description:
    "text-start text-muted-foreground! group-data-[type=success]/toast:text-success/80! group-data-[type=warning]/toast:text-warning/80! group-data-[type=error]/toast:text-destructive/80!",
  icon: "relative col-start-1 row-start-1 mr-1 flex size-6 shrink-0 items-center justify-center",
  actionButton: cn(
    buttonVariants({ size: "xs", radius: "full" }),
    "col-start-4 row-start-1 ml-2 self-center group-has-data-description/toast:row-start-2",
  ),
  cancelButton: cn(
    buttonVariants({ variant: "secondary", size: "xs", radius: "full" }),
    "col-start-3 row-start-1 ml-2 self-center group-has-data-description/toast:row-start-2",
  ),
  closeButton:
    "col-start-5 row-start-1 ml-1 flex size-6 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent! text-inherit! hover:bg-foreground/5! focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none",
} satisfies NonNullable<ToasterProps["toastOptions"]>["classNames"];

const Toaster = ({
  className,
  style,
  icons,
  toastOptions,
  position = "top-center",
  ...props
}: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const centered = position.endsWith("center");
  const classNames = { ...toastClassNames };

  for (const key of Object.keys(classNames) as (keyof typeof classNames)[]) {
    classNames[key] = cn(classNames[key], toastOptions?.classNames?.[key]);
  }

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position={position}
      gap={8}
      offset={
        centered
          ? {
              top: "3rem",
              right: "0.5rem",
              bottom: "0.5rem",
              left: "0.5rem",
            }
          : undefined
      }
      mobileOffset={
        centered
          ? {
              top: "3rem",
              right: "0.5rem",
              bottom: "0.5rem",
              left: "0.5rem",
            }
          : undefined
      }
      closeButton
      className={cn(
        "toaster group",
        centered &&
          "flex justify-center [&&_[data-sonner-toast]]:inset-x-auto [&&_[data-sonner-toast]]:w-max",
        className,
      )}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
        close: <XIcon className="size-4" />,
        ...icons,
      }}
      style={
        {
          ...(centered && { "--width": "min(48rem, calc(100vw - 1rem))", width: "var(--width)" }),
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--success-surface)",
          "--success-text": "var(--success)",
          "--success-border": "color-mix(in oklab, var(--success) 20%, transparent)",
          "--info-bg": "var(--popover)",
          "--info-text": "var(--foreground)",
          "--info-border": "var(--border)",
          "--warning-bg": "var(--warning-surface)",
          "--warning-text": "var(--warning)",
          "--warning-border": "var(--warning-outline)",
          "--error-bg": "var(--destructive-surface)",
          "--error-text": "var(--destructive)",
          "--error-border": "var(--destructive-border)",
          fontFamily: "var(--font-sans)",
          ...style,
        } as React.CSSProperties
      }
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: "알림 닫기",
        ...toastOptions,
        classNames: { ...toastOptions?.classNames, ...classNames },
      }}
      {...props}
    />
  );
};

export { Toaster };
