// OAuth state + PKCE helpers. `state` is a CSRF token tied to a pending authorization;
// PKCE (S256) is required by TikTok and harmless for Instagram. All values are URL-safe.

import crypto from 'node:crypto'

const b64url = (buf: Buffer) => buf.toString('base64url')

export function randomState(): string {
  return b64url(crypto.randomBytes(24))
}

export interface PkcePair {
  verifier: string
  challenge: string
}

export function pkcePair(): PkcePair {
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}
