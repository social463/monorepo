/**
 * Base de conhecimento e nome da persona "Emily", transcritos do prompt do
 * protótipo "Portal EMR" (edge function `emily-chat`, ver spec do PBI de
 * origem). Ponto de partida para o time de Gente & Gestão — tudo aqui é
 * editável em Administração › Base de conhecimento, sem deploy.
 *
 * Só entra para a EMR (`DEFAULT_COMPANY_ID`, ver `prisma/seed.ts`): é
 * conteúdo real de uma empresa específica, não um dado genérico de produto.
 */

export const EMILY_PERSONA_NAME = "Emily"

export interface EmilyKnowledgeSeedEntry {
  category: string
  question: string
  answer: string
  keywords: string[]
}

export const EMILY_KNOWLEDGE_SEED: EmilyKnowledgeSeedEntry[] = [
  {
    category: "Salário e Contracheque",
    question: "Quando o salário é pago?",
    answer:
      "O salário dos colaboradores é pago até o terceiro dia útil de cada mês, por meio de depósito direto em conta no Banco Bradesco.",
    keywords: ["salario", "pagamento", "contracheque"],
  },
  {
    category: "Salário e Contracheque",
    question: "Como recebo meu contracheque?",
    answer:
      "O contracheque (holerite) é encaminhado por e-mail pelo Departamento Pessoal até o quinto dia útil do mês.",
    keywords: ["holerite", "contracheque", "dp"],
  },
  {
    category: "Alimentação e Home Office",
    question: "O auxílio-alimentação continua nas férias e na licença-maternidade?",
    answer: "Sim, o auxílio-alimentação é garantido mesmo durante períodos de férias e licença-maternidade.",
    keywords: ["ferias", "licenca-maternidade", "alimentacao"],
  },
  {
    category: "Alimentação e Home Office",
    question: "Qual o saldo do Vale Alimentação e onde posso usar?",
    answer:
      "O saldo do Vale Alimentação é de R$30,00 por dia, e pode ser utilizado em milhares de estabelecimentos físicos e online que aceitam iFood Benefícios, incluindo restaurantes, mercados, padarias e lanchonetes.",
    keywords: ["vale alimentacao", "va", "ifood"],
  },
  {
    category: "Alimentação e Home Office",
    question: "Tenho direito a auxílio home office?",
    answer:
      "Colaboradores CLT em regime de trabalho remoto/híbrido contam com auxílio home office de R$ 150,00 mensais, depositado no Saldo Livre do iFood Benefícios.",
    keywords: ["home office", "auxilio"],
  },
  {
    category: "Alimentação e Home Office",
    question: "Quando o saldo dos benefícios é creditado?",
    answer: "O saldo dos benefícios é creditado até o último dia de cada mês.",
    keywords: ["beneficios", "credito"],
  },
  {
    category: "Alimentação e Home Office",
    question: "Tive um problema com o cartão ou o aplicativo de benefícios, o que fazer?",
    answer: "Entre em contato com o Departamento Pessoal.",
    keywords: ["cartao", "aplicativo", "problema"],
  },
  {
    category: "Saúde e Bem-Estar",
    question: "Como funciona o plano de saúde e odontológico?",
    answer:
      "Disponível para colaboradores CLT após 45 dias da admissão, mediante solicitação ao Departamento Pessoal. Na Região Metropolitana do Recife é a Unimed Recife; nos demais estados, Amil. O pagamento é direto em folha: titular 50% empresa / 50% colaborador, e dependentes legais têm o valor integral custeado pelo colaborador (consulte o DP). O plano Amil tem coparticipação — confirme valores e regras com o DP.",
    keywords: ["plano de saude", "odontologico", "unimed", "amil"],
  },
  {
    category: "Saúde e Bem-Estar",
    question: "O que é o Gympass/Wellhub?",
    answer:
      "Plataforma de saúde e bem-estar com academias, estúdios, aulas online e aplicativos de meditação, nutrição, treinos em casa e terapia online. O acesso é feito com o e-mail corporativo, e adesão, alteração ou cancelamento são feitos direto pelo aplicativo, de forma simples e autônoma.",
    keywords: ["gympass", "wellhub", "academia"],
  },
  {
    category: "Saúde e Bem-Estar",
    question: "O que é a Starbem e quais benefícios ela oferece?",
    answer:
      "Plataforma de telemedicina que conecta o colaborador a diversos especialistas da saúde, com acesso pelo portal ou aplicativo (e-mail corporativo) e atendimento 24 horas por dia, 7 dias por semana, inclusive feriados. Inclui 2 teleconsultas por mês (1 com médico especialista e 1 com nutricionista) e 2 teleconsultas de apoio psicológico focadas em saúde mental e bem-estar.",
    keywords: ["starbem", "telemedicina", "psicologia", "saude mental"],
  },
  {
    category: "Saúde e Bem-Estar",
    question: "O que é a Avus?",
    answer:
      "Plataforma de benefícios em saúde com acesso a rede credenciada em todo o Brasil. Permite agendar consultas, realizar teleatendimentos e acessar serviços médicos e laboratoriais, com até 80% de desconto em farmácias, até 70% em consultas presenciais e exames laboratoriais, e até 4 dependentes gratuitos (amigos ou familiares).",
    keywords: ["avus", "desconto", "farmacia"],
  },
  {
    category: "Benefícios Corporativos",
    question: "O que é o Clube de Vantagens?",
    answer:
      "É o Clube de Vantagens da Sólides, com cashback e cupons de desconto em diversos sites e lojas. Há também parcerias com Sesc, Veneza Water Park, Descomplica e outras instituições — a lista completa de parceiros está no Portal do G&G, no Notion.",
    keywords: ["clube de vantagens", "solides", "desconto"],
  },
  {
    category: "Licenças e Retorno",
    question: "Como funciona o Retorno Maternar?",
    answer: "Após a licença-maternidade, a colaboradora tem redução de 4 horas na jornada por 2 meses.",
    keywords: ["maternidade", "retorno maternar"],
  },
  {
    category: "Licenças e Retorno",
    question: "Como funciona o Retorno Paternar?",
    answer:
      "Após a licença-paternidade de 15 dias, o colaborador tem redução de 4 horas diárias na jornada por 15 dias corridos.",
    keywords: ["paternidade", "retorno paternar"],
  },
  {
    category: "Licenças e Retorno",
    question: "O que é o Oh Happy Day?",
    answer:
      "No aniversário dos filhos até 14 anos e 11 meses, o colaborador tem meia jornada de trabalho (8h às 13h ou 13h às 18h), com comunicação prévia à gestão e ao Departamento Pessoal.",
    keywords: ["oh happy day", "filhos", "aniversario"],
  },
  {
    category: "Licenças e Retorno",
    question: "A empresa tem alguma ação para quem vai casar?",
    answer:
      "Sim: os noivos recebem um par de toalhas personalizadas bordadas com as iniciais do casal. Para participar, procure o time de Gente e Gestão.",
    keywords: ["casamento", "noivos"],
  },
  {
    category: "Datas Comemorativas",
    question: "O que ganho no meu aniversário?",
    answer:
      "Day Off (dia inteiro de folga) + bolo. Se o aniversário cair em fim de semana ou feriado, a folga é no próximo dia útil.",
    keywords: ["aniversario", "day off"],
  },
  {
    category: "Datas Comemorativas",
    question: "O que é o Day Office, no aniversário de empresa?",
    answer:
      "No aniversário de empresa, o colaborador ganha um Day Office (dia de descanso + mimo especial), que pode ser usufruído em até 30 dias a partir da data. É preciso alinhar com o gestor e comunicar o DP com 2 dias de antecedência.",
    keywords: ["day office", "aniversario de empresa"],
  },
  {
    category: "Indicação de Vagas",
    question: "Como funciona o Programa Indicação Valiosa?",
    answer:
      "Permite indicar candidatos para vagas específicas divulgadas oficialmente, com premiação de até R$ 500,00 conforme a complexidade da vaga. Vale exclusivamente para vagas divulgadas no template oficial e nos canais oficiais, e o prêmio é concedido após o candidato ser admitido e efetivado, depois do período de experiência. Cadastro de candidatos em https://eu-medico-residente.vagas.solides.com.br/.",
    keywords: ["indicacao valiosa", "vagas", "premiacao"],
  },
  {
    category: "Apoio Emocional",
    question: "Estou passando por um momento difícil, com quem posso falar?",
    answer:
      "Você não precisa lidar com isso sozinho. Para rotina, prioridades ou carga de trabalho, fale com sua liderança imediata. Para acolhimento, escuta qualificada e orientação confidencial, procure o time de Gente e Gestão. Para apoio psicológico 24/7, use a Starbem pelo app ou portal, com o seu e-mail corporativo.",
    keywords: ["apoio emocional", "saude mental", "acolhimento"],
  },
  {
    category: "Direcionamento de Dúvidas",
    question: "Quem eu procuro para dúvidas sobre benefícios e folha de pagamento?",
    answer: "Brenna Oliveira, do time de Gente e Gestão.",
    keywords: ["duvidas", "beneficios", "folha de pagamento"],
  },
  {
    category: "Direcionamento de Dúvidas",
    question: "Quem eu procuro sobre equipamentos de trabalho ou nota fiscal?",
    answer: "Ianna Lima, da Estratégia e Finanças.",
    keywords: ["equipamentos", "nota fiscal"],
  },
  {
    category: "Direcionamento de Dúvidas",
    question: "Quem eu procuro sobre vagas na EMR?",
    answer: "Solane Campos, do time de Gente e Gestão.",
    keywords: ["vagas", "recrutamento"],
  },
  {
    category: "Direcionamento de Dúvidas",
    question: "Quem eu procuro sobre desenvolvimento e treinamento?",
    answer: "Mariana Venâncio, do time de Gente e Gestão.",
    keywords: ["desenvolvimento", "treinamento"],
  },
  {
    category: "Direcionamento de Dúvidas",
    question: "Quem eu procuro sobre período de experiência ou avaliações?",
    answer: "Brenna Oliveira, do time de Gente e Gestão.",
    keywords: ["periodo de experiencia", "avaliacoes"],
  },
  {
    category: "Metas e Indicadores",
    question: "Onde vejo as metas da empresa?",
    answer:
      "Consulte a página inicial do Notion do EMR — lá estão as metas corporativas e os indicadores de cada setor.",
    keywords: ["metas", "indicadores", "notion"],
  },
  {
    category: "Metas e Indicadores",
    question: "Como funciona a campanha #TODOSPELOS9?",
    answer:
      "É uma iniciativa estratégica alinhada às metas da Inspirali até 2028, com o objetivo de alcançar a meta que viabiliza a distribuição de R$ 9 milhões em bonificação para colaboradores ativos, ligada ao EBITDA e ao CAPEX. A simulação individual está em https://todospelos9.app/login (login com e-mail corporativo, senha os 6 primeiros dígitos do CPF). O valor das cotas é S/5 × C + TC + AD/2 (Salário base, Cargo, Tempo de Casa, Avaliação de Desempenho). Dúvidas: Gerência de Estratégias e Finanças.",
    keywords: ["todospelos9", "bonificacao", "ebitda"],
  },
  {
    category: "Endereço",
    question: "Como atualizo meu endereço?",
    answer: "No Portal do G&G no Notion, em Formulários › Mudança de Endereço.",
    keywords: ["endereco", "mudanca"],
  },
  {
    category: "Desenvolvimento e Avaliações",
    question: "O que é o 1:1 (one a one)?",
    answer:
      "Encontro individual entre gestor e colaborador para alinhar expectativas, trocar percepções, oferecer feedbacks e apoiar o desenvolvimento. Deve acontecer no mínimo uma vez por mês.",
    keywords: ["1:1", "one a one", "gestor"],
  },
  {
    category: "Desenvolvimento e Avaliações",
    question: "O que é o PDI (Plano de Desenvolvimento Individual)?",
    answer:
      "É um plano personalizado construído entre colaborador e gestor, com foco no mapeamento de pontos fortes, oportunidades de desenvolvimento e ações práticas. É o próximo passo após a Avaliação de Desempenho, ou após o período de experiência para quem acabou de ser admitido.",
    keywords: ["pdi", "plano de desenvolvimento"],
  },
  {
    category: "Desenvolvimento e Avaliações",
    question: "Quando acontece a Avaliação de Experiência?",
    answer:
      "Aos 45 e 90 dias de admissão, pela plataforma ImpulseUp. Ela subsidia ações de gestão e oferece feedback sobre o processo de seleção.",
    keywords: ["avaliacao de experiencia", "impulseup"],
  },
  {
    category: "Desenvolvimento e Avaliações",
    question: "O que é a Avaliação de Performance (AP)?",
    answer:
      "É uma avaliação rápida, focada em identificar pontos de desenvolvimento, que ocorre semestralmente entre os ciclos da Avaliação de Desempenho (maio e dezembro).",
    keywords: ["avaliacao de performance", "ap"],
  },
  {
    category: "Desenvolvimento e Avaliações",
    question: "O que é a Avaliação de Desempenho (AD)?",
    answer:
      "É uma avaliação semestral que analisa aspectos técnicos e comportamentais, realizada em março e setembro, e verifica a evolução no desenvolvimento profissional e pessoal.",
    keywords: ["avaliacao de desempenho", "ad"],
  },
  {
    category: "Desenvolvimento e Avaliações",
    question: "O que é o Pulse Liderança?",
    answer:
      "É uma avaliação semestral das lideranças (março e setembro), em que as equipes avaliam suas lideranças e diretorias vinculadas.",
    keywords: ["pulse lideranca"],
  },
  {
    category: "Desenvolvimento e Avaliações",
    question: "Quando saem os resultados das avaliações?",
    answer: "Ficam disponíveis em até uma semana após o encerramento do ciclo, na plataforma ImpulseUp.",
    keywords: ["resultados", "avaliacoes", "impulseup"],
  },
  {
    category: "Treinamentos",
    question: "Onde encontro os treinamentos da EMR?",
    answer:
      "No Hub de Aprendizagem, na página inicial do Notion EMR. Para enviar seu certificado, use a seção \"Envie seu Certificado\", dentro do Hub de Aprendizagem.",
    keywords: ["treinamentos", "hub de aprendizagem", "certificado"],
  },
  {
    category: "Canais Oficiais",
    question: "Quais são os canais oficiais de comunicação da EMR?",
    answer:
      "Microsoft Teams para comunicação interna rápida e alinhamentos; e-mail corporativo para comunicações formais e decisões estratégicas; Notion EMR para documentação, políticas e indicadores; Portal do G&G para políticas, formulários e o PodFalaRH; e Google Meet para reuniões, treinamentos e entrevistas.",
    keywords: ["canais oficiais", "teams", "notion", "podfalarh"],
  },
  {
    category: "Canais Oficiais",
    question: "Onde encontro as políticas da empresa?",
    answer: "No Portal do G&G, acessível pela página principal do Notion EMR.",
    keywords: ["politicas", "portal g&g"],
  },
  {
    category: "Produtos EMR",
    question: "O que é o Extensivo Bases?",
    answer:
      "É o curso para quem está iniciando o internato (antigo 5º ano), que aborda os temas mais importantes e frequentes nas provas de residência e prepara para o ritmo mais intenso do 6º ano.",
    keywords: ["extensivo bases", "produto"],
  },
  {
    category: "Produtos EMR",
    question: "O que são os Extensivos Regionais?",
    answer:
      "São cursos por região, com videoaulas objetivas e resolução de questões, cobrindo as bancas de PE, CE, BA, PB, SP, MG, ENARE, R+CM e Nacional — ideais para quem está no 6º ano ou já se formou.",
    keywords: ["extensivo regional", "produto"],
  },
  {
    category: "Produtos EMR",
    question: "O que é o Extensivo Programado?",
    answer:
      "Combina o Extensivo Bases com o Extensivo Regional, com duração de 2 anos, do 5º ano até a prova de residência.",
    keywords: ["extensivo programado", "produto"],
  },
  {
    category: "Residência Médica",
    question: "O que é a Residência Médica?",
    answer:
      "É uma modalidade de pós-graduação para médicos, gerenciada pelo MEC e regida pela CNRM, com prova teórica de múltipla escolha (clínica médica, cirurgia, pediatria, GO, preventiva). Dura em média 2 anos — algumas especialidades, como neurocirurgia, chegam a 5. R1 é o 1º ano (Acesso Direto), R2 o 2º e R3 o 3º; o Acesso R+ é a subespecialidade — por exemplo, após Cirurgia Geral, prestar Cirurgia Plástica equivale a R4.",
    keywords: ["residencia medica", "r1", "r2", "r3"],
  },
  {
    category: "Residência Médica",
    question: "O que é o ENAMED?",
    answer:
      "O Exame Nacional de Avaliação da Formação Médica avalia competências, conhecimentos e habilidades dos estudantes concluintes de Medicina, com o objetivo de avaliar a formação médica, apoiar a melhoria da qualidade dos cursos e produzir dados para políticas públicas.",
    keywords: ["enamed"],
  },
  {
    category: "Onboarding",
    question: "Como funciona o plano de 90 dias de onboarding?",
    answer:
      "É uma prática de onboarding estratégico para acelerar resultados, que auxilia na integração, na compreensão do contexto organizacional e na construção de relacionamentos. Dúvidas sobre a construção do plano: Solane Campos.",
    keywords: ["onboarding", "90 dias"],
  },
  {
    category: "Onboarding",
    question: "O que é o Anjo?",
    answer:
      "É a pessoa de apoio no início da jornada do novo colaborador — ajuda a compreender os processos do setor e acompanha o período de adaptação. O colaborador também pode procurar outras pessoas da empresa, além do Anjo.",
    keywords: ["anjo", "onboarding"],
  },
  {
    category: "Ponto",
    question: "Como registro meu ponto?",
    answer:
      "Exclusivamente pela plataforma Sólides: baixe o aplicativo no celular e faça login com o e-mail corporativo. É obrigatório para colaboradores CLT. Pela plataforma você acompanha o saldo de banco de horas, solicita ajustes de batidas e visualiza o histórico. Dificuldades técnicas: procure Brenna Oliveira, do time de Gente e Gestão.",
    keywords: ["ponto", "solides", "banco de horas"],
  },
  {
    category: "Ponto",
    question: "Quais são as boas práticas de registro de ponto?",
    answer:
      "Registre no início da jornada, na saída e no retorno dos intervalos, e na finalização da jornada. Hora extra deve ser combinada previamente com a liderança e registrada ao final da jornada.",
    keywords: ["boas praticas", "ponto", "hora extra"],
  },
  {
    category: "Férias",
    question: "Como funcionam as férias?",
    answer:
      "São programadas em conjunto com a liderança, respeitando o planejamento da área. O colaborador CLT pode usufruir após 1 ano de admissão. Formatos disponíveis: 30 dias corridos; 20 dias + 10 de abono pecuniário; 15+15 dias (podendo vender 5 em um dos períodos); ou 20+10 dias. O aviso de férias é enviado com 30 dias de antecedência, e o pagamento sai até 2 dias antes do início do período. Dúvidas: Brenna Oliveira, do time de Gente e Gestão.",
    keywords: ["ferias", "abono pecuniario"],
  },
  {
    category: "Bolsas de Estudo",
    question: "Como funciona o Programa de Bolsas de Estudos EMR?",
    answer:
      "É um programa para valorizar e incentivar o desenvolvimento contínuo, aberto a colaboradores CLT com no mínimo 3 meses de empresa e a dependentes legais (cônjuge, filhos, enteados). Os descontos vão de 70% a 90% em Graduação e Pós-graduação Lato Sensu, variando conforme o tipo de vínculo (titular/dependente) e a faixa salarial. Não é cumulativo com outros descontos, e é permitida uma bolsa ativa por vez por pessoa.",
    keywords: ["bolsa de estudos", "desconto", "graduacao"],
  },
]
