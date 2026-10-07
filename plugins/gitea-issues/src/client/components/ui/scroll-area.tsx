import * as React from "react"
import { cn } from "cn"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("giteaissues:relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="giteaissues:size-full giteaissues:rounded-[inherit] giteaissues:transition-[color,box-shadow] giteaissues:outline-none giteaissues:focus-visible:ring-[3px] giteaissues:focus-visible:ring-ring/50 giteaissues:focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "giteaissues:flex giteaissues:touch-none giteaissues:p-px giteaissues:transition-colors giteaissues:select-none",
        orientation === "vertical" &&
          "giteaissues:h-full giteaissues:w-2.5 giteaissues:border-l giteaissues:border-l-transparent",
        orientation === "horizontal" &&
          "giteaissues:h-2.5 giteaissues:flex-col giteaissues:border-t giteaissues:border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="giteaissues:relative giteaissues:flex-1 giteaissues:rounded-full giteaissues:bg-border"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
