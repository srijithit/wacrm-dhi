"use client"

import { cn } from "@/lib/utils"

interface TypingIndicatorProps {
  name?: string
  className?: string
}

export function TypingIndicator({ name, className }: TypingIndicatorProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 animate-in fade-in-0 duration-200",
        className
      )}
      role="status"
      aria-label={name ? `${name} is typing` : "Typing"}
    >
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-xs border border-border bg-card px-3.5 py-2.5 shadow-xs">
        <span
          className="h-2 w-2 rounded-full bg-primary/70 animate-bounce"
          style={{ animationDelay: "-0.32s" }}
        />
        <span
          className="h-2 w-2 rounded-full bg-primary/70 animate-bounce"
          style={{ animationDelay: "-0.16s" }}
        />
        <span
          className="h-2 w-2 rounded-full bg-primary/70 animate-bounce"
        />
      </div>
      {name && (
        <span className="text-xs text-muted-foreground animate-pulse">
          {name} is typing...
        </span>
      )}
    </div>
  )
}
