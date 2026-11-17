import Foundation
import Metal
import MetalFX
import CoreGraphics
import ImageIO
import Accelerate

struct BenchmarkResult: Codable {
    let filename: String
    let inputResolution: String
    let outputResolution: String
    let scaleFactor: Double
    let warmupIterations: Int
    let benchmarkIterations: Int
    let avgGpuTimeMs: Double
    let minGpuTimeMs: Double
    let maxGpuTimeMs: Double
    let medianGpuTimeMs: Double
    let stdDevGpuTimeMs: Double
    let avgWallTimeMs: Double
    let throughputFps: Double
    let vramAllocatedMb: Double
}

struct BenchmarkSummary: Codable {
    let timestamp: String
    let deviceName: String
    let osVersion: String
    let architecture: String
    let overallAvgGpuTimeMs: Double
    let overallThroughputFps: Double
    let results: [BenchmarkResult]
}

func getGpuDevice() -> MTLDevice {
    guard let device = MTLCreateSystemDefaultDevice() else {
        fatalError("Error: No Metal-capable GPU device found.")
    }
    return device
}

func loadCGImage(from url: URL) -> CGImage {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fatalError("Error: Unable to load image at \(url.path)")
    }
    return cgImage
}

func createTexture(from cgImage: CGImage, device: MTLDevice) -> MTLTexture {
    let width = cgImage.width
    let height = cgImage.height
    let bytesPerPixel = 4
    let bytesPerRow = width * bytesPerPixel

    var rawData = [UInt8](repeating: 0, count: height * bytesPerRow)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue // BGRA

    guard let context = CGContext(
        data: &rawData,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: colorSpace,
        bitmapInfo: bitmapInfo
    ) else {
        fatalError("Error: Failed to create bitmap context.")
    }

    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

    let textureDesc = MTLTextureDescriptor.texture2DDescriptor(
        pixelFormat: .bgra8Unorm,
        width: width,
        height: height,
        mipmapped: false
    )
    textureDesc.usage = [.shaderRead]
    textureDesc.storageMode = .shared

    guard let texture = device.makeTexture(descriptor: textureDesc) else {
        fatalError("Error: Failed to allocate input MTLTexture.")
    }

    texture.replace(
        region: MTLRegionMake2D(0, 0, width, height),
        mipmapLevel: 0,
        withBytes: rawData,
        bytesPerRow: bytesPerRow
    )

    return texture
}

func saveTextureAsPNG(texture: MTLTexture, to url: URL) {
    let width = texture.width
    let height = texture.height
    let bytesPerPixel = 4
    let bytesPerRow = width * bytesPerPixel
    var rawData = [UInt8](repeating: 0, count: height * bytesPerRow)

    texture.getBytes(
        &rawData,
        bytesPerRow: bytesPerRow,
        from: MTLRegionMake2D(0, 0, width, height),
        mipmapLevel: 0
    )

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue

    guard let context = CGContext(
        data: &rawData,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: colorSpace,
        bitmapInfo: bitmapInfo
    ), let cgImage = context.makeImage() else {
        fatalError("Error: Failed to create CGImage from MTLTexture.")
    }

    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else {
        fatalError("Error: Failed to create CGImageDestination at \(url.path)")
    }

    CGImageDestinationAddImage(destination, cgImage, nil)
    guard CGImageDestinationFinalize(destination) else {
        fatalError("Error: Failed to write PNG to \(url.path)")
    }
}

func createBicubicUpscale(from inputImage: CGImage, targetWidth: Int, targetHeight: Int, to url: URL) {
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bytesPerPixel = 4
    let bytesPerRow = targetWidth * bytesPerPixel
    let bitmapInfo = CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue

    guard let context = CGContext(
        data: nil,
        width: targetWidth,
        height: targetHeight,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: colorSpace,
        bitmapInfo: bitmapInfo
    ) else {
        fatalError("Error: Failed to create bicubic bitmap context.")
    }

    context.interpolationQuality = .high
    context.draw(inputImage, in: CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight))

    guard let upscaledImage = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else {
        fatalError("Error: Failed to create bicubic destination.")
    }

    CGImageDestinationAddImage(destination, upscaledImage, nil)
    CGImageDestinationFinalize(destination)
}

func main() {
    print("==================================================================")
    print("  Apple MetalFX Spatial Super-Resolution Benchmark & Upscaler")
    print("==================================================================")

    let device = getGpuDevice()
    print("GPU Device: \(device.name)")
    print("MetalFX Spatial Scaler Supported: \(MTLFXSpatialScalerDescriptor.supportsDevice(device))")

    guard let commandQueue = device.makeCommandQueue() else {
        fatalError("Error: Failed to create MTLCommandQueue.")
    }

    let fileManager = FileManager.default
    let baseDir = URL(fileURLWithPath: "research/metalfx_benchmark")
    let inputsDir = baseDir.appendingPathComponent("inputs")
    let outputsMetalFxDir = baseDir.appendingPathComponent("outputs_metalfx")
    let outputsBicubicDir = baseDir.appendingPathComponent("outputs_bicubic")

    try? fileManager.createDirectory(at: outputsMetalFxDir, withIntermediateDirectories: true)
    try? fileManager.createDirectory(at: outputsBicubicDir, withIntermediateDirectories: true)

    guard let files = try? fileManager.contentsOfDirectory(atPath: inputsDir.path) else {
        fatalError("Error: Could not list files in \(inputsDir.path)")
    }

    let imageFiles = files.filter { $0.hasSuffix(".png") || $0.hasSuffix(".jpg") }.sorted()
    print("Discovered \(imageFiles.count) test image(s) for upscaling.")

    var benchmarkResults: [BenchmarkResult] = []
    let warmupIterations = 5
    let benchmarkIterations = 40

    for file in imageFiles {
        let inputUrl = inputsDir.appendingPathComponent(file)
        let baseName = (file as NSString).deletingPathExtension
        let outputMetalFxUrl = outputsMetalFxDir.appendingPathComponent("\(baseName)_metalfx_4k.png")
        let outputBicubicUrl = outputsBicubicDir.appendingPathComponent("\(baseName)_bicubic_4k.png")

        print("\n------------------------------------------------------------------")
        print("Processing: \(file)")

        let inputCGImage = loadCGImage(from: inputUrl)
        let inWidth = inputCGImage.width
        let inHeight = inputCGImage.height
        let outWidth = inWidth * 2
        let outHeight = inHeight * 2

        print("  Input Resolution : \(inWidth) x \(inHeight)")
        print("  Output Resolution: \(outWidth) x \(outHeight) (2.0x spatial scale)")

        // 1. Generate Bicubic baseline
        createBicubicUpscale(from: inputCGImage, targetWidth: outWidth, targetHeight: outHeight, to: outputBicubicUrl)
        print("  -> Baseline Bicubic 4K written.")

        // 2. Setup MetalFX Texture and Scaler
        let inputTexture = createTexture(from: inputCGImage, device: device)

        let outputTextureDesc = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm,
            width: outWidth,
            height: outHeight,
            mipmapped: false
        )
        outputTextureDesc.usage = [.shaderWrite, .renderTarget, .shaderRead]
        outputTextureDesc.storageMode = .shared

        guard let outputTexture = device.makeTexture(descriptor: outputTextureDesc) else {
            fatalError("Error: Failed to allocate output MTLTexture.")
        }

        let scalerDesc = MTLFXSpatialScalerDescriptor()
        scalerDesc.inputWidth = inWidth
        scalerDesc.inputHeight = inHeight
        scalerDesc.outputWidth = outWidth
        scalerDesc.outputHeight = outHeight
        scalerDesc.colorTextureFormat = .bgra8Unorm
        scalerDesc.outputTextureFormat = .bgra8Unorm
        scalerDesc.colorProcessingMode = .perceptual

        guard let scaler = scalerDesc.makeSpatialScaler(device: device) else {
            fatalError("Error: Failed to create MTLFXSpatialScaler for \(file).")
        }

        scaler.colorTexture = inputTexture
        scaler.outputTexture = outputTexture

        // 3. Warmup passes
        for _ in 0..<warmupIterations {
            guard let cb = commandQueue.makeCommandBuffer() else { continue }
            scaler.encode(commandBuffer: cb)
            cb.commit()
            cb.waitUntilCompleted()
        }

        // 4. Benchmarking iterations
        var gpuTimesMs: [Double] = []
        var wallTimesMs: [Double] = []

        for _ in 0..<benchmarkIterations {
            let startWall = clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)
            guard let cb = commandQueue.makeCommandBuffer() else { continue }
            scaler.encode(commandBuffer: cb)
            cb.commit()
            cb.waitUntilCompleted()
            let endWall = clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)

            let wallTimeMs = Double(endWall - startWall) / 1_000_000.0
            let gpuTimeMs = (cb.gpuEndTime - cb.gpuStartTime) * 1000.0

            wallTimesMs.append(wallTimeMs)
            gpuTimesMs.append(gpuTimeMs > 0 ? gpuTimeMs : wallTimeMs)
        }

        // 5. Save MetalFX Output PNG
        saveTextureAsPNG(texture: outputTexture, to: outputMetalFxUrl)
        print("  -> Apple MetalFX 4K written.")

        // 6. Statistics
        let avgGpuTime = gpuTimesMs.reduce(0, +) / Double(gpuTimesMs.count)
        let minGpuTime = gpuTimesMs.min() ?? 0
        let maxGpuTime = gpuTimesMs.max() ?? 0
        let sortedGpuTimes = gpuTimesMs.sorted()
        let medianGpuTime = sortedGpuTimes[sortedGpuTimes.count / 2]
        let variance = gpuTimesMs.map { pow($0 - avgGpuTime, 2) }.reduce(0, +) / Double(gpuTimesMs.count)
        let stdDevGpuTime = sqrt(variance)
        let avgWallTime = wallTimesMs.reduce(0, +) / Double(wallTimesMs.count)
        let throughputFps = 1000.0 / avgGpuTime

        let vramAllocated = Double(inWidth * inHeight * 4 + outWidth * outHeight * 4) / (1024.0 * 1024.0)

        print(String(format: "  Average GPU Latency : %.3f ms (Min: %.3f ms, Max: %.3f ms)", avgGpuTime, minGpuTime, maxGpuTime))
        print(String(format: "  Average Wall Latency: %.3f ms", avgWallTime))
        print(String(format: "  Max Throughput       : %.1f FPS", throughputFps))
        print(String(format: "  VRAM Texture Memory : %.2f MB", vramAllocated))

        let result = BenchmarkResult(
            filename: file,
            inputResolution: "\(inWidth)x\(inHeight)",
            outputResolution: "\(outWidth)x\(outHeight)",
            scaleFactor: 2.0,
            warmupIterations: warmupIterations,
            benchmarkIterations: benchmarkIterations,
            avgGpuTimeMs: avgGpuTime,
            minGpuTimeMs: minGpuTime,
            maxGpuTimeMs: maxGpuTime,
            medianGpuTimeMs: medianGpuTime,
            stdDevGpuTimeMs: stdDevGpuTime,
            avgWallTimeMs: avgWallTime,
            throughputFps: throughputFps,
            vramAllocatedMb: vramAllocated
        )
        benchmarkResults.append(result)
    }

    let overallAvgGpu = benchmarkResults.map { $0.avgGpuTimeMs }.reduce(0, +) / Double(benchmarkResults.count)
    let overallFps = 1000.0 / overallAvgGpu

    print("\n==================================================================")
    print("  FINAL BENCHMARK SUMMARY")
    print("==================================================================")
    print("Device: \(device.name)")
    print(String(format: "Overall Average GPU Render Time : %.3f ms per frame", overallAvgGpu))
    print(String(format: "Overall Theoretical Throughput   : %.1f FPS", overallFps))
    print("24 FPS Film Frame-Budget Consumed: \(String(format: "%.1f", (overallAvgGpu / 41.66) * 100))% of available frame time")
    print("60 FPS Video Frame-Budget Consumed: \(String(format: "%.1f", (overallAvgGpu / 16.66) * 100))% of available frame time")
    print("==================================================================")

    let summary = BenchmarkSummary(
        timestamp: ISO8601DateFormatter().string(from: Date()),
        deviceName: device.name,
        osVersion: ProcessInfo.processInfo.operatingSystemVersionString,
        architecture: "Apple Silicon (arm64)",
        overallAvgGpuTimeMs: overallAvgGpu,
        overallThroughputFps: overallFps,
        results: benchmarkResults
    )

    let jsonEncoder = JSONEncoder()
    jsonEncoder.outputFormatting = .prettyPrinted
    if let jsonData = try? jsonEncoder.encode(summary) {
        let jsonUrl = baseDir.appendingPathComponent("benchmark_results.json")
        try? jsonData.write(to: jsonUrl)
        print("Full detailed benchmark saved to: \(jsonUrl.path)")
    }
}

main()
