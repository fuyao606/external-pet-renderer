# 本地外置桌宠渲染器

这是一个独立于 Codex 和 DeepSeek Harness 安装包的 Windows 覆盖层。它读取桌宠帧资源，并根据编码任务状态播放动画。

## 启动

安装版不需要 `npm start`。运行 `release` 目录中的安装程序后，可从桌面或开始菜单启动“外置桌宠渲染器”。

开发模式仍可使用：

```powershell
npm install
npm start
```

默认会加载内置的扶摇桌宠资源。

可以用环境变量临时指定单个资源目录：

```powershell
$env:EXTERNAL_PET_PACK = 'D:\path\to\pet-pack'
npm start
```

## 导入和更换桌宠

右键系统托盘中的桌宠图标，打开“桌宠形象”：

- 选择已导入的桌宠可立即切换形象；选择会在下次启动后保留。
- 点击“导入桌宠文件夹...”并选择完整的生成结果目录，例如 `C:\Users\15458\Desktop\pet\fuyou-v1-run`。如果选择了它的父目录或 `frames` 子目录，导入器会在附近自动定位唯一的桌宠包。
- 导入器识别与 `fuyou-v1-run` 相同的目录格式：根目录含 `pet_request.json`，并含 `frames\frames-manifest.json` 和状态帧 PNG 文件夹。

导入时仅复制运行所需的 `frames` 和元数据到：

```text
C:\Users\<用户名>\.codex\external-pet-renderer\packs
```

原始生成目录之后可以移动或删除。

## 自动状态

应用只读监听以下会话日志：

- `~/.codex/sessions`：`task_started` 进入工作状态；`task_complete` 进入审查状态 4 秒；`turn_aborted` / `task_failed` 进入失败状态 4 秒。
- `~/.dsh/sessions`：DeepSeek Harness 的 `turn/start` 进入工作状态；正常 `turn/end` 进入审查状态 4 秒；`aborted`、`error` 或 `interrupted` 的 `turn/end` 进入失败状态 4 秒。默认读取标准的 `session.jsonl.zstd` 追加压缩日志，也兼容未压缩 JSONL。

任务气泡会汇总两个来源的运行中任务。任务面板中点击 Codex 任务会打开对应线程；点击 DeepSeek Harness 任务会优先前置已有的 Harness 浏览器窗口，找不到时才打开 Harness GUI（`http://127.0.0.1:3080`）。 “等待输入”无法从会话日志稳定推断，因此由托盘菜单或状态命令控制。右键桌宠也会打开同一菜单；单击人物会使用相同策略打开或前置 DeepSeek Harness，拖拽时播放对应形态的移动动作。拖拽会将人物中心锁定在鼠标下方，鼠标移动到哪里，桌宠就移动到哪里。只有角色的可见像素会接收鼠标操作，透明区域会自动穿透到底层应用。默认缩放为 30%。

## 手动状态命令

```powershell
npm run status -- waiting
npm run status -- running
npm run status -- review
npm run status -- failed
npm run status -- rest
npm run status -- auto
```

命令写入当前选中桌宠包内的 `external-renderer-state.json`。`auto` 会重新启用会话日志监听。

## 验证

```powershell
npm run check
npm test
```

## 构建安装包

```powershell
npm install
npm run dist
```

构建完成后，Windows 安装程序位于 `release` 目录。安装包内置扶摇默认资源；导入的桌宠仍保存在用户目录，不会随着应用升级被覆盖。

## 许可证

本项目代码和内置扶摇桌宠资源均以 [MIT License](LICENSE) 发布。
