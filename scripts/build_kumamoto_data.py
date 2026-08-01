"""
都市計画決定GISデータ（国土交通省）を、このサイトが読む形のGeoJSONに変換するスクリプト。

使い方:
  python scripts/build_kumamoto_data.py

やっていること:
  1. _source/ にある「市町村ごと・種類ごと」に分かれたGeoJSONを、
     種類ごとに1つのファイルへまとめる（22市町村 × 14種類 → 14ファイル）
  2. 座標の桁数を6桁（約10cm）に減らす
     元データは小数点以下14桁もあり、地図表示にはまったく不要なため
  3. 全部の図形で中身が空の属性（INDate や Custodian など）を削る
  4. data/kumamoto/ に書き出し、metadata.json に変換日と件数を記録する

元ファイル（_source/）はGit管理外。変換結果（data/kumamoto/）だけを公開する。
"""

import datetime
import json
import math
import pathlib

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC_DIR = PROJECT_ROOT / "_source" / "R7_都市計画決定GISデータ_熊本県_GeoJSON"
OUT_DIR = PROJECT_ROOT / "data" / "kumamoto"

# 座標の小数点以下の桁数。6桁で約10cmの精度があり、地図表示には十分すぎる
COORD_DIGITS = 6

# 元データのファイル名の略称 → 出力するファイル名（サイトが読む名前）
# 略称はファイル名の「43100_youto.geojson」の後半部分。
LAYERS = {
    "tokei": ("toshikeikaku_kuiki", "都市計画区域"),
    "jyuntoshi": ("jun_toshikeikaku_kuiki", "準都市計画区域"),
    "senbiki": ("kuiki_kubun", "区域区分"),
    "youto": ("youto_chiiki", "用途地域"),
    "bouka": ("bouka_chiiki", "防火地域"),
    "chikukei": ("chiku_keikaku", "地区計画"),
    "tkbt": ("tokubetsu_youto_chiku", "特別用途地区"),
    "tokuteiyouto": ("tokutei_youto_seigen", "特定用途制限地域"),
    "ritteki": ("ricchi_tekiseika_keikaku", "立地適正化計画"),
    "kouen": ("toshikeikaku_koen", "都市計画公園"),
    "douro": ("toshikeikaku_douro", "都市計画道路"),
    "fuuchichiku": ("fuuchi_chiku", "風致地区"),
    "koudori": ("koudo_riyou_chiku", "高度利用地区"),
    "tochiku": ("tochikukaku_seiri", "土地区画整理事業"),
}


def round_coords(value):
    """入れ子になった座標の配列をたどって、数値だけ桁数を減らす"""
    if isinstance(value, list):
        if value and isinstance(value[0], (int, float)):
            return [round(v, COORD_DIGITS) for v in value]
        return [round_coords(v) for v in value]
    return value


def collect(short_name):
    """1つの種類について、全市町村のファイルを読んで図形を集める"""
    features = []
    for path in sorted(SRC_DIR.rglob(f"*_{short_name}.geojson")):
        data = json.loads(path.read_text(encoding="utf-8"))
        features.extend(data.get("features", []))
    return features


def drop_empty_fields(features):
    """全部の図形で空っぽの属性を探して削る。削った属性名を返す"""
    keys = set()
    for f in features:
        keys |= set(f.get("properties", {}).keys())
    empty = {
        k for k in keys
        if all(f.get("properties", {}).get(k) in (None, "") for f in features)
    }
    for f in features:
        for k in empty:
            f["properties"].pop(k, None)
    return sorted(empty)


# ============================================================
# 容積率・建ぺい率の「丸印」を出す位置と中身を計算する
# ------------------------------------------------------------
# 都市計画図では、区域の中に丸を描いて
#   上＝容積率 / 中＝用途地域の略称 / 下＝建ぺい率
# と書く決まりになっている。その丸を置く点を先に計算しておき、
# サイト（Leaflet）とQGISの両方で同じ点を使う。
# ============================================================

# 用途地域の名前 → 丸の中に書く略称（都市計画図の慣例に合わせた）
YOUTO_ABBR = {
    "第１種低層住居専用地域": "1低層",
    "第２種低層住居専用地域": "2低層",
    "第１種中高層住居専用地域": "1中高",
    "第２種中高層住居専用地域": "2中高",
    "第１種住居地域": "1住居",
    "第２種住居地域": "2住居",
    "準住居地域": "準住居",
    "田園住居地域": "田園",
    "近隣商業地域": "近商",
    "商業地域": "商業",
    "準工業地域": "準工",
    "工業地域": "工業",
    "工業専用地域": "工専",
}

# この5つの用途地域では 200/60 が既定値なので、丸を描かない決まり
# （公式凡例の注記「○の表示のない地域は総て200/60です」に合わせる）
OMIT_DEFAULT_200_60 = {
    "第１種住居地域", "第２種住居地域", "準住居地域", "準工業地域", "工業地域",
}


def needs_circle(props):
    """この区域に丸を描くかどうか"""
    far, bcr = props.get("FAR"), props.get("BCR")
    if far in (None, "") or bcr in (None, ""):
        return False  # 数値が入っていない
    if props.get("YoutoName") in OMIT_DEFAULT_200_60 and str(far) == "200" and str(bcr) == "60":
        return False  # 既定値なので省略
    return True


def _point_in_ring(x, y, ring):
    inside = False
    for i in range(len(ring) - 1):
        xi, yi = ring[i]
        xj, yj = ring[i + 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
    return inside


def _dist_to_edges(x, y, rings):
    """点から区域の境界までの最短距離（度のまま。比べるだけなので単位は問わない）"""
    best = float("inf")
    for ring in rings:
        for i in range(len(ring) - 1):
            x1, y1 = ring[i]
            x2, y2 = ring[i + 1]
            dx, dy = x2 - x1, y2 - y1
            L2 = dx * dx + dy * dy
            t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / L2))
            px, py = x1 + t * dx, y1 + t * dy
            d = math.hypot(x - px, y - py)
            if d < best:
                best = d
    return best


def inner_point(geometry):
    """区域の中で、境界からいちばん離れた点を探す。

    重心をそのまま使うと、三日月形やコの字形の区域では外に出てしまう。
    そこで区域の上に細かい格子を敷き、内側の点のうち境界から最も遠いものを選ぶ。
    返り値は (経度, 緯度, 境界までの距離)。
    """
    if not geometry:
        return None
    polys = ([geometry["coordinates"]] if geometry["type"] == "Polygon"
             else geometry["coordinates"])
    # いちばん面積が大きい輪を選ぶ（飛び地があるとき）
    def ring_area(r):
        s = 0.0
        for i in range(len(r) - 1):
            s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
        return abs(s) / 2

    poly = max(polys, key=lambda p: ring_area(p[0]))
    outer, holes = poly[0], poly[1:]
    xs = [p[0] for p in outer]
    ys = [p[1] for p in outer]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)

    def inside(x, y):
        if not _point_in_ring(x, y, outer):
            return False
        return not any(_point_in_ring(x, y, h) for h in holes)

    best = None
    # 粗い格子でおおよその位置を探し、その周りを細かく調べ直す
    for n, (bx0, bx1, by0, by1) in ((14, (x0, x1, y0, y1)),):
        step_x = (bx1 - bx0) / (n + 1)
        step_y = (by1 - by0) / (n + 1)
        for i in range(1, n + 1):
            for j in range(1, n + 1):
                x, y = bx0 + step_x * i, by0 + step_y * j
                if not inside(x, y):
                    continue
                d = _dist_to_edges(x, y, [outer] + holes)
                if best is None or d > best[2]:
                    best = (x, y, d)
    if best is None:
        return None

    # 見つかった点のまわりをもう一段細かく調べる
    bx, by, _ = best
    rx = (x1 - x0) / 15
    ry = (y1 - y0) / 15
    for i in range(-3, 4):
        for j in range(-3, 4):
            x, y = bx + rx * i / 3, by + ry * j / 3
            if not inside(x, y):
                continue
            d = _dist_to_edges(x, y, [outer] + holes)
            if d > best[2]:
                best = (x, y, d)
    return best


def build_circles(youto_features):
    """用途地域から、丸を描く点のGeoJSONを作る"""
    out = []
    skipped_no_point = 0
    for f in youto_features:
        p = f["properties"]
        if not needs_circle(p):
            continue
        pt = inner_point(f.get("geometry"))
        if pt is None:
            skipped_no_point += 1
            continue
        x, y, d = pt
        name = p.get("YoutoName")
        out.append({
            "type": "Feature",
            "geometry": {"type": "Point",
                         "coordinates": [round(x, COORD_DIGITS), round(y, COORD_DIGITS)]},
            "properties": {
                "FAR": str(p.get("FAR")),          # 容積率（丸の上）
                "ABBR": YOUTO_ABBR.get(name, name),  # 用途地域の略称（丸の中）
                "BCR": str(p.get("BCR")),          # 建ぺい率（丸の下）
                "YoutoName": name,
                # 区域の広さの目安（度）。小さすぎる区域に丸を出さない判断に使う
                "R": round(d, 6),
            },
        })
    return out, skipped_no_point


def main():
    if not SRC_DIR.exists():
        print(f"[エラー] 元データが見つかりません: {SRC_DIR}")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    counts = {}
    total_bytes = 0

    youto_features = None  # 丸印を作るために用途地域を覚えておく

    for short_name, (out_name, label) in LAYERS.items():
        features = collect(short_name)
        if not features:
            print(f"  スキップ: {label}（元データなし）")
            continue

        dropped = drop_empty_fields(features)
        for f in features:
            if f.get("geometry"):
                f["geometry"]["coordinates"] = round_coords(f["geometry"]["coordinates"])

        out_path = OUT_DIR / f"{out_name}.geojson"
        # 区切り文字の後ろの空白を詰めて書き出す（そのぶん軽くなる）
        out_path.write_text(
            json.dumps(
                {"type": "FeatureCollection", "features": features},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
        size = out_path.stat().st_size
        total_bytes += size
        counts[label] = len(features)
        note = f"（空の属性{len(dropped)}個を削除）" if dropped else ""
        print(f"  {label}: {len(features)}件 → {out_name}.geojson  {size/1024:,.0f}KB {note}")

        if short_name == "youto":
            youto_features = features

    # 容積率・建ぺい率の丸印を置く点を書き出す
    if youto_features:
        circles, no_point = build_circles(youto_features)
        circle_path = OUT_DIR / "youto_circles.geojson"
        circle_path.write_text(
            json.dumps({"type": "FeatureCollection", "features": circles},
                       ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        size = circle_path.stat().st_size
        total_bytes += size
        counts["容積率建ぺい率の丸印"] = len(circles)
        omitted = len(youto_features) - len(circles) - no_point
        print(f"  容積率建ぺい率の丸印: {len(circles)}件 → youto_circles.geojson  {size/1024:,.0f}KB"
              f"（{omitted}件は空または200/60のため省略）")
        if no_point:
            print(f"    ※置き場所を決められなかった区域: {no_point}件")

    metadata = {
        "データ出典": "都市計画決定GISデータ（国土交通省）",
        "データ作成年度": "令和7年度",
        "変換日": datetime.date.today().isoformat(),
        "レイヤー件数": counts,
    }
    (OUT_DIR / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n合計 {total_bytes/1024/1024:.1f} MB / {len(counts)} レイヤー")
    print(f"メタ情報を書き出しました: data/kumamoto/metadata.json（変換日 {metadata['変換日']}）")


if __name__ == "__main__":
    main()
