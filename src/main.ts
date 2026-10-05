import './compat';
import './style.css';
import Matter from 'matter-js';
import {Renderer,W,COLORS} from './render';
import {AudioSystem} from './audio';
import {platform} from './platform';
import {progression,SKINS,BACKGROUNDS,BOOSTER_PRICES,LOGIN_REWARDS} from './progression';
import {Puzzle,generateLevel,LEVEL_COUNT,BOARD_ASPECT} from './puzzle';
import {samplePivotMotion} from './motion';

type Screen='home'|'levels'|'daily'|'shop'|'collection'|'game';
type Modal='settings'|'login'|'hearts'|'pause'|'win'|'restart'|'help'|'booster'|null;
type Pose={id:number;x:number;y:number;length:number;width:number;angle:number;skin:number;layer:number;pivotHole?:number|null;angularVelocity?:number;vx?:number;vy?:number};
type Particle={x:number;y:number;vx:number;vy:number;life:number;max:number;size:number;color:string;angle:number};
type Falling={body:Matter.Body;pose:Pose;life:number};
const r=new Renderer(document.querySelector<HTMLCanvasElement>('#canvas')!);
const audio=new AudioSystem();
const physics=Matter.Engine.create({gravity:{x:0,y:1.4}});
let screen:Screen='home',modal:Modal=null,collectionTab:'skins'|'backgrounds'='skins',levelPage=0;
let puzzle:Puzzle|null=null,gameLevel=1,isDaily=false,elapsed=0,boosterCount=0,removeMode=false;
let selectedBooster:'undo'|'remove'|'shuffle'='undo',last=performance.now(),clock=0,winStars=3,rewardTaken=false,winCoins=0,winProcessed=false;
let particles:Particle[]=[],falling:Falling[]=[],toast='',toastUntil=0,transition=0,ready=false,adPending=false;
let hintPair:{from:number;to:number}|null=null,hintUntil=0;
let attemptDate='',a11yKey='';
let screwFlight:{from:{x:number;y:number};to:{x:number;y:number};hole:number;start:number;removing:boolean}|null=null;
const tweens=new Map<number,{before:Pose;after:Pose;start:number}>();
const board={x:27,y:230,w:336,h:403.2};
const state=()=>progression.state;
const fmt=(n:number)=>n.toLocaleString('ru-RU');
const showToast=(text:string)=>{toast=text;toastUntil=clock+3.2};
const openModal=(m:Modal)=>{modal=m;audio.play('tap')};
const setScreen=(s:Screen)=>{screen=s;modal=null;transition=clock;removeMode=false;if(s==='game')void platform.hideBanner();else void platform.showBanner()};
const daySeed=()=>Number(state().daily.date.replace(/-/g,''));
function scatter(x:number,y:number,count=20,confetti=false){
  const colors=['#f5c373','#e6f5e0','#4ec4ac','#d7765c'];
  for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,v=confetti?90+Math.random()*180:30+Math.random()*110;const life=confetti?2+Math.random():.5+Math.random()*.5;particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-(confetti?140:20),life,max:life,size:confetti?4+Math.random()*4:2+Math.random()*3,color:colors[i%colors.length],angle:Math.random()*6});}
}
function saveGame(){if(puzzle&&!puzzle.solved)progression.saveCheckpoint({level:gameLevel,daily:isDaily,date:attemptDate,snapshot:puzzle.snapshot(),seconds:Math.round(elapsed),boosterCount});}
function startGame(level:number,daily=false,resume=false){
  if(!resume&&!progression.spendHeart()){openModal('hearts');return;}
  gameLevel=level;isDaily=daily;elapsed=0;boosterCount=0;rewardTaken=false;winProcessed=false;removeMode=false;screwFlight=null;falling=[];Matter.Composite.clear(physics.world,false);tweens.clear();hintPair=null;
  attemptDate=state().daily.date;puzzle=new Puzzle(generateLevel(level,daily?daySeed():undefined));
  if(resume&&state().checkpoint){const cp=state().checkpoint!;if(!puzzle.restore(cp.snapshot as ReturnType<Puzzle['snapshot']>)){progression.clearCheckpoint();showToast('Начинаем новый чертёж');}else{elapsed=cp.seconds;boosterCount=cp.boosterCount;}}
  if(level===1&&!state().tutorialDone){hintPair=puzzle.level.witness[0];hintUntil=clock+25;}
  setScreen('game');saveGame();audio.play('tap');
}
function resumeGame(){const cp=state().checkpoint;if(cp&&(!cp.daily||cp.date===state().daily.date))startGame(cp.level,cp.daily,true);else startGame(Math.min(state().level,LEVEL_COUNT));}
function visiblePose(raw:Pose):Pose{
  const tween=tweens.get(raw.id);if(!tween)return raw;
  const anchor=tween.after.pivotHole==null?undefined:puzzle!.holes[tween.after.pivotHole];
  const motion=samplePivotMotion(tween.before,tween.after,anchor,clock-tween.start,BOARD_ASPECT);
  if(motion.settled)tweens.delete(raw.id);
  return {...raw,...motion};
}
function animateMove(result:NonNullable<ReturnType<Puzzle['move']>>,poses:Pose[]){
  audio.play('screw');if(state().settings.haptic)platform.haptic();
  const h=puzzle!.holes[result.to>=0?result.to:result.from];scatter(board.x+h.x*board.w,board.y+h.y*board.h,12);
  const source=puzzle!.holes[result.from];
  screwFlight={from:{x:source.x,y:source.y},to:result.to>=0?{x:h.x,y:h.y}:{x:source.x,y:source.y-.24},hole:result.to,start:clock,removing:result.to<0};
  for(const pivot of result.pivots)tweens.set(pivot.id,{before:poses.find(p=>p.id===pivot.id)??pivot.before as Pose,after:pivot.after as Pose,start:clock});
  for(const id of result.dropped){const pose=poses.find(x=>x.id===id);if(!pose)continue;
    tweens.delete(id);
    const body=Matter.Bodies.rectangle(board.x+pose.x*board.w,board.y+pose.y*board.h,pose.length*board.w,pose.width*board.w,{angle:pose.angle,frictionAir:.018,restitution:.2});
    Matter.Body.setAngularVelocity(body,(pose.angularVelocity??0)/60);Matter.Body.setVelocity(body,{x:(pose.vx??0)*board.w/60,y:(pose.vy??0)*board.h/60});Matter.Composite.add(physics.world,body);falling.push({body,pose,life:2.4});audio.play('drop');}
  hintPair=null;saveGame();if(puzzle!.solved)win();
}
function holeTap(id:number){
  if(!puzzle||puzzle.solved||modal||adPending||screwFlight)return;
  const poses=(puzzle.livePlanks as Pose[]).map(visiblePose);
  if(removeMode){
    if(!puzzle.screws[id]){showToast('Выберите винт, который хотите убрать');return;}
    const result=puzzle.removeScrew(id);
    if(!result){showToastToast();return;}
    progression.useBooster('remove');boosterCount++;removeMode=false;
    animateMove(result,poses);return;
  }
  if(puzzle.screws[id]){if(puzzle.select(id))audio.play('tap');else showToastToast();return;}
  if(puzzle.selected===null){showToast('Сначала выберите винт');return;}
  const result=puzzle.move(puzzle.selected,id);
  if(result)animateMove(result,poses);else{audio.play('error');showToast('Отверстие закрыто деревянной деталью');}
}
function showToastToast(){audio.play('error');showToast('Этот винт закрыт другой деталью');}
function win(){
  if(winProcessed)return;winProcessed=true;
  progression.tick();
  if(isDaily&&attemptDate!==state().daily.date){progression.clearCheckpoint();setScreen('daily');showToast('Наступил новый день. Для вас готов новый чертёж.');return;}
  winStars=elapsed<150&&boosterCount===0?3:elapsed<300&&boosterCount<3?2:1;
  const reward=progression.completeLevel(gameLevel,winStars as 1|2|3,{screws:puzzle!.moves,seconds:Math.round(elapsed),boostersUsed:boosterCount,daily:isDaily});winCoins=reward?.coins||0;
  progression.refillHearts(1);
  if(gameLevel===1)progression.finishTutorial();
  progression.clearCheckpoint();audio.play('win');scatter(W/2,250,80,true);
  window.setTimeout(()=>{if(screen==='game'&&puzzle?.solved)modal='win'},700);
}
async function rewarded(grant:{coins?:number;heart?:number;booster?:'undo'|'remove'|'shuffle'|'hint'},fn:()=>void=()=>{}){
  if(adPending)return;adPending=true;audio.paused=true;
  const ok=await progression.claimAdReward(grant);audio.paused=platform.paused||document.hidden;adPending=false;
  if(ok){fn();audio.play('reward');}else showToast(platform.isVK?'Видео сейчас недоступно. Попробуйте позже.':'Награды за видео доступны при запуске в VK');
}
function booster(type:'undo'|'remove'|'shuffle'){
  if(!puzzle||puzzle.solved)return;selectedBooster=type;
  if(state().boosters[type]<=0){openModal('booster');return;}
  if(type==='undo'){
    if(!puzzle.undo()){showToast('Пока нет ходов для отмены');return;}
    progression.useBooster(type);boosterCount++;tweens.clear();screwFlight=null;falling=[];Matter.Composite.clear(physics.world,false);saveGame();audio.play('tap');
  }else if(type==='remove'){removeMode=!removeMode;showToast(removeMode?'Нажмите на винт, чтобы убрать его':'Снятие винта отменено');}
  else{if(!puzzle.addExtraHole()){showToast('Дополнительное отверстие уже открыто');return;}progression.useBooster(type);boosterCount++;saveGame();showToast('Открыто дополнительное отверстие');}
}
function hint(){
  if(!puzzle||puzzle.solved||adPending||screwFlight)return;
  if(state().boosters.hint<=0){void rewarded({booster:'hint'},()=>{showToast('Подсказка получена');hint()});return;}
  const h=puzzle.hint();
  if(h){progression.useBooster('hint');boosterCount++;hintPair=h;hintUntil=clock+12;audio.play('tap');saveGame();showToast('Перенесите подсвеченный винт в отверстие');}
  else showToast('Попробуйте отменить ход или открыть отверстие');
}
function header(title?:string,back=false){
  const top=16;
  if(back)r.button('back','',16,top,44,44,()=>setScreen('home'),{kind:'square',icon:'back'});
  else r.button('settings','',16,top,44,44,()=>openModal('settings'),{kind:'square',icon:'gear'});
  r.pill('heart',String(state().hearts),168,top+3,74,()=>openModal('hearts'));
  r.pill('coin',fmt(state().coins),249,top+3,125,()=>setScreen('shop'));
  if(title){r.text(title,W/2,94,27,COLORS.cream,800);r.text('МАСТЕРСКАЯ БОЛТОВ',W/2,121,10,COLORS.gold,800);}
}
function nav(){
  const y=r.h-92;r.panel(8,y,374,88);
  const items:[Screen,string,string][]=[['home','home','Домой'],['levels','trophy','Уровни'],['daily','calendar','Задания'],['shop','shop','Магазин'],['collection','wardrobe','Коллекция']];
  items.forEach(([s,icon,label],i)=>{const x=29+i*68;
    r.button('nav-'+s,'',x,y+14,60,41,()=>setScreen(s),{kind:screen===s?'primary':'square',icon});r.text(label,x+30,y+67,9,screen===s?'#fff0ce':COLORS.ink,800,'center',63);
  });
}
function drawPlank(pose:Pose,alpha=1){
  const c=r.c;c.save();c.globalAlpha*=alpha;c.translate(board.x+pose.x*board.w,board.y+pose.y*board.h);c.rotate(pose.angle);
  const l=pose.length*board.w,w=pose.width*board.w;
  c.shadowColor='rgba(25,15,12,.35)';c.shadowBlur=6;c.shadowOffsetY=4;
  r.image(r.images.has(`skins/${state().skin}-plank.png`)?`skins/${state().skin}-plank.png`:'plank.png',-l/2,-w/2,l,w);c.shadowBlur=0;c.shadowOffsetY=0;
  c.restore();
}
function screwAt(x:number,y:number,selected=false,scale=1){
  const c=r.c;c.save();c.translate(x,y);if(selected)c.rotate(Math.sin(clock*8)*.16);
  if(selected){c.strokeStyle='#ffe3a4';c.lineWidth=2.5;c.shadowColor='#ffd596';c.shadowBlur=15;c.beginPath();c.arc(0,0,19,0,Math.PI*2);c.stroke();c.shadowBlur=0;}
  const im=r.images.get(`skins/${state().skin}-screw.png`);
  if(im)c.drawImage(im,-13*scale,-13*scale,26*scale,26*scale);else r.image('screw.png',-13*scale,-13*scale,26*scale,26*scale);
  c.restore();
}
function miniPuzzle(x:number,y:number,size:number){
  const c=r.c;c.save();c.translate(x,y);c.rotate(Math.sin(clock*.6)*.025);
  const level=generateLevel(1),bh=size*BOARD_ASPECT;
  r.image('board.png',-size/2,-bh/2,size,bh);
  for(const p of level.planks){c.save();c.translate((p.x-.5)*size,(p.y-.5)*bh);c.rotate(p.angle);r.image('plank.png',-p.length*size/2,-p.width*size/2,p.length*size,p.width*size);c.restore();}
  for(const hole of level.holes){const hx=(hole.x-.5)*size,hy=(hole.y-.5)*bh;
    if(hole.initialScrew)r.image('screw.png',hx-9,hy-9,18,18);
    else{c.fillStyle='#473528';c.beginPath();c.arc(hx,hy,7,0,Math.PI*2);c.fill();c.fillStyle='#ad8956';c.beginPath();c.arc(hx,hy+2,5,0,Math.PI*2);c.fill();}
  }
  c.restore();
}
function home(){
  header();r.text('МАСТЕРСКАЯ',W/2,105,31,COLORS.cream,900);r.text('БОЛТОВ',W/2,141,34,COLORS.gold,900);
  const heroY=Math.min(335,r.h*.43),size=Math.min(238,(r.h-410)*.65+140);
  miniPuzzle(W/2,heroY,size);
  r.panel(98,heroY+size*.52-2,194,44);r.text(`УРОВЕНЬ ${Math.min(state().level,600)} / 600`,W/2,heroY+size*.52+18,14,COLORS.ink,800);
  const playY=Math.min(r.h-235,heroY+size*.62+48);
  r.button('play',state().checkpoint?'Продолжить':'Играть',54,playY,282,62,resumeGame,{kind:'primary',icon:'play'});
  const cardsY=r.h-172;
  if(cardsY-playY>85)r.text(state().checkpoint?'Ваша головоломка ждёт вас':'Освободи детали. Найди свой ход.',W/2,Math.min(playY+82,cardsY-14),13,'#d6dad0',600);
  r.button('daily-reward','Подарок дня',18,cardsY,172,58,()=>openModal('login'),{icon:'gift',small:true});
  r.button('daily-challenge','Вызов дня',200,cardsY,172,58,()=>setScreen('daily'),{icon:'calendar',small:true});
  nav();
}
function levels(){
  header('Карта мастерства');const y=154;
  r.panel(20,y,350,58);r.text('600 головоломок. Один верный ход.',W/2,y+22,14,COLORS.ink,800);r.progress(41,y+40,308,(state().level-1)/600,'#55886d');
  const gridY=230,gridH=r.h-360,rowGap=gridH/5;
  for(let i=0;i<25;i++){
    const n=levelPage*25+i+1,x=19+(i%5)*72,yy=gridY+Math.floor(i/5)*rowGap,unlocked=n<=state().level;
    r.button('level-'+n,unlocked?String(n):'',x,yy,64,48,()=>startGame(n),{kind:n===state().level?'primary':'square',icon:unlocked?undefined:'lock',disabled:!unlocked});
    const stars=state().stars[String(n)]||0;for(let j=0;j<3;j++)r.icon('star',x+10+j*14,yy+50,11,j<stars?1:.18);
  }
  r.button('prev','',22,r.h-128,47,40,()=>{levelPage=Math.max(0,levelPage-1)},{kind:'square',icon:'back',disabled:levelPage===0});
  r.text(`${levelPage+1} / 24`,W/2,r.h-108,14,COLORS.cream,800);
  r.button('next','Далее',290,r.h-128,78,40,()=>{levelPage=Math.min(23,levelPage+1)},{small:true,disabled:levelPage===23});nav();
}
function daily(){
  header('Задания дня');const y=151,taskY=315;
  r.panel(19,y,352,148);r.icon('calendar',48,y+16,30);r.text('ГОЛОВОЛОМКА ДНЯ',94,y+31,13,COLORS.ink,800,'left',242);
  r.text('Новый чертёж. Новая награда.',W/2,y+58,14,COLORS.ink,700);
  r.icon('coin',106,y+70,21);r.text('150 монет за решение',135,y+81,12,COLORS.ink,600,'left',195);
  r.button('daily-play',state().daily.completed?'Пройдено сегодня':'Принять вызов',42,y+99,306,34,()=>startGame(45+daySeed()%180,true),{kind:'primary',disabled:state().daily.completed,small:true});
  r.text('ЗАДАНИЯ ДНЯ',23,taskY,12,COLORS.gold,800,'left');
  const tasks=progression.tasks();const cardH=Math.min(94,(r.h-460)/3);
  tasks.forEach((task,i)=>{
    const yy=taskY+18+i*(cardH+9);r.panel(19,yy,352,cardH);
    const cy=yy+cardH/2;r.icon(['trophy','screw','star'][i],43,cy-16,32);r.text(task.title,91,cy-12,13,COLORS.ink,800,'left',158);
    r.text(`${task.progress} / ${task.goal}`,91,cy+11,12,COLORS.ink,600,'left');
    if(cardH>=90)r.progress(91,yy+cardH-22,158,task.progress/task.goal,'#598b71');
    r.button('task-'+task.id,task.claimed?'Взято':String(task.reward),266,cy-19,82,38,()=>{if(progression.claimTask(task.id)){audio.play('reward');showToast('Награда получена')}},{icon:task.claimed?'check':'coin',disabled:task.claimed||task.progress<task.goal,small:true});
  });
  if(r.h>=780)r.button('login-daily','Награда за вход',50,r.h-142,290,40,()=>openModal('login'),{icon:'gift',small:true});nav();
}
function shop(){
  header('Лавка мастера');r.text('Помощь для сложного чертежа',W/2,153,14,COLORS.muted,600);
  const cards:[string,string,string,string][]=[['undo','undo','Отмена хода','Верните последний винт на место'],['remove','hammer','Снять винт','Уберите один винт с поля'],['shuffle','plus','Ещё отверстие','Откройте свободное место для винта']];
  const rowH=Math.min(120,(r.h-390)/3);
  cards.forEach(([id,icon,title,description],i)=>{
    const y=178+i*(rowH+12);r.panel(18,y,354,rowH);r.icon(icon,32,y+22,44);
    r.text(title,90,y+23,18,COLORS.ink,800,'left',240);r.text(description,90,y+43,10,COLORS.ink,600,'left',253);
    r.text(`В запасе: ${state().boosters[id as 'undo']}`,36,y+rowH-27,12,COLORS.ink,700,'left',150);
    r.button('buy-'+id,String(BOOSTER_PRICES[id as 'undo']),222,y+rowH-48,128,40,()=>{if(progression.buyBooster(id as 'undo')){audio.play('reward');showToast('Буст добавлен в запас')}else showToast('Недостаточно монет')},{kind:'primary',icon:'coin',small:true});
  });
  r.panel(18,r.h-186,354,83);r.icon('coin',31,r.h-170,37);r.text('Сундук монет',82,r.h-163,15,COLORS.ink,800,'left');
  r.button('reward-coins','Видео + 100',202,r.h-168,151,43,()=>rewarded({coins:100},()=>showToast('+100 монет')),{kind:'primary',small:true});
  r.text('Награда после полного просмотра',W/2,r.h-120,11,COLORS.ink,600);nav();
}
function collection(){
  header('Ваша мастерская');r.button('tab-skins','Винты',24,151,165,44,()=>{collectionTab='skins'},{kind:collectionTab==='skins'?'primary':'secondary',icon:'screw'});
  r.button('tab-bg','Фоны',201,151,165,44,()=>{collectionTab='backgrounds'},{kind:collectionTab==='backgrounds'?'primary':'secondary',icon:'wardrobe'});
  const items=collectionTab==='skins'?SKINS:BACKGROUNDS;
  const cellH=Math.min(159,(r.h-327)/3),cellW=168;
  items.forEach((item,i)=>{
    const x=22+(i%2)*178,y=213+Math.floor(i/2)*(cellH+9);
    r.panel(x,y,cellW,cellH);
    const owned=collectionTab==='skins'?state().ownedSkins.includes(item.id):state().ownedBackgrounds.includes(item.id);
    const active=(collectionTab==='skins'?state().skin:state().background)===item.id;
    const artSize=Math.min(52,cellH-78);
    if(!owned){const mysteryH=Math.min(58,cellH-78),mysteryW=mysteryH*1.284;r.image('mystery.png',x+(cellW-mysteryW)/2,y+16,mysteryW,mysteryH);}
    else if(collectionTab==='skins'){r.image(`skins/${item.id}-screw.png`,x+(cellW-artSize)/2,y+16,artSize,artSize);}
    else r.cover(`backgrounds/${item.id}.webp`,x+21,y+16,126,cellH-89);
    const unlocked=state().level>item.unlockLevel;
    r.text(owned?item.name:'Тайный подарок',x+84,y+cellH-58,12,COLORS.ink,800,'center',130);
    r.button('cosmetic-'+item.id,active?'Выбрано':owned?'Выбрать':unlocked?String(item.price):`Ур. ${item.unlockLevel}`,x+20,y+cellH-42,128,29,()=>{
      const type=collectionTab==='skins'?'skin':'background';
      if(owned){progression.selectCosmetic(type,item.id);audio.play('tap');}
      else if(progression.buyCosmetic(type,item.id)){audio.play('reward');showToast('Новый предмет в коллекции');}
      else showToast('Недостаточно монет');
    },{kind:active?'primary':'secondary',icon:owned?'check':unlocked?'coin':'lock',disabled:!owned&&!unlocked,small:true});
  });nav();
}
function gameplay(){
  if(!puzzle)return;
  const hudY=18;
  r.button('pause','',16,hudY,45,45,()=>openModal('pause'),{kind:'square',icon:'pause'});
  r.panel(112,hudY,167,53);r.text(isDaily?'ВЫЗОВ ДНЯ':`УРОВЕНЬ ${gameLevel}`,W/2,hudY+18,14,COLORS.ink,800);r.text(puzzle.level.name,W/2,hudY+38,10,COLORS.ink,600,'center',148);
  r.button('help','',330,hudY,44,45,()=>openModal('help'),{kind:'square',icon:'hint'});
  const min=Math.floor(elapsed/60),sec=Math.floor(elapsed%60);r.text(`${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`,W/2,94,18,COLORS.cream,800);
  r.text(removeMode?'Выберите винт для снятия':puzzle.selected===null?'Выберите винт':'Теперь выберите свободное отверстие',W/2,125,13,COLORS.cream,700);
  const available=r.h-320;board.w=Math.min(340,available/BOARD_ASPECT);board.h=board.w*BOARD_ASPECT;board.x=(W-board.w)/2;board.y=159+(available-board.h)/2;
  r.image('board.png',board.x-6,board.y-7,board.w+12,board.h+14);
  const c=r.c;
  for(const hole of puzzle.holes){
    const x=board.x+hole.x*board.w,y=board.y+hole.y*board.h;
    c.fillStyle='#573b26';c.beginPath();c.arc(x,y,10.5,0,Math.PI*2);c.fill();c.fillStyle='#ad8956';c.beginPath();c.arc(x,y+2,7.7,0,Math.PI*2);c.fill();c.fillStyle='#392b22';c.beginPath();c.arc(x,y+1,6.5,0,Math.PI*2);c.fill();
  }
  for(const raw of puzzle.livePlanks as Pose[])drawPlank(visiblePose(raw));
  for(const hole of puzzle.holes){const x=board.x+hole.x*board.w,y=board.y+hole.y*board.h;
    const reachable=puzzle.canSelect(hole.id);
    if(puzzle.screws[hole.id]&&reachable&&screwFlight?.hole!==hole.id)screwAt(x,y,puzzle.selected===hole.id||removeMode||!!(hintPair&&hintPair.from===hole.id&&clock<hintUntil));
    if(hintPair&&hintPair.to===hole.id&&clock<hintUntil){c.strokeStyle='#79dfb6';c.lineWidth=3;c.beginPath();c.arc(x,y,14+Math.sin(clock*6)*2,0,Math.PI*2);c.stroke();}
    if(!puzzle.screws[hole.id]||reachable)r.hits.push({id:'hole-'+hole.id,label:`Отверстие ${hole.id+1}`,x:x-17,y:y-17,w:34,h:34,fn:()=>holeTap(hole.id)});
  }
  for(const item of falling){c.save();c.translate(item.body.position.x,item.body.position.y);c.rotate(item.body.angle);c.globalAlpha=Math.min(1,item.life);const asset=`skins/${state().skin}-plank.png`;r.image(r.images.has(asset)?asset:'plank.png',-item.pose.length*board.w/2,-item.pose.width*board.w/2,item.pose.length*board.w,item.pose.width*board.w);c.restore();}
  if(screwFlight){const flight=screwFlight,t=Math.min(1,(clock-flight.start)/.46),e=t*t*(3-2*t);
    const fx=board.x+(flight.from.x+(flight.to.x-flight.from.x)*e)*board.w,fy=board.y+(flight.from.y+(flight.to.y-flight.from.y)*e)*board.h-Math.sin(t*Math.PI)*35;
    c.save();c.translate(fx,fy);c.rotate(t*Math.PI*4);c.globalAlpha=flight.removing?1-t:1;const size=26+Math.sin(t*Math.PI)*9,asset=`skins/${state().skin}-screw.png`;r.image(r.images.has(asset)?asset:'screw.png',-size/2,-size/2,size,size);c.restore();
    if(t>=1){screwFlight=null;scatter(fx,fy,9);}
  }
  const footerY=r.h-131;
  r.text(`Ходы: ${puzzle.moves}`,26,footerY-21,12,COLORS.muted,700,'left');
  r.text(`Детали: ${puzzle.removed.filter(Boolean).length} / ${puzzle.planks.length}`,364,footerY-21,12,COLORS.muted,700,'right');
  const tools:[string,string,()=>void,string][]=[['undo','undo',()=>booster('undo'),String(state().boosters.undo)],['remove','hammer',()=>booster('remove'),String(state().boosters.remove)],['shuffle','plus',()=>booster('shuffle'),String(state().boosters.shuffle)],['hint','hint',hint,String(state().boosters.hint)]];
  tools.forEach(([id,icon,fn,count],i)=>{const x=26+i*89;r.button('tool-'+id,'',x,footerY,70,60,fn,{kind:removeMode&&id==='remove'?'primary':'square',icon});
    if(id==='hint'&&state().boosters.hint===0)r.image('ui/badge-ad.png',x+34,footerY-3,40,17);
    else if(count){r.panel(x+48,footerY-5,26,24);r.text(count,x+61,footerY+7,10,COLORS.ink,800);}
    r.text(['Отмена','Снять','Место','Подсказка'][i],x+35,footerY+75,10,COLORS.cream,700);
  });
  if(gameLevel===1&&puzzle.moves===0)r.text('Перенесите винты в верхние отверстия',W/2,board.y+board.h+27,11,COLORS.gold,700);
}
function dialog(){
  if(!modal)return;
  const c=r.c;c.fillStyle='rgba(7,17,22,.76)';c.fillRect(0,0,W,r.h);r.hits=[];
  let h=modal==='login'?488:modal==='win'?420:modal==='settings'?464:modal==='help'?424:modal==='hearts'?410:340;
  const y=(r.h-h)/2,x=22,w=346;r.panel(x,y,w,h);
  const title={settings:'Настройки',login:'Подарок за возвращение',hearts:'Нужна новая жизнь?',pause:'Немного передохнём',win:'Отличная работа!',restart:'Начать заново?',help:'Как играть',booster:'Помощь мастера'}[modal];
  r.text(title,W/2-7,y+39,21,COLORS.ink,800,'center',242);
  r.button('close','',323,y+17,29,29,()=>{if(modal==='win')setScreen('home');else modal=null},{kind:'square',icon:'close'});
  if(modal==='settings'){
    const settings:[string,string,string][]=[['sound','sound','Звуки'],['music','music','Музыка'],['haptic','heart','Вибрация']];
    settings.forEach(([id,icon,label],i)=>{const yy=y+85+i*68;r.icon(icon,45,yy+6,32);r.text(label,95,yy+22,17,COLORS.ink,700,'left');const enabled=state().settings[id as 'sound'];r.button('setting-'+id,enabled?'Вкл':'Выкл',246,yy,92,43,()=>{progression.setSetting(id as 'sound',!enabled);syncAudio()},{kind:enabled?'primary':'secondary',small:true});});
    r.text('Ваш прогресс сохраняется автоматически',W/2,y+318,12,COLORS.ink,600);
    r.text(platform.user?`VK · ${platform.user.name}`:'Локальная мастерская',W/2,y+344,13,COLORS.ink,800,'center',294);
      r.text('Мастерская болтов · 1.0',W/2,y+370,11,COLORS.ink,600);
    r.button('settings-help','Правила игры',54,y+h-63,282,42,()=>{modal='help'},{icon:'hint',small:true});
  }
  if(modal==='login'){
    r.text('Заходите каждый день — подарки растут',W/2,y+77,12,COLORS.ink,600);
    for(let i=0;i<7;i++){
      const xx=i<4?43+i*78:82+(i-4)*78,yy=y+102+(i<4?0:107);r.panel(xx,yy,70,94);r.text(`День ${i+1}`,xx+35,yy+21,9,COLORS.ink,800);r.icon(i===6?'gift':'coin',xx+21,yy+34,28);r.text(String(LOGIN_REWARDS[i].coins),xx+35,yy+73,12,COLORS.ink,800);
      if(i<state().login.streak&&state().login.lastClaim===state().daily.date)r.icon('check',xx+46,yy+39,20);
    }
    r.wrap('Семь дней в мастерской — целый сундук монет. Пропуск дня начнёт цепочку заново.',W/2,y+334,280,13,COLORS.ink,20);
    const claimed=state().login.lastClaim===state().daily.date;
    r.button('claim-login',claimed?'До встречи завтра':'Забрать подарок',49,y+h-70,292,48,()=>{const result=progression.claimLogin();if(result){audio.play('reward');scatter(W/2,y+270,45,true);showToast('Ежедневный подарок получен')}},{kind:'primary',icon:claimed?'check':'gift',disabled:claimed});
  }
  if(modal==='hearts'){
    r.icon('heart',W/2-31,y+81,62);r.text(`Жизни: ${state().hearts} / 5`,W/2,y+166,18,COLORS.ink,800);
    const remaining=Math.ceil(progression.heartCountdownMs/60000);
    r.text(state().hearts>=5?'Все жизни восстановлены':`Следующая жизнь через ${remaining} мин.`,W/2,y+196,12,COLORS.ink,600,'center',294);
    r.button('refill-video','Видео: +5 жизней',48,y+231,294,45,()=>rewarded({heart:5},()=>{modal=null}),{kind:'primary',icon:'heart'});
    r.button('refill-coins','Пополнить за 200 монет',48,y+288,294,44,()=>{if(progression.buyHearts()){modal=null;audio.play('reward')}else showToast(state().hearts>=5?'Все жизни уже восстановлены':'Недостаточно монет')},{icon:'coin',small:true});
    r.text('Жизнь возвращается после победы',W/2,y+363,11,COLORS.ink,600);
  }
  if(modal==='pause'){
    r.text('Ваш чертёж остаётся на месте',W/2,y+83,14,COLORS.ink,600);
    r.button('continue','Продолжить',50,y+117,290,47,()=>{modal=null},{kind:'primary',icon:'play'});
    r.button('restart','Начать заново',50,y+175,290,44,()=>{modal='restart'},{icon:'shuffle'});
    r.button('exit','В мастерскую',50,y+232,290,44,()=>{saveGame();setScreen('home')},{icon:'home'});
  }
  if(modal==='restart'){
    r.wrap('На новый чертёж понадобится одна жизнь. Текущие ходы будут сброшены.',W/2,y+101,278,15,COLORS.ink,25);
    r.button('restart-yes','Начать заново',49,y+205,292,48,()=>startGame(gameLevel,isDaily),{kind:'primary',icon:'shuffle'});
    r.button('restart-no','Продолжить этот',49,y+264,292,42,()=>{modal=null},{small:true});
  }
  if(modal==='help'){
    r.icon('screw',W/2-28,y+76,56);
    r.wrap('Нажмите на винт, затем на свободное отверстие. Отверстия под деревянными деталями закрыты.',W/2,y+161,280,15,COLORS.ink,23);
    r.wrap('Один винт держит деталь на весу. Уберите последний — и она упадёт. Освободите все детали, чтобы победить.',W/2,y+252,280,14,COLORS.ink,22);
    r.button('help-ok','Понятно, играем',49,y+h-67,292,46,()=>{modal=null},{kind:'primary'});
  }
  if(modal==='booster'){
    const names={undo:'Отмена хода',remove:'Снятие винта',shuffle:'Дополнительное отверстие'};
    r.icon(selectedBooster==='remove'?'hammer':selectedBooster==='shuffle'?'plus':'undo',W/2-30,y+80,60);r.text(names[selectedBooster],W/2,y+163,16,COLORS.ink,800);
    r.button('booster-buy',`${BOOSTER_PRICES[selectedBooster]} монет`,49,y+205,292,45,()=>{if(progression.buyBooster(selectedBooster)){modal=null;booster(selectedBooster)}else showToast('Недостаточно монет')},{kind:'primary',icon:'coin'});
    r.button('booster-video','Получить за видео',49,y+262,292,43,()=>rewarded({booster:selectedBooster},()=>{modal=null;booster(selectedBooster)}),{small:true});
  }
  if(modal==='win'){
    for(let i=0;i<3;i++)r.icon('star',85+i*78,y+82,i===1?62:52,i<winStars?1:.25);
    r.text(isDaily?'Вызов дня пройден':`Уровень ${gameLevel} завершён`,W/2,y+164,17,COLORS.ink,800);
    r.text(`${puzzle?.moves||0} ходов · ${Math.round(elapsed)} секунд`,W/2,y+193,13,COLORS.ink,600);
    r.icon('coin',127,y+221,31);r.text(`+${winCoins} монет`,214,y+237,19,COLORS.ink,800);
    r.button('double-reward',rewardTaken?'Бонус получен':'Видео: ещё +50 монет',49,y+275,292,43,()=>rewarded({coins:50},()=>{rewardTaken=true}),{icon:rewardTaken?'check':'coin',disabled:rewardTaken,small:true});
    r.button('next-level',isDaily?'В мастерскую':'Следующий уровень',49,y+330,292,49,async()=>{
      if(isDaily||gameLevel>=LEVEL_COUNT){setScreen('home');return;}
      modal=null;adPending=true;audio.paused=true;await platform.interstitial();adPending=false;audio.paused=platform.paused||document.hidden;startGame(gameLevel+1);
    },{kind:'primary',icon:'play'});
  }
}
function syncAudio(){audio.sound=state().settings.sound;audio.music=state().settings.music;}
function draw(now:number){
  const wallDt=Math.max(0,(now-last)/1000),simulationPaused=platform.paused||document.hidden||adPending||(screen==='game'&&modal!==null);
  const dt=simulationPaused?0:Math.min(.04,wallDt);last=now;clock+=dt;
  if(ready){
    if(screen==='game'&&!modal&&!platform.paused&&!document.hidden&&!adPending&&puzzle&&!puzzle.solved)elapsed+=wallDt;
    if(dt>0)Matter.Engine.update(physics,dt*1000);
    falling=falling.filter(item=>{item.life-=dt;if(item.life<=0){Matter.Composite.remove(physics.world,item.body);return false;}return true;});
    r.hits=[];r.background(state().background,screen==='game'?.06:.21);
    ({home,levels,daily,shop,collection,game:gameplay}[screen])();
    dialog();
    for(const p of particles){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=140*dt;p.angle+=dt*3;r.c.save();r.c.globalAlpha=Math.min(1,p.life/p.max*2);r.c.translate(p.x,p.y);r.c.rotate(p.angle);r.c.fillStyle=p.color;r.c.fillRect(-p.size/2,-p.size/2,p.size,p.size);r.c.restore();}particles=particles.filter(p=>p.life>0);
    if(toast&&clock<toastUntil){const yy=r.h-207;r.c.fillStyle='rgba(13,33,39,.95)';r.c.beginPath();r.c.roundRect(22,yy,346,53,14);r.c.fill();r.wrap(toast,W/2,yy+18,316,13,'#fff0d4',18);}
    if(adPending){r.c.fillStyle='rgba(8,22,29,.82)';r.c.fillRect(0,0,W,r.h);r.text('Подключаем рекламу…',W/2,r.h/2,18,COLORS.cream,800);r.hits=[];}
    syncAccessibility();
    const opacity=Math.max(0,1-(clock-transition)/.24);if(opacity>0){r.c.fillStyle=`rgba(13,29,35,${opacity})`;r.c.fillRect(0,0,W,r.h);}
  }
  requestAnimationFrame(draw);
}
r.canvas.addEventListener('pointerdown',e=>{audio.unlock();const p=r.coordinates(e);r.pointer=p;const hit=r.hit(p.x,p.y);r.pressed=hit?.id||'';r.canvas.setPointerCapture(e.pointerId);});
r.canvas.addEventListener('pointerup',e=>{const p=r.coordinates(e),hit=r.hit(p.x,p.y);if(hit&&hit.id===r.pressed){audio.play('tap');hit.fn();}r.pressed='';});
r.canvas.addEventListener('pointercancel',()=>{r.pressed=''});
window.addEventListener('resize',()=>r.resize());
window.addEventListener('pagehide',()=>{saveGame();void progression.flush()});
document.addEventListener('visibilitychange',()=>{last=performance.now();audio.paused=document.hidden;if(document.hidden){saveGame();void progression.flush()}else progression.tick()});
platform.onPause(paused=>{last=performance.now();audio.paused=paused||document.hidden});
platform.onBanner(height=>{r.insets.banner=height;r.resize()});
platform.onSafeArea(area=>{r.insets.top=area.top;r.insets.bottom=area.bottom;r.resize()});
window.setInterval(()=>{if(ready){progression.tick();saveGame()}},15000);
async function boot(){
  await Promise.all([r.load(),(async()=>{await platform.init();await progression.init()})()]);
  syncAudio();levelPage=Math.min(23,Math.floor((state().level-1)/25));ready=true;document.getElementById('loading')!.remove();void platform.showBanner();
  void Promise.all(SKINS.flatMap(item=>['screw','plank'].map(kind=>r.loadAsset(`skins/${item.id}-${kind}.png`))));
  if(state().login.lastClaim!==state().daily.date)window.setTimeout(()=>{if(screen==='home')modal='login'},1200);
  requestAnimationFrame(draw);
}
// Read-only diagnostics used by the release smoke checks.
if(import.meta.env.DEV)Object.assign(window,{screwDebug:{get screen(){return screen},get modal(){return modal},get puzzle(){return puzzle},get progression(){return state()},get hits(){return r.hits.map(({fn,...h})=>h)},get metrics(){return{width:W,height:r.h,board}},get assets(){return[...r.images.keys()]}}});
function syncAccessibility(){
  const key=r.hits.map(h=>h.id+':'+h.label+':'+h.disabled).join('|');if(key===a11yKey)return;a11yKey=key;
  const host=document.getElementById('a11y')!;host.replaceChildren();
  for(const hit of r.hits){const b=document.createElement('button');b.textContent=hit.label;b.disabled=!!hit.disabled;b.dataset.action=hit.id;b.addEventListener('click',()=>{audio.unlock();r.hits.find(h=>h.id===hit.id)?.fn()});b.addEventListener('focus',()=>{r.pressed=hit.id});b.addEventListener('blur',()=>{r.pressed=''});host.append(b);}
}
boot().catch(error=>{console.error(error);document.querySelector('#loading small')!.textContent='Не удалось открыть мастерскую. Перезагрузите страницу.'});
