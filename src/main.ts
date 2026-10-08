import './compat';
import './style.css';
import {Renderer,W,COLORS} from './render';
import {AudioSystem} from './audio';
import {platform} from './platform';
import {progression,SKINS,BACKGROUNDS,BOOSTER_PRICES,LOGIN_REWARDS} from './progression';
import {Puzzle,generateLevel,dailyPuzzleSeed,LEVEL_COUNT,BOARD_ASPECT} from './puzzle';
import {BoardPhysics,DRILL_RADIUS} from './board-physics';
import {drawBeamBitmap} from './plank-texture';

type Screen='home'|'levels'|'daily'|'shop'|'collection'|'game';
type Modal='settings'|'login'|'hearts'|'pause'|'win'|'restart'|'help'|'booster'|null;
type Pose={id:number;x:number;y:number;length:number;width:number;angle:number;skin:number;layer:number;pivotHole?:number|null;angularVelocity?:number;vx?:number;vy?:number};
type Particle={x:number;y:number;vx:number;vy:number;life:number;max:number;size:number;color:string;angle:number};
const r=new Renderer(document.querySelector<HTMLCanvasElement>('#canvas')!);
const audio=new AudioSystem();
let physics:BoardPhysics|null=null;
const plankTextures=new Map<string,HTMLCanvasElement>();
let screen:Screen='home',modal:Modal=null,collectionTab:'skins'|'backgrounds'='skins',levelPage=0,levelPageSize=25;
let collectionPage=0,dailyTaskPage=0,shopPage=0;
let puzzle:Puzzle|null=null,gameLevel=1,isDaily=false,elapsed=0,boosterCount=0,removeMode=false;
let selectedBooster:'undo'|'remove'|'shuffle'='undo',last=performance.now(),clock=0,winStars=3,rewardTaken=false,winCoins=0,winProcessed=false;
let particles:Particle[]=[],toast='',toastUntil=0,transition=0,ready=false,adPending=false;
let hintPair:{from:number;to:number}|null=null,hintUntil=0;
let attemptDate='',a11yKey='';
let screwFlight:{from:{x:number;y:number};to:{x:number;y:number};hole:number;start:number;removing:boolean}|null=null;
const board={x:27,y:230,w:336,h:403.2};
const state=()=>progression.state;
const fmt=(n:number)=>n.toLocaleString('ru-RU');
const showToast=(text:string)=>{toast=text;toastUntil=clock+3.2};
const openModal=(m:Modal)=>{modal=m;audio.play('tap')};
const setScreen=(s:Screen)=>{screen=s;modal=null;transition=clock;removeMode=false;audio.setScene(s==='game'?'game':'menu');void platform.showBanner()};
const daySeed=()=>dailyPuzzleSeed(state().daily.date);
const compact=()=>r.h<680;
const navTop=()=>r.h-(compact()?86:92);
function scatter(x:number,y:number,count=20,confetti=false){
  const colors=['#f5c373','#e6f5e0','#4ec4ac','#d7765c'];
  for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,v=confetti?90+Math.random()*180:30+Math.random()*110;const life=confetti?2+Math.random():.5+Math.random()*.5;particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-(confetti?140:20),life,max:life,size:confetti?4+Math.random()*4:2+Math.random()*3,color:colors[i%colors.length],angle:Math.random()*6});}
}
function saveGame(){if(puzzle&&!puzzle.solved)progression.saveCheckpoint({level:gameLevel,daily:isDaily,date:attemptDate,snapshot:puzzle.snapshot(),seconds:Math.round(elapsed),boosterCount});}
function startGame(level:number,daily=false,resume=false){
  if(!resume&&!progression.spendHeart()){openModal('hearts');return;}
  gameLevel=level;isDaily=daily;elapsed=0;boosterCount=0;rewardTaken=false;winProcessed=false;removeMode=false;screwFlight=null;hintPair=null;plankTextures.clear();
  attemptDate=state().daily.date;puzzle=new Puzzle(generateLevel(level,daily?daySeed():undefined),undefined,{physical:true});
  const cp=daily?state().dailyCheckpoint:state().checkpoint;
  if(resume&&cp){if(!puzzle.restore(cp.snapshot as ReturnType<Puzzle['snapshot']>)){progression.clearCheckpoint(daily);showToast('Начинаем новый чертёж');}else{elapsed=cp.seconds;boosterCount=cp.boosterCount;}}
  if(level===1&&!state().tutorialDone){hintPair=puzzle.level.witness[0];hintUntil=clock+25;}
  physics=new BoardPhysics(puzzle.level,puzzle);setScreen('game');saveGame();audio.play('tap');
}
function resumeGame(){const cp=state().checkpoint;if(cp&&!cp.daily)startGame(cp.level,false,true);else startGame(Math.min(state().level,LEVEL_COUNT));}
function startDaily(){const cp=state().dailyCheckpoint;if(cp&&cp.date===state().daily.date)startGame(cp.level,true,true);else startGame(45+daySeed()%180,true);}
function animateMove(result:NonNullable<ReturnType<Puzzle['move']>>){
  audio.play('screw');if(state().settings.haptic)platform.haptic();
  const h=puzzle!.holes[result.to>=0?result.to:result.from];scatter(board.x+h.x*board.w,board.y+h.y*board.h,12);
  const source=puzzle!.holes[result.from];
  screwFlight={from:{x:source.x,y:source.y},to:result.to>=0?{x:h.x,y:h.y}:{x:source.x,y:source.y-.24},hole:result.to,start:clock,removing:result.to<0};
  physics?.syncPuzzle(puzzle!);hintPair=null;saveGame();
}
function holeTap(id:number){
  if(!puzzle||puzzle.solved||modal||adPending||screwFlight)return;
  if(removeMode){
    if(!puzzle.screws[id]){showToast('Выберите винт, который хотите убрать');return;}
    const result=puzzle.removeScrew(id);
    if(!result){showToastToast();return;}
    progression.useBooster('remove');boosterCount++;removeMode=false;
    animateMove(result);return;
  }
  if(puzzle.screws[id]){if(puzzle.select(id))audio.play('tap');else showToastToast();return;}
  if(puzzle.selected===null){showToast('Сначала выберите винт');return;}
  const result=puzzle.move(puzzle.selected,id);
  if(result)animateMove(result);else{audio.play('error');showToast('Совместите отверстия или выберите открытое место');}
}
function showToastToast(){audio.play('error');showToast('Этот винт закрыт другой деталью');}
function win(){
  if(winProcessed)return;winProcessed=true;
  progression.tick();
  if(isDaily&&attemptDate!==state().daily.date){progression.clearCheckpoint(true);setScreen('daily');showToast('Наступил новый день. Для вас готов новый чертёж.');return;}
  winStars=elapsed<150&&boosterCount===0?3:elapsed<300&&boosterCount<3?2:1;
  const reward=progression.completeLevel(gameLevel,winStars as 1|2|3,{screws:puzzle!.moves,seconds:Math.round(elapsed),boostersUsed:boosterCount,daily:isDaily});winCoins=reward?.coins||0;
  progression.refillHearts(1);
  if(gameLevel===1)progression.finishTutorial();
  progression.clearCheckpoint(isDaily);audio.play('win');scatter(W/2,250,80,true);
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
    progression.useBooster(type);boosterCount++;screwFlight=null;physics?.reset(puzzle.level,puzzle);saveGame();audio.play('tap');
  }else if(type==='remove'){removeMode=!removeMode;showToast(removeMode?'Нажмите на винт, чтобы убрать его':'Снятие винта отменено');}
  else{if(!puzzle.addExtraHole()){showToast('Дополнительное отверстие уже открыто');return;}progression.useBooster(type);boosterCount++;physics?.syncPuzzle(puzzle);saveGame();showToast('Открыто дополнительное отверстие');}
}
function hint(){
  if(!puzzle||puzzle.solved||adPending||screwFlight)return;
  if(state().boosters.hint<=0){void rewarded({booster:'hint'},()=>{showToast('Подсказка получена');hint()});return;}
  const h=puzzle.hint();
  if(h){progression.useBooster('hint');boosterCount++;hintPair=h;hintUntil=clock+12;audio.play('tap');saveGame();showToast('Перенесите подсвеченный винт в отверстие');}
  else showToast('Дождитесь движения деталей или попробуйте отменить ход');
}
function header(title?:string,back=false){
  const top=compact()?8:16;
  if(back)r.button('back','',16,top,44,44,()=>setScreen('home'),{kind:'square',icon:'back'});
  else r.button('settings','',16,top,44,44,()=>openModal('settings'),{kind:'square',icon:'gear'});
  r.pill('heart',String(state().hearts),168,top+3,74,()=>openModal('hearts'));
  r.pill('coin',fmt(state().coins),249,top+3,125,()=>setScreen('shop'));
  if(title){r.text(title,W/2,compact()?79:94,compact()?24:27,COLORS.cream,800);if(r.h>=560)r.text('МАСТЕРСКАЯ БОЛТОВ',W/2,compact()?104:121,10,COLORS.gold,800);}
}
function nav(){
  const y=navTop(),short=compact();r.panel(8,y,374,short?78:88);
  const items:[Screen,string,string][]=[['home','home','Домой'],['levels','trophy','Уровни'],['daily','calendar','Задания'],['shop','shop','Магазин'],['collection','wardrobe','Коллекция']];
  items.forEach(([s,icon,label],i)=>{const x=29+i*68;
    r.button('nav-'+s,'',x,y+(short?9:14),60,41,()=>setScreen(s),{kind:screen===s?'primary':'square',icon});r.text(label,x+30,y+(short?62:67),9,screen===s?'#fff0ce':COLORS.ink,800,'center',63);
  });
}
function drawPlank(pose:Pose,alpha=1){
  const c=r.c;c.save();c.globalAlpha*=alpha;c.translate(board.x+pose.x*board.w,board.y+pose.y*board.h);c.rotate(pose.angle);
  const l=pose.length*board.w,w=pose.width*board.w;
  c.shadowColor='rgba(25,15,12,.35)';c.shadowBlur=6;c.shadowOffsetY=4;
  const asset=r.images.has(`skins/${state().skin}-plank.png`)?`skins/${state().skin}-plank.png`:'plank.png';
  const key=`${gameLevel}:${pose.id}:${asset}:${Math.round(l*2)}:${Math.round(w*2)}`;
  let texture=plankTextures.get(key);
  if(!texture){
    texture=document.createElement('canvas');texture.width=Math.ceil(l*2);texture.height=Math.ceil(w*2);
    const paint=texture.getContext('2d')!;paint.scale(2,2);
    const image=r.images.get(asset);if(image)drawBeamBitmap(paint,image,0,0,l,w);
    for(const drill of puzzle!.getDrillPoints(pose.id)){
      const xx=l/2+drill.x*board.w,yy=w/2+drill.y*board.w,radius=DRILL_RADIUS*board.w;
      const bevel=paint.createRadialGradient(xx,yy,radius*.82,xx,yy,radius+1.7);
      bevel.addColorStop(0,'#392313');bevel.addColorStop(.56,'#623619');bevel.addColorStop(1,'rgba(239,186,109,.7)');
      paint.fillStyle=bevel;paint.beginPath();paint.arc(xx,yy,radius+1.7,0,Math.PI*2);paint.fill();
      paint.globalCompositeOperation='destination-out';paint.beginPath();paint.arc(xx,yy,radius,0,Math.PI*2);paint.fill();paint.globalCompositeOperation='source-over';
    }
    if(plankTextures.size>100)plankTextures.clear();plankTextures.set(key,texture);
  }
  c.drawImage(texture,-l/2,-w/2,l,w);c.shadowBlur=0;c.shadowOffsetY=0;
  c.restore();
}
function screwAt(x:number,y:number,selected=false,scale=1){
  const c=r.c;c.save();c.translate(x,y);if(selected)c.rotate(Math.sin(clock*8)*.16);
  if(selected){c.strokeStyle='#ffe3a4';c.lineWidth=2.5*scale;c.shadowColor='#ffd596';c.shadowBlur=15*scale;c.beginPath();c.arc(0,0,19*scale,0,Math.PI*2);c.stroke();c.shadowBlur=0;}
  const im=r.images.get(`skins/${state().skin}-screw.png`);
  if(im)c.drawImage(im,-13*scale,-13*scale,26*scale,26*scale);else r.image('screw.png',-13*scale,-13*scale,26*scale,26*scale);
  c.restore();
}
function miniPuzzle(x:number,y:number,size:number){
  const c=r.c;c.save();c.translate(x,y);c.rotate(Math.sin(clock*.6)*.025);
  const level=generateLevel(1),bh=size*BOARD_ASPECT;
  r.image('board.png',-size/2,-bh/2,size,bh);
  for(const p of level.planks){c.save();c.translate((p.x-.5)*size,(p.y-.5)*bh);c.rotate(p.angle);const bitmap=r.images.get('plank.png');if(bitmap)drawBeamBitmap(c,bitmap,-p.length*size/2,-p.width*size/2,p.length*size,p.width*size);c.restore();}
  for(const hole of level.holes){const hx=(hole.x-.5)*size,hy=(hole.y-.5)*bh;
    if(hole.initialScrew)r.image('screw.png',hx-9,hy-9,18,18);
    else{c.fillStyle='#473528';c.beginPath();c.arc(hx,hy,7,0,Math.PI*2);c.fill();c.fillStyle='#ad8956';c.beginPath();c.arc(hx,hy+2,5,0,Math.PI*2);c.fill();}
  }
  c.restore();
}
function home(){
  const short=compact();header();r.text('МАСТЕРСКАЯ',W/2,short?83:105,short?27:31,COLORS.cream,900);r.text('БОЛТОВ',W/2,short?115:141,short?30:34,COLORS.gold,900);
  const cardsY=navTop()-72,playY=cardsY-(short?70:92),badgeY=playY-47;
  const heroTop=short?139:173,heroBottom=badgeY+17,size=Math.min(238,(heroBottom-heroTop)/BOARD_ASPECT);
  if(size>=40)miniPuzzle(W/2,(heroTop+heroBottom)/2,size);
  r.panel(98,badgeY,194,35);r.text(`УРОВЕНЬ ${Math.min(state().level,600)} / 600`,W/2,badgeY+17,14,COLORS.ink,800);
  r.button('play',state().checkpoint?'Продолжить':'Играть',54,playY,282,short?54:62,resumeGame,{kind:'primary',icon:'play'});
  if(!short)r.text(state().checkpoint?'Ваша головоломка ждёт вас':'Освободи детали. Найди свой ход.',W/2,cardsY-14,12,'#d6dad0',600);
  r.button('daily-reward','Подарок дня',18,cardsY,172,56,()=>openModal('login'),{icon:'gift',small:true});
  r.button('daily-challenge','Вызов дня',200,cardsY,172,56,()=>setScreen('daily'),{icon:'calendar',small:true});
  nav();
}
function levels(){
  const short=compact();header('Карта мастерства');const y=short?(r.h<560?108:121):154;
  r.panel(20,y,350,short?48:58);r.text('600 головоломок. Один верный ход.',W/2,y+20,13,COLORS.ink,800);r.progress(41,y+(short?34:40),308,(state().level-1)/600,'#55886d');
  const gridY=y+(short?62:76),pageY=navTop()-46,gridH=pageY-gridY-12;
  const rows=Math.min(5,Math.max(1,Math.floor((gridH+8)/68))),perPage=rows*5,pages=Math.ceil(LEVEL_COUNT/perPage);
  if(perPage!==levelPageSize){const oldStart=levelPage*levelPageSize,n=Math.min(state().level,LEVEL_COUNT)-1;levelPage=Math.floor((n>=oldStart&&n<oldStart+levelPageSize?n:oldStart)/perPage);levelPageSize=perPage;}
  levelPage=Math.min(pages-1,levelPage);const rowGap=Math.min(91,gridH/rows);
  for(let i=0;i<perPage;i++){
    const n=levelPage*perPage+i+1,x=19+(i%5)*72,yy=gridY+Math.floor(i/5)*rowGap,unlocked=n<=state().level;
    if(n>LEVEL_COUNT)continue;
    r.button('level-'+n,unlocked?String(n):'',x,yy,64,48,()=>startGame(n),{kind:n===state().level?'primary':'square',icon:unlocked?undefined:'lock',disabled:!unlocked});
    const stars=state().stars[String(n)]||0;for(let j=0;j<3;j++)r.icon('star',x+10+j*14,yy+50,11,j<stars?1:.18);
  }
  r.button('prev','',22,pageY,47,34,()=>{levelPage=Math.max(0,levelPage-1)},{kind:'square',icon:'back',disabled:levelPage===0});
  r.text(`${levelPage+1} / ${pages}`,W/2,pageY+17,14,COLORS.cream,800);
  r.button('next','Далее',290,pageY,78,34,()=>{levelPage=Math.min(pages-1,levelPage+1)},{small:true,disabled:levelPage===pages-1});nav();
}
function daily(){
  const short=compact(),tight=r.h<560;header('Задания дня');const y=short?(tight?100:121):151,challengeH=short?(tight?104:126):148,taskY=y+challengeH+16;
  r.panel(19,y,352,challengeH);r.icon('calendar',48,y+15,short?25:30);r.text('ГОЛОВОЛОМКА ДНЯ',89,y+(short?27:31),13,COLORS.ink,800,'left',247);
  if(!tight)r.text('Новый чертёж. Новая награда.',W/2,y+(short?48:58),short?12:14,COLORS.ink,700);
  const rewardY=y+(tight?48:short?69:81);r.icon('coin',106,rewardY-11,21);r.text('150 монет за решение',135,rewardY,12,COLORS.ink,600,'left',195);
  r.button('daily-play',state().daily.completed?'Пройдено сегодня':state().dailyCheckpoint?'Продолжить вызов':'Принять вызов',42,y+challengeH-47,306,short?32:34,startDaily,{kind:'primary',disabled:state().daily.completed,small:true});
  r.text('ЗАДАНИЯ ДНЯ',23,taskY,12,COLORS.gold,800,'left');
  const tasks=progression.tasks(),space=navTop()-14-(taskY+18),rows=Math.min(3,Math.max(1,Math.floor((space+8)/61))),pages=Math.ceil(3/rows);
  dailyTaskPage=Math.min(dailyTaskPage,pages-1);const cardH=Math.min(94,(space-(pages>1?36:0)-(rows-1)*8)/rows);
  tasks.slice(dailyTaskPage*rows,(dailyTaskPage+1)*rows).forEach((task,i)=>{
    const yy=taskY+18+i*(cardH+8);r.panel(19,yy,352,cardH);
    const cy=yy+cardH/2,small=cardH<70;r.icon(['trophy','screw','star'][dailyTaskPage*rows+i],43,cy-(small?13:16),small?26:32);r.text(task.title,91,cy-(small?8:12),small?12:13,COLORS.ink,800,'left',158);
    r.text(`${task.progress} / ${task.goal}`,91,cy+(small?9:11),small?10:12,COLORS.ink,600,'left');
    if(cardH>=90)r.progress(91,yy+cardH-22,158,task.progress/task.goal,'#598b71');
    r.button('task-'+task.id,task.claimed?'Взято':String(task.reward),266,cy-(small?16:19),82,small?32:38,()=>{if(progression.claimTask(task.id)){audio.play('reward');showToast('Награда получена')}},{icon:task.claimed?'check':'coin',disabled:task.claimed||task.progress<task.goal,small:true});
  });
  if(pages>1){const yy=navTop()-42;r.button('task-prev','',32,yy,44,29,()=>{dailyTaskPage--},{kind:'square',icon:'back',disabled:dailyTaskPage===0});r.text(`${dailyTaskPage+1} / ${pages}`,W/2,yy+15,12,COLORS.cream,700);r.button('task-next','Далее',292,yy,66,29,()=>{dailyTaskPage++},{small:true,disabled:dailyTaskPage===pages-1});}
  nav();
}
function shop(){
  const short=compact();header('Лавка мастера');if(!short)r.text('Помощь для сложного чертежа',W/2,153,14,COLORS.muted,600);
  const cards:[string,string,string,string][]=[['undo','undo','Отмена хода','Верните последний винт на место'],['remove','hammer','Снять винт','Уберите один винт с поля'],['shuffle','plus','Ещё отверстие','Откройте свободное место для винта']];
  const top=short?(r.h<560?112:125):178,coinTop=navTop()-94,space=coinTop-top-14,rows=Math.min(3,Math.max(1,Math.floor((space+10)/82))),pages=Math.ceil(cards.length/rows);
  shopPage=Math.min(shopPage,pages-1);const rowH=Math.min(120,(space-(pages>1?44:0)-(rows-1)*10)/rows);
  cards.slice(shopPage*rows,(shopPage+1)*rows).forEach(([id,icon,title,description],i)=>{
    const y=top+i*(rowH+10);r.panel(18,y,354,rowH);const small=rowH<100;
    r.icon(icon,35,y+(rowH-(small?32:44))/2,small?32:44);
    r.text(title,small?82:90,y+(small?rowH/2-11:23),small?14:18,COLORS.ink,800,'left',small?132:240);
    if(!small)r.text(description,90,y+43,10,COLORS.ink,600,'left',253);
    r.text(`В запасе: ${state().boosters[id as 'undo']}`,small?82:36,y+(small?rowH/2+13:rowH-27),small?11:12,COLORS.ink,700,'left',150);
    r.button('buy-'+id,String(BOOSTER_PRICES[id as 'undo']),222,y+(small?(rowH-38)/2:rowH-48),128,small?38:40,()=>{if(progression.buyBooster(id as 'undo')){audio.play('reward');showToast('Буст добавлен в запас')}else showToast('Недостаточно монет')},{kind:'primary',icon:'coin',small:true});
  });
  if(pages>1){const yy=coinTop-42;r.button('shop-prev','',32,yy,44,30,()=>{shopPage--},{kind:'square',icon:'back',disabled:shopPage===0});r.text(`${shopPage+1} / ${pages}`,W/2,yy+15,12,COLORS.cream,700);r.button('shop-next','Далее',292,yy,66,30,()=>{shopPage++},{small:true,disabled:shopPage===pages-1});}
  r.panel(18,coinTop,354,80);r.icon('coin',34,coinTop+16,32);r.text('Сундук монет',82,coinTop+27,14,COLORS.ink,800,'left',112);
  r.button('reward-coins','Видео + 100',202,coinTop+15,151,40,()=>rewarded({coins:100},()=>showToast('+100 монет')),{kind:'primary',small:true});
  r.text('Награда после полного просмотра',W/2,coinTop+65,11,COLORS.ink,600);nav();
}
function collection(){
  header('Ваша мастерская');const tabY=compact()?(r.h<560?109:125):151;r.button('tab-skins','Винты',24,tabY,165,44,()=>{collectionTab='skins';collectionPage=0},{kind:collectionTab==='skins'?'primary':'secondary',icon:'screw'});
  r.button('tab-bg','Фоны',201,tabY,165,44,()=>{collectionTab='backgrounds';collectionPage=0},{kind:collectionTab==='backgrounds'?'primary':'secondary',icon:'wardrobe'});
  const items=collectionTab==='skins'?SKINS:BACKGROUNDS;
  const top=tabY+60,space=navTop()-14-top,rows=Math.min(3,Math.max(1,Math.floor((space+9)/137))),perPage=rows*2,pages=Math.ceil(items.length/perPage);
  collectionPage=Math.min(collectionPage,pages-1);const cellH=Math.min(159,(space-(pages>1?44:0)-(rows-1)*9)/rows),cellW=168;
  items.slice(collectionPage*perPage,(collectionPage+1)*perPage).forEach((item,i)=>{
    const x=22+(i%2)*178,y=top+Math.floor(i/2)*(cellH+9);
    r.panel(x,y,cellW,cellH);
    const owned=collectionTab==='skins'?state().ownedSkins.includes(item.id):state().ownedBackgrounds.includes(item.id);
    const active=(collectionTab==='skins'?state().skin:state().background)===item.id;
    const artSize=Math.min(52,cellH-78);
    if(!owned){const mysteryH=Math.min(58,cellH-78),mysteryW=mysteryH*1.284;r.image('mystery.png',x+(cellW-mysteryW)/2,y+16,mysteryW,mysteryH);}
    else if(collectionTab==='skins'){r.image(`skins/${item.id}-screw.png`,x+(cellW-artSize)/2,y+16,artSize,artSize);}
    else r.cover(`backgrounds/${item.id}.webp`,x+21,y+16,126,cellH-89);
    r.text(owned?item.name:'Тайный подарок',x+84,y+cellH-58,12,COLORS.ink,800,'center',130);
    r.button('cosmetic-'+item.id,active?'Выбрано':owned?'Выбрать':String(item.price),x+20,y+cellH-42,128,29,()=>{
      const type=collectionTab==='skins'?'skin':'background';
      if(owned){progression.selectCosmetic(type,item.id);audio.play('tap');}
      else if(progression.buyCosmetic(type,item.id)){audio.play('reward');showToast('Новый предмет в коллекции');}
      else showToast('Недостаточно монет');
    },{kind:active?'primary':'secondary',icon:owned?'check':'coin',small:true});
  });
  if(pages>1){const yy=navTop()-44;r.button('collection-prev','',32,yy,44,32,()=>{collectionPage--},{kind:'square',icon:'back',disabled:collectionPage===0});r.text(`${collectionPage+1} / ${pages}`,W/2,yy+16,12,COLORS.cream,700);r.button('collection-next','Далее',292,yy,66,32,()=>{collectionPage++},{small:true,disabled:collectionPage===pages-1});}
  nav();
}
function gameplay(){
  if(!puzzle)return;
  const short=compact(),hudY=short?7:18;
  r.button('pause','',16,hudY,45,short?43:45,()=>openModal('pause'),{kind:'square',icon:'pause'});
  const min=Math.floor(elapsed/60),sec=Math.floor(elapsed%60),time=`${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  r.panel(112,hudY,167,short?45:53);r.text(isDaily?'ВЫЗОВ ДНЯ':`УРОВЕНЬ ${gameLevel}`,W/2,hudY+16,14,COLORS.ink,800);
  r.text(short?`${time} · ${removeMode?'Снять болт':puzzle.selected===null?'Выберите болт':'Выберите отверстие'}`:puzzle.level.name,W/2,hudY+(short?32:38),10,COLORS.ink,600,'center',148);
  r.button('help','',330,hudY,44,short?43:45,()=>openModal('help'),{kind:'square',icon:'hint'});
  if(!short){r.text(time,W/2,94,18,COLORS.cream,800);r.text(removeMode?'Выберите винт для снятия':puzzle.selected===null?'Выберите винт':'Теперь выберите свободное отверстие',W/2,125,13,COLORS.cream,700);}
  const fieldTop=short?63:159,footerY=r.h-(short?68:131),available=short?footerY-fieldTop-23:r.h-320;
  board.w=Math.min(340,available/BOARD_ASPECT);board.h=board.w*BOARD_ASPECT;board.x=(W-board.w)/2;board.y=fieldTop+(available-board.h)/2;
  const artScale=board.w/340;
  r.image('board.png',board.x-6,board.y-7,board.w+12,board.h+14);
  const c=r.c;
  for(const hole of puzzle.holes){
    const x=board.x+hole.x*board.w,y=board.y+hole.y*board.h;
    c.fillStyle='#573b26';c.beginPath();c.arc(x,y,10.5*artScale,0,Math.PI*2);c.fill();c.fillStyle='#ad8956';c.beginPath();c.arc(x,y+2*artScale,7.7*artScale,0,Math.PI*2);c.fill();c.fillStyle='#392b22';c.beginPath();c.arc(x,y+artScale,6.5*artScale,0,Math.PI*2);c.fill();
  }
  // A bolt's visibility follows real drawing depth, never its clickability.
  // Wood naturally covers pixels of lower heads as it swings across them.
  const poses=(puzzle.livePlanks as Pose[]).sort((a,b)=>a.layer-b.layer);
  const boltLayers=new Map<number,number>();
  for(const pose of poses)for(const binding of puzzle.getSupportBindings(pose.id))boltLayers.set(binding.hole,Math.max(boltLayers.get(binding.hole)??-Infinity,pose.layer));
  const drawBolt=(id:number)=>{if(!puzzle!.screws[id]||screwFlight?.hole===id)return;const hole=puzzle!.holes[id];screwAt(board.x+hole.x*board.w,board.y+hole.y*board.h,puzzle!.selected===id||removeMode||!!(hintPair&&hintPair.from===id&&clock<hintUntil),artScale);};
  c.save();c.beginPath();c.rect(board.x-13,board.y-13,board.w+26,board.h+31);c.clip();
  for(const layer of [...new Set(poses.map(p=>p.layer))]){
    for(const pose of poses)if(pose.layer===layer)drawPlank(pose);
    for(const [hole,ownerLayer]of boltLayers)if(ownerLayer===layer)drawBolt(hole);
  }
  for(const hole of puzzle.holes)if(!boltLayers.has(hole.id))drawBolt(hole.id);
  c.restore();
  for(const hole of puzzle.holes){const x=board.x+hole.x*board.w,y=board.y+hole.y*board.h;
    const reachable=puzzle.canSelect(hole.id);
    if(!puzzle.screws[hole.id]&&puzzle.selected!==null&&puzzle.canMove(puzzle.selected,hole.id)){
      c.strokeStyle='rgba(114,222,179,.75)';c.lineWidth=2;c.beginPath();c.arc(x,y,11.7*artScale,0,Math.PI*2);c.stroke();
    }
    if(hintPair&&hintPair.to===hole.id&&clock<hintUntil){c.strokeStyle='#79dfb6';c.lineWidth=3;c.beginPath();c.arc(x,y,(14+Math.sin(clock*6)*2)*artScale,0,Math.PI*2);c.stroke();}
    if(!puzzle.screws[hole.id]||reachable)r.hits.push({id:'hole-'+hole.id,label:`Отверстие ${hole.id+1}`,x:x-17,y:y-17,w:34,h:34,fn:()=>holeTap(hole.id)});
  }
  if(screwFlight){const flight=screwFlight,t=Math.min(1,(clock-flight.start)/.46),e=t*t*(3-2*t);
    const fx=board.x+(flight.from.x+(flight.to.x-flight.from.x)*e)*board.w,fy=board.y+(flight.from.y+(flight.to.y-flight.from.y)*e)*board.h-Math.sin(t*Math.PI)*35;
    c.save();c.translate(fx,fy);c.rotate(t*Math.PI*4);c.globalAlpha=flight.removing?1-t:1;const size=(26+Math.sin(t*Math.PI)*9)*artScale,asset=`skins/${state().skin}-screw.png`;r.image(r.images.has(asset)?asset:'screw.png',-size/2,-size/2,size,size);c.restore();
    if(t>=1){screwFlight=null;scatter(fx,fy,9);}
  }
  r.text(`Ходы: ${puzzle.moves}`,26,footerY-(short?12:21),short?10:12,COLORS.muted,700,'left');
  r.text(`Детали: ${puzzle.removed.filter(Boolean).length} / ${puzzle.planks.length}`,364,footerY-(short?12:21),short?10:12,COLORS.muted,700,'right');
  const tools:[string,string,()=>void,string][]=[['undo','undo',()=>booster('undo'),String(state().boosters.undo)],['remove','hammer',()=>booster('remove'),String(state().boosters.remove)],['shuffle','plus',()=>booster('shuffle'),String(state().boosters.shuffle)],['hint','hint',hint,String(state().boosters.hint)]];
  tools.forEach(([id,icon,fn,count],i)=>{const x=26+i*89;r.button('tool-'+id,'',x,footerY,70,short?43:60,fn,{kind:removeMode&&id==='remove'?'primary':'square',icon});
    if(id==='hint'&&state().boosters.hint===0)r.image('ui/badge-ad.png',x+34,footerY-3,40,17);
    else if(count){r.panel(x+48,footerY-5,26,24);r.text(count,x+61,footerY+7,10,COLORS.ink,800);}
    r.text(['Отмена','Снять','Место','Подсказка'][i],x+35,footerY+(short?54:75),10,COLORS.cream,700);
  });
  if(!short&&gameLevel===1&&puzzle.moves===0)r.text('Перенесите винты в верхние отверстия',W/2,board.y+board.h+27,11,COLORS.gold,700);
}
function dialog(){
  if(!modal)return;
  const c=r.c;c.fillStyle='rgba(7,17,22,.76)';c.fillRect(0,0,W,r.h);r.hits=[];
  let h=modal==='login'?488:modal==='win'?420:modal==='settings'?356:modal==='help'?424:modal==='hearts'?410:340;
  const modalScale=Math.min(1,(r.h-24)/h),modalOffset=W*(1-modalScale)/2;
  c.save();c.translate(modalOffset,0);c.scale(modalScale,modalScale);
  const y=(r.h/modalScale-h)/2,x=22,w=346;r.panel(x,y,w,h);
  const title={settings:'Настройки',login:'Подарок за возвращение',hearts:'Нужна новая жизнь?',pause:'Немного передохнём',win:'Отличная работа!',restart:'Начать заново?',help:'Как играть',booster:'Помощь мастера'}[modal];
  r.text(title,W/2-7,y+39,21,COLORS.ink,800,'center',242);
  r.button('close','',323,y+17,29,29,()=>{if(modal==='win')setScreen('home');else modal=null},{kind:'square',icon:'close'});
  if(modal==='settings'){
    const settings:[string,string,string][]=[['sound','sound','Звуки'],['music','music','Музыка'],['haptic','heart','Вибрация']];
    settings.forEach(([id,icon,label],i)=>{const yy=y+85+i*68;r.icon(icon,45,yy+6,32);r.text(label,95,yy+22,17,COLORS.ink,700,'left');const enabled=state().settings[id as 'sound'];r.button('setting-'+id,enabled?'Вкл':'Выкл',246,yy,92,43,()=>{progression.setSetting(id as 'sound',!enabled);syncAudio()},{kind:enabled?'primary':'secondary',small:true});});
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
    r.button('claim-login',claimed?'До встречи завтра':'Забрать подарок',49,y+h-70,292,48,()=>{const result=progression.claimLogin();if(result){audio.play('reward');scatter(W/2,(y+270)*modalScale,45,true);showToast('Ежедневный подарок получен')}},{kind:'primary',icon:claimed?'check':'gift',disabled:claimed});
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
    r.wrap('Нажмите на болт и выберите отверстие. Если отверстие в балке совпало с отверстием в доске, болт снова закрепит её.',W/2,y+157,280,14,COLORS.ink,21);
    r.wrap('Балки качаются на креплениях и могут опираться на другие болты. Уберите опоры и дайте всем деталям упасть.',W/2,y+259,280,14,COLORS.ink,21);
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
  c.restore();
  if(modalScale<1)r.hits.forEach(hit=>{hit.x=modalOffset+hit.x*modalScale;hit.y*=modalScale;hit.w*=modalScale;hit.h*=modalScale;});
}
function syncAudio(){audio.sound=state().settings.sound;audio.music=state().settings.music;}
function draw(now:number){
  const wallDt=Math.max(0,(now-last)/1000),simulationPaused=platform.paused||document.hidden||adPending||(screen==='game'&&modal!==null);
  const dt=simulationPaused?0:Math.min(.04,wallDt);last=now;clock+=dt;
  audio.paused=simulationPaused;
  if(ready){
    if(screen==='game'&&!modal&&!platform.paused&&!document.hidden&&!adPending&&puzzle&&!puzzle.solved)elapsed+=wallDt;
    if(screen==='game'&&physics&&puzzle&&dt>0&&!puzzle.solved){
      physics.syncPuzzle(puzzle);physics.step(dt);
      const removed=puzzle.removed.filter(Boolean).length;
      puzzle.syncPhysics(physics.getPoses(),physics.getFallenIds(),physics.getContacts());
      if(puzzle.removed.filter(Boolean).length>removed)audio.play('drop');
      if(puzzle.solved)win();
    }
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
