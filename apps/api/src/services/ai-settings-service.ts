import {
  AI_DEFAULT_PROVIDER,
  AI_PROVIDER_CATALOG,
  aiProviderInfo,
  resolveAiModel,
  type AiProvider,
  type AiSettingsDTO,
  type UpdateAiSettingsRequest,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { decryptSecret, encryptSecret } from '../lib/crypto'
import { AGENT_NOT_CONFIGURED_MESSAGE, AgentError } from '../lib/agent-error'
import { recordAuditLog } from './audit-log-service'

/**
 * Credencial de IA **por empresa** (BYO key — o Legends é whitelabel, cada
 * tenant escolhe o provedor de LLM e paga a própria cota). Mesma mecânica das
 * credenciais OAuth de calendário: `AppSetting` sob `(key, companyId)`, com o
 * segredo cifrado por `lib/crypto.ts` (AES-256-GCM).
 *
 * Não há fallback para `process.env`. A `GEMINI_API_KEY` do ambiente serve
 * **apenas** ao card do Destaque do Mês; se os agentes caíssem nela, todo tenant
 * sem chave própria gastaria a cota da EMR em silêncio e o custo de um cliente
 * apareceria na fatura de outro. Sem chave da empresa, o agente responde
 * "não configurado" — falha visível e barata.
 *
 * As duas primeiras chaves de `AppSetting` mantêm o nome `gemini` de quando só
 * havia esse provedor. Renomear exigiria migrar as linhas já gravadas para
 * ganhar só estética — o nome é interno e não aparece em lugar nenhum.
 */
export const AI_SETTING_KEYS = {
  apiKey: 'ai_gemini_api_key_enc',
  model: 'ai_gemini_model',
  provider: 'ai_provider',
  baseUrl: 'ai_base_url',
} as const

const AUDIT_ENTITY = 'AiSettings'

/**
 * `AppSetting` tem unique composta (key, companyId): o seletor precisa vir
 * inteiro em `key_companyId`, então `scopedPrisma` não se aplica e o companyId
 * vai explícito nos dois lados — igual ao calendar-settings-service.
 */
async function readSetting(companyId: string, key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key_companyId: { key, companyId } } })
  return row?.value ?? null
}

async function writeSetting(companyId: string, key: string, value: string | null): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key_companyId: { key, companyId } },
    create: { key, companyId, value },
    update: { value },
  })
}

/** Empresa sem provedor gravado é uma que cadastrou antes de existir a escolha: Gemini. */
function parseProvider(value: string | null): AiProvider {
  if (value && value in AI_PROVIDER_CATALOG) return value as AiProvider
  return AI_DEFAULT_PROVIDER
}

async function readAll(companyId: string) {
  const [apiKeyEnc, model, provider, baseUrl] = await Promise.all([
    readSetting(companyId, AI_SETTING_KEYS.apiKey),
    readSetting(companyId, AI_SETTING_KEYS.model),
    readSetting(companyId, AI_SETTING_KEYS.provider),
    readSetting(companyId, AI_SETTING_KEYS.baseUrl),
  ])
  return { apiKeyEnc, model, provider: parseProvider(provider), baseUrl }
}

/**
 * Estado da configuração para a tela. Note que a chave **não** aparece aqui —
 * nem mascarada. `configured` é o único bit que o front precisa, e é o único
 * que sai da API.
 */
export async function getAiSettings(companyId: string): Promise<AiSettingsDTO> {
  const { apiKeyEnc, model, provider, baseUrl } = await readAll(companyId)
  return {
    provider,
    configured: Boolean(apiKeyEnc),
    model: resolveAiModel(provider, model),
    baseUrl: baseUrl || null,
  }
}

export interface AiCredentials {
  provider: AiProvider
  apiKey: string
  model: string
  /** Só o provedor compatível-com-OpenAI usa; nos demais é `null`. */
  baseUrl: string | null
}

/**
 * Credencial usada pelos agentes em runtime. Lança `AgentError` 503 quando a
 * empresa não cadastrou chave — o chamador nunca precisa tratar `null`. O
 * compatível-com-OpenAI sem baseUrl cai no mesmo 503: chave sem endpoint não
 * chega a lugar nenhum, e a mensagem manda o admin para a mesma tela.
 */
export async function resolveAiCredentials(companyId: string): Promise<AiCredentials> {
  const { apiKeyEnc, model, provider, baseUrl } = await readAll(companyId)
  if (!apiKeyEnc) {
    throw new AgentError(AGENT_NOT_CONFIGURED_MESSAGE, 503)
  }
  if (aiProviderInfo(provider).requiresBaseUrl && !baseUrl) {
    throw new AgentError(AGENT_NOT_CONFIGURED_MESSAGE, 503)
  }
  return {
    provider,
    apiKey: decryptSecret(apiKeyEnc),
    model: resolveAiModel(provider, model),
    baseUrl: baseUrl || null,
  }
}

/**
 * Campo ausente mantém o valor atual (permite salvar só o modelo sem reenviar a
 * chave); string vazia limpa — é assim que se desliga o agente de uma empresa.
 *
 * Trocar de provedor **apaga a chave**: uma chave da OpenAI não vale no Gemini,
 * e deixá-la para trás faria o agente falhar no upstream com erro obscuro em vez
 * de dizer "cadastre a chave". O modelo é zerado pelo mesmo motivo — cada
 * provedor tem os seus, e o default do novo provedor é o palpite certo.
 */
export async function updateAiSettings(input: {
  companyId: string
  actorId: string
  body: UpdateAiSettingsRequest
}): Promise<AiSettingsDTO> {
  const { companyId, actorId, body } = input
  const before = await getAiSettings(companyId)
  const trocouProvedor = body.provider !== undefined && body.provider !== before.provider

  if (trocouProvedor) {
    await writeSetting(companyId, AI_SETTING_KEYS.provider, body.provider!)
    await writeSetting(companyId, AI_SETTING_KEYS.apiKey, null)
    await writeSetting(companyId, AI_SETTING_KEYS.model, null)
    await writeSetting(companyId, AI_SETTING_KEYS.baseUrl, null)
  }

  if (body.apiKey !== undefined) {
    const trimmed = body.apiKey.trim()
    await writeSetting(companyId, AI_SETTING_KEYS.apiKey, trimmed ? encryptSecret(trimmed) : null)
  }
  if (body.model !== undefined) {
    await writeSetting(companyId, AI_SETTING_KEYS.model, body.model.trim() || null)
  }
  if (body.baseUrl !== undefined) {
    await writeSetting(companyId, AI_SETTING_KEYS.baseUrl, body.baseUrl.trim() || null)
  }

  const after = await getAiSettings(companyId)
  // `before`/`after` são os DTOs — que por construção não carregam a chave.
  await recordAuditLog({
    actorId,
    entityType: AUDIT_ENTITY,
    entityId: companyId,
    action: 'UPDATE',
    companyId,
    before,
    after,
  })
  return after
}
