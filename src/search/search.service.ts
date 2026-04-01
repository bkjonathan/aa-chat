import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ElasticsearchService } from './elasticsearch.service';
import { PostgresSearchService } from './postgres-search.service';
import { PrismaService } from '../database/prisma.service';
import { RoomMembersService } from '../room/room-members.service';
import { SearchMessagesDto, SearchSortOrder } from './dto/search-messages.dto';
import { SearchUsersDto } from './dto/search-users.dto';
import { SearchRoomsDto } from './dto/search-rooms.dto';
import {
  SEARCH_EVENTS,
  MessageCreatedEvent,
  MessageUpdatedEvent,
  MessageDeletedEvent,
  UserCreatedEvent,
  UserUpdatedEvent,
  RoomCreatedEvent,
  RoomUpdatedEvent,
  RoomDeletedEvent,
} from './search.events';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private es: ElasticsearchService,
    private pgSearch: PostgresSearchService,
    private prisma: PrismaService,
    private roomMembersService: RoomMembersService,
  ) {}

  // ─── Message search ───────────────────────────────────

  async searchMessages(dto: SearchMessagesDto, requestingUserId: string) {
    // Get rooms this user can access
    const accessibleRoomIds =
      await this.roomMembersService.getUserRoomIds(requestingUserId);

    if (accessibleRoomIds.length === 0) {
      return { data: [], total: 0, took: 0, source: 'none' };
    }

    // Try Elasticsearch first
    if (this.es.isEnabled()) {
      try {
        return await this.searchMessagesElastic(dto, accessibleRoomIds);
      } catch (err) {
        this.logger.warn(
          'Elasticsearch message search failed — falling back to Postgres:',
          err.message,
        );
      }
    }

    // Fallback to PostgreSQL tsvector
    return this.pgSearch.searchMessages(dto, accessibleRoomIds);
  }

  private async searchMessagesElastic(
    dto: SearchMessagesDto,
    accessibleRoomIds: string[],
  ) {
    const roomFilter = dto.roomId
      ? [dto.roomId].filter((id) => accessibleRoomIds.includes(id))
      : accessibleRoomIds;

    if (roomFilter.length === 0) {
      return { data: [], total: 0, took: 0, source: 'elasticsearch' };
    }

    // Build bool query
    const must: any[] = [
      {
        multi_match: {
          query: dto.query,
          fields: ['content^3', 'content.suggest^1', 'senderUsername^2'],
          type: 'best_fields',
          fuzziness: 'AUTO',
          minimum_should_match: '75%',
        },
      },
    ];

    const filter: any[] = [
      { terms: { roomId: roomFilter } },
      { term: { isDeleted: false } },
    ];

    if (dto.senderId) filter.push({ term: { senderId: dto.senderId } });
    if (!dto.includeThreads) filter.push({ term: { parentId: null } });

    if (dto.after || dto.before) {
      const range: Record<string, string> = {};
      if (dto.after) range.gte = dto.after;
      if (dto.before) range.lte = dto.before;
      filter.push({ range: { createdAt: range } });
    }

    // Sort strategy
    const sort =
      dto.sort === SearchSortOrder.NEWEST
        ? [{ createdAt: 'desc' }]
        : dto.sort === SearchSortOrder.OLDEST
          ? [{ createdAt: 'asc' }]
          : ['_score', { createdAt: 'desc' }];

    const { hits, total, took } = await this.es.search(
      'messages',
      {
        bool: { must, filter },
      },
      {
        from: dto.offset ?? 0,
        size: dto.limit ?? 20,
        sort,
        highlight: {
          pre_tags: ['<mark>'],
          post_tags: ['</mark>'],
          fields: {
            content: {
              fragment_size: 150,
              number_of_fragments: 3,
              no_match_size: 150,
            },
          },
        },
      },
    );

    // Enrich with sender data from Postgres (ES doesn't store avatar etc.)
    const senderIds = [...new Set(hits.map((h: any) => h.senderId))];
    const senders = await this.prisma.user.findMany({
      where: { id: { in: senderIds } },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
    });
    const senderMap = Object.fromEntries(senders.map((s) => [s.id, s]));

    return {
      data: hits.map((hit: any) => ({
        ...hit,
        sender: senderMap[hit.senderId] ?? null,
      })),
      total,
      took,
      source: 'elasticsearch' as const,
    };
  }

  // ─── User search / autocomplete ───────────────────────

  async searchUsers(dto: SearchUsersDto) {
    if (this.es.isEnabled()) {
      try {
        return await this.searchUsersElastic(dto);
      } catch (err) {
        this.logger.warn('ES user search failed — falling back:', err.message);
      }
    }
    return this.pgSearch.searchUsers(dto);
  }

  private async searchUsersElastic(dto: SearchUsersDto) {
    const { hits, total, took } = await this.es.search(
      'users',
      {
        bool: {
          must: [
            {
              multi_match: {
                query: dto.query,
                fields: ['username^3', 'displayName^2', 'bio'],
                type: 'bool_prefix',
                fuzziness: 'AUTO',
              },
            },
          ],
          filter: [{ term: { isVerified: true } }],
          should: [
            {
              match_phrase_prefix: {
                username: { query: dto.query, boost: 2 },
              },
            },
          ],
        },
      },
      {
        size: dto.limit ?? 10,
        sort: ['_score', { 'username.raw': 'asc' }],
      },
    );

    return {
      data: hits,
      total,
      took,
      source: 'elasticsearch' as const,
    };
  }

  // ─── Room search / autocomplete ───────────────────────

  async searchRooms(dto: SearchRoomsDto, requestingUserId: string) {
    if (this.es.isEnabled()) {
      try {
        return await this.searchRoomsElastic(dto, requestingUserId);
      } catch (err) {
        this.logger.warn('ES room search failed — falling back:', err.message);
      }
    }
    return this.pgSearch.searchRooms(dto, requestingUserId);
  }

  private async searchRoomsElastic(
    dto: SearchRoomsDto,
    requestingUserId: string,
  ) {
    // Get user's accessible private rooms
    const memberRoomIds =
      await this.roomMembersService.getUserRoomIds(requestingUserId);

    const filter: any[] = [
      { term: { isArchived: false } },
      { terms: { type: ['group', 'channel'] } },
    ];

    if (dto.type) filter.push({ term: { type: dto.type } });

    const { hits, total, took } = await this.es.search(
      'rooms',
      {
        bool: {
          must: [
            {
              multi_match: {
                query: dto.query,
                fields: ['name^3', 'description^1'],
                type: 'best_fields',
                fuzziness: 'AUTO',
              },
            },
          ],
          filter,
          should: [
            { term: { isPrivate: false } },
            { terms: { id: memberRoomIds } },
          ],
          minimum_should_match: 1,
        },
      },
      {
        size: dto.limit ?? 10,
        sort: [
          '_score',
          { lastMessageAt: { order: 'desc', missing: '_last' } },
        ],
      },
    );

    return {
      data: hits,
      total,
      took,
      source: 'elasticsearch' as const,
    };
  }

  // ─── Reindex all data (admin / recovery tool) ─────────

  async reindexAll(): Promise<{
    messages: number;
    users: number;
    rooms: number;
  }> {
    this.logger.log('Starting full reindex...');

    const [messages, users, rooms] = await Promise.all([
      this.reindexMessages(),
      this.reindexUsers(),
      this.reindexRooms(),
    ]);

    this.logger.log(
      `Reindex complete: ${messages} messages, ${users} users, ${rooms} rooms`,
    );

    return { messages, users, rooms };
  }

  private async reindexMessages(): Promise<number> {
    const messages = await this.prisma.message.findMany({
      where: { isDeleted: false },
      include: {
        sender: { select: { username: true, displayName: true } },
      },
    });

    await this.es.reindexAll(
      'messages',
      messages.map((m) => ({
        id: m.id,
        doc: this.buildMessageDoc(m),
      })),
    );

    return messages.length;
  }

  private async reindexUsers(): Promise<number> {
    const users = await this.prisma.user.findMany({});

    await this.es.reindexAll(
      'users',
      users.map((u) => ({
        id: u.id,
        doc: this.buildUserDoc(u),
      })),
    );

    return users.length;
  }

  private async reindexRooms(): Promise<number> {
    const rooms = await this.prisma.room.findMany({
      where: { type: { not: 'dm' } },
      include: {
        _count: { select: { members: { where: { leftAt: null } } } },
      },
    });

    await this.es.reindexAll(
      'rooms',
      rooms.map((r) => ({
        id: r.id,
        doc: this.buildRoomDoc(r),
      })),
    );

    return rooms.length;
  }

  // ─── Event handlers for real-time indexing ────────────

  @OnEvent(SEARCH_EVENTS.MESSAGE_CREATED)
  async onMessageCreated(event: MessageCreatedEvent): Promise<void> {
    const doc = this.buildMessageDoc(event.message);
    await this.es.indexDocument('messages', event.message.id, doc);
  }

  @OnEvent(SEARCH_EVENTS.MESSAGE_UPDATED)
  async onMessageUpdated(event: MessageUpdatedEvent): Promise<void> {
    await this.es.updateDocument('messages', event.messageId, event.partial);
  }

  @OnEvent(SEARCH_EVENTS.MESSAGE_DELETED)
  async onMessageDeleted(event: MessageDeletedEvent): Promise<void> {
    await this.es.updateDocument('messages', event.messageId, {
      isDeleted: true,
      content: null,
    });
  }

  @OnEvent(SEARCH_EVENTS.USER_CREATED)
  async onUserCreated(event: UserCreatedEvent): Promise<void> {
    await this.es.indexDocument(
      'users',
      event.user.id,
      this.buildUserDoc(event.user),
    );
  }

  @OnEvent(SEARCH_EVENTS.USER_UPDATED)
  async onUserUpdated(event: UserUpdatedEvent): Promise<void> {
    await this.es.updateDocument('users', event.userId, event.partial);
  }

  @OnEvent(SEARCH_EVENTS.ROOM_CREATED)
  async onRoomCreated(event: RoomCreatedEvent): Promise<void> {
    await this.es.indexDocument(
      'rooms',
      event.room.id,
      this.buildRoomDoc(event.room),
    );
  }

  @OnEvent(SEARCH_EVENTS.ROOM_UPDATED)
  async onRoomUpdated(event: RoomUpdatedEvent): Promise<void> {
    await this.es.updateDocument('rooms', event.roomId, event.partial);
  }

  @OnEvent(SEARCH_EVENTS.ROOM_DELETED)
  async onRoomDeleted(event: RoomDeletedEvent): Promise<void> {
    await this.es.deleteDocument('rooms', event.roomId);
  }

  // ─── Document builders ────────────────────────────────

  private buildMessageDoc(message: any): Record<string, any> {
    return {
      id: message.id,
      roomId: message.roomId,
      senderId: message.senderId,
      senderUsername: message.sender?.username ?? message.senderUsername ?? '',
      senderDisplayName:
        message.sender?.displayName ?? message.senderDisplayName ?? null,
      content: message.content,
      type: message.type,
      parentId: message.parentId ?? null,
      isDeleted: message.isDeleted,
      isEdited: message.isEdited,
      replyCount: message.replyCount ?? 0,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  private buildUserDoc(user: any): Record<string, any> {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      status: user.status,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
    };
  }

  private buildRoomDoc(room: any): Record<string, any> {
    return {
      id: room.id,
      type: room.type,
      name: room.name,
      slug: room.slug,
      description: room.description,
      isPrivate: room.isPrivate,
      isArchived: room.isArchived,
      memberCount: room._count?.members ?? room.memberCount ?? 0,
      lastMessageAt: room.lastMessageAt,
      createdAt: room.createdAt,
    };
  }
}
