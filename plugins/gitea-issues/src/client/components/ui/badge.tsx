import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "giteaissues:inline-flex giteaissues:w-fit giteaissues:shrink-0 giteaissues:items-center giteaissues:justify-center giteaissues:gap-1 giteaissues:overflow-hidden giteaissues:rounded-full giteaissues:border giteaissues:border-transparent giteaissues:px-2 giteaissues:py-0.5 giteaissues:text-xs giteaissues:font-medium giteaissues:whitespace-nowrap giteaissues:transition-[color,box-shadow] giteaissues:focus-visible:border-ring giteaissues:focus-visible:ring-[3px] giteaissues:focus-visible:ring-ring/50 giteaissues:aria-invalid:border-destructive giteaissues:aria-invalid:ring-destructive/20 giteaissues:dark:aria-invalid:ring-destructive/40 giteaissues:[&>svg]:pointer-events-none giteaissues:[&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "giteaissues:bg-primary giteaissues:text-primary-foreground giteaissues:[a&]:hover:bg-primary/90",
        secondary:
          "giteaissues:bg-secondary giteaissues:text-secondary-foreground giteaissues:[a&]:hover:bg-secondary/90",
        destructive:
          "giteaissues:bg-destructive giteaissues:text-white giteaissues:focus-visible:ring-destructive/20 giteaissues:dark:bg-destructive/60 giteaissues:dark:focus-visible:ring-destructive/40 giteaissues:[a&]:hover:bg-destructive/90",
        outline:
          "giteaissues:border-border giteaissues:text-foreground giteaissues:[a&]:hover:bg-accent giteaissues:[a&]:hover:text-accent-foreground",
        ghost: "giteaissues:[a&]:hover:bg-accent giteaissues:[a&]:hover:text-accent-foreground",
        link: "giteaissues:text-primary giteaissues:underline-offset-4 giteaissues:[a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
