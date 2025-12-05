#!/usr/bin/env node
/**
 * Opcode MCP Server - Entry Point
 *
 * This is the main entry point for the MCP server.
 * It supports two transport modes:
 *
 * 1. WebSocket (default): For browser clients
 *    Run: npm start
 *    Connect: ws://localhost:8080/mcp
 *
 * 2. stdio: For CLI integration
 *    Run: npm start -- --stdio
 *
 * Environment Variables:
 *   MCP_PORT: WebSocket server port (default: 8080)
 *   MCP_TRANSPORT: 'websocket' or 'stdio' (default: websocket)
 */

import { startWebSocketServer } from './transport/websocket.js';
import { startStdioServer } from './server.js';

// Parse command line arguments
const args = process.argv.slice(2);
const useStdio = args.includes('--stdio') || process.env.MCP_TRANSPORT === 'stdio';
const port = parseInt(process.env.MCP_PORT || '8080', 10);

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════');
  console.log('  Opcode MCP Server v1.0.0');
  console.log('  Agent process router for Nova UI');
  console.log('═══════════════════════════════════════════');

  if (useStdio) {
    console.log('[Main] Starting in stdio mode...');
    await startStdioServer();
  } else {
    console.log(`[Main] Starting WebSocket server on port ${port}...`);
    await startWebSocketServer(port);
    console.log('[Main] Server ready. Press Ctrl+C to stop.');
  }
}

// Run
main().catch((error) => {
  console.error('[Main] Fatal error:', error);
  process.exit(1);
});

// Export for programmatic use
export { startWebSocketServer } from './transport/websocket.js';
export { startStdioServer, createMcpServer } from './server.js';
export { sessionRegistry } from './registry/session.js';
export type { ProcessHandle } from './registry/session.js';
export type { SpawnOptions, SpawnResult } from './process/spawner.js';
export type { AgentEventPayload } from './server.js';
