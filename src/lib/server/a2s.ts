// Steam server query (A2S_INFO over UDP), the fallback source for servers we have no RCON password
// for. It needs nothing from the server's admins, only its query port, but it reports far less:
// name, map and player count. No Steam IDs, so these servers get status and population, not stats.
// Protocol: https://developer.valvesoftware.com/wiki/Server_queries

import dgram from 'node:dgram';
import type { GameSource, ServerStatus } from './rcon';

export interface A2SInfo {
  name: string;
  map: string;
  folder: string;
  game: string;
  players: number;
  maxPlayers: number;
  bots: number;
  version: string;
}

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const INFO_REQUEST = Buffer.concat([HEADER, Buffer.from('TSource Engine Query\0', 'latin1')]);
const S2C_CHALLENGE = 0x41;
const S2A_INFO = 0x49;

export function encodeInfoRequest(challenge?: Buffer): Buffer {
  return challenge ? Buffer.concat([INFO_REQUEST, challenge]) : INFO_REQUEST;
}

/** Parse an S2A_INFO reply (single-packet; info replies are never split in practice). */
export function parseInfo(buf: Buffer): A2SInfo {
  let o = 0;
  const byte = () => buf.readUInt8(o++);
  const str = () => {
    const end = buf.indexOf(0, o);
    if (end < 0) throw new Error('truncated A2S_INFO');
    const s = buf.toString('utf8', o, end);
    o = end + 1;
    return s;
  };
  if (buf.readInt32LE(0) !== -1) throw new Error('split A2S reply not supported');
  o = 4;
  if (byte() !== S2A_INFO) throw new Error('not an A2S_INFO reply');
  byte(); // protocol
  const name = str();
  const map = str();
  const folder = str();
  const game = str();
  o += 2; // app id
  const players = byte();
  const maxPlayers = byte();
  const bots = byte();
  o += 4; // server type, environment, visibility, VAC
  const version = str();
  return { name, map, folder, game, players, maxPlayers, bots, version };
}

/** One A2S_INFO round trip, answering a challenge if the server asks for one. */
export function queryInfo(host: string, port: number, timeoutMs = 3000): Promise<A2SInfo> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4');
    const done = (err: Error | null, info?: A2SInfo) => {
      clearTimeout(timer);
      socket.close();
      if (err) reject(err);
      else resolve(info!);
    };
    const timer = setTimeout(() => done(new Error(`no reply from ${host}:${port} (query port closed?)`)), timeoutMs);
    socket.on('error', (e) => done(e));
    socket.on('message', (msg) => {
      try {
        if (msg.length >= 9 && msg[4] === S2C_CHALLENGE) {
          socket.send(encodeInfoRequest(msg.subarray(5, 9)), port, host);
          return;
        }
        done(null, parseInfo(msg));
      } catch (e) {
        done(e as Error);
      }
    });
    socket.send(encodeInfoRequest(), port, host);
  });
}

/** A2S as a `GameSource`: status with no factions, and an empty player list. */
export class QueryClient implements GameSource {
  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  async status(): Promise<ServerStatus> {
    const info = await queryInfo(this.host, this.port);
    return {
      serverName: info.name,
      map: info.map,
      experiences: [],
      lighting: null,
      players: { current: Math.max(0, info.players - info.bots), max: info.maxPlayers },
      factionScores: [],
    };
  }

  async players() {
    return [];
  }

  async health() {
    return null;
  }

  async serverId() {
    return null;
  }
}
