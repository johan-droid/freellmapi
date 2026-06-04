import re

with open("client/src/pages/KeysPage.tsx", "r") as f:
    content = f.read()

# Add w-full sm:w-auto to submit buttons that are missing it
content = re.sub(
    r'<Button type="submit" size="sm" disabled=\{!platform',
    r'<Button type="submit" size="sm" className="w-full sm:w-auto" disabled={!platform',
    content
)

with open("client/src/pages/KeysPage.tsx", "w") as f:
    f.write(content)
