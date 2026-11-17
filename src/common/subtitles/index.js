// Copyright (C) 2017-2026 HomeBot Cinema
// Subtitle synchronization & dynamic acoustic matcher engine

const { AcousticFFTMatcher, FastFFT } = require('./AcousticFFTMatcher');
const { AudioVADProbe, getAudioContext } = require('./AudioVADProbe');
const { SubtitleCandidateParser, parseTimestamp, formatVttTimestamp } = require('./SubtitleCandidateParser');
const { SmartSubtitleSelector } = require('./SmartSubtitleSelector');

module.exports = {
    AcousticFFTMatcher,
    FastFFT,
    AudioVADProbe,
    getAudioContext,
    SubtitleCandidateParser,
    parseTimestamp,
    formatVttTimestamp,
    SmartSubtitleSelector
};
