param([string]$Root)
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$hdris = 'kloofendal_48d_partly_cloudy_puresky','belfast_sunset_puresky','qwantani_dusk_2_puresky'
$tex = 'oak_wood_planks','dark_wood','fine_grained_wood','white_plaster_02','marble_01','terrazzo_tiles','large_grey_tiles','long_white_tiles','rough_linen','velour_velvet','fabric_pattern_07','brown_leather','leather_white','exterior_wall_cladding','stacked_stone_wall','grey_roof_tiles','wood_floor_deck','concrete_pavers','clean_pebbles','grass_path_2'
$mods = 'sofa_02','sofa_03','mid_century_lounge_chair','modern_arm_chair_01','modern_coffee_table_01','modern_coffee_table_02','coffee_table_round_01','side_table_01','dining_chair_02','round_wooden_table_01','bar_chair_round_01','potted_plant_01','potted_plant_02','potted_plant_04','pachira_aquatica_01','calathea_orbifolia_01','ceramic_vase_01','ceramic_vase_03','modern_ceiling_lamp_01','throw_pillows_01','wooden_bowl_01','lemon','outdoor_table_chair_set_01','shrub_02','shrub_04','Ottoman_01','modern_wooden_cabinet'
function Get($url, $path){ $d = Split-Path $path; if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null }; if (-not (Test-Path $path)) { Invoke-WebRequest $url -OutFile $path } }
$log = @()
foreach ($id in $hdris){ $f = Invoke-RestMethod "https://api.polyhaven.com/files/$id"; Get $f.hdri.'2k'.hdr.url (Join-Path $Root "hdri/$id.hdr"); $log += "hdri $id" }
foreach ($id in $tex){
  $f = Invoke-RestMethod "https://api.polyhaven.com/files/$id"
  foreach ($pair in @(@('Diffuse','diff'), @('nor_gl','nor'), @('Rough','rough'))){
    $m = $f.($pair[0]); if ($m) { Get $m.'1k'.jpg.url (Join-Path $Root "tex/$id/$($pair[1]).jpg") }
  }
  $log += "tex $id"
}
foreach ($id in $mods){
  $f = Invoke-RestMethod "https://api.polyhaven.com/files/$id"; $g = $f.gltf.'1k'.gltf
  Get $g.url (Join-Path $Root "models/$id/$id.gltf")
  foreach ($p in $g.include.PSObject.Properties){ Get $p.Value.url (Join-Path $Root "models/$id/$($p.Name)") }
  $log += "model $id"
}
$log -join ', '
$sum = (Get-ChildItem $Root -Recurse -File | Measure-Object Length -Sum).Sum
"TOTAL MB: " + [math]::Round($sum/1MB,1) + "  FILES: " + (Get-ChildItem $Root -Recurse -File).Count

