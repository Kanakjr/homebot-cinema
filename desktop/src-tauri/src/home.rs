//! "Home mode": when the server runs on this Mac (or the home network), talk to it directly instead of going
//! out to Cloudflare and back (about 0.4 s per request instead of a few ms, and no upload bandwidth used).
//!
//! The server only verifies the signed Cloudflare Access token (header or `CF_Authorization` cookie), never the
//! address the request came from, so after the normal sign-in on the public address the same token is given to
//! the local address. When the local server is unreachable, or the token is missing/expired, the window goes
//! back to the public address, which handles sign-in.
//!
//! How the token reaches the local address: WKWebView stores a cookie injected through its cookie API for a
//! host like `localhost`, but does not send it with requests (and wry cannot match IP-address hosts at all). A
//! cookie set by the page itself (`document.cookie`) is an ordinary host-only cookie and is sent. Trade-off: that
//! copy is not HttpOnly, so the local page's own scripts can read it (at the public address it is HttpOnly).
//! It is the user's own token, short-lived (the Access session length), on the same machine.

use base64::Engine;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::webview::cookie::Cookie;
use tauri::{AppHandle, Manager, Url, WebviewWindow};

const COOKIE: &str = "CF_Authorization";

/// HTTP status of `GET /api/me` at `origin` with extra request headers (each ending in \r\n), or None.
fn status_of(origin: &Url, extra_headers: &str) -> Option<u16> {
    let (host, port) = (origin.host_str()?, origin.port_or_known_default()?);
    for addr in (host, port).to_socket_addrs().ok()? {
        let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else { continue };
        let _ = s.set_read_timeout(Some(Duration::from_millis(1500)));
        let _ = s.set_write_timeout(Some(Duration::from_millis(1500)));
        let req = format!("GET /api/me HTTP/1.0\r\nHost: {host}\r\n{extra_headers}Connection: close\r\n\r\n");
        if s.write_all(req.as_bytes()).is_err() {
            continue;
        }
        let mut buf = [0u8; 16];
        if s.read_exact(&mut buf).is_ok() && buf.starts_with(b"HTTP/") {
            return std::str::from_utf8(&buf[9..12]).ok()?.parse().ok();
        }
    }
    None
}

/// Something answers HTTP at `origin` (any status counts: a logged-out server answers 401).
pub fn reachable(origin: &str) -> bool {
    Url::parse(origin).ok().and_then(|u| status_of(&u, "")).is_some()
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme() && a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}

/// Seconds until the token's own `exp` claim (no signature check: the server does that), if it has one.
fn token_ttl(token: &str) -> Option<u64> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let exp = serde_json::from_slice::<Value>(&bytes).ok()?.get("exp")?.as_u64()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    exp.checked_sub(now)
}

/// The Access cookie for `origin`, only if its token still has more than a minute left.
fn fresh_cookie(win: &WebviewWindow, origin: &Url) -> Option<Cookie<'static>> {
    let all = win.cookies_for_url(origin.clone()).ok()?;
    all.into_iter().find(|c| c.name() == COOKIE && token_ttl(c.value()).map_or(false, |t| t > 60))
}

/// A usable sign-in for the LOCAL address: the script-set copy (never HttpOnly). An HttpOnly one there can only
/// have come from the cookie API, which WebKit does not send, so it is treated as missing and replaced.
fn fresh_local_cookie(win: &WebviewWindow, local: &Url) -> Option<Cookie<'static>> {
    let all = win.cookies_for_url(local.clone()).ok()?;
    all.into_iter().find(|c| {
        c.name() == COOKIE && !c.http_only().unwrap_or(false) && token_ttl(c.value()).map_or(false, |t| t > 60)
    })
}

/// Give the page currently shown at the local address the public sign-in (see the module note). The page must
/// already be at the local origin; the caller reloads it afterwards.
fn inject_into_local_page(win: &WebviewWindow, public: &Url, local: &Url) -> bool {
    let Some(src) = fresh_cookie(win, public) else { return false };
    let Some(ttl) = token_ttl(src.value()) else { return false };
    // An older copy (an HttpOnly one from the cookie API) cannot be overwritten from script: remove it first.
    if let Ok(cs) = win.cookies_for_url(local.clone()) {
        for c in cs.into_iter().filter(|c| c.name() == COOKIE) {
            let _ = win.delete_cookie(c);
        }
    }
    let value = format!("{COOKIE}={}; path=/; SameSite=Lax; Max-Age={ttl}", src.value());
    win.eval(format!("document.cookie={}", serde_json::to_string(&value).unwrap())).is_ok()
}

fn playing(app: &AppHandle) -> bool {
    let m = app.state::<crate::Player>().0.lock().unwrap().clone();
    m.map_or(false, |m| m.get_property("path").is_some())
}

/// Keep the window on the best address. Runs for the life of the app.
pub fn spawn_watcher(app: AppHandle, public: String, local: String) {
    std::thread::spawn(move || {
        let (Ok(public), Ok(local)) = (Url::parse(&public), Url::parse(&local)) else { return };
        let mut last_move = Instant::now() - Duration::from_secs(60);
        let mut attempts = 0u32; // sign-in hand-overs tried for the current local page load
        let mut gave_up = false; // home mode switched off for this run
        loop {
            std::thread::sleep(Duration::from_secs(3));
            if gave_up {
                continue;
            }
            let Some(win) = app.get_webview_window("main") else { continue };
            let Ok(cur) = win.url() else { continue };
            let local_up = status_of(&local, "").is_some();
            let busy = playing(&app); // never interrupt playback

            if same_origin(&cur, &public) {
                // Signed in on the public address and the server is right here: switch.
                if local_up && !busy && last_move.elapsed() > Duration::from_secs(10) && fresh_cookie(&win, &public).is_some() {
                    eprintln!("[home] signed in; switching to the local server");
                    attempts = 0;
                    last_move = Instant::now();
                    let _ = win.navigate(local.clone());
                }
            } else if same_origin(&cur, &local) {
                if cur.path().starts_with("/cdn-cgi/") {
                    // The UI's "sign out" link exists only at Cloudflare's edge: do it there and forget the local copy.
                    eprintln!("[home] sign-out: leaving the local server");
                    if let Ok(cs) = win.cookies_for_url(local.clone()) {
                        for c in cs.into_iter().filter(|c| c.name() == COOKIE) {
                            let _ = win.delete_cookie(c);
                        }
                    }
                    if let Ok(u) = public.join(cur.path()) {
                        let _ = win.navigate(u);
                    }
                } else if !local_up {
                    if !busy {
                        eprintln!("[home] local server not reachable; using the public address");
                        last_move = Instant::now();
                        let _ = win.navigate(public.clone());
                    }
                } else if fresh_local_cookie(&win, &local).is_none() {
                    if attempts < 2 && inject_into_local_page(&win, &public, &local) {
                        attempts += 1;
                        eprintln!("[home] gave the local page your sign-in (attempt {attempts}); reloading");
                        let _ = win.eval("location.reload()");
                    } else if !busy {
                        // No usable sign-in for the local address (none stored, expired, or it did not stick): go and
                        // sign in at the public address. If that cannot be handed over either, stop trying this run.
                        if attempts >= 2 {
                            eprintln!("[home] could not hand the sign-in to the local address; using the public address from now on");
                            gave_up = true;
                        } else {
                            eprintln!("[home] sign-in needed; going to the public address");
                        }
                        last_move = Instant::now();
                        let _ = win.navigate(public.clone());
                    }
                } else {
                    attempts = 0; // a valid sign-in is in place
                }
            }
        }
    });
}
