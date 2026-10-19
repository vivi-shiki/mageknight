import type { ConquestCommand, ConquestView } from '@mageknight/engine';
import type { ConquestModuleId, Difficulty } from '@mageknight/content';

export type OnlineAccount = { id: string; username: string };
export type OnlineRoomSetup = {
  seed: string;
  difficulty: Difficulty;
  heroId: string;
  scenarioId: string;
  modules: ConquestModuleId[];
};
export type OnlineRoomSummary = {
  id: string;
  code: string;
  name: string;
  status: 'lobby' | 'playing' | 'finished';
  hostAccountId: string;
  memberCount: number;
  isMember: boolean;
  updatedAt: string;
};
export type OnlineRoom = OnlineRoomSummary & {
  members: OnlineAccount[];
  activeAccountId?: string;
  setup: OnlineRoomSetup;
  revision: number;
  view?: ConquestView;
  recentCommands: Array<{ revision: number; accountId: string; commandType: string; createdAt: string }>;
};

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const data = await response.json() as T & { error?: { code?: string; message?: string } };
  if (!response.ok) throw new ApiError(response.status, data.error?.code ?? 'REQUEST_FAILED', data.error?.message ?? '请求失败。');
  return data;
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) });

export const onlineApi = {
  register: (username: string, password: string) => request<{ token: string; account: OnlineAccount }>('/auth/register', post({ username, password })),
  login: (username: string, password: string) => request<{ token: string; account: OnlineAccount }>('/auth/login', post({ username, password })),
  logout: (token: string) => request<{ ok: true }>('/auth/logout', post(), token),
  me: (token: string) => request<OnlineAccount>('/me', {}, token),
  rooms: (token: string) => request<OnlineRoomSummary[]>('/rooms', {}, token),
  createRoom: (token: string, name: string) => request<OnlineRoom>('/rooms', post({ name }), token),
  joinRoom: (token: string, code: string) => request<OnlineRoom>('/rooms/join', post({ code }), token),
  room: (token: string, roomId: string) => request<OnlineRoom>(`/rooms/${encodeURIComponent(roomId)}`, {}, token),
  startRoom: (token: string, roomId: string, setup: OnlineRoomSetup) => request<OnlineRoom>(`/rooms/${encodeURIComponent(roomId)}/start`, post(setup), token),
  command: (token: string, roomId: string, expectedRevision: number, command: ConquestCommand) => request<OnlineRoom>(`/rooms/${encodeURIComponent(roomId)}/command`, post({ expectedRevision, command }), token),
  claim: (token: string, roomId: string) => request<OnlineRoom>(`/rooms/${encodeURIComponent(roomId)}/claim`, post(), token),
  pass: (token: string, roomId: string) => request<OnlineRoom>(`/rooms/${encodeURIComponent(roomId)}/pass`, post(), token),
};
