# Diana · 雷诺曼夜沙龙 (Salon de Lenormand) — 研发交接手记 (HANDOFF)

> **交付状态**：v4 之后已完成手持牌联动与兼容性修复，当前正式站包含平面牌桌、按方向解读和完整手札。见第 4 节和第 6 节。
> **本地预览服务**：`http://127.0.0.1:8768/`
> **Cloudflare Pages 正式站**：[salon-lenormand.pages.dev](https://salon-lenormand.pages.dev/)

---

## 1. 项目定位与核心审美基线
- **项目名称**：「Diana · 雷诺曼夜沙龙」(Salon de Lenormand)
- **业务场景**：法式 36 张经典 Petit Lenormand 占卜系统。
- **主理人形象**：**Diana（主理人）**，语气松弛、体面、懂分寸、神秘女性向，拒绝一切“AI 味套话”（所有文案、解读均遵循纯正中文语感与真实人味）。
- **交互哲学**：
  - **极简少字**：除右侧深度分析界面外，前置页面极致精简，大面积留给 3D 牌桌。
  - **步进式选择题**：以「01 初识 → 02 择事 → 03 入席」全选择题引导用户，杜绝填表疲劳。
  - **Apple Design & Emil Design Engineering**：临界阻尼弹簧响应、无延迟即时按下反馈、自然气动侧倾、严禁全子树样式重算。
  - **双层视觉**：底层为全屏 Three.js 3D 皇家丝绒牌桌 + Blender 5.2 雕刻巴洛克卡牌；顶层为 2D 裸眼 3D 景深暗盒闪卡与 VisionOS 毛玻璃浮舱。

---

## 2. 核心架构与文件索引

```
salon-lenormand/
├── index.html                # 主结构：Three.js 画布、星尘层、灵动岛、引导浮舱、抽牌 HUD、3 个原生 Dialog
├── styles.css                # Apple VisionOS 材质、2D 裸眼 3D 景深暗盒、原生 Dialog Discrete 动画
├── assets/
│   ├── models/
│   │   ├── baroque_card.glb      # Blender 5.2 雕刻圆角倒角巴洛克卡牌 (含 3D 浮雕、宝石、金边)
│   │   └── salon_sculptures.glb  # 场景雕塑：三臂烛台、衔尾蛇晶球座、星盘地嵌、丝绒玫瑰
│   └── cards/
│       ├── card_back.jpg         # 皇家巴洛克牌背
│       └── plate_01.jpg ~ 09.jpg # 9 张 4 格 AI 高定 Pre-Raphaelite / Dior 风格油画
├── js/
│   ├── cards-data.js         # 36 张牌数据、引导配对 (DIANA_DEMO_PAIRS)、问题树、牌阵配置
│   ├── card-art.js           # 油画切片解析、多通道金箔/景深图动态生成、透明哥特尖拱合成
│   ├── salon-scene.js        # Three.js 核心场景：二阶弹簧、鞭打翻牌、瀑布铺扇、3D 手持把玩、零穿模
│   ├── holo-sparkle.js       # 2D 裸眼 3D 弹簧动力学 (AppleSpring)、GPU Direct Transform、仙女棒星尘
│   ├── reading-engine.js     # 雷诺曼连读逻辑：词句拆解、行动推演二选一、临别夜话 (非 AI 套话)
│   ├── sound-atelier.js      # Web Audio API 沙龙音效 (ASMR 翻牌/洗牌/晶球) + 语音轻读引擎
│   └── main.js               # 状态机中枢、步骤流转、事件监听与 2D/3D 双向联动
└── scripts/
    └── build_blender_assets.py # Blender Python 自动化几何雕刻脚本
```

---

## 3. 已完成的关键技术突破与实现细节

1. **Blender 5.2 物理建模与坐标系映射**：
   - 卡牌使用真实平滑圆角 `CORNER_R = 0.108`，导角切片 14 段，雕刻茛苕叶浮雕、七芒星冠与 36 颗微粒珍珠。
   - Blender 坐标系与 Three.js 导出对齐：卡牌在 Three.js 中以 XZ 为平面，厚度在 Y 轴，`root.rotation.order = 'YXZ'`。
   - 彻底修复 glTF UV 垂直翻转问题（Shader 传入 `uFlipV = 1.0`）。

2. **数学级零穿模地面约束与避让扇弧**：
   - 扇面展开高度随索引严格递增（步进 `0.0165`）；悬停牌抬高至 `0.78` 拔出扇面，邻牌产生高斯波浪退让 (`neighborWavePull`)。
   - 翻牌轨迹采用抛物线 (`peakY >= 1.55`)，翻转限制在飞行区间 `[0.16, 0.80]` 内。
   - 每一帧严格执行碰撞盒地面防贯穿硬约束：
     `c.mesh.position.y >= |sin(rz)| * 0.52 + |sin(rx)| * 0.52 + 0.016`。

3. **物理动效升级 (v4)**：
   - 从一阶指数 lerp 全面升级为**二阶带初速度的衰减弹簧 (`stepSpringScalar`)**。
   - 加入滑行**气动侧倾 (`bankZ`, `bankX`)** 与落地丝绒速度缓冲交接。
   - 加入局部 3D 磁吸追光倾斜 (`localMagneticRx`, `localMagneticRz`)。
   - 翻牌过程加入 3D 空中流金彗尾微粒与触碰丝绒瞬间扩散的金色光环涟漪 (`landingRipples`)。
   - 洗牌后加入荷官瀑布铺扇级联动效 (`fanOutForPicking(true)`)。
   - 增加了 **3D 实体牌手持近景把玩模式 (`toggleInspect3DCard`)**：点击桌面上已翻开的 3D 卡牌，可直接将卡牌托举至相机正前方，随鼠标大幅度倾斜检视高定浮雕与镭射反光。

4. **2D 裸眼 3D 景深暗盒与 Emil 性能优化**：
   - `holo-sparkle.js` 中直接操作各图层 GPU `style.transform` 字符串，彻底避免在父级修改 CSS 变量导致 36 张卡牌全子树重新样式计算。
   - 鼠标悬停支持与 `@media (hover: hover) and (pointer: fine)` 深度绑定。

---

## 4. 交接后的进展

1. `onInspect3DChange` 控制手持牌的胶囊和底层面板。「查看牌义」打开原生单牌详览，关闭详览后回到手持状态。`Escape` 优先关闭打开的弹窗，再按一次放回牌。
2. 牌典按 `--stagger-idx` 错峰淡入，最多错开 168 ms。系统减少动态效果或沙龙内暂停微动效时跳过入场动画。
3. 手机挑牌见第 8 节。拖动手持牌可看光泽。近看按可用视区缩放，解读面板为移动端牌阵留出触控空间。触屏设备的 WebGL 渲染倍率上限为 1.25，持续掉帧时降低牌桌分辨率，帧间隔稳定后再逐步恢复。页面退到后台时停帧，上下文恢复后重新烘焙环境光，保留当前牌阵与手持状态。

本地已用 Chrome 桌面、Chrome 触屏模拟和移动尺寸 WebKit 检查抽牌、手持、牌典与 WebGL 上下文恢复。九宫阵在 320 × 568、390 × 664 与 844 × 390 的 WebKit 视口检查了牌面触控位置。iPhone Safari 真机手感和视觉验收待确认。

吉普赛大牌阵 (Grand Tableau) 仍是待办，涉及 36 张全铺的鸟瞰视角与相机巡游轨道。

---

## 5. 本地调试与运行命令
- 在项目根目录启动本地服务：`python3 -m http.server 8768 --bind 127.0.0.1`
- 浏览器打开：`http://127.0.0.1:8768/`

正式站使用 Cloudflare Pages Direct Upload，项目名为 `salon-lenormand`，生产分支为 `main`。发布目录包含 `index.html`、`styles.css`、`404.html`、`favicon.ico`、`share-cover.jpg`、`_headers`、`js/`、`vendor/`，以及 `assets/art/`、`assets/deck/`、`assets/models/`、`assets/fonts/`。执行 `wrangler pages deploy <发布目录> --project-name=salon-lenormand --branch=main`。

## 6. 兼容性与数据维护

- 平面牌桌和界面先启动，随后尝试加载同源 Three.js r170。三维不可用时保留选题、点选、直抽、牌义、解读和手札。当前一局使用起局时的牌桌，空闲时可重试三维。
- 选题方向随本局传入解读引擎。洗牌和发牌计时器跟随当前轮次，抽牌快捷键只在三维画布聚焦时生效。
- 手札继续使用原本的本地存储键，旧记录可查看摘要并编辑小记，新记录可打开原局和导出 JSON。存储写入成功后才更新按钮状态。保留条数取决于浏览器的存储空间。
- 单张牌面和 3D 共用图集在 `assets/deck/`。平面牌桌按需加载单张图片，图片下载失败时保留编号和牌名。三维牌桌启动后使用共用图集，近看时加载清晰版，返回时释放独占纹理。原始 JPEG 保存在 `assets/cards/`。
- 本地已跑通桌面 Chrome 三维抽牌、禁用 WebGL 的 Chrome 和移动尺寸 WebKit。短屏验证覆盖 320 × 568 和 667 × 375 的键盘视区模拟。820 × 1180 的 WebKit 三维九宫阵九张牌均可触达。iPhone Safari 软键盘和微信内置浏览器待真机核验。


## 7. 牌面与帧时间

`scripts/bake-card-art.mjs` 可在项目根目录配合本地 HTTP 服务、Playwright、Chrome 和 `cwebp` 重新生成牌面。运行 `node scripts/bake-card-art.mjs http://127.0.0.1:8768/` 后，将输出的版本号同步到 `js/card-art.js` 和 `_headers`。

同一 390 × 664 的 WebKit 测试中，打开牌典后的 Canvas 像素缓冲估算从约 297 MB 降至 10.5 MB。扇面的绘制调用从 907 降至 205 次/帧，三角形从约 156 万降至 3.7 万/帧。叠放和未翻开的牌使用简化边框，翻开和近看保留雕刻。翻牌位置曲线、二维弹簧及镭射纹理的采样已调整，以减少跳动和高频闪烁。

验收核对了 36 张单图与图集的对应关系，在限制 Canvas 像素分配的浏览器环境中连续完成四局九宫阵，并阻断月亮牌的高清图片验证降级显示。

## 8. 手机挑牌

- 两种牌桌共用 `js/fan-touch.js` 的手机手牌。洗好的 36 张暗牌分六组展示，01–36 是本局固定的桌面位置。轻点抬牌，再点收回。横划按经过的顺序连选，回划会缩短选区，取消触摸会恢复起手前的选择。
- 翻组保留已选的牌，数量以剩余牌位为限。确认后按点选顺序翻开，牌组通过本局固定位置查找原来的牌。洗牌、离开牌阵和重开一局都会使旧的发牌回调失效。
- 触屏三维牌桌把尚未翻面的牌背和金边各合并为一批绘制。每张牌仍有独立的命中区域和弹簧，翻面与近看继续使用原模型。390 × 664 的 WebKit 三牌阵静止扇面测试中，主画面绘制调用从 117 降至 11 次/帧。
- 平面牌桌保留洗牌铺扇、抬牌和翻转入位。系统减少动态效果或用户暂停动效后，选牌可直接入位。单牌详览支持横向拖动看牌面光泽，竖滑阅读牌义。
