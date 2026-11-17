//! Safe Rust bindings for the Apple MetalFX bridge.

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};

pub static METALFX_ACTIVE: AtomicBool = AtomicBool::new(false);

#[repr(C)]
#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
pub struct MetalFXBridgeStatus {
    pub in_width: u32,
    pub in_height: u32,
    pub out_width: u32,
    pub out_height: u32,
    pub metalfx_supported: bool,
    pub metalfx_active: bool,
    pub last_gpu_time_ms: f64,
}

pub type MetalViewDrawCallback = extern "C" fn();

extern "C" {
    pub fn metalfx_is_supported() -> bool;
    pub fn metalfx_set_draw_callback(cb: MetalViewDrawCallback);
    pub fn metalfx_create_layer(scale: f64) -> *mut c_void;
    pub fn metalfx_kick(layer_ptr: *mut c_void);
    pub fn metalfx_create_renderer(metal_layer: *mut c_void) -> *mut c_void;
    #[allow(dead_code)]
    pub fn metalfx_destroy_renderer(ctx: *mut c_void);
    pub fn metalfx_get_cgl_context(ctx: *mut c_void) -> *mut c_void;
    pub fn metalfx_prepare_input_fbo(ctx: *mut c_void, in_w: u32, in_h: u32) -> i32;
    pub fn metalfx_present_frame(ctx: *mut c_void, enable_metalfx: bool, video_aspect: f64) -> bool;
    pub fn metalfx_get_status(ctx: *mut c_void, out_status: *mut MetalFXBridgeStatus);
}

#[allow(dead_code)]
pub fn is_supported() -> bool {
    unsafe { metalfx_is_supported() }
}

pub fn is_active() -> bool {
    METALFX_ACTIVE.load(Ordering::Relaxed)
}

pub fn set_active(active: bool) {
    METALFX_ACTIVE.store(active, Ordering::Release);
}
