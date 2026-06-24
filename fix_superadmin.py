import os
import glob
import re

api_dir = '/Users/manuelchavez/Documents/FinOpsProyect/src/app/api'
components_dir = '/Users/manuelchavez/Documents/FinOpsProyect/src/components'
app_dir = '/Users/manuelchavez/Documents/FinOpsProyect/src/app'

count = 0
for directory in [api_dir, components_dir, app_dir]:
    for filepath in glob.glob(os.path.join(directory, '**', '*.ts*'), recursive=True):
        if not os.path.isfile(filepath):
            continue
            
        with open(filepath, 'r') as f:
            content = f.read()
            
        # Target strings
        target1 = '&& decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517"'
        target2 = '&& decodedToken?.tid === "8b41364f-581a-4e43-b7cb-13138dac5517"'
        target3 = '&& userTenant === "8b41364f-581a-4e43-b7cb-13138dac5517"'
        
        new_content = content
        if target1 in new_content:
            new_content = new_content.replace(target1, '')
        if target2 in new_content:
            new_content = new_content.replace(target2, '')
        if target3 in new_content:
            new_content = new_content.replace(target3, '')
            
        if content != new_content:
            with open(filepath, 'w') as f:
                f.write(new_content)
            count += 1
            print(f"Fixed {filepath}")

print(f"Updated {count} files.")
