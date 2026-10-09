import WebSocket, { WebSocketServer } from 'ws';
import { RoomManager, type ClientConnection } from './room.js';

const port = Number(process.env.PORT ?? 8080);
console.warn('Deprecated: the TypeScript relay is retained for comparison. Use `npm run dev:server:rust`.');
/** The host's full state can be large once; everything after that is small patches. */
const MAX_PAYLOAD = 1024 * 1024;
const MAX_MESSAGES_PER_SECOND = 300;
const HEARTBEAT_MS = 30_000;

const rooms = new RoomManager();
const server = new WebSocketServer({ port, maxPayload: MAX_PAYLOAD });

server.on('listening', () => {
  console.log(`WebSocket relay listening on :${port}`);
});

server.on('connection', (socket: WebSocket) => {
  const connection: ClientConnection = {
    send(message: unknown): void {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    sendText(text: string): void {
      if (socket.readyState === WebSocket.OPEN) socket.send(text);
    },
  };

  let alive = true;
  socket.on('pong', () => { alive = true; });
  let windowStart = Date.now();
  let windowCount = 0;

  rooms.connect(connection);
  socket.on('message', (data, isBinary) => {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      windowCount = 0;
    }
    if (++windowCount > MAX_MESSAGES_PER_SECOND) {
      socket.close(1008, 'Rate limit exceeded');
      return;
    }
    if (isBinary) {
      connection.send({ type: 'error', message: 'Only text JSON messages are accepted' });
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(data.toString());
    } catch {
      connection.send({ type: 'error', message: 'Invalid JSON message' });
      return;
    }
    rooms.handle(connection, message);
  });

  const heartbeat = setInterval(() => {
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, HEARTBEAT_MS);

  socket.on('close', () => {
    clearInterval(heartbeat);
    rooms.disconnect(connection);
  });
  socket.on('error', () => socket.terminate());
});

server.on('error', (error: Error) => {
  console.error('WebSocket relay server error:', error);
});
