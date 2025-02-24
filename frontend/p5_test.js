// p5_test.js

let nodes = [];          // ノード情報を管理
let obstacles = [];      // 障害物情報を管理
let startNode = null;    // スタートノード
let goalNode = null;     // ゴールノード
let startNodeLabel = null;
let goalNodeLabel = null;
let startSelected = false;
let goalSelected = false;
let obstacleConfirmed = false;
let confirmButton;       // 「スタート確定」ボタン
let backButton;          // 「戻る」ボタン
let selectedEdges = [];  // 選択されたエッジ一覧

// 受信した経路（既定経路）
let receivedPath = null;

// 複数候補の経路情報
let candidatePaths = [];
let candidateEdges = [];
let EdgesWeight = [];

// 候補経路選択用UI部品（線モード用）
let candidateConfirmButton;
let selectedCandidateIndex = -1;  // 未選択

// ボタンモード用UI部品（今回はモーダルとして実装）
let candidateModalDiv = null;
let candidateRouteButtons = []; // 各候補のボタン群
let candidateConfirmButtonBtn;  // モーダル内の候補確定ボタン

// WebSocketオブジェクト
let ws;

// カラーパレット（パステル調、黄色は除く）
let candidatePalette = [
    '#ff9999', // パステルレッド
    '#99ff99', // パステルグリーン
    '#99ccff', // パステルブルー
    '#ffcc99', // パステルオレンジ
    '#ff99ff', // パステルマゼンタ
    '#99ffff', // パステルシアン
    '#ffccff', // パステルピンク
    '#ccffcc', // パステルミント
    '#ccccff'  // パステルパープル
];

// 選択モード（"line" or "button"）
let selectionMode = "line";
let toggleModeButton;

function setup() {
    // コンテナ内にキャンバス（700×800）を作成。キャンバス部分は700×700にする。
    let cnv = createCanvas(700, 700);
    cnv.parent("container");

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
            } else if (msg.candidate_paths) {
                console.log('受信した候補経路群:', msg.candidate_paths);
                candidatePaths = msg.candidate_paths;
                candidateEdges = msg.candidate_edges;
                if (candidatePaths.length === 1) {
                    selectedCandidateIndex = 0;
                    receivedPath = candidatePaths[0];
                    console.log("候補経路が一個だけなので自動確定:", receivedPath);
                    setTimeout(confirmCandidateSelection, 100);
                } else {
                    if (selectionMode === "line") {
                        createCandidateSelectionUI();
                    } else {
                        createCandidateModalUI();
                    }
                }
            } else if (msg.path) {
                console.log('受信した経路:', msg.path);
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

    // ===== UIボタンの設定（UIエリア：下部100px内に配置） =====
    confirmButton = createButton('スタート確定');
    confirmButton.parent("container");
    confirmButton.position(10, 710);  // UIエリア内
    confirmButton.mousePressed(confirmSelection);

    backButton = createButton('戻る');
    backButton.parent("container");
    backButton.position(120, 710);
    backButton.mousePressed(goBack);

    // 選択モード切替ボタンを、UIエリアの右側に配置
    // toggleModeButtonの設定部分を修正
    toggleModeButton = createButton("選択モード: 線");
    toggleModeButton.parent("container");
    toggleModeButton.position(600, 710);
    // ここで、固定配置とz-indexを設定
    toggleModeButton.style('position', 'fixed');
    toggleModeButton.style('z-index', '1000');
    toggleModeButton.mousePressed(toggleSelectionMode);

    // ===== ノード＆障害物の初期化 =====
    initializeNodes();
    initializeObstacles();
}

function toggleSelectionMode() {
    if (selectionMode === "line") {
        selectionMode = "button";
        toggleModeButton.html("選択モード: ボタン");
        if (candidateConfirmButton) {
            candidateConfirmButton.remove();
            candidateConfirmButton = null;
        }
        if (candidatePaths.length > 0) {
            createCandidateModalUI();
        }
    } else {
        selectionMode = "line";
        toggleModeButton.html("選択モード: 線");
        if (candidateModalDiv) {
            candidateModalDiv.remove();
            candidateModalDiv = null;
            candidateRouteButtons = [];
        }
        if (candidatePaths.length > 0) {
            createCandidateSelectionUI();
        }
    }
}

function createCandidateSelectionUI() {
    // 線モードの場合の候補確定ボタン（既存の方法）
    if (candidateConfirmButton) candidateConfirmButton.remove();
    candidateConfirmButton = createButton("候補経路を確定");
    candidateConfirmButton.parent("container");
    candidateConfirmButton.position(300, 750);
    candidateConfirmButton.mousePressed(confirmCandidateSelection);
}

function createCandidateModalUI() {
    // ボタンモード用のモーダルオーバーレイを作成
    if (candidateModalDiv) candidateModalDiv.remove();
    candidateModalDiv = createDiv();
    candidateModalDiv.parent("container");
    // モーダルオーバーレイ設定：コンテナ全体を覆う
    candidateModalDiv.style('position', 'absolute');
    candidateModalDiv.style('top', '0');
    candidateModalDiv.style('left', '0');
    candidateModalDiv.style('width', '700px');
    candidateModalDiv.style('height', '800px');
    candidateModalDiv.style('background-color', 'rgba(0,0,0,0.5)');
    candidateModalDiv.style('display', 'flex');
    candidateModalDiv.style('justify-content', 'center');
    candidateModalDiv.style('align-items', 'center');

    // モーダル内コンテンツ
    let modalContent = createDiv();
    modalContent.parent(candidateModalDiv);
    modalContent.style('background-color', '#fff');
    modalContent.style('padding', '20px');
    modalContent.style('border', '1px solid #000');
    modalContent.style('max-width', '600px');
    modalContent.style('max-height', '600px');
    modalContent.style('overflow-y', 'auto');
    modalContent.html("");

    // 候補ルートボタン群用のコンテナ（flexレイアウトで横並び、折り返し可能）
    let buttonsContainer = createDiv();
    buttonsContainer.parent(modalContent);
    buttonsContainer.style('display', 'flex');
    buttonsContainer.style('flex-direction', 'row');
    buttonsContainer.style('flex-wrap', 'wrap');
    buttonsContainer.style('gap', '10px');
    buttonsContainer.style('justify-content', 'center');
    buttonsContainer.style('margin-bottom', '20px');

    candidateRouteButtons = []; // 初期化
    for (let i = 0; i < candidatePaths.length; i++) {
        let path = candidatePaths[i];
        let btn = createButton("経路 " + (i + 1) + ": " + path.join(" → "));
        btn.parent(buttonsContainer);
        // 各ボタンの最大幅を設定
        btn.style('max-width', '150px');
        btn.style('white-space', 'nowrap');
        btn.style('overflow', 'hidden');
        btn.style('text-overflow', 'ellipsis');
        btn.style('margin', '2px');
        btn.mousePressed(() => {
            selectedCandidateIndex = i;
            receivedPath = candidatePaths[i];
            console.log("ボタンで候補経路を選択:", receivedPath);
            // 全ボタン背景リセット
            for (let j = 0; j < candidateRouteButtons.length; j++) {
                candidateRouteButtons[j].style('background-color', '#fff');
            }
            btn.style('background-color', '#ddd');
        });
        candidateRouteButtons.push(btn);
    }
    // 候補確定ボタンはモーダル内の固定位置に配置（例：下部中央）
    candidateConfirmButtonBtn = createButton("候補経路を確定");
    candidateConfirmButtonBtn.parent(modalContent);
    candidateConfirmButtonBtn.style('margin-top', '10px');
    candidateConfirmButtonBtn.mousePressed(() => {
        if (selectedCandidateIndex === -1) {
            alert("候補経路が選択されていません。");
            return;
        }
        confirmCandidateSelection();
        candidateModalDiv.remove();
        candidateModalDiv = null;
        candidateRouteButtons = [];
    });
}

function draw() {
    background(255);
    // キャンバス部分（700×700）の描画
    stroke(0);
    strokeWeight(2);
    noFill();
    rect(0, 0, 700, 700);
    drawWalls();
    drawObstacles();
    drawNodes();

    // 候補経路の描画（線モードの場合のみ）
    if (selectionMode === "line" && candidatePaths.length > 0) {
        for (let i = 0; i < candidatePaths.length; i++) {
            let path = candidatePaths[i];
            let selected = (i === selectedCandidateIndex);
            let candidateLineThickness = selected ? 5 : 3;
            let outlineThickness = candidateLineThickness + 2;
            // 黒い枠線（アウトライン）
            stroke('black');
            strokeWeight(outlineThickness);
            noFill();
            for (let j = 0; j < path.length - 1; j++) {
                const labelA = path[j];
                const labelB = path[j + 1];
                const n1 = nodes.find(n => n.label === labelA);
                const n2 = nodes.find(n => n.label === labelB);
                if (n1 && n2) {
                    line(n1.x, n1.y, n2.x, n2.y);
                }
            }
            // 内部の線をパステルカラーで描画
            let routeColor = candidatePalette[i % candidatePalette.length];
            stroke(routeColor);
            strokeWeight(candidateLineThickness);
            noFill();
            for (let j = 0; j < path.length - 1; j++) {
                const labelA = path[j];
                const labelB = path[j + 1];
                const n1 = nodes.find(n => n.label === labelA);
                const n2 = nodes.find(n => n.label === labelB);
                if (n1 && n2) {
                    line(n1.x, n1.y, n2.x, n2.y);
                }
            }
        }
    }

    // 最終決定された経路の強調表示（内側は黄色、外枠は黒）
    if (receivedPath && receivedPath.length > 1) {
        // 黒いアウトライン
        stroke('black');
        strokeWeight(7);
        noFill();
        for (let i = 0; i < receivedPath.length - 1; i++) {
            const labelA = receivedPath[i];
            const labelB = receivedPath[i + 1];
            const n1 = nodes.find(n => n.label === labelA);
            const n2 = nodes.find(n => n.label === labelB);
            if (n1 && n2) {
                line(n1.x, n1.y, n2.x, n2.y);
            }
        }
        // 黄色の内部線
        stroke('yellow');
        strokeWeight(5);
        noFill();
        for (let i = 0; i < receivedPath.length - 1; i++) {
            const labelA = receivedPath[i];
            const labelB = receivedPath[i + 1];
            const n1 = nodes.find(n => n.label === labelA);
            const n2 = nodes.find(n => n.label === labelB);
            if (n1 && n2) {
                line(n1.x, n1.y, n2.x, n2.y);
            }
        }
    }
}

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
        const n1 = nodes.find(n => n.label === node1);
        const n2 = nodes.find(n => n.label === node2);
        const midX = (n1.x + n2.x) / 2;
        const midY = (n1.y + n2.y) / 2;
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

function drawNodes() {
    textAlign(CENTER, CENTER);
    textSize(20);
    for (let node of nodes) {
        if (node === startNode) {
            fill('#32CD32');
        } else if (node === goalNode) {
            fill('#FFA500');
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

// 候補経路の線がクリックされたか判定する関数
function candidatePathClicked() {
    let threshold = 5;
    for (let i = 0; i < candidatePaths.length; i++) {
        let path = candidatePaths[i];
        for (let j = 0; j < path.length - 1; j++) {
            let labelA = path[j];
            let labelB = path[j + 1];
            let n1 = nodes.find(n => n.label === labelA);
            let n2 = nodes.find(n => n.label === labelB);
            if (n1 && n2) {
                let d = distToSegment(mouseX, mouseY, n1.x, n1.y, n2.x, n2.y);
                if (d < threshold) {
                    return i;
                }
            }
        }
    }
    return -1;
}

// クリック位置と線分の距離を計算する関数
function distToSegment(px, py, x1, y1, x2, y2) {
    let A = px - x1;
    let B = py - y1;
    let C = x2 - x1;
    let D = y2 - y1;
    let dot = A * C + B * D;
    let len_sq = C * C + D * D;
    let param = len_sq !== 0 ? dot / len_sq : -1;
    let xx, yy;
    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }
    let dx = px - xx;
    let dy = py - yy;
    return sqrt(dx * dx + dy * dy);
}

function confirmCandidateSelection() {
    if (selectedCandidateIndex === -1) {
        alert("候補経路が選択されていません。");
        return;
    }
    let selectedPath = candidatePaths[selectedCandidateIndex];
    console.log("ユーザーが確定した候補経路:", selectedPath);
    ws.send(JSON.stringify({ selected_path: selectedPath }));
    candidatePaths = [];
    candidateEdges = [];
    if (candidateModalDiv) {
        candidateModalDiv.remove();
        candidateModalDiv = null;
        candidateRouteButtons = [];
    }
}

function mousePressed() {
    if (selectionMode === "line" && candidatePaths.length > 0) {
        let index = candidatePathClicked();
        if (index !== -1) {
            selectedCandidateIndex = index;
            receivedPath = candidatePaths[index];
            console.log("線クリックで候補経路を選択:", receivedPath);
            return;
        }
    }
    if (!startSelected) {
        for (let node of nodes) {
            if (dist(mouseX, mouseY, node.x, node.y) < 25) {
                startNode = node;
                startNodeLabel = node.label;
                alert(node.label + " をスタートに設定");
                break;
            }
        }
    } else if (!goalSelected) {
        for (let node of nodes) {
            if (dist(mouseX, mouseY, node.x, node.y) < 25) {
                goalNode = node;
                goalNodeLabel = node.label;
                alert(node.label + " をゴールに設定");
                break;
            }
        }
    } else if (!obstacleConfirmed) {
        for (let o of obstacles) {
            if (dist(mouseX, mouseY, o.x, o.y) < 15) {
                o.selected = !o.selected;
                updateSelectedEdges();
                break;
            }
        }
    }
}

function updateSelectedEdges() {
    selectedEdges = obstacles.filter(o => o.selected).map(o => `${o.node1}-${o.node2}`);
    console.log('選択されたエッジ:', selectedEdges);
}

function confirmSelection() {
    if (!startSelected) {
        startSelected = true;
        confirmButton.html('ゴール確定');
    } else if (!goalSelected) {
        goalSelected = true;
        confirmButton.html('障害物確定');
    } else if (!obstacleConfirmed) {
        obstacleConfirmed = true;
        confirmButton.html('確定済み');
        console.log('最終的に選択されたエッジ(削除):', selectedEdges);
        let dataToSend = {
            start: startNodeLabel,
            goal: goalNodeLabel,
            remove_edges: selectedEdges
        };
        ws.send(JSON.stringify(dataToSend));
        console.log('サーバに送信:', dataToSend);
    }
}

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