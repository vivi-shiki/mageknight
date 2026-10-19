import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConquestCommand } from '@mageknight/engine';
import type { RoomSetup } from './model';
import { MultiplayerService, ServiceError } from './service';

const MAX_BODY_BYTES = 256 * 1024;

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new ServiceError(413, 'BODY_TOO_LARGE', '请求内容过大。');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ServiceError(400, 'INVALID_JSON', '请求 JSON 格式无效。');
  }
}

function bearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) throw new ServiceError(401, 'UNAUTHORIZED', '请先登录。');
  return authorization.slice(7);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createApiServer(service: MultiplayerService) {
  return createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', request.headers.origin ?? '*');
    response.setHeader('access-control-allow-headers', 'authorization, content-type');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname;
      if (request.method === 'GET' && path === '/api/health') {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === 'POST' && path === '/api/auth/register') {
        const body = await readJson(request);
        sendJson(response, 201, await service.register(asString(body.username), asString(body.password)));
        return;
      }
      if (request.method === 'POST' && path === '/api/auth/login') {
        const body = await readJson(request);
        sendJson(response, 200, await service.login(asString(body.username), asString(body.password)));
        return;
      }
      if (request.method === 'POST' && path === '/api/auth/logout') {
        await service.logout(bearerToken(request));
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === 'GET' && path === '/api/me') {
        sendJson(response, 200, await service.me(bearerToken(request)));
        return;
      }
      if (request.method === 'GET' && path === '/api/rooms') {
        sendJson(response, 200, await service.listRooms(bearerToken(request)));
        return;
      }
      if (request.method === 'POST' && path === '/api/rooms') {
        const body = await readJson(request);
        sendJson(response, 201, await service.createRoom(bearerToken(request), asString(body.name)));
        return;
      }
      if (request.method === 'POST' && path === '/api/rooms/join') {
        const body = await readJson(request);
        sendJson(response, 200, await service.joinRoom(bearerToken(request), asString(body.code)));
        return;
      }

      const roomMatch = path.match(/^\/api\/rooms\/([^/]+)(?:\/(start|command|claim|pass))?$/);
      if (roomMatch) {
        const roomId = decodeURIComponent(roomMatch[1] ?? '');
        const action = roomMatch[2];
        const token = bearerToken(request);
        if (request.method === 'GET' && !action) {
          sendJson(response, 200, await service.getRoom(token, roomId));
          return;
        }
        if (request.method === 'POST' && action === 'start') {
          const body = await readJson(request);
          sendJson(response, 200, await service.startRoom(token, roomId, body as Partial<RoomSetup>));
          return;
        }
        if (request.method === 'POST' && action === 'command') {
          const body = await readJson(request);
          sendJson(response, 200, await service.executeCommand(token, roomId, Number(body.expectedRevision), body.command as ConquestCommand));
          return;
        }
        if (request.method === 'POST' && action === 'claim') {
          sendJson(response, 200, await service.claimControl(token, roomId));
          return;
        }
        if (request.method === 'POST' && action === 'pass') {
          sendJson(response, 200, await service.passControl(token, roomId));
          return;
        }
      }
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: '接口不存在。' } });
    } catch (cause) {
      if (cause instanceof ServiceError) {
        sendJson(response, cause.status, { error: { code: cause.code, message: cause.message } });
        return;
      }
      console.error(cause);
      sendJson(response, 500, { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误。' } });
    }
  });
}
