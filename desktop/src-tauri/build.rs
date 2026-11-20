use std::{env, fs};

fn main() {
    // The remote capability names the one web origin allowed to call `shell_ipc`. It comes from the environment
    // (CINEMA_ORIGIN=https://your-host) so no personal hostname is committed; the generated file is git-ignored.
    println!("cargo:rerun-if-env-changed=CINEMA_ORIGIN");
    let origin = env::var("CINEMA_ORIGIN").ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| "https://cinema.example.com".into());
    let origin = origin.trim_end_matches('/');
    let ok_chars = origin.chars().all(|c| c.is_ascii_alphanumeric() || ".:-/".contains(c));
    let ok_scheme = origin.starts_with("https://") || origin.starts_with("http://localhost");
    assert!(ok_chars && ok_scheme, "CINEMA_ORIGIN must look like https://host[:port] (got {origin:?})");
    println!("cargo:rustc-env=CINEMA_ORIGIN_BAKED={origin}"); // read by main.rs (env!)
    // Home mode: the server's direct address on this machine / home network (plain HTTP). "none" disables it.
    println!("cargo:rerun-if-env-changed=CINEMA_LOCAL_ORIGIN");
    let local = env::var("CINEMA_LOCAL_ORIGIN").unwrap_or_else(|_| "http://localhost:3002".into());
    let local = local.trim_end_matches('/');
    let local = if local == "none" { "" } else { local };
    if !local.is_empty() {
        let ok_chars = local.chars().all(|c| c.is_ascii_alphanumeric() || ".:-/".contains(c));
        let ok_host = ["http://localhost", "http://127.0.0.1", "http://192.168.", "http://10."].iter().any(|p| local.starts_with(p));
        assert!(ok_chars && ok_host, "CINEMA_LOCAL_ORIGIN must be http://localhost[:port], http://127.0.0.1[:port] or a private LAN address, or `none` (got {local:?})");
    }
    println!("cargo:rustc-env=CINEMA_LOCAL_ORIGIN_BAKED={local}");
    let urls = if local.is_empty() { format!("\"{origin}/*\"") } else { format!("\"{origin}/*\", \"{local}/*\"") };
    let capability = format!(
        r#"{{
    "$schema": "../gen/schemas/desktop-schema.json",
    "identifier": "remote-ui",
    "description": "Lets the web UI at {origin} (and the local server address) call shell_ipc (and nothing else)",
    "windows": ["main"],
    "remote": {{ "urls": [{urls}] }},
    "permissions": ["allow-shell-ipc"]
}}
"#
    );
    fs::write("capabilities/remote.json", capability).expect("write capabilities/remote.json");

    // Compile Apple MetalFX bridge (Objective-C / Metal)
    cc::Build::new()
        .file("src/metal/metalfx_bridge.m")
        .flag("-fobjc-arc")
        .flag("-DGL_SILENCE_DEPRECATION")
        .compile("metalfx_bridge");

    println!("cargo:rustc-link-lib=framework=Metal");
    println!("cargo:rustc-link-lib=framework=MetalFX");
    println!("cargo:rustc-link-lib=framework=MetalPerformanceShaders");
    println!("cargo:rustc-link-lib=framework=IOSurface");
    println!("cargo:rustc-link-lib=framework=OpenGL");
    println!("cargo:rustc-link-lib=framework=QuartzCore");
    println!("cargo:rustc-link-lib=framework=Cocoa");

    // System "Now Playing" (media keys, Control Center), driven by src/nowplaying.rs
    println!("cargo:rerun-if-changed=src/nowplaying/nowplaying_bridge.m");
    cc::Build::new()
        .file("src/nowplaying/nowplaying_bridge.m")
        .flag("-fobjc-arc")
        .compile("nowplaying_bridge");
    println!("cargo:rustc-link-lib=framework=MediaPlayer");

    // Declaring the app commands makes Tauri's ACL cover them: each gets an `allow-<name>` permission.
    // Only `shell_ipc` is granted to the remote web UI; see capabilities/.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "shell_ipc",
            "mpv_load",
            "mpv_command",
            "mpv_status",
            "spike_reorder",
            "get_server",
            "set_server",
            "metalfx_toggle",
            "metalfx_status",
        ]),
    ))
    .expect("failed to run tauri-build");
}
