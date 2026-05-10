'use client'

import { motion } from 'framer-motion'

/**
 * Subtle reveal animation for the hero block.
 * Kept as a thin client wrapper so the surrounding page can stay a server component.
 */
export function HeroReveal({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.21, 0.47, 0.32, 0.98] }}
    >
      {children}
    </motion.div>
  )
}
