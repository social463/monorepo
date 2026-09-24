import type { CaseItem } from "./types";

// Nenhum case foi inventado. Esta lista começa vazia por decisão editorial:
// os primeiros cases virão do registro das áreas, via Comunidade AI First / INOVA.

export const cases: CaseItem[] = [];

export const caseById = (id: string) => cases.find((c) => c.id === id);

// Campos exigidos por um bom case (Guia AI First: Seção 10).
export const caseFields = [
  { field: "Problema", describe: "Qual dor, desafio ou oportunidade existia antes da solução, incluindo esforço, tempo gasto, gargalos ou limitações." },
  { field: "Solução", describe: "O que foi criado e como a IA foi usada: ferramenta, abordagem, prompt principal." },
  { field: "Área envolvida", describe: "Quem participou da construção, validação ou utilização da solução e quais áreas foram impactadas." },
  { field: "Resultado", describe: "O que mudou de forma concreta: tempo, qualidade, experiência, receita, custo, produtividade ou redução de risco." },
  { field: "Horas economizadas", describe: "Estimativa de tempo poupado por semana ou por entrega." },
  { field: "Aprendizado", describe: "O que você faria igual e o que faria diferente." },
  { field: "Potencial de escala", describe: "Quais outras áreas poderiam reaproveitar isso." },
  { field: "Responsável", describe: "Quem pode explicar melhor a solução, seus resultados e aprendizados." },
];

// Ciclo da aprendizagem coletiva (Guia AI First: Seção 10).
export const inovaCycle = [
  { step: "Registrar", detail: "A área descreve o problema, a solução, os responsáveis, o resultado esperado e os cuidados adotados." },
  { step: "Acompanhar", detail: "A iniciativa recebe checkpoints, apoio e indicadores de evolução." },
  { step: "Compartilhar", detail: "Prompts, agentes, aprendizados e vitórias rápidas são apresentados à comunidade." },
  { step: "Reconhecer", detail: "Cases relevantes recebem visibilidade e reconhecimento conforme os critérios da Trilha INOVA." },
  { step: "Escalar", detail: "Soluções úteis são documentadas, adaptadas e disponibilizadas para outras áreas." },
  { step: "Institucionalizar", detail: "O conhecimento passa a integrar processos, bases e práticas da organização." },
];
