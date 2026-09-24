import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  CALENDAR_EVENT_CATEGORIES,
  DEFAULT_COMPANY_ID,
  DEFAULT_ONE_ON_ONE_TOPICS,
  INTERNAL_COMPANY_ID,
  RECOGNITION_CATEGORY_SEED,
  XP_RULE_SEED,
} from "@legends/shared";
import {
  BENEFITS_SEED,
  MANIFESTO_BODY,
  MANIFESTO_SUBTITLE,
  MANIFESTO_TITLE,
} from "./culture-seed-content";
import { slugify } from "../src/lib/slug";
import { LEARNING_SEED, LEARNING_TRACKS_SEED } from "./learning-seed-content";
import { EMILY_KNOWLEDGE_SEED, EMILY_PERSONA_NAME } from "./emily-knowledge-seed-content";
import {
  APPRENTICE_CLASSES_SEED,
  APPRENTICE_CONTRACT_SEED,
  APPRENTICE_MEETINGS_SEED,
} from "./apprentice-seed-content";

const prisma = new PrismaClient();

/**
 * Trava de segurança: o seed insere usuários com emails hardcoded e nunca deve
 * rodar contra um banco remoto/compartilhado por engano (já causou contas
 * duplicadas ao rodar contra homologação). Só permite host local, salvo override
 * explícito via ALLOW_REMOTE_SEED=1.
 */
function assertLocalDatabase() {
  if (process.env.ALLOW_REMOTE_SEED === "1") return;
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLocal) {
    throw new Error(
      `Seed abortado: DATABASE_URL aponta para um host não-local (${host || "desconhecido"}). ` +
        `O seed só roda contra localhost para não duplicar dados em bancos compartilhados. ` +
        `Se realmente quer rodar contra este banco, defina ALLOW_REMOTE_SEED=1.`,
    );
  }
}

async function main() {
  assertLocalDatabase();
  // Apenas as contas de usuário (senha padrão: emr2026@).
  // O admin é criado manualmente em produção, não pelo seed.
  // Categorias, selos, períodos e feedbacks são criados manualmente em produção.
  const passwordHash = await bcrypt.hash("emr2026@", 10);

  // Time atual (colaboradores que recebem voto).
  const devs = [
    {
      email: "diego.barreto@eumedicoresidente.com.br",
      name: "Diego Barreto",
      position: "PM",
      squad: "Produto",
    },
    {
      email: "erika.kelner@eumedicoresidente.com.br",
      name: "Erika Kelner",
      position: "PM",
      squad: "Produto",
    },
    {
      email: "emerson.marques@eumedicoresidente.com.br",
      name: "Emerson Marques",
      position: "Dev back-end Pl",
      squad: "Engenharia",
    },
    {
      email: "fabio.vieira@eumedicoresidente.com.br",
      name: "Fábio Vieira",
      position: "DevOps Pl",
      squad: "Engenharia",
    },
    {
      email: "guilherme.magnus@eumedicoresidente.com.br",
      name: "Guilherme Magnus",
      position: "Product Designer Sr",
      squad: "Produto",
    },
    {
      email: "gabriel.william@eumedicoresidente.com.br",
      name: "Gabriel William",
      position: "Dev back-end Pl",
      squad: "Engenharia",
    },
    {
      email: "isabel.queiroz@eumedicoresidente.com.br",
      name: "Isabel Queiroz",
      position: "Dev front-end Jr",
      squad: "Engenharia",
    },
    {
      email: "karina.akina@eumedicoresidente.com.br",
      name: "Karina Akina",
      position: "Dev back-end Jr",
      squad: "Engenharia",
    },
    {
      email: "kelvin.almeida@eumedicoresidente.com.br",
      name: "Kelvin Almeida",
      position: "Dev full-stack Sr",
      squad: "Engenharia",
    },
    {
      email: "lucas.anes@eumedicoresidente.com.br",
      name: "Lucas Anes",
      position: "Dev back-end Jr",
      squad: "Engenharia",
    },
    {
      email: "lucas.barros@eumedicoresidente.com.br",
      name: "Lucas Barros",
      position: "Dev full-stack Sr",
      squad: "Engenharia",
    },
    {
      email: "gustavo.schimidt@eumedicoresidente.com.br",
      name: "Gustavo Schimidt",
      position: "Dev full-stack Sr",
      squad: "Engenharia",
    },
    {
      email: "maicon.leffa@eumedicoresidente.com.br",
      name: "Maicon Leffa",
      position: "Dev front-end Sr",
      squad: "Engenharia",
    },
    {
      email: "matheus.mota@eumedicoresidente.com.br",
      name: "Matheus Mota",
      position: "Dev back-end Pl",
      squad: "Engenharia",
    },
    {
      email: "monica.vaz@eumedicoresidente.com.br",
      name: "Monica Vaz",
      position: "Dev front-end Pl",
      squad: "Engenharia",
    },
  ];
  for (const d of devs) {
    await prisma.user.upsert({
      where: { email: d.email },
      update: {},
      create: { ...d, passwordHash, role: "LEGEND" },
    });
  }

  // Lideranças: fazem parte do Time e votam, mas não recebem voto (papel LEAD).
  const leads = [
    {
      email: "waghner.reis@eumedicoresidente.com.br",
      name: "Waghner Reis",
      position: "Head de Engenharia",
      squad: "Liderança",
    },
    {
      email: "patricia.diletieri@eumedicoresidente.com.br",
      name: "Patricia Diletieri",
      position: "GPM",
      squad: "Liderança",
    },
    {
      email: "lucca.secco@eumedicoresidente.com.br",
      name: "Lucca Secco",
      position: "Tech Lead",
      squad: "Liderança",
    },
    {
      email: "arthur.pedro@eumedicoresidente.com.br",
      name: "Arthur Pedro",
      position: "Tech Lead",
      squad: "Liderança",
    },
    {
      email: "paulo.sarraff@eumedicoresidente.com.br",
      name: "Paulo Sarraff",
      position: "Tech Lead",
      squad: "Liderança",
    },
  ];
  for (const l of leads) {
    await prisma.user.upsert({
      where: { email: l.email },
      update: { role: "LEAD", position: l.position, squad: l.squad },
      create: { ...l, passwordHash, role: "LEAD" },
    });
  }

  // Cadeia de comando (`managerId`): é ela que desenha o organograma **e** que
  // recorta a área de Liderança (humor, férias, indicadores). Sem isto o seed
  // nasce com todo mundo na raiz e os painéis do líder vazios — o que parece
  // bug, e não banco novo. A divisão dos devs entre os tech leads é arbitrária,
  // só para a árvore de desenvolvimento ter mais de um nível.
  const head = "waghner.reis@eumedicoresidente.com.br";
  const techLeads = [
    "lucca.secco@eumedicoresidente.com.br",
    "arthur.pedro@eumedicoresidente.com.br",
    "paulo.sarraff@eumedicoresidente.com.br",
  ];
  const chain: { email: string; managerEmail: string }[] = [
    ...leads
      .filter((l) => l.email !== head)
      .map((l) => ({ email: l.email, managerEmail: head })),
    ...devs.map((d, index) => ({
      email: d.email,
      managerEmail: techLeads[index % techLeads.length],
    })),
  ];
  for (const link of chain) {
    const manager = await prisma.user.findUnique({ where: { email: link.managerEmail } });
    if (!manager) continue;
    await prisma.user.update({
      where: { email: link.email },
      data: { managerId: manager.id },
    });
  }

  // Temas do catálogo de selos (Documento 4, seção 11.4). São a prateleira do
  // Painel de Emblemas — não confundir com RecognitionCategory, que é a
  // categoria do FEEDBACK e é o que `Badge.categorySlug` referencia.
  const badgeCategories = [
    { slug: "feedback", name: "Feedback", order: 0 },
    { slug: "social", name: "Social", order: 1 },
    { slug: "desenvolvimento", name: "Desenvolvimento", order: 2 },
    { slug: "clima", name: "Clima", order: 3 },
    { slug: "cultura", name: "Cultura", order: 4 },
  ];
  for (const c of badgeCategories) {
    await prisma.badgeCategory.upsert({
      where: { companyId_slug: { companyId: DEFAULT_COMPANY_ID, slug: c.slug } },
      update: {},
      create: { ...c, companyId: DEFAULT_COMPANY_ID },
    });
  }

  // Selos de tempo de casa (acumulativos por aniversário de entrada na equipe).
  const tenureBadges = [
    { slug: "tempo-de-casa-1-ano", name: "1 ano de casa", threshold: 1, iconKey: "fe-medal-bronze" },
    { slug: "tempo-de-casa-2-anos", name: "2 anos de casa", threshold: 2, iconKey: "fe-medal-silver" },
    { slug: "tempo-de-casa-3-anos", name: "3 anos de casa", threshold: 3, iconKey: "fe-medal-gold" },
    { slug: "tempo-de-casa-4-anos", name: "4 anos de casa", threshold: 4, iconKey: "fe-crown" },
  ];
  for (const b of tenureBadges) {
    await prisma.badge.upsert({
      where: { companyId_slug: { companyId: DEFAULT_COMPANY_ID, slug: b.slug } },
      update: {},
      create: {
        slug: b.slug,
        name: b.name,
        description: `Comemora ${b.threshold} ${b.threshold === 1 ? "ano" : "anos"} de equipe na EMR.`,
        kind: "TENURE",
        iconKey: b.iconKey,
        threshold: b.threshold,
        companyId: DEFAULT_COMPANY_ID,
      },
    });
  }

  const streakBadges = [
    { slug: "ofensiva-7-dias-uteis", name: "Em chamas", threshold: 7, iconKey: "fe-fire" },
    { slug: "ofensiva-14-dias-uteis", name: "Imparável", threshold: 14, iconKey: "fe-voltage" },
    { slug: "ofensiva-30-dias-uteis", name: "Incandescente", threshold: 30, iconKey: "fe-rocket" },
    { slug: "ofensiva-60-dias-uteis", name: "Lendária", threshold: 60, iconKey: "fe-crown" },
  ];
  for (const b of streakBadges) {
    await prisma.badge.upsert({
      where: { companyId_slug: { companyId: DEFAULT_COMPANY_ID, slug: b.slug } },
      update: {},
      create: {
        slug: b.slug,
        name: b.name,
        description: `Seu recorde de ofensiva atingiu ${b.threshold} dias úteis consecutivos.`,
        kind: "STREAK",
        iconKey: b.iconKey,
        threshold: b.threshold,
        companyId: DEFAULT_COMPANY_ID,
      },
    });
  }

  // Selos da área de Desenvolvimento: conclusão de curso e de ação de PDI.
  const courseBadges = [
    { slug: "aprendiz-1-curso", name: "Primeiro curso", threshold: 1, iconKey: "fe-medal-bronze" },
    { slug: "aprendiz-3-cursos", name: "Estudioso", threshold: 3, iconKey: "fe-medal-silver" },
    { slug: "aprendiz-5-cursos", name: "Sede de aprender", threshold: 5, iconKey: "fe-medal-gold" },
    { slug: "aprendiz-10-cursos", name: "Enciclopédia ambulante", threshold: 10, iconKey: "fe-crown" },
  ];
  for (const b of courseBadges) {
    await prisma.badge.upsert({
      where: { companyId_slug: { companyId: DEFAULT_COMPANY_ID, slug: b.slug } },
      update: {},
      create: {
        slug: b.slug,
        name: b.name,
        description: `Concluiu ${b.threshold} ${b.threshold === 1 ? "curso" : "cursos"} na área de Aprendizado.`,
        kind: "COURSE",
        iconKey: b.iconKey,
        threshold: b.threshold,
        companyId: DEFAULT_COMPANY_ID,
      },
    });
  }

  const pdiBadges = [
    { slug: "pdi-1-acao", name: "Plano em movimento", threshold: 1, iconKey: "fe-medal-bronze" },
    { slug: "pdi-3-acoes", name: "Em evolução", threshold: 3, iconKey: "fe-medal-silver" },
    { slug: "pdi-5-acoes", name: "Dono do próprio desenvolvimento", threshold: 5, iconKey: "fe-medal-gold" },
    { slug: "pdi-10-acoes", name: "Referência de desenvolvimento", threshold: 10, iconKey: "fe-rocket" },
  ];
  for (const b of pdiBadges) {
    await prisma.badge.upsert({
      where: { companyId_slug: { companyId: DEFAULT_COMPANY_ID, slug: b.slug } },
      update: {},
      create: {
        slug: b.slug,
        name: b.name,
        description: `Concluiu ${b.threshold} ${b.threshold === 1 ? "ação" : "ações"} do seu PDI, com evidência e reflexão.`,
        kind: "PDI",
        iconKey: b.iconKey,
        threshold: b.threshold,
        companyId: DEFAULT_COMPANY_ID,
      },
    });
  }

  await prisma.badge.upsert({
    where: { companyId_slug: { companyId: DEFAULT_COMPANY_ID, slug: "destaque-do-mes" } },
    update: {},
    create: {
      slug: "destaque-do-mes",
      name: "Destaque do Mês",
      description: "Concedido a quem foi eleito destaque do mês pela votação dos colegas.",
      kind: "HIGHLIGHT",
      iconKey: "trophy",
      threshold: 0,
      companyId: DEFAULT_COMPANY_ID,
    },
  });

  // Regras de EMR Coins (dev). Em produção elas nascem pelo admin — o seed só
  // deixa a feature utilizável na máquina de quem desenvolve. Idempotente pela
  // unique (companyId, event).
  const coinRules = [
    { event: "VOTE_CAST", amount: 50, capWindow: "NONE", capAmount: null },
    // +10 por reconhecimento, até 3 por semana — o pedido da G&G na 2ª rodada.
    // É default de seed: cada empresa ajusta em Administração › Pontos.
    { event: "FEEDBACK_PUBLISHED", amount: 10, capWindow: "WEEK", capAmount: 30 },
    { event: "FEEDBACK_REACTION", amount: 5, capWindow: "DAY", capAmount: 25 },
    { event: "MOOD_ANSWERED", amount: 10, capWindow: "NONE", capAmount: null },
  ] as const;
  for (const rule of coinRules) {
    const existing = await prisma.coinRule.findFirst({
      where: { event: rule.event, companyId: DEFAULT_COMPANY_ID },
    });
    if (!existing) {
      await prisma.coinRule.create({
        data: {
          event: rule.event,
          amount: rule.amount,
          capWindow: rule.capWindow,
          capAmount: rule.capAmount,
          companyId: DEFAULT_COMPANY_ID,
        },
      });
    }
  }

  // Regras de Pontos (XP). Os valores são DEFAULT, não regra: cada empresa muda
  // o dela em Administração › Pontos. A lista mora em `@legends/shared`
  // (`XP_RULE_SEED`) porque o mesmo default provisiona empresa nova e faz o
  // backfill das antigas (migration `20260818140000`) — divergir aqui daria
  // três verdades. Idempotente pela unique (companyId, event).
  for (const rule of XP_RULE_SEED) {
    const existing = await prisma.xpRule.findFirst({
      where: { event: rule.event, companyId: DEFAULT_COMPANY_ID },
    });
    if (!existing) {
      await prisma.xpRule.create({
        data: {
          event: rule.event,
          amount: rule.amount,
          capWindow: rule.capWindow,
          capAmount: rule.capAmount,
          companyId: DEFAULT_COMPANY_ID,
        },
      });
    }
  }

  // Catálogo de categorias — o mesmo para feedback e voto desde a unificação
  // (`specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`). A lista
  // da G&G é SEED, não constante do código: a partir daqui quem manda é o
  // catálogo da empresa (Administração › Categorias). Idempotente pela unique
  // (companyId, name).
  for (const [index, name] of RECOGNITION_CATEGORY_SEED.entries()) {
    const existing = await prisma.recognitionCategory.findFirst({
      where: { name, companyId: DEFAULT_COMPANY_ID },
    });
    if (!existing) {
      await prisma.recognitionCategory.create({
        data: { name, slug: slugify(name), order: index, companyId: DEFAULT_COMPANY_ID },
      });
    }
  }

  // Squads do retro (entidade gerenciável pelo admin). Idempotente por slug.
  const retroSquads = ['Estudar Mais', 'Estudar Melhor', 'Inovação', 'B2B', 'Sucesso do Cliente'];
  for (const name of retroSquads) {
    const slug = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    await prisma.squad.upsert({
      where: { companyId_slug: { companyId: DEFAULT_COMPANY_ID, slug } },
      update: {},
      create: { name, slug, companyId: DEFAULT_COMPANY_ID },
    });
  }

  // Setor interno + conta SUPER_ADMIN (equipe interna). Credenciais de dev
  // apenas — nunca usadas em produção (o seed não roda lá, ver assertLocalDatabase).
  const internalSector = await prisma.sector.upsert({
    where: { companyId_slug: { companyId: INTERNAL_COMPANY_ID, slug: "interno" } },
    update: {},
    create: { name: "Interno", slug: "interno", companyId: INTERNAL_COMPANY_ID, enabledFeatures: [] },
  });
  await prisma.user.upsert({
    where: { email: "super-admin@legends.internal" },
    update: {},
    create: {
      name: "Super Admin",
      email: "super-admin@legends.internal",
      passwordHash,
      role: "SUPER_ADMIN",
      sectorId: internalSector.id,
      companyId: INTERNAL_COMPANY_ID,
    },
  });

  // Conteúdo inicial da área de Cultura, transcrito do protótipo do PBI 22226.
  // É ponto de partida para o G&G: tudo é editável no admin, sem deploy.
  const manifesto = await prisma.culturePage.findFirst({
    where: { slug: "manifesto", companyId: DEFAULT_COMPANY_ID },
  });
  if (manifesto) {
    await prisma.culturePage.update({
      where: { id: manifesto.id },
      data: { title: MANIFESTO_TITLE, subtitle: MANIFESTO_SUBTITLE, body: MANIFESTO_BODY, published: true },
    });
  } else {
    await prisma.culturePage.create({
      data: {
        slug: "manifesto",
        title: MANIFESTO_TITLE,
        subtitle: MANIFESTO_SUBTITLE,
        body: MANIFESTO_BODY,
        published: true,
        companyId: DEFAULT_COMPANY_ID,
      },
    });
  }

  for (const [index, benefit] of BENEFITS_SEED.entries()) {
    const existing = await prisma.cultureBenefit.findFirst({
      where: { title: benefit.title, companyId: DEFAULT_COMPANY_ID },
    });
    if (existing) {
      await prisma.cultureBenefit.update({ where: { id: existing.id }, data: { ...benefit, order: index } });
    } else {
      await prisma.cultureBenefit.create({
        data: { ...benefit, order: index, companyId: DEFAULT_COMPANY_ID },
      });
    }
  }

  // Manuais não entram no seed: dependem do PDF real, subido pelo admin.

  // Catálogo inicial de Aprendizado. A autoria de curso é do CMS (PBI #22272);
  // isto aqui é só semente de desenvolvimento, para o catálogo não nascer vazio.
  // Catálogo do curso (Documento 4, 9.6 e 9.7): categoria, competência e
  // instrutor viraram cadastro, então o seed cadastra antes de ligar.
  const slugDe = (nome: string) =>
    nome
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  const categoriaPorNome = new Map<string, string>();
  for (const nome of new Set(LEARNING_SEED.map((c) => c.category))) {
    const row = await prisma.courseCategory.upsert({
      where: { companyId_slug: { companyId: DEFAULT_COMPANY_ID, slug: slugDe(nome) } },
      create: { name: nome, slug: slugDe(nome), companyId: DEFAULT_COMPANY_ID },
      update: {},
    });
    categoriaPorNome.set(nome, row.id);
  }

  const competenciaPorNome = new Map<string, string>();
  for (const nome of new Set(LEARNING_SEED.flatMap((c) => c.competencies))) {
    const row = await prisma.competency.upsert({
      where: { companyId_slug: { companyId: DEFAULT_COMPANY_ID, slug: slugDe(nome) } },
      create: { name: nome, slug: slugDe(nome), companyId: DEFAULT_COMPANY_ID },
      update: {},
    });
    competenciaPorNome.set(nome, row.id);
  }

  const instrutorPorNome = new Map<string, string>();
  for (const nome of new Set(LEARNING_SEED.map((c) => c.instructorName))) {
    const existente = await prisma.instructor.findFirst({
      where: { name: nome, companyId: DEFAULT_COMPANY_ID },
    });
    const row =
      existente ??
      (await prisma.instructor.create({ data: { name: nome, companyId: DEFAULT_COMPANY_ID } }));
    instrutorPorNome.set(nome, row.id);
  }

  for (const [courseIndex, course] of LEARNING_SEED.entries()) {
    const saved = await prisma.course.upsert({
      where: { slug_companyId: { slug: course.slug, companyId: DEFAULT_COMPANY_ID } },
      update: {},
      create: {
        slug: course.slug,
        title: course.title,
        shortDescription: course.shortDescription,
        description: course.description,
        categoryId: categoriaPorNome.get(course.category) ?? null,
        level: course.level,
        objectives: course.objectives,
        mandatory: course.mandatory,
        // `published Boolean` virou o ciclo de vida `CourseStatus` (só PUBLISHED
        // aparece para o aluno). O seed tinha ficado para trás e derrubava o
        // `db:seed` inteiro aqui, antes de qualquer coisa depois deste bloco.
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - courseIndex * 86_400_000),
        companyId: DEFAULT_COMPANY_ID,
      },
    });

    const alreadySeeded = await prisma.courseModule.count({ where: { courseId: saved.id } });
    if (alreadySeeded > 0) continue;

    await prisma.courseCompetency.createMany({
      data: course.competencies.flatMap((nome) => {
        const competencyId = competenciaPorNome.get(nome);
        return competencyId ? [{ courseId: saved.id, competencyId }] : [];
      }),
      skipDuplicates: true,
    });
    const instructorId = instrutorPorNome.get(course.instructorName);
    if (instructorId) {
      await prisma.courseInstructor.createMany({
        data: [{ courseId: saved.id, instructorId }],
        skipDuplicates: true,
      });
    }

    for (const [moduleIndex, mod] of course.modules.entries()) {
      const savedModule = await prisma.courseModule.create({
        data: {
          courseId: saved.id,
          title: mod.title,
          sortOrder: moduleIndex,
          companyId: DEFAULT_COMPANY_ID,
        },
      });
      for (const [lessonIndex, lesson] of mod.lessons.entries()) {
        await prisma.courseLesson.create({
          data: {
            courseId: saved.id,
            moduleId: savedModule.id,
            title: lesson.title,
            contentBlocks: lesson.blocks,
            durationMinutes: lesson.durationMinutes,
            sortOrder: lessonIndex,
            companyId: DEFAULT_COMPANY_ID,
          },
        });
      }
    }
  }

  for (const [trackIndex, track] of LEARNING_TRACKS_SEED.entries()) {
    const existing = await prisma.learningTrack.findFirst({
      where: { title: track.title, companyId: DEFAULT_COMPANY_ID },
    });
    if (existing) continue;
    const savedTrack = await prisma.learningTrack.create({
      data: {
        title: track.title,
        description: track.description,
        category: track.category,
        competencies: track.competencies,
        sortOrder: trackIndex,
        published: true,
        companyId: DEFAULT_COMPANY_ID,
      },
    });
    for (const [index, slug] of track.courseSlugs.entries()) {
      const course = await prisma.course.findUnique({
        where: { slug_companyId: { slug, companyId: DEFAULT_COMPANY_ID } },
      });
      if (!course) continue;
      await prisma.learningTrackCourse.create({
        data: { trackId: savedTrack.id, courseId: course.id, sortOrder: index, companyId: DEFAULT_COMPANY_ID },
      });
    }
  }

  // Catálogo de tópicos sugeridos do 1:1. Idempotente pela contagem — o admin
  // pode editar/apagar livremente depois que o seed roda a primeira vez.
  const jaTemTopicos = await prisma.oneOnOneTopicTemplate.count({
    where: { companyId: DEFAULT_COMPANY_ID },
  });
  if (jaTemTopicos === 0) {
    await prisma.oneOnOneTopicTemplate.createMany({
      data: DEFAULT_ONE_ON_ONE_TOPICS.map((topic, index) => ({
        theme: topic.theme,
        text: topic.text,
        sortOrder: index,
        companyId: DEFAULT_COMPANY_ID,
      })),
    });
  }

  // As dez categorias do Calendário Endomarketing. Idempotente pelo par
  // (companyId, slug), que é a unique do modelo — o admin pode renomear ou
  // repintar depois sem que o seed desfaça.
  for (const categoria of CALENDAR_EVENT_CATEGORIES) {
    await prisma.calendarEventType.upsert({
      where: { companyId_slug: { companyId: DEFAULT_COMPANY_ID, slug: categoria.slug } },
      update: {},
      create: {
        name: categoria.label,
        slug: categoria.slug,
        icon: categoria.icon,
        color: categoria.color,
        companyId: DEFAULT_COMPANY_ID,
      },
    });
  }

  // Base de conhecimento e persona da Emily, transcritas do prompt do
  // protótipo "Portal EMR" — só para a EMR, mesmo critério do bloco de
  // acolhimento emocional em `agent-service.ts` (gate por `Company.slug`).
  // Idempotente por pergunta: o G&G pode editar ou apagar depois que o seed
  // roda a primeira vez, sem que uma nova rodada desfaça a curadoria.
  const autorConhecimento = await prisma.user.findFirstOrThrow({
    where: { companyId: DEFAULT_COMPANY_ID },
    orderBy: { createdAt: "asc" },
  });
  for (const entrada of EMILY_KNOWLEDGE_SEED) {
    const jaExiste = await prisma.knowledgeEntry.findFirst({
      where: { companyId: DEFAULT_COMPANY_ID, question: entrada.question },
    });
    if (!jaExiste) {
      await prisma.knowledgeEntry.create({
        data: { ...entrada, companyId: DEFAULT_COMPANY_ID, createdById: autorConhecimento.id },
      });
    }
  }
  // Chave precisa bater com `PERSONA_NAME_KEY` em
  // `src/services/assistant-persona-service.ts`. `update: {}` não sobrescreve
  // um nome que o admin já tenha trocado manualmente.
  await prisma.appSetting.upsert({
    where: { key_companyId: { key: "assistant_persona_name", companyId: DEFAULT_COMPANY_ID } },
    update: {},
    create: { key: "assistant_persona_name", companyId: DEFAULT_COMPANY_ID, value: EMILY_PERSONA_NAME },
  });

  await seedApprentice();

  console.log(
    `Seed concluído. ${devs.length + leads.length} usuários criados.`,
  );
}

/**
 * Trilha Eu Aprendiz — turmas, os seis encontros, as fichas e o contrato.
 *
 * Só cria o que ainda não existe: o painel edita tudo isso, e rodar o seed de
 * novo não pode desfazer o ajuste que a G&G fez na véspera do encontro.
 */
async function seedApprentice() {
  for (const turma of APPRENTICE_CLASSES_SEED) {
    const existing = await prisma.apprenticeClass.findFirst({
      where: { companyId: DEFAULT_COMPANY_ID, name: turma.name },
    });
    if (!existing) {
      await prisma.apprenticeClass.create({
        data: { companyId: DEFAULT_COMPANY_ID, name: turma.name, shift: turma.shift },
      });
    }
  }

  for (const meeting of APPRENTICE_MEETINGS_SEED) {
    let row = await prisma.apprenticeMeeting.findFirst({
      where: { companyId: DEFAULT_COMPANY_ID, order: meeting.order },
    });
    if (!row) {
      row = await prisma.apprenticeMeeting.create({
        data: {
          companyId: DEFAULT_COMPANY_ID,
          order: meeting.order,
          title: meeting.title,
          theme: meeting.theme,
          objectives: meeting.objectives,
          deliverable: meeting.deliverable,
          scheduledOn: new Date(`${meeting.scheduledOn}T00:00:00.000Z`),
          // O primeiro encontro nasce liberado; os demais, o facilitador abre.
          accessReleased: meeting.order === 1,
        },
      });
    }

    for (const activity of meeting.activities) {
      const found = await prisma.apprenticeActivity.findFirst({
        where: { companyId: DEFAULT_COMPANY_ID, meetingId: row.id, title: activity.title },
      });
      if (found) continue;
      await prisma.apprenticeActivity.create({
        data: {
          companyId: DEFAULT_COMPANY_ID,
          meetingId: row.id,
          title: activity.title,
          kind: activity.kind,
          order: activity.order,
          schema: activity.schema as object,
        },
      });
    }
  }

  const contract = await prisma.apprenticeContract.findFirst({
    where: { companyId: DEFAULT_COMPANY_ID },
  });
  if (!contract) {
    await prisma.apprenticeContract.create({
      data: { companyId: DEFAULT_COMPANY_ID, clauses: APPRENTICE_CONTRACT_SEED },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
