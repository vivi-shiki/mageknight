import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConquestCommand, ConquestIntent } from '@mageknight/engine';
import { createApiServer } from './http';
import { MultiplayerService } from './service';

const temporaryDirectories: string[] = [];

async function createService() {
  const directory = await mkdtemp(path.join(tmpdir(), 'mageknight-multiplayer-'));
  temporaryDirectories.push(directory);
  const file = path.join(directory, 'multiplayer.json');
  return { file, service: await MultiplayerService.open(file) };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('multiplayer service', () => {
  it('registers accounts, rejects duplicates and restores persisted sessions', async () => {
    const { file, service } = await createService();
    const registered = await service.register('测试骑士', 'secret12');
    await expect(service.register('测试骑士', 'different')).rejects.toMatchObject({ status: 409, code: 'USERNAME_TAKEN' });
    await expect(service.login('测试骑士', 'wrong-password')).rejects.toMatchObject({ status: 401, code: 'INVALID_LOGIN' });
    const loggedIn = await service.login('测试骑士', 'secret12');
    expect(loggedIn.account).toEqual(registered.account);

    const restored = await MultiplayerService.open(file);
    await expect(restored.me(loggedIn.token)).resolves.toEqual(registered.account);
  });

  it('completes a two-account game through server-authoritative commands', async () => {
    const { service } = await createService();
    const owner = await service.register('owner', 'secret12');
    const guest = await service.register('guest', 'secret12');
    let room = await service.createRoom(owner.token, '完整对局');
    room = await service.joinRoom(guest.token, room.code);
    await expect(service.startRoom(guest.token, room.id, {})).rejects.toMatchObject({ status: 403, code: 'HOST_ONLY' });
    room = await service.startRoom(owner.token, room.id, {
      seed: 'multiplayer-complete-game',
      difficulty: 'standard',
      heroId: 'core.hero.tovak',
      scenarioId: 'core.scenario.solo-conquest',
      modules: [],
    });
    expect(room.members).toHaveLength(2);
    expect(room.activeAccountId).toBe(owner.account.id);
    const firstCommand = room.view?.legalIntents[0]?.command;
    if (!firstCommand) throw new Error('Started room has no legal command.');
    await expect(service.executeCommand(guest.token, room.id, room.revision, firstCommand)).rejects.toMatchObject({ status: 403, code: 'NOT_ACTIVE_PLAYER' });

    const tokenByAccount = new Map([[owner.account.id, owner.token], [guest.account.id, guest.token]]);
    let playedMovementCard = false;
    for (let step = 0; room.status === 'playing' && step < 500; step += 1) {
      const view = room.view;
      if (!view || !room.activeAccountId) throw new Error('Playing room is missing state or controller.');
      let intent: ConquestIntent | undefined;
      if (view.phase === 'tactics') {
        intent = view.legalIntents.find((candidate) => candidate.command.type === 'SELECT_TACTIC');
      } else if (view.phase === 'decision') {
        intent = view.legalIntents.find((candidate) => candidate.command.type === 'RESOLVE_DECISION');
      } else if (view.phase === 'movement') {
        if (view.player.zones.deck.length === 0) {
          intent = view.legalIntents.find((candidate) => candidate.command.type === 'DECLARE_END_ROUND');
          playedMovementCard = false;
        } else if (!playedMovementCard) {
          intent = view.legalIntents.find((candidate) => candidate.command.type === 'PLAY_CARD' && candidate.command.mode === 'sideways' && candidate.command.sidewaysResource === 'move');
        } else {
          intent = view.legalIntents.find((candidate) => candidate.command.type === 'FINISH_MOVEMENT');
        }
      } else if (view.phase === 'action') {
        intent = view.legalIntents.find((candidate) => candidate.command.type === 'END_TURN');
      }
      if (!intent) throw new Error(`No passive policy command for ${view.phase} at step ${step}.`);
      const command: ConquestCommand = intent.command;
      const activeToken = tokenByAccount.get(room.activeAccountId);
      if (!activeToken) throw new Error('Unknown active account.');
      room = await service.executeCommand(activeToken, room.id, room.revision, command);
      if (command.type === 'PLAY_CARD') playedMovementCard = true;
      if (command.type === 'END_TURN') playedMovementCard = false;
    }

    expect(room.status).toBe('finished');
    expect(room.view?.phase).toBe('game-over');
    expect(room.view?.scenario.score).toBeDefined();
    expect(room.recentCommands.some((entry) => entry.accountId === owner.account.id)).toBe(true);
    expect(room.recentCommands.some((entry) => entry.accountId === guest.account.id)).toBe(true);
  }, 30_000);
});

describe('multiplayer HTTP API', () => {
  it('supports registration and authenticated account lookup', async () => {
    const { service } = await createService();
    const server = createApiServer(service);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}/api`;
      const registration = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'http-user', password: 'secret12' }),
      });
      expect(registration.status).toBe(201);
      const session = await registration.json() as { token: string; account: { username: string } };
      const me = await fetch(`${baseUrl}/me`, { headers: { authorization: `Bearer ${session.token}` } });
      expect(me.status).toBe(200);
      await expect(me.json()).resolves.toMatchObject({ username: 'http-user' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
