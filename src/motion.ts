/** A hanging strip starts at rest, accelerates under gravity and settles after
 * a small swing. Coordinates remain rigidly attached to the surviving screw. */
export interface MotionPose { x:number; y:number; angle:number; length:number }
export interface PivotMotion extends MotionPose {
  angularVelocity:number; vx:number; vy:number; settled:boolean;
}
export function samplePivotMotion(before:MotionPose, after:MotionPose,
  anchor:{x:number;y:number}|undefined, elapsed:number, aspect=1.2):PivotMotion {
  const time=Math.max(0,elapsed-.095);
  const omega=8.8*Math.sqrt(.38/Math.max(.16,before.length));
  const damping=.68, damped=omega*Math.sqrt(1-damping*damping);
  const decay=Math.exp(-damping*omega*time);
  const settled=time>0 && decay<.001;
  const response=settled?1:1-decay*(Math.cos(damped*time)+damping*omega/damped*Math.sin(damped*time));
  const angularVelocity=settled?0:(after.angle-before.angle)*decay*omega*omega/damped*Math.sin(damped*time);
  const angle=before.angle+(after.angle-before.angle)*response;
  let x=before.x+(after.x-before.x)*response,y=before.y+(after.y-before.y)*response;
  let vx=0,vy=0;
  if(anchor){
    const dx=anchor.x-before.x,dy=(anchor.y-before.y)*aspect;
    const localX=dx*Math.cos(before.angle)+dy*Math.sin(before.angle);
    const localY=-dx*Math.sin(before.angle)+dy*Math.cos(before.angle);
    x=anchor.x-(localX*Math.cos(angle)-localY*Math.sin(angle));
    y=anchor.y-(localX*Math.sin(angle)+localY*Math.cos(angle))/aspect;
    vx=-angularVelocity*(y-anchor.y)*aspect;
    vy=angularVelocity*(x-anchor.x)/aspect;
  }
  return {x,y,angle,length:before.length,angularVelocity,vx,vy,settled};
}
