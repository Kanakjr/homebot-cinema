// macOS "Now Playing" for the in-app mpv player (see ../nowplaying.rs).
//
// mpv draws the picture, not an HTML video element, so macOS has no idea the app is playing anything: the Play/Pause
// key starts Music.app and Control Center shows nothing. Publishing Now Playing info (title, duration, position, rate,
// playbackState) and handling MPRemoteCommandCenter commands makes this app the system's current media app while a
// video plays: media keys, AirPods taps, the Touch Bar and Control Center then reach the player.
//
// Every MediaPlayer call runs on the main queue. Commands are handed to Rust through `cmd_cb`, which must return
// quickly and must not call libmpv (the main thread renders the video; see shell.rs).

#import <Foundation/Foundation.h>
#import <MediaPlayer/MediaPlayer.h>

// Mirrors `Command` in nowplaying.rs.
enum {
    NP_PLAY = 1,
    NP_PAUSE = 2,
    NP_TOGGLE = 3,
    NP_NEXT = 4,
    NP_SKIP_FORWARD = 5,
    NP_SKIP_BACKWARD = 6,
    NP_SEEK_TO = 7,
};

typedef void (*cinema_np_cmd_cb)(int32_t cmd, double value);

static cinema_np_cmd_cb cmd_cb = NULL;
static NSMutableArray *targets = nil; // @[command, token] pairs while registered
static const double SKIP_SECONDS = 10.0; // the player's own -10 s / +10 s buttons

void cinema_np_init(cinema_np_cmd_cb cb) {
    cmd_cb = cb;
}

static void add(MPRemoteCommand *command, MPRemoteCommandHandlerStatus (^handler)(MPRemoteCommandEvent *)) {
    id token = [command addTargetWithHandler:handler];
    command.enabled = YES;
    [targets addObject:@[ command, token ]];
}

static MPRemoteCommandHandlerStatus forward(int32_t cmd, double value) {
    if (!cmd_cb) return MPRemoteCommandHandlerStatusCommandFailed;
    cmd_cb(cmd, value);
    return MPRemoteCommandHandlerStatusSuccess;
}

// Main queue only.
static void register_commands(void) {
    if (targets) return;
    targets = [NSMutableArray array];
    MPRemoteCommandCenter *cc = [MPRemoteCommandCenter sharedCommandCenter];
    add(cc.playCommand, ^(__unused MPRemoteCommandEvent *e) { return forward(NP_PLAY, 0); });
    add(cc.pauseCommand, ^(__unused MPRemoteCommandEvent *e) { return forward(NP_PAUSE, 0); });
    add(cc.togglePlayPauseCommand, ^(__unused MPRemoteCommandEvent *e) { return forward(NP_TOGGLE, 0); });
    add(cc.nextTrackCommand, ^(__unused MPRemoteCommandEvent *e) { return forward(NP_NEXT, 0); });
    cc.skipForwardCommand.preferredIntervals = @[ @(SKIP_SECONDS) ];
    cc.skipBackwardCommand.preferredIntervals = @[ @(SKIP_SECONDS) ];
    add(cc.skipForwardCommand, ^(MPRemoteCommandEvent *e) {
        double s = [e isKindOfClass:[MPSkipIntervalCommandEvent class]] ? ((MPSkipIntervalCommandEvent *)e).interval : SKIP_SECONDS;
        return forward(NP_SKIP_FORWARD, s > 0 ? s : SKIP_SECONDS);
    });
    add(cc.skipBackwardCommand, ^(MPRemoteCommandEvent *e) {
        double s = [e isKindOfClass:[MPSkipIntervalCommandEvent class]] ? ((MPSkipIntervalCommandEvent *)e).interval : SKIP_SECONDS;
        return forward(NP_SKIP_BACKWARD, s > 0 ? s : SKIP_SECONDS);
    });
    add(cc.changePlaybackPositionCommand, ^(MPRemoteCommandEvent *e) {
        if (![e isKindOfClass:[MPChangePlaybackPositionCommandEvent class]]) return MPRemoteCommandHandlerStatusCommandFailed;
        return forward(NP_SEEK_TO, ((MPChangePlaybackPositionCommandEvent *)e).positionTime);
    });
    // No "previous": the player has nothing to go back to.
    cc.previousTrackCommand.enabled = NO;
}

// Main queue only. Without targets the app stops being a candidate for the media keys, so they go back to Music.
static void unregister_commands(void) {
    if (!targets) return;
    for (NSArray *pair in targets) {
        MPRemoteCommand *command = pair[0];
        [command removeTarget:pair[1]];
        command.enabled = NO;
    }
    targets = nil;
}

// Publish what is playing (any thread). `artist` may be NULL. `duration` <= 0 means unknown (a live stream: no seeking).
// `playing` = 1 playing, 0 paused or buffering.
void cinema_np_show(const char *title, const char *artist, double duration, double elapsed, double rate, int32_t playing) {
    NSString *t = [NSString stringWithUTF8String:title ? title : ""];
    NSString *a = artist ? [NSString stringWithUTF8String:artist] : nil;
    dispatch_async(dispatch_get_main_queue(), ^{
        register_commands();
        MPRemoteCommandCenter *cc = [MPRemoteCommandCenter sharedCommandCenter];
        BOOL seekable = duration > 0;
        cc.changePlaybackPositionCommand.enabled = seekable;
        cc.skipForwardCommand.enabled = seekable;
        cc.skipBackwardCommand.enabled = seekable;

        NSMutableDictionary *info = [NSMutableDictionary dictionary];
        info[MPMediaItemPropertyTitle] = t.length ? t : @"HomeBot Cinema";
        if (a.length) info[MPMediaItemPropertyArtist] = a;
        info[MPNowPlayingInfoPropertyMediaType] = @(MPNowPlayingInfoMediaTypeVideo);
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(elapsed > 0 ? elapsed : 0);
        info[MPNowPlayingInfoPropertyPlaybackRate] = @(rate);
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = @1.0;
        if (seekable) {
            info[MPMediaItemPropertyPlaybackDuration] = @(duration);
        } else {
            info[MPNowPlayingInfoPropertyIsLiveStream] = @YES;
        }
        MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
        center.nowPlayingInfo = info;
        // macOS only, and what actually makes this the current media app (Paused keeps it while paused).
        center.playbackState = playing ? MPNowPlayingPlaybackStatePlaying : MPNowPlayingPlaybackStatePaused;
    });
}

// Playback ended (any thread): give the media keys back.
void cinema_np_clear(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
        center.playbackState = MPNowPlayingPlaybackStateStopped;
        center.nowPlayingInfo = nil;
        unregister_commands();
    });
}
