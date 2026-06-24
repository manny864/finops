import os
import glob

api_dir = '/Users/manuelchavez/Documents/FinOpsProyect/src/app/api'

count = 0
for filepath in glob.glob(os.path.join(api_dir, '**', '*.ts'), recursive=True):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Check if file has the email extraction logic but is missing decoded.upn
    if 'decoded.email' in content and 'decoded.upn' not in content:
        # Standardize the replacement
        content = content.replace('decoded.preferred_username || decoded.unique_name || decoded.email', 'decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email')
        content = content.replace('decoded.unique_name || decoded.preferred_username || decoded.email', 'decoded.unique_name || decoded.preferred_username || decoded.upn || decoded.email')
        content = content.replace('decoded.preferred_username || decoded.email', 'decoded.preferred_username || decoded.upn || decoded.email')
        content = content.replace('decoded.unique_name || decoded.preferred_username || ""', 'decoded.unique_name || decoded.preferred_username || decoded.upn || ""')
        
        with open(filepath, 'w') as f:
            f.write(content)
        count += 1
        print(f"Fixed: {filepath}")

print(f"Total files fixed: {count}")
