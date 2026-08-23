import { putS3Object, s3Config } from './s3-client'

/** O storage de certificado está disponível? (sem ele, o PNG simplesmente não é gerado) */
export function certificateStorageEnabled(): boolean {
  return s3Config() !== null
}

/** Chave do objeto no bucket: certificates/<companyId>/<code>.png. */
export function certificateKey(companyId: string, code: string): string {
  return `certificates/${companyId}/${code}.png`
}

/** Envia o PNG do certificado para o S3 e devolve a URL pública final. */
export async function saveCertificatePng(companyId: string, code: string, png: Buffer): Promise<string> {
  if (!s3Config()) throw new Error('S3 não configurado')
  return putS3Object({ key: certificateKey(companyId, code), contentType: 'image/png', body: png })
}
