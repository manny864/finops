import os

def patch_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    if 'accounts.length === 0' in content:
        # Avoid double-patching
        if 'isMockTenant(' in content and 'accounts.length === 0 && !isMockTenant' in content:
            return

        print(f"Patching {filepath}")
        
        # Add import
        import_stmt = "import { isMockTenant } from '@/lib/mockData';\n"
        if 'isMockTenant' not in content:
            lines = content.split('\n')
            last_import_idx = 0
            for i, line in enumerate(lines):
                if line.startswith('import '):
                    last_import_idx = i
            lines.insert(last_import_idx + 1, import_stmt)
            content = '\n'.join(lines)
            
        # Replace accounts.length === 0 with (accounts.length === 0 && !isMockTenant(selectedTenant?.id || ''))
        content = content.replace("accounts.length === 0", "(accounts.length === 0 && !isMockTenant(selectedTenant?.id || ''))")
        
        with open(filepath, 'w') as f:
            f.write(content)

for root, dirs, files in os.walk('src/app'):
    for file in files:
        if file.endswith('.tsx'):
            patch_file(os.path.join(root, file))
