#import <Foundation/Foundation.h>
#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <Metal/Metal.h>
#import <MetalFX/MetalFX.h>
#import <MetalPerformanceShaders/MetalPerformanceShaders.h>
#import <OpenGL/OpenGL.h>
#import <OpenGL/gl3.h>
#import <OpenGL/CGLIOSurface.h>
#import <IOSurface/IOSurface.h>
#import "metalfx_bridge.h"

static MetalViewDrawCallback s_drawCallback = NULL;

@interface CinemaMetalLayer : CAMetalLayer
- (void)renderFrame;
@end

@implementation CinemaMetalLayer

- (void)layoutSublayers {
    [super layoutSublayers];
    CGSize pixelSize = CGSizeMake(round(self.bounds.size.width * self.contentsScale),
                                  round(self.bounds.size.height * self.contentsScale));
    if (pixelSize.width > 0 && pixelSize.height > 0) {
        self.drawableSize = pixelSize;
    }
}

- (void)setBounds:(CGRect)bounds {
    [super setBounds:bounds];
    CGSize pixelSize = CGSizeMake(round(bounds.size.width * self.contentsScale),
                                  round(bounds.size.height * self.contentsScale));
    if (pixelSize.width > 0 && pixelSize.height > 0) {
        self.drawableSize = pixelSize;
    }
}

- (void)setContentsScale:(CGFloat)contentsScale {
    [super setContentsScale:contentsScale];
    CGSize pixelSize = CGSizeMake(round(self.bounds.size.width * contentsScale),
                                  round(self.bounds.size.height * contentsScale));
    if (pixelSize.width > 0 && pixelSize.height > 0) {
        self.drawableSize = pixelSize;
    }
}

- (void)renderFrame {
    if (s_drawCallback) {
        s_drawCallback();
    }
}

- (void)display {
    [self renderFrame];
}

@end

@interface MetalFXRenderer : NSObject {
@public
    id<MTLDevice> _device;
    id<MTLCommandQueue> _commandQueue;
    CAMetalLayer *_metalLayer;
    
    // CGL & OpenGL state
    CGLContextObj _cglContext;
    GLuint _glTexture;
    GLuint _glFbo;
    IOSurfaceRef _ioSurface;
    
    // Metal textures
    id<MTLTexture> _inputTexture;
    id<MTLTexture> _scaledTexture;
    uint32_t _scaledW;
    uint32_t _scaledH;
    
    // MetalFX Scaler
    id<MTLFXSpatialScaler> _scaler;
    uint32_t _scalerInW;
    uint32_t _scalerInH;
    uint32_t _scalerOutW;
    uint32_t _scalerOutH;
    
    // Fallback Bilinear Scaler
    MPSImageBilinearScale *_bilinearScale;
    
    // Dimensions
    uint32_t _currentInW;
    uint32_t _currentInH;
    uint32_t _currentOutW;
    uint32_t _currentOutH;
    
    // Telemetry
    BOOL _metalfxSupported;
    BOOL _metalfxActive;
    double _lastGpuTimeMs;
}

- (instancetype)initWithLayer:(CAMetalLayer *)layer;
- (void)cleanup;
- (int32_t)prepareInputFboWithWidth:(uint32_t)inW height:(uint32_t)inH;
- (BOOL)presentFrameWithMetalFX:(BOOL)enableMetalFX videoAspect:(double)aspectRatio;
- (void)getStatus:(MetalFXBridgeStatus *)outStatus;

@end

@implementation MetalFXRenderer

- (instancetype)initWithLayer:(CAMetalLayer *)layer {
    self = [super init];
    if (!self) return nil;
    
    _device = layer.device ? layer.device : MTLCreateSystemDefaultDevice();
    if (!_device) return nil;
    
    _commandQueue = [_device newCommandQueue];
    if (!_commandQueue) return nil;
    
    _metalLayer = layer;
    _metalLayer.device = _device;
    _metalLayer.pixelFormat = MTLPixelFormatBGRA8Unorm;
    _metalLayer.framebufferOnly = NO; // Required for compute / MetalFX direct write
    _metalLayer.opaque = YES;
    
    _metalfxSupported = [MTLFXSpatialScalerDescriptor supportsDevice:_device];
    
    // Create CGL Context with 4.1 Core Profile
    CGLPixelFormatAttribute attribs[] = {
        kCGLPFAAccelerated,
        kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)0x4100,
        kCGLPFAAllowOfflineRenderers,
        0
    };
    CGLPixelFormatObj pix;
    GLint npix;
    CGLError err = CGLChoosePixelFormat(attribs, &pix, &npix);
    if (err != kCGLNoError) {
        NSLog(@"[metalfx] CGLChoosePixelFormat failed: %d", err);
        return nil;
    }
    err = CGLCreateContext(pix, NULL, &_cglContext);
    CGLDestroyPixelFormat(pix);
    if (err != kCGLNoError || !_cglContext) {
        NSLog(@"[metalfx] CGLCreateContext failed: %d", err);
        return nil;
    }
    
    _bilinearScale = [[MPSImageBilinearScale alloc] initWithDevice:_device];
    
    NSLog(@"[metalfx] Renderer initialized on GPU: %@ (MetalFX Spatial Scaler supported: %d)",
          _device.name, _metalfxSupported);
    return self;
}

- (void)cleanup {
    if (_cglContext) {
        CGLSetCurrentContext(_cglContext);
        if (_glFbo) {
            glDeleteFramebuffers(1, &_glFbo);
            _glFbo = 0;
        }
        if (_glTexture) {
            glDeleteTextures(1, &_glTexture);
            _glTexture = 0;
        }
        CGLDestroyContext(_cglContext);
        _cglContext = NULL;
    }
    if (_ioSurface) {
        CFRelease(_ioSurface);
        _ioSurface = NULL;
    }
    _inputTexture = nil;
    _scaledTexture = nil;
    _scaler = nil;
    _bilinearScale = nil;
    _commandQueue = nil;
    _device = nil;
    _metalLayer = nil;
}

- (void)dealloc {
    [self cleanup];
}

- (int32_t)prepareInputFboWithWidth:(uint32_t)inW height:(uint32_t)inH {
    if (inW == 0 || inH == 0) {
        return (int32_t)_glFbo;
    }
    
    // If existing FBO matches dimensions, reuse directly
    if (_glFbo != 0 && _currentInW == inW && _currentInH == inH && _ioSurface != NULL) {
        return (int32_t)_glFbo;
    }
    
    CGLSetCurrentContext(_cglContext);
    
    if (_glFbo) {
        glDeleteFramebuffers(1, &_glFbo);
        _glFbo = 0;
    }
    if (_glTexture) {
        glDeleteTextures(1, &_glTexture);
        _glTexture = 0;
    }
    if (_ioSurface) {
        CFRelease(_ioSurface);
        _ioSurface = NULL;
    }
    _inputTexture = nil;
    
    _currentInW = inW;
    _currentInH = inH;
    
    // Allocate shared IOSurface
    NSDictionary *surfaceProps = @{
        (id)kIOSurfaceWidth: @(inW),
        (id)kIOSurfaceHeight: @(inH),
        (id)kIOSurfaceBytesPerElement: @(4),
        (id)kIOSurfacePixelFormat: @((uint32_t)'BGRA'),
    };
    _ioSurface = IOSurfaceCreate((CFDictionaryRef)surfaceProps);
    if (!_ioSurface) {
        NSLog(@"[metalfx] IOSurfaceCreate failed for %ux%u", inW, inH);
        return 0;
    }
    
    // Bind to OpenGL Texture
    glGenTextures(1, &_glTexture);
    glBindTexture(GL_TEXTURE_RECTANGLE, _glTexture);
    CGLError err = CGLTexImageIOSurface2D(_cglContext, GL_TEXTURE_RECTANGLE, GL_RGBA,
                                         inW, inH, GL_BGRA, GL_UNSIGNED_INT_8_8_8_8_REV,
                                         _ioSurface, 0);
    if (err != kCGLNoError) {
        NSLog(@"[metalfx] CGLTexImageIOSurface2D failed: %d", err);
        return 0;
    }
    
    // Attach to OpenGL FBO
    glGenFramebuffers(1, &_glFbo);
    glBindFramebuffer(GL_FRAMEBUFFER, _glFbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_RECTANGLE, _glTexture, 0);
    
    GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (status != GL_FRAMEBUFFER_COMPLETE) {
        NSLog(@"[metalfx] GL framebuffer incomplete: 0x%x", status);
        return 0;
    }
    
    // Wrap IOSurface into Metal Texture
    MTLTextureDescriptor *desc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                                                    width:inW
                                                                                   height:inH
                                                                                mipmapped:NO];
    desc.usage = MTLTextureUsageShaderRead | MTLTextureUsageRenderTarget;
    _inputTexture = [_device newTextureWithDescriptor:desc iosurface:_ioSurface plane:0];
    if (!_inputTexture) {
        NSLog(@"[metalfx] newTextureWithDescriptor iosurface failed for %ux%u", inW, inH);
        return 0;
    }
    
    NSLog(@"[metalfx] Created IOSurface FBO %ux%u (GL FBO: %u, Metal tex: %p)",
          inW, inH, _glFbo, _inputTexture);
    return (int32_t)_glFbo;
}

- (BOOL)presentFrameWithMetalFX:(BOOL)enableMetalFX videoAspect:(double)aspectRatio {
    if (!_metalLayer || !_inputTexture) return NO;
    
    // Synchronize CAMetalLayer drawableSize with current backing pixel bounds
    CGSize targetSize = CGSizeMake(round(_metalLayer.bounds.size.width * _metalLayer.contentsScale),
                                   round(_metalLayer.bounds.size.height * _metalLayer.contentsScale));
    if (targetSize.width > 0 && targetSize.height > 0 &&
        (fabs(_metalLayer.drawableSize.width - targetSize.width) > 0.5 ||
         fabs(_metalLayer.drawableSize.height - targetSize.height) > 0.5)) {
        _metalLayer.drawableSize = targetSize;
    }
    
    // Commit OpenGL commands so data is in IOSurface before Metal reads
    CGLSetCurrentContext(_cglContext);
    glFlush();
    
    id<CAMetalDrawable> drawable = [_metalLayer nextDrawable];
    if (!drawable) return NO;
    
    id<MTLTexture> outTex = drawable.texture;
    uint32_t outW = (uint32_t)outTex.width;
    uint32_t outH = (uint32_t)outTex.height;
    _currentOutW = outW;
    _currentOutH = outH;
    
    uint32_t inW = _currentInW;
    uint32_t inH = _currentInH;
    
    id<MTLCommandBuffer> cb = [_commandQueue commandBuffer];
    if (!cb) return NO;
    
    if (inW == outW && inH == outH) {
        // Direct 1:1 passthrough (native video mode when upscale is OFF: untouched, no extra scaling)
        _metalfxActive = NO;
        _lastGpuTimeMs = 0.0;
        id<MTLBlitCommandEncoder> blit = [cb blitCommandEncoder];
        [blit copyFromTexture:_inputTexture toTexture:outTex];
        [blit endEncoding];
    } else {
        // Calculate aspect-fit destination dimensions to preserve exact original aspect ratio
        double layerAspect = (double)outW / (double)outH;
        double videoAspect = (aspectRatio > 0.0) ? aspectRatio : ((inH > 0) ? ((double)inW / (double)inH) : layerAspect);
        uint32_t fitW, fitH, dstX, dstY;
        if (videoAspect >= layerAspect) {
            fitW = outW;
            fitH = (uint32_t)round((double)outW / videoAspect) & ~1;
            if (fitH == 0) fitH = 2;
            if (fitH > outH) fitH = outH;
            dstX = 0;
            dstY = (outH - fitH) / 2;
        } else {
            fitH = outH;
            fitW = (uint32_t)round((double)outH * videoAspect) & ~1;
            if (fitW == 0) fitW = 2;
            if (fitW > outW) fitW = outW;
            dstX = (outW - fitW) / 2;
            dstY = 0;
        }
        
        BOOL isExactFit = (dstX == 0 && dstY == 0 && fitW == outW && fitH == outH);
        
        id<MTLTexture> targetTex = outTex;
        if (!isExactFit) {
            // Clear drawable to black letterbox/pillarbox bars
            MTLRenderPassDescriptor *clearPass = [MTLRenderPassDescriptor renderPassDescriptor];
            clearPass.colorAttachments[0].texture = outTex;
            clearPass.colorAttachments[0].loadAction = MTLLoadActionClear;
            clearPass.colorAttachments[0].clearColor = MTLClearColorMake(0.0, 0.0, 0.0, 1.0);
            clearPass.colorAttachments[0].storeAction = MTLStoreActionStore;
            id<MTLRenderCommandEncoder> rce = [cb renderCommandEncoderWithDescriptor:clearPass];
            [rce endEncoding];
            
            // Allocate or resize intermediate scaled texture
            if (!_scaledTexture || _scaledW != fitW || _scaledH != fitH) {
                MTLTextureDescriptor *sDesc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                                                                 width:fitW
                                                                                                height:fitH
                                                                                             mipmapped:NO];
                sDesc.usage = MTLTextureUsageShaderRead | MTLTextureUsageShaderWrite | MTLTextureUsageRenderTarget;
                _scaledTexture = [_device newTextureWithDescriptor:sDesc];
                _scaledW = fitW;
                _scaledH = fitH;
            }
            targetTex = _scaledTexture;
        }
        
        BOOL shouldUpscale = enableMetalFX && _metalfxSupported && (inW > 0 && inH > 0) && (inW < fitW || inH < fitH);
        
        if (shouldUpscale) {
            if (!_scaler || _scalerInW != inW || _scalerInH != inH || _scalerOutW != fitW || _scalerOutH != fitH) {
                MTLFXSpatialScalerDescriptor *scalerDesc = [[MTLFXSpatialScalerDescriptor alloc] init];
                scalerDesc.inputWidth = inW;
                scalerDesc.inputHeight = inH;
                scalerDesc.outputWidth = fitW;
                scalerDesc.outputHeight = fitH;
                scalerDesc.colorTextureFormat = MTLPixelFormatBGRA8Unorm;
                scalerDesc.outputTextureFormat = MTLPixelFormatBGRA8Unorm;
                scalerDesc.colorProcessingMode = MTLFXSpatialScalerColorProcessingModePerceptual;
                
                _scaler = [scalerDesc newSpatialScalerWithDevice:_device];
                _scalerInW = inW;
                _scalerInH = inH;
                _scalerOutW = fitW;
                _scalerOutH = fitH;
            }
            
            if (_scaler) {
                _metalfxActive = YES;
                _scaler.colorTexture = _inputTexture;
                _scaler.outputTexture = targetTex;
                [_scaler encodeToCommandBuffer:cb];
            } else {
                _metalfxActive = NO;
                [_bilinearScale encodeToCommandBuffer:cb sourceTexture:_inputTexture destinationTexture:targetTex];
            }
        } else {
            _metalfxActive = NO;
            [_bilinearScale encodeToCommandBuffer:cb sourceTexture:_inputTexture destinationTexture:targetTex];
        }
        
        // If scaled to intermediate texture, blit into centered rect on drawable
        if (!isExactFit && targetTex != outTex) {
            id<MTLBlitCommandEncoder> blit = [cb blitCommandEncoder];
            [blit copyFromTexture:targetTex
                      sourceSlice:0
                      sourceLevel:0
                     sourceOrigin:MTLOriginMake(0, 0, 0)
                       sourceSize:MTLSizeMake(fitW, fitH, 1)
                        toTexture:outTex
                 destinationSlice:0
                 destinationLevel:0
                destinationOrigin:MTLOriginMake(dstX, dstY, 0)];
            [blit endEncoding];
        }
    }
    
    // Telemetry handler
    __weak MetalFXRenderer *weakSelf = self;
    [cb addCompletedHandler:^(id<MTLCommandBuffer> buffer) {
        if (buffer.status == MTLCommandBufferStatusCompleted) {
            double elapsed = (buffer.GPUEndTime - buffer.GPUStartTime) * 1000.0;
            MetalFXRenderer *strongSelf = weakSelf;
            if (strongSelf && elapsed > 0.0) {
                strongSelf->_lastGpuTimeMs = elapsed;
            }
        }
    }];
    
    [cb presentDrawable:drawable];
    [cb commit];
    return YES;
}

- (void)getStatus:(MetalFXBridgeStatus *)outStatus {
    if (!outStatus) return;
    outStatus->in_width = _currentInW;
    outStatus->in_height = _currentInH;
    outStatus->out_width = (_metalfxActive && _scalerOutW > 0) ? _scalerOutW : _currentOutW;
    outStatus->out_height = (_metalfxActive && _scalerOutH > 0) ? _scalerOutH : _currentOutH;
    outStatus->metalfx_supported = _metalfxSupported;
    outStatus->metalfx_active = _metalfxActive;
    outStatus->last_gpu_time_ms = _metalfxActive ? _lastGpuTimeMs : 0.0;
}

@end

// ---- C API exports -----------------------------------------------------------------------------

bool metalfx_is_supported(void) {
    id<MTLDevice> device = MTLCreateSystemDefaultDevice();
    if (!device) return false;
    return [MTLFXSpatialScalerDescriptor supportsDevice:device];
}

void metalfx_set_draw_callback(MetalViewDrawCallback cb) {
    s_drawCallback = cb;
}

void* metalfx_create_layer(double scale) {
    id<MTLDevice> device = MTLCreateSystemDefaultDevice();
    if (!device) return NULL;
    
    CinemaMetalLayer *layer = [[CinemaMetalLayer alloc] init];
    layer.device = device;
    layer.pixelFormat = MTLPixelFormatBGRA8Unorm;
    layer.framebufferOnly = NO;
    layer.contentsScale = scale;
    layer.needsDisplayOnBoundsChange = YES;
    layer.opaque = YES;
    
    return (__bridge_retained void *)layer;
}

void metalfx_kick(void *layer_ptr) {
    if (!layer_ptr) return;
    CinemaMetalLayer *layer = (__bridge CinemaMetalLayer *)layer_ptr;
    [layer performSelectorOnMainThread:@selector(renderFrame) withObject:nil waitUntilDone:NO];
}

MetalFXContextRef metalfx_create_renderer(void *metal_layer) {
    if (!metal_layer) return NULL;
    CAMetalLayer *layer = (__bridge CAMetalLayer *)metal_layer;
    MetalFXRenderer *renderer = [[MetalFXRenderer alloc] initWithLayer:layer];
    if (!renderer) return NULL;
    return (__bridge_retained MetalFXContextRef)renderer;
}

void metalfx_destroy_renderer(MetalFXContextRef ctx) {
    if (!ctx) return;
    MetalFXRenderer *renderer = (__bridge_transfer MetalFXRenderer *)ctx;
    [renderer cleanup];
    renderer = nil;
}

void* metalfx_get_cgl_context(MetalFXContextRef ctx) {
    if (!ctx) return NULL;
    MetalFXRenderer *renderer = (__bridge MetalFXRenderer *)ctx;
    return (void *)renderer->_cglContext;
}

int32_t metalfx_prepare_input_fbo(MetalFXContextRef ctx, uint32_t in_w, uint32_t in_h) {
    if (!ctx) return 0;
    MetalFXRenderer *renderer = (__bridge MetalFXRenderer *)ctx;
    return [renderer prepareInputFboWithWidth:in_w height:in_h];
}

bool metalfx_present_frame(MetalFXContextRef ctx, bool enable_metalfx, double video_aspect) {
    if (!ctx) return false;
    MetalFXRenderer *renderer = (__bridge MetalFXRenderer *)ctx;
    return [renderer presentFrameWithMetalFX:(BOOL)enable_metalfx videoAspect:video_aspect];
}

void metalfx_get_status(MetalFXContextRef ctx, MetalFXBridgeStatus *out_status) {
    if (!ctx || !out_status) return;
    MetalFXRenderer *renderer = (__bridge MetalFXRenderer *)ctx;
    [renderer getStatus:out_status];
}
