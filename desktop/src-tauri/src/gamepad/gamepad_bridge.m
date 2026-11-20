// Game controllers through Apple's GameController framework (Xbox, PlayStation, MFi, Siri Remote).
//
// Controllers are POLLED on the main queue (60 Hz) instead of using valueChangedHandler: WebKit's own Gamepad API
// provider lives in this same process and sets those handlers on the same GCController objects, so handlers would
// fight. Each poll writes a W3C "standard" mapping snapshot into a locked table that Rust (gamepad.rs) copies out.
// Input only arrives while the app is frontmost (GCController.shouldMonitorBackgroundEvents stays NO).

#import <Foundation/Foundation.h>
#import <GameController/GameController.h>
#include <os/lock.h>
#include <string.h>

#define CINEMA_PAD_MAX 4
#define CINEMA_PAD_BUTTONS 18
#define CINEMA_PAD_AXES 4

// Keep in sync with PadState in gamepad.rs.
typedef struct {
    uint32_t connected;
    uint32_t seq;                       // bumped whenever anything in this slot changes
    float buttons[CINEMA_PAD_BUTTONS];  // standard mapping 0-16, 17 = Share / touchpad
    float axes[CINEMA_PAD_AXES];        // left x, left y, right x, right y (down = +1, as on the web)
    float battery;                      // 0..1, -1 = unknown
    int32_t battery_state;              // -1 unknown, 0 discharging, 1 charging, 2 full
    char name[64];
} cinema_pad_state;

static cinema_pad_state g_state[CINEMA_PAD_MAX];
static GCController *g_ctrl[CINEMA_PAD_MAX];
static os_unfair_lock g_lock = OS_UNFAIR_LOCK_INIT;
static dispatch_source_t g_timer;
static BOOL g_started;

static int slot_of(GCController *c) {
    for (int i = 0; i < CINEMA_PAD_MAX; i++) {
        if (g_ctrl[i] == c) return i;
    }
    return -1;
}

static void read_extended(GCExtendedGamepad *g, cinema_pad_state *s) {
    float *b = s->buttons;
    b[0] = g.buttonA.value;
    b[1] = g.buttonB.value;
    b[2] = g.buttonX.value;
    b[3] = g.buttonY.value;
    b[4] = g.leftShoulder.value;
    b[5] = g.rightShoulder.value;
    b[6] = g.leftTrigger.value;
    b[7] = g.rightTrigger.value;
    b[8] = g.buttonOptions ? g.buttonOptions.value : 0;  // Xbox View, PlayStation Share/Create
    b[9] = g.buttonMenu.value;
    b[10] = g.leftThumbstickButton ? g.leftThumbstickButton.value : 0;
    b[11] = g.rightThumbstickButton ? g.rightThumbstickButton.value : 0;
    b[12] = g.dpad.up.value;
    b[13] = g.dpad.down.value;
    b[14] = g.dpad.left.value;
    b[15] = g.dpad.right.value;
    b[16] = g.buttonHome ? g.buttonHome.value : 0;
    if (@available(macOS 12.0, *)) {
        if ([g isKindOfClass:[GCXboxGamepad class]]) b[17] = ((GCXboxGamepad *)g).buttonShare.value;
    }
    if ([g isKindOfClass:[GCDualShockGamepad class]]) b[17] = ((GCDualShockGamepad *)g).touchpadButton.value;
    if (@available(macOS 11.3, *)) {
        if ([g isKindOfClass:[GCDualSenseGamepad class]]) b[17] = ((GCDualSenseGamepad *)g).touchpadButton.value;
    }
    s->axes[0] = g.leftThumbstick.xAxis.value;
    s->axes[1] = -g.leftThumbstick.yAxis.value;
    s->axes[2] = g.rightThumbstick.xAxis.value;
    s->axes[3] = -g.rightThumbstick.yAxis.value;
}

// Siri Remote and other "micro" profiles: touch surface as D-pad, click = A, play/pause = Menu, Back = B.
static void read_micro(GCMicroGamepad *g, cinema_pad_state *s) {
    float *b = s->buttons;
    b[0] = g.buttonA.value;
    b[9] = g.buttonX.value;
    b[1] = g.buttonMenu.value;
    b[12] = g.dpad.up.value;
    b[13] = g.dpad.down.value;
    b[14] = g.dpad.left.value;
    b[15] = g.dpad.right.value;
}

static void poll_slot(int slot) {
    GCController *c = g_ctrl[slot];
    if (!c) return;
    cinema_pad_state s;
    memset(&s, 0, sizeof s);
    s.connected = 1;
    if (c.extendedGamepad) {
        read_extended(c.extendedGamepad, &s);
    } else if (c.microGamepad) {
        read_micro(c.microGamepad, &s);
    }
    // Until a controller reports its battery the level reads 0 with state "unknown": treat that as unknown, not empty.
    GCDeviceBattery *bat = c.battery;
    BOOL known = bat && bat.batteryState != GCDeviceBatteryStateUnknown;
    s.battery = known ? bat.batteryLevel : -1;
    s.battery_state = known ? (int32_t)bat.batteryState : -1;
    NSString *name = c.vendorName ?: c.productCategory ?: @"Game controller";
    strlcpy(s.name, name.UTF8String ?: "Game controller", sizeof s.name);

    os_unfair_lock_lock(&g_lock);
    cinema_pad_state *cur = &g_state[slot];
    s.seq = cur->seq;
    // seq is excluded from the comparison by copying it first.
    if (memcmp(cur, &s, sizeof s) != 0) {
        s.seq = cur->seq + 1;
        *cur = s;
    }
    os_unfair_lock_unlock(&g_lock);
}

static void poll_all(void) {
    for (int i = 0; i < CINEMA_PAD_MAX; i++) poll_slot(i);
}

static void attach(GCController *c) {
    if (!c || slot_of(c) >= 0) return;
    int slot = -1;
    for (int i = 0; i < CINEMA_PAD_MAX; i++) {
        if (!g_ctrl[i]) {
            slot = i;
            break;
        }
    }
    if (slot < 0) return;
    g_ctrl[slot] = c;
    c.playerIndex = (GCControllerPlayerIndex)slot;
    // Keep the Xbox / PS button for the app (Home) while it is frontmost instead of the system Games overlay.
    if (@available(macOS 11.0, *)) {
        GCControllerButtonInput *home = c.extendedGamepad.buttonHome;
        if (home) home.preferredSystemGestureState = GCSystemGestureStateDisabled;
    }
    poll_slot(slot);
    NSLog(@"[gamepad] connected slot %d: %@ (%@)", slot, c.vendorName, c.productCategory);
}

static void detach(GCController *c) {
    int slot = slot_of(c);
    if (slot < 0) return;
    g_ctrl[slot] = nil;
    os_unfair_lock_lock(&g_lock);
    uint32_t seq = g_state[slot].seq;
    memset(&g_state[slot], 0, sizeof g_state[slot]);
    g_state[slot].seq = seq + 1;
    os_unfair_lock_unlock(&g_lock);
    NSLog(@"[gamepad] disconnected slot %d", slot);
}

// Main thread only (GameController notifications and element reads happen there).
void cinema_pad_start(void) {
    if (g_started) return;
    g_started = YES;
    NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
    [nc addObserverForName:GCControllerDidConnectNotification object:nil queue:[NSOperationQueue mainQueue]
                usingBlock:^(NSNotification *n) { attach(n.object); }];
    [nc addObserverForName:GCControllerDidDisconnectNotification object:nil queue:[NSOperationQueue mainQueue]
                usingBlock:^(NSNotification *n) { detach(n.object); }];
    for (GCController *c in GCController.controllers) attach(c);
    g_timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(g_timer, dispatch_time(DISPATCH_TIME_NOW, 0), NSEC_PER_SEC / 60, NSEC_PER_MSEC * 2);
    dispatch_source_set_event_handler(g_timer, ^{ poll_all(); });
    dispatch_resume(g_timer);
}

// Any thread. Copies up to `max` slots into `out`; returns how many slots were copied.
int cinema_pad_snapshot(cinema_pad_state *out, int max) {
    int n = max < CINEMA_PAD_MAX ? max : CINEMA_PAD_MAX;
    if (n <= 0 || !out) return 0;
    os_unfair_lock_lock(&g_lock);
    memcpy(out, g_state, sizeof(cinema_pad_state) * (size_t)n);
    os_unfair_lock_unlock(&g_lock);
    return n;
}
