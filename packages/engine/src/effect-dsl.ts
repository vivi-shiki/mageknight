import type { CardEffect, EffectNode, EffectTarget, ManaColor, TimeOfDay } from '@mageknight/content';

export type EffectOperation = Exclude<EffectNode,
  | CardEffect
  | { type: 'sequence'; effects: EffectNode[] }
  | { type: 'spend-mana'; color: ManaColor; amount: number }
  | { type: 'repeat'; times: number; effect: EffectNode }
  | { type: 'draw'; amount: number }
  | { type: 'discard'; amount: number; filter?: 'wound' | 'non-wound' | 'any' }
  | { type: 'convert'; from: CardEffect['resource']; to: CardEffect['resource']; amount: number }
  | { type: 'choose-one'; options: EffectNode[]; labels?: string[] }
  | { type: 'conditional'; when: TimeOfDay; then: EffectNode; otherwise?: EffectNode }
  | { type: 'create-lasting-effect'; effect: 'hand-limit' | 'armor' | 'reputation' | 'resource'; amount: number; expires: 'end-turn' | 'start-next-turn' | 'end-round' }
>;

export type EffectEvaluation = {
  gains: CardEffect[];
  manaCosts: Array<{ color: ManaColor; amount: number }>;
  choiceRequired: boolean;
  draws?: number;
  discards?: Array<{ amount: number; filter: 'wound' | 'non-wound' | 'any' }>;
  conversions?: Array<{ from: CardEffect['resource']; to: CardEffect['resource']; amount: number }>;
  lastingEffects?: Array<{ effect: 'hand-limit' | 'armor' | 'reputation' | 'resource'; amount: number; expires: 'end-turn' | 'start-next-turn' | 'end-round' }>;
  operations?: EffectOperation[];
  choiceLabels?: string[];
  targetRequired?: EffectTarget;
};

export type EffectContext = {
  time: TimeOfDay;
  choiceIndex?: number;
  targetId?: string;
};

function emptyEvaluation(): EffectEvaluation {
  return { gains: [], manaCosts: [], choiceRequired: false };
}

function mergeEvaluations(left: EffectEvaluation, right: EffectEvaluation): EffectEvaluation {
  const merged: EffectEvaluation = {
    gains: [...left.gains, ...right.gains],
    manaCosts: [...left.manaCosts, ...right.manaCosts],
    choiceRequired: left.choiceRequired || right.choiceRequired,
  };
  const draws = (left.draws ?? 0) + (right.draws ?? 0);
  if (draws > 0) merged.draws = draws;
  const discards = [...(left.discards ?? []), ...(right.discards ?? [])];
  if (discards.length > 0) merged.discards = discards;
  const conversions = [...(left.conversions ?? []), ...(right.conversions ?? [])];
  if (conversions.length > 0) merged.conversions = conversions;
  const lastingEffects = [...(left.lastingEffects ?? []), ...(right.lastingEffects ?? [])];
  if (lastingEffects.length > 0) merged.lastingEffects = lastingEffects;
  const operations = [...(left.operations ?? []), ...(right.operations ?? [])];
  if (operations.length > 0) merged.operations = operations;
  const choiceLabels = left.choiceLabels ?? right.choiceLabels;
  if (choiceLabels) merged.choiceLabels = choiceLabels;
  const targetRequired = left.targetRequired ?? right.targetRequired;
  if (targetRequired) merged.targetRequired = targetRequired;
  return merged;
}

export function evaluateEffect(node: EffectNode, context: EffectContext): EffectEvaluation {
  if (!('type' in node)) {
    return { gains: [node], manaCosts: [], choiceRequired: false };
  }
  if (node.type === 'spend-mana') {
    return { gains: [], manaCosts: [{ color: node.color, amount: node.amount }], choiceRequired: false };
  }
  if (node.type === 'sequence') {
    return node.effects.reduce((evaluation, effect) => mergeEvaluations(evaluation, evaluateEffect(effect, context)), emptyEvaluation());
  }
  if (node.type === 'repeat') {
    return Array.from({ length: node.times }).reduce<EffectEvaluation>((evaluation) => mergeEvaluations(evaluation, evaluateEffect(node.effect, context)), emptyEvaluation());
  }
  if (node.type === 'draw') return { ...emptyEvaluation(), draws: node.amount };
  if (node.type === 'discard') return { ...emptyEvaluation(), discards: [{ amount: node.amount, filter: node.filter ?? 'any' }] };
  if (node.type === 'convert') return { ...emptyEvaluation(), conversions: [{ from: node.from, to: node.to, amount: node.amount }] };
  if (node.type === 'create-lasting-effect') return { ...emptyEvaluation(), lastingEffects: [{ effect: node.effect, amount: node.amount, expires: node.expires }] };
  if (node.type === 'choose-one') {
    const selected = context.choiceIndex === undefined ? undefined : node.options[context.choiceIndex];
    if (!selected) {
      return { gains: [], manaCosts: [], choiceRequired: true, choiceLabels: node.labels ?? node.options.map((_, index) => `选项 ${index + 1}`) };
    }
    return evaluateEffect(selected, context);
  }
  if (node.type === 'conditional') {
    const branch = context.time === node.when ? node.then : node.otherwise;
    return branch ? evaluateEffect(branch, context) : emptyEvaluation();
  }
  const targetRequired: EffectTarget | undefined = node.type === 'refresh-unit'
    ? 'unit'
    : node.type === 'modify-enemy' && (node.scope ?? 'target') === 'target'
      ? 'enemy'
      : node.type === 'special' ? node.target : undefined;
  return { ...emptyEvaluation(), operations: [node], ...(targetRequired && !context.targetId ? { targetRequired } : {}) };
}
