# kosen21s_01_system_design_practice
# 「電光知動」

このリポジトリは、2025年に, 石川高専電子情報工学科4年の「ハードウェアとソフトウェアの融合作品」というテーマのもと作成した,
スタートとゴールと障害物をブラウザ上の簡易Webアプリで設定すると, 道のLEDが光り, その上を車が走る「電光知動」のリポジトリです。
(ESP32 を用いたモータ制御（超音波センサを利用した壁検知）、および LED 点灯制御、さらに Python 上での Dijkstra アルゴリズムを組み合わせて、WebSocket で通信するシステム)

---

## リポジトリ構成

```txt
Base path: root
├── Arduino(ESP32)
│   ├── Bluetooth_Monitor_car
│   │   └── Bluetooth_Monitor_car.ino
│   ├── LED_Control_1
│   │   └── LED_Control_1.ino
│   └── LED_control_2
│       └── LED_control_2.ino
├── README.md
├── backend
│   ├── dijkstra.py
│   └── tempCodeRunnerFile.py
└── frontend
    ├── index.html
    ├── p5_test.js
    └── styles.css
```

### Arduino(ESP32)/Bluetooth_Monitor_car/Bluetooth_Monitor_car.ino

- モータを制御する ESP32 のコードです。  
- BluetoothSerial を用いて、以下のような文字列コマンドを受信して動作します:
  - `"straight"`, `"left"`, `"right"`, `"back"`, `"stop"`
  - `delay=○○` により、旋回時のディレイ時間を外部から変更可能
- 超音波センサの値に応じて壁を検知し、壁がなくなると自動で次コマンドへ進むようになっています。

### Arduino(ESP32)/LED_Control_1/LED_Control_1.ino

- LED を制御する別の ESP32 用コードです。
- 1 ～ 17 の番号を受信すると、その番号に対応するピンを HIGH にし、LED を点灯します。
- `RESET` コマンドで全消灯します。

### Arduino(ESP32)/LED_control_2/LED_control_2.ino

- こちらも LED を制御する ESP32 コードです。
- 18 ～ 26 の番号を受信すると、 1 ～ 9 にマッピングして点灯する仕組みです。
- 同様に `RESET` で全消灯します。

### backend/dijkstra.py

- Python の WebSocket サーバ + Dijkstra アルゴリズム実装コード。
- `websockets`、`numpy`、`pyserial` などのライブラリを利用しています。
- クライアント（p5.js）から送られた `start`, `goal`, `remove_edges`（障害物として削除するエッジ）をもとに、  
  グラフから指定のエッジを取り除いて Dijkstra で最短経路を算出します。
- 求めた最短経路をクライアントに返すと同時に、LED 制御用 ESP32 へエッジ番号のリストを送信し点灯制御、モータ用 ESP32 へ一括コマンドを送信する仕組みです。

### frontend/index.html / p5_test.js / styles.css

- p5.js でノードや障害物を可視化・選択するフロントエンド。
- ノードをクリックして「スタート」「ゴール」を指定し、エッジの中点をクリックして障害物（削除エッジ）を指定後、「確定」ボタン押下で WebSocket を通じてバックエンドにデータを送信します。
- Dijkstra の結果を受信すると、p5.js のキャンバス上で経路を黄色のラインとして描画します。

---

## セットアップ & 使い方

1. **Arduino(ESP32) 側の準備**  
   - `Bluetooth_Monitor_car.ino` を書き込んだ ESP32（モータ制御用）  
   - `LED_Control_1.ino`, `LED_control_2.ino` を書き込んだ ESP32（LED 制御用）  
   - それぞれのシリアルポート/Bluetooth 接続を確認してください。

2. **Python 環境での準備**  
   - `pip install websockets pyserial numpy` などで必要ライブラリを導入  
   - `dijkstra.py` 内の `COM_PORT_MOTOR`, `COM_PORT_LED1`, `COM_PORT_LED2` を実際のポート名に合わせて修正  
   - `MOTOR_ENABLED`, `LED1_ENABLED`, `LED2_ENABLED` を `True` にすると各デバイスへの送信が有効になります。

3. **バックエンド（WebSocket サーバ）の起動**  
   - `cd backend`  
   - `python dijkstra.py`  
   - コンソールに「WebSocketサーバー起動」等の表示があれば正常に起動しています。

4. **フロントエンドの起動**  
   - `frontend/index.html` をブラウザで開きます。  
   - p5.js のキャンバスにノードが並んでいるので、スタートノードとゴールノードをクリック → 「スタート確定」「ゴール確定」ボタン。  
   - 障害物として削除したいエッジの中点をクリック → 「障害物確定」ボタン。  
   - 最短経路計算結果がサーバから返ってくると、キャンバス上に黄色い線で経路が描画されます。
   - 同時にモータ用 ESP32 へコマンドが一括送信され、LED 用 ESP32 にもエッジ番号が送信されて点灯します。

---

## ライセンス等

特に明記のない部分は、自己責任のもと自由に利用ください。  
不具合報告や機能追加リクエストがあれば、Issues や Pull Request にてお知らせください。

---
