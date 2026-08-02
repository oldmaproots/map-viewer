"""
都市計画区域を「区域ごとの大枠」にまとめ直すスクリプト。

■ なぜ必要か
元データ（都市計画決定GISデータ）の都市計画区域は**市町村ごとに分かれている**。
そのため地図に出すと市町村の境目にも線が入ってしまい、
「都市計画区域の外枠」と「中の市町村の区切り」が見分けられない。
また区域名の欄（TokeiName）は119件中59件が空欄で、名前でもまとめられない。

そこで市町村名から17の都市計画区域に振り分け、区域ごとに1つの図形へまとめる。

■ もう1つの問題：一点鎖線が汚くなる
隣り合う都市計画区域（例：熊本と菊池）の境界は、両方の区域が自分の枠として
持っているので線が2本重なる。一点鎖線は線の始まりから点と線を並べていくため、
2本の線で点の位置がずれ、重なると「きれいな一点鎖線」に見えなくなる。

さらに厄介なことに、元データでは隣どうしの境界の座標がそろっていない。
実測すると熊本と菊池は約19kmにわたって隣り合うが、
ぴったり一致するのは0m（1m以内で1.6km、20m以内で14km、重なり面積9.1ha）。
つまり「同じ線が2本」ではなく「数十メートルずれた線が2本」引かれている。

対策は2段構え。
 1. まず区域どうしのすき間と重なりを取り除いて、
    隣どうしの境界がぴったり同じ座標になるようにする（下の build_partition）。
 2. そのうえで境界線を1本ずつに分解し、
    2つの区域が共有している線は**まったく同じ図形**を2件（区域ごとに1件）作る。
    同じ図形なら一点鎖線の点の位置もそろうので、重ねてもきれいな一点鎖線に見える。
    片方の区域を非表示にしても、もう片方の線が残るので境界は消えない。

使い方（QGIS付属のPythonで動かす。図形計算のライブラリが必要なため）:
  "C:\\Program Files\\QGIS 3.44.9\\bin\\python-qgis-ltr.bat" scripts/build_toshikeikaku_frame.py

出力（data/kumamoto/）:
  toshikeikaku_kuiki_area.geojson       17区域の面（クリックしたときの区域名の判定に使う）
  toshikeikaku_kuiki_line.geojson       17区域の枠線（地図に一点鎖線で描くのはこちら）
  jun_toshikeikaku_kuiki_area.geojson   準都市計画区域の面
  jun_toshikeikaku_kuiki_line.geojson   準都市計画区域の枠線
"""

import json
import pathlib
import sys

try:
    from shapely.geometry import MultiPolygon, Polygon, mapping, shape
    from shapely.ops import linemerge, unary_union
except ImportError:
    print("[エラー] 図形計算のライブラリ(shapely)が見つかりません。")
    print("QGIS付属のPythonで実行してください:")
    print('  "C:\\Program Files\\QGIS 3.44.9\\bin\\python-qgis-ltr.bat" '
          "scripts/build_toshikeikaku_frame.py")
    sys.exit(1)

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "kumamoto"

COORD_DIGITS = 6

# 熊本のあたりでの1度あたりの距離（メートル）
M_PER_DEG_LON = 93560
M_PER_DEG_LAT = 110540
# 図形計算は緯度経度のまま行うので、メートルを「度」に直す係数。
# 東西と南北で縮尺が違うが、数十メートル程度の掃除に使うだけなので平均でよい
M_TO_DEG = 2.0 / (M_PER_DEG_LON + M_PER_DEG_LAT)


# ============================================================
# どの市町村がどの都市計画区域に入るか
# ------------------------------------------------------------
# 元データの区域名(TokeiName)は119件中59件が空欄なので使えない。
# 熊本都市計画区域が5市町にまたがることは、区域区分（市街化区域・市街化調整区域）が
# 引かれているのがちょうどこの5市町であることからも確かめてある。
# ============================================================
CITY_TO_AREA = {
    "熊本市": "熊本都市計画区域",
    "合志市": "熊本都市計画区域",
    "菊陽町": "熊本都市計画区域",
    "益城町": "熊本都市計画区域",
    "嘉島町": "熊本都市計画区域",
    "八代市": "八代都市計画区域",
    "人吉市": "人吉都市計画区域",
    "荒尾市": "荒尾都市計画区域",
    "玉名市": "玉名都市計画区域",
    "長洲町": "長洲都市計画区域",
    "水俣市": "水俣都市計画区域",
    "山鹿市": "山鹿都市計画区域",
    "菊池市": "菊池都市計画区域",
    "宇土市": "宇土都市計画区域",
    "宇城市": "宇城都市計画区域",
    "大津町": "大津都市計画区域",
    "阿蘇市": "阿蘇都市計画区域",
    "御船町": "御船都市計画区域",
    "芦北町": "芦北都市計画区域",
}

# 天草市だけは1つの市に2つの都市計画区域がある（旧本渡市と旧牛深市）。
# 区域は南北に大きく離れているので、緯度で振り分ける。
#   本渡側 … 天草下島の中北部（緯度32.44〜32.46）
#   牛深側 … 天草下島の南端  （緯度32.19〜32.21）
AMAKUSA_LAT_SPLIT = 32.30
AMAKUSA_NORTH = "本渡都市計画区域"
AMAKUSA_SOUTH = "牛深都市計画区域"

# 凡例や属性表に並べる順番（県の総括図の並びに合わせて北から南へ）
AREA_ORDER = [
    "荒尾都市計画区域", "玉名都市計画区域", "長洲都市計画区域", "山鹿都市計画区域",
    "菊池都市計画区域", "大津都市計画区域", "阿蘇都市計画区域", "熊本都市計画区域",
    "御船都市計画区域", "宇土都市計画区域", "宇城都市計画区域", "八代都市計画区域",
    "芦北都市計画区域", "水俣都市計画区域", "人吉都市計画区域",
    "本渡都市計画区域", "牛深都市計画区域",
]

# すき間・重なりをどこまで「同じ境界」とみなすか（メートル）。
# 実測した隣どうしのずれ（数メートル〜数十メートル）を吸収できる大きさにしてある。
# 大きくしすぎると本当の区域の形が変わってしまうので、変更したら
# 下の「境界がどれだけ動いたか」の表示を必ず確かめること。
SNAP_M = 25

# 境界線を分けるときの判定に使うごく小さな幅（度）
EPS = 1e-9


def to_deg(meters):
    return meters * M_TO_DEG


def area_ha(geom):
    return geom.area * M_PER_DEG_LON * M_PER_DEG_LAT / 10000


def length_m(geom):
    return geom.length * (M_PER_DEG_LON + M_PER_DEG_LAT) / 2


def load(name):
    path = DATA_DIR / f"{name}.geojson"
    if not path.exists():
        print(f"[エラー] {path} がありません。先に build_kumamoto_data.py を実行してください。")
        sys.exit(1)
    return json.loads(path.read_text(encoding="utf-8"))


def area_name_of(props, geom):
    """1つの図形がどの都市計画区域に入るかを返す"""
    city = props.get("Cityname")
    if city == "天草市":
        lat = geom.representative_point().y
        return AMAKUSA_NORTH if lat >= AMAKUSA_LAT_SPLIT else AMAKUSA_SOUTH
    return CITY_TO_AREA.get(city)


def round_geom(obj, digits=COORD_DIGITS):
    """座標の桁数を減らす（通信量を減らすため。約0.1mの精度は残る）"""
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(v), digits) for v in obj]
        return [round_geom(v, digits) for v in obj]
    return obj


def fill_narrow_gaps(geom, dist_deg):
    """細いすき間だけを埋める（ふくらませてから同じだけ縮める）。
    区域の外形はほぼそのままで、幅 2×dist より細いすき間・切れ目だけがふさがる。"""
    return geom.buffer(dist_deg, join_style=2).buffer(-dist_deg, join_style=2)


def build_partition(areas, snap_deg):
    """区域どうしの重なり・すき間をなくして、境界をぴったり合わせる。

    やり方:
      1. 全区域を合わせた図形の細いすき間を埋め、「すき間だった場所」を取り出す
      2. 広い区域から順に、
           自分の元の形 ＋ 近くのすき間（snap_deg以内）
         を自分の場所として取っていく。先に取られた場所は取れない。
    こうすると重なりは先に処理した区域のものになり、すき間も埋まって、
    隣どうしの境界が同じ座標の並びになる。
    大事なのは「隣の区域の元の形には手を出さない」こと。
    単純にふくらませると隣の区域を25m分も削ってしまうので、
    すき間だった場所（gaps）にだけふくらみを効かせている。
    """
    original = unary_union(list(areas.values()))
    whole = fill_narrow_gaps(original, snap_deg)
    gaps = whole.difference(original)  # どの区域にも入っていなかった細いすき間

    result = {}
    taken = None
    # 広いものから決めていく（小さい区域が大きい区域に飲まれないように）
    for name in sorted(areas, key=lambda n: -areas[n].area):
        near_gap = areas[name].buffer(snap_deg, join_style=2).intersection(gaps)
        piece = unary_union([areas[name], near_gap])
        if taken is not None:
            piece = piece.difference(taken)
        piece = piece.buffer(0)
        # 掃除の拍子にできた小さなかけらは捨てる（1ha未満）
        piece = drop_small_parts(piece, 10000 / (M_PER_DEG_LON * M_PER_DEG_LAT))
        result[name] = piece
        taken = piece if taken is None else unary_union([taken, piece])
    return result


def drop_small_parts(geom, min_area_deg2):
    parts = [g for g in getattr(geom, "geoms", [geom])
             if isinstance(g, Polygon) and g.area >= min_area_deg2]
    if not parts:
        return geom
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def build_shared_lines(areas):
    """境界線を1本ずつに分解し、どの区域のものかを付ける。

    unary_union は、ぴったり重なっている線を1本にまとめてくれる。
    まとめた線を「持ち主の組み合わせ」ごとにグループ分けし、
    同じ組み合わせの線はつなげて長い1本にする（一点鎖線が途切れないように）。
    最後に、1本の線を持ち主の数だけ複製して書き出す。
    複製はまったく同じ座標なので、重ねて描いてもきれいな一点鎖線になる。
    """
    boundaries = {name: g.boundary for name, g in areas.items()}
    edges = unary_union(list(boundaries.values()))
    edge_list = list(getattr(edges, "geoms", [edges]))

    # 線ごとに持ち主を調べる
    groups = {}
    for edge in edge_list:
        owners = []
        for name, b in boundaries.items():
            # 遠いものは先に外す（総当たりだと遅いため）
            if not b.bounds or edge.distance(b) > EPS:
                continue
            if b.intersection(edge.buffer(EPS)).length >= edge.length * 0.9:
                owners.append(name)
        if not owners:
            continue
        groups.setdefault(tuple(sorted(owners)), []).append(edge)

    # 持ち主が同じ線どうしをつないで長い線にする
    # （一点鎖線が途中で途切れないよう、できるだけ長い1本にまとめる）
    out = {}
    for owners, es in groups.items():
        u = unary_union(es)
        if u.geom_type == "LineString":
            out[owners] = [u]
        else:
            merged = linemerge(u)
            out[owners] = list(getattr(merged, "geoms", [merged]))
    return out


def main():
    print("■ 都市計画区域")
    src = load("toshikeikaku_kuiki")
    by_area = {}
    meta = {}
    unknown = set()
    for f in src["features"]:
        g = shape(f["geometry"]).buffer(0)
        name = area_name_of(f["properties"], g)
        if not name:
            unknown.add(f["properties"].get("Cityname"))
            continue
        by_area.setdefault(name, []).append(g)
        m = meta.setdefault(name, {"cities": set(), "fndate": set(), "fnnumber": set()})
        m["cities"].add(f["properties"].get("Cityname"))
        if f["properties"].get("FNDate"):
            m["fndate"].add(f["properties"]["FNDate"])
        if f["properties"].get("FNNumber"):
            m["fnnumber"].add(f["properties"]["FNNumber"])
    if unknown:
        print(f"  [警告] どの区域か分からない市町村: {unknown}")

    areas = {name: unary_union(gs) for name, gs in by_area.items()}
    print(f"  {len(src['features'])}件 → {len(areas)}区域にまとめた")

    before = {n: area_ha(g) for n, g in areas.items()}
    cleaned = build_partition(areas, to_deg(SNAP_M))

    print(f"\n  すき間・重なりの掃除（{SNAP_M}mまで）による面積の変化:")
    for name in AREA_ORDER:
        if name not in cleaned:
            continue
        a, b = before[name], area_ha(cleaned[name])
        diff = b - a
        pct = diff / a * 100 if a else 0
        print(f"    {name:<12} {a:>9,.0f} ha → {b:>9,.0f} ha  ({diff:+8,.1f} ha / {pct:+5.2f}%)")

    lines_by_owners = build_shared_lines(cleaned)

    shared = {o: ls for o, ls in lines_by_owners.items() if len(o) > 1}
    print("\n  隣り合う区域が共有している境界（同じ線を2件に複製して書き出す）:")
    if shared:
        for owners, ls in sorted(shared.items()):
            total = sum(length_m(l) for l in ls)
            print(f"    {' ─ '.join(owners)}: {total:>8,.0f} m")
    else:
        print("    なし")

    # ---- 面を書き出す ----
    feats = []
    for name in AREA_ORDER:
        if name not in cleaned:
            continue
        m = meta[name]
        feats.append({
            "type": "Feature",
            "geometry": round_geom(mapping(cleaned[name])),
            "properties": {
                "TokeiName": name,
                "TokeiType": "都市計画区域",
                "Pref": "熊本県",
                "Cityname": "・".join(sorted(m["cities"])),
                "FNDate": "・".join(sorted(m["fndate"])) or None,
                "FNNumber": "・".join(sorted(m["fnnumber"])) or None,
            },
        })
    write("toshikeikaku_kuiki_area", feats, "都市計画区域(面)")

    # ---- 枠線を書き出す ----
    line_feats = []
    for owners, ls in lines_by_owners.items():
        for line in ls:
            geom = round_geom(mapping(line))
            for owner in owners:
                line_feats.append({
                    "type": "Feature",
                    "geometry": geom,
                    "properties": {
                        "TokeiName": owner,
                        "TokeiType": "都市計画区域",
                        "Pref": "熊本県",
                        # 隣の区域と共有している線かどうか（確認用）
                        "Shared": "・".join(o for o in owners if o != owner) or None,
                    },
                })
    line_feats.sort(key=lambda f: AREA_ORDER.index(f["properties"]["TokeiName"]))
    write("toshikeikaku_kuiki_line", line_feats, "都市計画区域(枠線)")

    # ---- 準都市計画区域も同じように ----
    print("\n■ 準都市計画区域")
    jun = load("jun_toshikeikaku_kuiki")
    jun_areas = {}
    jun_meta = {}
    for f in jun["features"]:
        # 1件しかないので区域名はデータの種別欄をそのまま使う
        name = f["properties"].get("AreaType") or "準都市計画区域"
        jun_areas.setdefault(name, []).append(shape(f["geometry"]).buffer(0))
        jun_meta.setdefault(name, set()).add(f["properties"].get("Cityname"))
    jun_areas = {n: unary_union(gs) for n, gs in jun_areas.items()}
    print(f"  {len(jun['features'])}件 → {len(jun_areas)}区域にまとめた")

    jun_lines = build_shared_lines(jun_areas)
    jf = [{
        "type": "Feature",
        "geometry": round_geom(mapping(g)),
        "properties": {
            "TokeiName": n, "TokeiType": "準都市計画区域", "Pref": "熊本県",
            "Cityname": "・".join(sorted(jun_meta[n])),
        },
    } for n, g in jun_areas.items()]
    write("jun_toshikeikaku_kuiki_area", jf, "準都市計画区域(面)")

    jl = []
    for owners, ls in jun_lines.items():
        for line in ls:
            geom = round_geom(mapping(line))
            for owner in owners:
                jl.append({
                    "type": "Feature",
                    "geometry": geom,
                    "properties": {
                        "TokeiName": owner, "TokeiType": "準都市計画区域",
                        "Pref": "熊本県",
                        "Shared": "・".join(o for o in owners if o != owner) or None,
                    },
                })
    write("jun_toshikeikaku_kuiki_line", jl, "準都市計画区域(枠線)")


def write(name, features, label):
    path = DATA_DIR / f"{name}.geojson"
    path.write_text(
        json.dumps({"type": "FeatureCollection", "features": features},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"  {label}: {len(features)}件 → {name}.geojson  {path.stat().st_size/1024:,.0f}KB")


if __name__ == "__main__":
    main()
