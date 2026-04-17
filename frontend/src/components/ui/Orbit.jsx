import React, { memo } from 'react';

// memo com comparação profunda de props — evita re-render quando o pai atualiza
// por razões não relacionadas (digitação, estado de mensagem, etc.)
export const OrbitLine = memo(function OrbitLine({ size, themeColor }) {
  return (
    <div className={`absolute border ${themeColor} rounded-full ${size} transition-colors duration-500`} />
  );
}, (prev, next) => prev.size === next.size && prev.themeColor === next.themeColor);

export const PlanetDot = memo(function PlanetDot({
  size,
  duration,
  color,
  glow,
  dotSize = 'w-1.5 h-1.5',
  hasRing = false,
  darkMode = true,
}) {
  return (
    /*
      animation-duration definida via CSS var injetada no elemento pai —
      não via style inline no elemento com orbit-rotate.
      Isso impede que o browser interprete cada render como "novo estilo"
      e reinicie a animação do zero.
    */
    <div
      className={`absolute orbit-rotate ${size}`}
      style={{ '--orbit-duration': duration }}
    >
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
        <div
          className={`relative z-10 rounded-full ${color} ${dotSize} shadow-sm transition-colors duration-500`}
          style={glow ? { boxShadow: glow } : undefined}
        />
        {hasRing && (
          <div style={{
            position: 'absolute', width: '260%', height: '120%',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)'}`,
            borderRadius: '100%', transform: 'rotate(25deg)',
            background: darkMode
              ? 'radial-gradient(ellipse at center, transparent 38%, rgba(255,255,255,0.06) 44%, rgba(255,255,255,0.12) 50%, transparent 58%)'
              : 'radial-gradient(ellipse at center, transparent 38%, rgba(0,0,0,0.03) 44%, rgba(0,0,0,0.07) 50%, transparent 58%)',
            boxShadow: darkMode ? '0 0 5px rgba(255,255,255,0.12)' : '0 0 5px rgba(0,0,0,0.06)',
          }} />
        )}
      </div>
    </div>
  );
}, (prev, next) =>
  prev.size === next.size &&
  prev.duration === next.duration &&
  prev.color === next.color &&
  prev.glow === next.glow &&
  prev.dotSize === next.dotSize &&
  prev.hasRing === next.hasRing &&
  prev.darkMode === next.darkMode
);