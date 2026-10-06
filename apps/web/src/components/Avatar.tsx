import type { Bottom, Extra, Outer, Outfit, Top } from '../types/outfit';

type OuterLayerKind = Exclude<Outer, 'none'>;

const SKIN = '#f6d3b3';
const HAIR = '#4a3426';
const INK = '#2b2b2b';
const OUTLINE = { stroke: '#1f2a1f', strokeOpacity: 0.18, strokeWidth: 2, strokeLinejoin: 'round' } as const;

const TOP_COLORS: Record<Top, string> = {
  tshirt: '#8ec5e8',
  longsleeve: '#a8d5a2',
  knit: '#e3b178',
  hoodie: '#9a9cb0',
};
const OUTER_COLORS: Record<OuterLayerKind, string> = {
  light_jacket: '#5b7bb0',
  trench: '#d2b48c',
  coat: '#4b4f5c',
  padded: '#2f5d6e',
};
const OUTER_HEM_Y: Record<OuterLayerKind, number> = {
  light_jacket: 206,
  trench: 246,
  coat: 240,
  padded: 212,
};

const TORSO = 'M70 126 Q70 112 86 112 H114 Q130 112 130 126 L134 204 H66 Z';

function Arm({
  side,
  sleeveColor,
  longSleeve,
  handColor,
}: {
  side: 'left' | 'right';
  sleeveColor: string;
  longSleeve: boolean;
  handColor: string;
}) {
  const shoulderX = side === 'left' ? 72 : 128;
  const angle = side === 'left' ? 12 : -12;
  return (
    <g transform={`translate(${shoulderX} 118) rotate(${angle})`} {...OUTLINE}>
      <rect x={-9} y={0} width={18} height={70} rx={9} fill={SKIN} />
      <rect x={-9.5} y={0} width={19} height={longSleeve ? 66 : 28} rx={9} fill={sleeveColor} />
      <circle cx={0} cy={74} r={9} fill={handColor} />
    </g>
  );
}

function Legs({ bottom }: { bottom: Bottom }) {
  const color = bottom === 'pants' ? '#3d4f75' : '#c9b48a';
  const length = bottom === 'pants' ? 70 : 30;
  return (
    <g {...OUTLINE}>
      {[74, 104].map((x) => (
        <rect key={`skin-${x}`} x={x} y={198} width={22} height={70} rx={8} fill={SKIN} />
      ))}
      <rect x={72} y={194} width={56} height={14} rx={6} fill={color} />
      {[74, 104].map((x) => (
        <g key={x}>
          <rect x={x - 1} y={196} width={24} height={length} rx={8} fill={color} />
          <path d={`M${x - 6} 274 Q${x - 6} 262 ${x + 11} 262 Q${x + 28} 262 ${x + 28} 274 Z`} fill="#fdfdfd" />
        </g>
      ))}
    </g>
  );
}

function TopLayer({ top }: { top: Top }) {
  return (
    <g>
      <path d={TORSO} fill={TOP_COLORS[top]} {...OUTLINE} />
      <path d="M90 112 Q100 122 110 112 Z" fill={SKIN} />
      {top === 'longsleeve' &&
        [140, 164, 188].map((y) => <rect key={y} x={72} y={y} width={56} height={6} fill="#fff" opacity={0.45} />)}
      {top === 'knit' && (
        <g>
          {[82, 91, 100, 109, 118].map((x) => (
            <line key={x} x1={x} y1={128} x2={x} y2={190} stroke="#fff" strokeOpacity={0.3} strokeWidth={2} />
          ))}
          <rect x={66} y={192} width={68} height={12} rx={4} fill="#000" opacity={0.12} />
        </g>
      )}
      {top === 'hoodie' && (
        <g>
          <path d="M76 118 Q100 138 124 118 L120 108 Q100 122 80 108 Z" fill="#7d7f94" {...OUTLINE} />
          <line x1={94} y1={124} x2={92} y2={148} stroke="#f4f4f4" strokeWidth={2} strokeLinecap="round" />
          <line x1={106} y1={124} x2={108} y2={148} stroke="#f4f4f4" strokeWidth={2} strokeLinecap="round" />
          <path d="M80 168 H120 L124 192 H76 Z" fill="#000" opacity={0.1} />
        </g>
      )}
    </g>
  );
}

function OuterLayer({ outer }: { outer: OuterLayerKind }) {
  const color = OUTER_COLORS[outer];
  const hemY = OUTER_HEM_Y[outer];

  if (outer === 'padded') {
    return (
      <g {...OUTLINE}>
        <path
          d={`M66 128 Q66 110 86 110 H114 Q134 110 134 128 L138 ${hemY} Q100 ${hemY + 6} 62 ${hemY} Z`}
          fill={color}
        />
        {[136, 160, 184].map((y) => (
          <path
            key={y}
            d={`M68 ${y} Q100 ${y + 5} 132 ${y}`}
            fill="none"
            stroke="#fff"
            strokeOpacity={0.3}
            strokeWidth={2.5}
          />
        ))}
        <rect x={82} y={104} width={36} height={14} rx={7} fill={color} />
        <line x1={100} y1={118} x2={100} y2={hemY + 2} stroke="#fff" strokeOpacity={0.5} />
      </g>
    );
  }

  const isLong = outer !== 'light_jacket';
  const panelBottom = isLong ? { left: 62, right: 138 } : { left: 66, right: 134 };
  return (
    <g>
      <g {...OUTLINE} fill={color}>
        <path d={`M70 126 Q70 112 86 112 H95 L92 ${hemY} H${panelBottom.left} Z`} />
        <path d={`M130 126 Q130 112 114 112 H105 L108 ${hemY} H${panelBottom.right} Z`} />
      </g>
      <g fill="#000" opacity={0.15}>
        <path d="M86 112 H95 L93 148 L80 128 Z" />
        <path d="M114 112 H105 L107 148 L120 128 Z" />
      </g>
      {outer === 'light_jacket' && <rect x={66} y={hemY - 8} width={68} height={8} rx={3} fill="#000" opacity={0.15} />}
      {outer === 'trench' && (
        <g>
          <rect x={62} y={186} width={76} height={8} rx={2} fill="#b08f63" />
          {[140, 162].map((y) => (
            <g key={y} fill="#7a5c3a">
              <circle cx={87} cy={y} r={2.5} />
              <circle cx={113} cy={y} r={2.5} />
            </g>
          ))}
        </g>
      )}
      {outer === 'coat' && [146, 172, 198].map((y) => <circle key={y} cx={88} cy={y} r={2.5} fill="#1d1f24" />)}
    </g>
  );
}

function Scarf() {
  return (
    <g fill="#c4475a" {...OUTLINE}>
      <rect x={106} y={114} width={12} height={46} rx={4} />
      <rect x={76} y={106} width={48} height={16} rx={8} />
    </g>
  );
}

function Head({ extras }: { extras: Extra[] }) {
  return (
    <g>
      <rect x={92} y={104} width={16} height={14} fill={SKIN} />
      <circle cx={100} cy={72} r={44} fill={SKIN} {...OUTLINE} />
      <path d="M56 78 Q52 24 100 26 Q148 24 144 78 Q140 60 128 52 Q112 64 86 60 Q70 62 56 78 Z" fill={HAIR} />

      {[84, 116].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={82} rx={4} ry={5.5} fill={INK} />
          <circle cx={x + 1.5} cy={80} r={1.4} fill="#fff" />
          <ellipse cx={x < 100 ? x - 10 : x + 10} cy={94} rx={7} ry={4} fill="#f28b82" opacity={0.35} />
        </g>
      ))}
      <path d="M93 98 Q100 104 107 98" stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" />

      {extras.includes('mask') && (
        <g>
          <path d="M78 94 L58 84 M122 94 L142 84" stroke="#d5d5d5" strokeWidth={1.5} />
          <rect x={78} y={88} width={44} height={24} rx={10} fill="#fff" stroke="#d5d5d5" />
          <path d="M84 96 H116 M84 104 H116" stroke="#e4e4e4" strokeWidth={1.5} />
        </g>
      )}
      {extras.includes('sunglasses') && (
        <g fill="#222">
          <rect x={70} y={74} width={26} height={15} rx={6} />
          <rect x={104} y={74} width={26} height={15} rx={6} />
          <rect x={96} y={78} width={8} height={2.5} />
          <path d="M74 78 L80 78" stroke="#fff" strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" />
          <path d="M108 78 L114 78" stroke="#fff" strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" />
        </g>
      )}
      {extras.includes('cap') && (
        <g fill="#d9534f" {...OUTLINE}>
          <path d="M55 70 Q55 20 100 20 Q145 20 145 70 Q100 58 55 70 Z" />
          <path d="M100 64 Q140 58 166 68 Q160 78 128 74 Q110 70 100 70 Z" />
          <circle cx={100} cy={21} r={4} />
        </g>
      )}
    </g>
  );
}

function Umbrella() {
  return (
    <g>
      <path d="M143.5 6 V196 Q143.5 204 136 204" stroke="#555" strokeWidth={3} fill="none" strokeLinecap="round" />
      <path
        d="M92 6 Q144 -48 196 6 Q183 -2 170 6 Q157 -2 144 6 Q131 -2 118 6 Q105 -2 92 6 Z"
        fill="#5b8def"
        {...OUTLINE}
      />
    </g>
  );
}

export function Avatar({ outfit }: { outfit: Outfit }) {
  const { top, bottom, outer, extras } = outfit;
  const sleeveColor = outer === 'none' ? TOP_COLORS[top] : OUTER_COLORS[outer];
  const longSleeve = !(outer === 'none' && top === 'tshirt');
  const handColor = extras.includes('gloves') ? '#8a5aa0' : SKIN;

  return (
    <svg className="avatar" viewBox="0 -50 200 330" role="img" aria-label="Avatar wearing the suggested outfit">
      {extras.includes('umbrella') && <Umbrella />}
      <Legs bottom={bottom} />
      <Arm side="left" sleeveColor={sleeveColor} longSleeve={longSleeve} handColor={handColor} />
      <Arm side="right" sleeveColor={sleeveColor} longSleeve={longSleeve} handColor={handColor} />
      <TopLayer top={top} />
      {outer !== 'none' && <OuterLayer outer={outer} />}
      {extras.includes('scarf') && <Scarf />}
      <Head extras={extras} />
    </svg>
  );
}
