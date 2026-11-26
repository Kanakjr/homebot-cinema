//! Minimal libmpv client bound at runtime with libloading, so the spike needs no
//! third-party wrapper binary: only the system libmpv (Homebrew `mpv`).

use libloading::{Library, Symbol};
use std::ffi::{c_char, c_int, c_void, CStr, CString};

type MpvHandle = *mut c_void;

// ---- event / node structs (client.h) ----
pub const FORMAT_STRING: c_int = 1;
pub const FORMAT_FLAG: c_int = 3;
pub const FORMAT_INT64: c_int = 4;
pub const FORMAT_DOUBLE: c_int = 5;
pub const FORMAT_NODE: c_int = 6;
pub const FORMAT_NODE_ARRAY: c_int = 7;
pub const FORMAT_NODE_MAP: c_int = 8;

pub const EVENT_SHUTDOWN: c_int = 1;
pub const EVENT_END_FILE: c_int = 7;
pub const EVENT_PROPERTY_CHANGE: c_int = 22;

#[repr(C)]
pub struct RawEvent {
    pub event_id: c_int,
    pub error: c_int,
    pub reply_userdata: u64,
    pub data: *mut c_void,
}
#[repr(C)]
pub struct EventProperty {
    pub name: *const c_char,
    pub format: c_int,
    pub data: *mut c_void,
}
#[repr(C)]
pub struct EventEndFile {
    pub reason: c_int,
    pub error: c_int,
}
#[repr(C)]
pub union NodeU {
    pub string: *const c_char,
    pub flag: c_int,
    pub int64: i64,
    pub double: f64,
    pub list: *const NodeList,
    pub ba: *const c_void,
}
#[repr(C)]
pub struct Node {
    pub u: NodeU,
    pub format: c_int,
}
#[repr(C)]
pub struct NodeList {
    pub num: c_int,
    pub values: *const Node,
    pub keys: *const *const c_char,
}

pub struct Mpv {
    lib: Library,
    handle: MpvHandle,
}

// The mpv client API is documented as thread-safe for a single handle.
unsafe impl Send for Mpv {}
unsafe impl Sync for Mpv {}

fn libmpv_path() -> String {
    std::env::var("LIBMPV_PATH").unwrap_or_else(|_| {
        // Packaged app: libmpv and its dependencies are bundled in Contents/Frameworks.
        if let Ok(exe) = std::env::current_exe() {
            if let Some(p) = exe.parent().and_then(|d| d.parent()).map(|c| c.join("Frameworks/libmpv.2.dylib")) {
                if p.exists() {
                    return p.to_string_lossy().into_owned();
                }
            }
        }
        for p in ["/opt/homebrew/lib/libmpv.dylib", "/usr/local/lib/libmpv.dylib"] {
            if std::path::Path::new(p).exists() {
                return p.to_string();
            }
        }
        "libmpv.dylib".to_string()
    })
}

impl Mpv {
    pub fn lib(&self) -> &Library {
        &self.lib
    }

    pub fn handle_ptr(&self) -> *mut c_void {
        self.handle
    }

    /// Observe a property; mpv delivers the current value and every change as MPV_EVENT_PROPERTY_CHANGE
    /// in node format (so flags, numbers, maps and arrays arrive correctly typed).
    pub fn observe_node(&self, name: &str) -> Result<(), String> {
        unsafe {
            let f: Symbol<unsafe extern "C" fn(MpvHandle, u64, *const c_char, c_int) -> c_int> =
                self.lib.get(b"mpv_observe_property\0").map_err(|e| e.to_string())?;
            let n = CString::new(name).unwrap();
            self.check(f(self.handle, 0, n.as_ptr(), FORMAT_NODE), &format!("observe {name}"))
        }
    }

    /// Wait for the next event. Only ONE thread may call this. The pointer is valid until the next call.
    pub unsafe fn wait_event(&self, timeout_s: f64) -> *const RawEvent {
        match self.lib.get::<unsafe extern "C" fn(MpvHandle, f64) -> *const RawEvent>(b"mpv_wait_event\0") {
            Ok(f) => f(self.handle, timeout_s),
            Err(_) => std::ptr::null(),
        }
    }

    pub fn error_text(&self, code: c_int) -> String {
        unsafe {
            match self.lib.get::<unsafe extern "C" fn(c_int) -> *const c_char>(b"mpv_error_string\0") {
                Ok(f) => CStr::from_ptr(f(code)).to_string_lossy().into_owned(),
                Err(_) => format!("mpv error {code}"),
            }
        }
    }

    pub fn new(options: &[(&str, String)]) -> Result<Self, String> {
        unsafe {
            // mpv requires the C numeric locale.
            libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr());
            let lib = Library::new(libmpv_path()).map_err(|e| format!("load libmpv: {e}"))?;
            let create: Symbol<unsafe extern "C" fn() -> MpvHandle> =
                lib.get(b"mpv_create\0").map_err(|e| e.to_string())?;
            let handle = create();
            if handle.is_null() {
                return Err("mpv_create returned null".into());
            }
            let mpv = Mpv { lib, handle };
            for (k, v) in options {
                mpv.set_option(k, v)?;
            }
            let init: Symbol<unsafe extern "C" fn(MpvHandle) -> c_int> =
                mpv.lib.get(b"mpv_initialize\0").map_err(|e| e.to_string())?;
            mpv.check(init(mpv.handle), "mpv_initialize")?;
            Ok(mpv)
        }
    }

    fn check(&self, code: c_int, what: &str) -> Result<(), String> {
        if code >= 0 {
            return Ok(());
        }
        unsafe {
            let err: Symbol<unsafe extern "C" fn(c_int) -> *const c_char> =
                self.lib.get(b"mpv_error_string\0").map_err(|e| e.to_string())?;
            let msg = CStr::from_ptr(err(code)).to_string_lossy().into_owned();
            Err(format!("{what}: {msg} ({code})"))
        }
    }

    pub fn set_option(&self, name: &str, value: &str) -> Result<(), String> {
        unsafe {
            let f: Symbol<unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int> =
                self.lib.get(b"mpv_set_option_string\0").map_err(|e| e.to_string())?;
            let (n, v) = (CString::new(name).unwrap(), CString::new(value).unwrap());
            self.check(f(self.handle, n.as_ptr(), v.as_ptr()), &format!("option {name}"))
        }
    }

    pub fn command(&self, args: &[String]) -> Result<(), String> {
        unsafe {
            let f: Symbol<unsafe extern "C" fn(MpvHandle, *const *const c_char) -> c_int> =
                self.lib.get(b"mpv_command\0").map_err(|e| e.to_string())?;
            let owned: Vec<CString> = args.iter().map(|a| CString::new(a.as_str()).unwrap()).collect();
            let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
            ptrs.push(std::ptr::null());
            self.check(f(self.handle, ptrs.as_ptr()), &format!("command {:?}", args.first()))
        }
    }

    pub fn set_property(&self, name: &str, value: &str) -> Result<(), String> {
        unsafe {
            let f: Symbol<unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int> =
                self.lib.get(b"mpv_set_property_string\0").map_err(|e| e.to_string())?;
            let (n, v) = (CString::new(name).unwrap(), CString::new(value).unwrap());
            self.check(f(self.handle, n.as_ptr(), v.as_ptr()), &format!("set {name}"))
        }
    }

    pub fn get_property(&self, name: &str) -> Option<String> {
        unsafe {
            let get: Symbol<unsafe extern "C" fn(MpvHandle, *const c_char) -> *mut c_char> =
                self.lib.get(b"mpv_get_property_string\0").ok()?;
            let free: Symbol<unsafe extern "C" fn(*mut c_void)> = self.lib.get(b"mpv_free\0").ok()?;
            let n = CString::new(name).unwrap();
            let p = get(self.handle, n.as_ptr());
            if p.is_null() {
                return None;
            }
            let s = CStr::from_ptr(p).to_string_lossy().into_owned();
            free(p as *mut c_void);
            Some(s)
        }
    }
}

impl Drop for Mpv {
    fn drop(&mut self) {
        unsafe {
            if let Ok(f) = self.lib.get::<unsafe extern "C" fn(MpvHandle)>(b"mpv_terminate_destroy\0") {
                f(self.handle);
            }
        }
    }
}
