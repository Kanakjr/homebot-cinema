//! macOS "Now Playing": makes the app the system's current media app while mpv plays, so the Play/Pause key, AirPods
//! taps, the Touch Bar and Control Center control the player instead of starting Music.app.
//!
//! - `nowplaying/nowplaying_bridge.m` talks to MPNowPlayingInfoCenter and MPRemoteCommandCenter (main queue).
//! - What is shown comes from mpv properties (`PROPS`, observed by shell.rs) and the title the page sends with
//!   `media.metadata`. `Tracker` turns them into show/clear updates. macOS extrapolates the position from the rate,
//!   so an update goes out only when something changes or the position jumps (a seek), not on every frame.
//! - Commands arrive on the main thread and are handed to a worker thread: play/pause/next go to the page as the
//!   `media-key` shell signal (the player's own handler), seeks go straight to mpv. Never call libmpv on the main
//!   thread (see shell.rs).

use serde_json::{json, Value};
use std::ffi::{c_char, CString};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::{AppHandle, Manager};

/// mpv properties Now Playing follows. shell.rs observes them at start-up (ShellVideo observes them as well).
pub const PROPS: &[&str] = &["path", "pause", "paused-for-cache", "time-pos", "duration", "speed"];

/// A position this far (seconds) from where macOS would extrapolate it counts as a seek and is sent again.
const DRIFT: f64 = 1.0;

/// Mirrors the NP_* codes in nowplaying_bridge.m.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Command {
    Play,
    Pause,
    Toggle,
    Next,
    SkipForward(f64),
    SkipBackward(f64),
    SeekTo(f64),
}

impl Command {
    pub fn from_raw(cmd: i32, value: f64) -> Option<Command> {
        let secs = Some(value).filter(|v| v.is_finite() && *v >= 0.0);
        match cmd {
            1 => Some(Command::Play),
            2 => Some(Command::Pause),
            3 => Some(Command::Toggle),
            4 => Some(Command::Next),
            5 => secs.filter(|s| *s > 0.0).map(Command::SkipForward),
            6 => secs.filter(|s| *s > 0.0).map(Command::SkipBackward),
            7 => secs.map(Command::SeekTo),
            _ => None,
        }
    }

    pub fn route(self) -> Route {
        let seek = |to: String, how: &str| Route::Mpv(vec!["seek".into(), to, how.into()]);
        match self {
            Command::Play => Route::Page("play"),
            Command::Pause => Route::Page("pause"),
            Command::Toggle => Route::Page("play-pause"),
            Command::Next => Route::Page("next-track"),
            Command::SkipForward(s) => seek(format!("{s}"), "relative"),
            Command::SkipBackward(s) => seek(format!("-{s}"), "relative"),
            Command::SeekTo(p) => seek(format!("{p}"), "absolute"),
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Route {
    /// A `media-key` action for the web player (Player.js handles play-pause, play, pause, next-track).
    Page(&'static str),
    /// mpv command arguments.
    Mpv(Vec<String>),
}

/// What macOS shows.
#[derive(Debug, Clone, PartialEq)]
pub struct Info {
    pub title: String,
    pub artist: Option<String>,
    /// None: unknown (live stream, no seeking).
    pub duration: Option<f64>,
    pub elapsed: f64,
    /// 0 while paused or buffering.
    pub rate: f64,
    pub playing: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Show(Info),
    Clear,
}

/// Player state -> Now Playing updates. Pure, so it is tested without the system frameworks.
pub struct Tracker {
    title: Option<String>,
    artist: Option<String>,
    path: Option<String>,
    pos: Option<f64>,
    duration: Option<f64>,
    pause: bool,
    buffering: bool,
    speed: f64,
    /// Set once a loaded file reports a position (it is really playing), until the file goes away.
    active: bool,
    /// Last update sent and when (seconds on the caller's clock).
    shown: Option<(Info, f64)>,
}

impl Tracker {
    pub const fn new() -> Self {
        Tracker {
            title: None,
            artist: None,
            path: None,
            pos: None,
            duration: None,
            pause: false,
            buffering: false,
            speed: 1.0,
            active: false,
            shown: None,
        }
    }

    /// An mpv property changed; `v` is Null when it became unavailable (e.g. everything after `stop`).
    pub fn prop(&mut self, name: &str, v: &Value, now: f64) -> Option<Action> {
        match name {
            "path" => {
                let path = v.as_str().filter(|s| !s.is_empty()).map(String::from);
                if path != self.path {
                    // a new file (or none): forget the old position and length
                    self.pos = None;
                    self.duration = None;
                }
                self.path = path;
            }
            "pause" => self.pause = v.as_bool().unwrap_or(false),
            "paused-for-cache" => self.buffering = v.as_bool().unwrap_or(false),
            // Position and length go away just before the file does (`stop`), or for a moment during some seeks:
            // keep the last ones rather than send a stale position. A new file resets them (above).
            "time-pos" => match v.as_f64().filter(|p| p.is_finite()) {
                Some(p) => self.pos = Some(p.max(0.0)),
                None => return None,
            },
            "duration" => match v.as_f64().filter(|d| d.is_finite() && *d > 0.0) {
                Some(d) => self.duration = Some(d),
                None => return None,
            },
            "speed" => self.speed = v.as_f64().filter(|s| s.is_finite() && *s > 0.0).unwrap_or(1.0),
            _ => return None,
        }
        self.evaluate(now)
    }

    /// `media.metadata` from the page: `{ title, artist?, artUrl? }`. Kept until the next one: on "next episode"
    /// the new title can arrive before or after the new file starts.
    pub fn metadata(&mut self, v: &Value, now: f64) -> Option<Action> {
        let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(String::from);
        let title = text("title");
        if title.is_none() {
            return None;
        }
        self.title = title;
        self.artist = text("artist");
        self.evaluate(now)
    }

    pub fn is_shown(&self) -> bool {
        self.shown.is_some()
    }

    fn evaluate(&mut self, now: f64) -> Option<Action> {
        if self.path.is_none() {
            self.active = false;
        } else if self.pos.is_some() {
            self.active = true;
        }
        if !self.active {
            return self.shown.take().map(|_| Action::Clear);
        }
        let playing = !self.pause && !self.buffering;
        let info = Info {
            title: self.title.clone().unwrap_or_default(),
            artist: self.artist.clone(),
            duration: self.duration,
            elapsed: self.pos.unwrap_or(0.0),
            rate: if playing { self.speed } else { 0.0 },
            playing,
        };
        if let Some((last, at)) = &self.shown {
            let same = last.title == info.title
                && last.artist == info.artist
                && last.duration == info.duration
                && last.rate == info.rate
                && last.playing == info.playing;
            let expected = last.elapsed + (now - at).max(0.0) * last.rate;
            if same && (info.elapsed - expected).abs() <= DRIFT {
                return None;
            }
        }
        self.shown = Some((info.clone(), now));
        Some(Action::Show(info))
    }
}

// ---- glue ---------------------------------------------------------------------------------------

extern "C" {
    fn cinema_np_init(cb: extern "C" fn(i32, f64));
    fn cinema_np_show(title: *const c_char, artist: *const c_char, duration: f64, elapsed: f64, rate: f64, playing: i32);
    fn cinema_np_clear();
}

static TRACKER: Mutex<Tracker> = Mutex::new(Tracker::new());
static EPOCH: OnceLock<Instant> = OnceLock::new();
static COMMANDS: OnceLock<Sender<Command>> = OnceLock::new();

fn now() -> f64 {
    EPOCH.get_or_init(Instant::now).elapsed().as_secs_f64()
}

/// An mpv property changed (mpv event thread). `value` is Null when the property became unavailable.
pub fn on_prop(app: &AppHandle, name: &str, value: &Value) {
    if PROPS.contains(&name) {
        update(app, |t, now| t.prop(name, value, now));
    }
}

/// `media.metadata` from the page (shell thread pool).
pub fn on_metadata(app: &AppHandle, value: &Value) {
    update(app, |t, now| t.metadata(value, now));
}

/// Runs with the tracker locked, so updates reach the main queue in order.
fn update(app: &AppHandle, f: impl FnOnce(&mut Tracker, f64) -> Option<Action>) {
    let Ok(mut t) = TRACKER.lock() else { return };
    let was_shown = t.is_shown();
    match f(&mut t, now()) {
        Some(Action::Show(info)) => {
            start(app);
            if !was_shown {
                eprintln!("[nowplaying] playing: this app takes the media keys and Control Center");
            }
            let cstr = |s: &str| CString::new(s.replace('\0', "")).unwrap_or_default();
            let title = cstr(&info.title);
            let artist = info.artist.as_deref().map(cstr);
            unsafe {
                cinema_np_show(
                    title.as_ptr(),
                    artist.as_ref().map_or(std::ptr::null(), |a| a.as_ptr()),
                    info.duration.unwrap_or(0.0),
                    info.elapsed,
                    info.rate,
                    info.playing as i32,
                )
            };
        }
        Some(Action::Clear) => {
            eprintln!("[nowplaying] playback ended: cleared");
            unsafe { cinema_np_clear() };
        }
        None => {}
    }
}

fn start(app: &AppHandle) {
    COMMANDS.get_or_init(|| {
        let (tx, rx) = channel::<Command>();
        let app = app.clone();
        std::thread::spawn(move || {
            for c in rx {
                run(&app, c);
            }
        });
        unsafe { cinema_np_init(on_command) };
        tx
    });
}

/// From MPRemoteCommandCenter, on the main thread: hand over only (no libmpv here).
extern "C" fn on_command(cmd: i32, value: f64) {
    if let (Some(c), Some(tx)) = (Command::from_raw(cmd, value), COMMANDS.get()) {
        let _ = tx.send(c);
    }
}

fn run(app: &AppHandle, c: Command) {
    eprintln!("[nowplaying] command {c:?}");
    match c.route() {
        Route::Page(key) => crate::shell::emit(app, "media-key", json!(key)),
        Route::Mpv(args) => {
            let m = app.state::<crate::Player>().0.lock().unwrap().clone();
            if let Some(m) = m {
                if let Err(e) = m.command(&args) {
                    eprintln!("[nowplaying] seek failed: {e}");
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn show(a: Option<Action>) -> Info {
        match a {
            Some(Action::Show(i)) => i,
            other => panic!("expected Show, got {other:?}"),
        }
    }

    /// A file that is loaded and has reported a position.
    fn playing(t: &mut Tracker) -> Info {
        assert_eq!(t.prop("pause", &json!(false), 0.0), None);
        assert_eq!(t.prop("path", &json!("https://h/stream"), 0.0), None, "not shown before playback starts");
        assert_eq!(t.prop("duration", &json!(1200.0), 0.0), None);
        show(t.prop("time-pos", &json!(0.0), 0.0))
    }

    #[test]
    fn shown_once_playback_starts_then_only_on_changes() {
        let mut t = Tracker::new();
        let i = playing(&mut t);
        assert_eq!(i, Info { title: String::new(), artist: None, duration: Some(1200.0), elapsed: 0.0, rate: 1.0, playing: true });
        // Normal progress: macOS extrapolates, nothing to send.
        for s in 1..20 {
            assert_eq!(t.prop("time-pos", &json!(s as f64 * 0.5), s as f64 * 0.5), None);
        }
        // Pause: rate 0, state paused.
        let i = show(t.prop("pause", &json!(true), 10.0));
        assert_eq!((i.playing, i.rate, i.elapsed), (false, 0.0, 9.5));
        // Paused: the clock moves, the position does not; still nothing to send.
        assert_eq!(t.prop("time-pos", &json!(9.5), 30.0), None);
        // Resume.
        let i = show(t.prop("pause", &json!(false), 31.0));
        assert_eq!((i.playing, i.rate), (true, 1.0));
    }

    #[test]
    fn seeks_and_stalls_are_resent() {
        let mut t = Tracker::new();
        playing(&mut t);
        assert_eq!(t.prop("time-pos", &json!(5.0), 5.0), None);
        // Jump forward 60 s.
        assert_eq!(show(t.prop("time-pos", &json!(65.0), 5.2)).elapsed, 65.0);
        // Stalled without paused-for-cache: once it is off by more than DRIFT, correct it.
        assert_eq!(t.prop("time-pos", &json!(65.5), 6.0), None);
        assert_eq!(show(t.prop("time-pos", &json!(65.6), 7.5)).elapsed, 65.6);
        // Buffering counts as paused.
        let i = show(t.prop("paused-for-cache", &json!(true), 8.0));
        assert_eq!((i.playing, i.rate), (false, 0.0));
        // Speed change.
        t.prop("paused-for-cache", &json!(false), 9.0);
        assert_eq!(show(t.prop("speed", &json!(1.5), 9.0)).rate, 1.5);
    }

    #[test]
    fn title_from_the_page_and_kept_across_files() {
        let mut t = Tracker::new();
        // Metadata before playback: remembered, nothing shown yet.
        assert_eq!(t.metadata(&json!({ "title": "Pilot (1x1)", "artist": "The Show", "artUrl": "https://img/logo.png" }), 0.0), None);
        let i = playing(&mut t);
        assert_eq!((i.title.as_str(), i.artist.as_deref()), ("Pilot (1x1)", Some("The Show")));
        // A movie: no artist.
        let i = show(t.metadata(&json!({ "title": "A Movie" }), 2.0));
        assert_eq!((i.title.as_str(), i.artist), ("A Movie", None));
        // Empty titles are ignored.
        assert_eq!(t.metadata(&json!({ "title": "  " }), 3.0), None);
        // Next file: stop clears, the title stays for the next one.
        assert_eq!(t.prop("path", &Value::Null, 4.0), Some(Action::Clear));
        t.prop("path", &json!("https://h/next"), 5.0);
        assert_eq!(show(t.prop("time-pos", &json!(0.0), 6.0)).title, "A Movie");
    }

    #[test]
    fn cleared_when_playback_stops() {
        let mut t = Tracker::new();
        playing(&mut t);
        assert!(t.is_shown());
        // `stop`: time-pos and duration go first, then path. No stale update in between.
        assert_eq!(t.prop("time-pos", &Value::Null, 3.0), None);
        assert_eq!(t.prop("duration", &Value::Null, 3.0), None);
        assert_eq!(t.prop("path", &Value::Null, 3.0), Some(Action::Clear));
        assert!(!t.is_shown());
        // Nothing playing: no further updates, and no second Clear.
        assert_eq!(t.prop("pause", &json!(true), 4.0), None);
        assert_eq!(t.prop("path", &Value::Null, 4.0), None);
        // Loaded but not started (opening a stream): still nothing; the old position is not reused.
        assert_eq!(t.prop("path", &json!("https://h/other"), 5.0), None);
        assert_eq!(t.prop("pause", &json!(false), 5.0), None);
        assert!(!t.is_shown());
    }

    #[test]
    fn live_streams_have_no_duration() {
        let mut t = Tracker::new();
        t.prop("path", &json!("https://h/live"), 0.0);
        let i = show(t.prop("time-pos", &json!(12.0), 0.0));
        assert_eq!(i.duration, None);
        assert_eq!(t.prop("duration", &json!(0.0), 1.0), None, "a zero duration is unknown, not a change");
    }

    #[test]
    fn commands() {
        let route = |cmd, v| Command::from_raw(cmd, v).unwrap().route();
        let mpv = |a: &[&str]| Route::Mpv(a.iter().map(|s| s.to_string()).collect());
        assert_eq!(route(3, 0.0), Route::Page("play-pause"));
        assert_eq!(route(1, 0.0), Route::Page("play"));
        assert_eq!(route(2, 0.0), Route::Page("pause"));
        assert_eq!(route(4, 0.0), Route::Page("next-track"));
        assert_eq!(route(5, 10.0), mpv(&["seek", "10", "relative"]));
        assert_eq!(route(6, 10.0), mpv(&["seek", "-10", "relative"]));
        assert_eq!(route(7, 754.5), mpv(&["seek", "754.5", "absolute"]));
        assert_eq!(Command::from_raw(7, f64::NAN), None);
        assert_eq!(Command::from_raw(7, -1.0), None);
        assert_eq!(Command::from_raw(5, 0.0), None);
        assert_eq!(Command::from_raw(99, 0.0), None);
    }
}
