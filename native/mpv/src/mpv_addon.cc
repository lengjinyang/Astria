// Derived from electron-mpv-video 4944079, MIT; see licenses/electron-mpv-video-MIT.txt.
#include <napi.h>
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>

#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#include <IOSurface/IOSurface.h>
#include <OpenGL/OpenGL.h>
#include <OpenGL/gl3.h>
#include <dlfcn.h>
#endif

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <GL/gl.h>
#endif

#include <algorithm>
#include <array>
#include <atomic>
#include <condition_variable>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <cmath>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace {

#ifdef _WIN32
#ifndef GL_FRAMEBUFFER
#define GL_FRAMEBUFFER 0x8D40
#endif
#ifndef GL_COLOR_ATTACHMENT0
#define GL_COLOR_ATTACHMENT0 0x8CE0
#endif
#ifndef GL_FRAMEBUFFER_COMPLETE
#define GL_FRAMEBUFFER_COMPLETE 0x8CD5
#endif
#ifndef GL_RGBA8
#define GL_RGBA8 0x8058
#endif
#ifndef GL_CLAMP_TO_EDGE
#define GL_CLAMP_TO_EDGE 0x812F
#endif
#ifndef WGL_ACCESS_WRITE_DISCARD_NV
#define WGL_ACCESS_WRITE_DISCARD_NV 0x0002
#endif

using PFNGLGENFRAMEBUFFERSPROC = void (APIENTRY*)(GLsizei, GLuint*);
using PFNGLBINDFRAMEBUFFERPROC = void (APIENTRY*)(GLenum, GLuint);
using PFNGLFRAMEBUFFERTEXTURE2DPROC = void (APIENTRY*)(GLenum, GLenum, GLenum, GLuint, GLint);
using PFNGLCHECKFRAMEBUFFERSTATUSPROC = GLenum (APIENTRY*)(GLenum);
using PFNGLDELETEFRAMEBUFFERSPROC = void (APIENTRY*)(GLsizei, const GLuint*);
using PFNWGLDXOPENDEVICENVPROC = HANDLE (WINAPI*)(void*);
using PFNWGLDXCLOSEDEVICENVPROC = BOOL (WINAPI*)(HANDLE);
using PFNWGLDXREGISTEROBJECTNVPROC = HANDLE (WINAPI*)(HANDLE, void*, GLuint, GLenum, GLenum);
using PFNWGLDXUNREGISTEROBJECTNVPROC = BOOL (WINAPI*)(HANDLE, HANDLE);
using PFNWGLDXLOCKOBJECTSNVPROC = BOOL (WINAPI*)(HANDLE, GLint, HANDLE*);
using PFNWGLDXUNLOCKOBJECTSNVPROC = BOOL (WINAPI*)(HANDLE, GLint, HANDLE*);

LRESULT CALLBACK hidden_wnd_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  return DefWindowProc(hwnd, message, wparam, lparam);
}
#endif

std::string mpv_error_text(int code) {
  if (code >= 0) return "ok";
  const char* text = mpv_error_string(code);
  return text ? text : "unknown mpv error";
}

void throw_mpv_error(Napi::Env env, const std::string& action, int code) {
  std::ostringstream out;
  out << action << " failed: " << mpv_error_text(code) << " (" << code << ")";
  Napi::Error::New(env, out.str()).ThrowAsJavaScriptException();
}

#ifdef _WIN32
std::string hex_u32(unsigned long value) {
  std::ostringstream out;
  out << "0x" << std::hex << value;
  return out.str();
}

struct SharedTextureResult {
  bool busy = false;
  int slot_id = -1;
  int width = 0;
  int height = 0;
  uintptr_t nt_handle = 0;
  int64_t timestamp = 0;
};

class MpvPlayer;

struct SharedTextureRequest {
  SharedTextureRequest(MpvPlayer* owner, Napi::Promise::Deferred value, int requested_width, int requested_height)
      : player(owner), deferred(value), width(requested_width), height(requested_height) {}
  MpvPlayer* player;
  Napi::Promise::Deferred deferred;
  int width;
  int height;
};

struct SharedTextureCompletion {
  std::shared_ptr<SharedTextureRequest> request;
  SharedTextureResult result;
  std::string error;
};
#endif

using MpvWakeupCallback = void (*)(void*);

#ifdef _WIN32
using MpvSetWakeupCallbackFn = void (*)(mpv_handle*, MpvWakeupCallback, void*);
using MpvSetRenderUpdateCallbackFn = void (*)(mpv_render_context*, MpvWakeupCallback, void*);

template <typename T>
T load_mpv_proc(const char* name) {
  HMODULE mpv = GetModuleHandleA("libmpv-2.dll");
  if (!mpv) mpv = GetModuleHandleA("mpv-2.dll");
  if (!mpv) mpv = LoadLibraryA("libmpv-2.dll");
  if (!mpv) mpv = LoadLibraryA("mpv-2.dll");
  return mpv ? reinterpret_cast<T>(GetProcAddress(mpv, name)) : nullptr;
}

void set_mpv_wakeup_callback(mpv_handle* handle, MpvWakeupCallback callback, void* ctx) {
  static MpvSetWakeupCallbackFn fn = load_mpv_proc<MpvSetWakeupCallbackFn>("mpv_set_wakeup_callback");
  if (fn) fn(handle, callback, ctx);
}

void set_mpv_render_update_callback(mpv_render_context* context, MpvWakeupCallback callback, void* ctx) {
  static MpvSetRenderUpdateCallbackFn fn =
    load_mpv_proc<MpvSetRenderUpdateCallbackFn>("mpv_render_context_set_update_callback");
  if (fn) fn(context, callback, ctx);
}
#else
void set_mpv_wakeup_callback(mpv_handle* handle, MpvWakeupCallback callback, void* ctx) {
  mpv_set_wakeup_callback(handle, callback, ctx);
}

void set_mpv_render_update_callback(mpv_render_context* context, MpvWakeupCallback callback, void* ctx) {
  mpv_render_context_set_update_callback(context, callback, ctx);
}
#endif

class MpvPlayer : public Napi::ObjectWrap<MpvPlayer> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function ctor = DefineClass(env, "MpvPlayer", {
      InstanceMethod("initialize", &MpvPlayer::Initialize),
      InstanceMethod("open", &MpvPlayer::Open),
      InstanceMethod("play", &MpvPlayer::Play),
      InstanceMethod("pause", &MpvPlayer::Pause),
      InstanceMethod("stop", &MpvPlayer::Stop),
      InstanceMethod("seek", &MpvPlayer::Seek),
      InstanceMethod("step", &MpvPlayer::Step),
      InstanceMethod("setSpeed", &MpvPlayer::SetSpeed),
      InstanceMethod("tracks", &MpvPlayer::Tracks),
      InstanceMethod("configureTrack", &MpvPlayer::ConfigureTrack),
      InstanceMethod("addSubtitle", &MpvPlayer::AddSubtitle),
      InstanceMethod("setMuted", &MpvPlayer::SetMuted),
      InstanceMethod("setFps", &MpvPlayer::SetFps),
      InstanceMethod("getInfo", &MpvPlayer::GetInfo),
      InstanceMethod("setVolume", &MpvPlayer::SetVolume),
      InstanceMethod("setUpdateCallback", &MpvPlayer::SetUpdateCallback),
      InstanceMethod("setEventCallback", &MpvPlayer::SetEventCallback),
      InstanceMethod("renderFrame", &MpvPlayer::RenderFrame),
      InstanceMethod("renderSharedTexture", &MpvPlayer::RenderSharedTexture),
      InstanceMethod("releaseSharedTexture", &MpvPlayer::ReleaseSharedTexture),
      InstanceMethod("pollEvents", &MpvPlayer::PollEvents),
      InstanceMethod("destroy", &MpvPlayer::Destroy),
    });
    exports.Set("MpvPlayer", ctor);
    return exports;
  }

  explicit MpvPlayer(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<MpvPlayer>(info) {
    Napi::Env env = info.Env();
    if (info.Length() >= 1 && info[0].IsObject()) {
      Napi::Object options = info[0].As<Napi::Object>();
      if (options.Has("mode") && options.Get("mode").IsString()) {
        mode_ = options.Get("mode").As<Napi::String>().Utf8Value();
      }
    }
#ifdef _WIN32
    if (const char* slots = std::getenv("ASTRIA_SHARED_TEXTURE_SLOTS")) {
      if (std::strcmp(slots, "1") == 0) dx_slot_count_ = 1;
    }
#endif

#ifdef _WIN32
    // HWND destruction must run on the thread that created it. Only the tiny
    // hidden window stays on the main thread; driver/mpv setup runs in a worker.
    if (mode_ == "shared-texture" && !create_gl_window()) {
      cleanup();
      Napi::Error::New(env, "Failed to create hidden GL window").ThrowAsJavaScriptException();
      return;
    }
    if (info.Length() && info[0].IsObject() &&
        info[0].As<Napi::Object>().Get("deferInitialization").ToBoolean().Value()) return;
#endif
    const std::string error = initialize_native();
    if (!error.empty()) {
      cleanup();
      Napi::Error::New(env, error).ThrowAsJavaScriptException();
      return;
    }
    finish_initialization(env);
  }

 private:
  bool initializing_ = false;
  bool initialized_ = false;
  bool destroy_requested_ = false;

  std::string initialize_native() {
    handle_ = mpv_create();
    if (!handle_) {
      return "mpv_create failed";
    }

    set_option("terminal", std::getenv("ASTRIA_MPV_LOG") ? "yes" : "no");
    set_option("msg-level", std::getenv("ASTRIA_MPV_LOG") ? "all=v" : "all=warn");
    set_option("input-default-bindings", "no");
    set_option("audio-display", "no");
    set_option("pause", "yes");
    set_option("keep-open", "yes");
    set_option("config", "no");
    set_option("load-scripts", "no");
    set_option("osc", "no");
    set_option("osd-level", "0");
    set_option("ytdl", "no");
    set_option("input-terminal", "no");
    set_option("input-vo-keyboard", "no");
    set_option("autoload-files", "yes");
    set_option("audio-file-auto", "no");
    set_option("access-references", "no");
    set_option("demuxer-lavf-o", "protocol_whitelist=[file]");
    set_option("hwdec", "auto-safe");
    set_option("cache", "yes");
    set_option("demuxer-max-bytes", "268435456");
    set_option("demuxer-max-back-bytes", "134217728");
    set_option("sub-auto", "fuzzy");
    set_option("target-prim", "bt.709");
    set_option("target-trc", "bt.1886");
    set_option("target-peak", "100");
    set_option("tone-mapping", "bt.2390");
    set_option("gamut-mapping-mode", "auto");
    set_option("image-display-duration", "inf");
    set_option("vo", "libmpv");
    if (!option_error_.empty()) {
      return option_error_;
    }
    set_mpv_wakeup_callback(handle_, on_mpv_wakeup, this);

    int ret = mpv_initialize(handle_);
    if (ret < 0) {
      return std::string("mpv_initialize") + ": " + mpv_error_text(ret);
    }

    observe("time-pos", MPV_FORMAT_DOUBLE);
    observe("duration", MPV_FORMAT_DOUBLE);
    observe("pause", MPV_FORMAT_FLAG);
    observe("eof-reached", MPV_FORMAT_FLAG);
    observe("width", MPV_FORMAT_INT64);
    observe("height", MPV_FORMAT_INT64);
    observe("video-codec", MPV_FORMAT_STRING);
    observe("container-fps", MPV_FORMAT_DOUBLE);

    if (mode_ == "shared-texture") {
#if defined(__APPLE__)
      if (!init_gl()) {
        return "Failed to initialize CGL context";
      }
      CGLSetCurrentContext(gl_context_);
      mpv_opengl_init_params gl_init = {
        get_proc_address,
        nullptr,
      };
      const char* api_type = MPV_RENDER_API_TYPE_OPENGL;
      mpv_render_param params[] = {
        {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(api_type)},
        {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init},
        {MPV_RENDER_PARAM_INVALID, nullptr},
      };
      ret = mpv_render_context_create(&render_context_, handle_, params);
      if (ret < 0) {
        return std::string("mpv_render_context_create(opengl)") + ": " + mpv_error_text(ret);
      }
      set_mpv_render_update_callback(render_context_, on_mpv_render_update, this);
#elif defined(_WIN32)
      if (!init_gl()) {
        return "Failed to initialize WGL/D3D11 interop context";
      }
      wglMakeCurrent(win_dc_, win_gl_context_);
      mpv_opengl_init_params gl_init = {
        get_proc_address,
        nullptr,
      };
      const char* api_type = MPV_RENDER_API_TYPE_OPENGL;
      mpv_render_param params[] = {
        {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(api_type)},
        {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init},
        {MPV_RENDER_PARAM_INVALID, nullptr},
      };
      ret = mpv_render_context_create(&render_context_, handle_, params);
      if (ret < 0) {
        return std::string("mpv_render_context_create(opengl)") + ": " + mpv_error_text(ret);
      }
      set_mpv_render_update_callback(render_context_, on_mpv_render_update, this);
      // Rendering is dispatched to a worker thread. A WGL context can move
      // between threads only after it is released by the creating thread.
      wglMakeCurrent(nullptr, nullptr);

#else
      return "shared-texture mode is only implemented on macOS and Windows";
#endif
    } else {
      const char* api_type = MPV_RENDER_API_TYPE_SW;
      mpv_render_param params[] = {
        {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(api_type)},
        {MPV_RENDER_PARAM_INVALID, nullptr},
      };

      ret = mpv_render_context_create(&render_context_, handle_, params);
      if (ret < 0) {
        return std::string("mpv_render_context_create") + ": " + mpv_error_text(ret);
      }
      set_mpv_render_update_callback(render_context_, on_mpv_render_update, this);
    }
    return {};
  }

  void finish_initialization(Napi::Env env) {
#ifdef _WIN32
    if (mode_ == "shared-texture") {
      render_completion_ = Napi::ThreadSafeFunction::New(
          env,
          Napi::Function::New(env, [](const Napi::CallbackInfo&) {}),
          "astria:shared-texture-completion",
          0,
          1);
      render_thread_ = std::thread([this]() { shared_texture_render_loop(); });
    }
#endif
    initialized_ = true;
  }

  class InitializationWorker : public Napi::AsyncWorker {
   public:
    InitializationWorker(MpvPlayer* player, Napi::Env env)
        : Napi::AsyncWorker(env), player_(player), deferred_(Napi::Promise::Deferred::New(env)) {
      player_->Ref();
    }
    Napi::Promise promise() { return deferred_.Promise(); }
    void Execute() override {
      const std::string error = player_->initialize_native();
#ifdef _WIN32
      // Release even on partial failure so main-thread cleanup can bind it.
      wglMakeCurrent(nullptr, nullptr);
#endif
      if (!error.empty()) SetError(error);
    }
    void OnOK() override {
      player_->initializing_ = false;
      if (player_->destroy_requested_) {
        player_->cleanup();
        deferred_.Reject(Napi::Error::New(Env(), "Player destroyed during initialization").Value());
      } else {
        player_->finish_initialization(Env());
        deferred_.Resolve(Env().Undefined());
      }
      player_->Unref();
    }
    void OnError(const Napi::Error& error) override {
      player_->initializing_ = false;
      player_->cleanup();
      deferred_.Reject(error.Value());
      player_->Unref();
    }
   private:
    MpvPlayer* player_;
    Napi::Promise::Deferred deferred_;
  };

  Napi::Value Initialize(const Napi::CallbackInfo& info) {
    if (initializing_ || !alive_) {
      Napi::Error::New(info.Env(), "Player initialization unavailable").ThrowAsJavaScriptException();
      return info.Env().Undefined();
    }
    if (initialized_) {
      auto done = Napi::Promise::Deferred::New(info.Env());
      done.Resolve(info.Env().Undefined());
      return done.Promise();
    }
    initializing_ = true;
    auto* worker = new InitializationWorker(this, info.Env());
    auto promise = worker->promise();
    worker->Queue();
    return promise;
  }

 public:

  ~MpvPlayer() override {
    cleanup();
  }

 private:
  void set_option(const char* key, const char* value) {
    if (handle_) {
      int ret = mpv_set_option_string(handle_, key, value);
      // Lua-disabled LGPL builds omit the OSC and ytdl options entirely.
      const bool absent_script = ret == MPV_ERROR_OPTION_NOT_FOUND &&
          (std::strcmp(key, "osc") == 0 || std::strcmp(key, "ytdl") == 0);
      if (ret < 0 && !absent_script) option_error_ += std::string(key) + ": " + mpv_error_text(ret) + "; ";
    }
  }

  void observe(const char* name, mpv_format format) {
    if (handle_) {
      mpv_observe_property(handle_, next_observer_id_++, name, format);
    }
  }

  int command(const std::vector<std::string>& args) {
    std::vector<const char*> c_args;
    c_args.reserve(args.size() + 1);
    for (const std::string& arg : args) {
      c_args.push_back(arg.c_str());
    }
    c_args.push_back(nullptr);
    return mpv_command(handle_, c_args.data());
  }

  static void call_js_no_args(Napi::Env env, Napi::Function callback) {
    callback.Call({});
  }

  static void on_mpv_render_update(void* ctx) {
    auto* self = static_cast<MpvPlayer*>(ctx);
    if (self && self->alive_ && self->update_callback_) {
      self->update_callback_.NonBlockingCall(call_js_no_args);
    }
  }

  static void on_mpv_wakeup(void* ctx) {
    auto* self = static_cast<MpvPlayer*>(ctx);
    if (self && self->alive_ && self->event_callback_) {
      self->event_callback_.NonBlockingCall(call_js_no_args);
    }
  }

  Napi::Value Open(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
      Napi::TypeError::New(env, "open(path) requires a string path").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    std::string path = info[0].As<Napi::String>().Utf8Value();
    double start_time = 0.0;
    if (info.Length() >= 2 && info[1].IsNumber()) {
      start_time = info[1].As<Napi::Number>().DoubleValue();
      if (!std::isfinite(start_time) || start_time < 0.0) {
        Napi::RangeError::New(env, "open start time must be a finite non-negative number").ThrowAsJavaScriptException();
        return env.Undefined();
      }
    }
    // Local containers go directly to libavformat content probing. Do not let
    // a local playlist redirect mpv into its network stream implementations.
    std::string options = path.rfind("mf://@", 0) == 0 ? "demuxer=mf" : "demuxer=lavf";
    if (start_time > 0.0) options += ",start=" + std::to_string(start_time);
    std::vector<std::string> args = {"loadfile", path, "replace", "-1", options};
    std::vector<const char*> c_args;
    c_args.reserve(args.size() + 1);
    for (const std::string& arg : args) c_args.push_back(arg.c_str());
    c_args.push_back(nullptr);
    mpv_node result = {};
    int ret = mpv_command_ret(handle_, c_args.data(), &result);
    if (ret < 0) {
      throw_mpv_error(env, "loadfile", ret);
      return env.Undefined();
    }
    int64_t playlist_entry_id = -1;
    if (result.format == MPV_FORMAT_INT64) playlist_entry_id = result.u.int64;
    mpv_free_node_contents(&result);
    if (playlist_entry_id < 0) {
      ret = mpv_get_property(handle_, "playlist/0/id", MPV_FORMAT_INT64, &playlist_entry_id);
      if (ret < 0) {
        throw_mpv_error(env, "read playlist entry id", ret);
        return env.Undefined();
      }
    }
    return Napi::String::New(env, std::to_string(playlist_entry_id));
  }

  Napi::Value Play(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int flag = 0;
    int ret = mpv_set_property(handle_, "pause", MPV_FORMAT_FLAG, &flag);
    if (ret < 0) throw_mpv_error(env, "play", ret);
    return env.Undefined();
  }

  Napi::Value Pause(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int flag = 1;
    int ret = mpv_set_property(handle_, "pause", MPV_FORMAT_FLAG, &flag);
    if (ret < 0) throw_mpv_error(env, "pause", ret);
    return env.Undefined();
  }

  Napi::Value Stop(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int ret = command({"stop"});
    if (ret < 0) throw_mpv_error(env, "stop", ret);
    return env.Undefined();
  }

  Napi::Value Seek(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
      Napi::TypeError::New(env, "seek(seconds) requires a number").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    double seconds = info[0].As<Napi::Number>().DoubleValue();
    int ret = command({"seek", std::to_string(seconds), "absolute+exact"});
    if (ret < 0) throw_mpv_error(env, "seek", ret);
    return env.Undefined();
  }


  Napi::Value Step(const Napi::CallbackInfo& info) {
    int ret = command({info[0].As<Napi::Number>().Int32Value() < 0 ? "frame-back-step" : "frame-step"});
    if (ret < 0) throw_mpv_error(info.Env(), "step", ret);
    return info.Env().Undefined();
  }
  Napi::Value Tracks(const Napi::CallbackInfo& info) {
    auto result = Napi::Array::New(info.Env());
    mpv_node node{};
    if (mpv_get_property(handle_, "track-list", MPV_FORMAT_NODE, &node) < 0) return result;
    if (node.format == MPV_FORMAT_NODE_ARRAY) {
      for (int i = 0; i < node.u.list->num; ++i) {
        auto item = Napi::Object::New(info.Env());
        const auto& track = node.u.list->values[i];
        if (track.format != MPV_FORMAT_NODE_MAP) continue;
        for (int j = 0; j < track.u.list->num; ++j) {
          const auto& value = track.u.list->values[j]; const char* key = track.u.list->keys[j];
          if (value.format == MPV_FORMAT_STRING) item.Set(key, value.u.string);
          else if (value.format == MPV_FORMAT_INT64) item.Set(key, static_cast<double>(value.u.int64));
          else if (value.format == MPV_FORMAT_FLAG) item.Set(key, value.u.flag != 0);
        }
        result.Set(i, item);
      }
    }
    mpv_free_node_contents(&node); return result;
  }
  Napi::Value ConfigureTrack(const Napi::CallbackInfo& info) {
    std::string key = info[0].As<Napi::String>();
    if (key != "aid" && key != "sid" && key != "audio-delay" && key != "sub-delay" && key != "sub-scale") {
      Napi::Error::New(info.Env(), "Unsupported track setting").ThrowAsJavaScriptException(); return info.Env().Undefined();
    }
    std::string value = info[1].As<Napi::String>();
    int ret = mpv_set_property_string(handle_, key.c_str(), value.c_str());
    if (ret < 0) throw_mpv_error(info.Env(), key.c_str(), ret);
    return info.Env().Undefined();
  }
  Napi::Value AddSubtitle(const Napi::CallbackInfo& info) {
    int ret = command({"sub-add", info[0].As<Napi::String>().Utf8Value(), "select"});
    if (ret < 0) throw_mpv_error(info.Env(), "sub-add", ret);
    return info.Env().Undefined();
  }
  Napi::Value SetSpeed(const Napi::CallbackInfo& info) {
    double value = info[0].As<Napi::Number>().DoubleValue();
    int ret = mpv_set_property(handle_, "speed", MPV_FORMAT_DOUBLE, &value);
    if (ret < 0) throw_mpv_error(info.Env(), "speed", ret);
    return info.Env().Undefined();
  }
  Napi::Value SetMuted(const Napi::CallbackInfo& info) {
    int value = info[0].As<Napi::Boolean>().Value();
    int ret = mpv_set_property(handle_, "mute", MPV_FORMAT_FLAG, &value);
    if (ret < 0) throw_mpv_error(info.Env(), "mute", ret);
    return info.Env().Undefined();
  }
  Napi::Value SetFps(const Napi::CallbackInfo& info) {
    double value = info[0].As<Napi::Number>().DoubleValue();
    int ret = mpv_set_property(handle_, "mf-fps", MPV_FORMAT_DOUBLE, &value);
    double duration = 1.0 / value;
    mpv_set_property(handle_, "image-display-duration", MPV_FORMAT_DOUBLE, &duration);
    if (ret < 0) throw_mpv_error(info.Env(), "mf-fps", ret);
    return info.Env().Undefined();
  }
  Napi::Value GetInfo(const Napi::CallbackInfo& info) {
    auto result = Napi::Object::New(info.Env());
    for (const char* key : {"width", "height", "duration", "time-pos", "container-fps", "audio-delay", "sub-delay", "sub-scale"}) {
      double value = 0;
      if (mpv_get_property(handle_, key, MPV_FORMAT_DOUBLE, &value) >= 0) result.Set(key, value);
    }
    for (const char* key : {"mpv-version", "mpv-configuration", "ffmpeg-version", "video-codec", "file-format", "hwdec-current", "video-params/primaries", "video-params/gamma"}) {
      char* value = mpv_get_property_string(handle_, key);
      if (value) { result.Set(key, value); mpv_free(value); }
    }
    return result;
  }

  Napi::Value SetVolume(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
      Napi::TypeError::New(env, "setVolume(value) requires a number").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    double volume = std::clamp(info[0].As<Napi::Number>().DoubleValue(), 0.0, 100.0);
    int ret = mpv_set_property(handle_, "volume", MPV_FORMAT_DOUBLE, &volume);
    if (ret < 0) throw_mpv_error(env, "setVolume", ret);
    return env.Undefined();
  }

  Napi::Value SetUpdateCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (update_callback_) {
      update_callback_.Release();
      update_callback_ = nullptr;
    }
    if (info.Length() >= 1 && info[0].IsFunction()) {
      update_callback_ = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "mpv-render-update",
        1,
        1
      );
    }
    return env.Undefined();
  }

  Napi::Value SetEventCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (event_callback_) {
      event_callback_.Release();
      event_callback_ = nullptr;
    }
    if (info.Length() >= 1 && info[0].IsFunction()) {
      event_callback_ = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "mpv-event-wakeup",
        1,
        1
      );
    }
    return env.Undefined();
  }

  Napi::Value RenderFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (mode_ == "shared-texture") {
      Napi::Error::New(env, "renderFrame is unavailable in shared-texture mode").ThrowAsJavaScriptException();
      return env.Null();
    }
    if (!render_context_) {
      Napi::Error::New(env, "render context is not initialized").ThrowAsJavaScriptException();
      return env.Null();
    }

    int width = 960;
    int height = 540;
    if (info.Length() >= 2 && info[0].IsNumber() && info[1].IsNumber()) {
      width = std::max(2, info[0].As<Napi::Number>().Int32Value());
      height = std::max(2, info[1].As<Napi::Number>().Int32Value());
    }
    width = std::min(width, 16384);
    height = std::min(height, 16384);

    const size_t rgba_size = static_cast<size_t>(width) * static_cast<size_t>(height) * 4;
    // Electron disables Node external buffers. Allocate the frame through
    // Node so the backing store remains transferable over Electron IPC.
    auto rgba = Napi::Buffer<uint8_t>::New(env, rgba_size);
    int size[2] = {width, height};
    size_t stride = static_cast<size_t>(width) * 4;
    // This is an opaque video surface. RGB0 avoids mpv's RGBA subtitle
    // premultiplication path, which needs an alpha-capable scaler unavailable
    // in the bundled FFmpeg 6 build. Supply opaque alpha to JS after blending.
    char format[] = "rgb0";

    mpv_render_param params[] = {
      {MPV_RENDER_PARAM_SW_SIZE, size},
      {MPV_RENDER_PARAM_SW_FORMAT, format},
      {MPV_RENDER_PARAM_SW_STRIDE, &stride},
      {MPV_RENDER_PARAM_SW_POINTER, rgba.Data()},
      {MPV_RENDER_PARAM_INVALID, nullptr},
    };

    mpv_render_context_update(render_context_);
    int ret = mpv_render_context_render(render_context_, params);
    if (ret < 0) {
      throw_mpv_error(env, "mpv_render_context_render", ret);
      return env.Null();
    }

    for (size_t i = 3; i < rgba_size; i += 4) rgba.Data()[i] = 255;
    Napi::Object frame = Napi::Object::New(env);
    frame.Set("width", width);
    frame.Set("height", height);
    frame.Set("rgba", rgba);
    return frame;
  }

  Napi::Value RenderSharedTexture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (mode_ != "shared-texture") {
      Napi::Error::New(env, "renderSharedTexture is only available in shared-texture mode").ThrowAsJavaScriptException();
      return env.Null();
    }

#if !defined(__APPLE__) && !defined(_WIN32)
    Napi::Error::New(env, "renderSharedTexture is only implemented on macOS and Windows").ThrowAsJavaScriptException();
    return env.Null();
#elif defined(__APPLE__)
    int width = 960;
    int height = 540;
    if (info.Length() >= 2 && info[0].IsNumber() && info[1].IsNumber()) {
      width = std::max(2, info[0].As<Napi::Number>().Int32Value());
      height = std::max(2, info[1].As<Napi::Number>().Int32Value());
    }
    width = std::min(width, 16384);
    height = std::min(height, 16384);

    if (!ensure_iosurface_target(width, height)) {
      Napi::Error::New(env, "Failed to create IOSurface render target").ThrowAsJavaScriptException();
      return env.Null();
    }

    CGLSetCurrentContext(gl_context_);
    mpv_opengl_fbo fbo = {
      static_cast<int>(fbo_),
      width,
      height,
      GL_RGBA8,
    };
    int flip_y = 0;
    mpv_render_param params[] = {
      {MPV_RENDER_PARAM_OPENGL_FBO, &fbo},
      {MPV_RENDER_PARAM_FLIP_Y, &flip_y},
      {MPV_RENDER_PARAM_INVALID, nullptr},
    };

    mpv_render_context_update(render_context_);
    int ret = mpv_render_context_render(render_context_, params);
    glFlush();
    if (ret < 0) {
      throw_mpv_error(env, "mpv_render_context_render(opengl)", ret);
      return env.Null();
    }

    Napi::Object handle = Napi::Object::New(env);
    uintptr_t surface_ptr = reinterpret_cast<uintptr_t>(surface_);
    handle.Set("ioSurface", Napi::Buffer<uint8_t>::Copy(
      env,
      reinterpret_cast<uint8_t*>(&surface_ptr),
      sizeof(surface_ptr)
    ));

    Napi::Object size = Napi::Object::New(env);
    size.Set("width", width);
    size.Set("height", height);

    Napi::Object rect = Napi::Object::New(env);
    rect.Set("x", 0);
    rect.Set("y", 0);
    rect.Set("width", width);
    rect.Set("height", height);

    Napi::Object colorSpace = Napi::Object::New(env);
    colorSpace.Set("primaries", "bt709");
    colorSpace.Set("transfer", "gamma24");
    colorSpace.Set("matrix", "rgb");
    colorSpace.Set("range", "full");

    Napi::Object textureInfo = Napi::Object::New(env);
    textureInfo.Set("id", std::to_string(reinterpret_cast<uintptr_t>(surface_)));
    textureInfo.Set("pixelFormat", "bgra");
    textureInfo.Set("codedSize", size);
    textureInfo.Set("visibleRect", rect);
    textureInfo.Set("contentRect", rect);
    textureInfo.Set("timestamp", static_cast<double>(timestamp_us_++));
    textureInfo.Set("colorSpace", colorSpace);
    textureInfo.Set("handle", handle);

    return textureInfo;
#elif defined(_WIN32)
    int width = 960;
    int height = 540;
    if (info.Length() >= 2 && info[0].IsNumber() && info[1].IsNumber()) {
      width = std::max(2, info[0].As<Napi::Number>().Int32Value());
      height = std::max(2, info[1].As<Napi::Number>().Int32Value());
    }
    width = std::min(width, 16384);
    height = std::min(height, 16384);
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    {
      std::lock_guard<std::mutex> lock(render_mutex_);
      if (render_stopping_) {
        deferred.Reject(Napi::Error::New(env, "Shared texture renderer is stopping").Value());
        return deferred.Promise();
      }
      Ref();
      render_requests_.push_back(std::make_shared<SharedTextureRequest>(this, deferred, width, height));
    }
    render_cv_.notify_one();
    return deferred.Promise();
#endif
  }

  Napi::Value ReleaseSharedTexture(const Napi::CallbackInfo& info) {
#ifdef _WIN32
    if (info.Length() >= 1 && info[0].IsNumber()) {
      int slot_id = info[0].As<Napi::Number>().Int32Value();
      if (slot_id >= 0 && slot_id < dx_slot_count_) dx_slot_released_[slot_id].store(true, std::memory_order_release);
    }
#endif
    return info.Env().Undefined();
  }

  Napi::Value PollEvents(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array events = Napi::Array::New(env);
    uint32_t index = 0;

    while (handle_) {
      mpv_event* event = mpv_wait_event(handle_, 0);
      if (!event || event->event_id == MPV_EVENT_NONE) break;

      if (event->event_id == MPV_EVENT_START_FILE && event->data) {
        event_playlist_entry_id_ = static_cast<mpv_event_start_file*>(event->data)->playlist_entry_id;
      }

      Napi::Object item = Napi::Object::New(env);
      item.Set("id", static_cast<int>(event->event_id));
      item.Set("type", mpv_event_name(event->event_id));

      int64_t playlist_entry_id = event_playlist_entry_id_;
      if (event->event_id == MPV_EVENT_END_FILE && event->data) {
        playlist_entry_id = static_cast<mpv_event_end_file*>(event->data)->playlist_entry_id;
      }
      if (playlist_entry_id >= 0) item.Set("playlistEntryId", std::to_string(playlist_entry_id));

      if (event->error < 0) {
        item.Set("error", mpv_error_text(event->error));
      }

      if (event->event_id == MPV_EVENT_END_FILE && event->data) {
        auto* end = static_cast<mpv_event_end_file*>(event->data);
        if (end->error < 0) item.Set("error", mpv_error_text(end->error));
      }
      if (event->event_id == MPV_EVENT_PROPERTY_CHANGE && event->data) {
        mpv_event_property* prop = static_cast<mpv_event_property*>(event->data);
        item.Set("name", prop->name ? prop->name : "");
        if (prop->data) {
          switch (prop->format) {
            case MPV_FORMAT_FLAG:
              item.Set("data", *static_cast<int*>(prop->data) != 0);
              break;
            case MPV_FORMAT_INT64:
              item.Set("data", static_cast<double>(*static_cast<int64_t*>(prop->data)));
              break;
            case MPV_FORMAT_DOUBLE:
              item.Set("data", *static_cast<double*>(prop->data));
              break;
            case MPV_FORMAT_STRING: {
              char* value = *static_cast<char**>(prop->data);
              item.Set("data", value ? value : "");
              break;
            }
            default:
              item.Set("data", env.Null());
              break;
          }
        } else {
          item.Set("data", env.Null());
        }
      }

      events.Set(index++, item);
    }

    return events;
  }

  Napi::Value Destroy(const Napi::CallbackInfo& info) {
    cleanup();
    return info.Env().Undefined();
  }

#ifdef _WIN32
  static void finish_shared_texture_request(Napi::Env env, Napi::Function, SharedTextureCompletion* completion) {
    std::unique_ptr<SharedTextureCompletion> owned(completion);
    if (!completion->error.empty()) {
      completion->request->deferred.Reject(Napi::Error::New(env, completion->error).Value());
      completion->request->player->Unref();
      return;
    }
    if (completion->result.busy) {
      Napi::Object busy = Napi::Object::New(env); busy.Set("busy", true);
      completion->request->deferred.Resolve(busy);
      completion->request->player->Unref();
      return;
    }
    const SharedTextureResult& result = completion->result;
    Napi::Object handle = Napi::Object::New(env);
    handle.Set("ntHandle", Napi::Buffer<uint8_t>::Copy(env, reinterpret_cast<const uint8_t*>(&result.nt_handle), sizeof(result.nt_handle)));
    Napi::Object size = Napi::Object::New(env); size.Set("width", result.width); size.Set("height", result.height);
    Napi::Object rect = Napi::Object::New(env); rect.Set("x", 0); rect.Set("y", 0); rect.Set("width", result.width); rect.Set("height", result.height);
    Napi::Object color_space = Napi::Object::New(env);
    color_space.Set("primaries", "bt709"); color_space.Set("transfer", "gamma24"); color_space.Set("matrix", "rgb"); color_space.Set("range", "full");
    Napi::Object texture_info = Napi::Object::New(env);
    texture_info.Set("id", std::to_string(result.nt_handle)); texture_info.Set("slotId", result.slot_id); texture_info.Set("busy", false);
    texture_info.Set("pixelFormat", "bgra"); texture_info.Set("codedSize", size); texture_info.Set("visibleRect", rect);
    texture_info.Set("contentRect", rect); texture_info.Set("timestamp", static_cast<double>(result.timestamp));
    texture_info.Set("colorSpace", color_space); texture_info.Set("handle", handle);
    completion->request->deferred.Resolve(texture_info);
    completion->request->player->Unref();
  }

  void shared_texture_render_loop() {
    while (true) {
      std::shared_ptr<SharedTextureRequest> request;
      {
        std::unique_lock<std::mutex> lock(render_mutex_);
        render_cv_.wait(lock, [this]() { return render_stopping_ || !render_requests_.empty(); });
        if (render_stopping_ && render_requests_.empty()) break;
        request = render_requests_.front(); render_requests_.pop_front();
      }
      auto* completion = new SharedTextureCompletion();
      completion->request = request;
      render_shared_texture_win(request->width, request->height, completion->result, completion->error);
      if (render_completion_.NonBlockingCall(completion, finish_shared_texture_request) != napi_ok) {
        std::lock_guard<std::mutex> lock(render_mutex_);
        abandoned_render_requests_.push_back(request);
        delete completion;
      }
    }
  }

  void stop_shared_texture_renderer() {
    if (!render_thread_.joinable()) return;
    {
      std::lock_guard<std::mutex> lock(render_mutex_);
      render_stopping_ = true;
    }
    render_cv_.notify_all();
    render_thread_.join();
    for (const auto& request : abandoned_render_requests_) request->player->Unref();
    abandoned_render_requests_.clear();
    render_completion_.Release();
    render_completion_ = nullptr;
  }
#endif

  void cleanup() {
    if (initializing_) { destroy_requested_ = true; return; }
    alive_ = false;
#ifdef _WIN32
    stop_shared_texture_renderer();
#endif
    if (handle_) {
      set_mpv_wakeup_callback(handle_, nullptr, nullptr);
    }
    if (render_context_) {
      set_mpv_render_update_callback(render_context_, nullptr, nullptr);
    }
    if (update_callback_) {
      update_callback_.Release();
      update_callback_ = nullptr;
    }
    if (event_callback_) {
      event_callback_.Release();
      event_callback_ = nullptr;
    }
    if (render_context_) {
#ifdef _WIN32
      if (win_gl_context_) wglMakeCurrent(win_dc_, win_gl_context_);
#endif
      mpv_render_context_free(render_context_);
      render_context_ = nullptr;
    }
    if (handle_) {
      mpv_terminate_destroy(handle_);
      handle_ = nullptr;
    }
#ifdef __APPLE__
    destroy_iosurface_target();
    if (gl_context_) {
      CGLDestroyContext(gl_context_);
      gl_context_ = nullptr;
    }
#endif
#ifdef _WIN32
    destroy_dx_shared_target();
    if (dx_interop_device_) {
      wglDXCloseDeviceNV_(dx_interop_device_);
      dx_interop_device_ = nullptr;
    }
    if (d3d_context_) {
      d3d_context_->Release();
      d3d_context_ = nullptr;
    }
    if (d3d_device_) {
      d3d_device_->Release();
      d3d_device_ = nullptr;
    }
    if (win_gl_context_) {
      wglMakeCurrent(nullptr, nullptr);
      wglDeleteContext(win_gl_context_);
      win_gl_context_ = nullptr;
    }
    if (win_dc_) {
      ReleaseDC(win_hwnd_, win_dc_);
      win_dc_ = nullptr;
    }
    if (win_hwnd_) {
      DestroyWindow(win_hwnd_);
      win_hwnd_ = nullptr;
    }
#endif
  }

#ifdef __APPLE__
  static void* get_proc_address(void*, const char* name) {
    return dlsym(RTLD_DEFAULT, name);
  }

  bool init_gl() {
    CGLPixelFormatAttribute attrs[] = {
      kCGLPFAAccelerated,
      kCGLPFAAllowOfflineRenderers,
      static_cast<CGLPixelFormatAttribute>(0),
    };
    CGLPixelFormatObj pixel_format = nullptr;
    GLint num_formats = 0;
    if (CGLChoosePixelFormat(attrs, &pixel_format, &num_formats) != kCGLNoError || !pixel_format) {
      return false;
    }
    CGLContextObj context = nullptr;
    CGLError error = CGLCreateContext(pixel_format, nullptr, &context);
    CGLDestroyPixelFormat(pixel_format);
    if (error != kCGLNoError || !context) {
      return false;
    }
    gl_context_ = context;
    return true;
  }

  void destroy_iosurface_target() {
    if (gl_context_) {
      CGLSetCurrentContext(gl_context_);
      if (fbo_) {
        glDeleteFramebuffers(1, &fbo_);
        fbo_ = 0;
      }
      if (texture_) {
        glDeleteTextures(1, &texture_);
        texture_ = 0;
      }
    }
    if (surface_) {
      CFRelease(surface_);
      surface_ = nullptr;
    }
    surface_width_ = 0;
    surface_height_ = 0;
  }

  bool ensure_iosurface_target(int width, int height) {
    if (surface_ && surface_width_ == width && surface_height_ == height) {
      return true;
    }

    destroy_iosurface_target();
    CGLSetCurrentContext(gl_context_);

    CFMutableDictionaryRef props = CFDictionaryCreateMutable(
      kCFAllocatorDefault,
      0,
      &kCFTypeDictionaryKeyCallBacks,
      &kCFTypeDictionaryValueCallBacks
    );
    if (!props) return false;

    auto set_number = [&](CFStringRef key, int value) {
      CFNumberRef number = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &value);
      CFDictionarySetValue(props, key, number);
      CFRelease(number);
    };

    int pixel_format = 'BGRA';
    int bytes_per_row = static_cast<int>(IOSurfaceAlignProperty(kIOSurfaceBytesPerRow, width * 4));
    int alloc_size = static_cast<int>(IOSurfaceAlignProperty(kIOSurfaceAllocSize, bytes_per_row * height));
    set_number(kIOSurfaceWidth, width);
    set_number(kIOSurfaceHeight, height);
    set_number(kIOSurfaceBytesPerElement, 4);
    set_number(kIOSurfaceBytesPerRow, bytes_per_row);
    set_number(kIOSurfaceAllocSize, alloc_size);
    set_number(kIOSurfacePixelFormat, pixel_format);

    IOSurfaceRef surface = IOSurfaceCreate(props);
    CFRelease(props);
    if (!surface) return false;

    glGenTextures(1, &texture_);
    glBindTexture(GL_TEXTURE_RECTANGLE, texture_);
    glTexParameteri(GL_TEXTURE_RECTANGLE, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_RECTANGLE, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_RECTANGLE, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_RECTANGLE, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

    CGLError error = CGLTexImageIOSurface2D(
      gl_context_,
      GL_TEXTURE_RECTANGLE,
      GL_RGBA,
      width,
      height,
      GL_BGRA,
      GL_UNSIGNED_INT_8_8_8_8_REV,
      surface,
      0
    );
    if (error != kCGLNoError) {
      CFRelease(surface);
      return false;
    }

    glGenFramebuffers(1, &fbo_);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_RECTANGLE, texture_, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
      CFRelease(surface);
      destroy_iosurface_target();
      return false;
    }

    surface_ = surface;
    surface_width_ = width;
    surface_height_ = height;
    return true;
  }
#endif

#ifdef _WIN32
  struct DxExportSlot {
    ID3D11Texture2D* texture = nullptr;
    IDXGIKeyedMutex* keyed_mutex = nullptr;
    HANDLE shared_handle = nullptr;
    int width = 0;
    int height = 0;
    bool in_flight = false;
  };

  static void* get_proc_address(void*, const char* name) {
    void* proc = reinterpret_cast<void*>(wglGetProcAddress(name));
    if (proc) return proc;
    HMODULE opengl = GetModuleHandleA("opengl32.dll");
    if (!opengl) opengl = LoadLibraryA("opengl32.dll");
    return opengl ? reinterpret_cast<void*>(GetProcAddress(opengl, name)) : nullptr;
  }

  template <typename T>
  bool load_gl_proc(T& out, const char* name) {
    out = reinterpret_cast<T>(get_proc_address(nullptr, name));
    return out != nullptr;
  }

  bool create_gl_window() {
    HINSTANCE instance = GetModuleHandle(nullptr);
    WNDCLASSA wc = {};
    wc.lpfnWndProc = hidden_wnd_proc;
    wc.hInstance = instance;
    wc.lpszClassName = "ElectronMpvVideoHiddenGLWindow";
    RegisterClassA(&wc);

    win_hwnd_ = CreateWindowA(
      wc.lpszClassName,
      "electron-mpv-video-gl",
      WS_OVERLAPPEDWINDOW,
      0,
      0,
      1,
      1,
      nullptr,
      nullptr,
      instance,
      nullptr
    );
    if (!win_hwnd_) return false;

    win_dc_ = GetDC(win_hwnd_);
    if (!win_dc_) return false;

    return true;
  }

  bool init_gl() {
    PIXELFORMATDESCRIPTOR pfd = {};
    pfd.nSize = sizeof(pfd);
    pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
    pfd.iPixelType = PFD_TYPE_RGBA;
    pfd.cColorBits = 32;
    pfd.cDepthBits = 24;
    pfd.iLayerType = PFD_MAIN_PLANE;

    int pixel_format = ChoosePixelFormat(win_dc_, &pfd);
    if (!pixel_format || !SetPixelFormat(win_dc_, pixel_format, &pfd)) {
      return false;
    }

    win_gl_context_ = wglCreateContext(win_dc_);
    if (!win_gl_context_ || !wglMakeCurrent(win_dc_, win_gl_context_)) {
      return false;
    }

    if (!load_gl_proc(glGenFramebuffers_, "glGenFramebuffers") ||
        !load_gl_proc(glBindFramebuffer_, "glBindFramebuffer") ||
        !load_gl_proc(glFramebufferTexture2D_, "glFramebufferTexture2D") ||
        !load_gl_proc(glCheckFramebufferStatus_, "glCheckFramebufferStatus") ||
        !load_gl_proc(glDeleteFramebuffers_, "glDeleteFramebuffers") ||
        !load_gl_proc(wglDXOpenDeviceNV_, "wglDXOpenDeviceNV") ||
        !load_gl_proc(wglDXCloseDeviceNV_, "wglDXCloseDeviceNV") ||
        !load_gl_proc(wglDXRegisterObjectNV_, "wglDXRegisterObjectNV") ||
        !load_gl_proc(wglDXUnregisterObjectNV_, "wglDXUnregisterObjectNV") ||
        !load_gl_proc(wglDXLockObjectsNV_, "wglDXLockObjectsNV") ||
        !load_gl_proc(wglDXUnlockObjectsNV_, "wglDXUnlockObjectsNV")) {
      return false;
    }

    D3D_FEATURE_LEVEL levels[] = {
      D3D_FEATURE_LEVEL_11_1,
      D3D_FEATURE_LEVEL_11_0,
      D3D_FEATURE_LEVEL_10_1,
      D3D_FEATURE_LEVEL_10_0,
    };
    D3D_FEATURE_LEVEL selected_level = D3D_FEATURE_LEVEL_11_0;
    HRESULT hr = D3D11CreateDevice(
      nullptr,
      D3D_DRIVER_TYPE_HARDWARE,
      nullptr,
      D3D11_CREATE_DEVICE_BGRA_SUPPORT,
      levels,
      ARRAYSIZE(levels),
      D3D11_SDK_VERSION,
      &d3d_device_,
      &selected_level,
      &d3d_context_
    );
    if (FAILED(hr)) {
      hr = D3D11CreateDevice(
        nullptr,
        D3D_DRIVER_TYPE_WARP,
        nullptr,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        levels,
        ARRAYSIZE(levels),
        D3D11_SDK_VERSION,
        &d3d_device_,
        &selected_level,
        &d3d_context_
      );
      if (FAILED(hr)) return false;
    }

    dx_interop_device_ = wglDXOpenDeviceNV_(d3d_device_);
    return dx_interop_device_ != nullptr;
  }

  void destroy_dx_interop_target() {
    if (win_gl_context_) {
      wglMakeCurrent(win_dc_, win_gl_context_);
      if (dx_interop_object_) {
        wglDXUnregisterObjectNV_(dx_interop_device_, dx_interop_object_);
        dx_interop_object_ = nullptr;
      }
      if (win_gl_fbo_) {
        glDeleteFramebuffers_(1, &win_gl_fbo_);
        win_gl_fbo_ = 0;
      }
      if (win_gl_texture_) {
        glDeleteTextures(1, &win_gl_texture_);
        win_gl_texture_ = 0;
      }
    }
    if (d3d_interop_texture_) {
      d3d_interop_texture_->Release();
      d3d_interop_texture_ = nullptr;
    }
    dx_width_ = 0;
    dx_height_ = 0;
  }

  void destroy_dx_export_slot(DxExportSlot& slot) {
    if (slot.shared_handle) CloseHandle(slot.shared_handle);
    if (slot.keyed_mutex) slot.keyed_mutex->Release();
    if (slot.texture) slot.texture->Release();
    slot = {};
  }

  void destroy_dx_shared_target() {
    destroy_dx_interop_target();
    for (auto& slot : dx_export_slots_) destroy_dx_export_slot(slot);
  }

  bool render_shared_texture_win(int width, int height, SharedTextureResult& result, std::string& error) {
    for (int slot_id = 0; slot_id < dx_slot_count_; ++slot_id) {
      if (dx_slot_released_[slot_id].exchange(false, std::memory_order_acq_rel)) {
        dx_export_slots_[slot_id].in_flight = false;
      }
    }
    int slot_id = acquire_dx_export_slot();
    if (slot_id < 0) {
      result.busy = true;
      return true;
    }

    if (!ensure_dx_shared_target(width, height) || !ensure_dx_export_slot(slot_id, width, height)) {
      error = dx_error_.empty() ? "Failed to create WGL/D3D11 shared texture target" : dx_error_;
      wglMakeCurrent(nullptr, nullptr);
      return false;
    }
    if (!wglMakeCurrent(win_dc_, win_gl_context_)) {
      error = "wglMakeCurrent failed: " + hex_u32(GetLastError());
      return false;
    }
    if (!wglDXLockObjectsNV_(dx_interop_device_, 1, &dx_interop_object_)) {
      error = "wglDXLockObjectsNV failed: " + hex_u32(GetLastError());
      wglMakeCurrent(nullptr, nullptr);
      return false;
    }

    glBindFramebuffer_(GL_FRAMEBUFFER, win_gl_fbo_);
    mpv_opengl_fbo fbo = {static_cast<int>(win_gl_fbo_), width, height, GL_RGBA8};
    int flip_y = 0;
    mpv_render_param params[] = {
      {MPV_RENDER_PARAM_OPENGL_FBO, &fbo},
      {MPV_RENDER_PARAM_FLIP_Y, &flip_y},
      {MPV_RENDER_PARAM_INVALID, nullptr},
    };
    mpv_render_context_update(render_context_);
    int ret = mpv_render_context_render(render_context_, params);
    glFlush();
    BOOL unlocked = wglDXUnlockObjectsNV_(dx_interop_device_, 1, &dx_interop_object_);
    DWORD unlock_error = unlocked ? ERROR_SUCCESS : GetLastError();
    wglMakeCurrent(nullptr, nullptr);
    if (ret < 0) {
      error = "mpv_render_context_render(opengl) failed: " + mpv_error_text(ret);
      return false;
    }
    if (!unlocked) {
      error = "wglDXUnlockObjectsNV failed: " + hex_u32(unlock_error);
      return false;
    }

    DxExportSlot& slot = dx_export_slots_[slot_id];
    HRESULT copy_hr = slot.keyed_mutex->AcquireSync(0, 1000);
    if (FAILED(copy_hr)) {
      error = "IDXGIKeyedMutex::AcquireSync failed: " + hex_u32(static_cast<unsigned long>(copy_hr));
      return false;
    }
    d3d_context_->CopyResource(slot.texture, d3d_interop_texture_);
    d3d_context_->Flush();
    copy_hr = slot.keyed_mutex->ReleaseSync(0);
    if (FAILED(copy_hr)) {
      error = "IDXGIKeyedMutex::ReleaseSync failed: " + hex_u32(static_cast<unsigned long>(copy_hr));
      return false;
    }

    slot.in_flight = true;
    dx_slot_released_[slot_id].store(false, std::memory_order_release);
    result.slot_id = slot_id;
    result.width = width;
    result.height = height;
    result.nt_handle = reinterpret_cast<uintptr_t>(slot.shared_handle);
    result.timestamp = timestamp_us_++;
    return true;
  }

  int acquire_dx_export_slot() {
    for (int offset = 0; offset < dx_slot_count_; ++offset) {
      int slot_id = (dx_next_slot_ + offset) % dx_slot_count_;
      if (!dx_export_slots_[slot_id].in_flight) {
        dx_next_slot_ = (slot_id + 1) % dx_slot_count_;
        return slot_id;
      }
    }
    return -1;
  }

  bool ensure_dx_shared_target(int width, int height) {
    if (d3d_interop_texture_ && dx_width_ == width && dx_height_ == height) return true;

    destroy_dx_interop_target();
    dx_error_.clear();
    if (!wglMakeCurrent(win_dc_, win_gl_context_)) {
      dx_error_ = "wglMakeCurrent(interop target) failed: " + hex_u32(GetLastError());
      return false;
    }

    D3D11_TEXTURE2D_DESC desc = {};
    desc.Width = static_cast<UINT>(width);
    desc.Height = static_cast<UINT>(height);
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    desc.MiscFlags = D3D11_RESOURCE_MISC_SHARED;

    HRESULT hr = d3d_device_->CreateTexture2D(&desc, nullptr, &d3d_interop_texture_);
    if (FAILED(hr)) {
      dx_error_ = "CreateTexture2D(interop) failed: " + hex_u32(static_cast<unsigned long>(hr));
      destroy_dx_interop_target();
      return false;
    }

    glGenTextures(1, &win_gl_texture_);
    glBindTexture(GL_TEXTURE_2D, win_gl_texture_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    dx_interop_object_ = wglDXRegisterObjectNV_(
      dx_interop_device_, d3d_interop_texture_, win_gl_texture_,
      GL_TEXTURE_2D, WGL_ACCESS_WRITE_DISCARD_NV);
    if (!dx_interop_object_) {
      dx_error_ = "wglDXRegisterObjectNV(interop target) failed: " + hex_u32(GetLastError());
      destroy_dx_interop_target();
      return false;
    }
    if (!wglDXLockObjectsNV_(dx_interop_device_, 1, &dx_interop_object_)) {
      dx_error_ = "wglDXLockObjectsNV(interop target setup) failed: " + hex_u32(GetLastError());
      destroy_dx_interop_target();
      return false;
    }

    glGenFramebuffers_(1, &win_gl_fbo_);
    glBindFramebuffer_(GL_FRAMEBUFFER, win_gl_fbo_);
    glFramebufferTexture2D_(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, win_gl_texture_, 0);
    const bool complete = glCheckFramebufferStatus_(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
    const BOOL unlocked = wglDXUnlockObjectsNV_(dx_interop_device_, 1, &dx_interop_object_);
    const DWORD unlock_error = unlocked ? ERROR_SUCCESS : GetLastError();
    wglMakeCurrent(nullptr, nullptr);
    if (!complete || !unlocked) {
      dx_error_ = !complete ? "OpenGL framebuffer for WGL/D3D11 interop texture is incomplete" :
        "wglDXUnlockObjectsNV(interop target setup) failed: " + hex_u32(unlock_error);
      destroy_dx_interop_target();
      return false;
    }

    dx_width_ = width;
    dx_height_ = height;
    return true;
  }

  bool ensure_dx_export_slot(int slot_id, int width, int height) {
    DxExportSlot& slot = dx_export_slots_[slot_id];
    if (slot.texture && slot.width == width && slot.height == height) return true;
    if (slot.in_flight) {
      dx_error_ = "Attempted to resize an in-flight shared texture slot";
      return false;
    }
    destroy_dx_export_slot(slot);

    D3D11_TEXTURE2D_DESC desc = {};
    desc.Width = static_cast<UINT>(width);
    desc.Height = static_cast<UINT>(height);
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    desc.MiscFlags = D3D11_RESOURCE_MISC_SHARED_NTHANDLE | D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX;

    HRESULT hr = d3d_device_->CreateTexture2D(&desc, nullptr, &slot.texture);
    if (FAILED(hr)) {
      dx_error_ = "CreateTexture2D(export slot) failed: " + hex_u32(static_cast<unsigned long>(hr));
      destroy_dx_export_slot(slot);
      return false;
    }
    hr = slot.texture->QueryInterface(__uuidof(IDXGIKeyedMutex), reinterpret_cast<void**>(&slot.keyed_mutex));
    if (FAILED(hr) || !slot.keyed_mutex) {
      dx_error_ = "QueryInterface(IDXGIKeyedMutex) failed: " + hex_u32(static_cast<unsigned long>(hr));
      destroy_dx_export_slot(slot);
      return false;
    }
    IDXGIResource1* resource = nullptr;
    hr = slot.texture->QueryInterface(__uuidof(IDXGIResource1), reinterpret_cast<void**>(&resource));
    if (FAILED(hr) || !resource) {
      dx_error_ = "QueryInterface(IDXGIResource1) failed: " + hex_u32(static_cast<unsigned long>(hr));
      destroy_dx_export_slot(slot);
      return false;
    }
    hr = resource->CreateSharedHandle(
      nullptr,
      DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE,
      nullptr,
      &slot.shared_handle
    );
    resource->Release();
    if (FAILED(hr) || !slot.shared_handle) {
      dx_error_ = "CreateSharedHandle(export slot) failed: " + hex_u32(static_cast<unsigned long>(hr));
      destroy_dx_export_slot(slot);
      return false;
    }
    slot.width = width;
    slot.height = height;
    return true;
  }
#endif

  mpv_handle* handle_ = nullptr;
  mpv_render_context* render_context_ = nullptr;
  std::atomic<bool> alive_ = true;
  Napi::ThreadSafeFunction update_callback_;
  Napi::ThreadSafeFunction event_callback_;
  uint64_t next_observer_id_ = 1;
  std::string mode_ = "software";
  std::string option_error_;
  int64_t timestamp_us_ = 0;
  int64_t event_playlist_entry_id_ = -1;
#ifdef __APPLE__
  CGLContextObj gl_context_ = nullptr;
  IOSurfaceRef surface_ = nullptr;
  GLuint texture_ = 0;
  GLuint fbo_ = 0;
  int surface_width_ = 0;
  int surface_height_ = 0;
#endif
#ifdef _WIN32
  HWND win_hwnd_ = nullptr;
  HDC win_dc_ = nullptr;
  HGLRC win_gl_context_ = nullptr;
  ID3D11Device* d3d_device_ = nullptr;
  ID3D11DeviceContext* d3d_context_ = nullptr;
  ID3D11Texture2D* d3d_interop_texture_ = nullptr;
  std::array<DxExportSlot, 3> dx_export_slots_;
  int dx_slot_count_ = 3;
  int dx_next_slot_ = 0;
  HANDLE dx_interop_device_ = nullptr;
  HANDLE dx_interop_object_ = nullptr;
  GLuint win_gl_texture_ = 0;
  GLuint win_gl_fbo_ = 0;
  int dx_width_ = 0;
  int dx_height_ = 0;
  std::string dx_error_;
  std::array<std::atomic<bool>, 3> dx_slot_released_{};
  std::thread render_thread_;
  std::mutex render_mutex_;
  std::condition_variable render_cv_;
  std::deque<std::shared_ptr<SharedTextureRequest>> render_requests_;
  std::vector<std::shared_ptr<SharedTextureRequest>> abandoned_render_requests_;
  bool render_stopping_ = false;
  Napi::ThreadSafeFunction render_completion_;
  PFNGLGENFRAMEBUFFERSPROC glGenFramebuffers_ = nullptr;
  PFNGLBINDFRAMEBUFFERPROC glBindFramebuffer_ = nullptr;
  PFNGLFRAMEBUFFERTEXTURE2DPROC glFramebufferTexture2D_ = nullptr;
  PFNGLCHECKFRAMEBUFFERSTATUSPROC glCheckFramebufferStatus_ = nullptr;
  PFNGLDELETEFRAMEBUFFERSPROC glDeleteFramebuffers_ = nullptr;
  PFNWGLDXOPENDEVICENVPROC wglDXOpenDeviceNV_ = nullptr;
  PFNWGLDXCLOSEDEVICENVPROC wglDXCloseDeviceNV_ = nullptr;
  PFNWGLDXREGISTEROBJECTNVPROC wglDXRegisterObjectNV_ = nullptr;
  PFNWGLDXUNREGISTEROBJECTNVPROC wglDXUnregisterObjectNV_ = nullptr;
  PFNWGLDXLOCKOBJECTSNVPROC wglDXLockObjectsNV_ = nullptr;
  PFNWGLDXUNLOCKOBJECTSNVPROC wglDXUnlockObjectsNV_ = nullptr;
#endif
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  return MpvPlayer::Init(env, exports);
}

NODE_API_MODULE(mpv_addon, Init)

}  // namespace
