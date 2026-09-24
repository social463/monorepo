-- Marcação "Novo" no Mural de Feedbacks da Home (Documento 3, seção 9.3).
--
-- Coluna nullable de propósito: quem nunca abriu a aba tem NULL e vê tudo como
-- novo, que é o comportamento correto para quem chega. Um DEFAULT now() faria
-- toda a base existente nascer "em dia" com feedbacks que ninguém leu.
ALTER TABLE "User" ADD COLUMN "feedbackWallSeenAt" TIMESTAMP(3);
