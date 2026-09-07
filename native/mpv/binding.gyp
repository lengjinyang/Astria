{
  "targets": [{
    "target_name": "astria_mpv",
    "sources": ["src/mpv_addon.cc"],
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")", "include"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NOMINMAX"],
    "libraries": ["<(module_root_dir)/mpv.lib", "d3d11.lib", "dxgi.lib", "opengl32.lib", "gdi32.lib", "user32.lib"],
    "msvs_settings": { "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++17"], "ExceptionHandling": 0 } }
  }]
}
