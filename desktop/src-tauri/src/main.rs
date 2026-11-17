// Spike: libmpv rendering BEHIND a transparent Tauri webview on macOS.
//
// Question being answered: can a Tauri window embed mpv (wid = the window's NSView) so the
// web UI (our stremio-web fork, which speaks the Stremio shell protocol) composites on top?
//
// Env knobs (all optional):
//   SPIKE_CLIP    path of a media file to auto-play on start
//   SPIKE_ZORDER  "below" = after mpv's view appears, move it below the WKWebView; default leaves mpv's default order
//   SPIKE_VO      mpv video output (default "gpu")
//   SPIKE_HWDEC   mpv hwdec (default "videotoolbox")
//   SPIKE_MPV_LOG file for mpv's own log
//   LIBMPV_PATH   libmpv.dylib location (default: Homebrew)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![cfg_attr(not(feature = "dev-tools"), allow(dead_code, unused_imports))]

mod glview;
mod home;
mod metal;
mod metalview;
mod mpv;
mod server;
mod shell;

use glview::Rect;

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Where the window starts, and (home mode) the public/local address pair to keep it on the best one.
struct Ui {
    start: String,
    home: Option<(String, String)>, // (public, local)
}

/// Start address and home-mode pair for a server. CINEMA_HOME_MODE=0 forces the public address only.
fn ui_for(public: &str, local: &str) -> Ui {
    let home = !local.is_empty() && std::env::var("CINEMA_HOME_MODE").map_or(true, |v| v != "0");
    if !home {
        return Ui { start: public.to_string(), home: None };
    }
    let start = if home::reachable(local) { local } else { public };
    Ui { start: start.to_string(), home: Some((public.to_string(), local.to_string())) }
}

/// Which server to open, in order: SPIKE_URL (development, no home mode), the one chosen in the app (server.json),
/// the one baked in at build time (CINEMA_ORIGIN, private builds). None = first run: show setup.html.
fn ui_config(app: &tauri::AppHandle) -> Option<Ui> {
    if let Ok(u) = std::env::var("SPIKE_URL") {
        return Some(Ui { start: u, home: None });
    }
    if let Some(s) = server::load(app) {
        if let Err(e) = server::allow(app, &s) {
            eprintln!("[server] could not grant the saved server: {e}");
            return None;
        }
        return Some(ui_for(&s.public, &s.local));
    }
    let public = env!("CINEMA_ORIGIN_BAKED");
    if public.contains("example.com") {
        return None;
    }
    Some(ui_for(public, env!("CINEMA_LOCAL_ORIGIN_BAKED")))
}

/// The bundled page that asks for the server address.
fn setup_url() -> tauri::Url {
    // the app's own pages are served from the tauri:// scheme on macOS
    "tauri://localhost/setup.html".parse().expect("static url")
}

#[tauri::command]
fn get_server(app: tauri::AppHandle) -> Option<server::Server> {
    server::load(&app)
}

/// Called by setup.html: validate, save, allow and open the server. `async` so the reachability check of the
/// home address does not block the main thread (which renders video).
#[tauri::command]
async fn set_server(app: tauri::AppHandle, public: String, local: String) -> Result<(), String> {
    let s = server::validate(&public, &local)?;
    server::save(&app, &s)?;
    server::allow(&app, &s)?;
    let ui = ui_for(&s.public, &s.local);
    let win = app.get_webview_window("main").ok_or("no window")?;
    win.navigate(ui.start.parse().map_err(|e| format!("bad address: {e}"))?).map_err(|e| e.to_string())?;
    if let Some((public, local)) = ui.home {
        home::spawn_watcher(app.clone(), public, local);
    }
    Ok(())
}

/// Menu: the standard macOS menus plus Server > Change Server… (forgets the saved address, shows setup.html).
fn build_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, Submenu};
    let menu = Menu::default(app.handle())?;
    let change = MenuItem::with_id(app, "change-server", "Change Server…", true, None::<&str>)?;
    menu.append(&Submenu::with_items(app, "Server", true, &[&change])?)?;
    Ok(menu)
}

/// Tell the user something important without a terminal (the app is normally launched from Finder).
fn notify_user(title: &str, message: &str) {
    let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "display dialog \"{}\" with title \"{}\" buttons {{\"OK\"}} default button \"OK\" with icon caution",
        esc(message),
        esc(title)
    );
    let _ = std::process::Command::new("osascript").args(["-e", &script]).spawn();
}

#[derive(Default)]
pub(crate) struct Player(pub(crate) Mutex<Option<Arc<mpv::Mpv>>>);

fn player(state: &State<Player>) -> Result<Arc<mpv::Mpv>, String> {
    state.0.lock().unwrap().clone().ok_or_else(|| "mpv not started yet".to_string())
}

fn wid_of(win: &WebviewWindow) -> Option<i64> {
    match win.window_handle().ok()?.as_raw() {
        RawWindowHandle::AppKit(h) => Some(h.ns_view.as_ptr() as i64),
        _ => None,
    }
}

/// Move every non-webview sibling (mpv's render view) below the WKWebView. Runs on the main thread.
fn reorder_below(win: &WebviewWindow) {
    let _ = win.with_webview(|wv| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let wk = wv.inner() as *mut AnyObject;
        let parent: *mut AnyObject = msg_send![wk, superview];
        let subviews: *mut AnyObject = msg_send![parent, subviews];
        let count: usize = msg_send![subviews, count];
        let mut movers = Vec::new();
        for i in 0..count {
            let v: *mut AnyObject = msg_send![subviews, objectAtIndex: i];
            let name = (*v).class().name().to_string_lossy().into_owned();
            eprintln!("[spike] subview[{i}] {name}{}", if v == wk { "  <- WKWebView" } else { "" });
            if v != wk {
                movers.push(v);
            }
        }
        for v in movers {
            // NSWindowBelow = -1
            let _: () = msg_send![parent, addSubview: v, positioned: -1isize, relativeTo: wk];
        }
        eprintln!("[spike] reordered: mpv view(s) now below the WKWebView");
    });
}

unsafe fn dump_view(v: *mut objc2::runtime::AnyObject, depth: usize) {
    use objc2::msg_send;
    use objc2::runtime::{AnyObject, Bool};
    let name = (*v).class().name().to_string_lossy().into_owned();
    let f: Rect = msg_send![v, frame];
    let hidden: Bool = msg_send![v, isHidden];
    let layer: *mut AnyObject = msg_send![v, layer];
    let lname = if layer.is_null() { "-".to_string() } else { (*layer).class().name().to_string_lossy().into_owned() };
    let opaque: Bool = msg_send![v, isOpaque];
    eprintln!(
        "[spike] {}{:p} {} frame=({:.0},{:.0},{:.0},{:.0}) hidden={} opaque={} layer={}",
        "  ".repeat(depth), v, name, f.x, f.y, f.w, f.h, hidden.as_bool(), opaque.as_bool(), lname
    );
    let subs: *mut AnyObject = msg_send![v, subviews];
    let n: usize = msg_send![subs, count];
    for i in 0..n {
        let c: *mut AnyObject = msg_send![subs, objectAtIndex: i];
        dump_view(c, depth + 1);
    }
}

fn dump_all(win: &WebviewWindow) {
    let _ = win.with_webview(|wv| unsafe {
        use objc2::msg_send;
        use objc2::runtime::{AnyObject, Bool};
        let w = wv.ns_window() as *mut AnyObject;
        let content: *mut AnyObject = msg_send![w, contentView];
        eprintln!("[spike] --- dump: this window {:p}, contentView {:p}, wk {:p}", w, content, wv.inner());
        dump_view(content, 0);
        let app: *mut AnyObject = msg_send![objc2::class!(NSApplication), sharedApplication];
        let windows: *mut AnyObject = msg_send![app, windows];
        let n: usize = msg_send![windows, count];
        eprintln!("[spike] NSApp windows: {n}");
        for i in 0..n {
            let ww: *mut AnyObject = msg_send![windows, objectAtIndex: i];
            let f: Rect = msg_send![ww, frame];
            let vis: Bool = msg_send![ww, isVisible];
            let num: isize = msg_send![ww, windowNumber];
            let cv: *mut AnyObject = msg_send![ww, contentView];
            let active_space: Bool = msg_send![ww, isOnActiveSpace];
            eprintln!(
                "[spike]   window#{num} {:p} {} frame=({:.0},{:.0},{:.0},{:.0}) visible={} onActiveSpace={} contentView={:p}",
                ww, (*ww).class().name().to_string_lossy(), f.x, f.y, f.w, f.h, vis.as_bool(), active_space.as_bool(), cv
            );
        }
    });
}

/// mpv ignores `wid` on macOS and opens its own NSWindow. Try the next best thing: make that window
/// borderless, size it to our content area and attach it as a child window ordered BELOW the
/// (transparent) Tauri window, so the window server stacks video under the web UI.
fn attach_mpv_window_below(win: &WebviewWindow) {
    let _ = win.with_webview(|wv| unsafe {
        use objc2::msg_send;
        use objc2::runtime::{AnyObject, Bool};
        let main = wv.ns_window() as *mut AnyObject;
        let app: *mut AnyObject = msg_send![objc2::class!(NSApplication), sharedApplication];
        let windows: *mut AnyObject = msg_send![app, windows];
        let n: usize = msg_send![windows, count];
        let frame: Rect = msg_send![main, frame];
        let content: Rect = msg_send![main, contentRectForFrameRect: frame];
        for i in 0..n {
            let ww: *mut AnyObject = msg_send![windows, objectAtIndex: i];
            let cls = (*ww).class().name().to_string_lossy().into_owned();
            let vis: Bool = msg_send![ww, isVisible];
            if ww == main || !vis.as_bool() || !cls.contains("swift.Window") {
                continue;
            }
            let _: () = msg_send![ww, setStyleMask: 0usize]; // borderless
            let _: () = msg_send![ww, setFrame: content, display: Bool::YES];
            let _: () = msg_send![ww, setIgnoresMouseEvents: Bool::YES];
            let _: () = msg_send![main, addChildWindow: ww, ordered: -1isize]; // NSWindowBelow
            eprintln!(
                "[spike] attached mpv window {:p} ({cls}) below main window; frame=({:.0},{:.0},{:.0},{:.0})",
                ww, content.x, content.y, content.w, content.h
            );
        }
    });
}

/// Keep child (mpv) windows glued to the main window's content rectangle after resize/move.
fn sync_child_windows(win: &WebviewWindow) {
    let _ = win.with_webview(|wv| unsafe {
        use objc2::msg_send;
        use objc2::runtime::{AnyObject, Bool};
        let main = wv.ns_window() as *mut AnyObject;
        let frame: Rect = msg_send![main, frame];
        let content: Rect = msg_send![main, contentRectForFrameRect: frame];
        let kids: *mut AnyObject = msg_send![main, childWindows];
        if kids.is_null() {
            return;
        }
        let n: usize = msg_send![kids, count];
        for i in 0..n {
            let k: *mut AnyObject = msg_send![kids, objectAtIndex: i];
            let _: () = msg_send![k, setFrame: content, display: Bool::YES];
        }
    });
}

/// Capture what the window server actually shows in the main window's rectangle (all of OUR windows,
/// in real stacking order). Other apps' windows are not captured without Screen Recording permission.
fn snapshot_region(win: &WebviewWindow, base: String) {
    let _ = win.with_webview(move |wv| unsafe {
        use core_graphics::display::{CGDisplay, CGPoint, CGRect, CGSize};
        use core_graphics::window::{kCGWindowImageDefault, kCGWindowListOptionOnScreenOnly};
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let main = wv.ns_window() as *mut AnyObject;
        let frame: Rect = msg_send![main, frame];
        let content: Rect = msg_send![main, contentRectForFrameRect: frame];
        let screens: *mut AnyObject = msg_send![objc2::class!(NSScreen), screens];
        let primary: *mut AnyObject = msg_send![screens, objectAtIndex: 0usize];
        let pf: Rect = msg_send![primary, frame];
        let cg = CGRect::new(
            &CGPoint::new(content.x, pf.h - (content.y + content.h)),
            &CGSize::new(content.w, content.h),
        );
        match CGDisplay::screenshot(cg, kCGWindowListOptionOnScreenOnly, 0, kCGWindowImageDefault) {
            Some(img) => {
                let (wpx, hpx, bpr) = (img.width(), img.height(), img.bytes_per_row());
                let data = img.data();
                let bytes = data.bytes();
                let mut out = Vec::with_capacity(wpx * hpx * 4);
                for row in 0..hpx {
                    out.extend_from_slice(&bytes[row * bpr..row * bpr + wpx * 4]);
                }
                let _ = std::fs::write(format!("{base}.bgra"), out);
                let _ = std::fs::write(format!("{base}.txt"), format!("{wpx}x{hpx}"));
                eprintln!("[spike] region snapshot {base} {wpx}x{hpx}");
            }
            None => eprintln!("[spike] region snapshot failed"),
        }
    });
}

/// Grab the composited window (web UI + native video as the window server sees them) and write
/// raw BGRA + a .txt with the geometry. An app may read its own windows without Screen Recording
/// permission; ffmpeg turns the raw dump into a PNG afterwards.
fn snapshot(win: &WebviewWindow, base: String) {
    let _ = win.with_webview(move |wv| unsafe {
        use core_graphics::display::{CGDisplay, CGPoint, CGRect, CGSize};
        use core_graphics::window::{kCGWindowImageBoundsIgnoreFraming, kCGWindowListOptionIncludingWindow};
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let w = wv.ns_window() as *mut AnyObject;
        let num: isize = msg_send![w, windowNumber];
        let null_rect = CGRect::new(&CGPoint::new(f64::INFINITY, f64::INFINITY), &CGSize::new(0.0, 0.0));
        match CGDisplay::screenshot(
            null_rect,
            kCGWindowListOptionIncludingWindow,
            num as u32,
            kCGWindowImageBoundsIgnoreFraming,
        ) {
            Some(img) => {
                let (wpx, hpx, bpr) = (img.width(), img.height(), img.bytes_per_row());
                let data = img.data();
                let bytes = data.bytes();
                // repack to tightly packed BGRA
                let mut out = Vec::with_capacity(wpx * hpx * 4);
                for row in 0..hpx {
                    out.extend_from_slice(&bytes[row * bpr..row * bpr + wpx * 4]);
                }
                let _ = std::fs::write(format!("{base}.bgra"), out);
                let _ = std::fs::write(format!("{base}.txt"), format!("{wpx}x{hpx}"));
                eprintln!("[spike] snapshot {base} {wpx}x{hpx} (window {num})");
            }
            None => eprintln!("[spike] snapshot failed (window {num})"),
        }
    });
}

fn status(m: &mpv::Mpv) -> serde_json::Value {
    let props = [
        "time-pos", "pause", "vo-configured", "current-vo", "current-gpu-context", "hwdec-current",
        "video-format", "video-params/pixelformat", "video-params/w", "video-params/h",
        "audio-codec-name", "estimated-vf-fps", "mpv-version",
        "frame-drop-count", "decoder-frame-drop-count", "vo-delayed-frame-count", "paused-for-cache",
        "file-format", "duration", "audio-params/hr-channels",
    ];
    let mut o = serde_json::Map::new();
    for p in props {
        o.insert(p.to_string(), m.get_property(p).map(Into::into).unwrap_or(serde_json::Value::Null));
    }
    serde_json::Value::Object(o)
}

#[tauri::command]
async fn mpv_load(state: State<'_, Player>, path: String) -> Result<(), String> {
    player(&state)?.command(&["loadfile".into(), path, "replace".into()])
}

#[tauri::command]
async fn mpv_command(state: State<'_, Player>, args: Vec<String>) -> Result<(), String> {
    player(&state)?.command(&args)
}

#[tauri::command]
async fn mpv_status(state: State<'_, Player>) -> Result<serde_json::Value, String> {
    let m = player(&state)?;
    Ok(status(&m))
}

/// The chrome.webview look-alike posts here. `async` so it runs on the thread pool, never the main
/// thread (which renders video and must not make non-render libmpv calls).
#[tauri::command]
async fn shell_ipc(app: tauri::AppHandle, window: WebviewWindow, msg: String) -> Result<(), String> {
    shell::handle(&app, &window, &msg);
    Ok(())
}

#[tauri::command]
fn spike_reorder(window: WebviewWindow) {
    reorder_below(&window);
}

#[tauri::command]
fn metalfx_toggle(enable: bool) -> Result<metalview::MetalFXBridgeStatus, String> {
    if !metalview::is_supported() {
        return Err("Apple MetalFX is not supported on this device".into());
    }
    eprintln!("[metalfx] metalfx_toggle command: {enable}");
    metal::set_active(enable);
    metalview::kick();
    Ok(metalview::get_status())
}

#[tauri::command]
fn metalfx_status() -> metalview::MetalFXBridgeStatus {
    metalview::get_status()
}

/// Development only (cargo feature `dev-tools`, on by default, off for release builds): a file-based command
/// channel for tests (snap | reorder | mpv <args> | eval <js> | quit ...). It can drive the logged-in page, so it
/// must never ship.
#[cfg(feature = "dev-tools")]
fn dev_tools_loop(handle: &tauri::AppHandle, m: &Arc<mpv::Mpv>) {
    // Test harness: poll a command file so a test run needs no GUI automation.
    //   snap <name> | reorder | mpv <args...> | eval <js> | quit
    let cmd_file = std::env::var("SPIKE_CMD_FILE").ok();
    let snap_dir = std::env::var("SPIKE_SNAP_DIR").unwrap_or_else(|_| "/tmp".into());
    let mut ticks = 0u32;
    loop {
        std::thread::sleep(Duration::from_millis(500));
        ticks += 1;
        let Some(w) = handle.get_webview_window("main") else { continue };
        if ticks == 8 && std::env::var("SPIKE_ZORDER").as_deref() == Ok("below") {
            reorder_below(&w);
        }
        if ticks % 4 == 0 {
            eprintln!("[spike] status {}", status(m));
        }
        if let Some(cf) = &cmd_file {
            if let Ok(text) = std::fs::read_to_string(cf) {
                let _ = std::fs::remove_file(cf);
                for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
                    let (verb, rest) = line.split_once(' ').unwrap_or((line, ""));
                    eprintln!("[spike] cmd {line}");
                    match verb {
                        "snap" => snapshot(&w, format!("{snap_dir}/{rest}")),
                        "reorder" => reorder_below(&w),
                        "dump" => dump_all(&w),
                        "attach" => attach_mpv_window_below(&w),
                        "aux" => {
                            let _ = w.with_webview(|wv| unsafe {
                                use objc2::msg_send;
                                use objc2::runtime::AnyObject;
                                let main = wv.ns_window() as *mut AnyObject;
                                let kids: *mut AnyObject = msg_send![main, childWindows];
                                let n: usize = msg_send![kids, count];
                                for i in 0..n {
                                    let k: *mut AnyObject = msg_send![kids, objectAtIndex: i];
                                    // NSWindowCollectionBehaviorFullScreenAuxiliary
                                    let _: () = msg_send![k, setCollectionBehavior: 256usize];
                                }
                                eprintln!("[spike] fullScreenAuxiliary set on {n} child window(s)");
                            });
                        }
                        "hide" => {
                            let _ = w.hide();
                        }
                        "show" => {
                            let _ = w.show();
                        }
                        "minimize" => {
                            let _ = w.minimize();
                        }
                        "unminimize" => {
                            let _ = w.unminimize();
                        }
                        "simplefs" => {
                            let _ = w.set_simple_fullscreen(rest == "on");
                        }
                        "resize" => {
                            let v: Vec<f64> = rest.split_whitespace().filter_map(|x| x.parse().ok()).collect();
                            if v.len() == 2 {
                                let _ = w.set_size(tauri::LogicalSize::new(v[0], v[1]));
                            }
                        }
                        "fullscreen" => {
                            let _ = w.set_fullscreen(rest == "on");
                        }
                        "region" => snapshot_region(&w, format!("{snap_dir}/{rest}")),
                        "mpv" => {
                            let args: Vec<String> = rest.split_whitespace().map(String::from).collect();
                            if let Err(e) = m.command(&args) {
                                eprintln!("[spike] mpv cmd error: {e}");
                            }
                        }
                        "eval" => {
                            let _ = w.eval(rest);
                        }
                        "quit" => std::process::exit(0),
                        _ => eprintln!("[spike] unknown cmd"),
                    }
                    // let the window server catch up between a command and the next snapshot
                    std::thread::sleep(Duration::from_millis(800));
                }
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Player::default())
        .manage(shell::ShellState::default())
        .on_window_event(|window, event| {
            use tauri::WindowEvent;
            if matches!(event, WindowEvent::Resized(_) | WindowEvent::Moved(_)) {
                if let Some(w) = window.app_handle().get_webview_window(window.label()) {
                    sync_child_windows(&w);
                }
                if let Some(w) = window.app_handle().get_webview_window(window.label()) {
                    shell::window_state_changed(window.app_handle(), &w);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            mpv_load,
            mpv_command,
            mpv_status,
            spike_reorder,
            shell_ipc,
            get_server,
            set_server,
            metalfx_toggle,
            metalfx_status
        ])
        .on_menu_event(|app, event| {
            if event.id() == "change-server" {
                server::clear(app);
                home::stop_watcher();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.navigate(setup_url());
                }
            }
        })
        .setup(|app| {
            app.set_menu(build_menu(app)?)?;
            let ui = ui_config(app.handle());
            // SPIKE_LOCAL_PAGE: the spike's own overlay page (development). Everything else is treated as remote
            // content: hardened mpv, render API, no mpv log file.
            let spike_page = ui.is_none() && std::env::var("SPIKE_LOCAL_PAGE").is_ok();
            let remote = !spike_page;
            let target = match &ui {
                Some(u) => WebviewUrl::External(u.start.parse().map_err(|e| format!("bad web UI URL: {e}"))?),
                None if spike_page => WebviewUrl::App("index.html".into()),
                None => WebviewUrl::App("setup.html".into()),
            };
            let mut builder = WebviewWindowBuilder::new(app, "main", target)
                .title("HomeBot Cinema")
                .inner_size(1280.0, 760.0)
                .min_inner_size(640.0, 400.0)
                .transparent(true)
                .initialization_script(shell::SHIM);
            if remote && std::env::var("SPIKE_INCOGNITO").is_ok() {
                builder = builder.incognito(true); // opt-in: fresh storage for this run
            }
            let win = builder.build()?;
            if let Some((public, local)) = ui.and_then(|u| u.home) {
                home::spawn_watcher(app.handle().clone(), public, local);
            }
            let wid = wid_of(&win).ok_or("no AppKit window handle")?;
            eprintln!("[spike] wid (contentView NSView*) = {wid:#x}");
            let legacy_gl = std::env::var("SPIKE_LEGACY_GL").is_ok();
            let render_mode = remote || std::env::var("SPIKE_RENDER").is_ok();
            if render_mode {
                if legacy_gl {
                    let _ = win.with_webview(|wv| unsafe { glview::install(wv.inner() as *mut objc2::runtime::AnyObject) });
                } else {
                    let _ = win.with_webview(|wv| unsafe { metalview::install(wv.inner() as *mut objc2::runtime::AnyObject) });
                }
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1200));
                let mut opts: Vec<(&str, String)> = vec![
                    ("wid", wid.to_string()),
                    ("vo", std::env::var("SPIKE_VO").unwrap_or_else(|_| "gpu".into())),
                    ("hwdec", std::env::var("SPIKE_HWDEC").unwrap_or_else(|_| "videotoolbox".into())),
                    ("idle", "yes".into()),
                    ("keep-open", if remote { "no".into() } else { "yes".into() }),
                    ("osc", "no".into()),
                    ("input-default-bindings", "no".into()),
                    ("input-vo-keyboard", "no".into()),
                    ("msg-level", if remote { "all=warn".into() } else { "all=v".into() }), // verbose mpv logs would record property values such as the Cookie header
                ];
                // mpv's log-file records EVERYTHING (it ignores msg-level), including the Cookie header we hand
                // it, so never write one when the page is remote. Dev builds only.
                #[cfg(feature = "dev-tools")]
                if !remote {
                    if let Ok(f) = std::env::var("SPIKE_MPV_LOG") {
                        opts.push(("log-file", f));
                    }
                }
                if let Ok(c) = std::env::var("SPIKE_GPU_CONTEXT") {
                    opts.push(("gpu-context", c));
                }
                if render_mode {
                    // libmpv render API: no wid, no own window; we draw the frames ourselves.
                    opts.retain(|(k, _)| *k != "wid" && *k != "vo");
                    opts.push(("vo", "libmpv".to_string()));
                }
                if std::env::var("SPIKE_NO_WID").is_ok() {
                    opts.retain(|(k, _)| *k != "wid");
                    for kv in [("border", "no"), ("ontop", "no"), ("keepaspect-window", "no"), ("focus-on", "never"), ("auto-window-resize", "no")] {
                        opts.push((kv.0, kv.1.to_string()));
                    }
                }
                // Hardening (the page is remote content): no scripts / youtube-dl hook. If this libmpv rejects an
                // option, retry without rather than failing to start.
                let mut hardened = opts.clone();
                hardened.push(("ytdl", "no".to_string()));
                hardened.push(("load-scripts", "no".to_string()));
                let m = match mpv::Mpv::new(&hardened).or_else(|e| {
                    eprintln!("[spike] mpv init with hardening failed ({e}); retrying without");
                    mpv::Mpv::new(&opts)
                }) {
                    Ok(m) => Arc::new(m),
                    Err(e) => {
                        eprintln!("[spike] mpv init failed: {e}");
                        notify_user(
                            "HomeBot Cinema can't play video",
                            &format!("libmpv could not be loaded, so playback is unavailable.\n\nInstall it with:  brew install mpv\n\n({e})"),
                        );
                        return;
                    }
                };
                *handle.state::<Player>().0.lock().unwrap() = Some(m.clone());
                shell::spawn_event_loop(handle.clone(), m.clone());
                eprintln!("[spike] mpv initialised");
                if render_mode {
                    if legacy_gl {
                        let _ = glview::MPV.set(m.clone());
                        glview::kick(); // first draw creates the render context with the GL context current
                        let t0 = std::time::Instant::now();
                        while !glview::render_ready() && t0.elapsed() < Duration::from_secs(6) {
                            std::thread::sleep(Duration::from_millis(50));
                        }
                        eprintln!("[spike] render context ready={} after {} ms (legacy GL)", glview::render_ready(), t0.elapsed().as_millis());
                    } else {
                        let _ = metalview::MPV.set(m.clone());
                        metalview::kick(); // first draw creates the render context with CGL/MetalFX
                        let t0 = std::time::Instant::now();
                        while !metalview::render_ready() && t0.elapsed() < Duration::from_secs(6) {
                            std::thread::sleep(Duration::from_millis(50));
                        }
                        eprintln!("[metalfx] render context ready={} after {} ms (MetalFX/CAMetalLayer)", metalview::render_ready(), t0.elapsed().as_millis());
                    }
                }
                if let Ok(clip) = std::env::var("SPIKE_CLIP") {
                    if let Err(e) = m.command(&["loadfile".into(), clip, "replace".into()]) {
                        eprintln!("[spike] loadfile failed: {e}");
                    }
                }
                #[cfg(feature = "dev-tools")]
                dev_tools_loop(&handle, &m);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the spike");
}
