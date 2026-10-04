import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { parseInfo, QueryClient, queryInfo } from './a2s';

function infoReply(): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 17])];
  const str = (s: string) => parts.push(Buffer.from(s + '\0', 'utf8'));
  str('TEG | EU #1');
  str('Kavkazi');
  str('wardogs');
  str('WARDOGS');
  parts.push(Buffer.from([0, 0, 42, 100, 2, 0x64, 0x6c, 0, 0]));
  str('1.0.501228');
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

let server: dgram.Socket | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

/** A fake game server that demands a challenge before answering. */
function fakeServer(): Promise<number> {
  const challenge = Buffer.from([1, 2, 3, 4]);
  server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    const answered = msg.length === 29 && msg.subarray(25).equals(challenge);
    const reply = answered ? infoReply() : Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, 0x41]), challenge]);
    server!.send(reply, rinfo.port, rinfo.address);
  });
  return new Promise((resolve) => server!.bind(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port)));
}

describe('a2s', () => {
  it('parses an info reply', () => {
    expect(parseInfo(infoReply())).toEqual({
      name: 'TEG | EU #1',
      map: 'Kavkazi',
      folder: 'wardogs',
      game: 'WARDOGS',
      players: 42,
      maxPlayers: 100,
      bots: 2,
      version: '1.0.501228',
    });
  });

  it('answers the challenge and reports humans only', async () => {
    const port = await fakeServer();
    expect((await queryInfo('127.0.0.1', port)).players).toBe(42);
    const status = await new QueryClient('127.0.0.1', port).status();
    expect(status.players).toEqual({ current: 40, max: 100 });
    expect(status.map).toBe('Kavkazi');
  });

  it('times out on a silent port', async () => {
    await expect(queryInfo('127.0.0.1', 9, 200)).rejects.toThrow(/no reply/);
  });
});
