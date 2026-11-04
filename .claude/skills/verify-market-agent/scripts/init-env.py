"""Prints a .env.dev for a worktree: the example file with every port shifted by an
offset, so stacks can run side by side, plus the main checkout's keys and settings.
Usage: init-env.py EXAMPLE MAIN_ENV OFFSET"""
import os
import re
import sys

example_path, main_path, offset = sys.argv[1], sys.argv[2], int(sys.argv[3])
ASSIGNMENT = re.compile(r"^([A-Z0-9_]+)=(.*)$")
LOCAL_URL_PORT = re.compile(r"((?:127\.0\.0\.1|localhost):)(\d+)")


def shift_url_ports(value):
    return LOCAL_URL_PORT.sub(lambda m: m.group(1) + str(int(m.group(2)) + offset), value)


lines = []
seen = set()
for line in open(example_path).read().splitlines():
    match = ASSIGNMENT.match(line)
    if not match:
        lines.append(line)
        continue
    key, value = match.groups()
    seen.add(key)
    if key.endswith("_PORT") and value.isdigit():
        value = str(int(value) + offset)
    lines.append(f"{key}={shift_url_ports(value)}")

# A port or local URL from the main checkout would point this stack at that stack.
overrides = {}
if os.path.exists(main_path):
    for line in open(main_path).read().splitlines():
        match = ASSIGNMENT.match(line)
        if match and not match.group(1).endswith("_PORT") and not LOCAL_URL_PORT.search(match.group(2)):
            overrides[match.group(1)] = match.group(2)

for index, line in enumerate(lines):
    match = ASSIGNMENT.match(line)
    if match and match.group(1) in overrides:
        lines[index] = f"{match.group(1)}={overrides.pop(match.group(1))}"
lines.extend(f"{key}={value}" for key, value in overrides.items())
print("\n".join(lines))
