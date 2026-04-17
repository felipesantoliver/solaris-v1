import React, { memo } from 'react';
import { OrbitLine, PlanetDot } from './Orbit';

/*
  React.memo com comparador customizado:
  SolarSystem só re-renderiza se darkMode ou theme.orbit mudarem
  (ex: usuário troca light/dark). Digitação, envio de mensagem,
  loading state — nada disso causa re-render aqui.
*/
export const SolarSystem = memo(function SolarSystem({ darkMode, theme }) {
  return (
    <div className="relative w-full aspect-square flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity duration-700 mb-10 shrink-0">
      {/* Sol */}
      <div
        className={`w-6 h-6 ${darkMode ? 'bg-[#ffd700]' : 'bg-[#ffcc00] border border-amber-600/10'} rounded-full z-10`}
        style={{ boxShadow: '0 0 25px rgba(255,204,0,0.35)' }}
      />

      {/* Órbitas */}
      <OrbitLine size="w-10 h-10"  themeColor={theme.orbit} />
      <OrbitLine size="w-14 h-14"  themeColor={theme.orbit} />
      <OrbitLine size="w-20 h-20"  themeColor={theme.orbit} />
      <OrbitLine size="w-24 h-24"  themeColor={theme.orbit} />
      <OrbitLine size="w-32 h-32"  themeColor={theme.orbit} />
      <OrbitLine size="w-40 h-40"  themeColor={theme.orbit} />
      <OrbitLine size="w-48 h-48"  themeColor={theme.orbit} />
      <OrbitLine size="w-56 h-56"  themeColor={theme.orbit} />

      {/* Planetas — duration fixa, nunca muda entre renders */}
      <PlanetDot size="w-10 h-10" duration="3s"  color={darkMode ? 'bg-[#888]' : 'bg-[#666]'} dotSize="w-1 h-1"   darkMode={darkMode} />
      <PlanetDot size="w-14 h-14" duration="5s"  color="bg-[#e3bb76]"  dotSize="w-1.5 h-1.5" darkMode={darkMode} />
      <PlanetDot size="w-20 h-20" duration="8s"  color="bg-[#2271b3]"  dotSize="w-2 h-2"     glow={darkMode ? '0 0 10px rgba(34,113,179,0.9)' : '0 0 8px rgba(34,113,179,0.5)'} darkMode={darkMode} />
      <PlanetDot size="w-24 h-24" duration="12s" color="bg-[#e27b58]"  dotSize="w-1 h-1"     darkMode={darkMode} />
      <PlanetDot size="w-32 h-32" duration="20s" color="bg-[#d39c7e]"  dotSize="w-2.5 h-2.5" darkMode={darkMode} />
      <PlanetDot size="w-40 h-40" duration="28s" color="bg-[#eadaa4]"  dotSize="w-2 h-2"     hasRing darkMode={darkMode} />
      <PlanetDot size="w-48 h-48" duration="36s" color="bg-[#a6d1e6]"  dotSize="w-1.5 h-1.5" darkMode={darkMode} />
      <PlanetDot size="w-56 h-56" duration="45s" color="bg-[#4b70dd]"  dotSize="w-1.5 h-1.5" darkMode={darkMode} />
    </div>
  );
}, (prev, next) =>
  prev.darkMode === next.darkMode &&
  prev.theme?.orbit === next.theme?.orbit
);