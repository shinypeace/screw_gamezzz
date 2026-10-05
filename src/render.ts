export const W = 390;
export const COLORS = { ink:'#fff0d4', cream:'#fff0d4', muted:'#b9c3c2', gold:'#edc37e', teal:'#46b9a3', dark:'#142a32' };
export type Hit = {id:string;label:string;x:number;y:number;w:number;h:number;fn:()=>void;disabled?:boolean};
const iconNames=['home','shop','wardrobe','gear','back','pause','play','coin','heart','star','gift','trophy','hammer','undo','shuffle','hint','sound','music','calendar','check','lock','close','plus','screw'];
export class Renderer {
  c:CanvasRenderingContext2D;
  h=844;
  scale=1;
  images=new Map<string,HTMLImageElement>();
  hits:Hit[]=[];
  pointer={x:-100,y:-100};
  pressed='';
  insets={top:0,bottom:0,banner:0};
  constructor(public canvas:HTMLCanvasElement) { this.c=canvas.getContext('2d',{alpha:false})!; this.resize(); }
  resize() {
    const el=document.getElementById('game')!;
    const viewHeight=window.innerHeight-this.insets.top-this.insets.bottom-this.insets.banner;
    const maxW=Math.min(window.innerWidth,viewHeight*.57,520);
    el.style.width=`${maxW}px`;
    el.style.height=`${viewHeight}px`;
    el.style.marginTop=`${this.insets.top}px`;
    const rect=el.getBoundingClientRect();
    this.scale=Math.min(rect.width/W,rect.height/680);
    this.h=rect.height/this.scale;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    this.canvas.width=Math.round(rect.width*dpr);this.canvas.height=Math.round(rect.height*dpr);
    this.c.setTransform(dpr*this.scale,0,0,dpr*this.scale,0,0);
  }
  /** Late or failed network requests must never hold the loading screen. */
  async loadAsset(file:string, timeout=8_000): Promise<boolean> {
    const img=new Image();
    const loaded=await new Promise<boolean>(resolve=>{
      let settled=false;
      const finish=(success:boolean)=>{
        if(settled)return;settled=true;clearTimeout(timer);
        img.onload=null;img.onerror=null;resolve(success);
      };
      const timer=setTimeout(()=>{finish(false);img.removeAttribute('src')},timeout);
      img.onload=()=>finish(img.naturalWidth>0);img.onerror=()=>finish(false);
      img.src=`${import.meta.env.BASE_URL}assets/${file}`;
    });
    if(loaded)this.images.set(file,img);
    return loaded;
  }
  async load() {
    const files=['ui/button-primary.png','ui/button-secondary.png','ui/button-square.png','ui/panel.png','ui/badge-ad.png','mystery.png','board.png','plank.png','screw.png',...iconNames.map(x=>`icons/${x}.png`),...['workshop','midnight','forest','sunset','arctic'].map(x=>`backgrounds/${x}.webp`)];
    let loaded=0;
    await Promise.all(files.map(async file=>{
      await this.loadAsset(file);
      const progress=document.getElementById('load-progress');
      if(progress)progress.style.width=`${++loaded/files.length*100}%`;
    }));
  }
  image(key:string,x:number,y:number,w:number,h:number,alpha=1) {
    const im=this.images.get(key);if(!im)return;
    this.c.save();this.c.globalAlpha*=alpha;this.c.drawImage(im,x,y,w,h);this.c.restore();
  }
  icon(key:string,x:number,y:number,size=28,alpha=1) {this.image(`icons/${key}.png`,x,y,size,size,alpha);}
  cover(key:string,x:number,y:number,w:number,h:number){
    const im=this.images.get(key);if(!im)return;const scale=Math.max(w/im.width,h/im.height);
    this.c.save();this.c.beginPath();this.c.rect(x,y,w,h);this.c.clip();this.c.drawImage(im,x+(w-im.width*scale)/2,y+(h-im.height*scale)/2,im.width*scale,im.height*scale);this.c.restore();
  }
  background(key='workshop',dark=.2) {
    const c=this.c;c.fillStyle='#152a34';c.fillRect(0,0,W,this.h);
    const im=this.images.get(`backgrounds/${key}.webp`);
    if(im){const z=Math.max(W/im.width,this.h/im.height);c.drawImage(im,(W-im.width*z)/2,(this.h-im.height*z)/2,im.width*z,im.height*z);}
    c.fillStyle=`rgba(9,24,32,${dark})`;c.fillRect(0,0,W,this.h);
    const g=c.createLinearGradient(0,0,0,this.h);g.addColorStop(0,'rgba(8,20,28,.65)');g.addColorStop(.35,'rgba(8,20,28,0)');g.addColorStop(1,'rgba(8,20,28,.7)');c.fillStyle=g;c.fillRect(0,0,W,this.h);
  }
  text(text:string,x:number,y:number,size=16,color=COLORS.cream,weight=700,align:CanvasTextAlign='center',maxWidth=360) {
    const c=this.c;c.save();c.font=`${weight} ${size}px 'Trebuchet MS', 'Segoe UI', sans-serif`;c.fillStyle=color;c.textAlign=align;c.textBaseline='middle';
    while(c.measureText(text).width>maxWidth&&size>8){size-=.5;c.font=`${weight} ${size}px 'Trebuchet MS', 'Segoe UI', sans-serif`;}
    c.fillText(text,x,y);c.restore();
  }
  wrap(text:string,x:number,y:number,width:number,size=15,color=COLORS.ink,lineHeight=22) {
    const c=this.c;c.save();c.font=`600 ${size}px 'Trebuchet MS', 'Segoe UI', sans-serif`;
    const words=text.split(' ');let line='',n=0;
    for(const word of words){if(c.measureText(line+' '+word).width>width&&line){this.text(line,x,y+n++*lineHeight,size,color,600,'center',width);line=word;}else line+=(line?' ':'')+word;}
    if(line)this.text(line,x,y+n++*lineHeight,size,color,600,'center',width);c.restore();return n*lineHeight;
  }
  panel(x:number,y:number,w:number,h:number,alpha=1) {
    const im=this.images.get('ui/panel.png');if(!im)return;
    const s=40,d=Math.min(15,w/3,h/3),c=this.c;c.save();c.globalAlpha*=alpha;
    const sx=[0,s,im.width-s],sy=[0,s,im.height-s],sw=[s,im.width-2*s,s],sh=[s,im.height-2*s,s];
    const dx=[x,x+d,x+w-d],dy=[y,y+d,y+h-d],dw=[d,w-2*d,d],dh=[d,h-2*d,d];
    for(let j=0;j<3;j++)for(let i=0;i<3;i++)c.drawImage(im,sx[i],sy[j],sw[i],sh[j],dx[i],dy[j],dw[i],dh[j]);c.restore();
  }
  button(id:string,label:string,x:number,y:number,w:number,h:number,fn:()=>void,opts:{kind?:'primary'|'secondary'|'square';icon?:string;disabled?:boolean;small?:boolean}={}) {
    const c=this.c, pressed=this.pressed===id;
    c.save();if(pressed){c.translate(x+w/2,y+h/2);c.scale(.96,.96);c.translate(-x-w/2,-y-h/2);}if(opts.disabled)c.globalAlpha=.5;
    this.image(`ui/button-${opts.kind||'secondary'}.png`,x,y,w,h);
    let size=opts.small?12:16;const center=x+w/2,pad=Math.min(20,h*.25),iconSize=Math.min(28,h-pad*2);
    if(opts.icon&&label){
      const maxText=w-pad*2-iconSize-7;c.font=`800 ${size}px 'Trebuchet MS', 'Segoe UI', sans-serif`;
      while(c.measureText(label).width>maxText&&size>8){size-=.5;c.font=`800 ${size}px 'Trebuchet MS', 'Segoe UI', sans-serif`;}
      const tw=c.measureText(label).width,total=iconSize+7+tw,start=center-total/2;
      this.icon(opts.icon,start,y+(h-iconSize)/2,iconSize);this.text(label,start+iconSize+7+tw/2,y+h/2,size,COLORS.cream,800,'center',maxText);
    }
    else if(opts.icon){const p=Math.min(12,h*.2),iconOnly=Math.min(32,w-p*2,h-p*2);this.icon(opts.icon,center-iconOnly/2,y+(h-iconOnly)/2,iconOnly);}
    else this.text(label,center,y+h/2,size,COLORS.cream,800,'center',w-pad*2);
    c.restore();this.hits.push({id,label:label||id,x,y,w,h,fn,disabled:opts.disabled});
  }
  pill(icon:string,label:string,x:number,y:number,w:number,fn?:()=>void) {
    this.panel(x,y,w,44);const c=this.c;c.font=`800 14px 'Trebuchet MS', 'Segoe UI', sans-serif`;const tw=Math.min(w-48,c.measureText(label).width),total=19+7+tw,start=x+(w-total)/2;
    this.icon(icon,start,y+12.5,19);this.text(label,start+26+tw/2,y+22,14,COLORS.ink,800,'center',w-48);
    if(fn)this.hits.push({id:'pill-'+icon,label:icon,x,y,w,h:38,fn});
  }
  progress(x:number,y:number,w:number,amount:number,color=COLORS.teal) {
    const c=this.c;c.fillStyle='rgba(32,28,24,.24)';c.beginPath();c.roundRect(x,y,w,7,4);c.fill();c.fillStyle=color;c.beginPath();c.roundRect(x,y,w*Math.max(.02,Math.min(1,amount)),7,4);c.fill();
  }
  hit(x:number,y:number) {
    const holes=this.hits.filter(h=>h.id.startsWith('hole-')&&!h.disabled&&Math.hypot(x-h.x-h.w/2,y-h.y-h.h/2)<=h.w/2);
    if(holes.length)return holes.sort((a,b)=>Math.hypot(x-a.x-a.w/2,y-a.y-a.h/2)-Math.hypot(x-b.x-b.w/2,y-b.y-b.h/2))[0];
    for(let i=this.hits.length-1;i>=0;i--){const h=this.hits[i];if(!h.disabled&&x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h)return h;}
    return undefined;
  }
  coordinates(e:PointerEvent){const rect=this.canvas.getBoundingClientRect();return{x:(e.clientX-rect.left)/this.scale,y:(e.clientY-rect.top)/this.scale};}
}
