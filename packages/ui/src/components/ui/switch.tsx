"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"
import { cn } from "../../lib/utils"

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return <SwitchPrimitive.Root data-slot="switch" className={cn("peer inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-transparent bg-input transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary", className)} {...props}>
    <SwitchPrimitive.Thumb data-slot="switch-thumb" className="pointer-events-none block size-3 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5" />
  </SwitchPrimitive.Root>
}

export { Switch }
