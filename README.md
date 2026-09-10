# Astria

面向 UE5 特效师、VFX、TA 和动画艺术家的 Windows 视频分析播放器。

## 功能

- 逐帧播放、倒放、变速、时间轴拖动与 A/B 区间循环。
- 双视频同步对比，支持并排、分屏等对比模式。
- 波形、直方图、矢量示波器、拾色器和 LUT 查看预设。
- 帧书签、文字笔记、画面批注、截图与 Contact Sheet 导出。
- 字幕、音轨切换及音画同步调整。
- 支持 ProRes、DNxHR、HEVC、MXF 等视频，以及 EXR、DPX、PNG、JPEG 图像序列。
- 自动记忆播放位置和工作区，支持快捷键、纯净模式与窗口置顶。

## 下载

在 [Releases](../../releases/latest) 下载 Windows x64 版本：

- **Astria-Setup-0.8.8.exe**：安装版。
- **Astria-0.8.8-x64.zip**：解压后运行的便携版。

## 开发

运行 `npm ci` 安装依赖，按 [原生核心构建说明](native/README.md#rebuild-libmpv) 准备播放核心后执行 `npm start`。浏览器版本可直接打开 `index.html`，部分功能仅桌面版支持。

第三方组件与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
