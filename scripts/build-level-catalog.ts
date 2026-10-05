/** Offline authoring pipeline. The game downloads the verified catalogue and
 * never generates or solves 600 puzzles during a mobile launch. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { structuralSignature } from './level-structure.ts';
import { BOARD_ASPECT, Puzzle, plankContains, type Level } from '../src/puzzle.ts';

type Point = [number, number];
type Edge = [number, number];
interface Sketch { motif: string; name: string; points: Point[]; edges: Edge[] }
const sketches: Sketch[] = [];
function sketch(motif: string, name: string, points: Point[], edges: string) {
  sketches.push({ motif, name, points, edges: edges.split(' ').map(e => e.split('-').map(Number) as Edge) });
}

// Thirty authored silhouettes introduce a new construction on every board.
// Node order is deliberately meaningful: shared corner pins, braces, spokes,
// and crossed layers create different disassembly orders, not cosmetic noise.
sketch('beam', 'Первый винт', [[.24,.5],[.76,.5]], '0-1');
sketch('elbow', 'Уголок', [[.24,.3],[.24,.73],[.76,.73]], '0-1 1-2');
sketch('triangle', 'Треугольная опора', [[.5,.27],[.18,.77],[.82,.77]], '0-1 1-2 2-0');
sketch('diamond', 'Ромб', [[.5,.25],[.85,.54],[.5,.83],[.15,.54]], '0-1 1-2 2-3 3-0');
sketch('house', 'Домик мастера', [[.2,.48],[.8,.48],[.8,.82],[.2,.82],[.5,.25]], '0-1 1-2 2-3 3-0 0-4 4-1');
sketch('hourglass', 'Песочные часы', [[.18,.29],[.82,.29],[.18,.79],[.82,.79],[.5,.54]], '0-1 2-3 0-4 1-4 2-4 3-4 0-2');
sketch('bridge', 'Мост с распорками', [[.14,.38],[.38,.38],[.62,.38],[.86,.38],[.14,.76],[.38,.76],[.62,.76],[.86,.76]], '0-1 1-2 2-3 4-5 5-6 6-7 0-5 2-7');
sketch('butterfly', 'Бабочка', [[.5,.54],[.16,.3],[.16,.78],[.84,.3],[.84,.78],[.33,.27],[.67,.81]], '0-1 1-2 2-0 0-3 3-4 4-0 1-5 5-0 0-6');
sketch('crane', 'Башенный кран', [[.35,.28],[.35,.46],[.35,.64],[.35,.82],[.15,.82],[.55,.82],[.15,.28],[.56,.28],[.84,.28],[.84,.51]], '0-1 1-2 2-3 3-4 3-5 6-0 0-7 7-8 8-9 0-2');
sketch('staircase', 'Ступени', [[.14,.3],[.38,.3],[.38,.46],[.62,.46],[.62,.62],[.86,.62],[.86,.8],[.14,.8]], '0-1 1-2 2-3 3-4 4-5 5-6 6-7 7-0 0-2 2-4 4-6');
sketch('tree', 'Дерево опор', [[.5,.82],[.5,.62],[.5,.43],[.5,.25],[.2,.45],[.8,.45],[.14,.26],[.34,.26],[.66,.26],[.86,.26],[.2,.65],[.8,.65]], '0-1 1-2 2-3 2-4 2-5 4-6 4-7 5-8 5-9 1-10 1-11 4-10');
const ring = (n: number, rx=.35, ry=.285, cx=.5, cy=.55): Point[] => Array.from({length:n}, (_,i)=>[cx+Math.cos(-Math.PI/2+i*Math.PI*2/n)*rx,cy+Math.sin(-Math.PI/2+i*Math.PI*2/n)*ry]);
const cycle = (n:number, offset=0) => Array.from({length:n},(_,i)=>`${offset+i}-${offset+(i+1)%n}`).join(' ');
sketch('wheel', 'Колесо', [...ring(6), [.5,.55]], `${cycle(6)} 0-6 1-6 2-6 3-6 4-6 5-6`);
sketch('sailboat', 'Парусник', [[.12,.67],[.3,.82],[.7,.82],[.88,.67],[.5,.67],[.5,.25],[.18,.59],[.82,.59],[.5,.46]], '0-1 1-2 2-3 3-4 4-0 4-8 8-5 5-6 6-8 5-7 7-8 6-4 7-4');
sketch('pinwheel', 'Вертушка', [[.5,.55],[.15,.27],[.5,.27],[.85,.27],[.85,.55],[.85,.83],[.5,.83],[.15,.83],[.15,.55]], '0-1 1-2 2-0 0-3 3-4 4-0 0-5 5-6 6-0 0-7 7-8 8-0 2-4 6-8');
sketch('castle', 'Замок', [[.14,.82],[.14,.49],[.14,.27],[.32,.27],[.32,.49],[.68,.49],[.68,.27],[.86,.27],[.86,.49],[.86,.82],[.5,.82],[.5,.61]], '0-1 1-2 2-3 3-4 4-5 5-6 6-7 7-8 8-9 9-10 10-0 1-4 5-8 10-11');
sketch('cube', 'Объёмный каркас', [[.15,.46],[.62,.46],[.62,.81],[.15,.81],[.38,.26],[.85,.26],[.85,.61],[.38,.61]], '0-1 1-2 2-3 3-0 4-5 5-6 6-7 7-4 0-4 1-5 2-6 3-7 0-7 1-6 3-4');
sketch('spiral', 'Спиральный замок', [[.14,.26],[.86,.26],[.86,.84],[.14,.84],[.14,.43],[.68,.43],[.68,.68],[.32,.68],[.32,.55],[.5,.55]], '0-1 1-2 2-3 3-4 4-5 5-6 6-7 7-8 8-9 0-4 1-5 2-6 3-7 4-8 5-9');
sketch('ribbon', 'Зигзаг', [[.14,.26],[.86,.26],[.14,.45],[.86,.45],[.14,.64],[.86,.64],[.14,.83],[.86,.83],[.5,.35],[.5,.74]], '0-1 1-2 2-3 3-4 4-5 5-6 6-7 0-2 1-3 2-4 3-5 4-6 5-7 0-8 8-3 4-9');
sketch('mesh', 'Плетёная решётка', [[.17,.3],[.5,.3],[.83,.3],[.17,.55],[.5,.55],[.83,.55],[.17,.8],[.5,.8],[.83,.8]], '0-1 1-2 3-4 4-5 6-7 7-8 0-3 3-6 1-4 4-7 2-5 5-8 0-4 4-8 2-4 4-6');
sketch('arch', 'Арочный мост', [[.14,.78],[.14,.57],[.3,.38],[.5,.26],[.7,.38],[.86,.57],[.86,.78],[.3,.78],[.5,.78],[.7,.78],[.3,.57],[.7,.57]], '0-1 1-2 2-3 3-4 4-5 5-6 0-7 7-8 8-9 9-6 2-10 10-7 4-11 11-9 1-10 11-5');
sketch('mountain', 'Горный хребет', [[.12,.8],[.3,.34],[.5,.8],[.72,.25],[.88,.8],[.3,.6],[.5,.47],[.72,.58],[.12,.53],[.88,.5]], '0-1 1-2 2-3 3-4 4-2 2-0 1-5 5-2 3-7 7-4 1-6 6-3 5-6 6-7 0-8 8-5 7-9');
sketch('frames', 'Три рамки', [[.12,.26],[.5,.26],[.5,.58],[.12,.58],[.3,.43],[.68,.43],[.68,.75],[.3,.75],[.5,.58],[.88,.58],[.88,.86],[.5,.86]], '0-1 1-2 2-3 3-0 4-5 5-6 6-7 7-4 8-9 9-10 10-11 11-8 0-4 1-5 3-7 6-10 7-11 4-8');
sketch('fish', 'Механическая рыба', [[.12,.55],[.32,.3],[.64,.3],[.82,.55],[.64,.8],[.32,.8],[.5,.55],[.88,.32],[.88,.78],[.32,.55]], '0-1 1-2 2-3 3-4 4-5 5-0 1-6 2-6 3-6 4-6 5-6 0-9 9-6 3-7 7-8 8-3 1-9 5-9');
sketch('tower', 'Винтовая башня', [[.3,.25],[.7,.25],[.3,.44],[.7,.44],[.3,.63],[.7,.63],[.3,.82],[.7,.82],[.12,.82],[.88,.82],[.5,.54]], '0-1 2-3 4-5 6-7 0-2 2-4 4-6 1-3 3-5 5-7 0-3 2-5 4-7 6-8 7-9 3-10 4-10 2-10 5-10');
sketch('snowflake', 'Снежинка', [...ring(6),[.5,.55],...ring(6,.2,.16)], `${cycle(6)} 0-7 1-8 2-9 3-10 4-11 5-12 7-6 8-6 9-6 10-6 11-6 12-6 ${cycle(6,7)}`);
sketch('lock', 'Двойной замок', [[.18,.44],[.43,.25],[.68,.44],[.43,.65],[.43,.85],[.18,.66],[.68,.66],[.86,.55],[.68,.25],[.86,.82]], '0-1 1-2 2-3 3-0 0-5 5-4 4-6 6-2 3-4 1-8 8-2 2-7 7-6 6-9 9-7 5-3 3-6');
sketch('comet', 'Комета', [[.68,.43],[.48,.25],[.86,.25],[.88,.58],[.65,.66],[.16,.84],[.14,.58],[.16,.31],[.4,.7],[.38,.49],[.38,.28]], '0-1 1-2 2-3 3-4 4-0 1-0 0-3 4-8 8-5 0-9 9-6 1-10 10-7 5-6 6-7 8-9 9-10 8-6');
sketch('honeycomb', 'Соты', [[.14,.43],[.31,.27],[.5,.43],[.5,.67],[.31,.83],[.14,.67],[.69,.27],[.86,.43],[.86,.67],[.69,.83],[.5,.55]], '0-1 1-2 2-3 3-4 4-5 5-0 2-6 6-7 7-8 8-9 9-3 2-10 10-3 0-10 10-8 1-6 4-9 5-10');
sketch('turbine', 'Турбина', [...ring(8),...ring(4,.16,.14)], `${cycle(8)} 0-8 1-8 2-9 3-9 4-10 5-10 6-11 7-11 ${cycle(4,8)} 8-10`);
sketch('pyramids', 'Две пирамиды', [[.12,.81],[.5,.25],[.88,.81],[.12,.3],[.5,.86],[.88,.3],[.31,.55],[.69,.55],[.5,.55]], '0-1 1-2 2-0 3-4 4-5 5-3 0-6 6-1 1-7 7-2 3-6 6-4 4-7 7-5 6-8 8-7 1-8 8-4');

function rng(seed: number) { let x=seed>>>0; return ()=>{x+=0x6d2b79f5;let t=Math.imul(x^(x>>>15),1|x);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;}; }
const dist=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],(a[1]-b[1])*BOARD_ASPECT);
const round=(n:number)=>Math.round(n*100000)/100000;
const key=(e:Edge)=>[...e].sort((a,b)=>a-b).join('-');

function build(id:number,s:Sketch,rand:()=>number,attempt:number):Level|null {
  // Vary the actual set of beams. Coordinates do not count toward uniqueness.
  let edges=[...new Map(s.edges.map(e=>[key(e),e])).values()];
  if(id>30) {
    // Keep the campaign beyond the introductory architectures at least as
    // involved as level twenty. A tiny house cannot silently replace a late
    // board when its possible braces run out.
    const count= Math.min(24, 17+Math.floor(Math.min(id-31,450)/75)+Math.floor(rand()*3));
    const all:Edge[]=[];
    for(let a=0;a<s.points.length;a++)for(let b=a+1;b<s.points.length;b++)if(dist(s.points[a],s.points[b])>.14&&dist(s.points[a],s.points[b])<.92)all.push([a,b]);
    // Retain a connected architectural backbone, then add genuinely different
    // braces and remove some optional rails. Avoid many unplayable long chords.
    const chosen=edges.filter((_,i)=>i<s.points.length-1||rand()>.28);
    edges=[...new Map(chosen.map(e=>[key(e),e])).values()];
    const options=all.filter(e=>!edges.some(q=>key(q)===key(e))).sort(()=>rand()-.5);
    while(edges.length<count&&options.length) edges.push(options.pop()!);
    if(edges.length<count)return null;
    if(edges.length>count) edges=edges.slice(0,count);
    // Layer permutations are real over/under dependencies at crossings.
    edges.sort(()=>rand()-.5);
  }
  const used=new Set(edges.flat());
  const points=s.points.filter((_,i)=>used.has(i));
  if(points.some((p,i)=>points.some((q,j)=>i<j&&dist(p,q)>.002&&dist(p,q)*300<26.1))) return null;
  const holes:Level['holes']=[];
  const parking=id<=2?3:2;
  for(let i=0;i<parking;i++) holes.push({id:holes.length,x:parking===1?.5:parking===2?.32+i*.36:.2+i*.3,y:.125,initialScrew:false});
  const pointMap=new Map<number,number>();
  for(const [i,p] of s.points.entries())if(used.has(i)) {
    const existing=holes.find(h=>Math.hypot(h.x-p[0],(h.y-p[1])*BOARD_ASPECT)<.002);
    pointMap.set(i,existing?.id??holes.length);
    if(!existing)holes.push({id:holes.length,x:round(p[0]),y:round(p[1]),initialScrew:true});
  }
  const planks=edges.map(([a,b],i)=>{
    const aa=s.points[a],bb=s.points[b],dx=bb[0]-aa[0],dy=(bb[1]-aa[1])*BOARD_ASPECT;
    return {id:i,x:round((aa[0]+bb[0])/2),y:round((aa[1]+bb[1])/2),length:round(Math.hypot(dx,dy)+.072),width:.055,
      angle:Math.atan2(dy,dx),layer:i,skin:i%4,pinHoles:[pointMap.get(a)!,pointMap.get(b)!]};
  });
  // Longer strips get additional spaced interior supports. This increases the
  // number of meaningful release decisions, not merely the amount of artwork.
  const extraPins=id<5?0:id<=10?Math.floor((id-3)/2):id<=30?Math.floor(id/3):Math.max(6,15-holes.filter(h=>h.initialScrew).length);
  const interior=planks.flatMap(p=>[0,-.25,.25].map(t=>({p,point:[p.x+Math.cos(p.angle)*p.length*t,p.y+Math.sin(p.angle)*p.length*t/BOARD_ASPECT] as Point})));
  const owned=new Map<number,number>();
  let placed=0;
  for(const {p,point:q} of interior) {
    if(placed>=extraPins)break;
    if(q[0]<.1||q[0]>.9||q[1]<.24||q[1]>.86||holes.some(h=>dist(q,[h.x,h.y])*300<28))continue;
    owned.set(holes.length,p.id);holes.push({id:holes.length,x:round(q[0]),y:round(q[1]),initialScrew:true});placed++;
  }
  // End pins and newly drilled supports always attach to their own strip.
  // Other contacts are intentionally either shared drilled joints or solid
  // wood covering a lower screw. Covered screws are genuinely inaccessible
  // until the upper beam moves; the renderer already hides these screws.
  for(const p of planks) {
    const endpoints=new Set(p.pinHoles);
    p.pinHoles=holes.filter(h=>h.initialScrew&&plankContains(p,h,-.004)&&
      (endpoints.has(h.id)||owned.get(h.id)===p.id||id<7||rand()>.4)).map(h=>h.id);
  }
  if(id>=5) {
    // Empty holes are distributed through the construction: they begin covered
    // and become useful parking as rails swing away. Their spacing is enforced.
    const candidates:Point[]=[];
    for(const p of planks) for(const t of [0,-.22,.22]) candidates.push([p.x+Math.cos(p.angle)*p.length*t,p.y+Math.sin(p.angle)*p.length*t/BOARD_ASPECT]);
    const options=candidates.filter(q=>q[0]>.1&&q[0]<.9&&q[1]>.24&&q[1]<.86).sort(()=>rand()-.5);
    let added=0;
    for(const q of options) {
      if(holes.some(h=>dist(q,[h.x,h.y])*300<28))continue;
      holes.push({id:holes.length,x:round(q[0]),y:round(q[1]),initialScrew:false});
      if(++added>=2+(id>=80?1:0))break;
    }
  }
  if(id>=10) {
    // A real undrilled crosspiece locks an underlying screw. Its two visible
    // end supports sit in clear wood-free space, so removing this lock exposes
    // useful parking and never depends on a magically selectable hidden pin.
    // This introduces release-order reasoning during the first ten boards.
    const lockingCandidates=holes.filter(h=>h.initialScrew).sort(()=>rand()-.5);
    let placedLock=false;
    for(const h of lockingCandidates) {
      if(placedLock||planks.length>=25)break;
      for(const angle of [0,Math.PI/2,.55,-.55,1.05,-1.05]) {
        if(placedLock)break;
        for(const length of [.28,.38,.5]) {
          const ends:Point[]=[-1,1].map(sign=>[h.x+Math.cos(angle)*length/2*sign,h.y+Math.sin(angle)*length/2*sign/BOARD_ASPECT]);
          if(ends.some(q=>q[0]<.095||q[0]>.905||q[1]<.235||q[1]>.87||holes.some(pin=>dist(q,[pin.x,pin.y])*300<28)||
            planks.some(p=>plankContains(p,{x:q[0],y:q[1]},.018))))continue;
          const pins=ends.map(q=>{const pin=holes.length;holes.push({id:pin,x:round(q[0]),y:round(q[1]),initialScrew:true});return pin;});
          const lockId=planks.length;
          planks.push({id:lockId,x:h.x,y:h.y,length:length+.072,width:.055,angle,layer:lockId,skin:lockId%4,pinHoles:pins});
          placedLock=true;break;
        }
      }
    }
    // A candidate without a genuine covered pin is not a difficulty increase.
    // Reject it instead of replacing the puzzle with a repeated safe template.
    if(!placedLock && id<=30)return null;
  }
  const level:Level={id,seed:(Math.imul(id,2654435761)^0x73c4ab19)>>>0,name:s.name,motif:s.motif,
    difficulty:Math.min(5,Math.max(1,Math.ceil(planks.length/4))),holes,planks,witness:[],par:0};
  const puzzle=new Puzzle(level);
  const minimumBlocked=id>=300?3:id>=150?2:id>=10?1:0;
  if(holes.filter(h=>h.initialScrew&&!puzzle.canSelect(h.id)).length<minimumBlocked)return null;
  const solution=puzzle.findSolution(id<=30?3500:1500);
  if(!solution) return null;
  level.witness=solution;level.par=solution.length;
  return level;
}

const catalog:Level[]=[];
const signatures=new Set<string>();
const silhouettes=new Set<string>();
const started=Date.now();
const counts=new Map<string,number>();
for(let id=1;id<=600;id++) {
  let found:Level|undefined;
  for(let attempt=0;attempt<250&&!found;attempt++) {
    const rand=rng(Math.imul(id,104729)+attempt*15485863);
    // Early boards always keep their authored drawing; only parking gates vary.
    const s=id<=30?sketches[id-1]:sketches[4+(id+Math.floor(rand()*25)+attempt)%26];
    // Even different graphs look repetitive when their architectural family
    // appears again immediately. Keep five other silhouettes between repeats.
    if(id>30&&catalog.slice(-5).some(level=>level.motif===s.motif))continue;
    const candidate=build(id,s,rand,attempt);if(!candidate)continue;
    const signature=structuralSignature(candidate);
    if(signatures.has(signature))continue;
    const silhouette=JSON.stringify(candidate.planks.map(p=>[
      Math.round(p.x*1000),Math.round(p.y*1000),Math.round(p.length*1000),
      Math.round(((p.angle%Math.PI)+Math.PI)%Math.PI*1000)
    ]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
    if(silhouettes.has(silhouette))continue;
    const replay=new Puzzle(candidate);
    if(!candidate.witness.every(m=>Boolean(replay.move(m.from,m.to)))||!replay.solved)throw new Error(`Bad witness ${id}`);
    signatures.add(signature);silhouettes.add(silhouette);found=candidate;
  }
  if(!found)throw new Error(`Could not author distinct solvable level ${id} (${sketches[id-1]?.motif})`);
  catalog.push(found);counts.set(found.motif,(counts.get(found.motif)??0)+1);
  if(id<=30||id%25===0)process.stdout.write(`${id}: ${found.motif}, ${found.planks.length} strips / ${found.holes.filter(h=>h.initialScrew).length} pins / ${found.par} moves, ${((Date.now()-started)/1000).toFixed(1)}s\n`);
}
writeFileSync('src/level-catalog.ts', `/** Verified offline catalogue v2. Rebuild with scripts/build-level-catalog.ts. */\nimport type { Level } from './puzzle';\nexport const LEVEL_CATALOG: Level[] = ${JSON.stringify(catalog)};\n`);
mkdirSync('.local', { recursive: true });
writeFileSync('.local/level-catalog-report.json',JSON.stringify({levels:catalog.length,structurallyUnique:signatures.size,uniqueSilhouettes:silhouettes.size,families:Object.fromEntries(counts),first30:catalog.slice(0,30).map(l=>({id:l.id,name:l.name,strips:l.planks.length,pins:l.holes.filter(h=>h.initialScrew).length,blockedPins:l.holes.filter(h=>h.initialScrew&&!new Puzzle(l).canSelect(h.id)).length,par:l.par,parking:l.holes.filter(h=>!h.initialScrew).length}))},null,2));
process.stdout.write(`Saved ${catalog.length} verified, mechanically distinct puzzles.\n`);
