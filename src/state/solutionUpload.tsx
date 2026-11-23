import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useUserSolutions } from './userSolutions'

/* One hidden <input type="file"> for the whole app, so the top bar button, the
   sidebar drop zone and the welcome-screen call to action all open the same
   picker and feed the same verification queue. */

interface SolutionUploadValue {
  /** Opens the folder picker (.solution files are verified in the browser). */
  pickFiles: () => void
  /** Feeds dropped/selected files straight into verification. */
  handleFiles: (files: FileList | File[]) => void
}

const SolutionUploadContext = createContext<SolutionUploadValue | null>(null)

export function SolutionUploadProvider({ children }: { children: ReactNode }) {
  const { addFiles } = useUserSolutions()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // React has no prop for these; they turn the picker into a folder picker,
    // matching the batch validator page.
    const el = inputRef.current
    if (!el) return
    el.setAttribute('webkitdirectory', '')
    el.setAttribute('directory', '')
  }, [])

  const handleFiles = useCallback((files: FileList | File[]) => {
    void addFiles(files)
  }, [addFiles])

  const pickFiles = useCallback(() => {
    inputRef.current?.click()
  }, [])

  return (
    <SolutionUploadContext.Provider value={{ pickFiles, handleFiles }}>
      {children}
      <input
        ref={inputRef}
        type="file"
        accept=".solution"
        multiple
        className="upload-input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          if (event.target.files) handleFiles(event.target.files)
          event.target.value = ''
        }}
      />
    </SolutionUploadContext.Provider>
  )
}

export function useSolutionUpload(): SolutionUploadValue {
  const value = useContext(SolutionUploadContext)
  if (!value) throw new Error('useSolutionUpload must be used inside <SolutionUploadProvider>')
  return value
}
