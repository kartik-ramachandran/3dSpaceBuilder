import * as THREE from 'three';
import { box, cyl, merge, std } from '../scene/helpers.js';
import { rng } from '../util.js';
import { createRoadRoute } from './road-route.js';

// Material UVs use real metres, so aggregate and pavers never stretch with road length.
function texture(kind) {
  const size=1024,c=document.createElement('canvas');c.width=c.height=size;
  const ctx=c.getContext('2d'),r=rng(kind==='asphalt'?861:427),data=ctx.createImageData(size,size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const i=(y*size+x)*4,grain=r(),n=kind==='asphalt'?57+(grain-.5)*27+Math.sin(x*.021)*2+Math.cos(y*.017)*2:137+(grain-.5)*17;
    data.data[i]=n;data.data[i+1]=n+2;data.data[i+2]=kind==='asphalt'?n+3:n-5;data.data[i+3]=255;
  }
  ctx.putImageData(data,0,0);
  if(kind==='pavers') {
    ctx.strokeStyle='rgba(52,49,43,.45)';ctx.lineWidth=3;
    for(let y=0;y<size;y+=128){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(size,y);ctx.stroke();for(let x=(y/128%2)*128;x<size;x+=256){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+128);ctx.stroke();}}
  } else {
    // Low contrast repaired seams and scattered mineral inclusions.
    for(let i=0;i<11000;i++){const x=r()*size,y=r()*size;ctx.fillStyle=r()<.5?'rgba(15,19,20,.12)':'rgba(173,168,155,.16)';ctx.fillRect(x,y,1+r()*2,1+r()*2);}
    ctx.strokeStyle='rgba(15,20,23,.16)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(720,0);for(let y=0;y<=size;y+=25)ctx.lineTo(710+Math.sin(y*.013)*12,y);ctx.stroke();
  }
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.anisotropy=16;
  return tex;
}
export function buildDetailedRoads(layout) {
  const group=new THREE.Group();group.name='Detailed residential streets';
  const route=createRoadRoute(layout),{R,length,at}=route,half=R.width/2;
  const asphaltMap=texture('asphalt'),paverMap=texture('pavers');
  const bump=asphaltMap.clone();bump.colorSpace=THREE.NoColorSpace;
  const asphalt=std('#ffffff',{map:asphaltMap,bumpMap:bump,bumpScale:.018,roughness:.96,metalness:0});
  const paving=std('#c3b8a5',{map:paverMap,roughness:.94,metalness:0});
  const concrete=std('#aaa698',{roughness:.95,metalness:0});
  const paint=std('#d9d4bf',{roughness:.88,metalness:0,polygonOffset:true,polygonOffsetFactor:-1});
  const dark=std('#3b4041',{roughness:.9,metalness:.1});
  function strip(from,to,y,mat,period=4,start=0,end=length) {
    const n=Math.max(1,Math.ceil((end-start)/.7)),pos=[],uv=[],idx=[];
    for(let i=0;i<=n;i++){const d=start+(end-start)*i/n;for(const offset of [from,to]){const p=at(d,offset);pos.push(p.x,y,p.z);uv.push(p.x/period,p.z/period);}if(i<n){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,mat);mesh.receiveShadow=true;group.add(mesh);return mesh;
  }
  strip(-half,half,.47,asphalt);
  const curbs=[],kerbDark=[],grates=[],covers=[],marks=[],poles=[],lights=[],bollards=[];
  for(const side of [-1,1]) {
    const a=side*(half+.15),b=side*(half+2.75);
    strip(Math.min(a,b),Math.max(a,b),.62,paving,2);
    const va=side*(half+2.75),vb=side*(half+3.35);
    strip(Math.min(va,vb),Math.max(va,vb),.12,std('#706d55',{roughness:1}),3);
    strip(side*half-.12,side*half+.12,.48,concrete);
    for(let d=0;d<length;d+=1.25) {
      const p=at(d,side*(half+.13));
      // Opening and dropped kerb at the front entrance / pedestrian crossings.
      const crossing=Math.abs(p.z-R.front)<1 && (Math.abs(p.x)<4||Math.abs(Math.abs(p.x)-44)<3);
      const h=crossing?.04:.17;
      const geo=box(1.22,h,.26,0,.47+h/2,0).rotateY(-Math.atan2(p.tz,p.tx)).translate(p.x,0,p.z);
      (Math.floor(d/2.5)%2?curbs:kerbDark).push(geo);
    }
    // Continuous thin edge paint, inset from the drainage channel.
    strip(side*(half-.35)-.055,side*(half-.35)+.055,.482,paint);
  }
  for(let d=0;d<length;d+=7) {
    const p=at(d);
    if(Math.abs(p.z-R.front)<4 && (Math.abs(p.x)<6||Math.abs(Math.abs(p.x)-44)<7))continue;
    strip(-.065,.065,.485,paint,4,d,Math.min(length,d+2.5));
  }
  // Worn wheel tracks are a subtle material change, never opaque black stripes.
  const rubber=std('#24292b',{transparent:true,opacity:.075,roughness:.8,depthWrite:false});
  for(const offset of [-2.5,-1.05,1.05,2.5])strip(offset-.18,offset+.18,.479,rubber);
  for(const x of [-44,44]) {
    for(let k=-2;k<=2;k++)marks.push(box(.55,.008,R.width-1,x+k*1.05,.49,R.front));
    // Stop bars before each pedestrian crossing, one per approaching lane.
    marks.push(box(.23,.008,2.8,x-4.1,.49,R.front-1.75),box(.23,.008,2.8,x+4.1,.49,R.front+1.75));
  }
  for(let d=9;d<length;d+=26) {
    const p=at(d,-half+.32),angle=-Math.atan2(p.tz,p.tx);
    for(let i=0;i<8;i++)grates.push(box(.035,.016,.43,(i-3.5)*.08,.488,0).rotateY(angle).translate(p.x,0,p.z));
    const q=at(d,-half-2.3);
    poles.push(cyl(.055,.105,6.2,q.x,3.72,q.z,10));
    const arm=box(.09,.09,1.4,0,6.78,-.7).rotateY(angle).translate(q.x,0,q.z);poles.push(arm);
    lights.push(box(.35,.07,.9,0,6.72,-1).rotateY(angle).translate(q.x,0,q.z));
  }
  for(const x of [-25,25]) {
    covers.push(cyl(.34,.34,.018,x,.487,R.front+.7,32));
    for(let i=-2;i<=2;i++)grates.push(box(.48,.006,.018,x,.501,R.front+.7+i*.09));
  }
  for(let x=-layout.siteX/2;x<=layout.siteX/2;x+=9) {
    if(Math.abs(x)<5||Math.abs(Math.abs(x)-44)<4)continue;
    bollards.push(cyl(.065,.075,.8,x,1.02,R.front-half-1,8));
  }
  const mesh=(parts,mat)=>{if(!parts.length)return;const m=new THREE.Mesh(merge(parts),mat);m.castShadow=true;m.receiveShadow=true;group.add(m);};
  mesh(curbs,concrete);mesh(kerbDark,std('#676b63',{roughness:.95}));mesh(marks,paint);
  mesh(grates,std('#424746',{metalness:.55,roughness:.7}));mesh(covers,dark);mesh(poles,std('#586061',{metalness:.7,roughness:.55}));mesh(lights,std('#d6d5c0',{emissive:'#e6dcbd',emissiveIntensity:.12}));mesh(bollards,dark);
  // Paved entrance covers the enlarged satellite pixels between the site and road.
  const entranceGeo=box(8,.12,14,0,.43,R.front-10);
  const pos=entranceGeo.attributes.position,uv=entranceGeo.attributes.uv;for(let i=0;i<pos.count;i++)uv.setXY(i,pos.getX(i)/2,pos.getZ(i)/2);
  const entrance=new THREE.Mesh(entranceGeo,paving);group.add(entrance);
  const apron=new THREE.Mesh(box(layout.siteX+8,.15,12,0,.16,R.front-11),std('#777f60',{roughness:1}));apron.receiveShadow=true;group.add(apron);
  group.userData.routeLength=length;
  return {group,route};
}
