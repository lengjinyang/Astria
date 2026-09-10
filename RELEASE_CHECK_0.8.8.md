# Astria 0.8.8 发布前检查

日期：2026-09-10。环境：本机 Windows x64，Electron 40.10.5，mpv 0.41.0。

## 结论

本轮列出的自动化回归已通过，安装包和 ZIP 构建成功，并直接对 win-unpacked/Astria.exe 完成功能和序列回归。适合作为候选发布包；不代表所有硬件、长时间性能和安装升级流程均已验收。

## 已通过

- `npm run check`：主要 JavaScript 文件语法检查。
- `npm run check:formats`：H.264、ProRes、DNxHR/MXF、HEVC HDR、M2TS、WMV、PNG、EXR、DPX 解码；PNG 缺帧位置检查。
- `npm run check:browser`：HTMLVideo MP4 加载、播放、截图。
- `scripts/review-regression.cjs`：工作区保存保护、资源筛选、键盘导航、刷新、定位、焦点保持。
- `scripts/clean-mode-smoke.cjs`：设置面板边界、反馈位置、资源显示、搜索、面板快捷键、键盘焦点。
- `npm run check:playback` 及扩展桌面回归：三轮字幕实际像素绘制/关闭/释放，字幕发现和手动加载，双音轨切换，字幕及音频延迟，105% 与内部 1.05 的转换，倍速、逐帧、音量反馈。
- AB 同步、B 时间线和帧偏移、暂停和单步对齐、越界暂停；四种对比模式布局、A/B 单画面切换、恢复 50%、真实鼠标拖动分界线。
- 资源面板外部真实左键和右键关闭，关闭点击不改变暂停状态。
- 真实鼠标双击切换最大化/还原，播放状态保持，未进入全屏。
- 五种示波器模式、RGB 像素输出、GPU 缓存；拾色、批注、截图和联系表导出。
- PNG 序列缺帧保持、新增帧重新识别、48 FPS 和书签恢复。
- 发布程序重复执行完整功能回归、PNG 序列恢复，以及 3840×2160 HEVC 短素材播放/定位/导出检查；后端为 shared-texture，解码器为 d3d11va-copy。
- 39 个原生运行时二进制依赖检查，无缺失 DLL；9 个源码归档 SHA-256 匹配。
- `npm run make:win`：NSIS 和 ZIP 构建成功。

## 修复和测试调整

- 修复活动序列重新打开时直接返回旧缓存，导致新增帧未识别。现在重新扫描，并保留仍被活动会话引用的旧清单，最后释放时清理。
- 更新旧测试的“双击全屏”断言为“最大化/还原”，增加字幕百分比、AB 模式和外部关闭回归。
- 鼠标拖动测试补上 Electron 的 leftButtonDown 修饰符；原测试模拟会丢失指针捕获，属于测试输入问题。
- 首次构建与播放测试并行导致 DLL 被占用，测试退出后顺序构建成功。

## 仍需注意的范围

- EXE 和安装包均为 NotSigned；未验证 Windows 下载信誉或 SmartScreen 行为。
- 未执行安装、卸载、覆盖升级、文件关联和干净机器测试。
- 未进行长时间双 4K 流畅度/内存压力测试；AB 短素材同步通过不等于右侧卡顿在所有素材上消失。
- 顶栏按钮持续悬停、多显示器和不同 DPI 的真实鼠标行为未专项验收。
- ASS 自带复杂样式和附加字体未做专门像素验收；本轮实际字幕测试使用 SRT/VTT。
- 日志有 ResizeObserver 通知循环和 Canvas 读回性能提示；未导致本轮断言失败，但不能宣称完全没有运行时警告。隐藏浏览器测试退出时有 GPU command buffer 日志。

## 产物

- `out/builder/Astria-Setup-0.8.8.exe`
  - SHA-256: `E08CE00CB1EB63744635FA721497381EC15D087F11320720E282D6F48A4A45B4`
- `out/builder/Astria-0.8.8-x64.zip`
  - SHA-256: `82ADEE63E3C4D37E4549367214341BB3DA3904D346823DD89E99778795F96B2B`
- 界面检查截图：`out/playback-features.png`。

未上传或发布产物。
