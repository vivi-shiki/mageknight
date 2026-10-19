import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { createConquestContent, defaultConquestModules } from '@mageknight/content';
import type { ConquestModuleId, Difficulty } from '@mageknight/content';
import { createConquestGame, executeConquestIntent, projectConquestView } from '@mageknight/engine';
import type { ConquestCommand, ConquestView } from '@mageknight/engine';
import type { AccountRecord, RoomRecord, RoomSetup } from './model';
import { JsonStore } from './store';

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KNOWN_MODULES = new Set<ConquestModuleId>([
  'lost-legion.official-v0.6',
  'krang.character-v0.7',
  'shades-of-tezla.official-v0.8',
]);

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type PublicAccount = { id: string; username: string };
export type RoomSummary = {
  id: string;
  code: string;
  name: string;
  status: RoomRecord['status'];
  hostAccountId: string;
  memberCount: number;
  isMember: boolean;
  updatedAt: string;
};
export type PublicRoom = RoomSummary & {
  members: PublicAccount[];
  activeAccountId?: string;
  setup: RoomSetup;
  revision: number;
  view?: ConquestView;
  recentCommands: Array<{ revision: number; accountId: string; commandType: string; createdAt: string }>;
};

function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 64, (error, key) => error ? reject(error) : resolve(key));
  });
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeUsername(username: string): string {
  return username.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function validateCredentials(username: string, password: string): { username: string; normalized: string } {
  const trimmed = username.trim().normalize('NFKC');
  if (!/^[\p{L}\p{N}_-]{3,20}$/u.test(trimmed)) {
    throw new ServiceError(400, 'INVALID_USERNAME', '用户名需为 3 到 20 个字母、数字、下划线或连字符。');
  }
  if (password.length < 6 || password.length > 72) {
    throw new ServiceError(400, 'INVALID_PASSWORD', '密码长度需为 6 到 72 个字符。');
  }
  return { username: trimmed, normalized: normalizeUsername(trimmed) };
}

function createRoomCode(existingCodes: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const bytes = randomBytes(6);
    const code = Array.from(bytes, (value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join('');
    if (!existingCodes.has(code)) return code;
  }
  throw new ServiceError(500, 'ROOM_CODE_EXHAUSTED', '无法生成房间码。');
}

function validateModules(value: unknown): ConquestModuleId[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !KNOWN_MODULES.has(item as ConquestModuleId))) {
    throw new ServiceError(400, 'INVALID_MODULES', '扩展模块设置无效。');
  }
  return [...new Set(value as ConquestModuleId[])];
}

export class MultiplayerService {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly store: JsonStore) {}

  static async open(filePath: string): Promise<MultiplayerService> {
    return new MultiplayerService(await JsonStore.open(filePath));
  }

  private write<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(async () => {
      const value = await operation();
      await this.store.save();
      return value;
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read<T>(operation: () => T): Promise<T> {
    await this.queue;
    return operation();
  }

  private issueSession(account: AccountRecord): { token: string; account: PublicAccount } {
    const token = randomBytes(32).toString('base64url');
    this.store.data.sessions.push({
      tokenHash: tokenHash(token),
      accountId: account.id,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    });
    return { token, account: { id: account.id, username: account.username } };
  }

  private requireAccount(token: string): AccountRecord {
    const session = this.store.data.sessions.find((candidate) => candidate.tokenHash === tokenHash(token));
    if (!session || Date.parse(session.expiresAt) <= Date.now()) {
      throw new ServiceError(401, 'UNAUTHORIZED', '登录已失效，请重新登录。');
    }
    const account = this.store.data.accounts.find((candidate) => candidate.id === session.accountId);
    if (!account) throw new ServiceError(401, 'UNAUTHORIZED', '账号不存在。');
    return account;
  }

  private requireRoom(roomId: string): RoomRecord {
    const room = this.store.data.rooms.find((candidate) => candidate.id === roomId);
    if (!room) throw new ServiceError(404, 'ROOM_NOT_FOUND', '房间不存在。');
    return room;
  }

  private requireMember(room: RoomRecord, accountId: string): void {
    if (!room.memberAccountIds.includes(accountId)) throw new ServiceError(403, 'NOT_A_MEMBER', '你不是该房间成员。');
  }

  private roomSummary(room: RoomRecord, accountId: string): RoomSummary {
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      status: room.status,
      hostAccountId: room.hostAccountId,
      memberCount: room.memberAccountIds.length,
      isMember: room.memberAccountIds.includes(accountId),
      updatedAt: room.updatedAt,
    };
  }

  private publicRoom(room: RoomRecord, accountId: string): PublicRoom {
    this.requireMember(room, accountId);
    const content = createConquestContent(room.setup.modules);
    return {
      ...this.roomSummary(room, accountId),
      members: room.memberAccountIds.flatMap((id) => {
        const account = this.store.data.accounts.find((candidate) => candidate.id === id);
        return account ? [{ id: account.id, username: account.username }] : [];
      }),
      ...(room.activeAccountId ? { activeAccountId: room.activeAccountId } : {}),
      setup: room.setup,
      revision: room.revision,
      ...(room.state ? { view: projectConquestView(room.state, content) } : {}),
      recentCommands: room.commandLog.slice(-12).map((item) => ({
        revision: item.revision,
        accountId: item.accountId,
        commandType: item.command.type,
        createdAt: item.createdAt,
      })),
    };
  }

  async register(username: string, password: string) {
    return this.write(async () => {
      const valid = validateCredentials(username, password);
      if (this.store.data.accounts.some((account) => account.normalizedUsername === valid.normalized)) {
        throw new ServiceError(409, 'USERNAME_TAKEN', '该用户名已被注册。');
      }
      const salt = randomBytes(16).toString('hex');
      const account: AccountRecord = {
        id: randomUUID(),
        username: valid.username,
        normalizedUsername: valid.normalized,
        passwordSalt: salt,
        passwordHash: (await scrypt(password, salt)).toString('hex'),
        createdAt: new Date().toISOString(),
      };
      this.store.data.accounts.push(account);
      return this.issueSession(account);
    });
  }

  async login(username: string, password: string) {
    return this.write(async () => {
      const normalized = normalizeUsername(username);
      const account = this.store.data.accounts.find((candidate) => candidate.normalizedUsername === normalized);
      if (!account) throw new ServiceError(401, 'INVALID_LOGIN', '用户名或密码错误。');
      const actual = await scrypt(password, account.passwordSalt);
      const expected = Buffer.from(account.passwordHash, 'hex');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new ServiceError(401, 'INVALID_LOGIN', '用户名或密码错误。');
      }
      return this.issueSession(account);
    });
  }

  async logout(token: string): Promise<void> {
    return this.write(() => {
      const hash = tokenHash(token);
      this.store.data.sessions = this.store.data.sessions.filter((session) => session.tokenHash !== hash);
    });
  }

  async me(token: string): Promise<PublicAccount> {
    return this.read(() => {
      const account = this.requireAccount(token);
      return { id: account.id, username: account.username };
    });
  }

  async listRooms(token: string): Promise<RoomSummary[]> {
    return this.read(() => {
      const account = this.requireAccount(token);
      return this.store.data.rooms
        .filter((room) => room.status === 'lobby' || room.memberAccountIds.includes(account.id))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((room) => this.roomSummary(room, account.id));
    });
  }

  async createRoom(token: string, name: string): Promise<PublicRoom> {
    return this.write(() => {
      const account = this.requireAccount(token);
      const cleanName = name.trim().slice(0, 30) || `${account.username} 的对局`;
      const code = createRoomCode(new Set(this.store.data.rooms.map((room) => room.code)));
      const now = new Date().toISOString();
      const content = createConquestContent(defaultConquestModules);
      const room: RoomRecord = {
        id: randomUUID(),
        code,
        name: cleanName,
        hostAccountId: account.id,
        memberAccountIds: [account.id],
        status: 'lobby',
        setup: {
          seed: `online-${code}`,
          difficulty: 'standard',
          heroId: content.defaultHeroId,
          scenarioId: content.defaultScenarioId,
          modules: [...defaultConquestModules],
        },
        revision: 0,
        commandLog: [],
        createdAt: now,
        updatedAt: now,
      };
      this.store.data.rooms.push(room);
      return this.publicRoom(room, account.id);
    });
  }

  async joinRoom(token: string, code: string): Promise<PublicRoom> {
    return this.write(() => {
      const account = this.requireAccount(token);
      const room = this.store.data.rooms.find((candidate) => candidate.code === code.trim().toUpperCase());
      if (!room) throw new ServiceError(404, 'ROOM_NOT_FOUND', '房间码无效。');
      if (room.status !== 'lobby' && !room.memberAccountIds.includes(account.id)) {
        throw new ServiceError(409, 'ROOM_ALREADY_STARTED', '该房间已经开局。');
      }
      if (!room.memberAccountIds.includes(account.id)) {
        if (room.memberAccountIds.length >= 4) throw new ServiceError(409, 'ROOM_FULL', '房间已满。');
        room.memberAccountIds.push(account.id);
        room.revision += 1;
        room.updatedAt = new Date().toISOString();
      }
      return this.publicRoom(room, account.id);
    });
  }

  async getRoom(token: string, roomId: string): Promise<PublicRoom> {
    return this.read(() => {
      const account = this.requireAccount(token);
      return this.publicRoom(this.requireRoom(roomId), account.id);
    });
  }

  async startRoom(token: string, roomId: string, rawSetup: Partial<RoomSetup>): Promise<PublicRoom> {
    return this.write(() => {
      const account = this.requireAccount(token);
      const room = this.requireRoom(roomId);
      this.requireMember(room, account.id);
      if (room.hostAccountId !== account.id) throw new ServiceError(403, 'HOST_ONLY', '只有房主可以开局。');
      if (room.status !== 'lobby') throw new ServiceError(409, 'ROOM_ALREADY_STARTED', '房间已经开局。');
      const modules = rawSetup.modules === undefined ? room.setup.modules : validateModules(rawSetup.modules);
      const content = createConquestContent(modules);
      const difficulty: Difficulty = rawSetup.difficulty ?? room.setup.difficulty;
      if (!['explorer', 'standard', 'veteran'].includes(difficulty)) throw new ServiceError(400, 'INVALID_DIFFICULTY', '难度无效。');
      const heroId = rawSetup.heroId ?? room.setup.heroId;
      const scenarioId = rawSetup.scenarioId ?? room.setup.scenarioId;
      if (!content.heroes[heroId]) throw new ServiceError(400, 'INVALID_HERO', '英雄无效或未启用对应扩展。');
      if (!content.scenarios[scenarioId]) throw new ServiceError(400, 'INVALID_SCENARIO', '场景无效或未启用对应扩展。');
      const seed = (rawSetup.seed ?? room.setup.seed).trim().slice(0, 80) || `online-${room.code}`;
      room.setup = { seed, difficulty, heroId, scenarioId, modules };
      room.state = createConquestGame(room.setup, content);
      room.status = 'playing';
      room.activeAccountId = room.hostAccountId;
      room.revision += 1;
      room.updatedAt = new Date().toISOString();
      return this.publicRoom(room, account.id);
    });
  }

  async executeCommand(token: string, roomId: string, expectedRevision: number, command: ConquestCommand): Promise<PublicRoom> {
    return this.write(() => {
      const account = this.requireAccount(token);
      const room = this.requireRoom(roomId);
      this.requireMember(room, account.id);
      if (room.status !== 'playing' || !room.state) throw new ServiceError(409, 'ROOM_NOT_PLAYING', '房间当前不可操作。');
      if (room.activeAccountId !== account.id) throw new ServiceError(403, 'NOT_ACTIVE_PLAYER', '当前由另一位成员操作。');
      if (!Number.isInteger(expectedRevision) || expectedRevision !== room.revision) {
        throw new ServiceError(409, 'STALE_ROOM', '房间状态已更新，请重试。');
      }
      if (!command || typeof command !== 'object' || typeof command.type !== 'string') {
        throw new ServiceError(400, 'INVALID_COMMAND', '命令格式无效。');
      }
      const content = createConquestContent(room.setup.modules);
      const result = executeConquestIntent(room.state, command, content);
      if (!result.ok) throw new ServiceError(409, result.error.code, result.error.message);
      room.state = result.state;
      room.revision += 1;
      room.updatedAt = new Date().toISOString();
      room.commandLog.push({ revision: room.revision, accountId: account.id, command, createdAt: room.updatedAt });
      if (result.state.scenario.status !== 'playing') {
        room.status = 'finished';
      } else if (command.type === 'END_TURN') {
        const current = room.memberAccountIds.indexOf(account.id);
        room.activeAccountId = room.memberAccountIds[(current + 1) % room.memberAccountIds.length]!;
      }
      return this.publicRoom(room, account.id);
    });
  }

  async claimControl(token: string, roomId: string): Promise<PublicRoom> {
    return this.write(() => {
      const account = this.requireAccount(token);
      const room = this.requireRoom(roomId);
      this.requireMember(room, account.id);
      if (room.status !== 'playing') throw new ServiceError(409, 'ROOM_NOT_PLAYING', '房间当前不可接管。');
      room.activeAccountId = account.id;
      room.revision += 1;
      room.updatedAt = new Date().toISOString();
      return this.publicRoom(room, account.id);
    });
  }

  async passControl(token: string, roomId: string): Promise<PublicRoom> {
    return this.write(() => {
      const account = this.requireAccount(token);
      const room = this.requireRoom(roomId);
      this.requireMember(room, account.id);
      if (room.status !== 'playing' || room.activeAccountId !== account.id) {
        throw new ServiceError(403, 'NOT_ACTIVE_PLAYER', '只有当前操作者可以交接。');
      }
      const current = room.memberAccountIds.indexOf(account.id);
      room.activeAccountId = room.memberAccountIds[(current + 1) % room.memberAccountIds.length]!;
      room.revision += 1;
      room.updatedAt = new Date().toISOString();
      return this.publicRoom(room, account.id);
    });
  }
}
