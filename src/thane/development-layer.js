import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildDevelopment } from '../scene/development.js';
import { disposeTree, prepareShadows, box, std } from '../scene/helpers.js';
import { buildDetailedRoads } from './roads.js';
import { createStreetLife } from './street-life.js';
import { buildWater } from './water.js';
import { buildRealRoads } from './real-roads.js';
import { createTraffic } from './vehicles.js';

export function createDevelopmentLayer(map, spec, location, onReady) {
  let renderer, world, scene, environment, life, transform, last = 0, elapsed = 0;
  const camera = new THREE.Camera(), ray = new THREE.Raycaster();
  const selection = new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:'#e2f2b3',transparent:true,opacity:.26,depthWrite:false}));
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),new THREE.LineBasicMaterial({color:'#efffc9',depthTest:false}));
  selection.visible=outline.visible=false;
  let showLife=true, selected=null, motion=!matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Real surroundings from OpenStreetMap: water, road surfaces and traffic (installed by setRealContext)
  let real=null, geo=null; const realGroup=new THREE.Group(); realGroup.name='Real surroundings';
  const layer = {
    id:'vrindavan-development', type:'custom', renderingMode:'3d',
    onAdd(map,gl) {
      scene=new THREE.Scene();
      world=buildDevelopment(spec);
      // The real basemap supplies Thane's surroundings. No fictional river or motorway.
      const syntheticContext=world.group.children[0]; world.group.remove(syntheticContext); disposeTree(syntheticContext);
      for(const id of ['river','motorway','flood','solar','roads']) world.siteLayers.setActive(id,false);
      world.siteLayers.group.getObjectByName('layer:roads')?.traverse(o=>{ if(o.isInstancedMesh)o.visible=false; });
      world.group.traverse(o=>{ if(o.name==='Footpath pedestrian') o.visible=false; });
      scene.add(world.group,selection,outline,realGroup);
      const streets=buildDetailedRoads(world.layout);scene.add(streets.group);
      life=createStreetLife(world.layout,streets.route); scene.add(life.group);
      const plinth=new THREE.Mesh(box(world.layout.siteX+9,.4,world.layout.siteZ+12,0,.03,0),std('#858a78',{roughness:1})); scene.add(plinth);
      renderer=new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl,antialias:true}); renderer.autoClear=false;
      renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.03;
      renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
      const pmrem=new THREE.PMREMGenerator(renderer), room=new RoomEnvironment();
      environment=pmrem.fromScene(room,.04); scene.environment=environment.texture; room.dispose(); pmrem.dispose();
      scene.add(new THREE.HemisphereLight('#e0edff','#827158',1.3));
      const sun=new THREE.DirectionalLight('#fff0d5',3.5); sun.position.set(-260,480,210); sun.target.position.set(0,100,0); sun.castShadow=true;
      sun.shadow.mapSize.set(2048,2048); Object.assign(sun.shadow.camera,{left:-240,right:240,top:240,bottom:-240,near:1,far:1100}); sun.shadow.normalBias=.12; sun.shadow.bias=-.00015;
      scene.add(sun,sun.target); prepareShadows(world.group);
      const pos=window.maplibregl.MercatorCoordinate.fromLngLat(location,0), s=pos.meterInMercatorCoordinateUnits();
      transform=new THREE.Matrix4().makeTranslation(pos.x,pos.y,pos.z).scale(new THREE.Vector3(s,-s,s)).multiply(new THREE.Matrix4().makeRotationX(Math.PI/2));
      world.applyGlass(0); world.valuationLayer.setVisible(false); life.update(0); scene.updateMatrixWorld(true); onReady(world);
    },
    render(gl,matrix) {
      const now=performance.now()/1000, dt=Math.min(.05,last?now-last:0); last=now;
      if(map.getZoom()<14.2) return;
      if(motion&&!document.hidden) elapsed+=dt;
      camera.projectionMatrix.fromArray(matrix).multiply(transform); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      world.update(motion?dt:0,elapsed); life.group.visible=showLife; if(showLife)life.update(elapsed);
      if(real){
        const zoom=map.getZoom();
        real.roads.group.visible=zoom>=16.4;                      // further out, the real roads in the imagery look right on their own
        real.traffic.group.visible=showLife&&zoom>=15.2;
        if(real.traffic.group.visible&&motion)real.traffic.update(dt);
        const cam=map.getFreeCameraOptions().position; real.water.update(elapsed,cam&&geo?geo.mercatorToLocal(cam):null);
      }
      renderer.resetState(); renderer.setViewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight); renderer.render(scene,camera); renderer.resetState();
      if(motion&&!document.hidden) map.triggerRepaint();
    },
    pick(point) {
      if(!world||map.getZoom()<16)return null;
      const canvas=map.getCanvas(), x=point.x/canvas.clientWidth*2-1,y=1-point.y/canvas.clientHeight*2;
      const a=new THREE.Vector3(x,y,-1).applyMatrix4(camera.projectionMatrixInverse), b=new THREE.Vector3(x,y,1).applyMatrix4(camera.projectionMatrixInverse);
      ray.set(a,b.sub(a).normalize());
      const hits=ray.intersectObjects([...world.zones.values()].flatMap(z=>z.hits),false);
      return hits[0]?.object.userData.zone || null;
    },
    select(id) {
      selected=id; const zone=world?.zones.get(id); if(!zone)return;
      const hit=zone.hits[0]; hit.geometry.computeBoundingBox(); const bounds=hit.geometry.boundingBox.clone().applyMatrix4(hit.matrixWorld);
      bounds.getCenter(selection.position); bounds.getSize(selection.scale); selection.scale.multiplyScalar(1.012);
      outline.position.copy(selection.position); outline.scale.copy(selection.scale); selection.visible=outline.visible=true; map.triggerRepaint();
    },
    setActivity(on){showLife=on;map.triggerRepaint();},
    /** Installs water, road surfaces and traffic built from the real map data around the site. */
    setRealContext(ctx,geoRef){
      geo=geoRef;
      if(real){realGroup.remove(real.water.group,real.roads.group,real.traffic.group);real.water.dispose();real.roads.dispose();real.traffic.dispose();}
      const L=world.layout, keepOut={x:L.siteX/2+6,z:L.siteZ/2+8};
      real={water:buildWater(ctx.water),roads:buildRealRoads(ctx.roads,keepOut),traffic:createTraffic(ctx.roads)};
      realGroup.add(real.water.group,real.roads.group,real.traffic.group);
      map.triggerRepaint();
      return {water:ctx.water.length,roads:ctx.roads.length,vehicles:real.traffic.count};
    },
    /** Colours every flat by its value (colourOf(id) → THREE.Color), or switches the colouring off. */
    setValueColours(on,colourOf){
      if(!world)return;
      world.valuationLayer.setVisible(on); world.applyGlass(on?0.85:0);
      if(on&&colourOf)for(const id of world.zones.keys())world.valuationLayer.setColor(id,colourOf(id));
      map.triggerRepaint();
    },
    getRealStats(){return real?{vehicles:real.traffic.count,water:real.water.group.children.length,roadsVisible:real.roads.group.visible}:null;},
    projectUnit(id){const zone=world?.zones.get(id); if(!zone)return null;const p=zone.anchor.clone().applyMatrix4(camera.projectionMatrix);return {x:(p.x+1)/2*map.getCanvas().clientWidth,y:(1-p.y)/2*map.getCanvas().clientHeight};},
    getWorld(){return world;},
    onRemove(){ if(scene)disposeTree(scene); environment?.dispose(); renderer?.dispose(); }
  };
  return layer;
}
