// Modelo de conteúdo da Bússola AI First.
// Conteúdo é separado da apresentação: tudo aqui pode migrar para um CMS
// ou para o Lovable Cloud sem alterar componentes.

export type PathId = "ia" | "ia-pessoa" | "pessoa";

export type Category =
  | "Escrita"
  | "Comunicação"
  | "Organização"
  | "Pesquisa"
  | "Aprendizagem"
  | "Criatividade"
  | "Projetos"
  | "Planejamento"
  | "Dados"
  | "Liderança"
  | "Pessoas"
  | "Segurança";

export type AreaId =
  | "gente-gestao"
  | "marketing"
  | "produto"
  | "tecnologia"
  | "financeiro"
  | "comercial"
  | "cx"
  | "ensino"
  | "operacoes"
  | "todas";

export type Status = "publicado" | "em-breve";

export interface Situation {
  id: string;
  title: string;
  slug: string;
  summary: string;
  category: Category;
  area: AreaId;
  path: PathId;
  aiRole: string;
  humanRole: string;
  leadershipTrigger: string;
  risk: string;
  prompt: string;
  promptIds?: string[];
  videoIds?: string[];
  caseIds?: string[];
  faqIds?: string[];
  exerciseIds?: string[];
  tags: string[];
  status: Status;
}

export interface PromptItem {
  id: string;
  title: string;
  category: string;
  area: AreaId;
  description: string;
  whenToUse: string;
  text: string;
  variables: string[];
  relatedSituations: string[];
  tags: string[];
  status: Status;
}

export interface VideoItem {
  id: string;
  title: string;
  duration: string;
  category: string;
  behavior: string;
  area: AreaId;
  description: string;
  url: string | null;
  relatedSituations: string[];
  relatedPrompts: string[];
  relatedCases: string[];
  status: Status;
}

export interface CaseItem {
  id: string;
  title: string;
  area: AreaId;
  problem: string;
  previousSituation: string;
  solution: string;
  aiUsage: string;
  peopleInvolved: string;
  securityValidation: string;
  result: string;
  impactType: string;
  hoursSaved: string;
  learning: string;
  limitations: string;
  scalePotential: string;
  responsible: string;
  conditions: string[];
  steps: string[];
  status: Status;
  tags: string[];
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string[];
  category:
    | "Trabalho e carreira"
    | "Confiança na IA"
    | "Uso diário"
    | "Segurança"
    | "Ética"
    | "Aprendizado"
    | "Liderança";
  tags: string[];
}

export interface ExerciseItem {
  id: string;
  title: string;
  description: string;
  minutes: number;
  tags: string[];
}
