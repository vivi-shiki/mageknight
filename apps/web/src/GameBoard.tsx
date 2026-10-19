import { axialToPixel, coordKey } from '@mageknight/engine';
import type { Coord, GameView, LegalIntent, MapSpaceState } from '@mageknight/engine';

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
  return (
    <section aria-labelledby="map-title">
      <h2 id="map-title">地图</h2>
      <svg className="map" viewBox="0 0 680 390" role="img" aria-label="六边形探索地图">
        <g transform="translate(290 195)">
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
                <polygon points={polygonPoints(size - 2)} fill={TERRAIN_COLORS[space.terrain]} stroke={moveIntent ? '#1b6b35' : '#555'} strokeWidth={moveIntent ? 4 : 1.5} />
                <text textAnchor="middle" y="-5">{TERRAIN_LABELS[space.terrain]}</text>
                <text textAnchor="middle" y="13" className="map-detail">{space.site === 'village' ? '村庄' : space.enemyIds.length > 0 ? '敌人' : key}</text>
                {isHero ? <text textAnchor="middle" y="32" className="hero-marker">Tovak</text> : null}
              </g>
            );
          })}
        </g>
      </svg>
    </section>
  );
}
