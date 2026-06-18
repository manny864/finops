import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
path = os.path.join(base_dir, "src/components/dashboard/BudgetBurnChart.tsx")

with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()

new_lines = []
has_use_client = False

for line in lines:
    if '"use client";' in line or "'use client';" in line:
        has_use_client = True
    else:
        new_lines.append(line)

if has_use_client:
    new_lines.insert(0, '"use client";\n')

with open(path, "w", encoding="utf-8") as f:
    f.writelines(new_lines)

print("Moved 'use client' to the top.")
