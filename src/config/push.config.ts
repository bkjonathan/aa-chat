import { registerAs } from '@nestjs/config';

export default registerAs('push', () => ({
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@yourapp.com',
}));
