#include <BluetoothSerial.h>  // Bluetoothシリアル通信ライブラリ
BluetoothSerial SerialBT;  // Bluetoothシリアル通信のインスタンス作成

const int ledPins[] = {0, 2,  4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26}; // 使用するピン番号
const int numLeds = sizeof(ledPins) / sizeof(ledPins[0]); // ピン数を計算

// 現在のLEDの状態を記録
bool ledStates[numLeds] = {false};

void setup() {
  SerialBT.begin("ESP32_LED_Control_1");
  Serial.begin(115200);  // シリアルモニタ用の通信速度を設定

  // すべてのピンを出力モードに設定し、初期状態を消灯
  for (int i = 0; i < numLeds; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW);
  }

  Serial.println("ESP32 is ready to receive signals!");
}

void loop() {
  // Bluetooth経由で信号を受信
  if (SerialBT.available()) {
    String input = SerialBT.readStringUntil('\n'); // 信号を1行分受信
    input.trim(); // 不要な空白や改行を削除

    // RESET信号の処理
    if (input.equalsIgnoreCase("RESET")) {
      resetAllLeds();
    } else {
      // 通常の信号の処理
      handleSignal(input);
    }
  }
}

void handleSignal(String input) {
  // 受信した信号をカンマで分割
  int startIndex = 0;
  while (startIndex < input.length()) {
    int commaIndex = input.indexOf(',', startIndex); // 次のカンマの位置を探す

    if (commaIndex == -1) { // カンマが見つからなかった場合（最後の数字）
      commaIndex = input.length();
    }

    // 信号の番号を抽出
    String signalStr = input.substring(startIndex, commaIndex);
    int signal = signalStr.toInt(); // 数値に変換

    // 信号が有効な範囲であれば対応するLEDを点灯
    if (signal >= 1 && signal <= numLeds) {
      int ledIndex = signal - 1; // 信号番号に対応するインデックス（0始まり）
      ledStates[ledIndex] = true; // 状態を記録
      digitalWrite(ledPins[ledIndex], HIGH); // LEDを点灯
    }

    // 次の信号に進む
    startIndex = commaIndex + 1;
  }
}

void resetAllLeds() {
  // すべてのLEDを消灯
  for (int i = 0; i < numLeds; i++) {
    digitalWrite(ledPins[i], LOW);
    ledStates[i] = false; // 状態をリセット
  }
  Serial.println("All LEDs have been reset.");
}
