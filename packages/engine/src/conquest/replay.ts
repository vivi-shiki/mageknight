import type { ConquestContent, Difficulty } from '@mageknight/content';
import { createConquestGame } from './create';
import { conquestStateHash, executeConquestIntent } from './engine';
import type { ConquestCommand, ConquestState } from './types';

export type ConquestReplayInput = {
  seed: string;
  scenarioId: string;
  heroId: string;
  difficulty: Difficulty;
  enabledModules: string[];
  contentHash: string;
  commandSequence: ConquestCommand[];
};

export type ConquestReplayResult = {
  state: ConquestState;
  stateHashes: string[];
};

export class ConquestReplayError extends Error {
  constructor(message: string, readonly commandIndex?: number) {
    super(message);
    this.name = 'ConquestReplayError';
  }
}

export function replayConquest(
  replay: ConquestReplayInput,
  content: ConquestContent,
  commandLimit = replay.commandSequence.length,
): ConquestReplayResult {
  if (replay.contentHash !== content.contentHash) throw new ConquestReplayError('回放内容哈希与当前内容不一致。');
  if (replay.enabledModules.join('|') !== content.enabledModules.join('|')) throw new ConquestReplayError('回放模块组合与当前内容不一致。');
  if (!content.scenarios[replay.scenarioId]) throw new ConquestReplayError(`回放场景不存在：${replay.scenarioId}。`);
  if (!content.heroes[replay.heroId]) throw new ConquestReplayError(`回放英雄不存在：${replay.heroId}。`);
  if (!Number.isInteger(commandLimit) || commandLimit < 0 || commandLimit > replay.commandSequence.length) throw new ConquestReplayError('回放步数超出命令序列范围。');

  let state = createConquestGame({ seed: replay.seed, scenarioId: replay.scenarioId, heroId: replay.heroId, difficulty: replay.difficulty }, content);
  const stateHashes = [conquestStateHash(state)];
  for (let index = 0; index < commandLimit; index += 1) {
    const command = replay.commandSequence[index];
    if (!command) throw new ConquestReplayError(`回放命令 ${index + 1} 缺失。`, index);
    const result = executeConquestIntent(state, command, content);
    if (!result.ok) throw new ConquestReplayError(`回放命令 ${index + 1} (${command.type}) 失败：${result.error.code} ${result.error.message}`, index);
    state = result.state;
    stateHashes.push(conquestStateHash(state));
  }
  return { state, stateHashes };
}
