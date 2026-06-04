import os
import shutil

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def fix():
    # Remove old obsolete route to fix compilation
    old_route_dir = os.path.join(base_dir, "src/app/api/audit/rightsizing")
    if os.path.exists(old_route_dir):
        shutil.rmtree(old_route_dir)
        print("Removed obsolete route src/app/api/audit/rightsizing")

if __name__ == "__main__":
    fix()
