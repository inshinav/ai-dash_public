import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { api, ownerToken } from './api'

interface OwnerState {
  isOwner: boolean
  checking: boolean
  unlock: (token: string) => Promise<void>
  lock: () => void
}

const OwnerContext = createContext<OwnerState>({
  isOwner: false,
  checking: false,
  unlock: async () => undefined,
  lock: () => undefined,
})

export function OwnerProvider({ children }: { children: ReactNode }) {
  const [isOwner, setIsOwner] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const token = ownerToken.get()
    if (!token) {
      setChecking(false)
      return
    }
    api
      .checkOwner(token)
      .then(() => setIsOwner(true))
      .catch(() => ownerToken.clear())
      .finally(() => setChecking(false))
  }, [])

  const unlock = useCallback(async (token: string) => {
    await api.checkOwner(token)
    ownerToken.set(token)
    setIsOwner(true)
  }, [])

  const lock = useCallback(() => {
    ownerToken.clear()
    setIsOwner(false)
  }, [])

  return (
    <OwnerContext.Provider value={{ isOwner, checking, unlock, lock }}>
      {children}
    </OwnerContext.Provider>
  )
}

export function useOwner() {
  return useContext(OwnerContext)
}
