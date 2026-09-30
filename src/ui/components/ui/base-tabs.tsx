"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cn } from "../../lib/utils"

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col", className)} {...props} />
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn("inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground", className)} {...props} />
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return <TabsPrimitive.Tab data-slot="tabs-trigger" className={cn("inline-flex h-full flex-1 items-center justify-center whitespace-nowrap rounded-md border border-transparent px-2.5 text-xs font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 data-active:border-input data-active:bg-background data-active:text-foreground data-active:shadow-sm", className)} {...props} />
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
