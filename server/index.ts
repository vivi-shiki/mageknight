import path from 'node:path';
import { createApiServer } from './http';
import { MultiplayerService } from './service';

const port = Number(process.env.MULTIPLAYER_PORT ?? 4174);
const dataFile = path.resolve(process.env.MULTIPLAYER_DATA_FILE ?? 'data/multiplayer.json');
const service = await MultiplayerService.open(dataFile);
const server = createApiServer(service);

server.listen(port, '127.0.0.1', () => {
  console.log(`Mage Knight multiplayer API: http://127.0.0.1:${port}`);
  console.log(`Data file: ${dataFile}`);
});
