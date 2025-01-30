#include <BluetoothSerial.h> // Bluetoothシリアル通信ライブラリ
BluetoothSerial SerialBT;    // Bluetoothシリアル通信のインスタンス

// ==================
// モーター制御用ピン（4ピン使用）
// ==================
const int m1Pin1 = 19;
const int m1Pin2 = 23;
const int m2Pin1 = 18;
const int m2Pin2 = 21;

// ==================
// 超音波センサ用ピン
// ==================
const int TRIG1 = 25;
const int ECHO1 = 26;
const int TRIG2 = 32;
const int ECHO2 = 33;
const int MAX_WAIT = 20000;
double sonic = 331.5 + (0.6 * 25); // 気温25℃のとき
int turnDelayTime = 1300;

// ==================
// 状態管理
// ==================
bool running = false;
bool turning = false;
bool ignoringWallCheck = true;

// ==================
// コマンド格納用
// ==================
// 例: "straight,left,straight,right" などを分割して配列に入れる
#define MAX_COMMANDS 100
String commandList[MAX_COMMANDS];
int commandCount = 0;
int currentIndex = 0;

// ==================
// プロトタイプ
// ==================
void forwardMotor();
void backwardMotor();
void rightTurnMotor();
void leftTurnMotor();
void stopMotor();
double read_distance1();
double read_distance2();
void executeCommand(const String &cmd);
void moveToNextCommandIfNeeded();

void setup()
{
    Serial.begin(115200);
    SerialBT.begin("ESP32_Motordenkouchidou");
    Serial.println("Bluetooth Serial started. Waiting for commands...");

    pinMode(m1Pin1, OUTPUT);
    pinMode(m1Pin2, OUTPUT);
    pinMode(m2Pin1, OUTPUT);
    pinMode(m2Pin2, OUTPUT);

    pinMode(TRIG1, OUTPUT);
    pinMode(ECHO1, INPUT);
    pinMode(TRIG2, OUTPUT);
    pinMode(ECHO2, INPUT);

    stopMotor();
    running = false;
    turning = false;
    ignoringWallCheck = true;

    commandCount = 0;
    currentIndex = 0;
}

void loop()
{
    // =======================
    // 1) 新しいコマンド列(一行)が届いたら受け取り、解析する
    // =======================
    if (SerialBT.available())
    {
        // 1) 新しい行を読み込む
        String line = SerialBT.readStringUntil('\n');
        line.trim();
        Serial.println("[BT] Received line:");
        Serial.println(line);

        if (line.startsWith("delay="))
        {
            String delayStr = line.substring(6); // "delay=" を除去し、数字部分を取得
            turnDelayTime = delayStr.toInt();    // 数値化して変数にセット
            Serial.print("turnDelayTime updated: ");
            Serial.println(turnDelayTime);

            // その後のパースやコマンド解析は実施しない。
            // 「delay=xxx」 は単独コマンド扱いなので return で抜ける。
            return;
        }

        // 2) stopコマンドの特例
        if (line == "stop")
        {
            stopMotor();
            running = false;
            turning = false;
            ignoringWallCheck = true;
            commandCount = 0;
            currentIndex = 0;
            return; // 関数抜け
        }

        // 3) 新しい行をパースして commandList[] を再構築
        commandCount = 0;
        currentIndex = 0;
        if (line.length() > 0)
        {
            int startIdx = 0;
            while (true)
            {
                int commaPos = line.indexOf(',', startIdx);
                if (commaPos == -1)
                {
                    // 最後の要素
                    String cmd = line.substring(startIdx);
                    cmd.trim();
                    if (cmd.length() > 0 && commandCount < MAX_COMMANDS)
                    {
                        commandList[commandCount++] = cmd;
                    }
                    break;
                }
                else
                {
                    String cmd = line.substring(startIdx, commaPos);
                    cmd.trim();
                    if (cmd.length() > 0 && commandCount < MAX_COMMANDS)
                    {
                        commandList[commandCount++] = cmd;
                    }
                    startIdx = commaPos + 1;
                }
            }
        }
        Serial.print("Parsed commandCount = ");
        Serial.println(commandCount);

        // 4) コマンド数が1以上あれば最初を実行
        if (commandCount > 0)
        {
            executeCommand(commandList[0]);
        }
    }

    // =======================
    // 2) 現在コマンドを実行中なら壁検知のチェックなどを行う
    //    （running=true && turning=false のときに壁を検知 → 壁消失したらSTOP→次コマンド）
    // =======================
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

        if (ignoringWallCheck)
        {
            // まだ壁を見つけていない状態
            if (dist1 <= 13.0 && dist2 <= 13.0)
            {
                Serial.println(">> Found the wall! ignoringWallCheck -> false");
                ignoringWallCheck = false;
            }
        }
        else
        {
            // 壁を見つけたあとは「壁が消失」(dist>30など)でストップ → 次コマンド
            if (dist1 > 25.0 || dist2 > 25.0)
            {
                Serial.println("No Wall → Stop and move to next command");
                stopMotor();
                delay(500);
                running = false;
                turning = false;
                ignoringWallCheck = true;
                moveToNextCommandIfNeeded();
            }
            else
            {
                Serial.println("Wall exist");
            }
        }
    }

    delay(200);
}

// =======================
// コマンドを実行する関数
// =======================
void executeCommand(const String &cmd)
{
    Serial.print("Execute Command: ");
    Serial.println(cmd);

    if (cmd == "straight")
    {
        forwardMotor();
        running = true;
        turning = false;
        ignoringWallCheck = true;
    }
    else if (cmd == "back")
    {
        backwardMotor();
        running = true;
        turning = false;
        ignoringWallCheck = true;
    }
    else if (cmd == "left")
    {
        leftTurnMotor();
        running = false;
        turning = true;
        ignoringWallCheck = true; // 旋回中は壁チェックしない
        delay(turnDelayTime);
        stopMotor();
        turning = false;
        ignoringWallCheck = true;

        // 次のコマンドが straight でない場合は追加する
        if (currentIndex < commandCount - 1 && commandList[currentIndex + 1] != "straight")
        {
            Serial.println("Auto-inserting 'straight' after left turn");
            commandList[currentIndex + 1] = "straight";
        }

        moveToNextCommandIfNeeded();
    }

    else if (cmd == "right")
    {
        rightTurnMotor();
        running = false;
        turning = true;
        ignoringWallCheck = true;
        delay(turnDelayTime);
        stopMotor();
        turning = false;
        ignoringWallCheck = true;

        // 次のコマンドが straight でない場合は追加する
        if (currentIndex < commandCount - 1 && commandList[currentIndex + 1] != "straight")
        {
            // Serial.println("Auto-inserting 'straight' after right turn");
            // commandList[currentIndex + 1] = "straight";
        }

        moveToNextCommandIfNeeded();
    }
    else
    {
        // "stop" など未知コマンドの場合はとりあえず停止
        stopMotor();
        running = false;
        turning = false;
        ignoringWallCheck = true;
        moveToNextCommandIfNeeded();
    }
}

// =======================
// 次のコマンドを実行する
// =======================
void moveToNextCommandIfNeeded()
{
    currentIndex++;
    if (currentIndex < commandCount)
    {
        // 次コマンドを実行
        executeCommand(commandList[currentIndex]);
    }
    else
    {
        Serial.println("All commands finished");
        // すべて終わったら念のため停止
        stopMotor();
        running = false;
        turning = false;
        ignoringWallCheck = true;
    }
}

void forwardMotor()
{
    Serial.println("Motor: Forward");
    digitalWrite(m1Pin1, LOW);
    digitalWrite(m1Pin2, HIGH);
    digitalWrite(m2Pin1, HIGH);
    digitalWrite(m2Pin2, LOW);
}

void backwardMotor()
{
    Serial.println("Motor: Backward");
    digitalWrite(m1Pin1, LOW);
    digitalWrite(m1Pin2, HIGH);
    digitalWrite(m2Pin1, HIGH);
    digitalWrite(m2Pin2, LOW);
}

void rightTurnMotor()
{
    Serial.println("Motor: RightTurn");
    // その場旋回例
    digitalWrite(m1Pin1, HIGH);
    digitalWrite(m1Pin2, LOW);
    digitalWrite(m2Pin1, HIGH);
    digitalWrite(m2Pin2, LOW);
}

void leftTurnMotor()
{
    Serial.println("Motor: LeftTurn");
    digitalWrite(m1Pin1, LOW);
    digitalWrite(m1Pin2, HIGH);
    digitalWrite(m2Pin1, LOW);
    digitalWrite(m2Pin2, HIGH);
}

void stopMotor()
{
    Serial.println("Motor: Stop");
    digitalWrite(m1Pin1, LOW);
    digitalWrite(m1Pin2, LOW);
    digitalWrite(m2Pin1, LOW);
    digitalWrite(m2Pin2, LOW);
}

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