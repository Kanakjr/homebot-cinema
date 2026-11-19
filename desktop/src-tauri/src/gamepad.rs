//! Game controllers for the web UI.
//!
//! `gamepad/gamepad_bridge.m` reads controllers natively through Apple's GameController framework. This module copies
//! its snapshots on a background thread and pushes changes into the page, where `gamepad_shim.js` serves them as the
//! W3C Gamepad API (`navigator.getGamepads`) and turns button presses into the app's own key presses and actions.
//! WebKit's built-in Gamepad API is not used: the shim keeps pages from starting it (see the shim's header).

use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

pub const SHIM: &str = include_str!("gamepad_shim.js");

pub const MAX_PADS: usize = 4;
pub const BUTTONS: usize = 18;
pub const AXES: usize = 4;

/// Mirrors `cinema_pad_state` in gamepad_bridge.m.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct PadState {
    pub connected: u32,
    pub seq: u32,
    pub buttons: [f32; BUTTONS],
    pub axes: [f32; AXES],
    pub battery: f32,
    pub battery_state: i32,
    pub name: [u8; 64],
}

impl Default for PadState {
    fn default() -> Self {
        PadState { connected: 0, seq: 0, buttons: [0.0; BUTTONS], axes: [0.0; AXES], battery: -1.0, battery_state: -1, name: [0; 64] }
    }
}

extern "C" {
    fn cinema_pad_start();
    fn cinema_pad_snapshot(out: *mut PadState, max: i32) -> i32;
}

/// Values are sent with three decimals: enough for sticks and triggers, and the messages stay small.
fn round3(v: f32) -> f64 {
    (f64::from(v) * 1000.0).round() / 1000.0
}

fn name_of(p: &PadState) -> String {
    let end = p.name.iter().position(|&b| b == 0).unwrap_or(p.name.len());
    String::from_utf8_lossy(&p.name[..end]).into_owned()
}

/// The message for the page: every slot, connected or not (the shim fires connect/disconnect from the flag).
/// `since` = when each slot's controller connected (Unix ms), so a page that loads later can tell a controller that
/// was already there from one that just connected.
pub fn payload(pads: &[PadState], since: &[Option<u64>]) -> Value {
    let list: Vec<Value> = pads
        .iter()
        .enumerate()
        .map(|(slot, p)| {
            if p.connected == 0 {
                return json!({ "slot": slot, "connected": false });
            }
            json!({
                "slot": slot,
                "connected": true,
                "since": since.get(slot).copied().flatten(),
                "id": name_of(p),
                "b": p.buttons.iter().map(|&v| round3(v)).collect::<Vec<_>>(),
                "a": p.axes.iter().map(|&v| round3(v)).collect::<Vec<_>>(),
                "battery": if p.battery < 0.0 { Value::Null } else { json!(round3(p.battery)) },
                "charging": p.battery_state == 1,
            })
        })
        .collect();
    json!({ "pads": list })
}

fn unix_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// What changed since the last push, by slot: (connected, seq).
fn signature(pads: &[PadState]) -> Vec<(u32, u32)> {
    pads.iter().map(|p| (p.connected, p.seq)).collect()
}

/// Starts the native side (main thread) and the thread that forwards changes to the page.
pub fn start(app: &AppHandle) {
    let ready = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag = ready.clone();
    let started = app.run_on_main_thread(move || {
        unsafe { cinema_pad_start() };
        flag.store(true, std::sync::atomic::Ordering::SeqCst);
    });
    if let Err(e) = started {
        eprintln!("[gamepad] could not start: {e}");
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last: Vec<(u32, u32)> = Vec::new();
        let mut last_push = Instant::now();
        let mut pads = [PadState::default(); MAX_PADS];
        let mut since: [Option<u64>; MAX_PADS] = [None; MAX_PADS];
        loop {
            std::thread::sleep(Duration::from_millis(16));
            if !ready.load(std::sync::atomic::Ordering::SeqCst) {
                continue;
            }
            let n = unsafe { cinema_pad_snapshot(pads.as_mut_ptr(), MAX_PADS as i32) }.max(0) as usize;
            let pads = &pads[..n];
            for (slot, p) in pads.iter().enumerate() {
                since[slot] = match (p.connected != 0, since[slot]) {
                    (true, None) => Some(unix_ms()),
                    (true, kept) => kept,
                    (false, _) => None,
                };
            }
            let sig = signature(pads);
            let any = pads.iter().any(|p| p.connected != 0);
            // Changes go out at once; while a controller is connected the state is also re-sent once a second,
            // so a page that just loaded (or navigated) learns about it without waiting for a press.
            let heartbeat = any && last_push.elapsed() >= Duration::from_secs(1);
            if sig == last && !heartbeat {
                continue;
            }
            last = sig;
            last_push = Instant::now();
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval(format!("window.__cinemaPad&&window.__cinemaPad.update({})", payload(pads, &since)));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pad(name: &str) -> PadState {
        let mut p = PadState { connected: 1, seq: 3, ..PadState::default() };
        p.name[..name.len()].copy_from_slice(name.as_bytes());
        p
    }

    #[test]
    fn payload_lists_every_slot() {
        let mut a = pad("Xbox Wireless Controller");
        a.buttons[0] = 1.0;
        a.buttons[7] = 0.123_456;
        a.axes[1] = -0.5;
        a.battery = 0.8;
        a.battery_state = 1;
        let v = payload(&[a, PadState::default()], &[Some(1_700_000_000_000), None]);
        let pads = v["pads"].as_array().unwrap();
        assert_eq!(pads.len(), 2);
        assert_eq!(pads[0]["id"], "Xbox Wireless Controller");
        assert_eq!(pads[0]["since"], 1_700_000_000_000u64);
        assert_eq!(pads[0]["b"].as_array().unwrap().len(), BUTTONS);
        assert_eq!(pads[0]["b"][0], 1.0);
        assert_eq!(pads[0]["b"][7], 0.123);
        assert_eq!(pads[0]["a"][1], -0.5);
        assert_eq!(pads[0]["battery"], 0.8);
        assert_eq!(pads[0]["charging"], true);
        assert_eq!(pads[1], json!({ "slot": 1, "connected": false }));
    }

    #[test]
    fn unknown_battery_is_null() {
        let v = payload(&[pad("Pad")], &[]);
        assert!(v["pads"][0]["battery"].is_null());
        assert!(v["pads"][0]["since"].is_null());
        assert_eq!(v["pads"][0]["charging"], false);
    }

    #[test]
    fn name_stops_at_nul_and_survives_bad_utf8() {
        let mut p = pad("abc");
        p.name[5] = b'x'; // after the terminator: ignored
        assert_eq!(name_of(&p), "abc");
        let mut q = PadState::default();
        q.name[0] = 0xff;
        assert_eq!(name_of(&q), "\u{fffd}");
    }

    #[test]
    fn signature_changes_with_seq_and_connection() {
        let a = pad("A");
        let mut b = a;
        assert_eq!(signature(&[a]), signature(&[b]));
        b.seq += 1;
        assert_ne!(signature(&[a]), signature(&[b]));
        let mut c = a;
        c.connected = 0;
        assert_ne!(signature(&[a]), signature(&[c]));
    }

    #[test]
    fn struct_layout_matches_the_c_side() {
        // 2 x u32 + 18 + 4 floats + f32 + i32 + 64 bytes
        assert_eq!(std::mem::size_of::<PadState>(), 4 * 2 + 4 * BUTTONS + 4 * AXES + 4 + 4 + 64);
    }
}
