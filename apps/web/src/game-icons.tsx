import type { CardDefinition, Terrain } from '@mageknight/content';

// Game-icons.net SVGs are licensed CC BY 3.0. The words are the English visual
// equivalents of the card's asset alias, with a recognizable motif for each.
type Motif = { word: string; artist: 'lorc' | 'delapouite' | 'sbed' | 'willdabeast' };
const motif = (word: string, artist: Motif['artist'] = 'lorc'): Motif => ({ word, artist });

const TERRAIN: Record<Terrain, Motif & { color: string }> = {
  plains: { ...motif('valley'), color: '#648a39' },
  forest: { ...motif('forest', 'delapouite'), color: '#267744' },
  hills: { ...motif('mountains'), color: '#a16d37' },
  desert: { ...motif('desert', 'delapouite'), color: '#b88b28' },
  wasteland: { ...motif('dead-wood'), color: '#795e52' },
  mountain: { ...motif('peaks'), color: '#667381' },
  lake: { ...motif('water-drop', 'sbed'), color: '#287ca4' },
};

const CARD_MOTIFS: Array<[RegExp, Motif]> = [
  [/fireball|fire-bolt|flame|burning|blood-rage|rage|ritual-attack/, motif('fireball')],
  [/ice|frost|chill|cold|snow/, motif('ice-bolt')],
  [/shield|block|defen|protection|toughness|fortitude|resolve|determination/, motif('magic-shield')],
  [/sword|blade|attack|battle|counterattack|crushing|demolish|bash/, motif('crossed-swords')],
  [/bolt|arrow|bow|swift|swiftness|reflex|agility|dodge/, motif('arrow-flights')],
  [/mountain|tremor/, motif('mountains')],
  [/forest|nature|druid|land|pathfind|paths/, motif('forest', 'delapouite')],
  [/water|mist|restoration|cure|heal|tranquility|rejuvenate|regeneration|peaceful/, motif('shining-heart')],
  [/wind|whirlwind|storm|wings/, motif('whirlwind')],
  [/march|walk|travel|boots|tireless|stamina|portal|space-bending/, motif('boot-prints')],
  [/mana|magic|spell|crystal|gem|diamond|emerald|sapphire|amulet|ring/, motif('crystal-ball')],
  [/banner|command|call-to-arms|chivalry|noble|promise|diplomacy|influence|charm|offering/, motif('rally-the-troops')],
  [/horn|song/, motif('horn-internal')],
  [/book|tome|lore|training|proficiency|meditation|mind-read|concentration|focus/, motif('spell-book', 'delapouite')],
  [/blood|harvest|darkness|fear|threaten|intimidate|coercion|wound/, motif('bleeding-heart')],
  [/gold|grail|pouch/, motif('gold-bar', 'willdabeast')],
  [/staff|wand/, motif('wizard-staff')],
  [/ambush|expose|instinct|improvisation|versatility|one-with/, motif('crystal-eye')],
  [/heroic|courage/, motif('rally-the-troops')],
];

function svgUrl(icon: Motif) {
  return `/game-icons/${icon.artist}-${icon.word}.svg`;
}

export function cardIcon(card: CardDefinition) {
  const alias = card.assetAlias.toLowerCase();
  const chosen = CARD_MOTIFS.find(([pattern]) => pattern.test(alias))?.[1] ?? motif('spell-book', 'delapouite');
  const color = ({ red: '#a93e38', blue: '#326baf', green: '#418148', white: '#9d792d' } as const)[card.color];
  return { ...chosen, color, src: svgUrl(chosen) };
}

export function terrainIcon(terrain: Terrain) {
  const chosen = TERRAIN[terrain];
  return { ...chosen, src: svgUrl(chosen) };
}

export function CardArt({ card }: { card: CardDefinition }) {
  const icon = cardIcon(card);
  return <div className="card-art" style={{ backgroundColor: `${icon.color}20`, borderColor: icon.color }}>
    <span className="card-art-icon" role="img" aria-label={`${card.name} 卡图`} style={{ backgroundColor: icon.color, maskImage: `url(${icon.src})` }} />
  </div>;
}

export function TerrainArt({ terrain }: { terrain: Terrain }) {
  const icon = terrainIcon(terrain);
  return <image href={icon.src} x={-17} y={-28} width={34} height={34} aria-hidden="true" pointerEvents="none" />;
}
