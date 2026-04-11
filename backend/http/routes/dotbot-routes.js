function registerDotbotRoutes(app, deps) {
  const {
    requireFirebaseAuth,
    createDotbotRateLimitMiddleware,
    DOTBOT_RATE_LIMIT_MESSAGE_LIMIT,
    DOTBOT_RATE_LIMIT_TRANSCRIBE_LIMIT,
    DOTBOT_RATE_LIMIT_TTS_LIMIT,
    DOTBOT_MESSAGE_MAX_WORDS,
    countWords,
    getDotbotModule,
  } = deps;

  app.post(
    '/api/dotbot/message',
    requireFirebaseAuth,
    createDotbotRateLimitMiddleware('message', DOTBOT_RATE_LIMIT_MESSAGE_LIMIT),
    async (req, res, next) => {
      try {
        const message = String(req.body?.message || '').trim();
        const conversation = Array.isArray(req.body?.conversation)
          ? req.body.conversation
          : [];
        const cartItems = Array.isArray(req.body?.cart_items) ? req.body.cart_items : [];
        const context =
          req.body?.context && typeof req.body.context === 'object'
            ? req.body.context
            : {};

        if (!message) {
          return res.status(400).json({ ok: false, message: 'message is required' });
        }

        const wordCount = countWords(message);
        if (wordCount > DOTBOT_MESSAGE_MAX_WORDS) {
          return res.status(400).json({
            ok: false,
            message: `Message too long. Maximum ${DOTBOT_MESSAGE_MAX_WORDS} words allowed.`,
            max_words: DOTBOT_MESSAGE_MAX_WORDS,
            word_count: wordCount,
          });
        }

        const response = await getDotbotModule().processDotbotMessage({
          message,
          conversation,
          cartItems,
          context,
        });

        return res.status(200).json({ ok: true, ...response });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post(
    '/api/dotbot/transcribe',
    requireFirebaseAuth,
    createDotbotRateLimitMiddleware('transcribe', DOTBOT_RATE_LIMIT_TRANSCRIBE_LIMIT),
    async (req, res, next) => {
    try {
      const audioBase64 = String(req.body?.audio_base64 || '').trim();
      const mimeType = String(req.body?.mime_type || 'audio/m4a').trim();
      if (!audioBase64) {
        return res.status(400).json({ ok: false, message: 'audio_base64 is required' });
      }

      const transcript = await getDotbotModule().transcribeAudioBase64({
        audioBase64,
        mimeType,
      });

      return res.status(200).json({ ok: true, transcript });
    } catch (error) {
      console.error('DOTBOT transcription error:', error);
      const message = String(error?.message || '').trim();
      return res.status(502).json({
        ok: false,
        message: message
          ? `Voice transcription failed: ${message}`
          : 'Voice transcription failed. Please try again.',
      });
    }
  },
  );

  app.post(
    '/api/dotbot/tts',
    requireFirebaseAuth,
    createDotbotRateLimitMiddleware('tts', DOTBOT_RATE_LIMIT_TTS_LIMIT),
    async (req, res, next) => {
    try {
      const text = String(req.body?.text || '').trim();
      if (!text) {
        return res.status(400).json({ ok: false, message: 'text is required' });
      }

      const speech = await getDotbotModule().synthesizeSpeechBase64({ text });
      return res.status(200).json({
        ok: true,
        audio_base64: speech.audioBase64,
        mime_type: speech.mimeType,
      });
    } catch (error) {
      console.error('DOTBOT TTS error:', error);
      const message = String(error?.message || '').trim();
      return res.status(502).json({
        ok: false,
        message: message
          ? `Voice reply failed: ${message}`
          : 'Voice reply failed. Please try again.',
      });
    }
  },
  );
}

module.exports = {
  registerDotbotRoutes,
};
