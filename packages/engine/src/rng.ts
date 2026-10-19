function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 1;
}

export function createRngState(seed: string): number {
  return hashSeed(seed);
}

export function nextRandom(state: number): { state: number; value: number } {
  let next = state >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;
  return { state: next || 1, value: next / 0x1_0000_0000 };
}

export function shuffleWithState<T>(items: readonly T[], rngState: number): { items: T[]; state: number } {
  const shuffled = [...items];
  let state = rngState;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const random = nextRandom(state);
    state = random.state;
    const swapIndex = Math.floor(random.value * (index + 1));
    const value = shuffled[index];
    shuffled[index] = shuffled[swapIndex] as T;
    shuffled[swapIndex] = value as T;
  }
  return { items: shuffled, state };
}

export function pickWithState<T>(items: readonly T[], rngState: number): { item: T; state: number } {
  if (items.length === 0) {
    throw new Error('Cannot pick from an empty collection.');
  }
  const random = nextRandom(rngState);
  return { item: items[Math.floor(random.value * items.length)] as T, state: random.state };
}

