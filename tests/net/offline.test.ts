import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectError, NetworkClient } from '../../src/net/net';
import { ONLINE_KEY } from '../../src/data/online';

afterEach(() => vi.unstubAllGlobals());

describe('network client with online features off', () => {
  it('opens no socket, whoever asks', async () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => (key === ONLINE_KEY ? 'off' : null), setItem: () => {} });
    const socket = vi.fn();
    vi.stubGlobal('WebSocket', Object.assign(socket, { OPEN: 1, CONNECTING: 0 }));
    const error = await new NetworkClient('wss://relay.example').connect().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).reason).toBe('offline');
    expect(socket).not.toHaveBeenCalled();
  });
});
