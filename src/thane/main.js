import { Color } from 'three';
import { normalize } from '../spec/schema.js';
import { buildValuations } from '../spec/valuations.js';
import { createDevelopmentLayer } from './development-layer.js';
import { createGeo, collectContext } from './real-context.js';
import { locationFactors, applyFactors } from './location-value.js';

const $=s=>document.querySelector(s), ml=window.maplibregl;
export const LOCATION=[72.983287,19.209007];
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const spec=normalize({kind:'development',name:'Vrindavan Residences',currency:'INR',shell:{buildings:6,rows:2,floors:4,unitsPerFloor:4,basePrice:8500000}});
const values=buildValuations(spec), byId=new Map(spec.zones.map(z=>[z.id,z]));
// Dummy values with each flat's location factors from the real surroundings applied (once the map data is in).
let priced=applyFactors(values,null), realCtx=null, geo=null, valueColours=true;
const format=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n);
const compact=n=>n>=10000000?`${(n/10000000).toFixed(2)} Cr`:`${(n/100000).toFixed(1)} L`;
let stage='city', layer, marker, ready=false, satellite=true, buildings=true, activity=true, orbit=false, selected, transition=0;
const cameras={city:{center:[72.977,19.215],zoom:12.8,pitch:48,bearing:-22},neighbourhood:{center:LOCATION,zoom:15.8,pitch:57,bearing:-28},development:{center:LOCATION,zoom:16.25,pitch:58,bearing:-24}};
const status=$('#status');
const coord=[LOCATION[0],LOCATION[1]], dx=.0012,dy=.00085;
const footprint={type:'Polygon',coordinates:[[[coord[0]-dx,coord[1]-dy],[coord[0]+dx,coord[1]-dy],[coord[0]+dx,coord[1]+dy],[coord[0]-dx,coord[1]+dy],[coord[0]-dx,coord[1]-dy]]]};
const style={version:8,glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',sources:{
  imagery:{type:'raster',tiles:['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Imagery &copy; Esri, Maxar, Earthstar Geographics and the GIS User Community'},
  city:{type:'vector',url:'https://tiles.openfreemap.org/planet',attribution:'<a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap contributors</a> | <a href="https://openfreemap.org">OpenFreeMap</a>'}
},layers:[
  {id:'background',type:'background',paint:{'background-color':'#263b3d'}},
  {id:'land',type:'fill',source:'city','source-layer':'landcover',paint:{'fill-color':['match',['get','class'],'wood','#355549','grass','#4a6252','#34494b']}},
  {id:'water',type:'fill',source:'city','source-layer':'water',paint:{'fill-color':'#264f60'}},
  {id:'satellite',type:'raster',source:'imagery',paint:{'raster-saturation':-.25,'raster-contrast':.12,'raster-brightness-max':.87,'raster-fade-duration':350}},
  {id:'roads',type:'line',source:'city','source-layer':'transportation',filter:['match',['get','class'],['motorway','trunk','primary','secondary','tertiary','minor','service'],true,false],paint:{'line-color':'#b6b4a0','line-opacity':.42,'line-width':['interpolate',['linear'],['zoom'],10,.3,14,1,18,5]}},
  {id:'buildings-3d',type:'fill-extrusion',source:'city','source-layer':'building',minzoom:13.5,filter:['!', ['within',footprint]],paint:{'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','render_height'],12],0,'#abaca0',25,'#c3bdab',70,'#e1d5b8'],'fill-extrusion-height':['coalesce',['get','render_height'],12],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':.93,'fill-extrusion-vertical-gradient':true}},
  {id:'road-labels',type:'symbol',source:'city','source-layer':'transportation_name',minzoom:14,layout:{'symbol-placement':'line','text-field':['coalesce',['get','name:en'],['get','name']],'text-font':['Noto Sans Regular'],'text-size':11,'text-max-angle':30},paint:{'text-color':'#f2eee0','text-halo-color':'#253b3e','text-halo-width':1.4}},
  {id:'places',type:'symbol',source:'city','source-layer':'place',layout:{'text-field':['coalesce',['get','name:en'],['get','name']],'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],10,12,15,17],'text-letter-spacing':.08},paint:{'text-color':'#f2f2e8','text-halo-color':'#203b40','text-halo-width':1.5}}
],light:{anchor:'viewport',color:'#fff0d6',intensity:.65,position:[1.5,210,35]}};
let map;
try {
  if(!ml?.Map)throw new Error('Map renderer unavailable');
  map=new ml.Map({container:'map',style,...cameras.city,maxPitch:72,minZoom:10,maxZoom:21.5,antialias:true,attributionControl:{compact:true},maxBounds:[[72.87,19.11],[73.12,19.35]],pixelRatio:Math.min(devicePixelRatio,2)});
  map.addControl(new ml.NavigationControl({showCompass:true}),'top-right');
  map.addControl(new ml.ScaleControl({maxWidth:120}),'bottom-left');
  map.on('error',e=>{status.textContent='Some map detail could not load. Check your connection; apartment values remain available.';console.warn('Map data:',e.error?.message);});
  map.once('style.load',()=>{
    layer=createDevelopmentLayer(map,spec,LOCATION,()=>{ready=true;status.textContent='';}); map.addLayer(layer);
    const pin=document.createElement('button');pin.className='pin';pin.innerHTML='Vrindavan<small>Explore the neighbourhood</small>';pin.setAttribute('aria-label','Zoom into Vrindavan neighbourhood');pin.onclick=()=>go('neighbourhood');
    marker=new ml.Marker({element:pin,anchor:'bottom'}).setLngLat(LOCATION).addTo(map);
    showUnits(7,50,1);
    if(stage!=='city')go(stage);
  });
  map.on('click',e=>{if(!ready||stage!=='development')return;const id=layer.pick(e.point);if(id)choose(id);});
  map.on('mousemove',e=>{
    if(!ready||stage!=='development'){$('#flatTip').hidden=true;return;}
    const id=layer.pick(e.point);map.getCanvas().style.cursor=id?'pointer':'';
    const tip=$('#flatTip');if(!id){tip.hidden=true;return;}
    const z=byId.get(id),v=priced.byZone.get(id).latest;
    tip.innerHTML=`<b>Flat ${z.name}</b><span>&#8377; ${compact(v.value)} &middot; ${format(v.rate)}/m&sup2;</span><small>Level ${z.floor} &middot; ${z.bedrooms} bed &middot; dummy value</small>`;
    tip.style.transform=`translate(${e.point.x+16}px,${e.point.y+12}px)`;tip.hidden=false;
  });
  map.on('mouseout',()=>{$('#flatTip').hidden=true;});
  // Read the real water and roads around the site once their tiles are in, and again as more load.
  let contextTimer;
  map.on('idle',()=>{clearTimeout(contextTimer);contextTimer=setTimeout(refreshContext,120);});
  // Suppress only mapped footprints intersecting the illustrative project's parcel.
  // Polygon features are not supported by the style 'within' expression.
  let excludedKey='';
  const updateFootprints=()=>{
    if(!map.getLayer('buildings-3d')||map.getZoom()<14)return;
    const ids=new Set();
    for(const feature of map.querySourceFeatures('city',{sourceLayer:'building'})) {
      if(feature.id===undefined)continue;
      const rings=feature.geometry.type==='Polygon'?feature.geometry.coordinates:feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates.flat():[];
      const points=rings.flat(); if(!points.length)continue;
      let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
      for(const p of points){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);}
      if(x0<coord[0]+dx&&x1>coord[0]-dx&&y0<coord[1]+dy&&y1>coord[1]-dy)ids.add(feature.id);
    }
    const list=[...ids].sort((a,b)=>a-b),key=JSON.stringify(list);
    if(key!==excludedKey){excludedKey=key;map.setFilter('buildings-3d',list.length?['!',['in',['id'],['literal',list]]]:null);}
  };
  let footprintTimer;
  const scheduleFootprints=()=>{clearTimeout(footprintTimer);footprintTimer=setTimeout(updateFootprints,150);};
  map.on('sourcedata',e=>{if(e.sourceId==='city')scheduleFootprints();});
  map.on('moveend',scheduleFootprints);
  map.on('dragstart',()=>setOrbit(false));
} catch(error) { console.warn('Map startup:', error.message); status.textContent='3D maps need WebGL on this device. You can still browse every apartment and its dummy valuation.'; $('#nextStep').textContent='Browse apartment values'; }

function go(next) {
  stage=next;transition++;setOrbit(false);document.body.className=next;
  document.querySelectorAll('[data-stage]').forEach(b=>{if(b.dataset.stage===next)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
  $('#valuation').hidden=next!=='development';$('#destination').hidden=next==='development';
  const copy={city:['MAHARASHTRA, INDIA','A city.<br>A thousand<br>perspectives.','From the skyline of Thane to the streets of Vrindavan. Find your place in the bigger picture.'],neighbourhood:['THANE WEST','Closer to<br>Vrindavan.','The neighbourhood, its streets, and the city around it. An illustrative residential landmark awaits.'],development:['ILLUSTRATIVE DEVELOPMENT','A place in<br>the skyline.','Three 100-storey towers. 1,296 individual apartments. Select a flat to discover its dummy value.']}[next];
  $('#chapterLabel').textContent=copy[0];$('#chapterTitle').innerHTML=copy[1];$('#chapterText').textContent=copy[2];
  $('#nextStep').textContent=next==='city'?'Explore Vrindavan':'Explore residences';
  $('#destination h2').textContent=next==='city'?'Vrindavan':'Vrindavan Residences';
  $('#destination p').textContent=next==='city'?'A neighbourhood within the city.':'An illustrative development in context.';
  if(marker)marker.getElement().hidden=next==='development';
  if(map){map.stop();map.flyTo({...cameras[next],duration:reduced?0:next==='city'?3000:4200,essential:false,padding:padding(next)});}
  if(next==='development'){if(!selected)showUnits(7,50,1);layer?.select(selected);}
  updateColours(); if(next!=='development')$('#flatTip').hidden=true;
}
/* ---------- real surroundings → location factors → each flat's value ---------- */
let lastSignature='';
function refreshContext(){
  if(!map||!ready||!layer||map.getZoom()<14.5||stage==='city')return;
  geo??=createGeo(LOCATION);
  const ctx=collectContext(map,geo,1400);
  if(!ctx.roads.length||ctx.signature===lastSignature)return;
  lastSignature=ctx.signature; realCtx=ctx;
  const stats=layer.setRealContext(ctx,geo);
  priced=applyFactors(values,locationFactors(spec.zones,layer.getWorld().layout,ctx));
  updateColours(); if(selected)renderValue(byId.get(selected)); refreshUnitPrices();
  window.thaneAtlas.real={...stats,signature:ctx.signature};
}
const LOW=[219,232,255],HIGH=[11,63,168];
function rampColour(id){
  const e=priced.byZone.get(id),k=priced.max>priced.min?(e.latest.rate-priced.min)/(priced.max-priced.min):.5;
  const c=LOW.map((l,i)=>Math.round(l+(HIGH[i]-l)*k));
  return new Color(`rgb(${c[0]},${c[1]},${c[2]})`);
}
function updateColours(){layer?.setValueColours(valueColours&&stage==='development',rampColour);$('#valueKey').hidden=!(valueColours&&stage==='development');
  $('#valueKeyLow').textContent=`${format(priced.min)}/m²`;$('#valueKeyHigh').textContent=`${format(priced.max)}/m²`;}
function refreshUnitPrices(){document.querySelectorAll('#unitList [data-unit]').forEach(b=>{const v=priced.byZone.get(b.dataset.unit).latest;const p=b.querySelector('.unit-price');if(p)p.textContent=`₹ ${compact(v.value)}`;});}
function padding(next){return innerWidth<650?{top:50,bottom:next==='development'?220:90,left:0,right:0}:{top:60,bottom:100,left:next==='development'?100:180,right:next==='development'?350:250};}
$('#nextStep').onclick=()=>go(!map?'development':stage==='city'?'neighbourhood':'development');
document.querySelectorAll('[data-stage]').forEach(b=>b.onclick=()=>go(b.dataset.stage));
for(let b=1;b<=9;b++){const option=document.createElement('option');option.value=b;option.textContent=`${b>6?'Tower':'Building'} ${String.fromCharCode(64+b)}${b>6?' - 100 floors':''}`;$('#buildingSelect').append(option);}
function showUnits(building,floor,unit=1){
  const max=building>6?100:4;floor=Math.max(1,Math.min(max,Math.round(Number(floor)||1)));
  $('#buildingSelect').value=building;$('#floorNumber').max=$('#floorRange').max=max;$('#floorNumber').value=$('#floorRange').value=floor;$('#maxFloorLabel').textContent=`Level ${max}`;
  const units=spec.zones.filter(z=>z.building===Number(building)&&z.floor===floor);
  $('#unitList').innerHTML=units.map(z=>`<button class="unit" data-unit="${z.id}" aria-pressed="false">Flat ${z.name.split(' ')[2]}<small>${z.bedrooms} bed / ${z.area} m&sup2;</small><span class="unit-price">&#8377; ${compact(priced.byZone.get(z.id).latest.value)}</span></button>`).join('');
  const z=units.find(z=>z.unit===unit)||units[0];if(z)renderValue(z);
}
function choose(id){const z=byId.get(id);if(!z)return;showUnits(z.building,z.floor,z.unit);}
function renderValue(z){
  selected=z.id;layer?.select(selected);document.querySelectorAll('[data-unit]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.unit===selected)));
  const e=priced.byZone.get(z.id),v=e.latest,history=e.valuations;
  const low=Math.min(...history.map(v=>v.value))*.94,high=Math.max(...history.map(v=>v.value))*1.06;
  const points=history.map((v,i)=>`${history.length===1?140:8+i*264/(history.length-1)},${57-(v.value-low)/(high-low)*48}`).join(' ');
  $('#unitDetail').innerHTML=`<div class="value-label">FLAT ${z.name} / DUMMY VALUATION</div><div class="price">&#8377; ${compact(v.value)}</div><div class="unit-facts"><span>${format(v.rate)} / m&sup2;</span><span>Level ${z.floor}</span><span>${z.area} m&sup2;</span></div><div class="history"><header><span>Illustrative valuation history</span><span>${v.quarter}</span></header><svg viewBox="0 0 280 65" role="img" aria-label="Dummy valuation history"><path d="M0 60H280" stroke="#42615b"/><polyline points="${points}" fill="none" stroke="#d3eab9" stroke-width="2"/>${points.split(' ').map(p=>{const [x,y]=p.split(',');return `<circle cx="${x}" cy="${y}" r="3" fill="#d3eab9"/>`;}).join('')}</svg></div>`;
  const pct=p=>`${p>0?'+':'−'}${Math.abs(p*100).toFixed(1)}%`;
  $('#unitDetail').insertAdjacentHTML('beforeend',realCtx?`<div class="factors"><header><span>Location factors</span><span>from real map data</span></header>${e.effects.length?`<ul>${e.effects.map(x=>`<li><span>${x.label}</span><b class="${x.pct>0?'up':'down'}">${pct(x.pct)}</b></li>`).join('')}<li class="net"><span>Net · before factors &#8377; ${compact(e.baseLatest.value)}</span><b class="${e.factor>=1?'up':'down'}">${pct(e.factor-1)}</b></li></ul>`:'<p>No nearby water or arterial roads affect this flat.</p>'}</div>`:'<div class="factors"><p>Location factors appear once the surrounding map data has loaded.</p></div>');
}
$('#unitList').onclick=e=>{const b=e.target.closest('[data-unit]');if(b)choose(b.dataset.unit);};
$('#buildingSelect').onchange=()=>showUnits(Number($('#buildingSelect').value),Number($('#floorNumber').value));
$('#floorNumber').onchange=()=>showUnits(Number($('#buildingSelect').value),Number($('#floorNumber').value));
$('#floorRange').oninput=()=>showUnits(Number($('#buildingSelect').value),Number($('#floorRange').value));
$('#focusFlat').onclick=()=>{
  if(!map||!ready)return;setOrbit(false);const token=++transition;
  map.stop();
  map.once('moveend',()=>{if(token!==transition)return;map.once('render',()=>{if(token!==transition)return;const p=layer.projectUnit(selected);if(p)map.panBy([p.x-(innerWidth<650?innerWidth*.5:(innerWidth-350)/2),p.y-innerHeight*(innerWidth<650?.28:.46)],{duration:reduced?0:900});});map.triggerRepaint();});
  map.flyTo({...cameras.development,zoom:17.5,duration:reduced?0:1400,padding:padding('development')});
};
$('#satellite').onclick=()=>{satellite=!satellite;$('#satellite').setAttribute('aria-pressed',satellite);if(map?.getLayer('satellite'))map.setLayoutProperty('satellite','visibility',satellite?'visible':'none');};
$('#buildings').onclick=()=>{buildings=!buildings;$('#buildings').setAttribute('aria-pressed',buildings);if(map?.getLayer('buildings-3d'))map.setLayoutProperty('buildings-3d','visibility',buildings?'visible':'none');};
$('#activity').onclick=()=>{activity=!activity;$('#activity').setAttribute('aria-pressed',activity);layer?.setActivity(activity);};
function setOrbit(on){orbit=on;$('#orbit').setAttribute('aria-pressed',on);}
$('#orbit').onclick=()=>setOrbit(!orbit);
$('#streetView').onclick=()=>{
  if(!map)return;
  go('development');
  map.stop();
  // Stand on a real road near the site (from the OpenStreetMap data), looking at the towers.
  let at=[LOCATION[0]+.00022,LOCATION[1]-.00025],bearing=-25;
  if(realCtx&&geo){
    let best=null;
    for(const r of realCtx.roads){if(!['primary','secondary','tertiary','trunk','minor'].includes(r.cls))continue;for(const p of r.pts){const d=Math.hypot(p.x,p.z);if(d>90&&d<260&&(!best||d<best.d))best={p,d};}}
    if(best){const s=geo.scale,o=geo.origin,m=new window.maplibregl.MercatorCoordinate(o.x+best.p.x*s,o.y+best.p.z*s,0).toLngLat();at=[m.lng,m.lat];bearing=Math.atan2(-best.p.x,best.p.z)*180/Math.PI;}
  }
  map.flyTo({center:at,zoom:20.6,pitch:78,bearing,padding:{top:80,bottom:100,left:60,right:innerWidth<650?0:340},duration:reduced?0:2400});
};
// Real street-level photos: Google Street View at the current map centre, in a new tab (no key needed).
const updateRealView=()=>{if(!map)return;const c=map.getCenter();$('#realStreetView').href=`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c.lat.toFixed(6)},${c.lng.toFixed(6)}&heading=${Math.round((map.getBearing()+360)%360)}`;};
map?.on('moveend',updateRealView);
$('#values').onclick=()=>{valueColours=!valueColours;$('#values').setAttribute('aria-pressed',valueColours);updateColours();};
let previous=0;function frame(t){if(orbit&&map&&!document.hidden){const dt=Math.min(.05,(t-previous)/1000);map.setBearing(map.getBearing()+dt*3);}previous=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);
window.addEventListener('resize',()=>{map?.resize();});
showUnits(7,50,1);
// Read-only state is also useful when diagnosing missing map data on a user's device.
window.thaneAtlas={get state(){return {stage,ready,selected,units:spec.zones.length,crowd:180,location:LOCATION,zoom:map?.getZoom()};},map,get layer(){return layer;}};
