//! Apple MetalFX render pipeline drawing into a `CAMetalLayer` that lives in an NSView
//! placed BELOW the WKWebView, inside the same window.
//!
//! Replaces legacy NSOpenGLLayer with modern CAMetalLayer and an IOSurface-backed FBO
//! for zero-copy rendering between libmpv (OpenGL/VideoToolbox) and Apple MetalFX.

use crate::metal::{
    self, metalfx_create_layer, metalfx_create_renderer, metalfx_destroy_renderer,
    metalfx_get_cgl_context, metalfx_get_status, metalfx_is_supported, metalfx_kick,
    metalfx_prepare_input_fbo, metalfx_present_frame, metalfx_set_draw_callback,
};
pub use crate::metal::MetalFXBridgeStatus;
use crate::mpv::Mpv;
use libloading::Library;
use objc2::rc::{Allocated, Retained};
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};
use std::ffi::{c_char, c_int, c_void, CStr};
use std::ptr::null_mut;
use std::sync::atomic::{AtomicPtr, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
unsafe impl objc2::Encode for Rect {
    const ENCODING: objc2::Encoding = objc2::Encoding::Struct(
        "CGRect",
        &[
            objc2::Encoding::Struct("CGPoint", &[objc2::Encoding::Double, objc2::Encoding::Double]),
            objc2::Encoding::Struct("CGSize", &[objc2::Encoding::Double, objc2::Encoding::Double]),
        ],
    );
}

// ---- mpv render API structs (render.h / render_gl.h) -------------------------------------------
const PARAM_INVALID: c_int = 0;
const PARAM_API_TYPE: c_int = 1;
const PARAM_OPENGL_INIT_PARAMS: c_int = 2;
const PARAM_OPENGL_FBO: c_int = 3;
const PARAM_FLIP_Y: c_int = 4;
const PARAM_BLOCK_FOR_TARGET_TIME: c_int = 12;

#[repr(C)]
struct RenderParam {
    typ: c_int,
    data: *mut c_void,
}
#[repr(C)]
struct GlInitParams {
    get_proc_address: extern "C" fn(*mut c_void, *const c_char) -> *mut c_void,
    ctx: *mut c_void,
}
#[repr(C)]
struct GlFbo {
    fbo: c_int,
    w: c_int,
    h: c_int,
    internal_format: c_int,
}

struct Gl {
    lib: Library,
    cgl_set_current_context: unsafe extern "C" fn(*mut c_void) -> i32,
}

struct Render {
    ctx: *mut c_void,
    render: unsafe extern "C" fn(*mut c_void, *mut RenderParam) -> c_int,
    swap: unsafe extern "C" fn(*mut c_void),
}
unsafe impl Send for Render {}
unsafe impl Sync for Render {}

/// The mpv core; set by main.rs before the first useful draw.
pub static MPV: OnceLock<Arc<Mpv>> = OnceLock::new();
static LAYER: AtomicPtr<c_void> = AtomicPtr::new(null_mut());
static RENDERER: AtomicPtr<c_void> = AtomicPtr::new(null_mut());
static GL: OnceLock<Gl> = OnceLock::new();
static RENDER: OnceLock<Render> = OnceLock::new();
static DRAWS: AtomicU32 = AtomicU32::new(0);
static LAST_SIZE: AtomicU64 = AtomicU64::new(0);
static ERRORS: AtomicU32 = AtomicU32::new(0);

fn gl() -> &'static Gl {
    GL.get_or_init(|| unsafe {
        let lib = Library::new("/System/Library/Frameworks/OpenGL.framework/OpenGL").expect("load OpenGL.framework");
        let cgl_set_current_context = *lib.get::<unsafe extern "C" fn(*mut c_void) -> i32>(b"CGLSetCurrentContext\0").unwrap();
        Gl { lib, cgl_set_current_context }
    })
}

extern "C" fn get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    unsafe {
        let n = CStr::from_ptr(name);
        match gl().lib.get::<*mut c_void>(n.to_bytes_with_nul()) {
            Ok(sym) => *sym,
            Err(_) => null_mut(),
        }
    }
}

/// Called by mpv on an arbitrary thread when a new frame should be drawn: schedules a main-thread redraw.
extern "C" fn on_mpv_update(_ctx: *mut c_void) {
    kick();
}

/// Ask the Metal layer to redraw, on the main thread.
pub fn kick() {
    let l = LAYER.load(Ordering::Acquire);
    if !l.is_null() {
        unsafe { metalfx_kick(l) };
    }
}

pub fn render_ready() -> bool {
    RENDER.get().is_some()
}

pub fn is_supported() -> bool {
    unsafe { metalfx_is_supported() }
}

pub fn get_status() -> MetalFXBridgeStatus {
    let r = RENDERER.load(Ordering::Acquire);
    let mut status = MetalFXBridgeStatus::default();
    if !r.is_null() {
        unsafe { metalfx_get_status(r, &mut status) };
    }
    // Always report the true native video file stream resolution if known from mpv
    if let Some(mpv) = MPV.get() {
        if let Some(w) = mpv.get_property("video-params/w").and_then(|s| s.parse::<u32>().ok()) {
            if w > 0 {
                status.in_width = w;
            }
        }
        if let Some(h) = mpv.get_property("video-params/h").and_then(|s| s.parse::<u32>().ok()) {
            if h > 0 {
                status.in_height = h;
            }
        }
    }
    status
}

unsafe fn create_render_context(mpv: &Mpv, cgl_ctx: *mut c_void) -> Result<Render, String> {
    type CreateFn = unsafe extern "C" fn(*mut *mut c_void, *mut c_void, *mut RenderParam) -> c_int;
    type SetCbFn = unsafe extern "C" fn(*mut c_void, extern "C" fn(*mut c_void), *mut c_void);
    let create = *mpv.lib().get::<CreateFn>(b"mpv_render_context_create\0").map_err(|e| e.to_string())?;
    let set_cb = *mpv.lib().get::<SetCbFn>(b"mpv_render_context_set_update_callback\0").map_err(|e| e.to_string())?;
    let render = *mpv
        .lib()
        .get::<unsafe extern "C" fn(*mut c_void, *mut RenderParam) -> c_int>(b"mpv_render_context_render\0")
        .map_err(|e| e.to_string())?;
    let swap = *mpv
        .lib()
        .get::<unsafe extern "C" fn(*mut c_void)>(b"mpv_render_context_report_swap\0")
        .map_err(|e| e.to_string())?;

    // Make sure CGL context is current on this thread before mpv_render_context_create
    (gl().cgl_set_current_context)(cgl_ctx);

    let mut init = GlInitParams { get_proc_address, ctx: cgl_ctx };
    let mut params = [
        RenderParam { typ: PARAM_API_TYPE, data: c"opengl".as_ptr() as *mut c_void },
        RenderParam { typ: PARAM_OPENGL_INIT_PARAMS, data: &mut init as *mut _ as *mut c_void },
        RenderParam { typ: PARAM_INVALID, data: null_mut() },
    ];
    let mut ctx: *mut c_void = null_mut();
    let rc = create(&mut ctx, mpv.handle_ptr(), params.as_mut_ptr());
    if rc < 0 || ctx.is_null() {
        return Err(format!("mpv_render_context_create failed ({rc})"));
    }
    set_cb(ctx, on_mpv_update, null_mut());
    Ok(Render { ctx, render, swap })
}

/// Invoked on the main thread via CinemaMetalLayer's renderFrame callback.
extern "C" fn on_draw_frame() {
    let renderer = RENDERER.load(Ordering::Acquire);
    if renderer.is_null() {
        return;
    }
    let Some(mpv) = MPV.get() else { return }; // mpv not created yet
    let cgl_ctx = unsafe { metalfx_get_cgl_context(renderer) };
    if cgl_ctx.is_null() {
        return;
    }

    if RENDER.get().is_none() {
        match unsafe { create_render_context(mpv, cgl_ctx) } {
            Ok(r) => {
                let _ = RENDER.set(r);
                eprintln!("[metalfx] mpv render context created (CGL/MetalFX)");
            }
            Err(e) => {
                if ERRORS.fetch_add(1, Ordering::Relaxed) < 3 {
                    eprintln!("[metalfx] {e}");
                }
                return;
            }
        }
    }
    let r = RENDER.get().unwrap();

    let layer = LAYER.load(Ordering::Acquire);
    if layer.is_null() {
        return;
    }
    let layer_obj = layer as *mut AnyObject;
    let bounds: Rect = unsafe { msg_send![layer_obj, bounds] };
    let scale: f64 = unsafe { msg_send![layer_obj, contentsScale] };
    let (layer_w, layer_h) = ((bounds.w * scale).round() as u32, (bounds.h * scale).round() as u32);
    let active = metal::is_active();

    // Query native video stream resolution and display aspect ratio if available
    let video_w = mpv.get_property("video-params/w").and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    let video_h = mpv.get_property("video-params/h").and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    let video_aspect = mpv.get_property("video-params/aspect").and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);

    // When MetalFX upscale is active, decode into unscaled native video resolution for neural upscaling.
    // When MetalFX upscale is inactive (OFF), let mpv render directly into the layer dimensions (layer_w x layer_h)
    // so mpv performs its 100% native video pipeline (aspect ratio, letterboxing, colorspace) with zero extra scaling.
    let (in_w, in_h) = if active && video_w > 0 && video_h > 0 {
        (video_w, video_h)
    } else {
        (layer_w.max(1), layer_h.max(1))
    };

    let fbo = unsafe { metalfx_prepare_input_fbo(renderer, in_w, in_h) };
    if fbo <= 0 {
        return;
    }

    let n = DRAWS.fetch_add(1, Ordering::Relaxed);
    let packed = ((in_w as u64) << 32) | (in_h as u64 & 0xffff_ffff);
    if n < 3 || n % 240 == 0 || LAST_SIZE.swap(packed, Ordering::Relaxed) != packed {
        eprintln!(
            "[metalfx] draw #{n}: fbo={fbo} in={in_w}x{in_h} layer={layer_w}x{layer_h} (scale={scale}x, metalfx_active={})",
            metal::is_active()
        );
    }

    let mut target = GlFbo { fbo, w: in_w as c_int, h: in_h as c_int, internal_format: 0 };
    // PARAM_FLIP_Y: 0 renders normally (top-down in IOSurface memory). 1 inverts Y.
    let mut flip: c_int = std::env::var("SPIKE_FLIP").map(|v| v.parse().unwrap_or(0)).unwrap_or(0);
    let mut block: c_int = 0;
    let mut params = [
        RenderParam { typ: PARAM_OPENGL_FBO, data: &mut target as *mut _ as *mut c_void },
        RenderParam { typ: PARAM_FLIP_Y, data: &mut flip as *mut _ as *mut c_void },
        RenderParam { typ: PARAM_BLOCK_FOR_TARGET_TIME, data: &mut block as *mut _ as *mut c_void },
        RenderParam { typ: PARAM_INVALID, data: null_mut() },
    ];

    let rc = unsafe { (r.render)(r.ctx, params.as_mut_ptr()) };
    if rc < 0 && ERRORS.fetch_add(1, Ordering::Relaxed) < 3 {
        eprintln!("[metalfx] mpv_render_context_render failed ({rc})");
    }

    let active = metal::is_active();
    let presented = unsafe { metalfx_present_frame(renderer, active, video_aspect) };
    if presented {
        unsafe { (r.swap)(r.ctx) };
    }
}

/// Builds the CAMetalLayer + hosting view and inserts it BELOW the web view in the same parent.
/// Must run on the main thread. `wk` is the WKWebView.
pub unsafe fn install(wk: *mut AnyObject) {
    let parent: *mut AnyObject = msg_send![wk, superview];
    let window: *mut AnyObject = msg_send![wk, window];
    let scale: f64 = msg_send![window, backingScaleFactor];
    let bounds: Rect = msg_send![parent, bounds];

    // Create the CAMetalLayer subclass and renderer
    let layer_ptr = metalfx_create_layer(scale);
    if layer_ptr.is_null() {
        eprintln!("[metalfx] metalfx_create_layer failed");
        return;
    }
    let renderer = metalfx_create_renderer(layer_ptr);
    if renderer.is_null() {
        eprintln!("[metalfx] metalfx_create_renderer failed");
        return;
    }

    LAYER.store(layer_ptr, Ordering::Release);
    RENDERER.store(renderer, Ordering::Release);
    metalfx_set_draw_callback(on_draw_frame);

    let layer = layer_ptr as *mut AnyObject;
    let _: () = msg_send![layer, setBounds: bounds];
    let _: () = msg_send![layer, setContentsScale: scale];
    let _: () = msg_send![layer, setNeedsDisplayOnBoundsChange: Bool::YES];
    let _: () = msg_send![layer, setOpaque: Bool::YES];

    // Layer-hosting view: set layer first, then wantsLayer
    let a: Allocated<AnyObject> = msg_send![class!(NSView), alloc];
    let view: Retained<AnyObject> = msg_send![a, initWithFrame: bounds];
    let view = Retained::into_raw(view);
    let _: () = msg_send![view, setLayer: layer];
    let _: () = msg_send![view, setWantsLayer: Bool::YES];
    let _: () = msg_send![view, setAutoresizingMask: 18usize]; // width + height sizable
    // NSWindowBelow = -1
    let _: () = msg_send![parent, addSubview: view, positioned: -1isize, relativeTo: wk];

    eprintln!(
        "[metalfx] CAMetalLayer installed below WKWebView ({:.0}x{:.0} @ {scale}x, Apple Silicon MetalFX supported: {})",
        bounds.w, bounds.h, metalfx_is_supported()
    );
    kick();
}

#[allow(dead_code)]
pub fn destroy() {
    let r = RENDERER.swap(null_mut(), Ordering::AcqRel);
    if !r.is_null() {
        unsafe { metalfx_destroy_renderer(r) };
    }
    let l = LAYER.swap(null_mut(), Ordering::AcqRel);
    if !l.is_null() {
        let _retained = unsafe { Retained::from_raw(l as *mut AnyObject) };
        // Dropped here
    }
}
