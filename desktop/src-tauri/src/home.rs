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
//!
//! Every switch reloads the page, so one slow probe must not cause one: a local server behind a busy port forwarder
//! (Docker Desktop / OrbStack under load drop or delay ~1 in 10 connections) made the window bounce between the two
//! addresses every few seconds, back to the home page each time. See `Health`.

use base64::Engine;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::webview::cookie::Cookie;
use tauri::{AppHandle, Manager, Url, WebviewWindow};

const COOKIE: &str = "CF_Authorization";

/// Connect timeout of the start-up check (it runs before the window opens, so keep it short).
const START_CONNECT: Duration = Duration::from_millis(400);
/// Connect timeout of the watcher's probes (its own thread: patience costs nothing, a false "down" costs a reload).
const PROBE_CONNECT: Duration = Duration::from_millis(1500);
/// Leave the local address only after this many failed probes in a row (one every 3 s).
const LEAVE_AFTER_FAILS: u32 = 3;
/// Go (back) to the local address only after this many good probes in a row.
const RETURN_AFTER_OKS: u32 = 2;
/// After leaving because the local server looked down, stay on the public address at least this long; doubled on
/// every further fallback (a flapping server), up to `MAX_COOLDOWN`.
const FIRST_COOLDOWN: Duration = Duration::from_secs(60);
const MAX_COOLDOWN: Duration = Duration::from_secs(20 * 60);
/// This long on the local address without a fallback resets the cooldown.
const STABLE_RESET: Duration = Duration::from_secs(10 * 60);

/// Reachability of the local server, smoothed so that single slow probes never move the window.
#[derive(Debug)]
struct Health {
    fails: u32,                     // failed probes in a row (on the local address)
    oks: u32,                       // good probes in a row (on the public address)
    cooldown: Duration,             // hold-off for the next fallback
    hold_until: Option<Instant>,    // no switch to the local address before this
    on_local_since: Option<Instant>,
}

impl Health {
    fn new() -> Self {
        Health { fails: 0, oks: 0, cooldown: FIRST_COOLDOWN, hold_until: None, on_local_since: None }
    }

    /// A probe while the window shows the local address. True: the server counts as gone.
    fn local_probe(&mut self, up: bool, now: Instant) -> bool {
        self.oks = 0;
        let since = *self.on_local_since.get_or_insert(now);
        if up {
            self.fails = 0;
            if now.duration_since(since) >= STABLE_RESET {
                self.cooldown = FIRST_COOLDOWN;
            }
            return false;
        }
        self.fails += 1;
        self.fails >= LEAVE_AFTER_FAILS
    }

    /// The window left the local address because the server looked gone: hold off before coming back.
    fn left_local(&mut self, now: Instant) {
        self.fails = 0;
        self.oks = 0;
        self.on_local_since = None;
        self.hold_until = Some(now + self.cooldown);
        self.cooldown = (self.cooldown * 2).min(MAX_COOLDOWN);
    }

    /// A probe while the window shows the public address. True: the local address may be used (again).
    fn public_probe(&mut self, up: bool, now: Instant) -> bool {
        self.fails = 0;
        self.on_local_since = None;
        self.oks = if up { self.oks + 1 } else { 0 };
        self.oks >= RETURN_AFTER_OKS && self.hold_until.map_or(true, |t| now >= t)
    }
}

/// The page `cur` shows (path, query, #route) at `origin`, so a switch keeps the user where they were.
/// Cloudflare's own pages (/cdn-cgi/...) only exist at the public edge: those map to the origin's root.
fn same_page_at(origin: &Url, cur: &Url) -> Url {
    let mut u = origin.clone();
    if cur.path().starts_with("/cdn-cgi/") {
        return u;
    }
    u.set_path(cur.path());
    u.set_query(cur.query());
    u.set_fragment(cur.fragment());
    u
}

/// HTTP status of `GET /api/me` at `origin` with extra request headers (each ending in \r\n), or None.
fn status_of(origin: &Url, extra_headers: &str, connect: Duration) -> Option<u16> {
    let (host, port) = (origin.host_str()?, origin.port_or_known_default()?);
    for addr in (host, port).to_socket_addrs().ok()? {
        let Ok(mut s) = TcpStream::connect_timeout(&addr, connect) else { continue };
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
    Url::parse(origin).ok().and_then(|u| status_of(&u, "", START_CONNECT)).is_some()
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

/// Only the newest watcher runs: starting another one, or `stop_watcher`, ends the previous one.
static GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn stop_watcher() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// Keep the window on the best address, until the server is changed.
pub fn spawn_watcher(app: AppHandle, public: String, local: String) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        let (Ok(public), Ok(local)) = (Url::parse(&public), Url::parse(&local)) else { return };
        let mut last_move = Instant::now() - Duration::from_secs(60);
        let mut attempts = 0u32; // sign-in hand-overs tried for the current local page load
        let mut gave_up = false; // home mode switched off for this run
        let mut health = Health::new();
        loop {
            std::thread::sleep(Duration::from_secs(3));
            if GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            if gave_up {
                continue;
            }
            let Some(win) = app.get_webview_window("main") else { continue };
            let Ok(cur) = win.url() else { continue };
            let busy = playing(&app); // never interrupt playback
            let probe = || status_of(&local, "", PROBE_CONNECT).is_some();

            if same_origin(&cur, &public) {
                // Signed in on the public address and the server is (steadily) right here: switch.
                let local_ok = health.public_probe(probe(), Instant::now());
                if local_ok && !busy && last_move.elapsed() > Duration::from_secs(10) && fresh_cookie(&win, &public).is_some() {
                    eprintln!("[home] signed in; switching to the local server");
                    attempts = 0;
                    last_move = Instant::now();
                    let _ = win.navigate(same_page_at(&local, &cur));
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
                } else if health.local_probe(probe(), Instant::now()) {
                    if !busy {
                        eprintln!("[home] local server not reachable ({LEAVE_AFTER_FAILS} probes in a row); using the public address");
                        health.left_local(Instant::now());
                        last_move = Instant::now();
                        let _ = win.navigate(same_page_at(&public, &cur));
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
                        let _ = win.navigate(same_page_at(&public, &cur));
                    }
                } else {
                    attempts = 0; // a valid sign-in is in place
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const TICK: Duration = Duration::from_secs(3);

    #[test]
    fn single_slow_probes_never_leave_local() {
        let mut h = Health::new();
        let mut now = Instant::now();
        // the pattern seen with a busy port forwarder: an occasional failed probe among good ones
        for up in [true, false, true, false, false, true, false, true, true, false, false, true] {
            assert!(!h.local_probe(up, now), "left local on a short blip");
            now += TICK;
        }
    }

    #[test]
    fn a_server_that_stays_down_is_left() {
        let mut h = Health::new();
        let now = Instant::now();
        assert!(!h.local_probe(false, now));
        assert!(!h.local_probe(false, now + TICK));
        assert!(h.local_probe(false, now + TICK * 2));
    }

    #[test]
    fn coming_back_waits_for_steady_probes_and_the_cooldown() {
        let mut h = Health::new();
        let t0 = Instant::now();
        // never left: two good probes in a row are enough
        assert!(!h.public_probe(true, t0));
        assert!(h.public_probe(true, t0 + TICK));
        // a failed probe starts the count again
        assert!(!h.public_probe(false, t0 + TICK * 2));
        assert!(!h.public_probe(true, t0 + TICK * 3));
        assert!(h.public_probe(true, t0 + TICK * 4));

        // after a fallback: not before the cooldown, however good the probes
        h.left_local(t0);
        assert!(!h.public_probe(true, t0 + TICK));
        assert!(!h.public_probe(true, t0 + TICK * 2));
        assert!(!h.public_probe(true, t0 + FIRST_COOLDOWN - TICK));
        assert!(h.public_probe(true, t0 + FIRST_COOLDOWN));
    }

    #[test]
    fn cooldown_grows_while_flapping_and_resets_when_stable() {
        let mut h = Health::new();
        let mut now = Instant::now();
        let mut holds = vec![];
        for _ in 0..8 {
            h.left_local(now);
            holds.push(h.hold_until.unwrap() - now);
            now += MAX_COOLDOWN; // back on local after each hold
            h.local_probe(true, now);
        }
        assert_eq!(holds[0], FIRST_COOLDOWN);
        assert_eq!(holds[1], FIRST_COOLDOWN * 2);
        assert_eq!(holds[2], FIRST_COOLDOWN * 4);
        assert_eq!(*holds.last().unwrap(), MAX_COOLDOWN);

        // a long stable stretch on local: the next fallback starts small again
        h.local_probe(true, now + STABLE_RESET);
        h.left_local(now + STABLE_RESET);
        assert_eq!(h.hold_until.unwrap() - (now + STABLE_RESET), FIRST_COOLDOWN);
    }

    #[test]
    fn switches_keep_the_page() {
        let public = Url::parse("https://cinema.example.com").unwrap();
        let local = Url::parse("http://localhost:3002").unwrap();
        let cur = Url::parse("https://cinema.example.com/#/library?sort=lastwatched").unwrap();
        assert_eq!(same_page_at(&local, &cur).as_str(), "http://localhost:3002/#/library?sort=lastwatched");
        let cur = Url::parse("http://localhost:3002/?x=1#/server/42").unwrap();
        assert_eq!(same_page_at(&public, &cur).as_str(), "https://cinema.example.com/?x=1#/server/42");
        // Cloudflare's own pages never move to the other address
        let cur = Url::parse("https://cinema.example.com/cdn-cgi/access/authorized?token=t#/library").unwrap();
        assert_eq!(same_page_at(&local, &cur).as_str(), "http://localhost:3002/");
    }
}
