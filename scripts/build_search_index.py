# -*- coding: utf-8 -*-
"""
手元のデータから「地名の索引」を作り、data/search_index.js に書き出す。

■ なぜ必要か
これまでの住所検索は国土地理院の検索API(msearch.gsi.go.jp)を呼んでいた。
庁内からは外に出られないので使えない。
代わりに、手元の都市計画データに入っている名前を集めて索引にし、
打ち込むと候補が出て、選ぶとその場所へ飛ぶようにする。

■ 索引に入れるもの
  地区計画       chiku_keikaku.geojson の DistName
  都市計画区域    toshikeikaku_kuiki_area.geojson の TokeiName
  市町村         各データの Cityname
  用途地域       youto_chiiki.geojson ほかの YoutoName（市町村名と組にする）

■ 飛び先の決め方
区域を囲む四角(バウンディングボックス)の真ん中へ、
その四角が画面に収まるズームで飛ぶ。

使い方（どちらのPythonでも動く。外部ライブラリを使わない）:
  python scripts/build_search_index.py
"""

import io
import json
import math
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "kumamoto"
OUT = ROOT / "data" / "search_index.js"

# 飛んだときに区域が収まってほしい画面の大きさ(px)の目安
VIEW_PX = 700
ZOOM_MIN, ZOOM_MAX = 8, 17

# 市町村の四角を作るのに使うファイル（市町村名が入っているもの）
CITY_SOURCES = [
    "toshikeikaku_kuiki_area.geojson",
    "youto_chiiki.geojson",
    "chiku_keikaku.geojson",
    "kuiki_kubun.geojson",
]


def load(name):
    with io.open(DATA / name, encoding="utf-8") as f:
        return json.load(f)["features"]


def coords(geom):
    """GeoJSONの図形から、緯度経度の組を順に取り出す"""
    t = geom["type"]
    if t == "Point":
        yield geom["coordinates"]
    elif t in ("MultiPoint", "LineString"):
        for c in geom["coordinates"]:
            yield c
    elif t in ("MultiLineString", "Polygon"):
        for part in geom["coordinates"]:
            for c in part:
                yield c
    elif t == "MultiPolygon":
        for poly in geom["coordinates"]:
            for ring in poly:
                for c in ring:
                    yield c
    elif t == "GeometryCollection":
        for g in geom["geometries"]:
            for c in coords(g):
                yield c


def bbox(geom, box=None):
    """四角 [西, 南, 東, 北] を求める（box を渡すと足し合わせる）"""
    for lng, lat in coords(geom):
        if box is None:
            box = [lng, lat, lng, lat]
        else:
            box[0] = min(box[0], lng)
            box[1] = min(box[1], lat)
            box[2] = max(box[2], lng)
            box[3] = max(box[3], lat)
    return box


def zoom_for(box):
    """四角が VIEW_PX に収まるズームを求める"""
    lat_c = (box[1] + box[3]) / 2
    d_lng = max(box[2] - box[0], 1e-6)
    # 緯度方向は、メルカトルでの見かけの大きさに直してから比べる
    d_lat = max((box[3] - box[1]) / max(math.cos(math.radians(lat_c)), 0.1), 1e-6)
    d = max(d_lng, d_lat)
    z = math.floor(math.log2(360.0 * VIEW_PX / (256.0 * d)))
    return int(max(ZOOM_MIN, min(ZOOM_MAX, z)))


def entry(name, kind, city, box, size=None):
    return {
        "n": name,                                    # 名前（検索して当てるところ）
        "k": kind,                                    # 種類
        "c": city or "",                              # 市町村
        "y": round((box[1] + box[3]) / 2, 6),         # 緯度
        "x": round((box[0] + box[2]) / 2, 6),         # 経度
        "z": zoom_for(box),                           # 飛んだときのズーム
        # 同じ名前が並んだときに「いちばん大きいもの」を代表にするための目安
        "a": round(size if size is not None else
                   (box[2] - box[0]) * (box[3] - box[1]), 8),
    }


def main():
    items = []

    # ---- 地区計画（136件）----
    for f in load("chiku_keikaku.geojson"):
        p = f["properties"]
        items.append(entry(p.get("DistName") or "(名称なし)", "地区計画",
                           p.get("Cityname"), bbox(f["geometry"])))

    # ---- 都市計画区域（17件）----
    for f in load("toshikeikaku_kuiki_area.geojson"):
        p = f["properties"]
        items.append(entry(p.get("TokeiName") or "(名称なし)", "都市計画区域",
                           p.get("Cityname"), bbox(f["geometry"])))

    # ---- 用途地域（市町村名と組にする）----
    for name in ("youto_chiiki.geojson", "youto_chiiki_r8_koshi.geojson",
                 "youto_chiiki_r8_kikuyo.geojson"):
        for f in load(name):
            p = f["properties"]
            city = p.get("Cityname") or ""
            items.append(entry(f"{city} {p.get('YoutoName') or ''}".strip(),
                               "用途地域", city, bbox(f["geometry"])))

    # ---- 市町村（各データの Cityname を集めて、その市町村ぜんぶを囲む四角にする）----
    city_box = {}
    for name in CITY_SOURCES:
        try:
            features = load(name)
        except FileNotFoundError:
            continue
        for f in features:
            city = (f["properties"].get("Cityname") or "").strip()
            if not city:
                continue
            city_box[city] = bbox(f["geometry"], city_box.get(city))
    for city, box in sorted(city_box.items()):
        items.append(entry(city, "市町村", city, box))

    # 種類の順に並べておく（同じ名前が候補に並んだとき、上から見て分かりやすいように）
    order = {"地区計画": 0, "都市計画区域": 1, "市町村": 2, "用途地域": 3}
    items.sort(key=lambda e: (order.get(e["k"], 9), e["n"]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("// 地名の索引（build_search_index.py が自動生成。手で直さないこと）\n")
        f.write("// n=名前 / k=種類 / c=市町村 / y=緯度 / x=経度 / z=ズーム / a=広さの目安\n")
        f.write("window.SEARCH_INDEX = ")
        json.dump(items, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    counts = {}
    for e in items:
        counts[e["k"]] = counts.get(e["k"], 0) + 1
    print(f"■ {OUT}  {OUT.stat().st_size/1024:,.0f}KB")
    for k, v in sorted(counts.items(), key=lambda kv: order.get(kv[0], 9)):
        print(f"   {k:<8}{v:>6,}件")
    print(f"   合計    {len(items):>6,}件")


if __name__ == "__main__":
    main()
