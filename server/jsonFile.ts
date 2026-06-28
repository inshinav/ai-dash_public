import fs from 'node:fs/promises'
import crypto from 'node:crypto'

export type ReadStatus = 'ok' | 'missing' | 'corrupt'

export interface ReadResult<T> {
  value: T | null
  status: ReadStatus
}

// Read JSON without ever destroying data. A missing file is a normal first run;
// a corrupt file is preserved (renamed to *.corrupt-<timestamp>) and reported so
// the server can start empty in memory without silently clobbering recoverable data.
export async function readJsonFileSafe<T>(filePath: string): Promise<ReadResult<T>> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return { value: null, status: 'missing' }
  }
  try {
    return { value: JSON.parse(raw) as T, status: 'ok' }
  } catch (error) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const preserved = `${filePath}.corrupt-${stamp}`
    await fs.rename(filePath, preserved).catch(() => undefined)
    console.error(
      `Corrupt JSON at ${filePath} preserved as ${preserved}: ${
        error instanceof Error ? error.message : 'parse error'
      }`,
    )
    return { value: null, status: 'corrupt' }
  }
}

// Atomic write that keeps the previous good copy one rename away (*.bak) and uses
// a process-unique temp file so a stray second writer can never half-clobber it.
export async function writeJsonFileAtomic(filePath: string, data: unknown) {
  const serialized = JSON.stringify(data, null, 2)
  await fs.copyFile(filePath, `${filePath}.bak`).catch(() => undefined)
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temp, serialized)
  await fs.rename(temp, filePath)
}
