import test from 'node:test';
import assert from 'node:assert/strict';
import {samplePivotMotion} from './motion';

const before={x:.5,y:.4,angle:0,length:.5};
const anchor={x:.3,y:.4};
const after={x:.3,y:.4+.2/1.2,angle:Math.PI/2,length:.5};
test('unscrewing starts at rest with continuous acceleration',()=>{
  for(const t of [0,.05,.095]){
    const pose=samplePivotMotion(before,after,anchor,t);
    assert.equal(pose.x,before.x);assert.equal(pose.y,before.y);
    assert.equal(pose.angle,before.angle);assert.equal(pose.angularVelocity,0);
  }
  assert.ok(samplePivotMotion(before,after,anchor,.095+1/60).angle<.015);
});
test('the surviving screw remains fixed for the entire pendulum swing',()=>{
  for(let t=0;t<3;t+=1/120){
    const pose=samplePivotMotion(before,after,anchor,t);
    assert.ok(Math.abs(pose.x-.2*Math.cos(pose.angle)-anchor.x)<1e-12);
    assert.ok(Math.abs(pose.y-.2*Math.sin(pose.angle)/1.2-anchor.y)<1e-12);
    assert.ok(Number.isFinite(pose.angularVelocity));
  }
});
test('a small overshoot settles without drifting or an abrupt starting jump',()=>{
  const samples=Array.from({length:361},(_,i)=>samplePivotMotion(before,after,anchor,i/120));
  const maximum=Math.max(...samples.map(p=>p.angle));
  assert.ok(maximum>after.angle);assert.ok(maximum<after.angle*1.065);
  const last=samples.at(-1)!;
  assert.equal(last.settled,true);assert.equal(last.angle,after.angle);
  assert.ok(Math.abs(last.x-after.x)<1e-12);assert.ok(Math.abs(last.y-after.y)<1e-12);
});
test('release velocity is the tangent of the visible strip motion',()=>{
  const t=.32,step=1e-6,p=samplePivotMotion(before,after,anchor,t);
  const next=samplePivotMotion(before,after,anchor,t+step);
  assert.ok(Math.abs((next.x-p.x)/step-p.vx)<1e-5);
  assert.ok(Math.abs((next.y-p.y)/step-p.vy)<1e-5);
});
