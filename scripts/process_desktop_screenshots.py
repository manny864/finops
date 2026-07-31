import os
import shutil
import glob
import subprocess

desktop_dir = '/Users/manuelchavez/Desktop'
target_dir = '/Users/manuelchavez/Documents/FinOpsProyect/public/video-assets/desktop_shots'

os.makedirs(target_dir, exist_ok=True)

screenshots = sorted(glob.glob(os.path.join(desktop_dir, 'Captura de pantalla 2026-07-31*.png')))

print(f"Encontradas {len(screenshots)} capturas de pantalla en Desktop:")

for idx, s_path in enumerate(screenshots, start=1):
    filename = f"shot_{idx:02d}.png"
    dest_path = os.path.join(target_dir, filename)
    shutil.copy2(s_path, dest_path)
    print(f"[{idx:02d}] {os.path.basename(s_path)} -> {filename}")

print("\nTodas las capturas reales fueron copiadas a public/video-assets/desktop_shots/")
