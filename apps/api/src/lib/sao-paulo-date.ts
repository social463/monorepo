/**
 * Helpers de data civil em America/Sao_Paulo. "Dia" é representado como uma
 * string YYYY-MM-DD e/ou um Date à meia-noite UTC cujo componente de data é
 * exatamente esse dia civil — independente do fuso do servidor. É o mesmo
 * formato usado por MoodEntry.day.
 */
export function todayInSaoPaulo(): { ymd: string; day: Date } {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return { ymd, day: new Date(`${ymd}T00:00:00.000Z`) }
}

/** O dia civil (YYYY-MM-DD) em America/Sao_Paulo para um instante qualquer. */
export function ymdInSaoPaulo(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** A hora civil (0–23) em America/Sao_Paulo para um instante qualquer. */
export function hourInSaoPaulo(now: Date): number {
  const hh = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  return Number(hh)
}

export function ymdOf(day: Date): string {
  return day.toISOString().slice(0, 10)
}

export function dayFromYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}

export function addDays(ymd: string, n: number): string {
  const d = dayFromYmd(ymd)
  d.setUTCDate(d.getUTCDate() + n)
  return ymdOf(d)
}

/**
 * Deslocamento (em minutos) do fuso `tz` em relação ao UTC no instante `at`.
 * Positivo a leste de Greenwich; São Paulo devolve -180.
 */
function timeZoneOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return (asIfUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000
}

/**
 * O instante UTC exato da meia-noite civil de `ymd` em America/Sao_Paulo.
 * Diferente de `dayFromYmd` (que é meia-noite UTC): serve para recortar colunas
 * `DateTime` de verdade — `createdAt >= saoPauloMidnightUtc(dia)` — sem perder
 * ou sobrar as 3 horas de diferença para o UTC.
 */
export function saoPauloMidnightUtc(ymd: string): Date {
  const naive = dayFromYmd(ymd).getTime()
  // O offset é medido no próprio instante candidato. Como o Brasil não tem
  // horário de verão desde 2019, isso é exato; se voltar a ter, o erro se
  // limita à hora da virada em dois dias do ano.
  const offset = timeZoneOffsetMinutes('America/Sao_Paulo', new Date(naive))
  return new Date(naive - offset * 60_000)
}

/**
 * O instante UTC de uma hora de relógio de parede em America/Sao_Paulo:
 * `saoPauloInstant('2026-08-12', '10:30')` → `2026-08-12T13:30:00Z`.
 *
 * É o que traduz o que a pessoa marcou na tela (dia + hora, sem fuso nenhum) no
 * instante que vai para o banco. `new Date('2026-08-12T10:30:00')` **não serve**:
 * ISO sem fuso é lido no fuso do processo, que em dev é São Paulo e no contêiner
 * de produção é UTC — a mesma marcação viraria 10:30Z e apareceria como 07:30
 * para quem marcou. Generaliza `saoPauloMidnightUtc`, que é o caso `00:00`.
 *
 * `hhmm` aceita `HH:MM` e `HH:MM:SS`. Hora que não existe no fuso (virada de
 * horário de verão, se voltar a existir) cai no instante equivalente seguinte,
 * que é o comportamento do offset medido.
 */
export function saoPauloInstant(ymd: string, hhmm: string): Date {
  const naive = new Date(`${ymd}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}.000Z`).getTime()
  if (Number.isNaN(naive)) return new Date(NaN)
  const offset = timeZoneOffsetMinutes('America/Sao_Paulo', new Date(naive))
  return new Date(naive - offset * 60_000)
}

/**
 * A hora de relógio de parede (`HH:MM`) em America/Sao_Paulo. É a que vai para
 * texto lido por gente — título de notificação, por exemplo —, e por isso fixa o
 * fuso em vez de usar o do processo: o contêiner roda em UTC e escreveria uma
 * hora que ninguém reconhece.
 */
export function hhmmInSaoPaulo(at: Date): string {
  return hhmmssInSaoPaulo(at).slice(0, 5)
}

/** A hora de relógio de parede (`HH:MM:SS`) em America/Sao_Paulo de um instante. */
export function hhmmssInSaoPaulo(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(at)
}

/**
 * O último instante do dia civil `ymd` em São Paulo (23:59:59.999 local),
 * para fechar janelas `lte` sem perder a última hora do dia.
 */
export function saoPauloEndOfDayUtc(ymd: string): Date {
  return new Date(saoPauloInstant(ymd, '23:59:59').getTime() + 999)
}

export function monthRefOf(ymd: string): string {
  return ymd.slice(0, 7)
}

export function monthBounds(ref: string): { start: Date; endExclusive: Date } {
  const [year, month] = ref.split('-').map(Number)
  // Date.UTC trata overflow de mês: (year, 12, 1) → janeiro do ano seguinte.
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    endExclusive: new Date(Date.UTC(year, month, 1)),
  }
}

/**
 * Janela do mês em **instantes**, não em datas civis: use esta (e não `monthBounds`)
 * para comparar com um `DateTime` gravado por `now()` — ex.: "horas estudadas no mês".
 *
 * `monthBounds` devolve meia-noite **UTC**, o que abre um buraco de 3 horas: entre
 * 21h e a meia-noite de São Paulo do último dia do mês, o instante já virou o mês
 * seguinte em UTC e cairia fora da janela.
 *
 * São Paulo é UTC−03:00 fixo (o horário de verão acabou em 2019).
 */
export function monthInstantBoundsInSaoPaulo(ref: string): { start: Date; endExclusive: Date } {
  const [year, month] = ref.split('-').map(Number)
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
  return {
    start: new Date(`${ref}-01T00:00:00-03:00`),
    endExclusive: new Date(`${next}-01T00:00:00-03:00`),
  }
}

/** Segunda a sexta (getUTCDay 1..5). Sábado/domingo são fim de semana. */
export function isBusinessDay(ymd: string): boolean {
  const weekday = dayFromYmd(ymd).getUTCDay()
  return weekday >= 1 && weekday <= 5
}

/** Segunda-feira da semana civil de `ymd` (semana de segunda a domingo). */
export function startOfWeekYmd(ymd: string): string {
  const weekday = dayFromYmd(ymd).getUTCDay() // 0=domingo … 6=sábado
  const offset = (weekday + 6) % 7 // segunda=0 … domingo=6
  return addDays(ymd, -offset)
}

/** Dia útil imediatamente anterior a `ymd` (pula sábado/domingo). */
export function prevBusinessDay(ymd: string): string {
  let cur = addDays(ymd, -1)
  while (!isBusinessDay(cur)) cur = addDays(cur, -1)
  return cur
}

/** Dia útil imediatamente seguinte a `ymd` (pula sábado/domingo). */
export function nextBusinessDay(ymd: string): string {
  let cur = addDays(ymd, 1)
  while (!isBusinessDay(cur)) cur = addDays(cur, 1)
  return cur
}
