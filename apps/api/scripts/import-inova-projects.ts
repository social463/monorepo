/**
 * Importa os projetos da Comunidade INOVA do app ANTIGO (Lovable + Supabase)
 * para o Legends.
 *
 * A migração para o módulo nativo (`specs/2026-09-03-comunidade-inova-nativa`)
 * levou a tela, não os dados: o kanban do Legends nasceu vazio e só recebeu o
 * que alguém recadastrou à mão. Este script fecha essa lacuna a partir do
 * export CSV do Supabase (`projects.csv` e as tabelas ao redor).
 *
 *   pnpm --filter @legends/api exec tsx scripts/import-inova-projects.ts \
 *     <pasta-do-export> [--company company-emr] [--actor email] \
 *     [--dry-run] [--manter-urls]
 *
 * É IDEMPOTENTE por título dentro da empresa: projeto que já existe no Legends
 * é pulado inteiro, e nada do que existe é alterado. É por isso que rodar de
 * novo é seguro — e é por isso também que edição feita no Legends depois da
 * primeira rodada (prioridade, fase nova) não é sobrescrita pelo CSV velho.
 *
 * Escreve direto pelo Prisma, e não por `createInovaProject`, de propósito: o
 * service notifica o Teams a cada projeto e força a primeira fase como IDEA.
 * Importar 59 projetos por ele mandaria 59 cartões para o canal e apagaria a
 * fase real de cada um.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_COMPANY_ID,
  INOVA_PROJECT_PHASES,
  type InovaDiaryEntryType,
  type InovaProjectPhase,
  type InovaTaskStatus,
} from '@legends/shared'
import { parseCsvTable } from '../src/lib/csv-parse'
import { prisma } from '../src/lib/prisma'
import { buildInovaDiaryKey, imageUploadsEnabled, putS3Object } from '../src/lib/s3-client'
import { scopedPrisma } from '../src/lib/tenant-scope'

const AQUI = dirname(fileURLToPath(import.meta.url))
const PASTA_PADRAO = resolve(AQUI, 'data/inova-emr')

function flag(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

function tem(nome: string): boolean {
  return process.argv.includes(`--${nome}`)
}

// ---------------------------------------------------------------- utilidades

/** Cabeçalho + linhas do CSV viram objetos por nome de coluna. */
function lerCsv(caminho: string): Record<string, string>[] {
  const tabela = parseCsvTable(readFileSync(caminho))
  return tabela.rows.map((linha) =>
    Object.fromEntries(tabela.headers.map((cabecalho, i) => [cabecalho, linha.cells[i] ?? ''])),
  )
}

/** Sem acento, sem caixa e sem espaço duplo — a chave de comparação de nomes e títulos. */
function normalizar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Literal de array do Postgres (`{a,b}`) como o export grava. Item com vírgula
 * vem entre aspas, e é por isso que não dá para usar `split(',')` aqui: a URL
 * de evidência com vírgula viraria duas URLs quebradas.
 */
function lerArrayPg(valor: string): string[] {
  const corpo = valor.trim()
  if (!corpo || corpo === '{}') return []
  if (!corpo.startsWith('{')) return [corpo]
  const itens: string[] = []
  let atual = ''
  let aspas = false
  for (let i = 1; i < corpo.length - 1; i += 1) {
    const char = corpo[i]
    if (aspas) {
      if (char === '\\') {
        i += 1
        atual += corpo[i]
        continue
      }
      if (char === '"') {
        aspas = false
        continue
      }
      atual += char
    } else if (char === '"') {
      aspas = true
    } else if (char === ',') {
      itens.push(atual)
      atual = ''
    } else {
      atual += char
    }
  }
  if (atual) itens.push(atual)
  return itens.map((item) => item.trim()).filter(Boolean)
}

/** `2026-03-26 13:22:03.894708+00` → Date. O `+00` do Postgres vira `+00:00`. */
function paraData(valor: string): Date | null {
  const bruto = valor.trim()
  if (!bruto) return null
  const iso = bruto.includes(' ') ? bruto.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00') : bruto
  const data = new Date(iso)
  return Number.isNaN(data.getTime()) ? null : data
}

function paraNumero(valor: string): number | null {
  const bruto = valor.trim()
  if (!bruto) return null
  const numero = Number(bruto.replace(',', '.'))
  return Number.isFinite(numero) ? numero : null
}

function paraBooleano(valor: string): boolean {
  return /^(true|t|1|sim)$/i.test(valor.trim())
}

function texto(valor: string | undefined): string | null {
  const bruto = (valor ?? '').trim()
  return bruto || null
}

// ------------------------------------------------------------------ de-para

/**
 * A fase no app antigo é o RÓTULO com emoji ("🧪 Testando a Solução"). O de-para
 * sai dos próprios rótulos de `INOVA_PROJECT_PHASES`, normalizados — assim
 * renomear uma fase no contrato não deixa um mapa paralelo para trás.
 */
const FASE_POR_ROTULO = new Map(
  INOVA_PROJECT_PHASES.map((fase) => [normalizar(fase.label.replace(/[^\p{L}\s]/gu, '')), fase.value]),
)

function paraFase(valor: string): InovaProjectPhase | null {
  return FASE_POR_ROTULO.get(normalizar(valor.replace(/[^\p{L}\s]/gu, ''))) ?? null
}

const STATUS_TAREFA: Record<string, InovaTaskStatus> = {
  todo: 'PENDING',
  in_progress: 'IN_PROGRESS',
  done: 'DONE',
}

const TIPO_DIARIO: Record<string, InovaDiaryEntryType> = {
  manual: 'MANUAL',
  automatic: 'AUTOMATIC',
}

/**
 * Vocabulário de atividade do app antigo → o do Legends. Nada no front decide
 * nada por `action` (a tela só imprime `summary`, autor e data), mas gravar
 * "created" ao lado de "PROJECT_CREATED" deixaria duas gramáticas na mesma
 * coluna para quem for consultar isso depois.
 */
const ATIVIDADE: Record<string, { action: string; entity: string }> = {
  created: { action: 'PROJECT_CREATED', entity: 'InovaProject' },
  updated: { action: 'PROJECT_UPDATED', entity: 'InovaProject' },
  advanced: { action: 'PHASE_CHANGED', entity: 'InovaProject' },
  diary_manual: { action: 'DIARY_ENTRY_ADDED', entity: 'InovaDiaryEntry' },
  diary_auto: { action: 'DIARY_ENTRY_ADDED', entity: 'InovaDiaryEntry' },
  task_added: { action: 'TASK_CREATED', entity: 'InovaProjectTask' },
  task_moved: { action: 'TASK_STATUS_CHANGED', entity: 'InovaProjectTask' },
}

const TIPO_IMAGEM: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

// ------------------------------------------------------------------- pessoas

interface Diretorio {
  /** Nome do responsável (texto do app antigo) → id de usuário do Legends. */
  porNome: Map<string, string>
  porEmail: Map<string, string>
  /** id do profile do Supabase → e-mail. */
  emailPorProfile: Map<string, string>
  /** Nome completo (como o app antigo grava o responsável) → e-mail corporativo. */
  emailPorNomeCompleto: Map<string, string>
  /** Nomes do app antigo que não casaram com ninguém — relatados no fim. */
  semCorrespondente: Set<string>
}

/**
 * O responsável no app antigo é TEXTO — e o texto é o nome completo da folha
 * ("KARLA DE ALVARENGA SILVEIRA FRANÇA"), que raramente é o nome de exibição
 * do Legends ("Karla França"). Por isso o caminho bom é pelo e-mail:
 * `allowed_emails.csv` é a mesma lista de RH que alimentava o seletor de lá.
 * Casar por nome é o último recurso.
 */
function resolverPorNome(dir: Diretorio, nome: string): string | null {
  const chave = normalizar(nome)
  if (!chave) return null
  const email = dir.emailPorNomeCompleto.get(chave)
  const porEmail = email ? dir.porEmail.get(email) : undefined
  const id = porEmail ?? dir.porNome.get(chave)
  if (id) return id
  dir.semCorrespondente.add(nome)
  return null
}

function resolverPorProfile(dir: Diretorio, profileId: string): string | null {
  const email = dir.emailPorProfile.get(profileId.trim())
  if (!email) return null
  return dir.porEmail.get(email) ?? null
}

// -------------------------------------------------------------------- imagens

/**
 * Evidência do diário mora num bucket PÚBLICO do Supabase. Copiar para o S3 do
 * Legends é o que faz o projeto migrado sobreviver ao dia em que o projeto
 * antigo for desligado. Falha de download ou S3 ausente não aborta nada: a URL
 * original fica, e o resumo diz quantas ficaram.
 */
async function migrarImagens(
  urls: string[],
  companyId: string,
  userId: string,
  resumo: { copiadas: number; mantidas: number },
): Promise<string[]> {
  const novas: string[] = []
  for (const url of urls) {
    try {
      const extensao = (url.split('?')[0].split('.').pop() ?? '').toLowerCase()
      const contentType = TIPO_IMAGEM[extensao]
      if (!contentType) throw new Error(`extensão não suportada: ${extensao}`)
      const resposta = await fetch(url)
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)
      const corpo = Buffer.from(await resposta.arrayBuffer())
      novas.push(await putS3Object({ key: buildInovaDiaryKey(companyId, userId, contentType), contentType, body: corpo }))
      resumo.copiadas += 1
    } catch (err) {
      console.warn(`  ⚠ evidência mantida no endereço antigo (${url}): ${(err as Error).message}`)
      novas.push(url)
      resumo.mantidas += 1
    }
  }
  return novas
}

// --------------------------------------------------------------------- main

async function main(): Promise<void> {
  const pastaArg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined
  const pasta = resolve(pastaArg ?? PASTA_PADRAO)
  const companyId = flag('company') ?? DEFAULT_COMPANY_ID
  const dryRun = tem('dry-run')
  const manterUrls = tem('manter-urls')

  const projetosCsv = join(pasta, 'projects.csv')
  if (!existsSync(projetosCsv)) {
    throw new Error(
      `Não achei ${projetosCsv}. Passe a pasta do export do Supabase como primeiro argumento ` +
        `(a que tem projects.csv, profiles.csv, phase_history.csv, project_tasks.csv e diary_entries.csv).`,
    )
  }

  const opcional = (arquivo: string): Record<string, string>[] =>
    existsSync(join(pasta, arquivo)) ? lerCsv(join(pasta, arquivo)) : []

  const projetos = lerCsv(projetosCsv)
  const profiles = opcional('profiles.csv')
  const emailsPermitidos = opcional('allowed_emails.csv')
  const historico = opcional('phase_history.csv')
  const tarefas = opcional('project_tasks.csv')
  const diario = opcional('diary_entries.csv')
  const atividade = opcional('project_activity.csv')

  const empresa = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } })
  if (!empresa) throw new Error(`Empresa ${companyId} não existe.`)

  const usuarios = await prisma.user.findMany({
    where: { companyId },
    select: { id: true, name: true, email: true, role: true, adminAccess: true },
  })

  // Nome repetido na empresa é ambíguo: melhor deixar o responsável em branco
  // e relatar do que apontar o projeto para a pessoa errada.
  const contagemPorNome = new Map<string, number>()
  for (const usuario of usuarios) {
    const chave = normalizar(usuario.name)
    contagemPorNome.set(chave, (contagemPorNome.get(chave) ?? 0) + 1)
  }
  const dir: Diretorio = {
    porNome: new Map(
      usuarios.filter((u) => contagemPorNome.get(normalizar(u.name)) === 1).map((u) => [normalizar(u.name), u.id]),
    ),
    porEmail: new Map(usuarios.map((u) => [u.email.toLowerCase(), u.id])),
    emailPorProfile: new Map(profiles.map((p) => [p.id, (p.email ?? '').toLowerCase()])),
    emailPorNomeCompleto: new Map(
      emailsPermitidos
        .filter((linha) => linha.name && linha.email)
        .map((linha) => [normalizar(linha.name), linha.email.toLowerCase()]),
    ),
    semCorrespondente: new Set(),
  }
  // O nome de exibição do app antigo também serve de ponte: "Karla França" lá
  // pode ser "KARLA DE ALVARENGA SILVEIRA FRANÇA" aqui, e o e-mail resolve.
  for (const profile of profiles) {
    const chave = normalizar(profile.display_name ?? '')
    const id = dir.porEmail.get((profile.email ?? '').toLowerCase())
    if (chave && id && !dir.porNome.has(chave)) dir.porNome.set(chave, id)
  }

  // Autor de fallback do projeto cujo `created_by` não casa com ninguém aqui —
  // e do diário, que o export nem traz autor. Fica em quem administra o módulo.
  const emailAtor = flag('actor')?.toLowerCase()
  const ator = emailAtor
    ? usuarios.find((u) => u.email.toLowerCase() === emailAtor)
    : usuarios.find((u) => u.role === 'ADMIN' || u.role === 'SUBADMIN' || u.adminAccess)
  if (!ator) {
    throw new Error(
      emailAtor
        ? `Não achei o usuário ${emailAtor} em ${empresa.name}.`
        : `${empresa.name} não tem nenhum admin para assinar a importação. Passe --actor <e-mail>.`,
    )
  }

  const db = scopedPrisma(companyId)
  const existentes = await db.inovaProject.findMany({ select: { title: true } })
  const titulosExistentes = new Set(existentes.map((p) => normalizar(p.title)))

  const porProjeto = <T extends { project_id: string }>(linhas: T[]): Map<string, T[]> => {
    const mapa = new Map<string, T[]>()
    for (const linha of linhas) {
      const lista = mapa.get(linha.project_id) ?? []
      lista.push(linha)
      mapa.set(linha.project_id, lista)
    }
    return mapa
  }
  const historicoPorProjeto = porProjeto(historico as { project_id: string; [k: string]: string }[])
  const tarefasPorProjeto = porProjeto(tarefas as { project_id: string; [k: string]: string }[])
  const diarioPorProjeto = porProjeto(diario as { project_id: string; [k: string]: string }[])
  const atividadePorProjeto = porProjeto(atividade as { project_id: string; [k: string]: string }[])

  const copiarImagens = !manterUrls && !dryRun && imageUploadsEnabled()
  if (!manterUrls && !dryRun && !imageUploadsEnabled()) {
    console.warn('⚠ S3 não configurado: as evidências do diário vão ficar apontando para o Supabase antigo.\n')
  }

  console.log(
    `${dryRun ? '[dry-run] ' : ''}${projetos.length} projeto(s) no export · ${titulosExistentes.size} já no Legends (${empresa.name})\n`,
  )

  const resumoImagens = { copiadas: 0, mantidas: 0 }
  let criados = 0
  let pulados = 0
  let atividadeSemAtor = 0
  const semFase: string[] = []

  for (const linha of projetos) {
    const titulo = (linha.title ?? '').trim()
    if (!titulo) continue
    if (titulosExistentes.has(normalizar(titulo))) {
      pulados += 1
      continue
    }

    const fase = paraFase(linha.phase ?? '')
    if (!fase) {
      semFase.push(titulo)
      continue
    }

    const criadoPor = resolverPorProfile(dir, linha.created_by ?? '') ?? ator.id
    const responsible1Id = linha.responsible1 ? resolverPorNome(dir, linha.responsible1) : null
    const responsible2Id = linha.responsible2 ? resolverPorNome(dir, linha.responsible2) : null
    const criadoEm = paraData(linha.created_at ?? '') ?? new Date()

    if (dryRun) {
      criados += 1
      console.log(`+ ${titulo} — ${linha.sector} · ${fase}`)
      continue
    }

    const entradasDiario = diarioPorProjeto.get(linha.id) ?? []
    // O download acontece FORA da transação: rede lenta não pode segurar
    // conexão de banco aberta (o teto de 30 s da transação é implacável).
    const imagensPorEntrada = new Map<string, string[]>()
    for (const entrada of entradasDiario) {
      const urls = lerArrayPg(entrada.image_urls ?? '')
      imagensPorEntrada.set(
        entrada.id,
        copiarImagens ? await migrarImagens(urls, companyId, criadoPor, resumoImagens) : urls,
      )
    }

    await db.$transaction(async (tx) => {
      const projeto = await tx.inovaProject.create({
        data: {
          title: titulo,
          category: (linha.category ?? '').trim() || 'Outro',
          sector: (linha.sector ?? '').trim() || 'Sem setor',
          description: (linha.description ?? '').trim(),
          problemDescription: texto(linha.problem_description),
          results: texto(linha.results),
          hoursSaved: paraNumero(linha.hours_saved ?? ''),
          costReduction: paraNumero(linha.cost_reduction ?? ''),
          otherMetrics: texto(linha.other_metrics),
          projectCosts: texto(linha.project_costs),
          toolsUsed: texto(linha.tools_used),
          deadline: paraData(linha.deadline ?? ''),
          priority: paraBooleano(linha.priority ?? ''),
          leadershipChallenge: paraBooleano(linha.leadership_challenge ?? ''),
          sectorRepresentative: texto(linha.sector_representative),
          responsible1Id,
          responsible2Id,
          phase: fase,
          archived: paraBooleano(linha.archived ?? ''),
          createdById: criadoPor,
          createdAt: criadoEm,
          updatedAt: paraData(linha.updated_at ?? '') ?? criadoEm,
        },
      })

      const historicoDoProjeto = (historicoPorProjeto.get(linha.id) ?? [])
        .map((h) => ({ fase: paraFase(h.phase ?? ''), data: paraData(h.date ?? ''), nota: texto(h.note) }))
        .filter((h): h is { fase: InovaProjectPhase; data: Date | null; nota: string | null } => h.fase !== null)

      // Sem histórico no export, a fase atual vira a única linha da linha do
      // tempo — senão o detalhe do projeto migrado abriria sem passado nenhum.
      const linhasHistorico = historicoDoProjeto.length > 0 ? historicoDoProjeto : [{ fase, data: criadoEm, nota: null }]
      for (const item of linhasHistorico) {
        await tx.inovaPhaseHistory.create({
          data: { projectId: projeto.id, phase: item.fase, note: item.nota, occurredAt: item.data ?? criadoEm },
        })
      }

      for (const tarefa of tarefasPorProjeto.get(linha.id) ?? []) {
        await tx.inovaProjectTask.create({
          data: {
            projectId: projeto.id,
            title: (tarefa.title ?? '').trim() || 'Sem título',
            description: texto(tarefa.description),
            responsible: texto(tarefa.responsible),
            dueDate: paraData(tarefa.date ?? ''),
            status: STATUS_TAREFA[(tarefa.status ?? '').trim()] ?? 'PENDING',
          },
        })
      }

      for (const entrada of entradasDiario) {
        await tx.inovaDiaryEntry.create({
          data: {
            projectId: projeto.id,
            title: (entrada.title ?? '').trim() || 'Sem título',
            description: texto(entrada.description),
            learnings: texto(entrada.learnings),
            tools: texto(entrada.tools),
            entryType: TIPO_DIARIO[(entrada.entry_type ?? '').trim()] ?? 'MANUAL',
            occurredAt: paraData(entrada.date ?? '') ?? criadoEm,
            imageUrls: imagensPorEntrada.get(entrada.id) ?? [],
            videoLinks: lerArrayPg(entrada.video_links ?? ''),
            externalLinks: lerArrayPg(entrada.external_links ?? ''),
            // O export do diário não traz autor: a autoria fica com quem criou
            // o projeto, que é quem mantinha o diário no app antigo.
            createdById: criadoPor,
            createdAt: paraData(entrada.date ?? '') ?? criadoEm,
          },
        })
      }

      // A linha do tempo do app antigo. O autor SÓ sai do e-mail do próprio
      // evento: cair no ator da importação diria que foi ele quem mexeu, e a
      // atividade existe justamente para dizer quem fez o quê.
      for (const evento of atividadePorProjeto.get(linha.id) ?? []) {
        const atorDoEvento = dir.porEmail.get((evento.actor_email ?? '').trim().toLowerCase())
        if (!atorDoEvento) {
          atividadeSemAtor += 1
          continue
        }
        let detalhes: unknown = null
        try {
          detalhes = evento.details ? JSON.parse(evento.details) : null
        } catch {
          detalhes = null
        }
        const tipo = ATIVIDADE[(evento.action ?? '').trim()] ?? {
          action: 'PROJECT_UPDATED',
          entity: 'InovaProject',
        }
        await tx.inovaActivity.create({
          data: {
            projectId: projeto.id,
            action: tipo.action,
            entity: tipo.entity,
            summary: (evento.summary ?? '').trim() || 'Atividade importada do INOVA anterior.',
            actorId: atorDoEvento,
            details: (detalhes as object) ?? undefined,
            createdAt: paraData(evento.created_at ?? '') ?? criadoEm,
          },
        })
      }
    })

    criados += 1
    console.log(`+ ${titulo} — ${linha.sector} · ${fase}`)
  }

  console.log(
    `\n${dryRun ? '[dry-run] ' : ''}${criados} criado(s), ${pulados} já existia(m)` +
      (copiarImagens ? ` · ${resumoImagens.copiadas} evidência(s) copiada(s) para o S3` : ''),
  )
  if (atividadeSemAtor > 0) {
    console.log(`${atividadeSemAtor} registro(s) de atividade sem autor correspondente no Legends foram descartados.`)
  }
  if (resumoImagens.mantidas > 0) {
    console.log(`${resumoImagens.mantidas} evidência(s) ficaram apontando para o Supabase antigo.`)
  }
  if (semFase.length > 0) {
    console.log(`\nFase desconhecida (não importados): ${semFase.join(', ')}`)
  }
  if (dir.semCorrespondente.size > 0) {
    console.log(
      `\nResponsáveis sem usuário correspondente no Legends (projeto criado sem responsável):\n  ` +
        [...dir.semCorrespondente].sort().join('\n  '),
    )
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
