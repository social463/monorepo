-- O certificado passa a herdar a identidade visual da empresa quando o modelo
-- não a define. Cor e logo nulos caem no branding.
--
-- Não converte nada: as linhas existentes mantêm a cor que já tinham, então
-- nenhum certificado muda de cara por causa desta migration. A herança vale
-- para o que for deixado em branco daqui em diante.
ALTER TABLE "CertificateTemplate" ALTER COLUMN "accentColor" DROP NOT NULL;
