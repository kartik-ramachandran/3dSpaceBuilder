import os, sys, shutil
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
SMALL = {'lemon', 'wooden_bowl_01', 'ceramic_vase_01', 'ceramic_vase_03', 'throw_pillows_01', 'modern_ceiling_lamp_01', 'Ottoman_01', 'side_table_01', 'round_wooden_table_01'}
total_in = total_out = 0
for root, _, files in os.walk(src):
    rel = os.path.relpath(root, src)
    out_dir = os.path.join(dst, rel)
    os.makedirs(out_dir, exist_ok=True)
    parts = rel.replace('\\', '/').split('/')
    model = parts[1] if len(parts) > 1 and parts[0] == 'models' else None
    for name in files:
        sp, dp = os.path.join(root, name), os.path.join(out_dir, name)
        total_in += os.path.getsize(sp)
        if name.lower().endswith('.jpg'):
            im = Image.open(sp)
            low = name.lower()
            is_nor = 'nor' in low
            is_rough = 'rough' in low or 'arm' in low
            limit = 512 if (model in SMALL or (model and (is_rough or is_nor))) else 1024
            if max(im.size) > limit:
                im = im.resize((limit, round(im.size[1] * limit / im.size[0])) if im.size[0] >= im.size[1] else (round(im.size[0] * limit / im.size[1]), limit), Image.LANCZOS)
            q = 84 if is_nor else (68 if is_rough else 74)
            im.convert('RGB').save(dp, 'JPEG', quality=q, optimize=True, progressive=True)
        else:
            shutil.copyfile(sp, dp)
        total_out += os.path.getsize(dp)
print(f'in {total_in/1e6:.1f} MB -> out {total_out/1e6:.1f} MB')
