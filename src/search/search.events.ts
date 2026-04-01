export const SEARCH_EVENTS = {
  MESSAGE_CREATED: 'search.message.created',
  MESSAGE_UPDATED: 'search.message.updated',
  MESSAGE_DELETED: 'search.message.deleted',
  USER_CREATED: 'search.user.created',
  USER_UPDATED: 'search.user.updated',
  ROOM_CREATED: 'search.room.created',
  ROOM_UPDATED: 'search.room.updated',
  ROOM_DELETED: 'search.room.deleted',
} as const;

export class MessageCreatedEvent {
  constructor(
    public readonly message: {
      id: string;
      roomId: string;
      senderId: string;
      senderUsername: string;
      senderDisplayName: string | null;
      content: string | null;
      type: string;
      parentId: string | null;
      isDeleted: boolean;
      isEdited: boolean;
      replyCount: number;
      createdAt: Date;
      updatedAt: Date;
    },
  ) {}
}

export class MessageUpdatedEvent {
  constructor(
    public readonly messageId: string,
    public readonly partial: {
      content?: string | null;
      isEdited?: boolean;
      isDeleted?: boolean;
      replyCount?: number;
    },
  ) {}
}

export class MessageDeletedEvent {
  constructor(public readonly messageId: string) {}
}

export class UserCreatedEvent {
  constructor(
    public readonly user: {
      id: string;
      username: string;
      email: string;
      displayName: string | null;
      bio: string | null;
      avatarUrl: string | null;
      status: string;
      isVerified: boolean;
      createdAt: Date;
    },
  ) {}
}

export class UserUpdatedEvent {
  constructor(
    public readonly userId: string,
    public readonly partial: {
      displayName?: string | null;
      bio?: string | null;
      avatarUrl?: string | null;
      status?: string;
    },
  ) {}
}

export class RoomCreatedEvent {
  constructor(
    public readonly room: {
      id: string;
      type: string;
      name: string | null;
      slug: string | null;
      description: string | null;
      isPrivate: boolean;
      isArchived: boolean;
      memberCount: number;
      lastMessageAt: Date | null;
      createdAt: Date;
    },
  ) {}
}

export class RoomUpdatedEvent {
  constructor(
    public readonly roomId: string,
    public readonly partial: Record<string, any>,
  ) {}
}

export class RoomDeletedEvent {
  constructor(public readonly roomId: string) {}
}
