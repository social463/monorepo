import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Pasta versionada das fotos dos devs (convenção do spec de fotos). */
const API_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
export const AVATAR_DIRS = [
  join(process.cwd(), 'assets', 'avatars'),
  join(process.cwd(), 'apps', 'api', 'assets', 'avatars'),
  join(API_DIR, 'assets', 'avatars'),
  join(API_DIR, '..', 'assets', 'avatars'),
]
export const AVATARS_DIR = AVATAR_DIRS[0]

const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}

/** Parte local do email, minúscula — chave do arquivo da foto. */
export function devPhotoHandle(email: string): string {
  return email.split('@')[0].toLowerCase()
}

/** Lê a foto do dev em disco e devolve um data URI, ou null se não existir. */
export function photoDataUriFor(email: string): string | null {
  const handle = devPhotoHandle(email)
  for (const ext of Object.keys(EXT_MIME)) {
    for (const dir of AVATAR_DIRS) {
      const file = join(dir, `${handle}${ext}`)
      if (existsSync(file)) {
        const base64 = readFileSync(file).toString('base64')
        return `data:${EXT_MIME[ext]};base64,${base64}`
      }
    }
  }
  return null
}
