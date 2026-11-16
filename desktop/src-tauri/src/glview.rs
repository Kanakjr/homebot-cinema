//! libmpv OpenGL render API drawing into an `NSOpenGLLayer` that lives in a view placed BELOW the
//! WKWebView, inside the same window (so native fullscreen, resize etc. are one window's business).
//!
//! Threading (see mpv's render.h): the layer's draw callback runs on the main thread with the GL
//! context current, so the render context is created there on first draw and every `mpv_render_*`
//! call happens there. The mpv update callback only schedules a main-thread redraw. Tauri commands
//! that touch libmpv stay async so no non-render libmpv call ever runs on the main thread.

use crate::mpv::Mpv;
use libloading::Library;
use objc2::rc::{Allocated, Retained};
use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::{class, msg_send, sel};
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
    get_integerv: unsafe extern "C" fn(u32, *mut i32),
    get_string: unsafe extern "C" fn(u32) -> *const u8,
    flush: unsafe extern "C" fn(),
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
static LAYER: AtomicPtr<AnyObject> = AtomicPtr::new(null_mut());
/// Our 4.1 core-profile NSOpenGLPixelFormat, handed out by the layer's pixel-format hook.
static PIXEL_FORMAT: AtomicPtr<AnyObject> = AtomicPtr::new(null_mut());
static GL: OnceLock<Gl> = OnceLock::new();
static RENDER: OnceLock<Render> = OnceLock::new();
static DRAWS: AtomicU32 = AtomicU32::new(0);
static LAST_SIZE: AtomicU64 = AtomicU64::new(0);
static ERRORS: AtomicU32 = AtomicU32::new(0);

fn gl() -> &'static Gl {
    GL.get_or_init(|| unsafe {
        let lib = Library::new("/System/Library/Frameworks/OpenGL.framework/OpenGL").expect("load OpenGL.framework");
        let get_integerv = *lib.get::<unsafe extern "C" fn(u32, *mut i32)>(b"glGetIntegerv\0").unwrap();
        let get_string = *lib.get::<unsafe extern "C" fn(u32) -> *const u8>(b"glGetString\0").unwrap();
        let flush = *lib.get::<unsafe extern "C" fn()>(b"glFlush\0").unwrap();
        Gl { lib, get_integerv, get_string, flush }
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

/// Called by mpv on an arbitrary thread when a new frame should be drawn: only schedule a redraw.
extern "C" fn on_update(_ctx: *mut c_void) {
    kick();
}

/// Ask the layer to redraw, on the main thread.
pub fn kick() {
    let l = LAYER.load(Ordering::Acquire);
    if l.is_null() {
        return;
    }
    unsafe {
        let _: () = msg_send![
            l,
            performSelectorOnMainThread: sel!(setNeedsDisplay),
            withObject: null_mut::<AnyObject>(),
            waitUntilDone: Bool::NO
        ];
    }
}

pub fn render_ready() -> bool {
    RENDER.get().is_some()
}

unsafe fn create_render_context(mpv: &Mpv) -> Result<Render, String> {
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

    let mut init = GlInitParams { get_proc_address, ctx: null_mut() };
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
    set_cb(ctx, on_update, null_mut());
    Ok(Render { ctx, render, swap })
}

/// NSOpenGLLayer asks this for the pixel format of its context; without an override it picks a
/// legacy 2.1 context, which makes mpv drop VideoToolbox and the good scalers.
unsafe extern "C-unwind" fn pixel_format_for_mask(_this: *mut AnyObject, _sel: Sel, _mask: u32) -> *mut AnyObject {
    PIXEL_FORMAT.load(Ordering::Acquire)
}

unsafe extern "C-unwind" fn can_draw(
    _this: *mut AnyObject,
    _sel: Sel,
    _ctx: *mut AnyObject,
    _pf: *mut AnyObject,
    _t: f64,
    _ts: *const c_void,
) -> Bool {
    Bool::YES
}

unsafe extern "C-unwind" fn draw(
    this: *mut AnyObject,
    _sel: Sel,
    _ctx: *mut AnyObject,
    _pf: *mut AnyObject,
    _t: f64,
    _ts: *const c_void,
) {
    let g = gl();
    let n = DRAWS.fetch_add(1, Ordering::Relaxed);
    if n == 0 {
        let v = (g.get_string)(0x1F02); // GL_VERSION
        let r = (g.get_string)(0x1F01); // GL_RENDERER
        let cs = |p: *const u8| if p.is_null() { String::new() } else { CStr::from_ptr(p as *const c_char).to_string_lossy().into_owned() };
        eprintln!("[spike] GL first draw: GL_VERSION={:?} GL_RENDERER={:?}", cs(v), cs(r));
    }
    let Some(mpv) = MPV.get() else { return }; // mpv not created yet
    if RENDER.get().is_none() {
        match create_render_context(mpv) {
            Ok(r) => {
                let _ = RENDER.set(r);
                eprintln!("[spike] mpv render context created (OpenGL) on draw #{n}");
            }
            Err(e) => {
                if ERRORS.fetch_add(1, Ordering::Relaxed) < 3 {
                    eprintln!("[spike] {e}");
                }
                return;
            }
        }
    }
    let r = RENDER.get().unwrap();

    let mut fbo: i32 = 0;
    (g.get_integerv)(0x8CA6, &mut fbo); // GL_DRAW_FRAMEBUFFER_BINDING
    let bounds: Rect = msg_send![this, bounds];
    let scale: f64 = msg_send![this, contentsScale];
    let (w, h) = ((bounds.w * scale).round() as c_int, (bounds.h * scale).round() as c_int);
    let packed = ((w as u64) << 32) | (h as u64 & 0xffff_ffff);
    if n < 3 || n % 240 == 0 || LAST_SIZE.swap(packed, Ordering::Relaxed) != packed {
        eprintln!("[spike] draw #{n}: fbo={fbo} size={w}x{h} (bounds {:.0}x{:.0} @ {scale}x)", bounds.w, bounds.h);
    }

    let mut target = GlFbo { fbo, w, h, internal_format: 0 };
    let mut flip: c_int = std::env::var("SPIKE_FLIP").map(|v| v.parse().unwrap_or(1)).unwrap_or(1);
    // Never block the main thread waiting for the frame's display time.
    let mut block: c_int = 0;
    let mut params = [
        RenderParam { typ: PARAM_OPENGL_FBO, data: &mut target as *mut _ as *mut c_void },
        RenderParam { typ: PARAM_FLIP_Y, data: &mut flip as *mut _ as *mut c_void },
        RenderParam { typ: PARAM_BLOCK_FOR_TARGET_TIME, data: &mut block as *mut _ as *mut c_void },
        RenderParam { typ: PARAM_INVALID, data: null_mut() },
    ];
    let rc = (r.render)(r.ctx, params.as_mut_ptr());
    if rc < 0 && ERRORS.fetch_add(1, Ordering::Relaxed) < 3 {
        eprintln!("[spike] mpv_render_context_render failed ({rc})");
    }
    (g.flush)();
    (r.swap)(r.ctx);
}

fn layer_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| unsafe {
        let sup = AnyClass::get(c"NSOpenGLLayer").expect("NSOpenGLLayer");
        let mut b = ClassBuilder::new(c"SpikeGLLayer", sup).expect("class SpikeGLLayer");
        b.add_method(
            sel!(openGLPixelFormatForDisplayMask:),
            pixel_format_for_mask as unsafe extern "C-unwind" fn(*mut AnyObject, Sel, u32) -> *mut AnyObject,
        );
        b.add_method(
            sel!(canDrawInOpenGLContext:pixelFormat:forLayerTime:displayTime:),
            can_draw as unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject, *mut AnyObject, f64, *const c_void) -> Bool,
        );
        b.add_method(
            sel!(drawInOpenGLContext:pixelFormat:forLayerTime:displayTime:),
            draw as unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject, *mut AnyObject, f64, *const c_void),
        );
        b.register()
    })
}

/// Build the GL layer + hosting view and insert it BELOW the web view in the same parent.
/// Must run on the main thread. `wk` is the WKWebView.
pub unsafe fn install(wk: *mut AnyObject) {
    let parent: *mut AnyObject = msg_send![wk, superview];
    let window: *mut AnyObject = msg_send![wk, window];
    let scale: f64 = msg_send![window, backingScaleFactor];
    let bounds: Rect = msg_send![parent, bounds];

    // Core profile 4.1 (the layer's default would be a legacy context).
    let attrs: [u32; 6] = [5 /*DoubleBuffer*/, 73 /*Accelerated*/, 99 /*OpenGLProfile*/, 0x4100 /*4.1 Core*/, 0, 0];
    let a: Allocated<AnyObject> = msg_send![class!(NSOpenGLPixelFormat), alloc];
    let pf: Option<Retained<AnyObject>> = msg_send![a, initWithAttributes: attrs.as_ptr()];
    let Some(pf) = pf else {
        eprintln!("[spike] NSOpenGLPixelFormat 4.1 core: not available");
        return;
    };

    PIXEL_FORMAT.store(Retained::as_ptr(&pf) as *mut AnyObject, Ordering::Release);
    let a: Allocated<AnyObject> = msg_send![layer_class(), alloc];
    let layer: Retained<AnyObject> = msg_send![a, init];
    let layer = Retained::into_raw(layer);
    let _: () = msg_send![layer, setOpenGLPixelFormat: &*pf];
    let _: () = msg_send![layer, setContentsScale: scale];
    let _: () = msg_send![layer, setNeedsDisplayOnBoundsChange: Bool::YES];
    let _: () = msg_send![layer, setOpaque: Bool::YES];

    // Layer-hosting view: set the layer first, then wantsLayer.
    let a: Allocated<AnyObject> = msg_send![class!(NSView), alloc];
    let view: Retained<AnyObject> = msg_send![a, initWithFrame: bounds];
    let view = Retained::into_raw(view);
    let _: () = msg_send![view, setLayer: layer];
    let _: () = msg_send![view, setWantsLayer: Bool::YES];
    let _: () = msg_send![view, setAutoresizingMask: 18usize]; // width + height sizable
    // NSWindowBelow = -1
    let _: () = msg_send![parent, addSubview: view, positioned: -1isize, relativeTo: wk];

    {
        let sv: *mut AnyObject = msg_send![view, superview];
        let w2: *mut AnyObject = msg_send![view, window];
        let subs: *mut AnyObject = msg_send![parent, subviews];
        let cnt: usize = msg_send![subs, count];
        let vlayer: *mut AnyObject = msg_send![view, layer];
        eprintln!(
            "[spike] after addSubview: view={view:p} superview={sv:p} (parent={parent:p}) window={w2:p} parent.subviews={cnt} view.layer={vlayer:p} (layer={layer:p})"
        );
        for i in 0..cnt {
            let v: *mut AnyObject = msg_send![subs, objectAtIndex: i];
            eprintln!("[spike]   parent.subviews[{i}] = {v:p} {}", (*v).class().name().to_string_lossy());
        }
    }
    LAYER.store(layer, Ordering::Release);
    std::mem::forget(pf);
    eprintln!("[spike] GL layer installed below WKWebView ({:.0}x{:.0} @ {scale}x)", bounds.w, bounds.h);
    kick();
}
