import { axialToPixel, coordKey } from '@mageknight/engine';
import type { Coord, GameView, LegalIntent, MapSpaceState } from '@mageknight/engine';
import { TerrainArt } from './game-icons';

type GameBoardProps = {
  view: GameView;
  onIntent: (intent: LegalIntent) => void;
  onInvalidMove: (coord: Coord) => void;
};

const TERRAIN_LABELS: Record<MapSpaceState['terrain'], string> = {
  plains: '平原',
  forest: '森林',
  hills: '丘陵',
  desert: '沙漠',
  wasteland: '荒地',
  mountain: '山脉',
  lake: '湖泊',
};

const TERRAIN_COLORS: Record<MapSpaceState['terrain'], string> = {
  plains: '#dce8c8',
  forest: '#a9c6a0',
  hills: '#d8c4a5',
  desert: '#eadca4',
  wasteland: '#c9b7ae',
  mountain: '#b8b8b8',
  lake: '#b7d8ea',
};

function polygonPoints(size: number): string {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = ((60 * index - 30) * Math.PI) / 180;
    return `${size * Math.cos(angle)},${size * Math.sin(angle)}`;
  }).join(' ');
}

export function GameBoard({ view, onIntent, onInvalidMove }: GameBoardProps) {
  const moveIntents = new Map(
    view.legalIntents
      .filter((intent) => intent.command.type === 'MOVE_HERO')
      .map((intent) => [coordKey(intent.command.type === 'MOVE_HERO' ? intent.command.to : { q: 0, r: 0 }), intent]),
  );
  const size = 48;
  const centers = Object.values(view.map).map((space) => axialToPixel(space.coord, size));
  const padding = size * 1.2;
  const minX = Math.min(...centers.map((point) => point.x)) - padding;
  const maxX = Math.max(...centers.map((point) => point.x)) + padding;
  const minY = Math.min(...centers.map((point) => point.y)) - padding;
  const maxY = Math.max(...centers.map((point) => point.y)) + padding;
  return (
    <section aria-labelledby="map-title">
      <h2 id="map-title">地图</h2>
      <svg className="map" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} role="img" aria-label="六边形探索地图">
        <g>
          {Object.values(view.map).map((space) => {
            const key = coordKey(space.coord);
            const point = axialToPixel(space.coord, size);
            const moveIntent = moveIntents.get(key);
            const isHero = coordKey(view.player.position) === key;
            return (
              <g
                key={key}
                transform={`translate(${point.x} ${point.y})`}
                onClick={() => moveIntent ? onIntent(moveIntent) : onInvalidMove(space.coord)}
                className={moveIntent ? 'hex legal' : 'hex'}
                role="button"
                tabIndex={0}
                aria-label={`${key} ${TERRAIN_LABELS[space.terrain]}${moveIntent ? '，可移动' : ''}`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    if (moveIntent) onIntent(moveIntent);
                    else onInvalidMove(space.coord);
                  }
                }}
              >
                <polygon points={polygonPoints(size)} fill={TERRAIN_COLORS[space.terrain]} stroke={moveIntent ? '#1b6b35' : '#555'} strokeWidth={moveIntent ? 4 : 1.5} />
                <TerrainArt terrain={space.terrain} />
                <text textAnchor="middle" y="12">{TERRAIN_LABELS[space.terrain]}</text>
                <text textAnchor="middle" y="25" className="map-detail">{space.site === 'village' ? '村庄' : space.enemyIds.length > 0 ? '敌人' : key}</text>
                {isHero ? <text textAnchor="middle" y="-35" className="hero-marker">Tovak</text> : null}
              </g>
            );
          })}
        </g>
      </svg>
    </section>
  );
}
