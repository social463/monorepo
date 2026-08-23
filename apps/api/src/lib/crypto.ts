import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { resolveCalendarEncryptionKey } from './config'

/**
 * Cifra de segredos em repouso: AES-256-GCM, formato `v1:iv:tag:ciphertext`
 * (todas as partes em base64). O prefixo de versão existe para permitir rotação
 * de chave/algoritmo depois sem adivinhar formato.
 */
const VERSION = 'v1'
const IV_BYTES = 12

function key(): Buffer {
  return resolveCalendarEncryptionKey(process.env)
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(':')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Segredo cifrado em formato desconhecido')
  }
  const [, iv, tag, ct] = parts
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
}
