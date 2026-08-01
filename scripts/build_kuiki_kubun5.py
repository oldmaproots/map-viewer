"""
区域区分を「5区分」に作り直すスクリプト。

都市計画図の凡例では、都市計画区域の中を次の5つに塗り分ける。

  線引きしている区域   … 市街化区域 / 市街化調整区域
  線引きしていない区域 … 用途指定区域 / 用途指定区域外
  用途地域が1つも無い都市計画区域 … 全域用途未指定区域

このうち元データにあるのは最初の2つだけなので、残り3つを
「都市計画区域」「用途地域」「区域区分」を重ね合わせて計算で作る。

使い方（QGIS付属のPythonで動かす。図形計算のライブラリが必要なため）:
  "C:\\Program Files\\QGIS 3.44.9\\bin\\python-qgis-ltr.bat" scripts/build_kuiki_kubun5.py

出力:
  data/kumamoto/kuiki_kubun5.geojson
"""

import json
import pathlib
import sys

try:
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union
except ImportError:
    print("[エラー] 図形計算のライブラリ(shapely)が見つかりません。")
    print("QGIS付属のPythonで実行してください:")
    print('  "C:\\Program Files\\QGIS 3.44.9\\bin\\python-qgis-ltr.bat" scripts/build_kuiki_kubun5.py')
    sys.exit(1)

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "kumamoto"

COORD_DIGITS = 6

# 図形を引き算すると、境界のわずかなずれから「細長いくず」がたくさんできる。
# （実際に作ってみると、用途指定区域外の半数以上が面積1平方メートル程度だった）
# 地図に出しても見えないので、この広さ未満の破片は捨てる。
# 100平方メートル未満を捨てても、失う面積は全体の0.0002%しかないことを確かめてある。
MIN_AREA_M2 = 100

# 緯度経度のまま計算しているので、平方メートルを「度の2乗」に直しておく
# （熊本のあたりでは 1度の東西≒93,560m、南北≒110,540m）
_M2_PER_DEG2 = 93560 * 110540
MIN_AREA_DEG2 = MIN_AREA_M2 / _M2_PER_DEG2

# 計算結果に付ける区分名。凡例に出す順番でもある
KUBUN_ORDER = [
    "市街化区域",
    "市街化調整区域",
    "用途指定区域",
    "用途指定区域外",
    "全域用途未指定区域",
]


def load(name):
    path = DATA_DIR / f"{name}.geojson"
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def geoms(features):
    out = []
    for f in features:
        g = f.get("geometry")
        if not g:
            continue
        s = shape(g)
        if not s.is_valid:
            s = s.buffer(0)  # 自己交差などを直す
        if not s.is_empty:
            out.append(s)
    return out


def round_coords(value):
    if isinstance(value, (list, tuple)):
        if value and isinstance(value[0], (int, float)):
            return [round(v, COORD_DIGITS) for v in value]
        return [round_coords(v) for v in value]
    return value


def to_features(geom, kubun):
    """計算結果の図形を、区分名を付けたGeoJSONのfeatureに変換する。
    引き算でできた細かいくず（MIN_AREA_M2未満）はここで捨てる。"""
    if geom.is_empty:
        return []
    parts = list(geom.geoms) if geom.geom_type.startswith("Multi") else [geom]
    out = []
    dropped = 0
    for p in parts:
        if p.is_empty or p.area <= 0:
            continue
        if p.area < MIN_AREA_DEG2:
            dropped += 1
            continue
        m = mapping(p)
        m["coordinates"] = round_coords(m["coordinates"])
        out.append({
            "type": "Feature",
            "geometry": m,
            "properties": {"AreaType": kubun, "Pref": "熊本県"},
        })
    if dropped:
        print(f"    {kubun}: {dropped}個の小さな破片を除きました")
    return out


def main():
    print("元データを読み込んでいます…")
    kubun_feats = load("kuiki_kubun")
    tokei = geoms(load("toshikeikaku_kuiki"))
    youto = geoms(load("youto_chiiki"))
    print(f"  都市計画区域 {len(tokei)} / 用途地域 {len(youto)} / 区域区分 {len(kubun_feats)}")

    print("重ね合わせを計算しています…")
    youto_u = unary_union(youto)
    tokei_u = unary_union(tokei)

    # 市街化区域・市街化調整区域は元データをそのまま使う（計算で形を変えない）
    features = []
    for f in kubun_feats:
        g = f.get("geometry")
        if not g:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": g["type"], "coordinates": round_coords(g["coordinates"])},
            "properties": {
                "AreaType": f["properties"].get("AreaType"),
                "Pref": f["properties"].get("Pref", "熊本県"),
                "Cityname": f["properties"].get("Cityname"),
            },
        })
    senbiki_u = unary_union(geoms(kubun_feats))

    # 用途地域が1つも無い都市計画区域 ＝ 全域用途未指定区域
    zenki = [g for g in tokei if not g.intersects(youto_u)]
    zenki_u = unary_union(zenki) if zenki else None
    print(f"  全域用途未指定区域: {len(zenki)}件")

    # 線引きしていない区域 ＝ 都市計画区域 － 線引き区域 － 全域用途未指定区域
    hisenbiki = tokei_u.difference(senbiki_u)
    if zenki_u is not None:
        hisenbiki = hisenbiki.difference(zenki_u)

    # 線引きしていない区域を、用途地域の有無で2つに分ける
    youto_shitei = hisenbiki.intersection(youto_u)
    youto_gai = hisenbiki.difference(youto_u)

    features += to_features(youto_shitei, "用途指定区域")
    features += to_features(youto_gai, "用途指定区域外")
    if zenki_u is not None:
        features += to_features(zenki_u, "全域用途未指定区域")

    out_path = DATA_DIR / "kuiki_kubun5.geojson"
    out_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": features},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    from collections import Counter
    counts = Counter(f["properties"]["AreaType"] for f in features)
    print()
    for k in KUBUN_ORDER:
        print(f"  {k:<12}{counts.get(k, 0):>5}件")
    print(f"\n合計 {len(features)}件 → {out_path.name}  {out_path.stat().st_size/1024:,.0f}KB")


if __name__ == "__main__":
    main()
