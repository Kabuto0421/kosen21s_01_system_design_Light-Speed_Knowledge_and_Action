#include <BluetoothSerial.h> // Bluetoothシリアル通信ライブラリ
BluetoothSerial SerialBT;    // Bluetoothシリアル通信のインスタンス作成

// ==================
// モーター制御用ピン（4ピン使用）
// ==================
const int m1Pin1 = 19; // ドライバ1(左モータ)のIN1
const int m1Pin2 = 23; // ドライバ1(左モータ)のIN2
const int m2Pin1 = 18; // ドライバ2(右モータ)のIN1
const int m2Pin2 = 21; // ドライバ2(右モータ)のIN2

// ==================
// 超音波センサ用ピン（元コードから流用）
// ==================
const int TRIG1 = 25;
const int ECHO1 = 26;
const int TRIG2 = 32;
const int ECHO2 = 33;
const int MAX_WAIT = 20000;
double sonic = 331.5 + (0.6 * 25); // 音速（気温25℃）

// ==================
// その他
// ==================
bool stopped = true; // 「走行中かどうか」を追跡するフラグ（元コードと同じ）

void setup()
{
    // Bluetoothデバイスの初期化
    SerialBT.begin("ESP32_MotorControl");
    Serial.begin(115200); // シリアルモニタ用の通信速度を設定
    Serial.println("Bluetooth Serial started. Waiting for commands...");

    // モーター制御ピンの初期化（4ピン）
    pinMode(m1Pin1, OUTPUT);
    pinMode(m1Pin2, OUTPUT);
    pinMode(m2Pin1, OUTPUT);
    pinMode(m2Pin2, OUTPUT);

    // 超音波センサ用ピンを初期化
    pinMode(TRIG1, OUTPUT);
    pinMode(ECHO1, INPUT);
    pinMode(TRIG2, OUTPUT);
    pinMode(ECHO2, INPUT);

    // 初期状態を停止に設定
    stopMotor();
}

void loop()
{
    // 1) まずBluetoothコマンド受信を常にチェック
    if (SerialBT.available())
    {
        uint8_t command = SerialBT.read();
        Serial.print("[BT] Received Command: ");
        Serial.println(command);
        handleCommand(command);
    }

    // 2) 壁判定（「走行中」のみチェック）
    if (!stopped)
    {
        double dist1 = read_distance1();
        double dist2 = read_distance2();
        Serial.print("dist1: ");
        Serial.println(dist1);
        Serial.print("dist2: ");
        Serial.println(dist2);

        // 壁が無くなった(あるいは安全距離を超えた)とみなす閾値を5.0に設定
        if (dist1 > 5.0 || dist2 > 5.0)
        {
            // 壁がなくなったら停止し、Pythonに「1」と送る
            Serial.println("No Wall Exist → Stop and Send '1' to Python");
            handleCommand(3); // Stop
            if (SerialBT.connected())
            {
                SerialBT.println("1");
            }
        }
        else
        {
            Serial.println("Wall Exist");
        }
    }

    delay(200); // 適宜調整
}

// ==================
// コマンド処理
// ==================
void handleCommand(uint8_t command)
{
    switch (command)
    {
    case 0: // 前進
        Serial.println("Forward");
        forward();
        stopped = false;
        break;
    case 1: // 右折
        Serial.println("Turn Right");
        rightTurn();
        stopped = false;
        break;
    case 2: // 左折
        Serial.println("Turn Left");
        leftTurn();
        stopped = false;
        break;
    case 3: // 停止
        Serial.println("Stop");
        stopMotor();
        stopped = true;
        break;
    case 4: // 後退
        Serial.println("Back");
        backward();
        stopped = false;
        break;
    default:
        Serial.println("Unknown Command");
        return;
    }
}

// ==================
// モーター動作関数
// （2つめのコードから抽出・流用）
// ==================
void forward()
{
    // 左モータ: 前進
    digitalWrite(m1Pin1, LOW);
    digitalWrite(m1Pin2, HIGH);
    // 右モータ: 前進
    digitalWrite(m2Pin1, HIGH);
    digitalWrite(m2Pin2, LOW);
}

void backward()
{
    // 左モータ: 後退
    digitalWrite(m1Pin1, LOW);
    digitalWrite(m1Pin2, HIGH);
    // 右モータ: 後退
    digitalWrite(m2Pin1, HIGH);
    digitalWrite(m2Pin2, LOW);
}

void rightTurn()
{
    // 左モータ: 前進
    digitalWrite(m1Pin1, HIGH);
    digitalWrite(m1Pin2, LOW);
    // 右モータ: 後退
    digitalWrite(m2Pin1, HIGH);
    digitalWrite(m2Pin2, LOW);
}

void leftTurn()
{
    // 左モータ: 後退
    digitalWrite(m1Pin1, LOW);
    digitalWrite(m1Pin2, HIGH);
    // 右モータ: 前進
    digitalWrite(m2Pin1, LOW);
    digitalWrite(m2Pin2, HIGH);
}

void stopMotor()
{
    // 両モータを停止
    digitalWrite(m1Pin1, LOW);
    digitalWrite(m1Pin2, LOW);
    digitalWrite(m2Pin1, LOW);
    digitalWrite(m2Pin2, LOW);
}

// ==================
// 超音波距離取得
// ==================
double read_distance1()
{
    digitalWrite(TRIG1, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG1, LOW);
    double time1 = pulseIn(ECHO1, HIGH, MAX_WAIT);
    double dist = (time1 * sonic * 100) / 1000000.0 / 2.0;
    return dist;
}

double read_distance2()
{
    digitalWrite(TRIG2, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG2, LOW);
    double time2 = pulseIn(ECHO2, HIGH, MAX_WAIT);
    double dist = (time2 * sonic * 100) / 1000000.0 / 2.0;
    return dist;
}