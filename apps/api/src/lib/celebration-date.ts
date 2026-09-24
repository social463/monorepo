import { dayFromYmd } from './sao-paulo-date'

/**
 * Aritmética das datas que se repetem todo ano — aniversário de nascimento e de
 * casa. Vive fora do `celebration-service` porque o mural de aniversário faz as
 * mesmas contas (qual é a ocorrência deste ano, quantos dias faltam) e duplicar
 * a regra de 29/02 em dois lugares é como ela sai do ar em anos diferentes.
 */

/** Um ano é bissexto se divisível por 4, exceto centenas não divisíveis por 400. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * O dia em que a data `month/day` é comemorada no ano civil `year`. Normalmente
 * é o próprio dia; a exceção é 29/02, que em ano não bissexto é comemorado em
 * 28/02 (senão a data desapareceria da tela em 3 de cada 4 anos).
 */
export function observedDay(month: number, day: number, year: number): number {
  if (month === 2 && day === 29 && !isLeapYear(year)) return 28
  return day
}

/**
 * Dia e mês civis de uma data do banco. Lemos os componentes **UTC** de
 * propósito: tanto `birthDate` (`@db.Date`) quanto `joinedAt` (setado pelo admin
 * a partir de um input `type="date"`, virando meia-noite UTC) são datas civis
 * sem hora. Converter para America/Sao_Paulo aqui jogaria toda data vinda do
 * formulário um dia para trás.
 */
export function civilDayMonth(date: Date): { day: number; month: number } {
  return { day: date.getUTCDate(), month: date.getUTCMonth() + 1 }
}

/** A data (YYYY-MM-DD) em que `month/day` é observado no ano civil `year`. */
export function occurrenceYmd(month: number, day: number, year: number): string {
  const observed = observedDay(month, day, year)
  return `${year}-${String(month).padStart(2, '0')}-${String(observed).padStart(2, '0')}`
}

/** Dias entre duas datas civis (YYYY-MM-DD), positivo quando `to` é depois de `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayFromYmd(to).getTime() - dayFromYmd(from).getTime()) / 86_400_000)
}
