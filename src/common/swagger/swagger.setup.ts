import { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  SwaggerCustomOptions,
} from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Chat App API')
    .setDescription(
      `
## Chat Application REST API

### Authentication
All endpoints (except auth and health) require a JWT Bearer token.

1. **Register** → \`POST /auth/register\`
2. **Login** → \`POST /auth/login\` to get \`accessToken\` and \`refreshToken\`
3. Click **Authorize** and enter \`Bearer <accessToken>\`

### Rate Limits
- Auth endpoints: 10 requests / 15 minutes
- Write endpoints: 30 requests / minute
- Read endpoints: 300 requests / minute
- Default: 100 requests / minute

### WebSocket
Connect to \`ws://localhost:3000\` with \`{ auth: { token: '<accessToken>' } }\`
      `.trim(),
    )
    .setVersion('1.0.0')
    .setContact('Chat App', 'https://github.com/yourrepo', 'dev@yourapp.com')
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addServer('http://localhost:3000', 'Local development')
    .addServer('https://api.yourapp.com', 'Production')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter your access token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('auth', 'Authentication — register, login, refresh, logout')
    .addTag('users', 'User profiles and settings')
    .addTag('rooms', 'Room management — DMs, groups, channels')
    .addTag('messages', 'Message CRUD, threads, reactions, read receipts')
    .addTag('files', 'File uploads and management')
    .addTag('notifications', 'Push subscriptions and in-app notifications')
    .addTag('search', 'Full-text search across messages, users and rooms')
    .addTag('health', 'Health checks and readiness probes')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey}_${methodKey}`,
    deepScanRoutes: true,
  });

  const customOptions: SwaggerCustomOptions = {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
      syntaxHighlight: { activate: true, theme: 'monokai' },
      tryItOutEnabled: true,
    },
    customSiteTitle: 'Chat App API Docs',
    customCss: `
      .swagger-ui .topbar { background-color: #1a1a18; }
      .swagger-ui .topbar .download-url-wrapper { display: none; }
      .swagger-ui .info .title { font-size: 28px; }
    `,
  };

  SwaggerModule.setup('api/docs', app, document, customOptions);

  // Also expose the raw JSON spec at /api/docs-json
  SwaggerModule.setup('api/docs-json', app, document, {
    jsonDocumentUrl: '/api/docs-json',
  });
}
