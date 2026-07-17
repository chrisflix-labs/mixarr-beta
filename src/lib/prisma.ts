import { PrismaClient } from '@prisma/client'
import './jsonSerialization'
import { countPlaylistGenerationDatabaseQuery } from './playlistGenerationQueryMetrics'

const prismaClientSingleton = () => {
  return new PrismaClient()
}

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

const prismaWithMiddleware = prisma as typeof prisma & { __mixarrGenerationQueryMiddleware?: boolean }
if (!prismaWithMiddleware.__mixarrGenerationQueryMiddleware) {
  prisma.$use(async (_params, next) => {
    countPlaylistGenerationDatabaseQuery()
    return next(_params)
  })
  prismaWithMiddleware.__mixarrGenerationQueryMiddleware = true
}

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma
