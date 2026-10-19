import { createConquestContent } from '@mageknight/content';
import type { ConquestContent } from '@mageknight/content';
import { describe, expect, it } from 'vitest';
import { conquestStateHash, createConquestGame, executeConquestIntent, replayConquest } from '..';
import type { ConquestCommand, ConquestReplayInput, ConquestState } from '..';

type GoldenGame = {
  replay: ConquestReplayInput;
  state: ConquestState;
};

function mustExecute(state: ConquestState, command: ConquestCommand, content: ConquestContent): ConquestState {
  const result = executeConquestIntent(state, command, content);
  if (!result.ok) throw new Error(`${command.type} failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function finishDeterministicGame(content: ConquestContent, config: Pick<ConquestReplayInput, 'seed' | 'scenarioId' | 'heroId' | 'difficulty'>): GoldenGame {
  let state = createConquestGame(config, content);
  const commandSequence: ConquestCommand[] = [];
  for (let step = 0; state.scenario.status === 'playing' && step < 500; step += 1) {
    let command: ConquestCommand;
    if (state.phase === 'tactics') {
      const tacticId = Object.values(content.tactics)
        .filter((tactic) => tactic.time === state.time)
        .sort((left, right) => left.initiative - right.initiative)[0]?.id;
      if (!tacticId) throw new Error(`No tactic available for ${state.time}.`);
      command = { type: 'SELECT_TACTIC', tacticId };
    } else if (state.phase === 'decision') {
      const optionId = state.pendingDecision?.options[0]?.id;
      if (!optionId) throw new Error('Decision has no option.');
      command = { type: 'RESOLVE_DECISION', optionId };
    } else if (state.phase === 'movement') {
      if (state.player.zones.deck.length === 0) command = { type: 'DECLARE_END_ROUND' };
      else {
        const cardId = state.player.zones.hand.find((id) => state.player.cardInstances[id]?.definitionId !== 'core.card.wound');
        command = cardId
          ? { type: 'PLAY_CARD', cardId, mode: 'sideways', sidewaysResource: 'move' }
          : { type: 'FINISH_MOVEMENT' };
      }
    } else if (state.phase === 'action') command = { type: 'END_TURN' };
    else throw new Error(`Passive golden policy entered unexpected phase ${state.phase}.`);

    state = mustExecute(state, command, content);
    commandSequence.push(command);
    if (command.type === 'PLAY_CARD' && state.phase === 'movement') {
      const finish: ConquestCommand = { type: 'FINISH_MOVEMENT' };
      state = mustExecute(state, finish, content);
      commandSequence.push(finish);
    }
  }
  if (state.scenario.status === 'playing') throw new Error('Golden game did not reach a terminal state within 500 policy steps.');
  return {
    state,
    replay: {
      ...config,
      enabledModules: [...content.enabledModules],
      contentHash: content.contentHash,
      commandSequence,
    },
  };
}

const cases = [
  {
    name: 'core',
    expected: { hash: '230a19e6', commands: 87 },
    content: createConquestContent([]),
    config: { seed: 'golden-v071-core', scenarioId: 'core.scenario.solo-conquest', heroId: 'core.hero.tovak', difficulty: 'standard' as const },
  },
  {
    name: 'Volkare',
    expected: { hash: '074101cf', commands: 210 },
    content: createConquestContent(['lost-legion.official-v0.6']),
    config: { seed: 'golden-v071-volkare', scenarioId: 'lost-legion.scenario.volkares-quest', heroId: 'lost-legion.hero.wolfhawk', difficulty: 'explorer' as const },
  },
  {
    name: 'Krang',
    expected: { hash: 'da3046c4', commands: 90 },
    content: createConquestContent(['krang.character-v0.7']),
    config: { seed: 'golden-v071-krang', scenarioId: 'core.scenario.solo-conquest', heroId: 'krang.hero.krang', difficulty: 'standard' as const },
  },
  {
    name: 'Tezla',
    expected: { hash: 'bedfa7b8', commands: 64 },
    content: createConquestContent(['shades-of-tezla.official-v0.8']),
    config: { seed: 'golden-v080-tezla', scenarioId: 'tezla.scenario.hidden-valley', heroId: 'tezla.hero.braevalar', difficulty: 'standard' as const },
  },
];

describe('v0.8.0 deterministic conquest closure', () => {
  for (const testCase of cases) {
    it(`GR-80-${testCase.name} reaches game-over and replays every public command`, () => {
      const golden = finishDeterministicGame(testCase.content, testCase.config);
      const first = replayConquest(golden.replay, testCase.content);
      const second = replayConquest(golden.replay, testCase.content);

      expect(first.state.scenario.status).toBe('lost');
      expect(first.state.phase).toBe('game-over');
      expect(first.state.scenario.score).toBeDefined();
      expect(first.stateHashes).toEqual(second.stateHashes);
      expect(first.stateHashes).toHaveLength(golden.replay.commandSequence.length + 1);
      expect(conquestStateHash(first.state)).toBe(conquestStateHash(golden.state));
      expect({ hash: conquestStateHash(first.state), commands: golden.replay.commandSequence.length }).toEqual(testCase.expected);
      expect(first.state.eventLog.some((event) => event.type === 'RoundPrepared')).toBe(true);
      expect(first.state.eventLog.at(-1)?.type).toBe('ScenarioLost');
    });
  }

  it('GR-714 resumes each complete game from a JSON save boundary without divergence', () => {
    for (const testCase of cases) {
      const golden = finishDeterministicGame(testCase.content, testCase.config);
      const midpoint = Math.floor(golden.replay.commandSequence.length / 2);
      let state = replayConquest(golden.replay, testCase.content, midpoint).state;
      state = JSON.parse(JSON.stringify(state)) as ConquestState;
      for (const command of golden.replay.commandSequence.slice(midpoint)) state = mustExecute(state, command, testCase.content);
      expect(conquestStateHash(state)).toBe(conquestStateHash(golden.state));
    }
  });

  it('GR-715 rejects incompatible content and reports the exact illegal command step', () => {
    const testCase = cases[0]!;
    const golden = finishDeterministicGame(testCase.content, testCase.config);
    expect(() => replayConquest({ ...golden.replay, contentHash: 'tampered' }, testCase.content)).toThrow('内容哈希');
    expect(() => replayConquest({ ...golden.replay, commandSequence: [{ type: 'END_TURN' }] }, testCase.content)).toThrow('命令 1 (END_TURN)');
  });
});
