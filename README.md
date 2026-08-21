# 外置桌宠渲染器

一个面向 Windows 的本地桌宠覆盖层。它以透明悬浮窗口显示动画桌宠，并根据 Codex 与 DeepSeek Harness 的任务状态自动切换动作。项目内置扶摇形象，也支持导入社区宠物包或创建自己的桌宠。

## 下载与安装

前往 [Releases](https://github.com/fuyao606/external-pet-renderer/releases/latest)，下载最新版 `Setup.exe`。

1. 双击下载的安装程序，按向导完成安装。
2. 从桌面或开始菜单启动“外置桌宠渲染器”。
3. 首次启动时会显示内置的扶摇桌宠；应用会常驻系统托盘。

安装程序适用于 64 位 Windows。安装版无需 Node.js，也不需要执行 `npm start`。

## 导入喜欢的桌宠

本项目兼容 Codex 宠物的标准 `pet.json + spritesheet.webp` 包格式，也能导入包含 `pet_request.json`、`frames/frames-manifest.json` 和状态帧 PNG 的生成结果目录。

### 从 Codex Pets 下载

1. 打开 [Codex Pets 宠物库](https://codex-pet.org/zh/#gallery)，浏览、预览并下载喜欢的宠物包。
2. 解压下载的 ZIP 文件，保留包含 `pet.json` 与 `spritesheet.webp` 的同一文件夹。
3. 右键系统托盘中的桌宠图标，选择“桌宠形象”。
4. 点击“导入桌宠文件夹...”，选择解压后的宠物文件夹。即使选择了它的父目录或 `frames` 子目录，应用也会尝试定位唯一有效的宠物包。
5. 在“桌宠形象”菜单中选择新导入的形象，立即生效；选择会在下次启动时保留。

导入后，应用会只复制运行所需的资源与元数据到：

```text
C:\Users\<用户名>\.codex\external-pet-renderer\packs
```

因此原始下载或生成目录可以移动、备份或删除。请仅导入你有权使用和再分发的桌宠资源，并遵守资源作者的许可证。

### 用 Hatch Pet skill 创建自己的桌宠

可以使用 Hatch Pet skill 生成独有的 Codex 宠物。描述角色的外观与风格，完成生成后确认输出目录中包含：

```text
pet.json
spritesheet.webp
```

随后按照上面的“导入喜欢的桌宠”步骤，选择该输出文件夹即可。该格式使用 192 x 208 像素单元、8 列的精灵图；应用会读取宠物元数据并映射空闲、拖拽移动、运行、等待、审查和失败状态。也可以导入 Hatch Pet 生成的逐帧目录格式，应用会直接使用其中的 PNG 动画帧。

## 功能

- **任务状态联动**：只读监听 Codex 和 DeepSeek Harness 会话日志，在工作、等待、审查、失败和空闲状态之间自动切换动画。
- **双来源任务面板**：任务气泡汇总 Codex 与 DeepSeek Harness 的运行中任务；点击任务可打开对应 Codex 线程，或前置已有的 Harness 浏览器窗口。
- **自然的桌面交互**：透明像素区域自动点击穿透，只有桌宠可见像素接收鼠标事件；拖拽角色可自由摆放，左右移动时会播放对应行走动画。
- **可控状态**：可以从托盘菜单控制自动监听，也可以用命令手动设置等待、工作、审查、失败或休息状态。
- **多桌宠管理**：可导入多个宠物包，在托盘菜单中切换；当前选中的形象和导入记录会保存到用户目录。
- **本地优先**：应用在本机读取会话日志和桌宠资源，不会上传你的任务内容或宠物文件。

## 使用说明

右键托盘图标可打开状态、缩放和形象菜单。单击桌宠会优先前置 DeepSeek Harness；若未检测到现有 Harness 浏览器窗口，才会打开 `http://127.0.0.1:3080`。

默认缩放为 30%。可从托盘菜单调整桌宠尺寸，或拖拽桌宠到适合的位置。

### 手动状态命令

开发环境下可执行：

```powershell
npm run status -- waiting
npm run status -- running
npm run status -- review
npm run status -- failed
npm run status -- rest
npm run status -- auto
```

命令会写入当前选中桌宠包中的 `external-renderer-state.json`。`auto` 会恢复由会话日志驱动的自动状态。

## 支持的状态来源

- `~/.codex/sessions`：`task_started` 显示工作状态；`task_complete` 显示审查状态 4 秒；`turn_aborted` 或 `task_failed` 显示失败状态 4 秒。
- `~/.dsh/sessions`：`turn/start` 显示工作状态；正常 `turn/end` 显示审查状态 4 秒；状态为 `aborted`、`error` 或 `interrupted` 的 `turn/end` 显示失败状态 4 秒。支持 DeepSeek Harness 的 `session.jsonl.zstd` 追加压缩日志和未压缩 JSONL。

“等待输入”无法从会话日志稳定推断，可通过托盘菜单或手动状态命令设置。

## 开发与构建

```powershell
npm install
npm start
```

运行检查和测试：

```powershell
npm run check
npm test
```

构建 Windows 安装程序：

```powershell
npm run dist
```

构建完成后，`release` 目录会生成 `外置桌宠渲染器-<版本号>-Setup.exe`。该目录是构建产物，不纳入 Git 版本控制；公开下载请使用 GitHub Releases。

## 许可证

代码与内置扶摇桌宠资源以 [MIT License](LICENSE) 发布。第三方导入桌宠的版权和许可由各自作者决定。
