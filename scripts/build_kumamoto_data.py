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


def main():
    if not SRC_DIR.exists():
        print(f"[エラー] 元データが見つかりません: {SRC_DIR}")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    counts = {}
    total_bytes = 0

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
