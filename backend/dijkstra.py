import asyncio
import websockets
import json
import serial
import time
import numpy as np
import copy  # deepcopy を使う

# ==== シリアルポート設定 ====
COM_PORT_MOTOR = "/dev/tty.ESP32_MotorControl05"
COM_PORT_LED1  = "/dev/tty.ESP32_LED_Control_1"
COM_PORT_LED2  = "/dev/tty.ESP32_LED_Control_2_ver2"
BAUD_RATE = 115200

# ======= グローバル変数（有効/無効のフラグ） =======
MOTOR_ENABLED = False   # TrueならモーターESP32を使う
LED1_ENABLED  = False   # TrueならLED1 ESP32を使う
LED2_ENABLED  = True  # TrueならLED2 ESP32を使う(テスト時にOFF)

# ======= グローバル変数（シリアルオブジェクト） =======
ser_motor = None
ser_led1 = None
ser_led2 = None



# =========================
# エッジ番号のマッピング
# =========================
# 「(ノード1, ノード2) -> エッジ番号」のように両方向ぶん作る。
# たとえば v0-v1 がエッジ番号1なら、(v0, v1) と (v1, v0) 両方 1 にする。
EDGE_NUM_MAP = {
    ("v0", "v1"): 1, ("v1", "v0"): 1,
    ("v1", "v2"): 2, ("v2", "v1"): 2,
    ("v2", "v3"): 3, ("v3", "v2"): 3,
    ("v3", "v4"): 4, ("v4", "v3"): 4,
    ("v0", "v5"): 5, ("v5", "v0"): 5,
    ("v1", "v6"): 6, ("v6", "v1"): 6,
    ("v2", "v7"): 7, ("v7", "v2"): 7,
    ("v3", "v8"): 8, ("v8", "v3"): 8,
    ("v4", "v9"): 9, ("v9", "v4"): 9,
    ("v5", "v6"): 10, ("v6", "v5"): 10,
    ("v6", "v7"): 11, ("v7", "v6"): 11,
    ("v7", "v8"): 12, ("v8", "v7"): 12,
    ("v8", "v9"): 13, ("v9", "v8"): 13,
    ("v5", "v14"): 14, ("v14", "v5"): 14,
    ("v6", "v10"): 15, ("v10", "v6"): 15,
    ("v7", "v11"): 16, ("v11", "v7"): 16,
    ("v9", "v13"): 17, ("v13", "v9"): 17,
    ("v10", "v11"): 18, ("v11", "v10"): 18,
    ("v11", "v12"): 19, ("v12", "v11"): 19,
    ("v12", "v13"): 20, ("v13", "v12"): 20,
    ("v10", "v15"): 21, ("v15", "v10"): 21,
    ("v12", "v16"): 22, ("v16", "v12"): 22,
    ("v13", "v17"): 23, ("v17", "v13"): 23,
    ("v14", "v15"): 24, ("v15", "v14"): 24,
    ("v15", "v16"): 25, ("v16", "v15"): 25,
    ("v16", "v17"): 26, ("v17", "v16"): 26
}

# =========================
# グラフクラス & Dijkstra
# =========================
class Graph:
    def __init__(self):
        self.nodes = []
        self.edges = {}
        self.positions = {}

    def add_node(self, node, position):
        if node not in self.nodes:
            self.nodes.append(node)
        if node not in self.edges:
            self.edges[node] = []
        self.positions[node] = position

    def add_edge(self, node1, node2, weight):
        self.edges[node1].append((node2, weight))
        self.edges[node2].append((node1, weight))

    def delete_edge(self, node1, node2):
        self.edges[node1] = [(n, w) for (n, w) in self.edges[node1] if n != node2]
        self.edges[node2] = [(n, w) for (n, w) in self.edges[node2] if n != node1]

def Dijkstra(graph, start):
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
# 送信用 関数 (モーター用)
# =========================
def send_command_motor(command):
    """
    車用ESP32 (ser_motor) に送るコマンド。
    """
    commands = {
        "straight": 0,
        "right": 1,
        "left": 2,
        "stop": 3,
        "back": 4
    }
    if command in commands:
        ser_motor.write((commands[command]).to_bytes(1, "big"))
        print(f"[SEND to MOTOR] {command} コマンドを送信しました")
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
# LED制御用 関数
# =========================
def send_edges_to_led_controllers(used_edges):
    """
    used_edges: 最短経路で実際に使われたエッジ番号のリスト (例: [1,2,5,20,...])
    
    ・1～17 のエッジ番号を LED1 用
    ・18～26 のエッジ番号を LED2 用
    両方に該当する場合はどちらも送る。
    """
    # LED1用のエッジ
    led1_edges = [e for e in used_edges if 1 <= e <= 17]
    # LED2用のエッジ
    led2_edges = [e for e in used_edges if 18 <= e <= 26]

    # 何らかのフォーマットで送る(ここでは JSONに "edges" フィールドを入れて送信)
    # LED1に送信
    if led1_edges:
        led1_str = ",".join(str(e) for e in led1_edges) + "\n"
        ser_led1.write(led1_str.encode("utf-8"))
        print(f"[SEND to LED1] {led1_str.strip()}")

    # LED2に送信
    if led2_edges:
        led2_str = ",".join(str(e) for e in led2_edges) + "\n"
        ser_led2.write(led2_str.encode("utf-8"))
        print(f"[SEND to LED2] {led2_str.strip()}")


# =========================
# 非同期のモニタリング関数
# =========================
async def monitor_and_respond(graph, path):
    actions = decide_directions(graph, path)

    # 最初に straight を送る
    send_command_motor("straight")
    path_index = 0

    while path_index < len(actions):
        print(f"現在のノード移動: {path[path_index]} → {path[path_index + 1]}")

        signal = None
        while signal is None:
            # シリアルからの停止信号があるかチェック
            if ser_motor.in_waiting > 0:
                try:
                    line = ser_motor.readline().decode().strip()
                    signal = int(line)  # 1 or 0 と想定
                except ValueError:
                    signal = None
            else:
                await asyncio.sleep(0.1)

        # 停止信号(1)を受信したら次のコマンドを送る
        if signal == 1:
            action = actions[path_index]
            print(f"停止信号を受信 → 次のアクション: {action}")
            send_command_motor(action)

            # 左右旋回の場合は一定時間後に straight を送る (例)
            if action in ["right", "left"]:
                await asyncio.sleep(1)
                send_command_motor("straight")
                print("3秒後に straight を送信")

            path_index += 1

    print("GOAL地点に到達しました。経路上のコマンド送信を終了します。")


# =========================
# ベースグラフ (固定ノード・固定エッジ)
# =========================
def create_base_graph():
    g = Graph()
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

# エッジ(無向)の定義
    g.add_edge('v0', 'v1', 1) # 1
    g.add_edge('v1', 'v2', 1) # 2
    g.add_edge('v2', 'v3', 1) # 3
    g.add_edge('v3', 'v4', 1) # 4
    g.add_edge('v0', 'v5', 1) # 5
    g.add_edge('v1', 'v6', 1) # 6
    g.add_edge('v2', 'v7', 1) # 7
    g.add_edge('v3', 'v8', 1) # 8
    g.add_edge('v4', 'v9', 1) # 9
    g.add_edge('v5', 'v6', 1) # 10
    g.add_edge('v6', 'v7', 1) # 11
    g.add_edge('v7', 'v8', 1) # 12
    g.add_edge('v8', 'v9', 1) # 13
    g.add_edge('v5', 'v14', 4) # 14
    g.add_edge('v6', 'v10', 2) # 15
    g.add_edge('v7', 'v11', 2) # 16
    g.add_edge('v9', 'v13', 2) # 17
    g.add_edge('v10', 'v11', 1) # 18
    g.add_edge('v11', 'v12', 1) # 19
    g.add_edge('v12', 'v13', 1) # 20
    g.add_edge('v10', 'v15', 1) # 21
    g.add_edge('v12', 'v16', 1) # 22
    g.add_edge('v13', 'v17', 1) # 23
    g.add_edge('v14', 'v15', 1) # 24
    g.add_edge('v15', 'v16', 3) # 25
    g.add_edge('v16', 'v17', 1) # 26
    return g

BASE_G = create_base_graph()

# =========================
# WebSocketハンドラ
# =========================
async def handle_connection(websocket):
    async for message in websocket:
        try:
            data = json.loads(message)
            remove_edges = data.get("remove_edges", [])
            start = data["start"]
            goal = data["goal"]
            print(f"[WS受信] start={start}, goal={goal}, remove_edges={remove_edges}")

            # ベースグラフをコピー
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
                print("Path found. Now sending response to p5.js and commands to ESP32...")
                # 1) p5.js に path を返す
                response = {"path": path}
                await websocket.send(json.dumps(response))

                # 2) LED制御用ESP32へも同じパス情報を送る

                # ここで最終的に通った「エッジ番号」を抽出
                used_edges = []
                for i in range(len(path)-1):
                    n1 = path[i]
                    n2 = path[i+1]
                    if (n1, n2) in EDGE_NUM_MAP:
                        edge_num = EDGE_NUM_MAP[(n1, n2)]
                        used_edges.append(edge_num)

                # LED制御用ESP32へ送る
                if LED1_ENABLED or LED2_ENABLED:
                    send_edges_to_led_controllers(used_edges)

                # 3) 車用ESP32へモータ命令 (monitor_and_respond)
                if MOTOR_ENABLED:
                    await monitor_and_respond(graph, path)
            else:
                response = {"error": "Path not found or path is too short"}
                await websocket.send(json.dumps(response))

        except Exception as e:
            print(f"エラー: {e}")
            await websocket.send(json.dumps({"error": str(e)}))

# ======= シリアル初期化 =======
async def init_serial():
    global ser_motor, ser_led1, ser_led2

    # MOTOR_ENABLED が Trueなら開く
    if MOTOR_ENABLED:
        print("Opening motor port...")
        ser_motor = serial.Serial(COM_PORT_MOTOR, BAUD_RATE)
        time.sleep(1)
        ser_motor.flushInput()
        ser_motor.flushOutput()

    # LED1_ENABLED が Trueなら開く
    if LED1_ENABLED:
        print("Opening LED1 port...")
        ser_led1 = serial.Serial(COM_PORT_LED1, BAUD_RATE)
        time.sleep(1)
        ser_led1.flushInput()
        ser_led1.flushOutput()

    # LED2_ENABLED が Trueなら開く
    if LED2_ENABLED:
        print("Opening LED2 port...")
        ser_led2 = serial.Serial(COM_PORT_LED2, BAUD_RATE)
        time.sleep(1)
        ser_led2.flushInput()
        ser_led2.flushOutput()

# ======= メイン処理 (WebSocketサーバ) =======
async def main():
    await init_serial()
    async with websockets.serve(handle_connection, "localhost", 8765):
        print("WebSocketサーバー起動 (Ctrl+Cで終了)")
        try:
            await asyncio.Future()  # 永久待機
        except KeyboardInterrupt:
            print("サーバー終了...")
        finally:
            # 終了時リセット/STOPを送る
            # LED1
            if LED1_ENABLED and ser_led1 and ser_led1.is_open:
                ser_led1.write(b"RESET\n")
                time.sleep(0.3)
                ser_led1.close()
            # LED2
            if LED2_ENABLED and ser_led2 and ser_led2.is_open:
                ser_led2.write(b"RESET\n")
                time.sleep(0.3)
                ser_led2.close()
            # MOTOR
            if MOTOR_ENABLED and ser_motor and ser_motor.is_open:
                send_command_motor("stop")
                time.sleep(0.3)
                ser_motor.close()
            print("Close All Ports")

if __name__ == "__main__":
    asyncio.run(main())