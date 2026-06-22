import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef(({
  className,
  value,
  defaultValue,
  revealThumbOnInteraction = false,
  ...props
}, ref) => {
  const thumbCount = Math.max(value?.length ?? 0, defaultValue?.length ?? 0, 1)
  const [thumbVisible, setThumbVisible] = React.useState(!revealThumbOnInteraction)

  const showThumb = () => {
    if (revealThumbOnInteraction) setThumbVisible(true)
  }

  const hideThumb = () => {
    if (revealThumbOnInteraction) setThumbVisible(false)
  }

  React.useEffect(() => {
    if (!revealThumbOnInteraction || !thumbVisible) return undefined
    const onPointerUp = () => setThumbVisible(false)
    window.addEventListener("pointerup", onPointerUp)
    return () => window.removeEventListener("pointerup", onPointerUp)
  }, [revealThumbOnInteraction, thumbVisible])

  return (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex w-full touch-none select-none items-center", className)}
    value={value}
    defaultValue={defaultValue}
    onPointerDown={showThumb}
    onFocus={showThumb}
    onBlur={hideThumb}
    {...props}>
    <SliderPrimitive.Track
      className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-violet-100 dark:bg-zinc-700">
      <SliderPrimitive.Range className="absolute h-full gradient-linkedin" />
    </SliderPrimitive.Track>
    {Array.from({ length: thumbCount }).map((_, index) => (
      <SliderPrimitive.Thumb
        key={index}
        className={cn(
          "block h-4 w-4 rounded-full border-2 border-violet-400 bg-white shadow transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40 disabled:pointer-events-none disabled:opacity-50 dark:border-violet-300 dark:bg-zinc-900",
          revealThumbOnInteraction && !thumbVisible && "pointer-events-none scale-0 opacity-0",
        )} />
    ))}
  </SliderPrimitive.Root>
)})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
