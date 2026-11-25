#!/usr/bin/env python3
"""Copy libmpv and every non-system dylib it needs into <app>/Contents/Frameworks and make them relocatable.

usage: bundle-libmpv.py <App.app> [libmpv.2.dylib]
Install names become @loader_path/<name>, so the app runs on a Mac without Homebrew.
"""
import os, re, shutil, subprocess, sys

app = sys.argv[1]
src = os.path.realpath(sys.argv[2] if len(sys.argv) > 2 else "/opt/homebrew/lib/libmpv.2.dylib")
fw = os.path.join(app, "Contents", "Frameworks")
os.makedirs(fw, exist_ok=True)

SYSTEM = ("/usr/lib/", "/System/")


def deps(path):
    out = subprocess.check_output(["otool", "-L", path], text=True).splitlines()[1:]
    return [m.group(1) for l in out if (m := re.match(r"\s+(\S+) \(", l))]


def rpaths(path):
    out = subprocess.check_output(["otool", "-l", path], text=True)
    return re.findall(r"cmd LC_RPATH\n\s+cmdsize \d+\n\s+path (\S+)", out)


def resolve(dep, owner):
    if dep.startswith("@rpath/"):
        for rp in rpaths(owner):
            cand = os.path.join(rp.replace("@loader_path", os.path.dirname(owner)), dep[7:])
            if os.path.exists(cand):
                return os.path.realpath(cand)
        raise SystemExit(f"cannot resolve {dep} for {owner}")
    if dep.startswith("@loader_path/"):
        return os.path.realpath(os.path.join(os.path.dirname(owner), dep[13:]))
    return os.path.realpath(dep)


done = {}  # real source path -> bundled name
queue = [src]
while queue:
    cur = queue.pop()
    if cur in done:
        continue
    name = os.path.basename(cur)
    if name == "libmpv.dylib":
        name = "libmpv.2.dylib"
    done[cur] = name
    dst = os.path.join(fw, name)
    shutil.copyfile(cur, dst)
    os.chmod(dst, 0o755)
    for d in deps(cur):
        if d.startswith(SYSTEM) or d == cur:
            continue
        queue.append(resolve(d, cur))

# Rewrite every reference to point next to the loading library.
for cur, name in done.items():
    dst = os.path.join(fw, name)
    subprocess.check_call(["install_name_tool", "-id", f"@loader_path/{name}", dst], stderr=subprocess.DEVNULL)
    for d in deps(cur):
        if d.startswith(SYSTEM):
            continue
        tgt = done[resolve(d, cur)]
        if d != f"@loader_path/{tgt}":
            subprocess.check_call(["install_name_tool", "-change", d, f"@loader_path/{tgt}", dst], stderr=subprocess.DEVNULL)
    subprocess.check_call(["codesign", "--force", "--sign", "-", dst], stderr=subprocess.DEVNULL)

left = [d for n in done.values() for d in deps(os.path.join(fw, n)) if not d.startswith(SYSTEM) and not d.startswith("@loader_path/")]
if left:
    raise SystemExit(f"unrelocated references remain: {left}")
print(f"bundled {len(done)} libraries into {fw}")
