import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef(({ className, value, defaultValue, ...props }, ref) => {
  const thumbCount = Math.max(value?.length ?? 0, defaultValue?.length ?? 0, 1)

  return (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex w-full touch-none select-none items-center", className)}
    value={value}
    defaultValue={defaultValue}
    {...props}>
    <SliderPrimitive.Track
      className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-violet-100 dark:bg-zinc-700">
      <SliderPrimitive.Range className="absolute h-full gradient-linkedin" />
    </SliderPrimitive.Track>
    {Array.from({ length: thumbCount }).map((_, index) => (
      <SliderPrimitive.Thumb
        key={index}
        className="block h-4 w-4 rounded-full border-2 border-violet-400 bg-white shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40 disabled:pointer-events-none disabled:opacity-50 dark:border-violet-300 dark:bg-zinc-900" />
    ))}
  </SliderPrimitive.Root>
)})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
