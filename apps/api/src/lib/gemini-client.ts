import { GoogleGenAI } from "@google/genai";

export interface CongratsInput {
  winnerName: string;
  monthLabel: string;
  justifications: string[]; // SOMENTE os textos, sem identificar autores
}

/**
 * Monta o prompt para o Gemini. As justificativas entram ANÔNIMAS — nenhum
 * nome/email de quem votou é incluído. Função pura (testável sem rede).
 */
export function buildCongratsPrompt(input: CongratsInput): string {
  const bullets = input.justifications.map((j) => `- ${j.trim()}`).join("\n");
  return [
    `Você é o narrador do programa "Legends" de uma equipe de desenvolvimento de produto.`,
    `Escreva um parabéns curto e impactante (2 a 3 frases, no máximo ~60 palavras, em português do Brasil)`,
    `para ${input.winnerName}, eleito(a) o Destaque do Mês de ${input.monthLabel} pela votação dos colegas.`,
    `Explique o PORQUÊ do destaque com base no que os colegas escreveram (justificativas anônimas abaixo).`,
    `Tom caloroso e profissional. Não invente fatos. Não cite nomes de quem votou (são anônimas).`,
    `Não use markdown, aspas ou emojis. Responda apenas com o texto final.`,
    ``,
    `Justificativas dos colegas:`,
    bullets,
  ].join("\n");
}

/** Chama o Gemini e devolve o texto. Lança erro claro se a chave faltar. */
export async function buildCongratsText(
  input: CongratsInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY não configurada — defina em apps/api/.env para gerar o texto do destaque.",
    );
  }
  const model = env.GEMINI_MODEL ?? "gemini-3-flash-preview";
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model,
    contents: buildCongratsPrompt(input),
  });
  const text = (res.text ?? "").trim();
  if (!text) throw new Error("O Gemini não retornou texto para o destaque.");
  return text;
}

export interface AssistantPromptEntry {
  category: string | null;
  question: string;
  answer: string;
}

/**
 * Entrada do prompt da assistente. O tipo é a garantia de privacidade: só a pergunta
 * e os campos textuais das entradas recuperadas entram — nome, e-mail ou qualquer
 * dado de terceiro não têm por onde chegar ao Gemini.
 */
export interface AssistantPromptInput {
  question: string;
  entries: AssistantPromptEntry[];
}

/**
 * Monta o prompt da assistente de RH. Função pura (testável sem rede). O ancoramento
 * é o ponto: sem ele o modelo inventa política interna, que é o pior resultado
 * possível para RH.
 */
export function buildAssistantPrompt(input: AssistantPromptInput): string {
  const contexto = input.entries
    .map((entry, index) => {
      const titulo = entry.category ? `${entry.category} — ${entry.question}` : entry.question;
      return `[${index + 1}] ${titulo}\n${entry.answer.trim()}`;
    })
    .join("\n\n");

  return [
    "Você é a assistente de Gente e Gestão da empresa, respondendo a um colaborador em português do Brasil.",
    "Responda usando exclusivamente as informações do CONTEXTO abaixo.",
    "Se o contexto não responder à pergunta, diga exatamente que não encontrei essa informação na base e sugira procurar o time de Gente e Gestão.",
    "Não invente número, prazo, valor ou política que não esteja no contexto.",
    "Seja direto: no máximo 4 frases. Não use markdown, títulos ou emojis. Responda apenas com o texto final.",
    "",
    "CONTEXTO:",
    contexto,
    "",
    `PERGUNTA: ${input.question.trim()}`,
  ].join("\n");
}

/** Chama o Gemini com o prompt ancorado. Lança se a chave faltar — quem chama decide o fallback. */
export async function buildAssistantAnswer(
  input: AssistantPromptInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada — a assistente responde direto da base.");
  }
  const model = env.GEMINI_MODEL ?? "gemini-3-flash-preview";
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model,
    contents: buildAssistantPrompt(input),
  });
  const text = (res.text ?? "").trim();
  if (!text) throw new Error("O Gemini não retornou texto para a assistente.");
  return text;
}
