import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/** 毛玻璃容器（MASTER.md §2/§5）：半透明 + blur + 1px 亮描边 */
export function GlassCard({
  className,
  hover = true,
  ...props
}: React.ComponentProps<"div"> & { hover?: boolean }) {
  return (
    <div
      className={cn("glass rounded-2xl", hover && "glass-hover", className)}
      {...props}
    />
  );
}

/** 入场微动效（Motion，尊重 prefers-reduced-motion） */
export function FadeIn({
  delay = 0,
  className,
  children,
}: {
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.22,
        ease: "easeOut",
        delay: reduce ? 0 : delay,
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
