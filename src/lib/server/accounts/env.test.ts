import { describe, expect, test } from 'vitest';
import { loadAccountsEnv } from './env';

const base = {
  DISCORD_CLIENT_ID: '111',
  DISCORD_CLIENT_SECRET: 'secret',
  DISCORD_BOT_TOKEN: 'bot',
  DISCORD_GUILD_ID: '222',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('loadAccountsEnv', () => {
  test('off (null) when nothing is set', () => {
    expect(loadAccountsEnv({})).toBeNull();
  });

  test('half configured is an error naming what is missing', () => {
    expect(() => loadAccountsEnv({ DISCORD_CLIENT_ID: '111' })).toThrow(/DISCORD_CLIENT_SECRET[\s\S]*SESSION_SECRET/);
  });

  test('role id lists take any number of ids, comma separated', () => {
    const env = loadAccountsEnv({
      ...base,
      DISCORD_STAFF_ROLE_IDS: '123456789012345678, 223456789012345678,323456789012345678',
      DISCORD_PREMIUM_ROLE_IDS: '423456789012345678',
    })!;
    expect(env.roles).toEqual({
      staff: ['123456789012345678', '223456789012345678', '323456789012345678'],
      premium: ['423456789012345678'],
      verified: [],
    });
    expect(env.dataDir).toBe('./data');
    expect(env.priorityApiKey).toBe('');
  });

  test('rejects a role id that is not a Discord snowflake', () => {
    expect(() => loadAccountsEnv({ ...base, DISCORD_VERIFIED_ROLE_IDS: '123456789012345678,@Verified' })).toThrow(/VERIFIED.*@Verified/);
  });

  test('DISCORD_PUBLIC_KEY is optional, and must be the 64-hex key when set', () => {
    expect(loadAccountsEnv(base)!.discordPublicKey).toBe('');
    expect(loadAccountsEnv({ ...base, DISCORD_PUBLIC_KEY: 'AB'.repeat(32) })!.discordPublicKey).toBe('ab'.repeat(32));
    expect(() => loadAccountsEnv({ ...base, DISCORD_PUBLIC_KEY: 'not-a-key' })).toThrow(/DISCORD_PUBLIC_KEY/);
  });

  test('DISCORD_ROUNDS_CHANNEL_ID is optional, and must be a channel id', () => {
    expect(loadAccountsEnv(base)!.roundsChannelId).toBe('');
    expect(loadAccountsEnv({ ...base, DISCORD_ROUNDS_CHANNEL_ID: ' 123456789012345678 ' })!.roundsChannelId).toBe('123456789012345678');
    expect(() => loadAccountsEnv({ ...base, DISCORD_ROUNDS_CHANNEL_ID: '#rounds' })).toThrow(/DISCORD_ROUNDS_CHANNEL_ID/);
  });

  test('rejects a short session secret', () => {
    expect(() => loadAccountsEnv({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });
});
