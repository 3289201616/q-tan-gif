# Q弹动图生成器 · Q-TAN GIF LAB

一个可以直接发布到 **B站 Toy** 的网页工具：导入图片或 3D 模型，做成一上一下伸缩的 Q 弹动图，导出一张无限循环、首尾无缝的 GIF。

## 功能

- **图片 Q 弹**：上传 PNG / JPG / WebP 后裁剪、缩放；透明图片会自动去掉多余透明边。主体底部固定，顶部上下伸缩，支持压扁回弹、节奏、左右摇摆与果冻胶状。默认上下伸缩 100、压扁 100、节奏 2×、摇摆 0、胶状 0；滑杆上限已扩展到 300（节奏最高 6×）。
- **3D 模型**：支持 `GLB / GLTF / FBX / OBJ / STL / PLY / 3MF / DAE / 3DS / USDZ`，支持模型 + 贴图多选，也支持直接拖入 ZIP。载入后自动居中、贴地，左右拖动可 360° 环视；自动 360° 旋转默认开启，旋转速度可选 1–6 圈/循环，并在右侧调整或关闭。
- **MC 玩偶**：拖入一张 Minecraft 皮肤（64×64 / 64×32 / HD / 1.7 老皮肤），直接生成坐姿玩偶并开始 Q 弹。细胳膊（Alex）和经典（Steve）两套体型；64×32 的老皮肤会按官方规则自动镜像补出左臂左腿。玩偶和 3D 模型共用同一套伸缩、摇摆、旋转与投影。
- **背景**：白色 / 镂空透明 / 上传背景图（可裁剪）。导出会带上当前背景。
- **无缝 GIF**：默认 25 fps、2 秒、50 帧；所有运动按完整周期计算，最后一帧自然接回第一帧。GIF 在 Web Worker 中调色、装帧，导出后有二次预览。
- **音乐**：进入页面自动尝试播放《邦友的酒》；浏览器拦截声音时先静音自动播放，首次点击任意处开启声音。右上角唱片按钮可打开完整播放器（进度、播放/暂停、音量、循环、视频背景开关）。**视频背景只在音乐播放时播放。**
- **视频背景**：竖屏时以视频最右端为基准向左延伸；可一键关闭，切换为白色背景。
- **次数**：新用户 947 次，每次成功导出 GIF 扣 1 次；关注 UP 主并通过 B站官方关注关系校验后解锁无限次数。说明和领取按钮位于剩余次数下方，领取成功后自动收起。
- **云存档**：启动时通过 Toy 官方 `getCloudStorage` 自动同步次数/无限状态，导出、领取、页面隐藏等关键节点写入，不做轮询。
- **响应式**：横屏、竖屏、桌面三栏与移动端单栏布局均可用，并处理 Toy 容器安全区。
- **B站官方 SDK**：`toy.isSupport / getCloudStorage / setCloudStorage / getAuthorRelation / getAuthorProfile / navigate / saveImageToAlbum / share / getContainerState / onContainerChange`。没有使用任何非官方 B站接口。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5178/`。

> 本地开发时页面会显示「本地预览」徽标。此时关注领取是模拟的，云存档不会写入，便于界面测试；在 `bilibili.com/toy/<slug>/` 下会自动切换为真实 SDK 校验。

## 构建与发布

```bash
npm run build
```

产物在 `dist/`，资源路径已使用相对路径（`base: './'`），入口 `index.html` 约 42 KB。

用 B站官方 Toy CLI 发布（本机已装在 `.toy-bin/toy.exe`，重开终端后也可直接用 `toy`）：

```powershell
# 首次使用先登录（会打开 B站 OAuth）
.\.toy-bin\toy.exe login

# 先上传并生成预览链接，不提交审核
.\.toy-bin\toy.exe create dist --title "Q弹动图生成器" --slug q-tan-gif --category TOOL `
  --poster publish/poster-public.jpg --icon publish/icon.png --theme light

# 检查预览链接后，再按同一组参数加 --yes 提交审核
.\.toy-bin\toy.exe create dist --title "Q弹动图生成器" --slug q-tan-gif --category TOOL `
  --poster publish/poster-public.jpg --icon publish/icon.png --theme light --yes
```

## 当前发布状态

- Toy ID：`46313840312320`
- 状态：已发布 / 公开（`PUBLIC`）
- 地址：https://www.bilibili.com/toy/q-tan-gif/index.html
- 封面：`publish/poster-public.jpg`（用户提供的 1024×1024 图）
- 分类：`TOOL`

发布前可跑官方内容预检：

```bash
python .toy-skill/toy_doctor.py dist --json
```

当前预检结果为 `ok: true`。

## 目录

```
index.html              页面结构
src/main.js             交互、导入、导出、次数与关注逻辑
src/scene.js            WebGL 图片/3D 舞台与上下伸缩动画
src/doll.js             MC 皮肤 → 玩偶模型（Bedrock 逐面 UV 解析）
src/geo/                玩偶骨骼（细胳膊 / 经典）
src/model-loader.js     多格式模型加载与 ZIP 解包
src/crop-tool.js        图片 / 背景裁剪
src/gif-export.js       帧渲染与 GIF 编码调度
src/gif-worker.js       GIF 调色、透明通道与装帧 Worker
src/toy-bridge.js       B站 Toy 官方 SDK 适配层
src/quota.js            947 次 / 无限次数 / 云存档
src/music.js            音乐与视频背景联动
src/demo-art.js         默认示例团子
src/styles.css          歌曲封面主题：天空蓝、棕发、藏青、橙色蝴蝶结
public/media/           背景视频、歌曲、封面
public/draco/           Draco 解码器（GLB 压缩模型）
```

## 备注

- 素材只在浏览器本地处理，不会上传；云存档仅保存次数与无限状态。
- 歌曲、封面与视频使用项目目录中提供的文件。
- 浏览器通常会拦截带声音的自动播放，所以首次进入可能是静音播放；点击任意处或音乐按钮即可开声，这是浏览器策略，不是 SDK 限制。
