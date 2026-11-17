#ifndef METALFX_BRIDGE_H
#define METALFX_BRIDGE_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void* MetalFXContextRef;
typedef void (*MetalViewDrawCallback)(void);

typedef struct {
    uint32_t in_width;
    uint32_t in_height;
    uint32_t out_width;
    uint32_t out_height;
    bool metalfx_supported;
    bool metalfx_active;
    double last_gpu_time_ms;
} MetalFXBridgeStatus;

// Checks whether Apple Silicon GPU and MTLFXSpatialScaler are supported
bool metalfx_is_supported(void);

// Sets the global draw callback invoked on the main thread when a frame should be rendered
void metalfx_set_draw_callback(MetalViewDrawCallback cb);

// Creates and returns a configured CinemaMetalLayer instance (retained, cast to void*)
void* metalfx_create_layer(double scale);

// Schedules a redraw on the main thread for the given layer
void metalfx_kick(void *layer_ptr);

// Creates a renderer context bound to the specified CAMetalLayer (void* = CAMetalLayer*)
MetalFXContextRef metalfx_create_renderer(void *metal_layer);

// Releases context and associated Metal / OpenGL / IOSurface resources
void metalfx_destroy_renderer(MetalFXContextRef ctx);

// Returns the underlying CGLContextObj for mpv OpenGL render context creation
void* metalfx_get_cgl_context(MetalFXContextRef ctx);

// Prepares or updates the IOSurface FBO for the specified video frame dimensions (in_w x in_h)
// Returns the OpenGL FBO handle (GLint / int32_t) that libmpv renders into
int32_t metalfx_prepare_input_fbo(MetalFXContextRef ctx, uint32_t in_w, uint32_t in_h);

// Performs the upscale or blit pass from the IOSurface input into CAMetalLayer's next drawable
// enable_metalfx: if true, uses Apple MTLFXSpatialScaler; if false, uses direct 1:1 blit / bilinear
// video_aspect: display aspect ratio from mpv (e.g. 1.7778 for 16:9), or <= 0.0 to deduce from in_w / in_h
// Returns true on successful draw and presentation
bool metalfx_present_frame(MetalFXContextRef ctx, bool enable_metalfx, double video_aspect);

// Queries current status and telemetry
void metalfx_get_status(MetalFXContextRef ctx, MetalFXBridgeStatus *out_status);

#ifdef __cplusplus
}
#endif

#endif // METALFX_BRIDGE_H
