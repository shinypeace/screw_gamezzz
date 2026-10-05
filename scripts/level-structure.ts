import { BOARD_ASPECT, plankContains, type Level } from '../src/puzzle.ts';

/** Isomorphism invariant of support incidence + physical overlaps. It ignores
 * coordinates, angles, skins and seed, so a tilted/reskinned copy is rejected.
 * Crossing contacts include layer direction because they affect accessibility.
 * Repeated refinement preserves edge relationships, not just degree counts. */
export function structuralSignature(level: Level): string {
  const nodes=level.holes.length+level.planks.length;
  const links:string[][]=Array.from({length:nodes},()=>[]);
  let labels=Array.from({length:nodes},(_,i)=>i<level.holes.length?(level.holes[i].initialScrew?'pin':'parking'):'plank');
  const connect=(a:number,b:number,type:string)=>{links[a].push(`${type}:${b}`);links[b].push(`${type}:${a}`);};
  for(const p of level.planks) {
    for(const h of p.pinHoles) connect(h,level.holes.length+p.id,'support');
    for(const h of level.holes.filter(h=>h.initialScrew&&!p.pinHoles.includes(h.id)&&plankContains(p,h,-.006))) connect(h.id,level.holes.length+p.id,'obstruct');
    for(const h of level.holes.filter(h=>!h.initialScrew&&plankContains(p,h,.007))) connect(h.id,level.holes.length+p.id,'cover');
    for(const q of level.planks.filter(q=>q.id<p.id)) {
      // Sample the entire centreline, including contacts away from drilled pins.
      const overlap=Array.from({length:31},(_,i)=>{const t=(i/30-.5)*p.length;return {x:p.x+Math.cos(p.angle)*t,y:p.y+Math.sin(p.angle)*t/BOARD_ASPECT};}).some(h=>plankContains(q,h,p.width*.35));
      if(overlap){const upper=p.layer>q.layer?p:q,lower=upper===p?q:p;links[level.holes.length+upper.id].push(`over:${level.holes.length+lower.id}`);links[level.holes.length+lower.id].push(`under:${level.holes.length+upper.id}`);}
    }
  }
  for(let step=0;step<7;step++) {
    const descriptions=labels.map((label,i)=>`${label}(${links[i].map(link=>{const [kind,j]=link.split(':');return `${kind}.${labels[+j]}`;}).sort().join(',')})`);
    const sorted=[...new Set(descriptions)].sort();const ids=new Map(sorted.map((v,i)=>[v,String(i)]));
    labels=descriptions.map(v=>ids.get(v)!);
  }
  return JSON.stringify({nodes:labels.slice().sort(),edges:links.flatMap((ls,i)=>ls.map(l=>{const [t,j]=l.split(':');return `${labels[i]}/${t}/${labels[+j]}`;})).sort()});
}

