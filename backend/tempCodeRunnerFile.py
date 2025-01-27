import asyncio
import websockets
import json
import serial
import time
import numpy as np
import copy  # deepcopy を使う

# シリアルポート設定 (ESP32 と一致するポート名・ボーレートに変更)
COM_PORT = "/dev/tty.ESP32_MotorControl"
BAUD_RATE = 115200

# グローバル変数（シリアルオブジェクト）
ser = None

# =========================
# グラフクラス & Dijkstra
# =========================
class Graph:
    def __init__(self):
        self.nodes = []  # ノードの集合 (list)
        self.edges = {}  # 隣接リスト (dict: node -> [(node2, weight), ...])
        self.positions = {}  # ノードの座標 (dict: node -> (x, y))

    def add_node(self, node, position):
        if node not in self.nodes:
            self.nodes.append(node)
        if node not in self.edges:
            self.edges[node] = []
        self.positions[node] = position

    def add_edge(self, node1, node2, weight):
        # 無向グラフを想定
        self.edges[node1].append((node2, weight))
        self.edges[node2].append((node1, weight))

    def delete_edge(self, node1, node2):
        # エッジ削除
        self.edges[node1] = [(n, w) for (n, w) in self.edges[node1] if n != node2]
        self.edges[node2] = [(n, w) for (n, w) in self.edges[node2] if n != node1]

def Dijkstra(graph, start):
    """
    Dijkstraアルゴリズムにより start から各ノードへの最短距離を計算し、
    また最短経路を復元するための previous_node を返す。
    """
    S = []
    distances = {node: np.inf for node in graph.nodes}
    distances[start] = 0
    previous_node = {node: None for node in graph.nodes}

    while len(S) < len(graph.nodes):
        notin_S = [node for node in graph.nodes if node not in S]
        current_node = min(notin_S, key=lambda node: distances[node])
        S.append(current_node)

        for neighboring_node, weight in graph.edges[current_node]:
            if neighboring_node not in S:
                new_dist = distances[current_node] + weight
                if new_dist < distances[neighboring_node]:
                    distances[neighboring_node] = new_dist
                    previous_node[neighboring_node] = current_node

    return distances, previous_node

def restore_path(previous_node, start, goal):
    """
    previous_node 配列を使って start→goal の経路を復元する。
    """
    path = []
    current_node = goal
    while current_node is not None:
        path.append(current_node)
        if current_node == start:
            break
        current_node = previous_node[current_node]
    path.reverse()
    return path

# =========================
# 送信用 関数
# =========================
def send_command(command):
    """
    コマンドを対応するバイトデータに変換して送信する。
    commands の数値を変更すれば ESP32 側で対応する動作を変えられる。
    """
    commands = {
        "straight": 0,
        "right": 1,
        "left": 2,
        "stop": 3,
        "back": 4
    }
    if command in commands:
        ser.write((commands[command]).to_bytes(1, "big"))
        print(f"[SEND] {command} コマンドを送信しました")
    else:
        print(f"無効なコマンド: {command}")

def decide_directions(graph, path):
    """
    経路に基づいて移動方向('straight', 'left', 'right')のリストを作成する。
    2つ先の差分ベクトルから cross_product を計算して左右を判断。
    """
    path_node_positions = [graph.positions[node] for node in path]
    deltas = []
    actions = []

    # ノード同士の差分ベクトルを算出
    for i in range(len(path_node_positions) - 1):
        pos1 = path_node_positions[i]
        pos2 = path_node_positions[i + 1]
        delta_x = pos2[0] - pos1[0]
        delta_y = pos2[1] - pos1[1]
        deltas.append((delta_x, delta_y))

    # 差分ベクトル間の外積 cross_product を用いて、左/右/直進 を決定
    for i in range(len(deltas) - 1):
        delta1 = deltas[i]
        delta2 = deltas[i + 1]
        cross_product = delta1[0] * delta2[1] - delta1[1] * delta2[0]

        if cross_product == 0:
            actions.append("straight")
        elif cross_product > 0:
            actions.append("left")
        else:
            actions.append("right")

    return actions

# =========================
# 非同期のモニタリング関数
# =========================
async def monitor_and_respond(graph, path):
    """
    決定された経路に従って、シリアル(ESP32)からの停止信号を監視しつつ
    コマンドを送信する。
    """
    # 経路に基づいて、移動方向のリストを作成
    actions = decide_directions(graph, path)

    # 最初に straight を送る
    send_command("straight")
    path_index = 0

    # 経路内の方向指示を順番に送信
    while path_index < len(actions):
        print(f"現在のノード移動: {path[path_index]} → {path[path_index + 1]}")

        signal = None
        while signal is None:
            # 1) シリアルからの停止信号があるかチェック
            if ser.in_waiting > 0:
                try:
                    line = ser.readline().decode().strip()
                    signal = int(line)  # 1 or 0 と想定
                except ValueError:
                    signal = None
            else:
                # 2) シリアルが無い時 → ユーザーのEnter入力チェック
                #    Enterなら擬似停止信号をセット
                try:
                    user_input = input("Press ENTER to simulate stop signal (or Ctrl+D to skip): ")
                    if user_input == "":  # 空文字列＝Enterのみ
                        signal = 1
                except EOFError:
                    pass

            # ブロックせずに非同期で待つ (ただし input() は同期呼び出しなので結局ブロックされる)
            await asyncio.sleep(0.1)

        # 停止信号(1)を受信したら次のコマンドを送る
        if signal == 1:
            action = actions[path_index]
            print(f"停止信号を受信 → 次のアクション: {action}")
            send_command(action)

            # 左右旋回の場合は一定時間後に straight を送る
            if action in ["right", "left"]:
                await asyncio.sleep(3)
                send_command("straight")
                print("3秒後に straight を送信")

            path_index += 1

    print("GOAL地点に到達しました。経路上のコマンド送信を終了します。")

# =========================
# ベースグラフ (固定ノード・固定エッジ)
# =========================
def create_base_graph():
    g = Graph()
    # --- ノードの作成 ---
    g.add_node('v0', (0,7))
    g.add_node('v1', (2,7))
    g.add_node('v2', (4,7))
    g.add_node('v3', (6,7))
    g.add_node('v4', (8,7))
    g.add_node('v5', (0,5))
    g.add_node('v6', (2,5))
    g.add_node('v7', (4,5))
    g.add_node('v8', (6,5))
    g.add_node('v9', (8,5))
    g.add_node('v10', (2,2))
    g.add_node('v11', (4,2))
    g.add_node('v12', (6,2))
    g.add_node('v13', (8,2))
    g.add_node('v14', (0,0))
    g.add_node('v15', (2,0))
    g.add_node('v16', (6,0))
    g.add_node('v17', (8,0))

    # --- エッジの作成 ---
    g.add_edge('v0', 'v1', 1)
    g.add_edge('v0', 'v5', 1)
    g.add_edge('v1', 'v2', 1)
    g.add_edge('v1', 'v6', 1)
    g.add_edge('v2', 'v3', 1)
    g.add_edge('v2', 'v7', 1)
    g.add_edge('v3', 'v4', 1)
    g.add_edge('v3', 'v8', 1)
    g.add_edge('v4', 'v9', 1)
    g.add_edge('v5', 'v6', 1)
    g.add_edge('v5', 'v14', 4)
    g.add_edge('v6', 'v7', 1)
    g.add_edge('v6', 'v10', 2)
    g.add_edge('v7', 'v8', 1)
    g.add_edge('v7', 'v11', 2)
    g.add_edge('v8', 'v9', 1)
    g.add_edge('v9', 'v13', 2)
    g.add_edge('v10', 'v11', 1)
    g.add_edge('v10', 'v15', 1)
    g.add_edge('v11', 'v12', 1)
    g.add_edge('v12', 'v13', 1)
    g.add_edge('v12', 'v16', 1)
    g.add_edge('v13', 'v17', 1)
    g.add_edge('v14', 'v15', 1)
    g.add_edge('v15', 'v16', 3)
    g.add_edge('v16', 'v17', 1)
    return g

# ベースグラフのインスタンス
BASE_G = create_base_graph()

# =========================
# WebSocketハンドラ
# =========================
async def handle_connection(websocket):
    """
    p5.js から送られるデータを受け取り、
    指定されたエッジを削除したグラフでDijkstra → ESP32へコマンド送信。
    """
    async for message in websocket:
        try:
            data = json.loads(message)
            # 例: data = {"start":"v0", "goal":"v9", "remove_edges":["v1-v2","v3-v8"]}
            remove_edges = data.get("remove_edges", [])
            start = data["start"]
            goal = data["goal"]

            print(f"[WS受信] start={start}, goal={goal}, remove_edges={remove_edges}")

            # ベースグラフをコピー (deepcopy)
            graph = copy.deepcopy(BASE_G)

            # 指定エッジを削除
            for edge_str in remove_edges:
                node1, node2 = edge_str.split('-')
                if node1 in graph.edges and node2 in graph.edges:
                    print(f"→ エッジ削除: {node1} - {node2}")
                    graph.delete_edge(node1, node2)

            # Dijkstra で経路計算
            distances, previous_node = Dijkstra(graph, start)
            path = restore_path(previous_node, start, goal)

            # 経路が見つかれば
            if path and len(path) > 1:
                print("Path found. Now sending commands to ESP32...")
                # 1) p5.js に path を返す
                response = {"path": path}
                await websocket.send(json.dumps(response))
    
                # 2) p5.js に返した後で、ESP32へモータ命令を送る
                print("Now sending commands to ESP32...")
                await monitor_and_respond(graph, path)

                response = {"path": path}
            else:
                response = {"error": "Path not found or path is too short"}
                await websocket.send(json.dumps(response))

        except Exception as e:
            print(f"エラー: {e}")
            await websocket.send(json.dumps({"error": str(e)}))


# =========================
# シリアル初期化
# =========================
async def init_serial():
    global ser
    print("Open Port")
    ser = serial.Serial(COM_PORT, BAUD_RATE)
    time.sleep(1.5)  # 通信安定のための待機
    ser.flushInput()
    ser.flushOutput()

# =========================
# メイン処理 (WebSocketサーバ)
# =========================
async def main():
    await init_serial()

    # handle_connection(websocket) をサーバで待受
    async with websockets.serve(handle_connection, "localhost", 8765):
        print("WebSocketサーバーが起動しました (Ctrl+C で終了)")
        try:
            await asyncio.Future()  # 永久に待機
        except KeyboardInterrupt:
            print("サーバーを終了します。")
        finally:
            # 終了時にシリアルポートを閉じる
            if ser and ser.is_open:
                print("Close Port")
                ser.close()

if __name__ == "__main__":
    asyncio.run(main())
