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
// 超音波センサ用ピン
// ==================
const int TRIG1 = 25;
const int ECHO1 = 26;
const int TRIG2 = 32;
const int ECHO2 = 33;
const int MAX_WAIT = 20000;
double sonic = 331.5 + (0.6 * 25); // 音速（気温25℃）

// ==================
// 状態フラグ
// ==================
bool running = false; // 前進/後退など、走行中ならtrue
bool turning = false; // 旋回中ならtrue

// 「壁をまだ見つけていないので、壁が無くても止まらない」フラグ
bool ignoringWallCheck = true;

void setup()
{
    SerialBT.begin("ESP32_Motordenkouchidou");
    Serial.begin(115200);
    Serial.println("Bluetooth Serial started. Waiting for commands...");

    // モーター制御ピンの初期化
    pinMode(m1Pin1, OUTPUT);
    pinMode(m1Pin2, OUTPUT);
    pinMode(m2Pin1, OUTPUT);
    pinMode(m2Pin2, OUTPUT);

    // 超音波センサ用ピンの初期化
    pinMode(TRIG1, OUTPUT);
    pinMode(ECHO1, INPUT);
    pinMode(TRIG2, OUTPUT);
    pinMode(ECHO2, INPUT);

    // 初期状態を完全停止
    stopMotor();
    running = false;
    turning = false;

    // 最初は壁を「まだ」見つけていないので無視モードON
    ignoringWallCheck = true;
}

void loop()
{
    // ==================
    // A) Bluetoothコマンド受信
    // ==================
    if (SerialBT.available())
    {
        uint8_t command = SerialBT.read();
        Serial.print("[BT] Received Command: ");
        Serial.println(command);
        handleCommand(command);
    }

    // ==================
    // B) 壁判定の流れ
    // ==================
    // 「走行中(running=true) かつ 旋回中でない(turning=false) とき」にのみ距離を読む
    if (running && !turning)
    {
        double dist1 = read_distance1();
        double dist2 = read_distance2();
        Serial.print("dist1: ");
        Serial.println(dist1);
        Serial.print("dist2: ");
        Serial.println(dist2);
        Serial.print("ignoringWallCheck: ");
        Serial.println(ignoringWallCheck);

        // 1) ignoringWallCheck == true なら「まだ壁を見つけていない」状態
        //    → もし壁が近い(dist <= 5.0)なら「壁を見つけた」と判断して ignoringWallCheck = false
        if (ignoringWallCheck)
        {
            if (dist1 <= 10.0 && dist2 <= 10.0)
            {
                Serial.println(">> Found the wall! ignoringWallCheck -> false");
                ignoringWallCheck = false;
            }
        }
        // 2) ignoringWallCheck == false なら「壁を見つけた後の通常ロジック」
        //    → 壁が無くなった(dist > 5.0)ら停止
        else
        {
            // 壁消失とみなす閾値を 5.0 に
            if (dist1 > 30.0 || dist2 > 30.0)
            {
                Serial.println("No Wall Exist → Stop and Send '1' to Python");
                handleCommand(3); // 停止コマンドを呼ぶ
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
        running = true;
        turning = false;
        ignoringWallCheck = true; // 「まだ壁見つけてない」状態にリセット
        break;
    case 4: // 後退
        Serial.println("Back");
        backward();
        running = true;
        turning = false;
        ignoringWallCheck = true;
        break;
    case 1: // 右折
        Serial.println("Turn Right");
        rightTurn();
        running = false;
        turning = true;
        // 旋回中は「壁チェックしない」ので ignoringWallCheck = ? は任意
        // もし旋回の後すぐに「まだ壁見つけてない」扱いにしたいなら true
        ignoringWallCheck = true;
        break;
    case 2: // 左折
        Serial.println("Turn Left");
        leftTurn();
        running = false;
        turning = true;
        ignoringWallCheck = true;
        break;
    case 3: // 停止
        Serial.println("Stop");
        stopMotor();
        running = false;
        turning = false;
        ignoringWallCheck = true;
        // 停止時に無視フラグをどうするかは運用次第
        // 例えば false にしておけば「停止後すぐに壁が消えたら動き出す」みたいな変なことにならない
        // ここでは true にしておき「改めて前進/後退するときに壁を探し直す」動きにしている
        break;
    default:
        Serial.println("Unknown Command");
        return;
    }
}

// ==================
// モーター動作関数
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
    // その場旋回する例
    digitalWrite(m1Pin1, HIGH);
    digitalWrite(m1Pin2, LOW);
    digitalWrite(m2Pin1, HIGH);
    digitalWrite(m2Pin2, LOW);
}

void leftTurn()
{
    // その場旋回する例
    digitalWrite(m1Pin1, LOW);
    digitalWrite(m1Pin2, HIGH);
    digitalWrite(m2Pin1, LOW);
    digitalWrite(m2Pin2, HIGH);
}

void stopMotor()
{
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