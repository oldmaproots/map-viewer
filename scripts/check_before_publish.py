"""公開する前の点検。おかしなところがあれば止める。

ここに並んでいるのは、**これまで実際に起きた失敗**である。
同じことを繰り返さないよう、機械が毎回確かめる。

  ・同じ地区が二重に入る          → 面積が2倍になった（笹原第三・上生道・池尻）
  ・属性の名前が食い違う          → 丸印の中が空になった（ABBR と Ryaku）
  ・材料のファイルが消えている    → 統合が途中で止まり、古いデータのまま公開されかけた
  ・中身が0件のファイルを読む      → 読むだけ無駄
  ・一覧に無いファイルを指している → 読み込みに失敗する

システムPythonで動く。おかしなところがあれば終了コード1で終わる。
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
D = ROOT / "data" / "kumamoto"

問題 = []
注意 = []


def ng(msg):
    問題.append(msg)


def warn(msg):
    注意.append(msg)


def load(p):
    return json.loads(p.read_text(encoding="utf-8"))


# ---------- 1. サイトが読むファイルがそろっているか ----------
manifest_path = D / "layers.json"
if not manifest_path.exists():
    ng("layers.json が無い。scripts/build_layers_manifest.py を流すこと")
    manifest = {}
else:
    manifest = load(manifest_path)
    for key, files in manifest.items():
        for name in files:
            if not (D / name).exists():
                ng(f"layers.json が指している {name} が無い（{key}）")

# index.html が読むファイル（layers.json に載らないもの）
for name in ("search_index.js",):
    if not (ROOT / "data" / name).exists():
        ng(f"data/{name} が無い")

# ---------- 2. 中身が0件・壊れていないか ----------
for p in sorted(D.glob("*.geojson")):
    try:
        g = load(p)
    except Exception as e:
        ng(f"{p.name} が読めない: {e}")
        continue
    n = len(g.get("features", []))
    if n == 0:
        # 一覧に載っていなければ問題ない（載せない判断をしているだけ）
        載っている = any(p.name in v for v in manifest.values())
        (ng if 載っている else warn)(f"{p.name} の中身が0件")

# ---------- 3. 同じ地区が二重に入っていないか ----------
chiku = D / "chiku_keikaku.geojson"
if chiku.exists():
    names = [f["properties"].get("DistName") for f in load(chiku)["features"]]
    dup = {n for n in names if n and names.count(n) > 1}
    if dup:
        ng(f"地区計画に同じ名前が2つ以上ある: {sorted(dup)}")

# ---------- 4. 用途地域の追加分が、本体と同じ属性の形か ----------
main = D / "youto_chiiki.geojson"
if main.exists():
    base = set(load(main)["features"][0]["properties"])
    for name in manifest.get("youto_chiiki", []):
        if name == main.name:
            continue
        keys = set(load(D / name)["features"][0]["properties"])
        欠け = {"YoutoName", "YoutoCode", "FAR", "BCR"} - keys
        if 欠け:
            ng(f"{name} に用途地域の基本の欄が無い: {sorted(欠け)}")

# ---------- 5. 丸印の属性の名前 ----------
# ABBR を Ryaku と書いてしまい、丸の中が空になったことがある
for name in manifest.get("youto-circles", []):
    p = D / name
    if not p.exists():
        continue
    fs = load(p)["features"]
    if not fs:
        continue
    keys = set(fs[0]["properties"])
    欠け = {"FAR", "ABBR", "BCR", "YoutoName", "R"} - keys
    if 欠け:
        ng(f"{name} の丸印に必要な欄が無い: {sorted(欠け)}（丸の中が空になる）")

# ---------- 6. 座標が熊本県の範囲か ----------
def 範囲外(g):
    def walk(c):
        if isinstance(c[0], (int, float)):
            yield c
        else:
            for x in c:
                yield from walk(x)
    for lng, lat in walk(g["coordinates"]):
        if not (129.0 < lng < 132.0 and 31.5 < lat < 33.6):
            return (lng, lat)
    return None


for p in sorted(D.glob("*.geojson")):
    try:
        g = load(p)
    except Exception:
        continue
    for f in g.get("features", [])[:2000]:
        bad = 範囲外(f["geometry"])
        if bad:
            ng(f"{p.name} に熊本県の外の座標がある: {bad}")
            break

# ---------- 7. 庁内版のためのファイル ----------
js = list(D.glob("*.geojson.js"))
if js:
    足りない = [p.name for p in D.glob("*.geojson") if not (D / (p.name + ".js")).exists()]
    if 足りない:
        warn(f"庁内版の .js が作られていないものがある: {足りない}"
             "（scripts/build_offline_data.py を流す）")
else:
    warn("庁内版の .js がまだ作られていない（配布するときは build_offline_data.py を流す）")

tiles = pathlib.Path(r"C:\Users\kyama\Documents\ClaudeCode\10FGDBaseMap\_publish\fgd_tiles")
if not tiles.exists():
    warn("庁内版の背景タイルが見つからない（配布するときは build_fgd_tiles.py を流す）")

# ---------- 8. 個人情報・内部のパスが混ざっていないか ----------
NG語 = ("kyama", "C:\\Users", "AppData", "Shapeデータファイル")
for p in list(ROOT.glob("*.js")) + list(ROOT.glob("*.html")) + [manifest_path]:
    if not p.exists():
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    for w in NG語:
        if w in t:
            ng(f"{p.name} に「{w}」が入っている（公開するファイルなので消すこと）")

# ---------- まとめ ----------
print("=" * 60)
if 注意:
    print(f"■ 注意 {len(注意)}件（公開は止めない）")
    for m in 注意:
        print(f"   ・{m}")
if 問題:
    print(f"\n■ 問題 {len(問題)}件 ― **公開してはいけません**")
    for m in 問題:
        print(f"   ★{m}")
    print("=" * 60)
    sys.exit(1)
print("\n問題なし。公開してよい。")
print("=" * 60)
