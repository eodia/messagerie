'use client'

import type { ContactListItem } from '@chat/contracts'
import { create } from 'zustand'

/**
 * « Nouveau message » (D23): the dialog where an agent writes first to a customer — open
 * from the list, the palette or a contact, with that contact already chosen.
 */
interface NewMessageState {
  readonly open: boolean
  readonly contact: ContactListItem | null
  show: (contact?: ContactListItem | null) => void
  hide: () => void
}

export const useNewMessage = create<NewMessageState>((set) => ({
  open: false,
  contact: null,
  show: (contact = null) => set({ open: true, contact }),
  hide: () => set({ open: false, contact: null }),
}))
