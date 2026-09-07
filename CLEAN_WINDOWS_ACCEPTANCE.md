# 干净 Windows x64 安装验收

此项尚未执行。开发机的打包回归与 DLL 依赖检查不能代替这项验收。

使用没有安装 mpv、FFmpeg 或 Visual Studio 的 Windows x64 虚拟机或独立机器。无需关闭安全软件，也无需安装额外运行库。

1. 复制 `out/builder/Astria-Setup-0.8.8.exe` 和一份 ProRes MOV 素材到测试机。运行安装向导，选择独立安装目录。
2. 启动安装后的 Astria，打开素材。确认正常显示画面，播放和暂停有效，前后逐帧有效；不出现“播放核心缺失或损坏”。
3. 确认安装目录的 `resources/mpv` 包含 `astria_mpv.node`、`libmpv-2.dll`、FFmpeg 及 Visual C++ 运行库 DLL。无需把这些目录加入 PATH。
4. 退出 Astria，再从资源管理器用 Astria 打开 MOV；检查文件关联打开正常。PNG/JPEG 原有默认图片查看器应保持不变。
5. 检查经典模式、纯净模式与窗口缩放，确认画面完整居中、控件不被遮挡。测试机上仅做这轮安装烟雾检查，不按容器重复完整 UI 测试。

记录 Windows 版本和架构、安装包 SHA-256、安装目录、测试素材、结果与任何错误截图。若失败，保留完整错误文字；不要通过安装 mpv/FFmpeg 或修改 PATH 绕过失败。

在 PowerShell 中记录安装包校验值：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\Astria-Setup-0.8.8.exe
```

通过以上步骤后，将实际测试环境和结果补入 `VALIDATION.md`。当前任务仍等待此项证据，不应标记为全部验收完成。
