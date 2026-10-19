import type { ConquestCommand, ConquestState } from '@mageknight/engine';
import type { ConquestModuleId, Difficulty } from '@mageknight/content';

export type AccountRecord = {
  id: string;
  username: string;
  normalizedUsername: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
};

export type SessionRecord = {
  tokenHash: string;
  accountId: string;
  expiresAt: string;
};

export type RoomSetup = {
  seed: string;
  difficulty: Difficulty;
  heroId: string;
  scenarioId: string;
  modules: ConquestModuleId[];
};

export type RoomCommandRecord = {
  revision: number;
  accountId: string;
  command: ConquestCommand;
  createdAt: string;
};

export type RoomRecord = {
  id: string;
  code: string;
  name: string;
  hostAccountId: string;
  memberAccountIds: string[];
  activeAccountId?: string;
  status: 'lobby' | 'playing' | 'finished';
  setup: RoomSetup;
  state?: ConquestState;
  revision: number;
  commandLog: RoomCommandRecord[];
  createdAt: string;
  updatedAt: string;
};

export type MultiplayerDatabaseData = {
  schemaVersion: 1;
  accounts: AccountRecord[];
  sessions: SessionRecord[];
  rooms: RoomRecord[];
};

export function emptyDatabase(): MultiplayerDatabaseData {
  return { schemaVersion: 1, accounts: [], sessions: [], rooms: [] };
}
