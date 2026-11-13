import Bridge from '@stremio/stremio-core-web/bridge';

const worker = new Worker(`${process.env.COMMIT_HASH}/scripts/worker.js`);
const bridge = new Bridge(window, worker);

const createTransport = (): CoreTransport => {
    const init = (args: object): Promise<void> => {
        return bridge.call(['init'], [args]);
    };

    const getState = (model: string): Promise<object> => {
        return bridge.call(['getState'], [model]);
    };

    const dispatch = (action: DispatchAction, model?: string): Promise<void> => {
        return bridge.call(['dispatch'], [action, model, location.hash]);
    };

    const encodeStream = (stream: Stream): Promise<string> => {
        return bridge.call(['encodeStream'], [stream]);
    };

    const decodeStream = (stream: string): Promise<Stream> => {
        return bridge.call(['decodeStream'], [stream]);
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const analytics = (_event: object): Promise<void> => {
        // Disabled: HomeBot Cinema operates 100% locally with zero external telemetry
        return Promise.resolve();
    };

    return {
        init,
        getState,
        dispatch,
        encodeStream,
        decodeStream,
        analytics,
    };
};

export default createTransport;
