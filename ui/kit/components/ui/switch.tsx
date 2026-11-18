'use client'

import { Switch as SwitchPrimitive } from '@base-ui/react/switch'

import { cn } from '@/lib/utils'

function Switch({
  className,
  size = 'default',
  tone = 'accent',
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: 'sm' | 'default'
  tone?: 'accent' | 'neutral'
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      data-tone={tone}
      className={cn(
        "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none data-[disabled='']:pointer-events-none data-[disabled=true]:pointer-events-none aria-invalid:border-destructive aria-invalid:outline-destructive",
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border-0 bg-foreground/10 text-sm transition-all focus-visible:outline-offset-0 disabled:opacity-60 data-[disabled='']:opacity-60 data-[disabled=true]:opacity-60 data-[size=default]:h-5 data-[size=default]:w-8 data-[size=sm]:h-4 data-[size=sm]:w-7 after:absolute after:-inset-x-3 after:-inset-y-2",
        tone === 'neutral'
          ? 'data-checked:bg-foreground'
          : 'data-checked:bg-switch-accent',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block shrink-0 rounded-full border border-switch-thumb bg-switch-thumb shadow-sm transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-unchecked:translate-x-0.5 data-checked:translate-x-3.5 rtl:data-unchecked:-translate-x-0.5 rtl:data-checked:-translate-x-3.5',
          tone === 'neutral' &&
            'data-checked:border-transparent data-checked:bg-background',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
