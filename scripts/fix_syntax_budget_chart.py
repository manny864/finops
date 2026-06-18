import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
path = os.path.join(base_dir, "src/components/dashboard/BudgetBurnChart.tsx")

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Fix the opening tag
bad_open = "{!isMounted ? null : <ResponsiveContainer width=\"100%\" height=\"100%\">}"
good_open = "{!isMounted ? null : (\n                            <ResponsiveContainer width=\"100%\" height=\"100%\">"
content = content.replace(bad_open, good_open)

# Fix the closing tag
bad_close = "</ResponsiveContainer>}"
good_close = "</ResponsiveContainer>\n                        )}"
content = content.replace(bad_close, good_close)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Syntax error fixed.")
