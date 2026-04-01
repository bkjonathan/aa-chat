// Prisma 5+ removed $use() middleware in favour of Prisma Client Extensions.
// The replyCount increment/decrement logic has been moved directly into
// MessagesService.create() and MessagesService.softDelete() instead.
//
// This file is kept as a no-op so PrismaService.onModuleInit() compiles
// without changes; it can be deleted once the import is removed there.

import { PrismaClient } from '@prisma/client';

export function applyPrismaMiddleware(_prisma: PrismaClient): void {
  // intentionally empty — see comment above
}
