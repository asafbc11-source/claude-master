# -*- coding: utf-8 -*-
"""Build: inline all content files into shell.html -> ../index.html (single self-contained file)."""
import io, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONTENT_DIR = os.path.join(HERE, "content")
ORDER = ["m01.js","m02.js","m03.js","m04.js","m05.js","m06.js","m07.js","m08.js","m09.js","m10.js",
         "m11.js","m12.js","m13.js","m14.js","m15.js","m16.js","m17.js",
         "deepening.js","glossary.js"]
MARKER = "/*==CONTENT==*/"

def read(p):
    with io.open(p, "r", encoding="utf-8") as f:
        return f.read()

shell = read(os.path.join(HERE, "shell.html"))
if MARKER not in shell:
    sys.exit("marker not found in shell.html")

parts = []
for name in ORDER:
    p = os.path.join(CONTENT_DIR, name)
    if not os.path.exists(p):
        sys.exit("missing content file: " + name)
    parts.append("/* ---- %s ---- */\n%s" % (name, read(p)))

out = shell.replace(MARKER, "\n".join(parts))
out_path = os.path.join(ROOT, "index.html")
with io.open(out_path, "w", encoding="utf-8") as f:
    f.write(out)

print("built %s (%.1f KB)" % (out_path, os.path.getsize(out_path)/1024.0))

# Dev-only harness: the same app with the script as an external file.
# The in-app browser pane truncates very large inline scripts, so automated
# verification runs against this copy. Both files are deleted before delivery.
if "--debug" in sys.argv:
    import re
    ENGINE = "/* ================== ENGINE ================== */"
    with io.open(os.path.join(ROOT, "_debug_engine.js"), "w", encoding="utf-8") as f:
        f.write(shell.split(ENGINE, 1)[1].split("</script>", 1)[0])
    tags = "".join('<script src="src/content/%s"></script>' % n for n in ORDER)
    dbg = shell.replace(
        MARKER + "\n" + shell.split(ENGINE, 1)[1].split("</script>", 1)[0],
        "")
    # rebuild: head/body from shell, then separate script tags
    head, rest = shell.split("<script>", 1)
    dbg = (head
           + '<script>window.COURSE_MODULES=[];window.GLOSSARY=[];</script>\n'
           + tags
           + '\n<script src="_debug_engine.js"></script>\n'
           + rest.split("</script>", 1)[1])
    with io.open(os.path.join(ROOT, "_debug.html"), "w", encoding="utf-8") as f:
        f.write(dbg)
    print("debug harness: _debug.html (content + engine as separate files)")
