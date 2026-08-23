#!/usr/bin/env bash
#
# Aplica as migrations pendentes no banco de HOMOLOGAÇÃO.
#
# Existe porque o deployment do k8s não roda migration sozinho (falta
# `RUN_MIGRATIONS=true`): sem isto, o app novo sobe contra o schema velho e
# **toda** query que toca uma coluna nova quebra com P2022 — não é degradação
# parcial, é a tela inteira caindo.
#
# A URL de HML sai do `apps/api/.env` (a linha comentada), então nada de
# credencial passa por linha de comando nem fica no histórico do shell.
#
#   bash scripts/apply-hml-migrations.sh            # confere e pede confirmação
#   bash scripts/apply-hml-migrations.sh --check    # só confere, não aplica
#
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="apps/api/.env"
[ -f "$ENV_FILE" ] || { echo "❌ $ENV_FILE não encontrado"; exit 1; }

HML=$(grep -E '^# ?DATABASE_URL' "$ENV_FILE" | head -1 | sed -E 's/^# ?DATABASE_URL=//; s/^"//; s/"$//')
case "$HML" in
  *hml-dbs*) ;;
  *) echo "❌ A linha comentada de DATABASE_URL não aponta para HML. Abortando."; exit 1 ;;
esac

mask() { sed -E 's#(://)[^@]*@#\1***@#g'; }

echo "═══ 1. Estado atual do HML ═══"
(cd apps/api && DATABASE_URL="$HML" npx prisma migrate status 2>&1 || true) | mask | tail -12

echo
echo "═══ 2. Colisões que fariam a migration falhar no meio ═══"
COLISOES=$(psql "$HML" -tAc "
SELECT table_name||'.'||column_name FROM information_schema.columns
WHERE (table_name='CalendarEventType' AND column_name='color')
   OR (table_name='CalendarEvent' AND column_name IN ('endDate','endTime','color','audienceTags','isInternalComm'))
   OR (table_name='CorporatePost' AND column_name IN ('title','contentJson','status','audienceScope','editedAt'))
   OR (table_name='Feedback' AND column_name='customCategory')
UNION ALL
SELECT 'tabela '||table_name FROM information_schema.tables
WHERE table_name IN ('CorporatePostSector','CorporatePostAttachment','FeedbackRecipient',
                     'RecognitionCategory','FeedbackRecognitionCategory','FeedbackComment','MonthlyHighlight');")
if [ -n "$COLISOES" ]; then
  echo "❌ Já existe no banco (alguém rodou db push à mão?):"; echo "$COLISOES" | sed 's/^/   - /'
  echo "   Aplicar assim quebraria no meio. Resolva antes."
  exit 1
fi
echo "✅ nenhuma"

echo
echo "═══ 3. O que os backfills vão mexer ═══"
psql "$HML" -tAc "
SELECT '   FeedbackRecipient a criar (1 por feedback): '||count(*) FROM \"Feedback\"
UNION ALL SELECT '   CalendarEventType hoje: '||count(*) FROM \"CalendarEventType\"
UNION ALL SELECT '   empresas (recebem 10 categorias de calendário + as 13 competências do Mural): '||count(*) FROM \"Company\";"

if [ "${1:-}" = "--check" ]; then echo; echo "Só conferência (--check). Nada aplicado."; exit 0; fi

echo
read -r -p "Aplicar as migrations no HML agora? (digite 'aplicar') " RESP
[ "$RESP" = "aplicar" ] || { echo "Cancelado."; exit 1; }

echo
echo "═══ 4. Aplicando ═══"
(cd apps/api && DATABASE_URL="$HML" npx prisma migrate deploy 2>&1 | mask)

echo
echo "═══ 5. Conferência pós-migration ═══"
(cd apps/api && DATABASE_URL="$HML" npx prisma migrate status 2>&1 || true) | mask | tail -4
psql "$HML" -tAc "
SELECT '   Feedback sem destinatário (esperado 0): '||count(*)
  FROM \"Feedback\" f LEFT JOIN \"FeedbackRecipient\" r ON r.\"feedbackId\"=f.\"id\" WHERE r.\"id\" IS NULL
UNION ALL SELECT '   CorporatePost com status: '||count(*) FROM \"CorporatePost\" WHERE status IS NOT NULL
UNION ALL SELECT '   categorias de calendário: '||count(*) FROM \"CalendarEventType\"
UNION ALL SELECT '   competências do Mural: '||count(*) FROM \"RecognitionCategory\"
UNION ALL SELECT '   empresas ainda sem competência (esperado 0): '||count(*) FROM \"Company\" c
  WHERE NOT EXISTS (SELECT 1 FROM \"RecognitionCategory\" r WHERE r.\"companyId\" = c.\"id\")
UNION ALL SELECT '   migrations falhas (esperado 0): '||count(*)
  FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;"

echo
echo "✅ Pronto. As competências de reconhecimento agora entram por MIGRATION"
echo "   (20260818090000): toda empresa que estava com zero recebe as 13 do"
echo "   documento. Quem já curou o próprio catálogo não é tocado."
