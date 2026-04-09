import React from 'react';

export function OrbitLine({ size, themeColor }) {
  return <div className={`absolute border ${themeColor} rounded-full ${size} transition-colors duration-500`} />;
}

export function PlanetDot({ size, duration, color, glow, dotSize = 'w-1.5 h-1.5', hasRing = false, darkMode = true }) {
  return (
    <div className={`absolute orbit-rotate ${size}`} style={{ animationDuration: duration }}>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
        <div
          className={`relative z-10 rounded-full ${color} ${dotSize} shadow-sm transition-colors duration-500`}
          style={glow ? { boxShadow: glow } : {}}
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
}