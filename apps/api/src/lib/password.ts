import bcrypt from 'bcryptjs'
import { randomInt } from 'node:crypto'

const SALT_ROUNDS = 10

/**
 * Sem `0O`, `1lI` e `5S`: essa senha nasce para ser lida na tela e digitada por
 * outra pessoa — caractere ambíguo aqui vira chamado de "não consigo entrar".
 */
const UNAMBIGUOUS_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZabcdefghijkmnopqrstuvwxyz2346789'

/**
 * Senha provisória para quem é criado pela importação de planilha. Volta uma
 * única vez na resposta do commit, para o admin distribuir — nunca é
 * persistida em texto nem registrada em log.
 *
 * `randomInt` do `node:crypto` em vez de `Math.random()`: é CSPRNG e já sorteia
 * dentro do intervalo sem o viés de módulo.
 */
export function generateTemporaryPassword(length = 12): string {
  let password = ''
  for (let i = 0; i < length; i += 1) {
    password += UNAMBIGUOUS_ALPHABET[randomInt(UNAMBIGUOUS_ALPHABET.length)]
  }
  return password
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
