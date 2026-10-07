import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "giteaissues:inline-flex giteaissues:shrink-0 giteaissues:items-center giteaissues:justify-center giteaissues:gap-2 giteaissues:rounded-md giteaissues:text-sm giteaissues:font-medium giteaissues:whitespace-nowrap giteaissues:transition-all giteaissues:outline-none giteaissues:focus-visible:border-ring giteaissues:focus-visible:ring-[3px] giteaissues:focus-visible:ring-ring/50 giteaissues:disabled:pointer-events-none giteaissues:disabled:opacity-50 giteaissues:aria-invalid:border-destructive giteaissues:aria-invalid:ring-destructive/20 giteaissues:dark:aria-invalid:ring-destructive/40 giteaissues:[&_svg]:pointer-events-none giteaissues:[&_svg]:shrink-0 giteaissues:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "giteaissues:bg-primary giteaissues:text-primary-foreground giteaissues:hover:bg-primary/90",
        destructive:
          "giteaissues:bg-destructive giteaissues:text-white giteaissues:hover:bg-destructive/90 giteaissues:focus-visible:ring-destructive/20 giteaissues:dark:bg-destructive/60 giteaissues:dark:focus-visible:ring-destructive/40",
        outline:
          "giteaissues:border giteaissues:bg-background giteaissues:shadow-xs giteaissues:hover:bg-accent giteaissues:hover:text-accent-foreground giteaissues:dark:border-input giteaissues:dark:bg-input/30 giteaissues:dark:hover:bg-input/50",
        secondary:
          "giteaissues:bg-secondary giteaissues:text-secondary-foreground giteaissues:hover:bg-secondary/80",
        ghost:
          "giteaissues:hover:bg-accent giteaissues:hover:text-accent-foreground giteaissues:dark:hover:bg-accent/50",
        link: "giteaissues:text-primary giteaissues:underline-offset-4 giteaissues:hover:underline",
      },
      size: {
        default: "giteaissues:h-9 giteaissues:px-4 giteaissues:py-2 giteaissues:has-[>svg]:px-3",
        xs: "giteaissues:h-6 giteaissues:gap-1 giteaissues:rounded-md giteaissues:px-2 giteaissues:text-xs giteaissues:has-[>svg]:px-1.5 giteaissues:[&_svg:not([class*=size-])]:size-3",
        sm: "giteaissues:h-8 giteaissues:gap-1.5 giteaissues:rounded-md giteaissues:px-3 giteaissues:has-[>svg]:px-2.5",
        lg: "giteaissues:h-10 giteaissues:rounded-md giteaissues:px-6 giteaissues:has-[>svg]:px-4",
        icon: "giteaissues:size-9",
        "icon-xs": "giteaissues:size-6 giteaissues:rounded-md giteaissues:[&_svg:not([class*=size-])]:size-3",
        "icon-sm": "giteaissues:size-8",
        "icon-lg": "giteaissues:size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
