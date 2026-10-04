'use strict';
const fs = require('node:fs');
const path = require('node:path');
const shapes = {
  seed: '<path d="M28 52Q19 22 48 18Q71 40 43 59Z" fill="#eed787"/><path d="m31 49 18-25" stroke="#886c36"/>',
  leaf: '<path d="M17 51Q14 17 56 15Q59 56 17 51Z" fill="#a5df86"/><path d="m17 51 31-28m-18 4 1 12 13 1" stroke="#46785a"/>',
  bolt: '<path d="m39 10-21 28h17l-8 25 25-32H36Z" fill="#ffe395"/>',
  heart: '<path d="M36 57 14 36C-1 16 23 7 36 23C49 7 73 16 58 36Z" fill="#f2a2a2"/>',
  shield: '<path d="m36 10 24 9-4 25-20 18-20-18-4-25Z" fill="#b4cca5"/><path d="m25 35 8 9 16-19" stroke="#436552" stroke-width="5" fill="none"/>',
  cross: '<path d="M30 14h12v16h16v12H42v16H30V42H14V30h16Z" fill="#d2f0ab"/>',
  snow: '<g stroke="#c1eaff" stroke-width="4"><path d="M36 9v54M13 23l46 26M13 49l46-26M29 13l7 7 7-7M29 59l7-7 7 7M13 31l10-3-2-10M59 41l-10 3 2 10M13 41l10 3-2 10M59 31l-10-3 2-10"/></g>',
  flame: '<path d="M39 8c3 19 18 21 18 37C57 67 13 68 15 43c1-12 10-18 13-24 0 14 6 12 11-11Z" fill="#f4ac70"/><path d="M37 32c2 12 12 14 9 22-6 10-21 1-17-8Z" fill="#ffe3a0"/>',
  ring: '<circle cx="36" cy="36" r="23" fill="none" stroke="#d5cb97" stroke-width="6"/><circle cx="36" cy="36" r="12" fill="none" stroke="#b8dc97" stroke-width="3"/><circle cx="36" cy="36" r="4" fill="#f9e6ae"/>',
  bee: '<ellipse cx="27" cy="20" rx="10" ry="14" fill="#daeee1" transform="rotate(-25 27 20)"/><ellipse cx="45" cy="20" rx="10" ry="14" fill="#daeee1" transform="rotate(25 45 20)"/><ellipse cx="36" cy="39" rx="20" ry="14" fill="#f3d37b"/><path d="M29 27v24m13-24v24" stroke="#76583e" stroke-width="6"/><circle cx="51" cy="35" r="2" fill="#2d4236"/>',
  arrow: '<path d="M13 36h44m-17-18 18 18-18 18" fill="none" stroke="#cae9b7" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>',
  star: '<path d="m36 9 7 19 21 1-17 13 6 21-17-12-17 12 6-21L8 29l21-1Z" fill="#ffe9a4"/>',
  clock: '<circle cx="36" cy="36" r="25" fill="#9bbda3"/><circle cx="36" cy="36" r="19" fill="#294638"/><path d="M36 22v15l11 7" stroke="#f3e5b0" stroke-width="5" fill="none" stroke-linecap="round"/>',
  eye: '<path d="M8 36Q36 2 64 36Q36 70 8 36Z" fill="#b5d6a1"/><circle cx="36" cy="36" r="13" fill="#315b47"/><circle cx="39" cy="32" r="4" fill="#fff1c6"/>',
  book: '<path d="M8 17Q23 10 36 18Q49 10 64 17v40Q49 50 36 58Q23 50 8 57Z" fill="#dacb99"/><path d="M36 18v40M16 26h12m-12 9h12m16-9h12m-12 9h12" stroke="#56734c" stroke-width="3"/>',
  drop: '<path d="M36 9C28 25 13 35 15 46c3 24 41 22 42 0C58 34 44 23 36 9Z" fill="#9dd8cb"/><path d="M25 41q-4 10 7 13" stroke="#e4f5cb" stroke-width="4" fill="none" stroke-linecap="round"/>',
  thorn: '<path d="M12 54 24 16l12 23 11-24 13 39Z" fill="#bbd28e"/><path d="M12 55h49" stroke="#ede1a4" stroke-width="5"/>',
  moon: '<path d="M48 12C17 0 1 41 24 59c20 17 42-5 39-20-10 15-35 0-15-27Z" fill="#c7c9ef"/>',
  magnet: '<path d="M16 17v23a20 20 0 0 0 40 0V17" stroke="#adcebb" stroke-width="12" fill="none"/><path d="M16 17v11m40-11v11" stroke="#f1c082" stroke-width="12"/>',
  wave: '<path d="M7 38q10-30 20 0t20 0 20 0" fill="none" stroke="#bcdba0" stroke-width="6" stroke-linecap="round"/>',
  orbit: '<ellipse cx="36" cy="36" rx="28" ry="14" transform="rotate(-30 36 36)" fill="none" stroke="#d6c1ed" stroke-width="4"/><circle cx="36" cy="36" r="9" fill="#e2dcab"/><circle cx="58" cy="22" r="5" fill="#f5b392"/>',
  blade: '<path d="m10 19 32 10 20 32-32-20Z" fill="#a9d9c2"/><path d="m11 19 29 13 21 28" stroke="#edf0b4" stroke-width="3" fill="none"/>',
  sun: '<circle cx="36" cy="36" r="17" fill="#f4db8d"/><path d="M36 5v8m0 46v8M5 36h8m46 0h8M14 14l6 6m32 32 6 6m0-44-6 6M20 52l-6 6" stroke="#f4db8d" stroke-width="4"/>'
};
const motifs = {
  damage:'seed',rate:'arrow',shots:'seed',crit:'star',critDamage:'flame',pierce:'arrow',
  chain:'bolt',leafstorm:'leaf',fireball:'flame',poison:'drop',pulse:'ring',bees:'bee',boomerang:'blade',frostburst:'snow',solar:'sun',ricochet:'orbit',
  speed:'wave',hp:'heart',pickup:'magnet',defense:'shield',regen:'cross',skillCooldown:'clock',xp:'book',range:'eye',projectileSpeed:'arrow',lifeSteal:'drop',dodge:'moon',thorns:'thorn',standPower:'sun',killHeal:'heart',skillPower:'orbit',magnet:'magnet',
  skyweb:'bolt',leafcyclone:'leaf',sunheart:'flame',greenhouse:'drop',earthguard:'shield',queenbees:'bee',everturn:'blade',icegarden:'snow'
};
const out = path.join(__dirname, '..', 'assets', 'skills');
fs.mkdirSync(out, { recursive:true });
Object.entries(motifs).forEach(([id,motif], index) => {
  const superSkill = index >= 32;
  const accent = superSkill ? '#b4a0da' : index < 16 ? '#bd9560' : '#82ac88';
  let center = shapes[motif];
  if (['shots','ricochet','rate','projectileSpeed','killHeal'].includes(id)) center += '<circle cx="61" cy="59" r="10" fill="#325440"/><path d="M56 59h10m-5-5v10" stroke="#ffe6aa" stroke-width="3"/>';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#3b5540"/><stop offset="1" stop-color="#172c24"/></linearGradient></defs><rect x="3" y="3" width="90" height="90" rx="22" fill="url(#bg)" stroke="'+accent+'" stroke-width="2"/><path d="M13 29V20q0-7 7-7h9m38 70h9q7 0 7-7v-9" fill="none" stroke="'+accent+'" opacity=".5" stroke-width="2"/>'+(superSkill?'<circle cx="48" cy="48" r="34" fill="none" stroke="#d6befa" stroke-dasharray="3 7" opacity=".5"/>':'')+'<g transform="translate(12 12)">'+center+'</g>'+(superSkill?'<path d="m77 10 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z" fill="#f4deab"/>':'')+'</svg>';
  fs.writeFileSync(path.join(out, id+'.svg'), svg);
});
console.log('Generated '+Object.keys(motifs).length+' illustrated skill icons.');
