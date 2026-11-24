import * as THREE from 'three';
import { siteFeatures } from '../spec/site-layers.js';

// Shared centreline for mesh construction and traffic; distances are in metres.
export function createRoadRoute(layout) {
  const R=siteFeatures(layout).roads, radius=11, x=R.side, a=R.front, b=R.back;
  const path=new THREE.Path(); path.moveTo(x,a-radius);
  path.absarc(x-radius,a-radius,radius,0,Math.PI/2,false);
  path.lineTo(-x+radius,a);path.absarc(-x+radius,a-radius,radius,Math.PI/2,Math.PI,false);
  path.lineTo(-x,b+radius);path.absarc(-x+radius,b+radius,radius,Math.PI,Math.PI*1.5,false);
  path.lineTo(x-radius,b);path.absarc(x-radius,b+radius,radius,Math.PI*1.5,Math.PI*2,false);
  path.closePath(); path.arcLengthDivisions=1800; path.updateArcLengths();
  const length=path.getLength();
  function at(distance,offset=0) {
    const u=((distance/length)%1+1)%1,p=path.getPointAt(u),t=path.getTangentAt(u).normalize();
    return {x:p.x-t.y*offset,z:p.y+t.x*offset,tx:t.x,tz:t.y,y:.47};
  }
  return {at,length,R};
}
