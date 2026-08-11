"""レイヤーが読むファイルの一覧（data/kumamoto/layers.json）を作る。

なぜ要るか
----------
用途地域や容積率・建ぺい率の丸印は、出所ごとにファイルを分けたまま
1つのレイヤーとして描いている。どのファイルを読むかをJavaScriptに直書きすると、
市町を1つ足すたびに kumamoto.js と youto-circles.js の両方を直すことになり、
片方を忘れる。実際に忘れかけたことがある。

そこで一覧をデータとして外に出し、**このスクリプトが自動で書く**ようにした。
市町を足すときは data/kumamoto に決まった名前でファイルを置くだけでよい。

ファイル名の決まり
------------------
  youto_chiiki.geojson              国交省データ（本体）
  youto_chiiki_r8_<市町ローマ字>.geojson   県が計画図から起こした追加分
  youto_circles.geojson             丸印（本体）
  youto_circles_r8_<市町ローマ字>.geojson  丸印の追加分

中身が0件のファイルは一覧に載せない（読むだけ無駄なので）。

システムPythonで動く。
"""
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent.parent
D = HERE / "data" / "kumamoto"

# レイヤーのキー → (本体のファイル, 追加分を探すときの頭)
LAYERS = {
    "youto_chiiki": ("youto_chiiki.geojson", "youto_chiiki_r8_"),
    "youto-circles": ("youto_circles.geojson", "youto_circles_r8_"),
}


def count(p):
    try:
        return len(json.loads(p.read_text(encoding="utf-8")).get("features", []))
    except Exception:
        return -1


out = {}
for key, (main, prefix) in LAYERS.items():
    files = []
    if (D / main).exists():
        files.append(main)
    for p in sorted(D.glob(prefix + "*.geojson")):
        n = count(p)
        if n > 0:
            files.append(p.name)
            print(f"  {key}: {p.name} を追加（{n}件）")
        elif n == 0:
            print(f"  {key}: {p.name} は0件なので載せない")
        else:
            print(f"  ★ {key}: {p.name} が読めない")
    out[key] = files

p = D / "layers.json"
p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"\n{p.name} を書き出した")
for k, v in out.items():
    print(f"   {k}: {len(v)}ファイル  {v}")

# file:// では fetch が使えないので、同じ中身を .js にも書いておく
js = D / "layers.js"
js.write_text("window.KUMAMOTO_LAYERS = " + json.dumps(out, ensure_ascii=False) + ";\n",
              encoding="utf-8")
print(f"{js.name} も書き出した（庁内版が読む）")
