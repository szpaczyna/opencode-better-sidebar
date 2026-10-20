/**
 * Collapsible sidebar section state shared by the local sidebar plugins.
 *
 * The plugins own the Solid signal so the toggle reacts immediately, while this
 * module keeps the persistence convention in one place. It deliberately has no
 * imports: OpenCode resolves peer packages only inside a plugin directory, so a
 * shared file outside one cannot pull in solid-js.
 */

export type SectionIO = {
  initial: boolean
  save: (open: boolean) => void
}

export function createSectionIO(context: any, key: string): SectionIO {
  const [stored, updateStored] = context.storage.store<{ open: boolean }>(key, {
    initial: { open: true },
  })

  return {
    initial: typeof stored?.open === "boolean" ? stored.open : true,
    save: (open: boolean) => {
      void updateStored((draft: { open: boolean }) => {
        draft.open = open
      })
    },
  }
}