import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';

export type IndexName = 'messages' | 'users' | 'rooms';

@Injectable()
export class ElasticsearchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ElasticsearchService.name);
  private client: Client;
  private prefix: string;
  private enabled: boolean;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.enabled =
      this.configService.get<boolean>('elasticsearch.enabled') ?? false;
    this.prefix =
      this.configService.get<string>('elasticsearch.indexPrefix') ?? '';

    if (!this.enabled) {
      this.logger.warn('Elasticsearch disabled — using PostgreSQL fallback');
      return;
    }

    const node = this.configService.get<string>('elasticsearch.node');
    const username = this.configService.get<string>('elasticsearch.username');
    const password = this.configService.get<string>('elasticsearch.password');

    const clientOptions: any = {
      node,
      requestTimeout: this.configService.get<number>(
        'elasticsearch.requestTimeout',
      ),
      maxRetries: this.configService.get<number>('elasticsearch.maxRetries'),
    };

    if (username && password) {
      clientOptions.auth = { username, password };
    }

    this.client = new Client(clientOptions);

    try {
      const info = await this.client.info();
      this.logger.log(
        `Elasticsearch connected: v${info.version.number} @ ${node}`,
      );
      await this.createIndices();
    } catch (err) {
      this.logger.error(
        'Elasticsearch connection failed — search will use PostgreSQL fallback',
        err,
      );
      this.enabled = false;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.close();
    }
  }

  // ─── Index name helpers ───────────────────────────────

  indexName(name: IndexName): string {
    return `${this.prefix}_${name}`;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getClient(): Client {
    return this.client;
  }

  // ─── Create index mappings ────────────────────────────

  private async createIndices(): Promise<void> {
    await Promise.all([
      this.createMessagesIndex(),
      this.createUsersIndex(),
      this.createRoomsIndex(),
    ]);
  }

  private async createMessagesIndex(): Promise<void> {
    const index = this.indexName('messages');
    const exists = await this.client.indices.exists({ index });
    if (exists) return;

    await this.client.indices.create({
      index,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 1,
        analysis: {
          analyzer: {
            chat_analyzer: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'asciifolding', 'stop', 'snowball'],
            },
            autocomplete_analyzer: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'asciifolding', 'edge_ngram_filter'],
            },
            search_analyzer: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'asciifolding'],
            },
          },
          filter: {
            edge_ngram_filter: {
              type: 'edge_ngram',
              min_gram: 1,
              max_gram: 20,
            },
            snowball: {
              type: 'snowball',
              language: 'English',
            },
          },
        },
      },
      mappings: {
        properties: {
          id: { type: 'keyword' },
          roomId: { type: 'keyword' },
          senderId: { type: 'keyword' },
          senderUsername: {
            type: 'text',
            analyzer: 'autocomplete_analyzer',
            search_analyzer: 'search_analyzer',
          },
          senderDisplayName: {
            type: 'text',
            analyzer: 'autocomplete_analyzer',
            search_analyzer: 'search_analyzer',
          },
          content: {
            type: 'text',
            analyzer: 'chat_analyzer',
            search_analyzer: 'search_analyzer',
            fields: {
              raw: { type: 'keyword' },
              suggest: {
                type: 'text',
                analyzer: 'autocomplete_analyzer',
                search_analyzer: 'search_analyzer',
              },
            },
          },
          type: { type: 'keyword' },
          parentId: { type: 'keyword' },
          isDeleted: { type: 'boolean' },
          isEdited: { type: 'boolean' },
          replyCount: { type: 'integer' },
          createdAt: { type: 'date' },
          updatedAt: { type: 'date' },
        },
      },
    });

    this.logger.log(`Created Elasticsearch index: ${index}`);
  }

  private async createUsersIndex(): Promise<void> {
    const index = this.indexName('users');
    const exists = await this.client.indices.exists({ index });
    if (exists) return;

    await this.client.indices.create({
      index,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 1,
        analysis: {
          analyzer: {
            autocomplete_analyzer: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'asciifolding', 'edge_ngram_filter'],
            },
            search_analyzer: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'asciifolding'],
            },
          },
          filter: {
            edge_ngram_filter: {
              type: 'edge_ngram',
              min_gram: 1,
              max_gram: 20,
            },
          },
        },
      },
      mappings: {
        properties: {
          id: { type: 'keyword' },
          username: {
            type: 'text',
            analyzer: 'autocomplete_analyzer',
            search_analyzer: 'search_analyzer',
            fields: { raw: { type: 'keyword' } },
          },
          displayName: {
            type: 'text',
            analyzer: 'autocomplete_analyzer',
            search_analyzer: 'search_analyzer',
          },
          email: { type: 'keyword' },
          bio: { type: 'text', analyzer: 'chat_analyzer' },
          avatarUrl: { type: 'keyword', index: false },
          status: { type: 'keyword' },
          isVerified: { type: 'boolean' },
          createdAt: { type: 'date' },
        },
      },
    });

    this.logger.log(`Created Elasticsearch index: ${index}`);
  }

  private async createRoomsIndex(): Promise<void> {
    const index = this.indexName('rooms');
    const exists = await this.client.indices.exists({ index });
    if (exists) return;

    await this.client.indices.create({
      index,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 1,
        analysis: {
          analyzer: {
            autocomplete_analyzer: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'asciifolding', 'edge_ngram_filter'],
            },
            search_analyzer: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'asciifolding'],
            },
          },
          filter: {
            edge_ngram_filter: {
              type: 'edge_ngram',
              min_gram: 1,
              max_gram: 20,
            },
          },
        },
      },
      mappings: {
        properties: {
          id: { type: 'keyword' },
          type: { type: 'keyword' },
          name: {
            type: 'text',
            analyzer: 'autocomplete_analyzer',
            search_analyzer: 'search_analyzer',
            fields: { raw: { type: 'keyword' } },
          },
          slug: { type: 'keyword' },
          description: { type: 'text', analyzer: 'chat_analyzer' },
          isPrivate: { type: 'boolean' },
          isArchived: { type: 'boolean' },
          memberCount: { type: 'integer' },
          lastMessageAt: { type: 'date' },
          createdAt: { type: 'date' },
        },
      },
    });

    this.logger.log(`Created Elasticsearch index: ${index}`);
  }

  // ─── Generic index / update / delete ─────────────────

  async indexDocument(
    indexName: IndexName,
    id: string,
    document: Record<string, any>,
  ): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.client.index({
        index: this.indexName(indexName),
        id,
        document,
        refresh: false, // async refresh for performance
      });
    } catch (err) {
      this.logger.error(`Failed to index ${indexName}:${id}`, err);
    }
  }

  async updateDocument(
    indexName: IndexName,
    id: string,
    partial: Record<string, any>,
  ): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.client.update({
        index: this.indexName(indexName),
        id,
        doc: partial,
        doc_as_upsert: true,
      });
    } catch (err) {
      this.logger.error(`Failed to update ${indexName}:${id}`, err);
    }
  }

  async deleteDocument(indexName: IndexName, id: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.client.delete({
        index: this.indexName(indexName),
        id,
        ignore_unavailable: true,
      } as any);
    } catch (err) {
      this.logger.error(`Failed to delete ${indexName}:${id}`, err);
    }
  }

  // ─── Search ───────────────────────────────────────────

  async search<T = any>(
    indexName: IndexName,
    query: Record<string, any>,
    options: {
      from?: number;
      size?: number;
      highlight?: Record<string, any>;
      sort?: any[];
      source?: string[];
    } = {},
  ): Promise<{ hits: T[]; total: number; took: number }> {
    if (!this.enabled) {
      throw new Error('Elasticsearch not available');
    }

    const response = await (this.client.search as any)({
      index: this.indexName(indexName),
      query,
      from: options.from ?? 0,
      size: options.size ?? 20,
      ...(options.highlight && { highlight: options.highlight }),
      ...(options.sort && { sort: options.sort }),
      ...(options.source && { _source: options.source }),
    });

    const hits = response.hits.hits.map((hit: any) => ({
      ...hit._source,
      _score: hit._score,
      _highlight: hit.highlight,
    })) as T[];

    const total =
      typeof response.hits.total === 'number'
        ? response.hits.total
        : (response.hits.total?.value ?? 0);

    return { hits, total, took: response.took };
  }

  // ─── Bulk index ───────────────────────────────────────

  async bulkIndex(
    indexName: IndexName,
    documents: { id: string; doc: Record<string, any> }[],
  ): Promise<void> {
    if (!this.enabled || documents.length === 0) return;

    const operations = documents.flatMap(({ id, doc }) => [
      { index: { _index: this.indexName(indexName), _id: id } },
      doc,
    ]);

    const result = await this.client.bulk({ operations, refresh: false });

    if (result.errors) {
      const errors = result.items
        .filter((item: any) => item.index?.error)
        .map((item: any) => item.index?.error);
      this.logger.error(`Bulk index errors:`, errors);
    }
  }

  // ─── Reindex all data from Postgres ──────────────────

  async reindexAll(
    indexName: IndexName,
    documents: { id: string; doc: Record<string, any> }[],
  ): Promise<void> {
    if (!this.enabled) return;

    this.logger.log(
      `Reindexing ${documents.length} documents into ${indexName}...`,
    );

    // Process in batches of 500
    const batchSize = 500;
    for (let i = 0; i < documents.length; i += batchSize) {
      await this.bulkIndex(indexName, documents.slice(i, i + batchSize));
    }

    this.logger.log(`Reindex complete for ${indexName}`);
  }
}
