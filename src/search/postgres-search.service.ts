import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SearchMessagesDto, SearchSortOrder } from './dto/search-messages.dto';
import { SearchUsersDto } from './dto/search-users.dto';
import { SearchRoomsDto } from './dto/search-rooms.dto';

@Injectable()
export class PostgresSearchService {
  private readonly logger = new Logger(PostgresSearchService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Full-text message search via tsvector ────────────

  async searchMessages(dto: SearchMessagesDto, accessibleRoomIds: string[]) {
    this.logger.debug(`PG fallback search: "${dto.query}"`);

    const limit = dto.limit ?? 20;
    const offset = dto.offset ?? 0;

    // Build room filter
    const roomFilter = dto.roomId
      ? [dto.roomId].filter((id) => accessibleRoomIds.includes(id))
      : accessibleRoomIds;

    if (roomFilter.length === 0) {
      return { data: [], total: 0, source: 'postgres' };
    }

    // Convert room IDs array to a format safe for raw SQL
    const roomIdList = roomFilter.map((id) => `'${id}'::uuid`).join(',');

    const orderClause =
      dto.sort === SearchSortOrder.NEWEST
        ? 'ORDER BY m.created_at DESC'
        : dto.sort === SearchSortOrder.OLDEST
          ? 'ORDER BY m.created_at ASC'
          : 'ORDER BY rank DESC, m.created_at DESC';

    const dateFilter = [
      dto.after ? `AND m.created_at > '${dto.after}'::timestamptz` : '',
      dto.before ? `AND m.created_at < '${dto.before}'::timestamptz` : '',
      dto.senderId ? `AND m.sender_id = '${dto.senderId}'::uuid` : '',
      !dto.includeThreads ? 'AND m.parent_id IS NULL' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const results = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        m.id,
        m.room_id        AS "roomId",
        m.sender_id      AS "senderId",
        m.parent_id      AS "parentId",
        m.content,
        m.type,
        m.is_edited      AS "isEdited",
        m.is_deleted     AS "isDeleted",
        m.reply_count    AS "replyCount",
        m.created_at     AS "createdAt",
        m.updated_at     AS "updatedAt",
        ts_rank_cd(
          m.content_search,
          plainto_tsquery('english', $1),
          32
        )                AS rank,
        ts_headline(
          'english',
          COALESCE(m.content, ''),
          plainto_tsquery('english', $1),
          'MaxWords=25, MinWords=8, ShortWord=3, StartSel=<mark>, StopSel=</mark>, HighlightAll=false'
        )                AS headline,
        u.username       AS "senderUsername",
        u.display_name   AS "senderDisplayName",
        u.avatar_url     AS "senderAvatarUrl"
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE
        m.room_id IN (${roomIdList})
        AND m.is_deleted = false
        AND m.content_search @@ plainto_tsquery('english', $1)
        ${dateFilter}
      ${orderClause}
      LIMIT $2
      OFFSET $3
    `,
      dto.query,
      limit,
      offset,
    );

    // Get total count (separate query for performance)
    const countResult = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `
      SELECT COUNT(*) AS count
      FROM messages m
      WHERE
        m.room_id IN (${roomIdList})
        AND m.is_deleted = false
        AND m.content_search @@ plainto_tsquery('english', $1)
        ${dateFilter}
    `,
      dto.query,
    );

    const total = Number(countResult[0]?.count ?? 0);

    return {
      data: results.map((r) => ({
        ...r,
        _highlight: { content: [r.headline] },
        _source: 'postgres',
        sender: {
          id: r.senderId,
          username: r.senderUsername,
          displayName: r.senderDisplayName,
          avatarUrl: r.senderAvatarUrl,
        },
      })),
      total,
      source: 'postgres' as const,
    };
  }

  // ─── User search via ILIKE ────────────────────────────

  async searchUsers(dto: SearchUsersDto) {
    const limit = dto.limit ?? 10;
    const pattern = `%${dto.query}%`;

    const users = await this.prisma.$queryRaw<any[]>`
      SELECT
        u.id,
        u.username,
        u.email,
        u.display_name   AS "displayName",
        u.avatar_url     AS "avatarUrl",
        u.bio,
        u.status,
        u.is_verified    AS "isVerified",
        u.created_at     AS "createdAt",
        CASE
          WHEN u.username ILIKE ${dto.query + '%'} THEN 2
          WHEN u.display_name ILIKE ${dto.query + '%'} THEN 1
          ELSE 0
        END AS rank
      FROM users u
      WHERE
        u.username ILIKE ${pattern}
        OR u.display_name ILIKE ${pattern}
      ORDER BY rank DESC, u.username ASC
      LIMIT ${limit}
    `;

    return {
      data: users,
      total: users.length,
      source: 'postgres' as const,
    };
  }

  // ─── Room search via ILIKE ────────────────────────────

  async searchRooms(dto: SearchRoomsDto, userId: string) {
    const limit = dto.limit ?? 10;
    const pattern = `%${dto.query}%`;

    const rooms = await this.prisma.$queryRaw<any[]>`
      SELECT
        r.id,
        r.type,
        r.name,
        r.slug,
        r.description,
        r.icon_url        AS "iconUrl",
        r.is_private      AS "isPrivate",
        r.is_archived     AS "isArchived",
        r.last_message_at AS "lastMessageAt",
        r.created_at      AS "createdAt",
        COUNT(DISTINCT rm.user_id) AS "memberCount",
        CASE
          WHEN r.name ILIKE ${dto.query + '%'} THEN 2
          ELSE 1
        END AS rank
      FROM rooms r
      LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.left_at IS NULL
      WHERE
        r.type != 'dm'
        AND r.is_archived = false
        AND (
          r.is_private = false
          OR EXISTS (
            SELECT 1 FROM room_members
            WHERE room_id = r.id
            AND user_id = ${userId}::uuid
            AND left_at IS NULL
          )
        )
        AND (
          r.name ILIKE ${pattern}
          OR r.description ILIKE ${pattern}
        )
        ${dto.type ? `AND r.type = '${dto.type}'` : ''}
      GROUP BY r.id
      ORDER BY rank DESC, r.last_message_at DESC NULLS LAST
      LIMIT ${limit}
    `;

    return {
      data: rooms.map((r) => ({
        ...r,
        memberCount: Number(r.memberCount),
      })),
      total: rooms.length,
      source: 'postgres' as const,
    };
  }
}
