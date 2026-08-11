"""サイトを更新するとき、これ1つを実行すれば全部そろう。

用途地域や地区計画を足したあとは、これを流してから git push すればよい。
順番を覚えておく必要はない。

  1. 09で地区計画を統合する          （出所が複数あるので優先順位で1つに絞る）
  2. 資料リンクを付け直す
  3. サイト用に変換して04へ運ぶ
  4. 台帳をつくり直す
  5. 用途地域の追加分と丸印を作る
  6. **読むファイルの一覧（layers.json）を書き出す**
  7. **公開前の点検**

--dist を付けると、続けて庁内配布用のZIPも作る。

途中で失敗したらそこで止める（先へ進むと、古いデータのまま公開されてしまうため）。
システムPythonで動く（中でQGIS付属のPythonも呼ぶ）。
"""
import argparse
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent          # 04MapViewer
Q = pathlib.Path(r"C:\Users\kyama\Documents\ClaudeCode\09QGISCityPlanning")
QGIS = r"C:\Program Files\QGIS 3.44.9\bin\python-qgis-ltr.bat"

# (見出し, 実行するもの, スクリプト, QGISのPythonが要るか)
手順 = [
    ("地区計画を統合する", Q / "scripts" / "build_chiku_merged.py", True),
    ("資料リンクを付け直す", Q / "scripts" / "build_chiku_links.py", False),
    ("地区計画をサイト用に変換する", Q / "scripts" / "build_chiku_for_site.py", False),
    ("用途地域の追加分をサイト用に変換する", Q / "scripts" / "build_youto_r8_for_site.py", False),
    ("用途地域の追加分の丸印を作る", Q / "scripts" / "build_youto_r8_circles.py", True),
    ("台帳を作り直す", Q / "scripts" / "build_chiku_daicho.py", False),
    ("読むファイルの一覧を書き出す", ROOT / "scripts" / "build_layers_manifest.py", False),
]

点検 = ROOT / "scripts" / "check_before_publish.py"

# 庁内配布のためのもの（--dist のときだけ）
配布手順 = [
    ("庁内版のデータ(.js)を作る", ROOT / "scripts" / "build_offline_data.py", False),
    ("配布用のZIPをまとめる", ROOT / "scripts" / "build_dist.py", False),
]


def 実行(見出し, script, qgis):
    if not script.exists():
        print(f"  ※ {script.name} が無いので飛ばす")
        return True
    print(f"\n{'─' * 60}\n▶ {見出し}\n{'─' * 60}")
    cmd = ([QGIS, str(script)] if qgis else [sys.executable, str(script)])
    t0 = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (r.stdout or "").strip()
    if out:
        print(out)
    # QGISのスクリプトは正常でも終了コード5を返す。標準出力も消えることがある
    失敗 = r.returncode not in (0, 5) if qgis else r.returncode != 0
    if 失敗:
        print(f"★ 失敗（終了コード {r.returncode}）")
        if r.stderr:
            print(r.stderr[-1500:])
        return False
    print(f"  （{time.time() - t0:.0f}秒）")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", action="store_true", help="庁内配布用のZIPまで作る")
    args = ap.parse_args()

    t0 = time.time()
    for 見出し, script, qgis in 手順:
        if not 実行(見出し, script, qgis):
            print("\n途中で失敗したので止めました。直してからやり直してください。")
            sys.exit(1)

    if args.dist:
        for 見出し, script, qgis in 配布手順:
            if not 実行(見出し, script, qgis):
                print("\n配布物を作る途中で失敗しました。")
                sys.exit(1)

    print(f"\n{'─' * 60}\n▶ 公開前の点検\n{'─' * 60}")
    r = subprocess.run([sys.executable, str(点検)], text=True)
    if r.returncode != 0:
        print("\n★ 点検で問題が見つかりました。**公開しないでください。**")
        sys.exit(1)

    print(f"\n{'=' * 60}")
    print(f"ぜんぶ終わりました（{time.time() - t0:.0f}秒）")
    print("公開するには 04MapViewer で git add / commit / push をしてください。")
    if not args.dist:
        print("庁内へ配るZIPも要るときは --dist を付けて流し直してください。")
    print("=" * 60)


if __name__ == "__main__":
    main()
