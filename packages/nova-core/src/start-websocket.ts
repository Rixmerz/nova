/**
 * Nova Core WebSocket Server Startup
 *
 * Entry point for running the Nova server.
 */

import { startNovaServer } from './transport/websocket.js';
import { resolve } from 'path';

const PORT = parseInt(process.env.NOVA_PORT || '8080', 10);
const BASE_PATH = process.env.NOVA_BASE_PATH || resolve(process.cwd(), '../..');

console.log('╔═══════════════════════════════════════════╗');
console.log('║           Nova Core Server                ║');
console.log('╚═══════════════════════════════════════════╝');
console.log('');
console.log(`Port: ${PORT}`);
console.log(`Base Path: ${BASE_PATH}`);
console.log('');

startNovaServer({
  port: PORT,
  basePath: BASE_PATH,
})
  .then(() => {
    console.log('');
    console.log('Server is ready!');
  })
  .catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
