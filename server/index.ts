import WebSocket, { WebSocketServer } from 'ws';
import { RoomManager, type ClientConnection } from './room.js';

const port = Number(process.env.PORT ?? 8080);
const rooms = new RoomManager();
const server = new WebSocketServer({ port });

server.on('listening', () => {
  console.log(`WebSocket relay listening on :${port}`);
});

server.on('connection', (socket: WebSocket) => {
  const connection: ClientConnection = {
    send(message: unknown): void {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
  };

  rooms.connect(connection);
  socket.on('message', (data, isBinary) => {
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

  socket.on('close', () => rooms.disconnect(connection));
  socket.on('error', () => rooms.disconnect(connection));
});

server.on('error', (error: Error) => {
  console.error('WebSocket relay server error:', error);
});
