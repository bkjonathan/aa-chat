import { registerAs } from '@nestjs/config';

export default registerAs('elasticsearch', () => ({
  node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
  username: process.env.ELASTICSEARCH_USERNAME || '',
  password: process.env.ELASTICSEARCH_PASSWORD || '',
  enabled: process.env.ELASTICSEARCH_ENABLED !== 'false',
  indexPrefix: process.env.ELASTICSEARCH_INDEX_PREFIX || 'chatapp',
  requestTimeout: 10000,
  maxRetries: 3,
}));
