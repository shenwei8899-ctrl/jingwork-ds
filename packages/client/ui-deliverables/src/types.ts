/** Client-visible Session deliverable-file projection types. */
export {}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Unique successful mutation and explicit delivery paths in first-seen order. */
    deliverableFiles: readonly string[]
  }
}
