//! Stremio v5 shell protocol as spoken by the web UI (`src/common/Platform/shell/useShell.ts`) and
//! stremio-video 0.0.98's `ShellVideo`: JSON messages over a `chrome.webview` look-alike (see
//! shell_shim.js), mapped onto libmpv.
//!
//! Threading rules (libmpv render.h): the video is rendered on the main thread, so NO libmpv call
//! other than `mpv_render_*` may run there. `shell_ipc` is therefore an `async` Tauri command (thread
//! pool), and all mpv events are read on one dedicated thread.

use crate::mpv::{self, Mpv};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::ffi::CStr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewWindow};

pub const SHIM: &str = include_str!("shell_shim.js");

/// When the last `loadfile` was sent, and to which address (for the start-latency log line).
static LOADED_AT: Mutex<Option<(Instant, String)>> = Mutex::new(None);
const SHELL_VERSION: &str = "5.0.0-spike";

#[derive(Default)]
pub struct ShellState {
    /// Properties already observed in mpv (never observe twice: events would multiply).
    observed: Mutex<HashSet<String>>,
    /// Last value seen per observed property, re-sent when a new ShellVideo instance re-observes.
    last: Mutex<HashMap<String, Value>>,
    visibility: Mutex<Option<(bool, bool, bool)>>,
}

// ---- web -> native -----------------------------------------------------------------------------

pub fn handle(app: &AppHandle, window: &WebviewWindow, msg: &str) {
    let Ok(v) = serde_json::from_str::<Value>(msg) else {
        eprintln!("[shell] message is not JSON: {msg}");
        return;
    };
    match v.get("type").and_then(Value::as_i64) {
        Some(3) => send_init(app, window),
        Some(6) => {
            let Some(args) = v.get("args").and_then(Value::as_array) else { return };
            let Some(method) = args.first().and_then(Value::as_str) else { return };
            invoke(app, window, method, &args[1..]);
        }
        other => eprintln!("[shell] unhandled message type {other:?}"),
    }
}

fn invoke(app: &AppHandle, window: &WebviewWindow, method: &str, args: &[Value]) {
    match method {
        "mpv-command" => {
            let Some(list) = args.first().and_then(Value::as_array) else { return };
            let mut strs: Vec<String> = list.iter().map(to_mpv_string).collect();
            // The page is remote content: never let it run arbitrary mpv commands (`run`, `subprocess`, ...).
            // ShellVideo only ever sends `stop` and `loadfile <url> [replace [-1]] [start=+N]`.
            match strs.first().map(String::as_str) {
                Some("stop") if strs.len() == 1 => {}
                Some("loadfile") => {
                    let ok_url = strs.get(1).map_or(false, |u| allowed_stream_url(u));
                    let ok_opts = strs.iter().skip(2).all(|a| a == "replace" || a == "-1" || is_start_option(a));
                    if !ok_url || !ok_opts || strs.len() > 5 {
                        eprintln!("[shell] REFUSED loadfile (only http/https URLs and start=+N are allowed)");
                        return;
                    }
                    strs[1] = direct_play_url(window, &strs[1]);
                    let via = tauri::Url::parse(&strs[1]).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_default();
                    *LOADED_AT.lock().unwrap() = Some((Instant::now(), via));
                    set_auth_header(app, window, &strs[1]);
                }
                other => {
                    eprintln!("[shell] REFUSED mpv-command {other:?}");
                    return;
                }
            }
            eprintln!("[shell] mpv-command {}", redact(&strs));
            if let Some(m) = mpv(app) {
                if let Err(e) = m.command(&strs) {
                    eprintln!("[shell] mpv-command failed: {e}");
                }
            }
        }
        "mpv-set-prop" => {
            let Some(pair) = args.first().and_then(Value::as_array) else { return };
            let (Some(name), Some(value)) = (pair.first().and_then(Value::as_str), pair.get(1)) else { return };
            if !ALLOWED_PROPS.contains(&name) {
                eprintln!("[shell] REFUSED mpv-set-prop {name}");
                return;
            }
            set_prop(app, name, value);
        }
        "mpv-observe-prop" => {
            let Some(name) = args.first().and_then(Value::as_str) else { return };
            observe(app, name);
        }
        "mpv-set-gpu-video-processing" => {} // d3d11 only
        "win-set-visibility" => {
            if let Some(fs) = args.first().and_then(|a| a.get("fullscreen")).and_then(Value::as_bool) {
                eprintln!("[shell] win-set-visibility fullscreen={fs}");
                let _ = window.set_fullscreen(fs);
                // The window event normally reports it; this is the backstop.
                let (app, w) = (app.clone(), window.clone());
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(900));
                    window_state_changed(&app, &w);
                });
            }
        }
        "app-ready" => eprintln!("[shell] app-ready"),
        "quit" => app.exit(0),
        // accepted and ignored in the spike
        "media.status" | "media.metadata" | "win-set-interface-scale" | "autoupdater-notif-clicked"
        | "pick-cache-directory" => {}
        other => eprintln!("[shell] unhandled method {other}: {args:?}"),
    }
}

/// Properties ShellVideo 0.0.98 sets; anything else is refused.
const ALLOWED_PROPS: &[&str] = &[
    "sub-ass-override", "hwdec", "vo", "osc", "input-default-bindings", "input-vo-keyboard", "pause", "speed",
    "aid", "sid", "mute", "volume", "time-pos", "keepaspect", "panscan", "sub-ass-force-margins", "sub-scale",
    "sub-pos", "sub-delay", "sub-color", "sub-back-color", "sub-border-color",
];

fn allowed_stream_url(u: &str) -> bool {
    tauri::Url::parse(u).map_or(false, |p| (p.scheme() == "http" || p.scheme() == "https") && p.host_str().is_some())
}

fn is_start_option(a: &str) -> bool {
    a.strip_prefix("start=+").map_or(false, |n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
}

/// The web UI asks for `/api/downloads/stream/<id>/video.mp4`, which for MKV/AVI makes the server swap in an MP4
/// sibling (or live-remux with ffmpeg, and start a background remux that writes a new multi-GB file). mpv plays
/// the original file with every track, so ask for `direct=1` (server: original bytes, Range support, no remux
/// side effects). The rewrite happens here, at mpv's `loadfile`, on purpose: the URL the web UI stores with
/// watch progress stays the universal one, so continuing on a browser or phone still plays.
/// Same-origin library streams only.
fn direct_play_url(window: &WebviewWindow, stream_url: &str) -> String {
    let (Ok(page), Ok(mut u)) = (window.url(), tauri::Url::parse(stream_url)) else { return stream_url.to_string() };
    let same_origin = page.scheme() == u.scheme() && page.host_str() == u.host_str() && page.port() == u.port();
    if same_origin && u.path().starts_with("/api/downloads/stream/") && !u.query_pairs().any(|(k, _)| k == "direct") {
        // Cloudflare drops the query string on URLs ending in `.mp4` unless the path ends with a slash (the same
        // reason server/streamlinks.js emits `video.mp4/?exp&sig`); the Express route matches both forms.
        if !u.path().ends_with('/') {
            let p = format!("{}/", u.path());
            u.set_path(&p);
        }
        u.query_pairs_mut().append_pair("direct", "1");
        eprintln!("[shell] library stream: requesting the original file (direct=1)");
        return u.to_string();
    }
    stream_url.to_string()
}

/// Keep stream URLs (which can carry tokens) out of the logs.
fn redact(strs: &[String]) -> String {
    strs.iter()
        .map(|a| match tauri::Url::parse(a) {
            Ok(u) if u.host_str().is_some() => format!("{}://{}/…", u.scheme(), u.host_str().unwrap()),
            _ => a.clone(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// mpv does its own HTTP requests and does not share the web view's cookies. When the stream is on the
/// same origin as the page (e.g. https://cinema.example.com/streaming/...), hand it the Cloudflare Access
/// cookie as a header; for any other host send nothing (so the cookie cannot leak via a redirect target).
fn set_auth_header(app: &AppHandle, window: &WebviewWindow, stream_url: &str) {
    let Some(m) = mpv(app) else { return };
    let mut header = String::new();
    if let (Ok(page), Ok(stream)) = (window.url(), tauri::Url::parse(stream_url)) {
        if page.scheme() == stream.scheme() && page.host_str() == stream.host_str() && page.port() == stream.port() {
            match window.cookies_for_url(page.clone()) {
                Ok(cookies) => {
                    if let Some(c) = cookies.iter().find(|c| c.name() == "CF_Authorization") {
                        header = format!("Cookie: CF_Authorization={}", c.value());
                        eprintln!("[shell] same-origin stream: passing CF_Authorization to mpv");
                    }
                }
                Err(e) => eprintln!("[shell] cookies_for_url failed: {e}"),
            }
        }
    }
    if let Err(e) = m.set_property("http-header-fields", &header) {
        eprintln!("[shell] http-header-fields: {e}");
    }
}

fn mpv(app: &AppHandle) -> Option<Arc<Mpv>> {
    app.state::<crate::Player>().0.lock().unwrap().clone()
}

/// JSON value -> the string form libmpv expects for command arguments and property values.
fn to_mpv_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => if *b { "yes".into() } else { "no".into() },
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

fn set_prop(app: &AppHandle, name: &str, value: &Value) {
    let value = match name {
        // The VO (and its render context) belongs to the shell and is fixed at init.
        "vo" => return,
        // ShellVideo asks for auto-copy on non-Windows; zero-copy VideoToolbox is what the GL path supports.
        "hwdec" => match value.as_str() {
            Some("no") => "no".to_string(),
            _ => "videotoolbox".to_string(),
        },
        _ => to_mpv_string(value),
    };
    eprintln!("[shell] mpv-set-prop {name}={value}");
    if let Some(m) = mpv(app) {
        if let Err(e) = m.set_property(name, &value) {
            eprintln!("[shell] set-prop {name} failed: {e}");
        }
    }
}

fn observe(app: &AppHandle, name: &str) {
    let st = app.state::<ShellState>();
    let first = {
        let mut obs = st.observed.lock().unwrap();
        if obs.contains(name) {
            false
        } else if let Some(m) = mpv(app) {
            match m.observe_node(name) {
                Ok(()) => {
                    obs.insert(name.to_string());
                    true
                }
                Err(e) => {
                    eprintln!("[shell] {e}");
                    return;
                }
            }
        } else {
            eprintln!("[shell] observe {name}: mpv not ready");
            return;
        }
    };
    if !first {
        // A new ShellVideo instance re-observes everything: hand it the current value right away
        // (it waits for `mpv-version` before it will load anything).
        let cached = st.last.lock().unwrap().get(name).cloned();
        if let Some(val) = cached {
            emit_prop(app, name, val);
        }
    }
}

fn send_init(app: &AppHandle, window: &WebviewWindow) {
    let props = [
        ("shellVersion", SHELL_VERSION),
        ("gpuVideoProcessing", "false"),
        ("nativeAssSubtitles", "false"),
        ("cacheDirectoryPicker", "false"),
        ("nativeInterfaceScale", "false"),
    ];
    let props: Vec<Value> = props.iter().enumerate().map(|(i, (k, v))| json!([i, k, [], v])).collect();
    dispatch_raw(app, &json!({ "id": 0, "type": 3, "data": { "transport": { "properties": props } } }));
    eprintln!("[shell] INIT answered");
    window_state_changed(app, window);
}

// ---- native -> web -----------------------------------------------------------------------------

fn dispatch_raw(app: &AppHandle, msg: &Value) {
    if let Some(w) = app.get_webview_window("main") {
        let lit = serde_json::to_string(&msg.to_string()).unwrap();
        let _ = w.eval(format!("window.__shellDispatch&&window.__shellDispatch({lit})"));
    }
}

pub fn emit(app: &AppHandle, method: &str, arg: Value) {
    dispatch_raw(app, &json!({ "id": 0, "type": 1, "args": [method, arg] }));
}

fn emit_prop(app: &AppHandle, name: &str, data: Value) {
    emit(app, "mpv-prop-change", json!({ "name": name, "data": data }));
}

/// Report fullscreen / minimized / visible changes the way the Qt shell does
/// (`win-visibility-changed`: Qt visibility 2 windowed, 3 minimized, 5 fullscreen, 0 hidden).
pub fn window_state_changed(app: &AppHandle, w: &WebviewWindow) {
    let fullscreen = w.is_fullscreen().unwrap_or(false);
    let minimized = w.is_minimized().unwrap_or(false);
    let visible = w.is_visible().unwrap_or(true);
    let st = app.state::<ShellState>();
    {
        let mut last = st.visibility.lock().unwrap();
        if *last == Some((fullscreen, minimized, visible)) {
            return;
        }
        *last = Some((fullscreen, minimized, visible));
    }
    let visibility = if !visible { 0 } else if minimized { 3 } else if fullscreen { 5 } else { 2 };
    eprintln!("[shell] window state: fullscreen={fullscreen} minimized={minimized} visible={visible}");
    emit(app, "win-visibility-changed", json!({ "visible": visible, "visibility": visibility, "isFullscreen": fullscreen }));
    emit(app, "win-state-changed", json!({ "state": if minimized || !visible { 9 } else { 0 } }));
}

// ---- mpv events --------------------------------------------------------------------------------

unsafe fn node_to_json(n: *const mpv::Node) -> Value {
    if n.is_null() {
        return Value::Null;
    }
    match (*n).format {
        mpv::FORMAT_STRING => Value::String(CStr::from_ptr((*n).u.string).to_string_lossy().into_owned()),
        mpv::FORMAT_FLAG => Value::Bool((*n).u.flag != 0),
        mpv::FORMAT_INT64 => json!((*n).u.int64),
        mpv::FORMAT_DOUBLE => serde_json::Number::from_f64((*n).u.double).map(Value::Number).unwrap_or(Value::Null),
        mpv::FORMAT_NODE_ARRAY => {
            let l = &*(*n).u.list;
            Value::Array((0..l.num as usize).map(|i| node_to_json(l.values.add(i))).collect())
        }
        mpv::FORMAT_NODE_MAP => {
            let l = &*(*n).u.list;
            let mut m = Map::new();
            for i in 0..l.num as usize {
                let k = CStr::from_ptr(*l.keys.add(i)).to_string_lossy().into_owned();
                m.insert(k, node_to_json(l.values.add(i)));
            }
            Value::Object(m)
        }
        _ => Value::Null,
    }
}

/// "mpv v0.42.0" -> "0.42.0" (ShellVideo parses major.minor with parseInt; a prefix gives NaN and
/// silently breaks resume-from-position on mpv >= 0.39).
fn clean_version(s: &str) -> String {
    let start = s.find(|c: char| c.is_ascii_digit()).unwrap_or(0);
    s[start..].split(|c: char| !(c.is_ascii_digit() || c == '.')).next().unwrap_or("").to_string()
}

pub fn spawn_event_loop(app: AppHandle, mpv: Arc<Mpv>) {
    std::thread::spawn(move || {
        // time-pos / demuxer-cache-time change on every frame; ShellVideo only updates the UI about once a
        // second. Coalesce to <= 4/s but always deliver the latest value (trailing edge) so a seek while
        // paused is not lost.
        let mut pending: HashMap<String, Value> = HashMap::new();
        let mut last_emit: HashMap<String, Instant> = HashMap::new();
        loop {
            let ev = unsafe { mpv.wait_event(0.1) };
            if !ev.is_null() {
                let e = unsafe { &*ev };
                match e.event_id {
                    mpv::EVENT_SHUTDOWN => break,
                    mpv::EVENT_PROPERTY_CHANGE => unsafe {
                        let p = &*(e.data as *const mpv::EventProperty);
                        let name = CStr::from_ptr(p.name).to_string_lossy().into_owned();
                        let st = app.state::<ShellState>();
                        if p.format == mpv::FORMAT_NODE {
                            let mut value = node_to_json(p.data as *const mpv::Node);
                            if name == "mpv-version" {
                                if let Some(s) = value.as_str() {
                                    value = Value::String(clean_version(s));
                                }
                            }
                            if name == "time-pos" && value.as_f64().is_some() {
                                if let Some((t0, via)) = LOADED_AT.lock().unwrap().take() {
                                    eprintln!("[shell] start latency: {} ms from loadfile to first playback position (via {via})", t0.elapsed().as_millis());
                                }
                            }
                            st.last.lock().unwrap().insert(name.clone(), value.clone());
                            if name == "time-pos" || name == "demuxer-cache-time" {
                                pending.insert(name, value);
                            } else {
                                pending.remove(&name);
                                emit_prop(&app, &name, value);
                            }
                        } else {
                            // property became unavailable (e.g. time-pos after stop): forget it
                            st.last.lock().unwrap().remove(&name);
                            pending.remove(&name);
                        }
                    },
                    mpv::EVENT_END_FILE => unsafe {
                        let ef = &*(e.data as *const mpv::EventEndFile);
                        let payload = match ef.reason {
                            0 => json!({ "reason": "eof" }),
                            2 => json!({ "reason": "stop" }),
                            3 => json!({ "reason": "quit" }),
                            4 => json!({ "reason": "error", "error": { "code": 2, "message": mpv.error_text(ef.error), "critical": true } }),
                            5 => json!({ "reason": "redirect" }),
                            _ => json!({ "reason": "other" }),
                        };
                        eprintln!("[shell] mpv end-file {payload}");
                        emit(&app, "mpv-event-ended", payload);
                    },
                    _ => {}
                }
            }
            let now = Instant::now();
            let due: Vec<String> = pending
                .keys()
                .filter(|k| last_emit.get(*k).map_or(true, |t| now.duration_since(*t) >= Duration::from_millis(250)))
                .cloned()
                .collect();
            for k in due {
                if let Some(v) = pending.remove(&k) {
                    emit_prop(&app, &k, v);
                    last_emit.insert(k, now);
                }
            }
        }
    });
}
