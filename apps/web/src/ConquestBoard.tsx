import { axialToPixel, coordKey } from '@mageknight/engine';
import type { ConquestIntent, ConquestView } from '@mageknight/engine';
import type { ConquestContent } from '@mageknight/content';
import { useEffect, useMemo, useState } from 'react';

type Props = { view: ConquestView; content: ConquestContent; onIntent: (intent: ConquestIntent) => void };
const LABELS = { plains: '平原', forest: '森林', hills: '丘陵', desert: '沙漠', wasteland: '荒地', mountain: '山脉', lake: '湖泊' } as const;
const COLORS = { plains: '#edf3df', forest: '#c9dfc3', hills: '#e2d4bd', desert: '#f2e7b9', wasteland: '#d8cbc5', mountain: '#d1d1d1', lake: '#c9e5f2' } as const;

function points(size: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = ((60 * index - 30) * Math.PI) / 180;
    return `${(size * Math.cos(angle)).toFixed(2)},${(size * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
}

function wallSegment(left: { x: number; y: number }, right: { x: number; y: number }, size: number) {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const length = Math.hypot(dx, dy) || 1;
  const half = size * 0.48;
  const midpoint = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const perpendicular = { x: (-dy / length) * half, y: (dx / length) * half };
  return { left: { x: midpoint.x - perpendicular.x, y: midpoint.y - perpendicular.y }, right: { x: midpoint.x + perpendicular.x, y: midpoint.y + perpendicular.y } };
}

function isCompactViewport() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches;
}

export function ConquestBoard({ view, content, onIntent }: Props) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const [compact, setCompact] = useState(isCompactViewport);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(max-width: 640px)');
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const moves = useMemo(() => new Map(view.legalIntents.filter((intent) => intent.command.type === 'MOVE_HERO').map((intent) => [coordKey(intent.command.type === 'MOVE_HERO' ? intent.command.to : { q: 0, r: 0 }), intent])), [view.legalIntents]);
  const size = 44;
  const mapBounds = useMemo(() => {
    const points = Object.values(view.map).map((space) => axialToPixel(space.coord, size));
    if (points.length === 0) return { minX: -310, maxX: 310, minY: -210, maxY: 210 };
    return {
      minX: Math.min(...points.map((point) => point.x)) - size * 1.8,
      maxX: Math.max(...points.map((point) => point.x)) + size * 1.8,
      minY: Math.min(...points.map((point) => point.y)) - size * 1.8,
      maxY: Math.max(...points.map((point) => point.y)) + size * 1.8,
    };
  }, [view.map]);
  const naturalWidth = Math.max(compact ? 620 : 900, mapBounds.maxX - mapBounds.minX);
  const naturalHeight = Math.max(compact ? 420 : 520, mapBounds.maxY - mapBounds.minY);
  const width = naturalWidth / zoom;
  const height = naturalHeight / zoom;
  const centerX = (mapBounds.minX + mapBounds.maxX) / 2 + pan;
  const centerY = (mapBounds.minY + mapBounds.maxY) / 2;
  const startX = centerX - width / 2;
  const startY = centerY - height / 2;
  const heroName = content.heroes[view.player.heroId]?.name ?? view.player.heroId;
  const wallSegments = view.walls.flatMap((wall) => {
    const [left, right] = wall.split('|').map((key) => key?.split(',').map(Number));
    if (!left || !right || left.length !== 2 || right.length !== 2) return [];
    return [wallSegment(axialToPixel({ q: left[0]!, r: left[1]! }, size), axialToPixel({ q: right[0]!, r: right[1]! }, size), size)];
  });
  return (
    <section id="map" aria-labelledby="conquest-map-title">
      <h2 id="conquest-map-title">地图</h2>
      <div className="map-tools" aria-label="地图视图控制">
        <button type="button" aria-label="地图向左" title="地图向左" onClick={() => setPan((value) => value - 120)}>←</button>
        <label>缩放 <input aria-label="地图缩放" type="range" min="0.7" max="1.8" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <button type="button" aria-label="地图向右" title="地图向右" onClick={() => setPan((value) => value + 120)}>→</button>
      </div>
      <svg className="conquest-map" viewBox={`${startX} ${startY} ${width} ${height}`} role="img" aria-label="v0.8.0 征服地图">
        <g>
          {Object.values(view.map).map((space) => {
            const point = axialToPixel(space.coord, size);
            const key = coordKey(space.coord);
            const intent = moves.get(key);
            const site = space.siteId ? content.sites[space.siteId] : undefined;
            const overlayState = view.overlays[key];
            const overlay = overlayState ? content.siteOverlays[overlayState.definitionId] : undefined;
            const leader = Object.values(view.factionLeaders).find((candidate) => candidate.position && coordKey(candidate.position) === key && !candidate.defeated);
            const leaderDefinition = leader ? content.factionLeaders[leader.definitionId] : undefined;
            const siteLabel = overlay?.name ?? site?.name;
            return (
              <g key={key} transform={`translate(${point.x} ${point.y})`} className={intent ? 'hex legal' : 'hex'} role="button" tabIndex={0}
                aria-label={`${key} ${LABELS[space.terrain]}${siteLabel ? ` ${siteLabel}` : ''}${leaderDefinition ? ` ${leaderDefinition.name} 等级${leader?.level}` : ''}${space.enemyIds.length ? ` 敌人${space.enemyIds.length}` : ''}${intent ? '，可移动' : ''}`}
                onClick={() => intent && onIntent(intent)} onKeyDown={(event) => { if (intent && (event.key === 'Enter' || event.key === ' ')) onIntent(intent); }}>
                <polygon points={points(size - 1)} fill={COLORS[space.terrain]} stroke={intent ? '#176b36' : '#666'} strokeWidth={intent ? 3 : 1} />
                <text textAnchor="middle" y="-5">{LABELS[space.terrain]}</text>
                <text textAnchor="middle" y="9" className="map-detail">{siteLabel ? `${siteLabel}${overlayState?.sealed ? '封' : overlayState?.liberated || space.conquered ? '✓' : ''}` : key}</text>
                {space.enemyIds.length ? <text textAnchor="middle" y="22" className="enemy-marker">敌×{space.enemyIds.length}</text> : null}
                {coordKey(view.player.position) === key ? <text textAnchor="middle" y="-19" className="hero-marker">{heroName}</text> : null}
                {view.volkare?.revealed && coordKey(view.volkare.position) === key ? <text textAnchor="middle" y="34" className="enemy-marker">Volkare</text> : null}
                {leaderDefinition ? <text textAnchor="middle" y="34" className="enemy-marker">{leaderDefinition.name} Lv{leader?.level}</text> : null}
              </g>
            );
          })}
          {wallSegments.map((wall, index) => <line key={`wall-${index}`} x1={wall.left.x} y1={wall.left.y} x2={wall.right.x} y2={wall.right.y} stroke="#222" strokeWidth="5" strokeLinecap="round" pointerEvents="none" />)}
        </g>
      </svg>
    </section>
  );
}
