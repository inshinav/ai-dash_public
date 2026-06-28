// OAuth tokens at rest are encrypted with AES-256-GCM. The key comes from
// CONNECTOR_TOKEN_ENC_KEY (base64, 32 bytes). GCM gives confidentiality + tamper
// detection (a modified blob fails to decrypt). Never log tokens or the key.

import crypto from 'node:crypto'

const VERSION = 'v1'
const IV_LEN = 12
const TAG_LEN = 16

export function loadKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key || '', 'base64')
  if (key.length !== 32) {
    throw new Error('CONNECTOR_TOKEN_ENC_KEY must be 32 bytes, base64-encoded')
  }
  return key
}

// Returns null when no key is configured, so callers can disable connectors cleanly
// instead of crashing in environments that don't use live OAuth yet.
export function connectorKey(): Buffer | null {
  const raw = process.env.CONNECTOR_TOKEN_ENC_KEY || ''
  if (!raw) return null
  return loadKey(raw)
}

export function encryptToken(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${VERSION}:${Buffer.concat([iv, tag, ct]).toString('base64')}`
}

export function decryptToken(blob: string, key: Buffer): string {
  const [version, payload] = blob.split(':', 2)
  if (version !== VERSION || !payload) throw new Error('unrecognized token blob')
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
