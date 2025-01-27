// p5_test.js

let nodes = [];          // ノード情報をグローバルで管理
let obstacles = [];      // 中継点(障害物)の情報をグローバルで管理
let startNode = null;    // スタートのノード
let goalNode = null;     // ゴールのノード
let startNodeLabel = null;
let goalNodeLabel = null;
let startSelected = false;
let goalSelected = false;
let obstacleConfirmed = false;
let confirmButton;       // 「スタート確定」などのボタン
let backButton;          // 「戻る」ボタン
let selectedEdges = [];  // 選択されたエッジの一覧 ("v1-v2"など)

// ★ 受信した経路を保持するための変数
let receivedPath = null;

// WebSocket オブジェクト
let ws;

function setup() {
    createCanvas(700, 700);

    // ===== WebSocket 接続 =====
    ws = new WebSocket('ws://localhost:8765');

    ws.onopen = (event) => {
        console.log('WebSocket 接続成功');
    };
    ws.onmessage = (event) => {
        console.log('サーバからのメッセージ:', event.data);
        try {
            const msg = JSON.parse(event.data);
            if (msg.error) {
                console.error('サーバからエラー:', msg.error);
            } else if (msg.path) {
                console.log('受信した経路:', msg.path);
                // 受信した経路を変数に保持
                receivedPath = msg.path;
            }
        } catch (e) {
            console.error('メッセージのパースに失敗:', e);
        }
    };
    ws.onclose = (event) => {
        console.log('WebSocket 接続が閉じられました');
    };
    ws.onerror = (error) => {
        console.error('WebSocket エラー:', error);
    };

    // ===== GUI ボタンの設定 =====
    confirmButton = createButton('スタート確定')
        .position(10, 710)
        .mousePressed(confirmSelection);

    backButton = createButton('戻る')
        .position(110, 710)
        .mousePressed(goBack);

    // ===== ノード＆障害物の初期化 =====
    initializeNodes();
    initializeObstacles();
}

function draw() {
    background(255);

    // 外枠
    stroke(0);
    strokeWeight(2);
    noFill();
    rect(0, 0, 700, 700);

    // 壁の描画
    drawWalls();

    // 中継点の障害物
    drawObstacles();

    // ノードの描画
    drawNodes();

    // ------------------------------
    // ★ 受信した経路を線で描画
    // ------------------------------
    if (receivedPath && receivedPath.length > 1) {
        stroke('yellow');
        strokeWeight(5);
        noFill();
        // 経路配列 (['v4','v3','v2',...,'v9'] など) を順番に線で結ぶ
        for (let i = 0; i < receivedPath.length - 1; i++) {
            const labelA = receivedPath[i];
            const labelB = receivedPath[i + 1];
            // ラベルからノードオブジェクトを検索
            const n1 = nodes.find(n => n.label === labelA);
            const n2 = nodes.find(n => n.label === labelB);
            if (n1 && n2) {
                line(n1.x, n1.y, n2.x, n2.y);
            }
        }
    }
}

// ------------------------------
// 壁(矩形)の描画
// ------------------------------
function drawWalls() {
    fill(0);
    noStroke();
    let walls = [
        { x: 75, y: 75, w: 100, h: 100 },
        { x: 75, y: 225, w: 100, h: 400 },
        { x: 225, y: 75, w: 100, h: 100 },
        { x: 225, y: 525, w: 250, h: 100 },
        { x: 225, y: 225, w: 100, h: 250 },
        { x: 375, y: 225, w: 250, h: 250 },
        { x: 375, y: 75, w: 100, h: 100 },
        { x: 525, y: 75, w: 100, h: 100 },
        { x: 525, y: 525, w: 100, h: 100 }
    ];
    for (let wall of walls) {
        rect(wall.x, wall.y, wall.w, wall.h);
    }
}

// ------------------------------
// ノードの初期化 (固定座標)
// ------------------------------
function initializeNodes() {
    nodes = [
        { x: 50, y: 50, label: "v0" },
        { x: 200, y: 50, label: "v1" },
        { x: 350, y: 50, label: "v2" },
        { x: 500, y: 50, label: "v3" },
        { x: 650, y: 50, label: "v4" },
        { x: 50, y: 200, label: "v5" },
        { x: 200, y: 200, label: "v6" },
        { x: 350, y: 200, label: "v7" },
        { x: 500, y: 200, label: "v8" },
        { x: 650, y: 200, label: "v9" },
        { x: 200, y: 500, label: "v10" },
        { x: 350, y: 500, label: "v11" },
        { x: 500, y: 500, label: "v12" },
        { x: 650, y: 500, label: "v13" },
        { x: 50, y: 650, label: "v14" },
        { x: 200, y: 650, label: "v15" },
        { x: 500, y: 650, label: "v16" },
        { x: 650, y: 650, label: "v17" }
    ];
}

// ------------------------------
// エッジ中点(障害物)の初期化
// ------------------------------
function initializeObstacles() {
    const edges = [
        ['v0', 'v1'], ['v0', 'v5'], ['v1', 'v2'], ['v1', 'v6'],
        ['v2', 'v3'], ['v2', 'v7'], ['v3', 'v4'], ['v3', 'v8'],
        ['v4', 'v9'], ['v5', 'v6'], ['v5', 'v14'], ['v6', 'v7'],
        ['v6', 'v10'], ['v7', 'v8'], ['v7', 'v11'], ['v8', 'v9'],
        ['v9', 'v13'], ['v10', 'v11'], ['v10', 'v15'],
        ['v11', 'v12'], ['v12', 'v13'], ['v12', 'v16'],
        ['v13', 'v17'], ['v14', 'v15'], ['v15', 'v16'], ['v16', 'v17']
    ];

    obstacles = edges.map(([node1, node2]) => {
        const n1pos = nodes.find(n => n.label === node1);
        const n2pos = nodes.find(n => n.label === node2);
        const midX = (n1pos.x + n2pos.x) / 2;
        const midY = (n1pos.y + n2pos.y) / 2;
        return {
            x: midX,
            y: midY,
            node1,
            node2,
            selected: false
        };
    });
}

function drawObstacles() {
    for (let o of obstacles) {
        fill(o.selected ? '#FF0000' : '#969696');
        stroke(0);
        strokeWeight(2);
        ellipse(o.x, o.y, 30, 30);
    }
}

// ------------------------------
// ノードを描画
// ------------------------------
function drawNodes() {
    textAlign(CENTER, CENTER);
    textSize(20);

    for (let node of nodes) {
        if (node === startNode) {
            fill('#32CD32'); // スタートノードは緑
        } else if (node === goalNode) {
            fill('#FFA500'); // ゴールノードはオレンジ
        } else {
            fill(255);
        }
        stroke(0);
        strokeWeight(2);
        ellipse(node.x, node.y, 50, 50);

        fill(0);
        noStroke();
        text(node.label, node.x, node.y);
    }
}

// ------------------------------
// マウスクリックで start/goal/障害物 を設定
// ------------------------------
function mousePressed() {
    // スタート未確定
    if (!startSelected) {
        for (let node of nodes) {
            if (dist(mouseX, mouseY, node.x, node.y) < 25) {
                startNode = node;
                startNodeLabel = node.label;
                alert(node.label + " をスタートに設定");
                break;
            }
        }
    }
    // ゴール未確定 (スタートは確定済み)
    else if (!goalSelected) {
        for (let node of nodes) {
            if (dist(mouseX, mouseY, node.x, node.y) < 25) {
                goalNode = node;
                goalNodeLabel = node.label;
                alert(node.label + " をゴールに設定");
                break;
            }
        }
    }
    // スタート＆ゴール確定済み → エッジ中点をクリックして障害物(削除エッジ)選択
    else if (!obstacleConfirmed) {
        for (let o of obstacles) {
            if (dist(mouseX, mouseY, o.x, o.y) < 15) {
                o.selected = !o.selected; // 選択切り替え
                updateSelectedEdges();
                break;
            }
        }
    }
}

// ------------------------------
// 選択中エッジの更新
// ------------------------------
function updateSelectedEdges() {
    selectedEdges = obstacles
        .filter(o => o.selected)
        .map(o => `${o.node1}-${o.node2}`);
    console.log('選択されたエッジ:', selectedEdges);
}

// ------------------------------
// 確定ボタン押下
// ------------------------------
function confirmSelection() {
    if (!startSelected) {
        // スタートの確定
        startSelected = true;
        confirmButton.html('ゴール確定');
    }
    else if (!goalSelected) {
        // ゴールの確定
        goalSelected = true;
        confirmButton.html('障害物確定');
    }
    else if (!obstacleConfirmed) {
        // 障害物(エッジ)選択の確定
        obstacleConfirmed = true;
        confirmButton.html('確定済み');

        console.log('最終的に選択されたエッジ(削除):', selectedEdges);

        // 「削除したいエッジ」としてサーバに送信
        let dataToSend = {
            start: startNodeLabel,
            goal: goalNodeLabel,
            remove_edges: selectedEdges
        };
        ws.send(JSON.stringify(dataToSend));
        console.log('サーバに送信:', dataToSend);
    }
}

// ------------------------------
// 戻るボタン押下
// ------------------------------
function goBack() {
    if (obstacleConfirmed) {
        obstacleConfirmed = false;
        confirmButton.html('障害物確定');
    } else if (goalSelected) {
        goalSelected = false;
        goalNode = null;
        goalNodeLabel = null;
        confirmButton.html('ゴール確定');
    } else if (startSelected) {
        startSelected = false;
        startNode = null;
        startNodeLabel = null;
        confirmButton.html('スタート確定');
    }
}
