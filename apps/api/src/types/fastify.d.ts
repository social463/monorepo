import '@fastify/jwt'
import type { FastifyReply, FastifyRequest } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdminOrSubadmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireSuperAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireFeature: (key: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireSectorFeature: (key: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // `adminAccess` é opcional dos dois lados. Na leitura, porque token emitido
    // antes deste deploy não tem o claim e continua válido por até 15 minutos;
    // na assinatura, porque ausente significa "sem acesso delegado", que é o
    // padrão. Quem garante o claim em produção é `AccessTokenPayload`
    // (`lib/jwt.ts`), onde ele é obrigatório.
    payload: { sub: string; role: string; sectorId: string; companyId: string; features: string[]; adminAccess?: boolean }
    user: { sub: string; role: string; sectorId: string; companyId: string; features: string[]; adminAccess?: boolean }
  }
}
