"""
Claves i18n que ninguna ruta de codigo puede leer.

    python3 scripts/detectar-claves-huerfanas.py        # resumen por namespace
    python3 scripts/detectar-claves-huerfanas.py -v     # con el listado

NO es un test a proposito. Un gate que falle ante cualquier clave sin usar
molesta en el flujo normal: se agrega la clave al catalogo y se cablea el
componente despues, y en ese hueco el gate esta rojo sin que haya nada roto.
Esto se corre a mano cada tanto, o antes de una limpieza.

Criterio: el literal no aparece en NINGUN fuente. next-intl resuelve por
string; si el string no existe en el codigo no hay forma de pedirla.

Cubre las escapatorias:
  - namespaces ANIDADOS: `provider.options.system` se lee con
    t('provider.options.system') desde el namespace padre, asi que se aplana la
    ruta completa y se busca tanto la hoja como el path.
  - prefijos dinamicos: t(`rc_rec_${k}`) alcanza rc_rec_*.
  - coincidencia con un campo de datos: cuenta como USADA. Falso negativo a
    proposito: dejar una clave muerta cuesta menos que borrar una viva.
"""
import json, re, subprocess, sys
from pathlib import Path

CAT = json.loads(Path("messages/es.json").read_text(encoding="utf-8"))
archivos = [r for r in subprocess.run(["git","ls-files","src","scripts","__tests__","docs"],
            capture_output=True, text=True).stdout.split()
            if r.endswith((".ts",".tsx",".mjs",".js",".md"))]
BLOB = "\n".join(Path(r).read_text(encoding="utf-8", errors="ignore") for r in archivos)
prefijos = {p for p in re.findall(r'''\bt\w*(?:\.rich|\.raw)?\(\s*`([A-Za-z0-9_.]*?)\$\{''', BLOB) if p}

def hojas(d, ruta=""):
    """(path_relativo_al_namespace, nombre_hoja) de cada string del arbol."""
    for k, v in d.items():
        sub = f"{ruta}.{k}" if ruta else k
        if isinstance(v, dict): yield from hojas(v, sub)
        elif isinstance(v, str): yield sub, k

def legible(path, hoja):
    if path in BLOB or hoja in BLOB: return True
    if any(path.startswith(p) or hoja.startswith(p) for p in prefijos): return True
    return False

filas = []
for ns, arbol in CAT.items():
    if not isinstance(arbol, dict): continue
    todas = list(hojas(arbol))
    muertas = [p for p, h in todas if not legible(p, h)]
    if muertas: filas.append((len(muertas), len(todas), ns, muertas))

filas.sort(reverse=True)
print(f"{sum(f[0] for f in filas)} claves ilegibles en {len(filas)} namespaces")
print(f"(catalogo total: {sum(f[1] for f in filas)} claves en esos namespaces)\n")
for n, tot, ns, ms in filas[:20]: print(f"{n:4}/{tot:<4} {ns}")
Path("/private/tmp/claude-501/-Users-manuelchavez-Documents-FinOpsProyect/7b058810-428f-4910-81d2-5e8d0b5b320d/scratchpad/huerfanas.json").write_text(
    json.dumps({ns: ms for _, _, ns, ms in filas}, ensure_ascii=False, indent=1), encoding="utf-8")
